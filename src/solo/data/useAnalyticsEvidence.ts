import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AnalyticsTruthState = "LIVE" | "PARTIAL" | "UNAVAILABLE";
export type AnalyticsRangeKey = "last_30_days" | "current_quarter" | "year_to_date";

export interface AnalyticsEvidenceStage {
  stage_key: string;
  label: string;
  stage_type: "open" | "won" | "lost";
  order: number;
  count: number;
}

export interface AnalyticsEvidenceBundle {
  metric: {
    id: "sales_funnel.created_deals_by_current_stage";
    label: string;
    definition: string;
    formula: string;
    version: "1.0.0";
  };
  range: { key: AnalyticsRangeKey; start: string; end: string };
  source_references: Array<{ source: string; boundary: string }>;
  contributing_record_count: number;
  coverage: {
    state: "complete" | "partial" | "unavailable";
    candidate_count: number;
    contributing_count: number;
    excluded_count: number;
  };
  exclusions: Array<{ reason: string; count: number }>;
  freshness: { queried_at: string; source_updated_through: string | null };
  truth_state: AnalyticsTruthState;
  account_epoch_ref: string;
  source_revision_ref: string;
  reference_expires_at: string;
  values: {
    kind: "sales_funnel_stages";
    pipeline_label: string | null;
    stages: AnalyticsEvidenceStage[];
  };
  caveats: string[];
}

interface AnalyticsEvidenceResponse {
  evidence_ref: string;
  bundle: AnalyticsEvidenceBundle;
}

