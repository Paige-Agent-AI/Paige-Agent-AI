import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { HEADLINE_KEYS, figuresFrom, useMarketingServerFigures, withServerFigures, type ServerRead } from "./marketing-analytics-metrics";
import { deriveMarketingAnalytics } from "./marketing-analytics-model";
import type { MetricResult } from "@/lib/analytics/metric-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ref = (prefix: string, n: number) => `${prefix}_${String(n).padStart(64, "0")}`;
const future = () => new Date(Date.now() + 10 * 60_000).toISOString();

/** A bundle as the shared issuer returns it, valid for parseMetricResult. */
function bundle(args: { p_metric_key: string; p_range_key: string; p_range_start: string; p_range_end: string }, values: MetricResult["values"], extra: Partial<MetricResult> = {}) {
  const asOf = new Date().toISOString();
  return {
    metric_key: args.p_metric_key, metric_version: "1.0.0", owner_department: "marketing", label: "Leads", definition: "Form submissions.", formula: "COUNT(*)",
    range: { key: args.p_range_key, start: args.p_range_start, end: args.p_range_end, bounds: "[start,end)", timezone: "UTC", semantics: "event_timestamp_cohort" },
    dimensions: {}, values, unit: "count", source_refs: ["public.growth_form_submissions"], as_of: asOf,
    freshness: { queried_at: asOf, source_updated_through: null },
    coverage: { state: "complete", candidate_count: 0, contributing_count: 0, excluded_count: 0 }, exclusions: [], truth_state: "LIVE", caveats: [],
    source_revision_ref: ref("sr_v1", 1), account_epoch: TENANT, account_epoch_ref: ref("ae_v1", 2), evidence_ref: ref("aneb_v1", 3), reference_expires_at: future(),
    ...extra,
  };
}

const answers: Record<string, (args: Parameters<typeof bundle>[0]) => unknown> = {
  "marketing.leads.received": (a) => bundle(a, { kind: "count", count: 412 }),
  "marketing.leads.by_utm_source": (a) => bundle(a, { kind: "distribution", items: [
    { key: "src:newsletter", label: "newsletter", count: 200 }, { key: "src:linkedin", label: "LinkedIn", count: 90 },
    { key: "src:a", label: "a", count: 5 }, { key: "src:b", label: "b", count: 4 }, { key: "src:c", label: "c", count: 3 },
    { key: "_other", label: "Other sources", count: 10 }, { key: "_untagged", label: "No source tag", count: 100 },
  ] }),
  "marketing.leads.by_campaign_tag": (a) => bundle(a, { kind: "distribution", items: [
    { key: "brief:b-1", label: "Spring intake", count: 60 }, { key: "tag:cb-old", label: "CB-OLD", count: 7 }, { key: "_untagged", label: "No campaign tag", count: 340 },
  ] }, { coverage: { state: "partial", candidate_count: 412, contributing_count: 407, excluded_count: 5 }, exclusions: [{ reason: "campaign_tag_matches_several_briefs", count: 5 }], truth_state: "PARTIAL" }),
  "marketing.leads.converted_to_opportunity": (a) => bundle(a, { kind: "count", count: 31 }),
};

