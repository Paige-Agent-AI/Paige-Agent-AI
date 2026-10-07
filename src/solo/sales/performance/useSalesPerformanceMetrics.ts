import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseMetricResult, type MetricRequestIdentity } from "@/lib/analytics/metric-contract";
import type { SalesMetricBundle, SalesPerformancePhase, SalesPerformanceRangeKey } from "./types";

export const SALES_METRIC_KEYS = ["sales.opportunities.created", "sales.opportunities.open_current", "sales.opportunities.won_current_close_date", "sales.opportunities.lost_current_close_date", "sales.pipeline.open_value", "sales.invoices.issued_count", "sales.invoices.issued_amount", "sales.receivables.outstanding_current", "sales.receivables.overdue_current", "sales.cash.recorded_received", "sales.payments.posted_net_allocations"] as const;

/** Date cohorts end at the last completed UTC day; snapshots retain their own as-of semantics. */
export function salesMetricRange(key: SalesPerformanceRangeKey, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  if (key === "week") start.setUTCDate(start.getUTCDate() - 7);
  if (key === "month") start.setUTCDate(start.getUTCDate() - 30);
  if (key === "quarter") start.setUTCDate(start.getUTCDate() - 90);
  if (key === "year") start.setUTCDate(start.getUTCDate() - 365);
  return { start: start.toISOString(), end: end.toISOString() };
}

type ReadState = { identity: string; metrics: SalesMetricBundle[]; phase: SalesPerformancePhase; unavailableKeys: Record<string, string> };
export function useSalesPerformanceMetrics(epoch: string | null | undefined, range: SalesPerformanceRangeKey) {
  const [attempt, setAttempt] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const bounds = salesMetricRange(range);
  const identity = `${epoch ?? "unresolved"}:${range}:${bounds.start}:${bounds.end}:${attempt}:${authRevision}`;
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      current.current = "authentication changed";
      setAuthRevision(value => value + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const [state, setState] = useState<ReadState>({ identity: "", metrics: [], phase: "loading", unavailableKeys: {} });
  useEffect(() => {
    let alive = true;
    let running = false;
    let expiryTimer: number | undefined;
    const isCurrent = () => alive && current.current === identity;
    if (!epoch) { setState({ identity, metrics: [], phase: "unavailable", unavailableKeys: {} }); return; }
    const read = async () => {
      if (running || !isCurrent()) return;
      running = true;
      setState({ identity, metrics: [], phase: "loading", unavailableKeys: {} });
      const metrics: SalesMetricBundle[] = [];
      const unavailableKeys: Record<string, string> = {};
      let denied = false;
      await Promise.all(SALES_METRIC_KEYS.map(async metricKey => {
        const expected: MetricRequestIdentity = { metricKey, metricVersion: "1.0.0", accountEpoch: epoch, rangeKey: range, rangeStart: bounds.start, rangeEnd: bounds.end, dimensions: {} };
        try {
          const issue = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
          const { data, error } = await issue("issue_analytics_evidence_bundle", { p_metric_key: metricKey, p_metric_version: "1.0.0", p_dimensions: {}, p_range_key: range, p_range_start: bounds.start, p_range_end: bounds.end, p_account_epoch: epoch });
          if (error) { if (["42501", "28000"].includes(error.code ?? "")) denied = true; throw error; }
          const result = parseMetricResult(data, expected);
          if (result.owner_department !== "sales") throw new Error("Unexpected metric owner");
          if (result.values && result.values.kind !== "count" && result.values.kind !== "currency_totals") throw new Error("Unexpected Sales value shape");
          if (result.truth_state === "UNAVAILABLE") unavailableKeys[metricKey] = "This metric is not measurable from the available records.";
          const values: SalesMetricBundle["values"] = result.values === null ? null : result.values.kind === "count" || result.values.kind === "currency_totals" ? result.values : null;
          metrics.push({ ...result, owner_department: "sales", values });
        } catch { unavailableKeys[metricKey] = "The verified metric could not be read. Refresh to try again."; }
      }));
      running = false;
      if (isCurrent()) {
        setState({ identity, metrics: denied ? [] : metrics, phase: denied ? "denied" : metrics.length ? "ready" : "error", unavailableKeys });
        window.clearTimeout(expiryTimer);
        if (metrics.length) expiryTimer = window.setTimeout(() => { if (isCurrent()) { setState({ identity, metrics: [], phase: "loading", unavailableKeys: {} }); void read(); } }, Math.max(0, Math.min(...metrics.map(metric => Date.parse(metric.reference_expires_at!))) - Date.now()));
      }
    };
    void read();
    // Refresh issuance rather than retain expired or invalidated evidence. Never display old data while checking.
    const timer = window.setInterval(() => void read(), 60_000);
    const foreground = () => { if (document.visibilityState === "visible") void read(); };
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => { alive = false; window.clearInterval(timer); window.clearTimeout(expiryTimer); window.removeEventListener("online", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, [epoch, range, bounds.start, bounds.end, identity]);
  const visible = state.identity === identity ? state : { metrics: [], phase: "loading" as const, unavailableKeys: {} };
  return { ...visible, retry: () => setAttempt(value => value + 1) };
}
