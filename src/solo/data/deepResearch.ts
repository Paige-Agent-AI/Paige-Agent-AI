import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

export type ResearchSourceRow = {
  index: number;
  url: string;
  title: string | null;
  snippet: string | null;
  reliability_score: number | null;
  tier: string | null;
  reliability: string | null;
  published_at: string | null;
  fetched_at: string | null;
  excluded: boolean | null;
};

export type ResearchRunDetail = {
  id: string;
  question: string;
  domain: string | null;
  caller: string | null;
  stop_reason: string | null;
  configured: boolean | null;
  findings: Array<{ text: string; citations: number[]; confidence: string; unverifiedFields?: string[] }> | null;
  coverage: {
    stop_reason?: string; hops_used?: number; searches?: number; reads?: number;
    note?: string; configured?: boolean; unverified_notes?: string[];
  } | null;
  entity_profile: unknown | null;
  created_at: string;
  sources: ResearchSourceRow[];
};

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

export function useDeepResearch(activeTenantId: string | null) {
  const [rows, setRows] = useState<ResearchRunRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResearchRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>({ kind: "idle" });
  const scopeRef = useRef<string | null>(activeTenantId);
  scopeRef.current = activeTenantId;

  const refresh = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope) return;
    const { data, error } = await supabase.rpc("list_workspace_research", { _limit: 20, _offset: 0 });
    if (scopeRef.current !== scope) return; // the workspace changed mid-flight — discard
    if (error) { setListError(error.message); return; }
    setListError(null);
    setRows((data ?? []) as ResearchRunRow[]);
  }, []);

  useEffect(() => {
    setRows(null); setListError(null); setDetail(null); setDetailError(null);
    setPhase((p) => (p.kind === "running" ? { kind: "failed", reason: "workspace_changed" } : p));
    if (activeTenantId) void refresh();
    else setRows([]);
  }, [activeTenantId, refresh]);

  const open = useCallback(async (runId: string) => {
    const scope = scopeRef.current;
    if (!scope) return;
    setDetailError(null);
    const { data, error } = await supabase.rpc("get_workspace_research_run", { _run_id: runId });
    if (scopeRef.current !== scope) return; // foreign/late for the OLD view
    if (error) { setDetailError(error.message); return; }
    setDetail((data ?? null) as unknown as ResearchRunDetail | null);
  }, []);

  const close = useCallback(() => { setDetail(null); setDetailError(null); }, []);

  /**
   * Start research through the canonical engine. Truthful runtime (ruling §5):
   * the engine emits no per-step states, so the UI shows elapsed time only —
   * never fabricated "Searching…" steps. After success, the run is proven
   * PERSISTED through the governed read RPC before "saved" is claimed (ruling
   * §6); a result whose readback fails renders with the honest not-saved state.
   */
  const start = useCallback(async (question: string, depth: ResearchDepth) => {
    const scope = scopeRef.current;
    if (!scope || phase.kind === "running") return;
    setPhase({ kind: "running", question, startedAt: Date.now() });

    const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
    if (!userId) {
      setPhase({ kind: "failed", reason: "not_signed_in" });
      return;
    }

    let outcome: Record<string, unknown> | null = null;
    let invokeError: unknown = null;
    try {
      const { data, error } = await supabase.functions.invoke("paige-deep-research", {
        body: {
          question,
          max_hops: DEPTH_TO_HOPS[depth],
          user_id: userId,
          caller: "workspace",
          persist: true,
          expected_tenant_id: scope, // cross-check only — the engine resolves lineage server-side
        },
      });
      if (error) invokeError = error;
      outcome = (data ?? null) as Record<string, unknown> | null;
    } catch (e) {
      invokeError = e;
    }

    // SCOPE FENCE: if the active workspace changed while the engine ran, the
    // result belongs to the OLD workspace. Discard it from THIS view entirely —
    // it is already persisted under the old workspace server-side (the engine
    // resolved that lineage at creation), and rendering it here would leak A's
    // research into B's home.
    if (scopeRef.current !== scope) {
      setPhase({ kind: "failed", reason: "workspace_changed" });
      return;
    }

    if (invokeError || !outcome) {
      setPhase({ kind: "failed", reason: "engine_unreachable" });
      return;
    }
    const coverage = (outcome.coverage ?? {}) as Record<string, unknown>;
    if (coverage.configured === false) {
      setPhase({ kind: "failed", reason: "search_unconfigured" });
      return;
    }

    const runId = typeof outcome.run_id === "string" ? outcome.run_id : null;
    // PERSISTENCE READBACK: prove the row exists in THIS workspace through the
    // governed RPC before claiming saved. The engine response alone is not the
    // proof (ruling §6).
    let persisted = false;
    if (runId) {
      const { data } = await supabase.rpc("get_workspace_research_run", { _run_id: runId });
      if (scopeRef.current !== scope) { setPhase({ kind: "failed", reason: "workspace_changed" }); return; }
      persisted = !!data;
      if (persisted) {
        setDetail(data as unknown as ResearchRunDetail);
        void refresh();
      }
    }
    setPhase({ kind: "done", runId, persisted });
  }, [phase.kind, refresh]);

  const reset = useCallback(() => setPhase({ kind: "idle" }), []);

  return { rows, listError, refresh, detail, detailError, open, close, phase, start, reset, runTimeoutMs: RUN_TIMEOUT_MS };
}
