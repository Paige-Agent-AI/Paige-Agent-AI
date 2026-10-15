import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { parseMetricResult, type MetricResult } from "@/lib/analytics/metric-contract";

export const SETTINGS_METRICS = [
  "business.active_clients_current", "business.onboarding_current", "business.lifecycle_current",
  "business.retention", "business.profitability", "business.nps",
  "operations.systems_check_latest", "operations.unresolved_findings_current",
  "operations.workflows_active_current", "operations.recorded_workflow_runs",
  "operations.recorded_workflow_activity", "operations.current_system_exceptions",
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
  const [state, setState] = useState<{ scope: string; loading: boolean; reads: MetricReads; permissionDenied?: boolean }>({ scope: "", loading: true, reads: {} });
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${rangeKey}:${revision}`;
  useEffect(() => {
    const token = ++epoch.current;
    let cancelled = false;
    let running = false;
    let denied = false;
    let generation = 0;
    let disconnected = false;
    let timer: ReturnType<typeof setTimeout>;
    let validated: MetricReads = {};
    const current = () => !cancelled && epoch.current === token;
    setState({ scope, loading: true, reads: {} });
    if (loading || accountContextStatus !== "ready" || !activeUserId || !activeTenantId) {
      if (!loading) setState({ scope, loading: false, reads: {} });
      return () => { cancelled = true; };
    }
    // Bounds express the requested interval only; the server resolves account and role.
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (rangeKey === "week" ? 7 : rangeKey === "month" ? 30 : 90));
    const identity = (metricKey: SettingsMetricKey) => ({ metricKey, metricVersion: "1.0.0", accountEpoch: activeTenantId, rangeKey, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), dimensions: {} });
    const rpc = (name: string, args: Record<string, unknown>) => (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }> }).rpc(name, args);
    const issue = async (metricKey: SettingsMetricKey, run: number) => {
      const { data, error } = await rpc("issue_analytics_evidence_bundle", {
        p_metric_key: metricKey, p_metric_version: "1.0.0", p_dimensions: {}, p_range_key: rangeKey,
        p_range_start: start.toISOString(), p_range_end: end.toISOString(), p_account_epoch: activeTenantId,
      });
      if (error?.code === "42501" && current() && run === generation) {
        denied = true;
        validated = {};
        setState({ scope, loading: false, reads: {}, permissionDenied: true });
      }
      if (error) throw new Error("Read refused");
      return parseMetricResult(data, identity(metricKey));
    };
    const load = async (revalidate = false) => {
      if (!current() || running || denied || disconnected) return;
      const run = ++generation;
      const currentRun = () => current() && run === generation;
      clearTimeout(timer);
      running = true;
      // Values and portaled evidence disappear before any authorization/freshness check.
      setState({ scope, loading: true, reads: {} });
      const reads: MetricReads = {};
      // Bounded concurrency prevents a large refresh from monopolizing the connection.
      for (let offset = 0; offset < SETTINGS_METRICS.length; offset += 4) {
        if (!currentRun() || denied) break;
        await Promise.all(SETTINGS_METRICS.slice(offset, offset + 4).map(async metricKey => {
          try {
            let result: MetricResult;
            const previous = validated[metricKey]?.result;
            if (revalidate && previous && Date.parse(previous.reference_expires_at) > Date.now()) {
              const { data, error } = await rpc("resolve_analytics_evidence_reference", { p_evidence_ref: previous.evidence_ref });
              if (!currentRun() || denied) return;
              // Resolver refusal is deliberately ambiguous (expired, revoked, changed or unauthorized).
              // Only the issuer can establish whether the original scope still permits a new read.
              if (error?.code === "42501") result = await issue(metricKey, run);
              else {
                if (error) throw new Error("Evidence check failed");
                result = parseMetricResult(data, identity(metricKey));
                if (result.evidence_ref !== previous.evidence_ref || result.source_revision_ref !== previous.source_revision_ref) throw new Error("Evidence changed");
              }
            } else result = await issue(metricKey, run);
            if (currentRun() && !denied) reads[metricKey] = { result, error: false };
          } catch { reads[metricKey] = { result: null, error: true }; }
        }));
      }
      if (!currentRun()) return;
      running = false;
      if (denied) return;
      validated = reads;
      setState({ scope, loading: false, reads });
      const deadlines = Object.values(reads).flatMap(read => read?.result ? [Date.parse(read.result.reference_expires_at) - Date.now()] : []);
      timer = setTimeout(() => { void load(true); }, Math.max(0, Math.min(60_000, ...deadlines)));
    };
    const wake = () => { if (!document.hidden) void load(true); };
    const offline = () => { disconnected = true; ++generation; running = false; validated = {}; clearTimeout(timer); if (current()) setState({ scope, loading: false, reads: {} }); };
    const reconnect = () => { disconnected = false; void load(true); };
    window.addEventListener("focus", wake);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", wake);
    void load();
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener("focus", wake); window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", wake); };
  }, [activeTenantId, activeUserId, loading, accountContextStatus, rangeKey, revision, scope]);
  // Synchronous identity gate: old values disappear before the new effect executes.
  const ownsScope = state.scope === scope && accountContextStatus === "ready" && !loading;
  const reads: MetricReads = ownsScope ? Object.fromEntries(Object.entries(state.reads).map(([key, read]) => [key, read?.result && Date.parse(read.result.reference_expires_at) <= Date.now() ? { result: null, error: true } : read])) : {};
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  return { reads, permissionDenied: ownsScope && state.permissionDenied === true, loading: loading || accountContextStatus === "resolving" || state.scope !== scope || state.loading, refresh, scope };
}
