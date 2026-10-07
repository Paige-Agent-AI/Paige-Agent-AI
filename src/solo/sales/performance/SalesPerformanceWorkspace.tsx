import React from "react";
import { SalesPerformance } from "./SalesPerformance";
import { useSalesPerformanceMetrics } from "./useSalesPerformanceMetrics";
import type { SalesPerformanceDestination, SalesPerformanceRangeKey } from "./types";
import { useAnalyticsEvidence } from "../../data/useAnalyticsEvidence";

export function SalesPerformanceWorkspace({ epoch, onNavigate }: { epoch?: string | null; onNavigate(destination: SalesPerformanceDestination): void }) {
  const [range, setRange] = React.useState<SalesPerformanceRangeKey>("month");
  const read = useSalesPerformanceMetrics(epoch, range);
  const stage = useAnalyticsEvidence({ accountEpoch: epoch ?? null, rangeKey: range === "quarter" ? "current_quarter" : range === "year" ? "year_to_date" : "last_30_days", enabled: !!epoch && range !== "week" });
  return <SalesPerformance metrics={read.metrics} phase={read.phase} range={range} onRangeChange={setRange} onRetry={() => { read.retry(); void stage.retry(); }} onNavigate={onNavigate} unavailableKeys={read.unavailableKeys} workspaceEpoch={epoch ?? "unresolved"} stageFunnel={range === "week" ? null : stage.bundle} stageEvidenceRef={stage.evidenceReference} stagePhase={range === "week" ? "unavailable" : stage.loading ? "loading" : stage.isError ? "error" : stage.bundle ? "ready" : "unavailable"} />;
}