describe("Marketing › Analytics server figures", () => {
  it("turns the four answers into the page's figures: tagged includes the folded rest, matched is briefs only, ambiguity counts as tagged", () => {
    const results = Object.fromEntries(HEADLINE_KEYS.map((key) => [key, answers[key]({ p_metric_key: key, p_range_key: "month", p_range_start: "2026-09-11T00:00:00.000Z", p_range_end: "2026-10-10T00:00:00.000Z" })])) as Record<string, MetricResult>;
    const figures = figuresFrom(results);
    expect(figures).toMatchObject({ leads: 412, tagged: 312, untagged: 100, otherSources: 10, matched: 60, campaignTagged: 72, ambiguous: 5, opportunities: 31, missingDeals: 0 });
    expect(figures.campaignTags).toEqual([{ key: "brief:b-1", briefId: "b-1", label: "Spring intake", count: 60 }, { key: "tag:cb-old", briefId: null, label: "CB-OLD", count: 7 }]);
  });

  it("lays the server's counts over the record model, leaving the record-drawn parts alone", () => {
    const records = deriveMarketingAnalytics({ submissions: [], briefs: [], forms: [], days: 30 });
    const results = Object.fromEntries(HEADLINE_KEYS.map((key) => [key, answers[key]({ p_metric_key: key, p_range_key: "month", p_range_start: "2026-09-11T00:00:00.000Z", p_range_end: "2026-10-10T00:00:00.000Z" })])) as Record<string, MetricResult>;
    const shown = withServerFigures({ ...records, capped: true }, figuresFrom(results), null, [{ id: "b-1", shortRef: "CB-SPRING", name: "Spring intake" }]);
    expect(shown.capped).toBe(false);
    expect([shown.leads, shown.tagged, shown.matched, shown.opportunities]).toEqual([412, 312, 60, 31]);
    // Four named tags, the fifth folded with the server's rest, then the untagged.
    expect(shown.sourceSlices.map((slice) => [slice.label, slice.count, slice.kind])).toEqual([["newsletter", 200, "tag"], ["LinkedIn", 90, "tag"], ["a", 5, "tag"], ["b", 4, "tag"], ["Other sources", 13, "other"], ["No tracking tag", 100, "untagged"]]);
    // The five ambiguous leads get their own row, so the rows add up to the campaign-tagged count.
    expect(shown.campaignTags).toEqual([
      { key: "brief:b-1", tag: "CB-SPRING", count: 60, brief: "Spring intake" }, { key: "tag:cb-old", tag: "CB-OLD", count: 7, brief: null },
      { key: "_ambiguous", tag: "Matches several briefs", count: 5, brief: null, note: "More than one brief has this reference, so none is credited" },
    ]);
    expect(shown.campaignTags.reduce((sum, row) => sum + row.count, 0)).toBe(shown.campaignTagged);
    expect(shown.trend).toBe(records.trend);
    expect(shown.outcomes).toBe(records.outcomes);
  });
});

describe("Marketing › Analytics campaign tags the page can't name itself", () => {
  it("names the server's folded rest and a brief this page doesn't list, without calling either an unknown tag", () => {
    const records = deriveMarketingAnalytics({ submissions: [], briefs: [], forms: [], days: 30 });
    const base = { leads: 30, tagged: 0, campaignTagged: 30, matched: 20, opportunities: 0, ambiguous: 0, missingDeals: 0, sources: [], untagged: 30, otherSources: 0 };
    const shown = withServerFigures(records, { ...base, campaignTags: [
      { key: "brief:b-gone", briefId: "b-gone", label: "Winter launch", count: 20 },
      { key: "_other", briefId: null, label: "Other tags", count: 10 },
    ] }, null, [{ id: "b-1", shortRef: "CB-SPRING", name: "Spring intake" }]);
    expect(shown.campaignTags).toEqual([
      { key: "brief:b-gone", tag: "Winter launch", count: 20, brief: null, note: "A brief not listed here, such as an archived one" },
      { key: "_other", tag: "Other tags", count: 10, brief: null, note: "Tags beyond the most used, counted together" },
    ]);
  });

  it("counts leads whose opportunity no longer exists, from the server's disclosed exclusion", () => {
    const answer = answers["marketing.leads.converted_to_opportunity"]({ p_metric_key: "marketing.leads.converted_to_opportunity", p_range_key: "month", p_range_start: "2026-09-11T00:00:00.000Z", p_range_end: "2026-10-10T00:00:00.000Z" }) as MetricResult;
    const figures = figuresFrom({ "marketing.leads.converted_to_opportunity": { ...answer, exclusions: [{ reason: "opportunity_record_missing", count: 3 }] } });
    expect(figures.missingDeals).toBe(3);
  });
});

