import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { projectResearchHistoryRun, type ResearchHistoryDetail, type ResearchHistorySource } from "@/lib/paigeResearchReadback";

/**
 * Deep Research workspace data hook (R1+R2, INT-303).
 *
 * ONE canonical substrate: reads go through the M0 governed RPCs
 * (list_workspace_research / get_workspace_research_run — tenant scope derived
 * server-side, never a client parameter); execution goes through the canonical
 * paige-deep-research edge function with the caller's own JWT (the engine's JWT
 * path pins lineage to current_user_tenant_id; the optional expected_tenant_id
 * is a cross-check, never authority). No second research API exists here.
 *
 * The scope fence (ruling §15): every request captures the ACTIVE workspace at
 * launch; a response whose workspace is no longer current is DISCARDED — a run
 * started in workspace A can never render or save into workspace B's view. The
 * server remains the authority (the engine resolves lineage server-side); this
 * fence protects only the display, and the persisted run stays under A because
 * the SERVER resolved A at creation.
 */

export type ResearchRunRow = {
  id: string;
  question: string;
  domain: string | null;
  caller: string | null;
  stop_reason: string | null;
  configured: boolean | null;
  is_dossier: boolean;
  source_count: number;
  created_at: string;
};

export type ResearchSourceRow = ResearchHistorySource;
export type ResearchRunDetail = ResearchHistoryDetail;

export type ResearchDepth = "quick" | "standard" | "thorough";

/** Depth maps ONLY onto existing engine bounds (max_hops 1..3, default 2).
 *  No new engine modes were created for the labels (ruling §3). */
const DEPTH_TO_HOPS: Record<ResearchDepth, number | undefined> = {
  quick: 1,
  standard: undefined, // the engine default (2)
  thorough: 3,
};

export type RunPhase =
  | { kind: "idle" }
  | { kind: "running"; question: string; startedAt: number }
  | { kind: "done"; runId: string | null; persisted: boolean }
  | { kind: "failed"; reason: string };

const RUN_TIMEOUT_MS = 150_000; // engine wall clock is 60s general / 90s dossier; generous transport margin

const READ_TIMEOUT_MS = 8_000;
type ReadReply = { data: unknown; error: unknown };
type Ticket = { epoch: number; lifecycle: number; controller: AbortController; deadline: number };
const blankView = (epoch: number) => ({ epoch, rows: null as ResearchRunRow[] | null, listError: null as string | null,
  detail: null as ResearchRunDetail | null, detailError: null as string | null, detailLoading: false, phase: { kind: "idle" } as RunPhase });

// Cancel the installed PostgREST transport AND settle the local state. The local
// deadline still applies if an old transport ignores abort or its timer is delayed.
function boundedRead(request: PromiseLike<ReadReply>, ticket: Ticket): Promise<ReadReply> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: ReadReply) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ticket.controller.signal.removeEventListener("abort", abort);
      resolve(Date.now() >= ticket.deadline ? { data: null, error: true } : result);
    };
    const abort = () => finish({ data: null, error: true });
    const timer = setTimeout(() => ticket.controller.abort(), Math.max(0, ticket.deadline - Date.now()));
    ticket.controller.signal.addEventListener("abort", abort, { once: true });
    if (ticket.controller.signal.aborted) { abort(); return; }
    Promise.resolve(request).then(finish, () => finish({ data: null, error: true }));
  });
}

