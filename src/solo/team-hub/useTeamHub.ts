import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  compareMessages,
  incomingAnnouncement,
  mergeMessages,
  newDividerBefore,
  parseAcknowledged,
  parseAdded,
  parseChannelId,
  parseConversationList,
  parseMessagePage,
  parsePosted,
  parseThreadPage,
  refreshLeavesGap,
  refusalMessage,
  type TeamHubChannelSummary,
  type TeamHubMessage,
  type TeamHubMessagePage,
  type TeamHubOverview,
  type TeamHubRefusal,
  type TeamHubResult,
} from "./team-hub-contract";

/**
 * EXP08 Team Hub data hook. Every call goes through `supabase.rpc` with the
 * contract's exact function name and ALWAYS carries `p_expected_tenant`, so a
 * workspace switch mid-request is refused by the server (`scope_changed`) instead
 * of answering for the wrong business. The caller remounts this hook per
 * workspace, which is what clears all state on a switch.
 *
 * Increment 1 has no realtime push: the hook refreshes on window focus, when the
 * browser comes back online, and every 15 seconds while the tab is visible.
 *
 * Unread integrity: a conversation is marked read only while its stream is on screen. The
 * workspace reports that through `setStreamVisible` (wide layout, or the phone conversation
 * view with no thread over it); the phone list view and any background refresh of an off-screen
 * conversation never mark anything read. Each mark names the newest top-level message actually
 * held for display (A8), so the server never marks read a message the client hadn't shown.
 *
 * A refresh reads the newest page only. If that page has more behind it and is entirely newer
 * than what is held, the held list is replaced and "Load earlier messages" offered, so a long
 * absence never leaves a silent hole in the stream.
 */

export const REFRESH_INTERVAL_MS = 15_000;
const PAGE_SIZE = 50;
const THREAD_PAGE_SIZE = 50;

/** `account_unavailable` is the server's `unavailable` (A1): not a canonical SOLO workspace. */
export type HubStatus = "loading" | "ready" | "unavailable" | "account_unavailable" | "not_member" | "scope_changed";

export interface StreamState {
  channelId: string;
  status: "loading" | "ready" | "not_found" | "unavailable";
  channel: TeamHubChannelSummary | null;
  messages: TeamHubMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  /** The message the "new" divider sits above, fixed when the conversation was opened. */
  dividerBefore: string | null;
  /**
   * The newest message a listed page returned. A refresh is joined to this, not to the newest
   * held message: a message just sent is appended locally and says nothing about what was read
   * between the last page and it.
   */
  listedNewest?: TeamHubMessage | null;
}

export interface ThreadState {
  channelId: string;
  rootId: string;
  status: "loading" | "ready" | "not_found" | "unavailable";
  root: TeamHubMessage | null;
  /** Oldest → newest for display; the server returns them newest-first (A7). */
  replies: TeamHubMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  /** As on StreamState: the newest reply a listed page returned, never a locally appended one. */
  listedNewest?: TeamHubMessage | null;
}

export interface PendingMessage {
  localId: string;
  /** Generated once per message attempt and reused by Retry, so the server never stores it twice. */
  clientRequestId: string;
  channelId: string;
  parentId: string | null;
  body: string;
  mentionIds: string[];
  status: "sending" | "failed";
}

export type SendOutcome =
  | { kind: "sent"; duplicate: boolean }
  | { kind: "refused"; message: string; body: string }
  | { kind: "failed" };

export type ActionOutcome<T = true> = { ok: true; value: T; message?: undefined } | { ok: false; message: string; value?: undefined };

type RpcAnswer = { data: unknown; error: unknown };

/** What a load did, for the refresh that asked: new arrivals by others, and the newest id now held. */
interface LoadReport<T> {
  result: TeamHubResult<T>;
  incoming: number;
  gap: boolean;
  newestId: string | null;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

/** The compound cursor (A6): both halves of the oldest row shown, or neither. */
function cursorBefore(oldest: TeamHubMessage | undefined): { p_before: string | null; p_before_id: string | null } {
  return oldest ? { p_before: oldest.created_at, p_before_id: oldest.id } : { p_before: null, p_before_id: null };
}

/** The message words for an action that did not complete, from what actually came back. */
function failureCode(result: TeamHubResult<unknown>): TeamHubRefusal | "no_answer" {
  return result.kind === "refused" ? result.code : "no_answer";
}

const ENDS_HUB = new Set<TeamHubRefusal>(["not_member", "unavailable", "scope_changed"]);

const newestOf = (messages: TeamHubMessage[]) => messages.length ? [...messages].sort(compareMessages)[messages.length - 1] : undefined;

export function useTeamHub(tenantId: string, options: { onTenantRefresh?: () => unknown; onIncoming?: (announcement: string) => void } = {}) {
  const [status, setStatus] = useState<HubStatus>("loading");
  const [overview, setOverview] = useState<TeamHubOverview | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);