describe("useMarketingServerFigures", () => {
  let host: HTMLDivElement; let root: Root; let read: ServerRead;
  function Probe({ periodStart }: { periodStart: number }) { read = useMarketingServerFigures(TENANT, "month", periodStart); return null; }
  afterEach(() => { act(() => root.unmount()); host.remove(); rpc.mockReset(); });
  const mount = async (periodStart: number) => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(<Probe periodStart={periodStart}/>); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  const start = new Date(2026, 8, 11).getTime();

  it("issues every headline key for the range and the 30 local days before it, through the shared issuer", async () => {
    rpc.mockImplementation(async (name: string, args: Parameters<typeof bundle>[0] & { p_account_epoch: string }) => ({ data: answers[args.p_metric_key](args), error: null }));
    await mount(start);
    expect(read.phase).toBe("ready");
    expect(read.current?.leads).toBe(412);
    expect(read.previous?.leads).toBe(412);
    expect(rpc).toHaveBeenCalledTimes(8);
    const calls = rpc.mock.calls.map(([name, args]) => [name, args.p_metric_key, args.p_range_key, args.p_range_start, args.p_account_epoch, args.p_dimensions]);
    expect(new Set(calls.map((call) => call[0]))).toEqual(new Set(["issue_analytics_evidence_bundle"]));
    expect(new Set(calls.map((call) => call[3]))).toEqual(new Set([new Date(start).toISOString(), new Date(2026, 7, 12).toISOString()]));
    expect(calls.every((call) => call[2] === "month" && call[4] === TENANT && JSON.stringify(call[5]) === "{}")).toBe(true);
  });

  it("a member is told nothing new: a refused read is 'denied', so the page keeps its own counts", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "ANALYTICS_EVIDENCE_UNAVAILABLE" } });
    await mount(start);
    expect(read.phase).toBe("denied");
    expect(read.current).toBeNull();
  });

  it("a clock ahead of the server is retried once with a wider margin, so the owner still gets the exact figures", async () => {
    let refused = 0;
    rpc.mockImplementation(async (name: string, args: Parameters<typeof bundle>[0]) => {
      // The server refuses any end within the last minute, as it would for a client clock running ahead.
      if (Date.parse(args.p_range_end) > Date.now() - 60_000) { refused += 1; return { data: null, error: { code: "22023", message: "ANALYTICS_METRIC_ARGUMENTS_INVALID" } }; }
      return { data: answers[args.p_metric_key](args), error: null };
    });
    await mount(start);
    expect(read.phase).toBe("ready");
    expect(read.current?.leads).toBe(412);
    expect(refused).toBeGreaterThan(0);
  });

  it("an answer with no contributing lead (UNAVAILABLE) is never drawn as a true zero", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation(async (name: string, args: Parameters<typeof bundle>[0]) => ({ data: args.p_metric_key === "marketing.leads.converted_to_opportunity"
      ? bundle(args, null as unknown as MetricResult["values"], { truth_state: "UNAVAILABLE", coverage: { state: "unavailable", candidate_count: 4, contributing_count: 0, excluded_count: 4 }, exclusions: [{ reason: "opportunity_record_missing", count: 4 }] })
      : answers[args.p_metric_key](args), error: null }));
    await mount(start);
    expect(read.phase).toBe("error");
    expect(read.current).toBeNull();
    spy.mockRestore();
  });

  it("no session (28000) is treated like a refused seat", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "28000", message: "not authenticated" } });
    await mount(start);
    expect(read.phase).toBe("denied");
  });

  it("an answer that fails the shared validator is an error, never drawn", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation(async (name: string, args: Parameters<typeof bundle>[0]) => ({ data: { ...(answers[args.p_metric_key](args) as object), account_epoch: "someone-else" }, error: null }));
    await mount(start);
    expect(read.phase).toBe("error");
    expect(read.current).toBeNull();
    spy.mockRestore();
  });
});
