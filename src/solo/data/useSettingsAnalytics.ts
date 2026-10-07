import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { parseMetricResult, type MetricResult } from "@/lib/analytics/metric-contract";

export const SETTINGS_METRICS = [
  "business.active_clients_current", "business.onboarding_current", "business.lifecycle_current",
  "business.retention", "business.profitability", "business.nps",
  "operations.systems_check_latest", "operations.unresolved_findings_current",
  "operations.workflows_active_current", "operations.recorded_workflow_runs",
  "team.active_members_current", "team.role_distribution_current", "team.performance_scorecards",
  "ai.recorded_model_requests", "ai.recorded_model_requests_daily", "ai.recorded_tokens",
  "ai.estimated_model_cost", "ai.recorded_latency", "ai.recorded_browser_calls", "ai.voice_consumption",
] as const;
export type SettingsMetricKey = typeof SETTINGS_METRICS[number];
export type MetricRead = { result: MetricResult | null; error: boolean };
export type MetricReads = Partial<Record<SettingsMetricKey, MetricRead>>;
export function useSettingsAnalytics(rangeKey: "week" | "month" | "quarter") {
  const { activeTenantId, activeUserId, loading, accountContextStatus } = useTenantContext();
  const epoch = useRef(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ scope: string; loading: boolean; reads: MetricReads }>({ scope: "", loading: true, reads: {} });
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${rangeKey}:${revision}`;
  useEffect(() => {
    const token = ++epoch.current;
    let cancelled = false;
    setState({ scope, loading: true, reads: {} });
    if (loading || accountContextStatus !== "ready" || !activeUserId || !activeTenantId) {
      if (!loading) setState({ scope, loading: false, reads: {} });
      return () => { cancelled = true; };
    }
    // Bounds express the requested interval only; the server resolves account and role.
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (rangeKey === "week" ? 7 : rangeKey === "month" ? 30 : 90));
    const load = async () => {
      const reads: MetricReads = {};
      // Bounded concurrency prevents a large refresh from monopolizing the connection.
      for (let offset = 0; offset < SETTINGS_METRICS.length; offset += 4) {
        if (cancelled || epoch.current !== token) return;
        await Promise.all(SETTINGS_METRICS.slice(offset, offset + 4).map(async metricKey => {
          try {
            // Additive RPC signature is not yet in generated database types.
            const { data, error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc("issue_analytics_evidence_bundle", {
              p_metric_key: metricKey, p_metric_version: "1.0.0", p_dimensions: {}, p_range_key: rangeKey,
              p_range_start: start.toISOString(), p_range_end: end.toISOString(), p_account_epoch: activeTenantId,
            });
            if (error) throw new Error("Read refused");
            reads[metricKey] = { result: parseMetricResult(data, { metricKey, metricVersion: "1.0.0", accountEpoch: activeTenantId, rangeKey, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), dimensions: {} }), error: false };
          } catch { reads[metricKey] = { result: null, error: true }; }
        }));
      }
      if (!cancelled && epoch.current === token) setState({ scope, loading: false, reads });
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTenantId, activeUserId, loading, accountContextStatus, rangeKey, revision, scope]);
  // Synchronous identity gate: old values disappear before the new effect executes.
  const ownsScope = state.scope === scope && accountContextStatus === "ready" && !loading;
  const reads = useMemo(() => ownsScope ? state.reads : {}, [ownsScope, state.reads]);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  return { reads, loading: loading || accountContextStatus === "resolving" || state.scope !== scope || state.loading, refresh, scope };
}
