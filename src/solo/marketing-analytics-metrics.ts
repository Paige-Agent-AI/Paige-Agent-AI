// Marketing › Analytics headline figures from Marketing's server producer (INT-298 MBC slice 2b).
//
// The figures are read through the shared INT-340 seam (`issue_analytics_evidence_bundle` → the private
// `_marketing_metric_bundle`), which counts every lead in the range on the server. Each answer is checked by
// the shared validator (`parseMetricResult`) before anything is drawn. Only owners and admins may read
// them, as for Sales and Settings figures; anyone else gets `denied`, and the page keeps its own counts
// from the records it already read (floors when that read is full). Contract:
// docs/delivery/marketing-metric-server-contract.md.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseMetricResult, type MetricResult } from "@/lib/analytics/metric-contract";
import { NAMED_SOURCES, type MarketingAnalyticsModel } from "./marketing-analytics-model";
import type { CampaignBrief } from "./useSoloCampaignBriefs";


export const HEADLINE_KEYS = [
  "marketing.leads.received",
  "marketing.leads.by_utm_source",
  "marketing.leads.by_campaign_tag",
  "marketing.leads.converted_to_opportunity",
] as const;
type HeadlineKey = (typeof HEADLINE_KEYS)[number];
const RANGE_DAYS = { week: 7, month: 30, quarter: 90 } as const;

/** The headline figures for one period, as the server counted them. */
export type ServerFigures = {
  leads: number;
  tagged: number;
  campaignTagged: number;
  matched: number;
  opportunities: number;
  /** Leads whose campaign tag matches more than one brief: excluded from the match, never guessed. */
  ambiguous: number;
  /** Leads pointing to an opportunity that no longer exists in this workspace: not counted as opportunities. */
  missingDeals: number;
  /** Source tags, most first; the untagged and the folded rest are separate. */
  sources: { key: string; label: string; count: number }[];
  untagged: number;
  otherSources: number;
  /** Campaign tags: a brief (by id) or an unmatched tag. */
  campaignTags: { key: string; briefId: string | null; label: string; count: number }[];
};

type Distribution = { key: string; label: string; count: number }[];
const items = (result: MetricResult | undefined): Distribution =>
  result?.values?.kind === "distribution" ? result.values.items : [];
const count = (result: MetricResult | undefined) => (result?.values?.kind === "count" ? result.values.count : 0);

/** Four validated answers → the figures the page draws. Pure, so it is tested on its own. */
export function figuresFrom(results: Partial<Record<HeadlineKey, MetricResult>>): ServerFigures {
  const sources = items(results["marketing.leads.by_utm_source"]);
  const tags = items(results["marketing.leads.by_campaign_tag"]);
  const sum = (rows: Distribution) => rows.reduce((total, row) => total + row.count, 0);
  const untagged = sum(sources.filter((row) => row.key === "_untagged"));
  const otherSources = sum(sources.filter((row) => row.key === "_other"));
  const named = sources.filter((row) => row.key.startsWith("src:"));
  const tagRows = tags.filter((row) => row.key !== "_untagged");
  const excluded = (key: HeadlineKey, reason: string) => results[key]?.exclusions.find((row) => row.reason === reason)?.count ?? 0;
  const ambiguous = excluded("marketing.leads.by_campaign_tag", "campaign_tag_matches_several_briefs");
  return {
    leads: count(results["marketing.leads.received"]),
    tagged: sum(named) + otherSources,
    campaignTagged: sum(tagRows) + ambiguous,
    matched: sum(tagRows.filter((row) => row.key.startsWith("brief:"))),
    opportunities: count(results["marketing.leads.converted_to_opportunity"]),
    ambiguous,
    missingDeals: excluded("marketing.leads.converted_to_opportunity", "opportunity_record_missing"),
    sources: named,
    untagged,
    otherSources,
    campaignTags: tagRows.map((row) => ({ key: row.key, briefId: row.key.startsWith("brief:") ? row.key.slice(6) : null, label: row.label, count: row.count })),
  };
}

