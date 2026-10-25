// Systems Check read seam (Wave S3 L3 frontend) — the ONE hook the SystemsCheckTile
// reads, scope-aware (§9/§51). It calls the `systems_check_snapshot` RPC, which returns
// the tenant's OR the operator's latest scan run + its findings (joined to the shared
// registry for the human check name + domain + priority) + the tenant's created_at, in
// ONE round-trip (task #122 perf — replaced 2–3 serialized PostgREST queries per mount).
// Optional original-record inspection adds one exact-ID read only when requested;
// it never replaces the latest completed snapshot or supplies execution authority.
//
// SCOPE ISOLATION (§9/§51/§53/§59): the default snapshot RPC receives ONLY scope, never a tenant id.
// The RPC enforces caller-scope IN-BODY (§59): `scope="tenant"` derives the tenant from
// current_user_tenant_id() (the caller's own resolved tenant — a sub-account can never
// widen to the parent, §51 invariant); `scope="operator"` gates on is_platform_operator()
// and reads only the tenant-less (tenant_id IS NULL) operator lens, so a super_admin still
// sees ONLY operator rows, never a tenant's findings. RLS is the real boundary underneath.
// A tenant JWT never requests operator scope — the operator tile only mounts in godMode.
//
// §13 HONESTY: no run yet → { run: null, findings: [] } (the tile renders an honest
// "no scan yet", never a fabricated pass). The RPC is not in the generated Supabase types
// yet (migrations owner-review-gated), so the `(supabase as any).rpc(...)` cast matches
// the repo's pre-typegen convention (rag_documents / rag_retrieval_log).
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { readRecordLinks } from "../../supabase/functions/_shared/paige-turn/record-links";

export type SystemsCheckScope = "tenant" | "operator";
export type FindingStatus = "pass" | "fail" | "skip" | "error";
export type CheckSeverity = "blocking" | "high" | "medium" | "low";

export interface SystemsCheckFinding {
  id: string;
  run_id: string;
  check_id: string;
  status: FindingStatus;
  severity_at_finding: CheckSeverity | null;
  evidence: Record<string, unknown> | null;
  paige_interpretation: string | null;
  paige_drafted_fix: Record<string, unknown> | string | null;
  department_id: string | null;
  resolved_at: string | null;
  resolution: string | null;
  resolution_action_id: string | null;
  created_at: string;
  // joined from the shared registry (§18 one catalog):
  check_name: string | null;
  domain: string | null;
  priority: number | null;
}

export interface SystemsCheckRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  check_count: number | null;
  pass_count: number | null;
  fail_count: number | null;
}

export interface SystemsCheckSnapshot {
  run: SystemsCheckRun | null;
  findings: SystemsCheckFinding[];
  loading: boolean;
  isError: boolean;
  /** True when a tenant has NO run row at all but was created very recently. This is a setup-age
   *  hint, not proof that enqueue succeeded or a check started. Tenant scope only; the E02 console
   *  distinguishes it from the recorded unfinished-run timestamp below.
   *
   *  CORRECTED 2026-09-05. This comment used to justify itself with "the scan writes its run only on
   *  completion", which is FALSE and was load-bearing in the wrong direction — it told the next reader
   *  no in-flight row exists to read. The runner inserts the run row UP FRONT, before the first check,
   *  with check_count already set, and patches only the pass/fail counts at the end
   *  (`_shared/systems-check-runner.ts:277`). Production carries five rows left behind by scans that
   *  crashed between those two moments.
   *
   *  So an in-flight scan IS directly readable — but NO LONGER THROUGH `run`. As of migration
   *  20261213000000 both resolvers skip a run with `completed_at IS NULL`, so a tenant whose only
   *  eligible run is in flight now takes THIS no-run path rather than the has-a-run path, and the
   *  in-flight signal moved to `scanInProgressSince` below. (The sentence this replaces said a run
   *  row existing at all took the surface down the has-a-run path. True when written; false now.
   *  This is the second correction to this block — it was already marked CORRECTED 2026-09-05 for
   *  a different false claim, which is a fair warning about how fast comments about resolver
   *  behaviour go stale.)
   *
   *  What is left for THIS flag is the genuinely narrower gap BEFORE any row lands: enqueue
   *  latency, or an enqueue that failed. Only that window is guessed from tenant.created_at, and
   *  after it the flag falls back to the honest empty state so a failed enqueue never reads as
   *  "running" forever. */
  scanPending: boolean;
  /** When a full sweep is CURRENTLY RUNNING for this scope, its `started_at`. NULL otherwise.
   *
   *  Companion to migration 20261213000000: both resolvers now skip an unfinished run when picking
   *  "the latest full sweep", so `run` below stays on the last COMPLETED sweep instead of emptying
   *  while a scan is in flight. Having hidden the in-flight run from the reading, we owe the caller
   *  its existence rather than letting silence imply nothing is happening (§13).
   *
   *  A TIMESTAMP RATHER THAN A BOOLEAN, deliberately. Two shipped surfaces already say something
   *  about an in-flight run and both need the time to say it — the Solo strip's "A check started
   *  {t} and has not finished" and the sub-account view's Started row. A bare true/false would have
   *  left neither able to keep saying what it already says without someone writing new copy.
   *
   *  Time-bounded server-side (15 minutes): production carries five run rows from scans that
   *  crashed and will never complete, so an unbounded test would report "running" forever on those.
   *
   *  The E02 native console reads this timestamp separately from the completed result. It says
   *  what the latest read reported, not that a worker is continuously alive or a scan completed.
   *  Distinct from `scanPending`, which is only a recent-workspace hint before any row exists. */
  scanInProgressSince: string | null;
  refresh: () => void;
  /** Optional original-record inspection, separate from current health and action authority. */
  recordedFinding?: RecordedFindingRead;
}

