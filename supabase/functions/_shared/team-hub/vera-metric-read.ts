// EXP02's SAME VERA private-business-DM consumer. The original INT340 reader,
// issuer and resolver own authority, metric definitions, calculations and evidence.
// Unmounted foundation: the existing Team Hub turn owns offers, posting and receipts.
import { BUSINESS_METRIC_TOOLS, readBusinessMetric, type MetricCaller, type MetricReadOutcome } from "../analytics-metrics/read.ts";
import { readRecordLinks, type ReadRecordLink } from "../paige-turn/record-links.ts";

export const VERA_METRIC_READ_TOOL = "read_business_metric";
export const VERA_METRIC_READ_TIMEOUT_MS = 5000;
const DEFINITION = BUSINESS_METRIC_TOOLS[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Server-resolved original accepted turn scope; never model/request-body fields. */
export type VeraMetricScope = Readonly<{
  agent: string; where: string; audience: string; tenantId: string; actorId: string;
  workspaceAdmin: boolean; storedTools: readonly string[] | null;
}>;
export type VeraMetricDeps = Readonly<{
  caller: MetricCaller;
  /** Original host re-resolves current actor/business/DM/stored scope and authority. */
  isCurrent: (scope: VeraMetricScope) => Promise<boolean>;
  /** Acknowledgment from the host's existing read marker, never a new ACT receipt. */
  recordRead: () => Promise<boolean>;
  signal?: AbortSignal;
}>;
export type VeraMetricRead = Readonly<{
  model: MetricReadOutcome;
  recordLinks: readonly ReadRecordLink[];
  revalidate: () => Promise<boolean>;
}>;
function eligible(s: VeraMetricScope): boolean {
  return s.agent === "vera" && s.where === "agent_dm" && s.audience === "business_team"
    && s.workspaceAdmin === true && UUID.test(s.tenantId) && UUID.test(s.actorId)
    && Array.isArray(s.storedTools) && s.storedTools.includes(VERA_METRIC_READ_TOOL);
}
export function veraMetricReadTools(scope: VeraMetricScope): (typeof DEFINITION)[] {
  return eligible(scope) ? [DEFINITION] : [];
}
const withheld = (): VeraMetricRead => ({
  model: { status: "unavailable", message: "I couldn't verify this measurement for your current workspace. Its value is unavailable here." },
  recordLinks: [], revalidate: async () => false,
});
/** No new reader or retry engine: bounded original reads, then the SAME original evidence reference. */
export async function readVeraMetric(scopeInput: VeraMetricScope, deps: VeraMetricDeps, input: unknown): Promise<VeraMetricRead> {
  try {
    const scope: VeraMetricScope = Object.freeze({ agent: scopeInput.agent, where: scopeInput.where,
      audience: scopeInput.audience, tenantId: scopeInput.tenantId, actorId: scopeInput.actorId,
      workspaceAdmin: scopeInput.workspaceAdmin,
      storedTools: Array.isArray(scopeInput.storedTools) ? Object.freeze([...scopeInput.storedTools]) : null });
    if (!eligible(scope) || deps.signal?.aborted) return withheld();
    const originalArgs = structuredClone(input);
    const bounded = async (args: unknown, allowIssue: boolean): Promise<MetricReadOutcome | null> => {
      const lifetime = { retired: false }, expires = performance.now() + VERA_METRIC_READ_TIMEOUT_MS;
      const stopped = () => lifetime.retired || deps.signal?.aborted || performance.now() >= expires;
      let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
      const deadline = new Promise<null>(resolve => {
        abort = () => { lifetime.retired = true; resolve(null); };
        timer = setTimeout(abort, VERA_METRIC_READ_TIMEOUT_MS);
        deps.signal?.addEventListener("abort", abort, { once: true });
        if (deps.signal?.aborted) abort();
      });
      const work = async (): Promise<MetricReadOutcome | null> => {
        if (stopped() || await deps.isCurrent(scope) !== true || stopped()) return null;
        const caller: MetricCaller = { rpc: async (name, nativeArgs) => {
          if (stopped() || !["current_user_tenant_id", "issue_analytics_evidence_bundle", "resolve_analytics_evidence_reference"].includes(name)
            || (!allowIssue && name === "issue_analytics_evidence_bundle")) return { data: null, error: { code: "42501" } };
          const result = await deps.caller.rpc(name, nativeArgs);
          return stopped() ? { data: null, error: { code: "42501" } } : result;
        } };
        const result = await readBusinessMetric(caller, { tenantId: scope.tenantId }, args);
        if (stopped() || await deps.isCurrent(scope) !== true || stopped()) return null;
        if (result.status === "available" && await deps.recordRead() !== true) return null;
        if (stopped() || await deps.isCurrent(scope) !== true || stopped()) return null;
        return structuredClone(result);
      };
      try { return await Promise.race([work(), deadline]); }
      catch { return null; }
      finally {
        lifetime.retired = true;
        if (timer !== undefined) clearTimeout(timer);
        if (abort) deps.signal?.removeEventListener("abort", abort);
      }
    };
    const first = await bounded(originalArgs, true);
    if (!first) return withheld();
    if (first.status !== "available" || !first.metric) return {
      model: first, recordLinks: [], revalidate: async () => {
        // A bounded clarification contains no measurement. The host still checks its turn before posting.
        if (first.status !== "needs_input") return false;
        const current = await bounded(originalArgs, false);
        return current?.status === "needs_input";
      },
    };
    const metric = first.metric, identity = JSON.stringify(metric);
    // These fields come only from the ORIGINAL verified native result, never from model text.
    const exactReference = Object.freeze({ metric_key: metric.metric_key, period: "custom",
      range_key: metric.range.key, range_start: metric.range.start, range_end: metric.range.end,
      evidence_ref: metric.evidence_ref });
    return { model: structuredClone(first),
      recordLinks: readRecordLinks([{ destination: "executive", record_id: null }]),
      revalidate: async () => {
        const current = await bounded(exactReference, false);
        return current?.status === "available" && JSON.stringify(current.metric) === identity;
      },
    };
  } catch { return withheld(); }
}
