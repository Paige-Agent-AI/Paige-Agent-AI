import { useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ConfirmItem } from "@/components/chat/confirmPreview";
import { readOriginalReminderHistory } from "@/components/chat/reminderHistory";
import { CHAT_CONTROL_HEADER, chatControlRetryDelay } from "../../supabase/functions/_shared/paige-turn/control-transport";

/**
 * Multi-chat history for "Your Paige" (#94).
 *
 * The owner's personal working chats — lens='coach', contact_id IS NULL — each a
 * distinct thread the NULLS-DISTINCT single-active index keeps separate. Reads
 * and mutations go straight through RLS-gated table ops (no bespoke RPCs);
 * creation uses the existing paige_chat_thread_create. The server (paige-ai-chat)
 * is the single writer of turns — this hook never inserts a turn, so the sidebar
 * never shows a chat the backend didn't actually persist (§13/§15).
 *
 * Your-Paige chats ONLY (studio_session_id IS NULL). Studio sessions share this
 * table (paige_studio_thread_ensure inserts lens='coach', contact_id=NULL,
 * is_archived=false — indistinguishable here except by studio_session_id), so
 * without the filter below they bleed into this rail as fake "Studio session"
 * chats. Their real home is the Studio gallery (StudioHome → useStudioSessions);
 * excluding them here keeps one home per capability (§18), never orphaning them.
 */

export interface PaigeThread {
  id: string;
  title: string | null;
  last_message_at: string | null;
  message_count: number;
  is_archived: boolean;
  updated_at: string | null;
}

export interface PaigeTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  bundle_ref: Record<string, unknown> | null;
  surfaces_used: string[] | null;
  seq: number;
  created_at: string | null;
  interactive_intent_id?: string | null;
  interactive_terminal_state?: string | null;
}

export interface RecoveredPaigeApproval {
  v: 1; status: "available"; thread_id: string; turn_id: string; intent_id: string;
  tenant_id: string; expires_at: string;
  confirmations: Array<ConfirmItem & {fingerprint: string; command: Record<string, unknown>; idempotency_key: string}>;
}

/** Accept only the dedicated server read response, never bundle_ref or a cached
 * browser card. Native single-use claim remains the execution authority. */
export function readRecoveredPaigeApproval(raw: unknown, scope: {
  threadId: string; turnId: string; intentId: string; tenantId: string;
}): RecoveredPaigeApproval | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.status !== "available" || r.thread_id !== scope.threadId || r.turn_id !== scope.turnId
    || r.intent_id !== scope.intentId || r.tenant_id !== scope.tenantId || typeof r.expires_at !== "string"
    || !Number.isFinite(Date.parse(r.expires_at)) || Date.parse(r.expires_at) <= Date.now()
    || !Array.isArray(r.confirmations) || r.confirmations.length < 1 || r.confirmations.length > 10) return null;
  const seen = new Set<string>();
  const confirmations: RecoveredPaigeApproval["confirmations"] = [];
  for (const candidate of r.confirmations) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const c = candidate as Record<string, unknown>;
    if (typeof c.tool !== "string" || !/^[a-z][a-z0-9_]{0,95}$/.test(c.tool)
      || typeof c.summary !== "string" || !c.summary.trim() || typeof c.fingerprint !== "string"
      || !/^[0-9a-f]{16}$/.test(c.fingerprint) || seen.has(c.fingerprint)
      || !c.command || typeof c.command !== "object" || Array.isArray(c.command)
      || typeof (c.command as Record<string, unknown>).action !== "string"
      || typeof c.idempotency_key !== "string" || !c.idempotency_key.trim() || c.idempotency_key.length > 192) return null;
    seen.add(c.fingerprint);
    confirmations.push({tool: c.tool, summary: c.summary, fingerprint: c.fingerprint,
      command: c.command as Record<string, unknown>, idempotency_key: c.idempotency_key});
  }
  return {v: 1, status: "available", thread_id: scope.threadId, turn_id: scope.turnId, intent_id: scope.intentId,
    tenant_id: scope.tenantId, expires_at: r.expires_at, confirmations};
}

// The generated Supabase types don't yet carry these owner-chat rows/RPCs; the
// casts keep the call sites honest without loosening the whole client.
const db = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