export type RecordedFindingRead =
  | { state: "not_requested" | "unavailable" | "loading" | "error" }
  | { state: "ready"; finding: SystemsCheckFinding; run: Pick<SystemsCheckRun, "id" | "started_at" | "completed_at"> };

// How long after tenant creation we treat "no run yet" as "first scan in progress" rather than the
// terminal empty state. The onboarding scan fires on creation (enqueue → edge fn → run row); this
// window comfortably covers the enqueue + scan latency without claiming progress indefinitely.
const FIRST_SCAN_PENDING_WINDOW_MS = 10 * 60 * 1000;

interface RawFinding {
  id: string;
  run_id: string;
  check_id: string;
  status: FindingStatus;
  severity_at_finding: CheckSeverity | null;
  evidence: Record<string, unknown> | null;
  paige_interpretation: string | null;
  paige_drafted_fix: Record<string, unknown> | string | null;
  department_id: string | null;
  resolved_at: string | null;
  resolution: string | null;
  resolution_action_id: string | null;
  created_at: string;
  reg?: { check_name?: string | null; domain?: string | null; priority?: number | null } | null;
}

function findingFromRow(r: RawFinding): SystemsCheckFinding {
  return {
    id: r.id,
    run_id: r.run_id,
    check_id: r.check_id,
    status: r.status,
    severity_at_finding: r.severity_at_finding,
    evidence: r.evidence,
    paige_interpretation: r.paige_interpretation,
    paige_drafted_fix: r.paige_drafted_fix,
    department_id: r.department_id,
    resolved_at: r.resolved_at,
    resolution: r.resolution,
    resolution_action_id: r.resolution_action_id,
    created_at: r.created_at,
    check_name: r.reg?.check_name ?? null,
    domain: r.reg?.domain ?? null,
    priority: r.reg?.priority ?? null,
  };
}