export type ServerRead = {
  phase: "loading" | "ready" | "denied" | "error";
  current: ServerFigures | null;
  previous: ServerFigures | null;
  retry: () => void;
};

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/** Reads the headline figures for [start, now) and the period just before it, both on the server. */
export function useMarketingServerFigures(tenantId: string | null, rangeKey: "week" | "month" | "quarter", periodStart: number): ServerRead {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; phase: ServerRead["phase"]; current: ServerFigures | null; previous: ServerFigures | null }>({ key: "", phase: "loading", current: null, previous: null });
  const key = `${tenantId}:${rangeKey}:${periodStart}:${attempt}`;
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState({ key, phase: "loading", current: null, previous: null });
    // The server refuses an end after its own clock; a second's margin absorbs a fast client clock.
    const end = new Date(Math.floor((Date.now() - 1000) / 1000) * 1000).toISOString();
    const start = new Date(periodStart).toISOString();
    // The period before starts the same number of local days earlier, as the browser model counts it.
    const first = new Date(periodStart);
    const before = new Date(first.getFullYear(), first.getMonth(), first.getDate() - RANGE_DAYS[rangeKey]).toISOString();
    const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);
    const read = async (from: string, to: string) => {
      const results: Partial<Record<HeadlineKey, MetricResult>> = {};
      await Promise.all(HEADLINE_KEYS.map(async (metricKey) => {
        const { data, error } = await rpc("issue_analytics_evidence_bundle", {
          p_metric_key: metricKey, p_metric_version: "1.0.0", p_dimensions: {}, p_range_key: rangeKey,
          p_range_start: from, p_range_end: to, p_account_epoch: tenantId,
        });
        if (error) throw Object.assign(new Error(error.message ?? "read refused"), { code: error.code });
        const result = parseMetricResult(data, { metricKey, metricVersion: "1.0.0", accountEpoch: tenantId, rangeKey, rangeStart: from, rangeEnd: to, dimensions: {} });
        if (result.owner_department !== "marketing") throw new Error("unexpected metric owner");
        // No contributing lead (every one excluded): never drawn as a true zero, so the page keeps its own counts.
        if (result.truth_state === "UNAVAILABLE") throw new Error(`${metricKey} unavailable`);
        results[metricKey] = result;
      }));
      return figuresFrom(results);
    };
    // A device clock running ahead of the server's makes it refuse the end (22023); one retry with a wider margin.
    const later = new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000).toISOString();
    const readCurrent = read(start, end).catch((error: { code?: string }) => (error?.code === "22023" && later > start ? read(start, later) : Promise.reject(error)));
    Promise.all([readCurrent, read(before, start)]).then(([current, previous]) => {
      if (live) setState({ key, phase: "ready", current, previous });
    }, (error: { code?: string }) => {
      if (!live) return;
      // Not an owner or admin seat (42501), or no session (28000): the page keeps its own counts.
      const denied = error?.code === "42501" || error?.code === "28000";
      if (!denied) console.error("[marketing-analytics] server figures failed", error);
      setState({ key, phase: denied ? "denied" : "error", current: null, previous: null });
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === key;
  return { phase: current ? state.phase : "loading", current: current ? state.current : null, previous: current ? state.previous : null, retry: () => setAttempt((n) => n + 1) };
}

/** The page's figures with the server's counts laid over the browser's, where the server answered.
 *  Only the figure-level fields change: the trend, the outcome ring, the heatmap and the capture points
 *  stay on the records they are drawn from, so each ring still adds up to its own centre. */
export function withServerFigures(model: MarketingAnalyticsModel, current: ServerFigures, previous: ServerFigures | null, briefs: readonly Pick<CampaignBrief, "id" | "shortRef" | "name">[]): MarketingAnalyticsModel {
  const named = current.sources.slice(0, NAMED_SOURCES);
  const rest = current.sources.slice(NAMED_SOURCES).reduce((sum, row) => sum + row.count, 0) + current.otherSources;
  const byId = new Map(briefs.map((brief) => [brief.id, brief]));
  return {
    ...model,
    capped: false,
    leads: current.leads,
    tagged: current.tagged,
    campaignTagged: current.campaignTagged,
    matched: current.matched,
    opportunities: current.opportunities,
    sourceSlices: [
      ...named.map((row) => ({ key: `tag:${row.key.slice(4)}`, label: row.label, count: row.count, kind: "tag" as const })),
      ...(rest ? [{ key: "other", label: "Other sources", count: rest, kind: "other" as const }] : []),
      ...(current.untagged ? [{ key: "untagged", label: "No tracking tag", count: current.untagged, kind: "untagged" as const }] : []),
    ],
    campaignTags: [
      ...current.campaignTags.map((row) => {
        if (row.key === "_other") return { key: row.key, tag: "Other tags", count: row.count, brief: null, note: "Tags beyond the most used, counted together" };
        if (!row.briefId) return { key: row.key, tag: row.label, count: row.count, brief: null };
        const brief = byId.get(row.briefId);
        // The server matches every brief, archived ones too; this page lists only the ones in use.
        return brief
          ? { key: row.key, tag: brief.shortRef ?? brief.name, count: row.count, brief: brief.name }
          : { key: row.key, tag: row.label, count: row.count, brief: null, note: "A brief not listed here, such as an archived one" };
      }),
      ...(current.ambiguous ? [{ key: "_ambiguous", tag: "Matches several briefs", count: current.ambiguous, brief: null, note: "More than one brief has this reference, so none is credited" }] : []),
    ],
    previous: previous && { leads: previous.leads, tagged: previous.tagged, matched: previous.matched, opportunities: previous.opportunities },
  };
}