const METRIC_ID = "sales_funnel.created_deals_by_current_stage" as const;
const REF_PATTERN = /^aneb_v1_[0-9a-f]{64}$/;
const issueEvidenceRpc = supabase.rpc.bind(supabase) as unknown as (
  functionName: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const isBoundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

function isSafeBundle(value: unknown): value is AnalyticsEvidenceBundle {
  if (!isRecord(value) || !isRecord(value.metric) || !isRecord(value.range) || !isRecord(value.coverage)
    || !isRecord(value.freshness) || !isRecord(value.values)) return false;
  const stages = value.values.stages;
  const sources = value.source_references;
  const exclusions = value.exclusions;
  const candidateCount = Number(value.coverage.candidate_count);
  const contributingCount = Number(value.coverage.contributing_count);
  const excludedCount = Number(value.coverage.excluded_count);
  const truthState = String(value.truth_state);
  const coverageState = String(value.coverage.state);
  const truthMatchesCoverage = (truthState === "LIVE" && coverageState === "complete" && excludedCount === 0)
    || (truthState === "PARTIAL" && coverageState === "partial" && excludedCount > 0)
    || (truthState === "UNAVAILABLE" && coverageState === "unavailable");
  const stageCountTotal = Array.isArray(stages)
    ? stages.reduce((total, stage) => total + (isRecord(stage) && Number.isSafeInteger(stage.count) ? Number(stage.count) : Number.NaN), 0)
    : Number.NaN;
  const exclusionCountTotal = Array.isArray(exclusions)
    ? exclusions.reduce((total, exclusion) => total + (isRecord(exclusion) && Number.isSafeInteger(exclusion.count) ? Number(exclusion.count) : Number.NaN), 0)
    : Number.NaN;
  return value.metric.id === METRIC_ID
    && value.metric.version === "1.0.0"
    && isBoundedText(value.metric.label, 120)
    && isBoundedText(value.metric.definition, 600)
    && isBoundedText(value.metric.formula, 600)
    && ["last_30_days", "current_quarter", "year_to_date"].includes(String(value.range.key))
    && isTimestamp(value.range.start)
    && isTimestamp(value.range.end)
    && Date.parse(value.range.start) < Date.parse(value.range.end)
    && ["LIVE", "PARTIAL", "UNAVAILABLE"].includes(String(value.truth_state))
    && /^ae_v1_[0-9a-f]{64}$/.test(String(value.account_epoch_ref))
    && /^sr_v1_[0-9a-f]{64}$/.test(String(value.source_revision_ref))
    && isTimestamp(value.reference_expires_at)
    && Date.parse(value.reference_expires_at) > Date.now()
    && Number.isSafeInteger(value.contributing_record_count)
    && Number(value.contributing_record_count) >= 0
    && Number.isSafeInteger(value.coverage.candidate_count)
    && Number.isSafeInteger(value.coverage.contributing_count)
    && Number.isSafeInteger(value.coverage.excluded_count)
    && candidateCount >= 0
    && contributingCount >= 0
    && excludedCount >= 0
    && candidateCount === contributingCount + excludedCount
    && Number(value.contributing_record_count) === contributingCount
    && ["complete", "partial", "unavailable"].includes(String(value.coverage.state))
    && truthMatchesCoverage
    && (truthState !== "UNAVAILABLE" || contributingCount === 0)
    && isTimestamp(value.freshness.queried_at)
    && (value.freshness.source_updated_through === null || isTimestamp(value.freshness.source_updated_through))
    && Array.isArray(sources)
    && sources.length === 3
    && new Set(sources.map((source) => isRecord(source) ? source.source : null)).size === 3
    && ["public.deals", "public.pipelines", "public.pipeline_stages"].every((sourceName) =>
      sources.some((source) => isRecord(source) && source.source === sourceName))
    && sources.every((source) => isRecord(source)
      && isBoundedText(source.source, 80)
      && isBoundedText(source.boundary, 300))
    && Array.isArray(exclusions)
    && exclusions.length <= 10
    && exclusions.every((exclusion) => isRecord(exclusion)
      && isBoundedText(exclusion.reason, 240)
      && Number.isSafeInteger(exclusion.count)
      && Number(exclusion.count) >= 0)
    && exclusionCountTotal === excludedCount
    && Array.isArray(value.caveats)
    && value.caveats.length > 0
    && value.caveats.length <= 10
    && value.caveats.every((caveat) => isBoundedText(caveat, 500))
    && value.values.kind === "sales_funnel_stages"
    && (value.values.pipeline_label === null || isBoundedText(value.values.pipeline_label, 80))
    && Array.isArray(stages)
    && stages.length <= 100
    && (truthState !== "UNAVAILABLE" || stages.length === 0)
    && new Set(stages.map((stage) => isRecord(stage) ? stage.stage_key : null)).size === stages.length
    && stages.every((stage) => isRecord(stage)
      && /^stage_[1-9][0-9]*$/.test(String(stage.stage_key))
      && isBoundedText(stage.label, 80)
      && ["open", "won", "lost"].includes(String(stage.stage_type))
      && Number.isSafeInteger(stage.order)
      && Number.isSafeInteger(stage.count)
      && Number(stage.count) >= 0)
    && stageCountTotal === contributingCount;
}

function parseResponse(value: unknown): AnalyticsEvidenceResponse {
  if (!isRecord(value)
    || typeof value.evidence_ref !== "string"
    || !REF_PATTERN.test(value.evidence_ref)
    || !isSafeBundle(value.bundle)) {
    throw new Error("Analytics evidence was not issued in the safe contract shape.");
  }
  return value as unknown as AnalyticsEvidenceResponse;
}

function parseResolvedBundle(value: unknown): AnalyticsEvidenceBundle {
  if (!isSafeBundle(value)) {
    throw new Error("Analytics evidence could not be revalidated in the safe contract shape.");
  }
  return value;
}

export function useAnalyticsEvidence({
  accountEpoch,
  rangeKey,
  enabled,
}: {
  accountEpoch: string | null;
  rangeKey: AnalyticsRangeKey;
  enabled: boolean;
}) {
  const [expired, setExpired] = useState(false);
  const issueQuery = useQuery({
    queryKey: ["analytics-evidence", METRIC_ID, rangeKey, accountEpoch],
    enabled: enabled && accountEpoch !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      // Generated database types are refreshed only after the migration is deployed.
      const { data, error } = await issueEvidenceRpc(
        "issue_analytics_evidence_bundle",
        {
          p_metric_id: METRIC_ID,
          p_range_key: rangeKey,
          p_account_epoch: accountEpoch,
        },
      );
      if (error) throw error;
      return parseResponse(data);
    },
  });

  const evidenceReference = issueQuery.data?.evidence_ref;
  const revalidationQuery = useQuery({
    queryKey: ["analytics-evidence-revalidation", METRIC_ID, rangeKey, accountEpoch, evidenceReference],
    enabled: enabled && accountEpoch !== null && evidenceReference !== undefined,
    initialData: issueQuery.data?.bundle,
    initialDataUpdatedAt: issueQuery.dataUpdatedAt,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const { data, error } = await issueEvidenceRpc(
        "resolve_analytics_evidence_reference",
        { p_evidence_ref: evidenceReference },
      );
      if (error) throw error;
      return parseResolvedBundle(data);
    },
  });

  const resolvedBundle = revalidationQuery.data ?? issueQuery.data?.bundle;
  const expiresAt = resolvedBundle?.reference_expires_at;
  useEffect(() => {
    if (!expiresAt) {
      setExpired(false);
      return;
    }
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const expiryTimer = window.setTimeout(() => {
      setExpired(true);
    }, remaining);
    return () => window.clearTimeout(expiryTimer);
  }, [expiresAt]);

  const isError = issueQuery.isError || revalidationQuery.isError;
  const safeBundle = isError || expired ? undefined : resolvedBundle;
  const safeReference = safeBundle ? evidenceReference : undefined;
  const retry = async () => {
    setExpired(true);
    const result = await issueQuery.refetch();
    if (!result.error && result.data) setExpired(false);
    return result;
  };

  return {
    bundle: safeBundle,
    evidenceReference: safeReference,
    loading: enabled && accountEpoch !== null && issueQuery.isLoading,
    isError,
    error: issueQuery.error ?? revalidationQuery.error,
    retry,
  };
}