interface RecordedRow extends RawFinding {
  tenant_id: string;
  run: Pick<SystemsCheckRun, "id" | "started_at" | "completed_at"> & { tenant_id: string };
}
const readableTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function useSystemsCheck(scope: SystemsCheckScope, options?: { findingId?: string | null }): SystemsCheckSnapshot {
  const { activeTenantId, activeUserId, accountContextStatus, activeTenant } = useTenantContext();
  const qc = useQueryClient();
  const scopeKey = scope === "tenant" ? (activeTenantId ?? "none") : "operator";

  // Tenant reads need a resolved tenant; the operator read is tenant-less (RLS-gated).
  const enabled = scope === "operator" || !!activeTenantId;

  const query = useQuery({
    queryKey: ["systems_check", scope, scopeKey],
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    // Navigation re-mounts no longer re-pay the round-trip within the refresh window; the RPC
    // is the single source and the 60s refetchInterval keeps it fresh (task #122 perf).
    staleTime: 60_000,
    queryFn: async (): Promise<{ run: SystemsCheckRun | null; findings: SystemsCheckFinding[]; tenantCreatedAt?: string | null; scanInProgressSince: string | null }> => {
      // ONE round-trip: the systems_check_snapshot RPC merges the former Query A (latest run) +
      // Query B (findings + registry embed) + Query C (tenant created_at) into a single jsonb.
      // §59 caller-scope is enforced IN-BODY (tenant derived from current_user_tenant_id(),
      // operator gated on is_platform_operator()) — the client passes only the scope, never a
      // tenant id. The returned shape is byte-for-byte the same rows the three queries produced.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("systems_check_snapshot", { p_scope: scope });
      if (error) throw error;

      const snap = (data ?? {}) as {
        run?: SystemsCheckRun | null;
        findings?: RawFinding[] | null;
        tenant_created_at?: string | null;
        scan_in_progress?: string | null;   // the in-flight run's started_at, or null
      };

      const run = snap.run ?? null;
      const findings = ((snap.findings ?? []) as RawFinding[]).map(findingFromRow);

      // tenant_created_at is only populated (and only consumed) when there is no run yet, in
      // tenant scope — it drives scanPending below. Operator scope always returns null.
      // `?? null` is the honest default, not a convenience: a database that has not yet taken
      // 20261213000000 omits the key entirely, and absence of evidence that a scan is running must
      // never render as a claim that one is.
      return {
        run,
        findings,
        tenantCreatedAt: snap.tenant_created_at ?? null,
        scanInProgressSince: snap.scan_in_progress ?? null,
      };
    },
  });

  // No existing caller opts in. This exact-record read reuses the original tables'
  // authenticated SELECT/RLS; client filters only narrow, never grant, access.
  // It does not use or widen the current-only signal-reference/approval contracts.
  const recordRequested = options?.findingId !== undefined && options.findingId !== null;
  const recordId = readRecordLinks([{ destination: "systems_check", record_id: options?.findingId }])[0]?.record_id;
  const recordEnabled = scope === "tenant" && accountContextStatus === "ready"
    && !!activeUserId && !!activeTenantId && activeTenant?.id === activeTenantId
    && activeTenant.account_type === "standalone" && !!recordId;
  const recordedQuery = useQuery({
    queryKey: ["systems_check", scope, scopeKey, "recorded", activeUserId ?? "none", recordId ?? "none"],
    enabled: recordEnabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: async ({ signal }) => {
      // These source tables are not generated yet, as with the original RPC above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("paige_systems_check_finding")
        .select("id,tenant_id,run_id,check_id,status,severity_at_finding,evidence,paige_interpretation,paige_drafted_fix,department_id,resolved_at,resolution,resolution_action_id,created_at,reg:paige_systems_check_registry(check_name,domain,priority),run:paige_systems_check_run!inner(id,tenant_id,started_at,completed_at)")
        .eq("id", recordId).eq("tenant_id", activeTenantId).eq("run.tenant_id", activeTenantId)
        .abortSignal(signal).maybeSingle();
      if (error) throw new Error("Recorded check could not be read");
      const row = data as RecordedRow | null;
      if (!row || row.id !== recordId || row.tenant_id !== activeTenantId
        || !row.run || Array.isArray(row.run) || row.run.tenant_id !== activeTenantId
        || row.run.id !== row.run_id || !["pass", "fail", "skip", "error"].includes(row.status)
        || !readableTimestamp(row.created_at) || !readableTimestamp(row.run.started_at)
        || (row.run.completed_at !== null && !readableTimestamp(row.run.completed_at))) return null;
      return {
        finding: findingFromRow(row),
        run: { id: row.run.id, started_at: row.run.started_at, completed_at: row.run.completed_at },
      };
    },
  });
  const recordedFinding: RecordedFindingRead = !recordRequested ? { state: "not_requested" }
    : !recordEnabled ? { state: "unavailable" }
      : recordedQuery.isError ? { state: "error" }
        : recordedQuery.isFetching || recordedQuery.isLoading ? { state: "loading" }
          : recordedQuery.data ? { state: "ready", ...recordedQuery.data } : { state: "unavailable" };

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["systems_check", scope, scopeKey] });
  }, [qc, scope, scopeKey]);

  const run = query.data?.run ?? null;
  const tenantCreatedAt = query.data?.tenantCreatedAt ?? null;
  // "First scan in progress" only when: tenant scope, no run row yet, the load succeeded (not an
  // error masquerading as empty), and the tenant was created inside the pending window. §13: honest —
  // after the window, or on any error, this is false and the tile shows the terminal empty state.
  const scanPending =
    scope === "tenant" &&
    !run &&
    !query.isError &&
    !!tenantCreatedAt &&
    Date.now() - new Date(tenantCreatedAt).getTime() < FIRST_SCAN_PENDING_WINDOW_MS;

  return {
    run,
    findings: query.data?.findings ?? [],
    loading: enabled && query.isLoading,
    isError: query.isError,
    scanPending,
    scanInProgressSince: query.data?.scanInProgressSince ?? null,
    refresh,
    ...(options ? { recordedFinding } : {}),
  };
}