export function useDeepResearch(activeTenantId: string | null) {
  const context = useTenantContext();
  const ready = !!activeTenantId && activeTenantId === context.activeTenantId && !!context.activeUserId
    && !context.loading && !context.accountContextLoading && context.accountContextStatus === "ready";
  const key = JSON.stringify([activeTenantId, context.activeTenantId, context.activeUserId, ready]);
  const identity = useRef({ key, epoch: 1, ready, tenant: activeTenantId, actor: context.activeUserId });
  if (identity.current.key !== key) identity.current = { key, epoch: identity.current.epoch + 1, ready, tenant: activeTenantId, actor: context.activeUserId };
  const lifecycle = useRef(0);
  const mounted = useRef(true);
  const reads = useRef<{ list: Ticket | null; detail: Ticket | null }>({ list: null, detail: null });
  const selection = useRef(0);
  const running = useRef(false);
  const [view, setView] = useState(() => blankView(identity.current.epoch));
  const current = useCallback((ticket: Ticket) => mounted.current && identity.current.ready
    && ticket.epoch === identity.current.epoch && ticket.lifecycle === lifecycle.current, []);
  const put = useCallback((ticket: Ticket, patch: Partial<ReturnType<typeof blankView>>) => {
    if (!current(ticket)) return;
    setView(previous => ({ ...(previous.epoch === ticket.epoch ? previous : blankView(ticket.epoch)), ...patch }));
  }, [current]);
  const begin = useCallback((kind: "list" | "detail") => {
    reads.current[kind]?.controller.abort();
    if (!mounted.current || !identity.current.ready) return null;
    const ticket = { epoch: identity.current.epoch, lifecycle: lifecycle.current, controller: new AbortController(), deadline: Date.now() + READ_TIMEOUT_MS };
    reads.current[kind] = ticket;
    return ticket;
  }, []);
  const refresh = useCallback(async () => {
    const ticket = begin("list"); if (!ticket) return;
    const { data, error } = await boundedRead(supabase.rpc("list_workspace_research", { _limit: 20, _offset: 0 }).abortSignal(ticket.controller.signal), ticket);
    if (!current(ticket) || reads.current.list !== ticket) return;
    const valid = Array.isArray(data) && data.every(row => row && typeof row === "object"
      && typeof row.id === "string" && typeof row.question === "string" && typeof row.created_at === "string"
      && Number.isInteger(row.source_count) && row.source_count >= 0 && typeof row.is_dossier === "boolean"
      && [row.domain, row.caller, row.stop_reason].every(value => value === null || typeof value === "string")
      && (row.configured === null || typeof row.configured === "boolean"));
    put(ticket, error || !valid ? { rows: null, listError: "Research history is unavailable. Try refreshing it." }
      : { rows: data as ResearchRunRow[], listError: null });
  }, [begin, current, put]);

  useEffect(() => {
    mounted.current = true;
    const pending = reads.current;
    return () => { mounted.current = false; lifecycle.current += 1; pending.list?.controller.abort(); pending.detail?.controller.abort(); };
  }, []);
  useEffect(() => {
    selection.current += 1; running.current = false;
    setView(blankView(identity.current.epoch));
    if (ready) void refresh();
    const pending = reads.current;
    return () => { pending.list?.controller.abort(); pending.detail?.controller.abort(); };
  }, [key, ready, refresh]);

  const open = useCallback(async (runId: string) => {
    selection.current += 1;
    const ticket = begin("detail"); if (!ticket) return;
    put(ticket, { detail: null, detailError: null, detailLoading: true });
    const { data, error } = await boundedRead(supabase.rpc("get_workspace_research_run", { _run_id: runId }).abortSignal(ticket.controller.signal), ticket);
    if (!current(ticket) || reads.current.detail !== ticket) return;
    const detail = error ? null : projectResearchHistoryRun(data, runId);
    put(ticket, { detail, detailLoading: false, detailError: detail ? null : "This run's evidence is unavailable. Return to history and try opening it again." });
  }, [begin, current, put]);
  const close = useCallback(() => {
    selection.current += 1; reads.current.detail?.controller.abort(); reads.current.detail = null;
    setView(previous => ({ ...(previous.epoch === identity.current.epoch ? previous : blankView(identity.current.epoch)), detail: null, detailError: null, detailLoading: false }));
  }, []);

  // Incumbent explicit execution API; Research Home exposes no start control.
  // It keeps its current canonical engine and verifies the exact read projection
  // before claiming persisted. Neither reads nor errors automatically call it.
  const start = useCallback(async (question: string, depth: ResearchDepth) => {
    if (!identity.current.ready || running.current) return;
    const ticket = { epoch: identity.current.epoch, lifecycle: lifecycle.current, controller: new AbortController(), deadline: Date.now() + RUN_TIMEOUT_MS };
    const scope = identity.current.tenant!;
    const actor = identity.current.actor;
    const selected = selection.current;
    running.current = true; put(ticket, { phase: { kind: "running", question, startedAt: Date.now() } });
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!current(ticket)) return;
      if (Date.now() >= ticket.deadline) { put(ticket, { phase: { kind: "failed", reason: "engine_unreachable" } }); return; }
      if (authError || !auth.user?.id || auth.user.id !== actor) { put(ticket, { phase: { kind: "failed", reason: "not_signed_in" } }); return; }
      const { data, error } = await supabase.functions.invoke("paige-deep-research", {
        body: { question, max_hops: DEPTH_TO_HOPS[depth], user_id: auth.user.id, caller: "workspace", persist: true,
          expected_tenant_id: scope, // cross-check only — the engine resolves lineage server-side
        },
      });
      // SCOPE FENCE: already persisted under the old workspace server-side;
      // a late result cannot enter a later actor/workspace/selection generation.
      if (!current(ticket)) return;
      if (Date.now() >= ticket.deadline) { put(ticket, { phase: { kind: "failed", reason: "engine_unreachable" } }); return; }
      if (error || !data || typeof data !== "object") { put(ticket, { phase: { kind: "failed", reason: "engine_unreachable" } }); return; }
      const outcome = data as Record<string, unknown>;
      const coverage = (outcome.coverage ?? {}) as Record<string, unknown>;
      if (coverage.configured === false || coverage.stop_reason === "error") {
        put(ticket, { phase: { kind: "failed", reason: coverage.configured === false ? "search_unconfigured" : "engine_error" } }); return;
      }
      const runId = typeof outcome.run_id === "string" ? outcome.run_id : null;
      let persisted = false;
      // PERSISTENCE READBACK: a visible parent alone never proves complete evidence.
      if (runId && selected === selection.current) {
        const readTicket = begin("detail");
        if (readTicket) {
          readTicket.deadline = Math.min(readTicket.deadline, ticket.deadline);
          const reply = await boundedRead(supabase.rpc("get_workspace_research_run", { _run_id: runId }).abortSignal(readTicket.controller.signal), readTicket);
          if (!current(ticket) || reads.current.detail !== readTicket) return;
          const result = reply.error ? null : projectResearchHistoryRun(reply.data, runId);
          persisted = result?.evidenceComplete === true;
          const unsaved = projectResearchHistoryRun({ ...outcome, id: runId, question: outcome.question ?? question,
            configured: coverage.configured === true, stop_reason: coverage.stop_reason ?? null, caller: "workspace", created_at: new Date().toISOString() }, runId);
          put(ticket, { detail: result ?? unsaved, detailError: null });
          if (persisted) void refresh();
        }
      }
      put(ticket, { phase: { kind: "done", runId, persisted } });
    } catch { put(ticket, { phase: { kind: "failed", reason: "engine_unreachable" } }); }
    finally { if (current(ticket)) running.current = false; }
  }, [begin, current, put, refresh]);
  const reset = useCallback(() => setView(previous => ({ ...previous, phase: { kind: "idle" } })), []);
  // Mask synchronously on identity changes, before effect cleanup/refetch. A→B→A
  // receives a new epoch even when its tenant string is equal again.
  const visible = view.epoch === identity.current.epoch && ready ? view : blankView(identity.current.epoch);
  return { rows: visible.rows, listError: visible.listError, refresh, detail: visible.detail, detailError: visible.detailError,
    detailLoading: visible.detailLoading, open, close, phase: visible.phase, start, reset, runTimeoutMs: RUN_TIMEOUT_MS };
}
