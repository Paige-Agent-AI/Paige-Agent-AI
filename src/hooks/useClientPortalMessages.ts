import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in customer's portal conversation with their business (E09).
 *
 * Reads go through client_portal_conversation() and writes through
 * client_portal_send_message() — both resolve the customer relationship from the
 * auth subject server-side (§9). Customers cannot read public.messages, so there
 * is no realtime: the thread refreshes after a send, on window focus / when the
 * tab becomes visible, and on a modest interval while visible.
 *
 * A message appears as "sent" only after the server returned its id. A send whose
 * outcome is unknown keeps its request id so a retry replays idempotently instead
 * of duplicating. Nothing here infers that the business has READ a message.
 *
 * An account linked to more than one business is refused by the relationship
 * resolver (42501) until multi-business membership ships. That is reported as its
 * own state — never as a network failure — and polling stops, because asking
 * again cannot change the answer.
 */

export type PortalMessageAuthor = "customer" | "business";
export type PortalMessageKind = "message" | "help";

export interface PortalMessage {
  id: string;
  author: PortalMessageAuthor;
  kind: PortalMessageKind;
  body: string;
  created_at: string;
}

export type OutboxStatus = "sending" | "failed" | "unconfirmed";

export interface OutboxMessage {
  localId: string;
  requestId: string;
  body: string;
  kind: PortalMessageKind;
  status: OutboxStatus;
  /** Server error code for a definite refusal; null when the outcome is unknown. */
  error: string | null;
}

export type SendErrorCode =
  | "REQUEST_ID_REQUIRED" | "INVALID_KIND" | "INVALID_BODY" | "NO_RELATIONSHIP" | "REQUEST_ID_CONFLICT"
  | "RATE_LIMITED" | "MULTIPLE_RELATIONSHIPS";

/** Customer-facing copy for a definite send refusal. Unknown codes fall back to a plain "not sent". */
export const PORTAL_SEND_FAILURE_COPY: Record<SendErrorCode, string> = {
  INVALID_BODY: "Messages need some text, up to 4,000 characters.",
  NO_RELATIONSHIP: "Your account isn't connected to this business anymore, so this wasn't sent.",
  RATE_LIMITED: "You've sent a lot of messages in a short time. Wait a minute, then try again.",
  MULTIPLE_RELATIONSHIPS: "Messaging for more than one business isn't available yet, so this wasn't sent.",
  REQUEST_ID_CONFLICT: "This message wasn't sent. Edit it and send it again.",
  INVALID_KIND: "This message wasn't sent. Edit it and send it again.",
  REQUEST_ID_REQUIRED: "This message wasn't sent. Edit it and send it again.",
};

export function portalSendFailureCopy(code: string | null): string {
  return (code && (PORTAL_SEND_FAILURE_COPY as Record<string, string>)[code]) || "This message wasn't sent.";
}

export const PORTAL_MESSAGE_MAX = 4000;
export const PORTAL_MESSAGES_PAGE = 50;
export const PORTAL_MESSAGES_POLL_MS = 30_000;

interface ConversationPayload {
  tenant_id: string | null;
  messages: PortalMessage[];
  has_more: boolean;
}

type RpcResult = { data: unknown; error: unknown };
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: "client_portal_conversation" | "client_portal_send_message", args: Record<string, unknown>) {
  return supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
}

/**
 * The relationship resolver raises 42501 when the account is linked to more than one
 * business. 42501 is also "not signed in"; that case is handled by the auth scope, so
 * only the relationship refusal is classified here.
 */
function isMultipleRelationships(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== "42501") return false;
  return !(typeof e.message === "string" && /authentication required/i.test(e.message));
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for old runtimes; the server requires a uuid.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parseMessage(raw: unknown): PortalMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.body !== "string" || typeof r.created_at !== "string") return null;
  if (r.author !== "customer" && r.author !== "business") return null;
  return { id: r.id, author: r.author, kind: r.kind === "help" ? "help" : "message", body: r.body, created_at: r.created_at };
}

function parseConversation(data: unknown): ConversationPayload | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") throw new Error("Unexpected conversation response");
  const d = data as Record<string, unknown>;
  const list = Array.isArray(d.messages) ? d.messages : [];
  return {
    tenant_id: typeof d.tenant_id === "string" ? d.tenant_id : null,
    messages: list.map(parseMessage).filter((m): m is PortalMessage => m !== null),
    has_more: d.has_more === true,
  };
}

