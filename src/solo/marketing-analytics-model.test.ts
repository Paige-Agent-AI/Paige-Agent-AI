// Marketing › Analytics' derivation (INT-342 S1d): the figures every chart on the tab draws.
import { describe, expect, it } from "vitest";
import { deriveMarketingAnalytics } from "./marketing-analytics-model";
import type { CampaignSubmission } from "./useSoloCampaigns";

const NOW = new Date(2026, 9, 10, 15, 0, 0).getTime(); // Sat 10 Oct 2026, 3pm local
const at = (daysAgo: number, hour = 10) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const lead = (id: string, daysAgo: number, extra: Partial<CampaignSubmission> = {}): CampaignSubmission => ({ id, formId: "f1", source: "paige_form", state: "done", createdAt: at(daysAgo), contactId: null, dealId: null, trackingSource: null, trackingCampaign: null, ...extra });
const form = { id: "f1", type: "form" as const, name: "Intake", routingTargets: [], routingConfigured: false, recentDispatches: { succeeded: 0, failed: 0, other: 0 } };
const derive = (submissions: CampaignSubmission[], days = 30) => deriveMarketingAnalytics({ submissions, briefs: [{ shortRef: "CB-1", name: "Spring" }], forms: [form], days, now: NOW });

describe("deriveMarketingAnalytics", () => {
  it("draws a day per point for a week or month, and a week per point for a quarter", () => {
    expect(derive([], 7).trend).toHaveLength(7);
    expect(derive([], 30).trend).toHaveLength(30);
    const quarter = derive([lead("a", 0), lead("b", 89)], 90);
    expect(quarter.trendStep).toBe("week");
    expect(quarter.trend).toHaveLength(13);
    expect(quarter.trend[0].leads).toBe(1);
    expect(quarter.trend.at(-1)!.leads).toBe(1);
    expect(quarter.trend.reduce((sum, p) => sum + p.leads, 0)).toBe(2);
  });

  it("counts each point's tagged, matched and opportunity leads", () => {
    const model = derive([lead("a", 0, { trackingSource: "ig", trackingCampaign: "cb-1", dealId: "d" }), lead("b", 0, { trackingCampaign: "nope" })]);
    expect(model.trend.at(-1)).toMatchObject({ leads: 2, tagged: 1, matched: 1, opportunities: 1 });
  });

  it("compares with the period before only when the read covers it", () => {
    const covered = derive([lead("a", 1), lead("b", 35, { dealId: "d" })]);
    expect(covered.previous).toEqual({ leads: 1, tagged: 0, matched: 0, opportunities: 1 });
    // A full read whose oldest row is inside the range can't vouch for the period before.
    const full = derive(Array.from({ length: 200 }, (_, i) => lead(`x${i}`, 1)));
    expect(full.capped).toBe(true);
    expect(full.previous).toBeNull();
    // A full read that reaches past the period before's start covers it.
    const deep = derive([...Array.from({ length: 199 }, (_, i) => lead(`y${i}`, 1)), lead("old", 70)]);
    expect(deep.previous).toEqual({ leads: 0, tagged: 0, matched: 0, opportunities: 0 });
  });

  it("places each lead on its weekday (Monday first) and local hour, and names its outcome", () => {
    const model = derive([lead("a", 5, { state: "error" }), lead("b", 5, { state: "pending" }), lead("c", 4, { contactId: "c" })]);
    // 5 days before Saturday 10 Oct is Monday 5 Oct.
    expect(model.weekdays[0].count).toBe(2);
    expect(model.heat[0][10]).toBe(2);
    expect(model.heat.flat().reduce((a, b) => a + b, 0)).toBe(3);
    expect(Object.fromEntries(model.outcomes.map((o) => [o.key, o.count]))).toEqual({ opportunity: 0, client: 1, saved: 0, waiting: 1, failed: 1 });
  });

  it("keeps four named sources, then everything else, then untagged", () => {
    const tags = ["a", "a", "b", "c", "d", "e", "f"];
    const model = derive([...tags.map((tag, i) => lead(`t${i}`, 1, { trackingSource: tag })), lead("u", 1)]);
    expect(model.sourceSlices.map((s) => [s.label, s.count, s.kind])).toEqual([["a", 2, "tag"], ["b", 1, "tag"], ["c", 1, "tag"], ["d", 1, "tag"], ["Other sources", 2, "other"], ["No tracking tag", 1, "untagged"]]);
  });
});