  // Latest values for async continuations; a response for a conversation that is no
  // longer open is dropped instead of painted over the one that is.
  const live = useRef({ activeId, stream, thread, overview, status });
  live.current = { activeId, stream, thread, overview, status };
  const alive = useRef(true);
  // Set on every setup, not only at creation: React StrictMode runs setup, cleanup, setup in
  // development, and a ref left false after that first cleanup would drop every response.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const tenantRefresh = useRef(options.onTenantRefresh);
  tenantRefresh.current = options.onTenantRefresh;
  const onIncoming = useRef(options.onIncoming);
  onIncoming.current = options.onIncoming;
  const scopeRetried = useRef(false);
  const unavailableRetried = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const streamVisible = useRef(false);

  const call = useCallback(async (name: string, params: Record<string, unknown>): Promise<RpcAnswer> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPCs await generated types
      const { data, error } = await (supabase as any).rpc(name, { p_expected_tenant: tenantId, ...params });
      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }, [tenantId]);

  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshAfterAction = useRef<() => Promise<void>>(async () => undefined);

  /** Refusals that end the whole hub are handled here, for every call alike. */
  const settle = useCallback(<T,>(result: TeamHubResult<T>): TeamHubResult<T> => {
    if (!alive.current || result.kind !== "refused") return result;
    const clear = () => { setOverview(null); setStream(null); setThread(null); setPending([]); };
    if (result.code === "unavailable" && !unavailableRetried.current) {
      // The account type may have been read from a stale workspace context. Re-read it once and ask
      // again before settling on "not available for this account type".
      unavailableRetried.current = true;
      setStatus("loading");
      clear();
      void Promise.resolve(tenantRefresh.current?.()).finally(() => { if (alive.current) void refreshAfterAction.current(); });
    } else if (result.code === "not_member" || result.code === "unavailable") {
      setStatus(result.code === "not_member" ? "not_member" : "account_unavailable");
      clear();
    } else if (result.code === "scope_changed") {
      setStatus("scope_changed");
      clear();
      if (!scopeRetried.current) {
        // Re-read which workspace is active, then ask again once for that workspace.
        scopeRetried.current = true;
        void Promise.resolve(tenantRefresh.current?.()).finally(() => { if (alive.current) void refreshAfterAction.current(); });
      }
    }
    return result;
  }, []);

  const loadStream = useCallback(async (channelId: string, mode: "open" | "refresh" | "older", unreadAtOpen = 0): Promise<LoadReport<TeamHubMessagePage>> => {
    const cursor = cursorBefore(mode === "older" ? live.current.stream?.messages[0] : undefined);
    if (mode === "open") {
      setStream({ channelId, status: "loading", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null });
    } else if (mode === "older") {
      setStream((current) => current && current.channelId === channelId ? { ...current, loadingOlder: true, olderFailed: false } : current);
    }
    const answer = await call("team_hub_list_messages", { p_channel_id: channelId, p_thread_root: null, ...cursor, p_limit: PAGE_SIZE });
    const result = settle(parseMessagePage(answer.data, answer.error, channelId));
    const report: LoadReport<TeamHubMessagePage> = { result, incoming: 0, gap: false, newestId: null };
    if (!alive.current || live.current.activeId !== channelId) return report;
    if (result.kind === "refused" && ENDS_HUB.has(result.code)) return report;
    const meId = live.current.overview?.me.user_id ?? "";
    const top = result.kind === "ok" ? result.value.messages.filter((message) => !message.parent_message_id) : [];
    if (result.kind === "ok") {
      const held = mode === "open" || live.current.stream?.channelId !== channelId ? [] : live.current.stream.messages;
      const heldIds = new Set(held.map((message) => message.id));
      const anchor = mode === "open" ? null : live.current.stream?.listedNewest ?? null;
      report.gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], top, result.value.has_more);
      report.incoming = mode === "refresh" ? top.filter((message) => !heldIds.has(message.id) && message.author_user_id !== meId).length : 0;
      report.newestId = newestOf(report.gap ? top : [...held, ...top])?.id ?? null;
    }
    setStream((current) => {
      const base = current && current.channelId === channelId ? current : null;
      if (result.kind === "ok") {
        const page = result.value;
        const held = mode === "open" ? [] : base?.messages ?? [];
        // A refresh that can't be joined to what is held replaces it (keeping anything newer than
        // the page, such as a message just sent) and offers the earlier messages instead.
        const anchor = mode === "open" ? null : base?.listedNewest ?? null;
        const gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], top, page.has_more);
        const pageNewest = newestOf(top);
        const kept = gap && pageNewest ? held.filter((message) => compareMessages(message, pageNewest) > 0) : held;
        const messages = mergeMessages(kept, top);
        const listedNewest = mode === "older" ? anchor : gap ? pageNewest ?? null : newestOf([...(anchor ? [anchor] : []), ...top]) ?? null;
        return {
          channelId,
          status: "ready",
          channel: page.channel,
          messages,
          // A refresh that joins the held list decides nothing about what lies above it; an older
          // page, an open, or a refresh that left a gap does.
          hasMore: gap ? true : mode === "refresh" ? base?.hasMore ?? page.has_more : page.has_more,
          loadingOlder: false,
          olderFailed: false,
          dividerBefore: mode === "open" ? newDividerBefore(messages, unreadAtOpen, meId) : base?.dividerBefore ?? null,
          listedNewest,
        };
      }
      if (result.kind === "refused" && result.code === "not_found") {
        return { channelId, status: "not_found", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null };
      }
      if (mode === "older" && base) return { ...base, loadingOlder: false, olderFailed: true };
      // A failed background refresh keeps what is already on screen.
      if (mode === "refresh" && base?.status === "ready") return base;
      return { channelId, status: "unavailable", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null };
    });
    return report;
  }, [call, settle]);

  /** Marks read through the newest top-level message held for display, never further (A8). */
  const markRead = useCallback(async (channelId: string, throughMessageId: string) => {
    const answer = await call("team_hub_mark_read", { p_channel_id: channelId, p_through_message_id: throughMessageId });
    const result = settle(parseAcknowledged(answer.data, answer.error));
    if (result.kind === "ok" && alive.current) {
      setOverview((current) => current && {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === channelId ? { ...conversation, unread: 0 } : conversation),
      });
    }
    return result;
  }, [call, settle]);

  const loadThread = useCallback(async (channelId: string, rootId: string, mode: "open" | "refresh" | "older"): Promise<number> => {
    if (mode === "open") setThread({ channelId, rootId, status: "loading", root: null, replies: [], hasMore: false, loadingOlder: false, olderFailed: false });
    if (mode === "older") setThread((current) => current && current.rootId === rootId ? { ...current, loadingOlder: true, olderFailed: false } : current);
    const cursor = cursorBefore(mode === "older" ? live.current.thread?.replies[0] : undefined);
    const answer = await call("team_hub_list_messages", { p_channel_id: channelId, p_thread_root: rootId, ...cursor, p_limit: THREAD_PAGE_SIZE });
    const result = settle(parseThreadPage(answer.data, answer.error, channelId, rootId));
    if (!alive.current || live.current.thread?.rootId !== rootId) return 0;
    if (result.kind === "refused" && ENDS_HUB.has(result.code)) return 0;
    const meId = live.current.overview?.me.user_id ?? "";
    const heldIds = new Set((live.current.thread?.replies ?? []).map((reply) => reply.id));
    const incoming = mode === "refresh" && result.kind === "ok"
      ? result.value.replies.filter((reply) => !heldIds.has(reply.id) && reply.author_user_id !== meId).length : 0;
    setThread((current) => {
      if (!current || current.rootId !== rootId) return current;
      if (result.kind === "ok") {
        const page = result.value;
        const held = mode === "open" ? [] : current.replies;
        // Same rule as the stream: a newest page that can't be joined to the held replies replaces them.
        const anchor = mode === "open" ? null : current.listedNewest ?? null;
        const gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], page.replies, page.has_more);
        const pageNewest = newestOf(page.replies);
        const kept = gap && pageNewest ? held.filter((reply) => compareMessages(reply, pageNewest) > 0) : held;
        // Newest-first from the server; mergeMessages keeps them oldest → newest for reading.
        const replies = mergeMessages(kept, page.replies);
        const listedNewest = mode === "older" ? anchor : gap ? pageNewest ?? null : newestOf([...(anchor ? [anchor] : []), ...page.replies]) ?? null;
        return {
          channelId, rootId, status: "ready", root: page.root, replies, listedNewest,
          // A refresh that joins the held replies decides nothing about what lies above them.
          hasMore: gap ? true : mode === "refresh" ? current.hasMore : page.has_more,
          loadingOlder: false, olderFailed: false,
        };
      }
      if (result.kind === "refused" && result.code === "not_found") return { ...current, status: "not_found" };
      if (mode === "older") return { ...current, loadingOlder: false, olderFailed: true };
      return mode === "refresh" && current.status === "ready" ? current : { ...current, status: "unavailable" };
    });
    return incoming;
  }, [call, settle]);

  const runRefresh = useCallback(async () => {
    const answer = await call("team_hub_list_conversations", {});
    const result = settle(parseConversationList(answer.data, answer.error, tenantId));
    if (!alive.current) return;
    if (result.kind === "ok") {
      scopeRetried.current = false;
      setOverview(result.value);
      setStatus("ready");
      setRefreshFailed(false);
      const { activeId: current, stream: openStream, thread: openThread } = live.current;
      const listed = current ? result.value.conversations.find((conversation) => conversation.id === current) : null;
      const tabVisible = document.visibilityState === "visible";
      let newMessages = 0;
      let orMore = false;
      if (current && openStream?.channelId === current && openStream.status === "ready") {
        const load = await loadStream(current, "refresh");
        // Someone else wrote while this conversation was ON SCREEN in a visible tab. A conversation
        // left open behind the phone list view (or under a phone thread) is refreshed but stays unread.
        const onScreen = streamVisible.current && tabVisible;
        if (listed?.joined && listed.unread > 0 && onScreen && load.newestId) void markRead(current, load.newestId);
        if (onScreen) { newMessages = load.incoming; orMore = load.gap; }
      }
      const newReplies = openThread && openThread.status === "ready" ? await loadThread(openThread.channelId, openThread.rootId, "refresh") : 0;
      // The hub's one live region says how many arrived; the stream itself is not a live region.
      const text = incomingAnnouncement(newMessages, tabVisible ? newReplies : 0, orMore);
      if (text && alive.current) onIncoming.current?.(text);
    } else if (result.kind === "unavailable" || (result.kind === "refused" && !ENDS_HUB.has(result.code))) {
      // Keep the last good list on screen and say it could not be refreshed.
      if (live.current.overview) setRefreshFailed(true);
      else setStatus("unavailable");
    }
  }, [call, settle, tenantId, loadStream, loadThread, markRead]);

  /**
   * A background refresh (focus, reconnect, interval) is skipped while one is running.
   * A refresh after an action waits for it and then reads again, so what the action
   * changed is always in the list it returns to.
   */
  const refresh = useCallback(async (mode: "background" | "after_action" = "after_action") => {
    if (inFlight.current) {
      if (mode === "background") return;
      await inFlight.current.catch(() => undefined);
    }
    const run = runRefresh();
    inFlight.current = run;
    try { await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }, [runRefresh]);
  refreshRef.current = () => refresh("background");
  refreshAfterAction.current = () => refresh("after_action");

  useEffect(() => { void refresh("background"); }, [refresh]);

  // Focus, reconnect and a visible-tab interval. Nothing here claims live delivery.
  useEffect(() => {
    const onFocus = () => { void refreshRef.current(); };
    const onOnline = () => { setOnline(true); void refreshRef.current(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, []);

  const openConversation = useCallback(async (channelId: string) => {
    const conversation = live.current.overview?.conversations.find((item) => item.id === channelId);
    setActiveId(channelId);
    live.current.activeId = channelId;
    setThread(null);
    const { result, newestId } = await loadStream(channelId, "open", conversation?.unread ?? 0);
    if (result.kind === "ok" && result.value.channel.joined && newestId && alive.current && live.current.activeId === channelId && streamVisible.current) {
      void markRead(channelId, newestId);
    }
  }, [loadStream, markRead]);

  /**
   * The workspace says whether the open conversation's stream is actually on screen. When it
   * comes into view (the phone list → conversation step, or a narrow hub widening), an unread,
   * joined conversation is marked read then — never before.
   */
  const setStreamVisible = useCallback((visible: boolean) => {
    const was = streamVisible.current;
    streamVisible.current = visible;
    if (!visible || was) return;
    const { activeId: current, stream: openStream, overview: listedNow } = live.current;
    const listed = current ? listedNow?.conversations.find((conversation) => conversation.id === current) : null;
    const newest = openStream?.messages[openStream.messages.length - 1];
    if (current && newest && openStream?.channelId === current && openStream.status === "ready" && openStream.channel?.joined && (listed?.unread ?? 0) > 0) {
      void markRead(current, newest.id);
    }
  }, [markRead]);

  const clearConversation = useCallback(() => {
    setActiveId(null);
    live.current.activeId = null;
    setStream(null);
    setThread(null);
  }, []);

  const loadOlder = useCallback(async () => {
    const current = live.current.stream;
    if (!current || current.status !== "ready" || !current.hasMore || current.loadingOlder) return;
    await loadStream(current.channelId, "older");
  }, [loadStream]);

  const openThread = useCallback((rootId: string) => {
    const channelId = live.current.activeId;
    if (!channelId) return;
    live.current.thread = { channelId, rootId, status: "loading", root: null, replies: [], hasMore: false, loadingOlder: false, olderFailed: false };
    void loadThread(channelId, rootId, "open");
  }, [loadThread]);

  const loadEarlierReplies = useCallback(async () => {
    const current = live.current.thread;
    if (!current || current.status !== "ready" || !current.hasMore || current.loadingOlder) return;
    await loadThread(current.channelId, current.rootId, "older");
  }, [loadThread]);

  const closeThread = useCallback(() => { setThread(null); live.current.thread = null; }, []);

  const deliver = useCallback(async (attempt: PendingMessage): Promise<SendOutcome> => {
    setPending((current) => current.map((item) => item.localId === attempt.localId ? { ...item, status: "sending" } : item));
    const answer = await call("team_hub_post_message", {
      p_channel_id: attempt.channelId,
      p_body: attempt.body,
      p_client_request_id: attempt.clientRequestId,
      p_parent_message_id: attempt.parentId,
      p_mention_ids: attempt.mentionIds,
    });
    const result = settle(parsePosted(answer.data, answer.error));
    if (!alive.current) return { kind: "failed" };
    if (result.kind === "ok") {
      const message = result.value.message;
      setPending((current) => current.filter((item) => item.localId !== attempt.localId));
      if (!message.parent_message_id) {
        setStream((current) => current && current.channelId === attempt.channelId
          ? { ...current, messages: mergeMessages(current.messages, [message]), channel: current.channel && { ...current.channel, joined: true } }
          : current);
      } else {
        setThread((current) => current && current.rootId === message.parent_message_id
          ? { ...current, replies: mergeMessages(current.replies, [message]), root: current.root && (result.value.duplicate ? current.root : { ...current.root, reply_count: current.root.reply_count + 1, last_reply_at: message.created_at }) }
          : current);
        if (!result.value.duplicate) {
          setStream((current) => current && current.channelId === attempt.channelId
            ? { ...current, messages: current.messages.map((item) => item.id === message.parent_message_id ? { ...item, reply_count: item.reply_count + 1, last_reply_at: message.created_at } : item) }
            : current);
        }
      }
      // Posting to a team channel joins the caller, as the server does.
      setOverview((current) => current && {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === attempt.channelId
          ? { ...conversation, joined: true, last_message_at: message.created_at }
          : conversation),
      });
      return { kind: "sent", duplicate: result.value.duplicate };
    }
    if (result.kind === "refused") {
      setPending((current) => current.filter((item) => item.localId !== attempt.localId));
      if (result.code === "not_found") {
        if (attempt.parentId) setThread((current) => current && current.rootId === attempt.parentId ? { ...current, status: "not_found" } : current);
        else setStream((current) => current && current.channelId === attempt.channelId ? { ...current, status: "not_found", messages: [], channel: null } : current);
      }
      return { kind: "refused", message: refusalMessage(result.code, "send"), body: attempt.body };
    }
    setPending((current) => current.map((item) => item.localId === attempt.localId ? { ...item, status: "failed" } : item));
    return { kind: "failed" };
  }, [call, settle]);

  const send = useCallback((input: { channelId: string; parentId: string | null; body: string; mentionIds: string[] }) => {
    const attempt: PendingMessage = {
      localId: newRequestId(),
      clientRequestId: newRequestId(),
      channelId: input.channelId,
      parentId: input.parentId,
      body: input.body.trim(),
      mentionIds: input.mentionIds,
      status: "sending",
    };
    setPending((current) => [...current, attempt]);
    return deliver(attempt);
  }, [deliver]);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const retry = useCallback((localId: string) => {
    const attempt = pendingRef.current.find((item) => item.localId === localId);
    // Same client request id: if the first attempt reached the server, this returns it.
    return attempt ? deliver(attempt) : Promise.resolve<SendOutcome>({ kind: "failed" });
  }, [deliver]);

  const discard = useCallback((localId: string) => {
    setPending((current) => current.filter((item) => item.localId !== localId));
  }, []);

  const createChannel = useCallback(async (input: { name: string; visibility: "team" | "private"; memberIds: string[]; clientRequestId: string }): Promise<ActionOutcome<string>> => {
    const answer = await call("team_hub_create_channel", {
      p_name: input.name,
      p_visibility: input.visibility,
      p_member_ids: input.visibility === "private" ? input.memberIds : [],
      p_client_request_id: input.clientRequestId,
    });
    const result = settle(parseChannelId(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "create") };
    await refresh();
    await openConversation(result.value);
    return { ok: true, value: result.value };
  }, [call, settle, refresh, openConversation]);

  const openDm = useCallback(async (userId: string): Promise<ActionOutcome<string>> => {
    const existing = live.current.overview?.conversations.find((conversation) => conversation.kind === "dm" && conversation.dm_user_id === userId);
    if (existing) {
      await openConversation(existing.id);
      return { ok: true, value: existing.id };
    }
    const answer = await call("team_hub_open_dm", { p_user_id: userId });
    const result = settle(parseChannelId(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "dm") };
    await refresh();
    await openConversation(result.value);
    return { ok: true, value: result.value };
  }, [call, settle, refresh, openConversation]);

  const membership = useCallback(async (name: "team_hub_join_channel" | "team_hub_leave_channel", channelId: string): Promise<ActionOutcome> => {
    const answer = await call(name, { p_channel_id: channelId });
    const result = settle(parseAcknowledged(answer.data, answer.error));
    const action = name === "team_hub_join_channel" ? "join" : "leave";
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), action) };
    const joined = action === "join";
    setOverview((current) => current && {
      ...current,
      conversations: current.conversations.map((conversation) => conversation.id === channelId ? { ...conversation, joined, unread: 0 } : conversation),
    });
    setStream((current) => current && current.channelId === channelId && current.channel ? { ...current, channel: { ...current.channel, joined } } : current);
    await refresh();
    return { ok: true, value: true };
  }, [call, settle, refresh]);

  const joinChannel = useCallback((channelId: string) => membership("team_hub_join_channel", channelId), [membership]);
  const leaveChannel = useCallback((channelId: string) => membership("team_hub_leave_channel", channelId), [membership]);

  const addMembers = useCallback(async (channelId: string, userIds: string[]): Promise<ActionOutcome<number>> => {
    const answer = await call("team_hub_add_members", { p_channel_id: channelId, p_user_ids: userIds });
    const result = settle(parseAdded(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "add") };
    await refresh();
    return { ok: true, value: result.value };
  }, [call, settle, refresh]);

  const retryAfterScopeChange = useCallback(async () => {
    scopeRetried.current = true;
    setStatus("loading");
    await Promise.resolve(tenantRefresh.current?.());
    if (alive.current) await refresh();
  }, [refresh]);

  const retryLoad = useCallback(async () => {
    setStatus((current) => current === "unavailable" ? "loading" : current);
    await refresh();
  }, [refresh]);

  const activeConversation = useMemo(
    () => overview?.conversations.find((conversation) => conversation.id === activeId) ?? null,
    [overview, activeId],
  );

  return {
    status,
    overview,
    refreshFailed,
    online,
    activeId,
    activeConversation,
    stream,
    thread,
    pending,
    refresh,
    retryLoad,
    retryAfterScopeChange,
    openConversation,
    clearConversation,
    loadOlder,
    setStreamVisible,
    openThread,
    loadEarlierReplies,
    closeThread,
    send,
    retry,
    discard,
    createChannel,
    openDm,
    joinChannel,
    leaveChannel,
    addMembers,
  };
}

export type TeamHub = ReturnType<typeof useTeamHub>;
export type { TeamHubRefusal };