export function usePaigeThreads(opts: { callerUserId: string | null; tenantId: string | null; platform?: boolean }) {
  const { callerUserId, tenantId, platform = false } = opts;
  const qc = useQueryClient();
  // Platform mode (#130 / §45): the operator's tenant-less "Your Paige" — enabled
  // without a tenant. Tenant mode still requires an active tenant for §9 isolation.
  const enabled = !!callerUserId && (platform || !!tenantId);
  // Cache-slot suffix: platform threads (tenant_id NULL) and tenant threads never
  // share a slot. EVERY read + mutation keys on this — not raw tenantId — or a
  // platform-mode create/rename/archive/delete would invalidate the tenant slot
  // (tenantId is NULL in platform mode) and never refresh the platform rail (#130).
  const keySuffix = platform ? "platform" : tenantId;
  const approvalScopeKey = JSON.stringify([callerUserId, tenantId, platform]);
  const approvalScopeRef = useRef({ key: approvalScopeKey, retryAt: 0 });
  const originalReminderReadGeneration = useRef(0);
  if (approvalScopeRef.current.key !== approvalScopeKey) approvalScopeRef.current = { key: approvalScopeKey, retryAt: 0 };

  const threadsQuery = useQuery({
    // platform threads (tenant_id NULL) and tenant threads never share a cache slot.
    queryKey: ["paige-threads", callerUserId, keySuffix],
    enabled,
    queryFn: async (): Promise<PaigeThread[]> => {
      // §9 tenant isolation: scope the owner sidebar to the ACTIVE tenant. Without
      // this predicate, switching into a sub-account would re-fetch (the query key
      // carries tenantId) but return the same rows, seeping the owner's other-tenant
      // "Your Paige" threads into the child. `enabled` gates on tenantId, so this is
      // never undefined here — no tenant context ⇒ query disabled ⇒ no threads.
      // Platform mode (#130): list the operator's NULL-tenant lens='platform' threads
      // instead — RLS (is_platform_owner()) keeps these visible only to the operator.
      let q = db
        .from("paige_chat_threads")
        .select("id,title,last_message_at,message_count,is_archived,updated_at");
      q = platform
        ? q.is("tenant_id", null).eq("lens", "platform")
        : q.eq("tenant_id", tenantId).eq("lens", "coach");
      const { data, error } = await q
        .is("contact_id", null)
        .is("studio_session_id", null) // exclude Studio-session threads — they live in the Studio gallery (§18)
        .eq("is_archived", false)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaigeThread[];
    },
  });

  /** Load a thread's full turn history, oldest→newest by the monotonic seq. */
  const loadTurns = useCallback(async (threadId: string): Promise<PaigeTurn[]> => {
    const { data, error } = await db
      .from("paige_chat_turns")
      .select("id,role,content,bundle_ref,surfaces_used,seq,created_at,interactive_intent_id,interactive_terminal_state")
      .eq("thread_id", threadId)
      .order("seq", { ascending: true });
    if (error) throw error;
    return (data ?? []) as PaigeTurn[];
  }, []);

  const loadApprovalRecovery = useCallback(async (threadId: string, turnId: string, intentId: string) => {
    if (platform || !callerUserId || !tenantId) return null;
    const scope = approvalScopeRef.current;
    if (scope.key !== approvalScopeKey || Date.now() < scope.retryAt) return null;
    try {
      const {data, error} = await supabase.functions.invoke("paige-ai-chat", {headers: { [CHAT_CONTROL_HEADER]: "status" }, body: {
        messages: [{role: "user", content: "Read pending approval status."}], threadId, requestIntentId: intentId,
        interactive: {kind: "status", approvalTurnId: turnId},
      }});
      if (approvalScopeRef.current !== scope) return null;
      const context = (error as { context?: Response } | null)?.context;
      if (context?.status === 429) scope.retryAt = Date.now() + chatControlRetryDelay(context.headers?.get("Retry-After"));
      return error ? null : readRecoveredPaigeApproval(data?.approval_recovery, {threadId, turnId, intentId, tenantId});
    } catch { return null; }
  }, [callerUserId, tenantId, platform, approvalScopeKey]);

  // Same native status transport, separate inert historical result. A caller
  // supplies a physical abort signal and fences its selected conversation/focus.
  const loadOriginalReminderHistory = useCallback(async (
    threadId: string, turnId: string, intentId: string, signal: AbortSignal,
  ) => {
    const generation = ++originalReminderReadGeneration.current;
    if (platform || !callerUserId || !tenantId || !signal || signal.aborted) return null;
    const scope = approvalScopeRef.current;
    if (scope.key !== approvalScopeKey || Date.now() < scope.retryAt) return null;
    try {
      const { data, error } = await supabase.functions.invoke("paige-ai-chat", {
        signal, headers: { [CHAT_CONTROL_HEADER]: "status" }, body: {
          messages: [{ role: "user", content: "Read pending approval status." }], threadId, requestIntentId: intentId,
          interactive: { kind: "status", approvalTurnId: turnId },
        },
      });
      if (signal.aborted || approvalScopeRef.current !== scope || generation !== originalReminderReadGeneration.current) return null;
      const context = (error as { context?: Response } | null)?.context;
      if (context?.status === 429) scope.retryAt = Date.now() + chatControlRetryDelay(context.headers?.get("Retry-After"));
      return error ? null : readOriginalReminderHistory(data?.approval_history, { threadId, turnId, intentId, tenantId });
    } catch { return null; }
  }, [callerUserId, tenantId, platform, approvalScopeKey]);

  /** Create a thread lazily on first send. Title is a placeholder the server
   *  refines from the first message. */
  const ensureThread = useCallback(async (firstText?: string): Promise<string> => {
    const seed = (firstText ?? "").trim().replace(/\s+/g, " ").split(" ").slice(0, 7).join(" ").slice(0, 60);
    const { data, error } = await db.rpc("paige_chat_thread_create", {
      p_contact_id: null,
      p_lens: platform ? "platform" : "coach",
      p_title: seed || "New chat",
      p_consent_snapshot: null,
    });
    if (error) throw error;
    // The RPC returns the new thread id (uuid).
    const id = typeof data === "string" ? data : data?.id ?? data;
    await qc.invalidateQueries({ queryKey: ["paige-threads", callerUserId, keySuffix] });
    return id as string;
  }, [callerUserId, keySuffix, platform, qc]);

  const renameThread = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await db.from("paige_chat_threads").update({ title }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, title }) => {
      const key = ["paige-threads", callerUserId, keySuffix];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PaigeThread[]>(key);
      qc.setQueryData<PaigeThread[]>(key, (old) => (old ?? []).map((t) => (t.id === id ? { ...t, title } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["paige-threads", callerUserId, keySuffix], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["paige-threads", callerUserId, keySuffix] }),
  });

  const archiveThread = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("paige_chat_threads").update({ is_archived: true }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      const key = ["paige-threads", callerUserId, keySuffix];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PaigeThread[]>(key);
      qc.setQueryData<PaigeThread[]>(key, (old) => (old ?? []).filter((t) => t.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["paige-threads", callerUserId, keySuffix], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["paige-threads", callerUserId, keySuffix] }),
  });

  /** Hard delete — irreversible (turns CASCADE). Confirm-gated at the call site. */
  const deleteThread = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("paige_chat_threads").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["paige-threads", callerUserId, keySuffix] }),
  });

  /** Called after a turn persists so the rail reorders + picks up the auto-title. */
  const onTurnPersisted = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["paige-threads", callerUserId, keySuffix] });
  }, [callerUserId, keySuffix, qc]);

  return {
    threads: threadsQuery.data ?? [],
    isLoading: threadsQuery.isLoading,
    // True only once an ENABLED query actually settled a fetch. A disabled query
    // (ids not yet resolved) reports isLoading:false in react-query v5, so the
    // auto-resume effect must gate on this, not isLoading, or it latches on the
    // empty first render and never restores the most-recent chat (#94).
    isFetched: enabled && threadsQuery.isFetched,
    loadTurns,
    loadApprovalRecovery,
    loadOriginalReminderHistory,
    ensureThread,
    renameThread: (id: string, title: string) => renameThread.mutate({ id, title }),
    archiveThread: (id: string) => archiveThread.mutate(id),
    deleteThread: (id: string) => deleteThread.mutateAsync(id),
    onTurnPersisted,
  };
}

export type UsePaigeThreads = ReturnType<typeof usePaigeThreads>;
