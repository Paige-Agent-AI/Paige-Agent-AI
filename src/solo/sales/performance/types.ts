import type { AnalyticsEvidenceBundle } from "../../data/useAnalyticsEvidence";

export type SalesPerformanceRangeKey = "week" | "month" | "quarter" | "year";
export type SalesMetricTruth = "LIVE" | "PARTIAL" | "UNAVAILABLE";
export interface SalesCurrencyValue { currency: string; amount_minor: string; record_count: number }
export interface SalesMetricBundle {
  metric_key: string;
  metric_version: string;
  owner_department: "sales";
  label: string;
  definition: string;
  formula: string;
  range: { start: string; end: string; bounds: string; timezone: string; semantics: string };
  dimensions: Record<string, unknown>;
  values: { kind: "count"; count: number } | { kind: "currency_totals"; by_currency: SalesCurrencyValue[]; breakdown: (SalesCurrencyValue & { source: string })[] } | null;
  unit: string;
  source_refs: string[];
  as_of: string;
  freshness: { queried_at: string; source_updated_through: string | null };
  coverage: { state: string; candidate_count: number; contributing_count: number; excluded_count: number; zero_value_count?: number; test_affected_obligation_count?: number; owner_imported_count?: number };
  exclusions: { reason: string; count: number }[];
  truth_state: SalesMetricTruth;
  caveats: string[];
  source_revision_ref: string;
  evidence_ref: string | null;
  evidence_state?: string;
  reference_expires_at?: string;
}
export type SalesPerformancePhase = "loading" | "ready" | "error" | "denied" | "unavailable";
export interface SalesPerformanceDestination { tab: "opportunities" | "payments"; query?: string }
export interface SalesPerformanceProps {
  metrics: SalesMetricBundle[];
  phase: SalesPerformancePhase;
  range: SalesPerformanceRangeKey;
  onRangeChange(range: SalesPerformanceRangeKey): void;
  onRetry(): void;
  onNavigate(destination: SalesPerformanceDestination): void;
  onAsk?: (question: string) => void;
  unavailableKeys?: Record<string, string>;
  stageFunnel?: AnalyticsEvidenceBundle | null;
  stageEvidenceRef?: string | null;
  stagePhase?: SalesPerformancePhase;
  workspaceEpoch: string;
}