/** Oldest first; ties broken by id so the order is stable across refreshes. */
function mergeChronological(...lists: PortalMessage[][]): PortalMessage[] {
  const byId = new Map<string, PortalMessage>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const t = Date.parse(a.created_at) - Date.parse(b.created_at);
    return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface ClientPortalMessagesState {
  /** Confirmed messages, oldest first. */
  messages: PortalMessage[];
  /** Sends that have not been confirmed by the server, in the order they were made. */
  outbox: OutboxMessage[];
  /** First read in flight with nothing loaded yet. */
  loading: boolean;
  /** The last read failed; existing messages (if any) are kept but may be stale. */
  error: string | null;
  /** Resolved: the caller has no customer relationship (conversation returned null). */
  unavailable: boolean;
  /** Resolved: the account is linked to more than one business, which messaging doesn't support yet. */
  multipleBusinesses: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  /** Tenant of the loaded conversation (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes, so drafts can be retired. */
  scopeEpoch: number;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  send: (body: string, kind: PortalMessageKind) => Promise<boolean>;
  retry: (localId: string) => Promise<boolean>;
  discard: (localId: string) => void;
}

export function useClientPortalMessages(): ClientPortalMessagesState {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const messagesRef = useRef<PortalMessage[]>([]);
  const outboxRef = useRef<OutboxMessage[]>([]);
  const readSeq = useRef(0);
  const alive = useRef(true);
  /** Set once the server refused for multiple relationships: no further polling for this identity. */
  const halted = useRef(false);
  messagesRef.current = messages;
  outboxRef.current = outbox;

  const resetScope = useCallback(() => {
    epoch.current += 1;
    readSeq.current += 1;
    tenantRef.current = null;
    halted.current = false;
    messagesRef.current = [];
    outboxRef.current = [];
    setMessages([]);
    setOutbox([]);
    setError(null);
    setUnavailable(false);
    setMultipleBusinesses(false);
    setHasMore(false);
    setLoadingMore(false);
    setLoading(true);
    setTenantId(null);
    setScopeEpoch(epoch.current);
  }, []);

  const haltForMultiple = useCallback(() => {
    halted.current = true;
    messagesRef.current = [];
    setMessages([]);
    setHasMore(false);
    setError(null);
    setMultipleBusinesses(true);
  }, []);

  const refresh = useCallback(async () => {
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    try {
      const { data, error: rpcError } = await portalRpc("client_portal_conversation", {
        p_tenant_id: tenantRef.current, p_before: null, p_limit: PORTAL_MESSAGES_PAGE,
      });
      if (rpcError) throw rpcError;
      const payload = parseConversation(data);
      if (!current()) return;
      if (!payload) {
        setUnavailable(true);
        setMessages([]);
        setHasMore(false);
      } else {
        tenantRef.current = payload.tenant_id;
        setTenantId(payload.tenant_id);
        setUnavailable(false);
        // Keep earlier pages already loaded; the newest page is authoritative for its window.
        const hadOlder = messagesRef.current.length > 0 && payload.messages.length > 0
          && Date.parse(messagesRef.current[0].created_at) < Date.parse(payload.messages[payload.messages.length - 1].created_at);
        const oldestNew = payload.messages.length ? payload.messages[payload.messages.length - 1].created_at : null;
        const older = oldestNew ? messagesRef.current.filter((m) => Date.parse(m.created_at) < Date.parse(oldestNew)) : [];
        const merged = mergeChronological(older, payload.messages);
        messagesRef.current = merged;
        setMessages(merged);
        // has_more describes what lies before the newest page; once older pages are loaded,
        // only loadMore() may clear it.
        setHasMore((prev) => (hadOlder ? prev : payload.has_more));
      }
      setError(null);
    } catch (err) {
      if (!current()) return;
      if (isMultipleRelationships(err)) haltForMultiple();
      else setError("We couldn't load your messages. Check your connection and try again.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [haltForMultiple]);

  const loadMore = useCallback(async () => {
    const oldest = messagesRef.current[0];
    if (!oldest || loadingMore) return;
    const myEpoch = epoch.current;
    setLoadingMore(true);
    try {
      const { data, error: rpcError } = await portalRpc("client_portal_conversation", {
        p_tenant_id: tenantRef.current, p_before: oldest.created_at, p_limit: PORTAL_MESSAGES_PAGE,
      });
      if (rpcError) throw rpcError;
      const payload = parseConversation(data);
      if (!alive.current || myEpoch !== epoch.current) return;
      if (!payload) { setUnavailable(true); return; }
      const merged = mergeChronological(payload.messages, messagesRef.current);
      messagesRef.current = merged;
      setMessages(merged);
      setHasMore(payload.has_more);
      setError(null);
    } catch (err) {
      if (!alive.current || myEpoch !== epoch.current) return;
      if (isMultipleRelationships(err)) haltForMultiple();
      else setError("We couldn't load earlier messages. Try again.");
    } finally {
      if (alive.current && myEpoch === epoch.current) setLoadingMore(false);
    }
  }, [loadingMore, haltForMultiple]);

  const patchOutbox = (localId: string, patch: Partial<OutboxMessage> | null) => {
    const next = patch === null
      ? outboxRef.current.filter((o) => o.localId !== localId)
      : outboxRef.current.map((o) => (o.localId === localId ? { ...o, ...patch } : o));
    outboxRef.current = next;
    setOutbox(next);
  };

  const deliver = useCallback(async (entry: OutboxMessage): Promise<boolean> => {
    const myEpoch = epoch.current;
    const current = () => alive.current && myEpoch === epoch.current;
    patchOutbox(entry.localId, { status: "sending", error: null });
    try {
      const { data, error: rpcError } = await portalRpc("client_portal_send_message", {
        p_body: entry.body, p_request_id: entry.requestId, p_kind: entry.kind, p_tenant_id: tenantRef.current,
      });
      if (!current()) return false;
      if (rpcError && isMultipleRelationships(rpcError)) {
        // A definite refusal: nothing was saved, and retrying cannot succeed.
        patchOutbox(entry.localId, { status: "failed", error: "MULTIPLE_RELATIONSHIPS" });
        haltForMultiple();
        return false;
      }
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === true && typeof result.message_id === "string") {
        const confirmed: PortalMessage = {
          id: result.message_id, author: "customer", kind: entry.kind, body: entry.body.trim(),
          created_at: typeof result.created_at === "string" ? result.created_at : new Date().toISOString(),
        };
        const merged = mergeChronological(messagesRef.current, [confirmed]);
        messagesRef.current = merged;
        setMessages(merged);
        patchOutbox(entry.localId, null);
        void refresh();
        return true;
      }
      // A definite refusal from the server: nothing was saved.
      patchOutbox(entry.localId, { status: "failed", error: typeof result.error === "string" ? result.error : "UNKNOWN" });
      return false;
    } catch {
      // Network/transport failure: the message MAY have been saved. Retrying with the same
      // request id is safe — the server replays instead of creating a second message.
      if (current()) patchOutbox(entry.localId, { status: "unconfirmed", error: null });
      return false;
    }
  }, [refresh, haltForMultiple]);

  const send = useCallback(async (body: string, kind: PortalMessageKind) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > PORTAL_MESSAGE_MAX || !tenantRef.current || halted.current) return false;
    const entry: OutboxMessage = { localId: newId(), requestId: newId(), body: trimmed, kind, status: "sending", error: null };
    outboxRef.current = [...outboxRef.current, entry];
    setOutbox(outboxRef.current);
    return deliver(entry);
  }, [deliver]);

  const retry = useCallback(async (localId: string) => {
    const entry = outboxRef.current.find((o) => o.localId === localId);
    if (!entry || entry.status === "sending" || halted.current) return false;
    return deliver(entry);
  }, [deliver]);

  const discard = useCallback((localId: string) => {
    const entry = outboxRef.current.find((o) => o.localId === localId);
    if (!entry || entry.status === "sending") return;
    patchOutbox(localId, null);
  }, []);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      actor.current = user?.id ?? null;
      if (!user) { setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor.current) return;
      if (next === actor.current && event !== "SIGNED_OUT") return;
      actor.current = next;
      resetScope();
      if (!next || event === "SIGNED_OUT") { setLoading(false); setUnavailable(true); return; }
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => { if (!cancelled) void refresh(); });
    });
    return () => {
      cancelled = true;
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [refresh, resetScope]);

  // Freshness without realtime: focus, becoming visible, and a modest interval while visible.
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const live = () => !!actor.current && !halted.current;
    const onFocus = () => { if (live()) void refresh(); };
    const onVisibility = () => { if (visible() && live()) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => { if (visible() && live()) void refresh(); }, PORTAL_MESSAGES_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { messages, outbox, loading, error, unavailable, multipleBusinesses, hasMore, loadingMore, tenantId, scopeEpoch, refresh, loadMore, send, retry, discard };
}
