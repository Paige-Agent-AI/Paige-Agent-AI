import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY_MS, deriveMarketingOverview } from "./marketing-overview-model";
import type { CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";

// Noon on a fixed day, so "days ago" never straddles midnight.
const NOW = new Date(2026, 9, 3, 12, 0, 0).getTime();
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();
const sub = (id: string, days: number, extra: Partial<CampaignSubmission> = {}): CampaignSubmission => ({
  id, formId: "f1", source: "paige_form", state: "done", createdAt: ago(days), contactId: null, dealId: null, trackingSource: null, trackingCampaign: null, ...extra,
});
const brief = (id: string, lifecycleStatus: CampaignBrief["lifecycleStatus"], extra: Record<string, unknown> = {}) =>
  ({ id, name: id, lifecycleStatus, blocker: null, createdAt: null, ...extra }) as unknown as CampaignBrief;
const derive = (submissions: CampaignSubmission[], extra: Partial<Parameters<typeof deriveMarketingOverview>[0]> = {}) =>
  deriveMarketingOverview({ briefs: [], artifacts: [], drafts: [], submissions, periodDays: 30, now: NOW, ...extra });

describe("Marketing Overview model", () => {
  it("places each lead on the day it arrived, inside whole calendar days", () => {
    const model = derive([sub("a", 0), sub("b", 0, { dealId: "d" }), sub("c", 29), sub("d", 30)]);
    expect(model.daily).toHaveLength(30);
    expect(model.daily.at(-1)).toMatchObject({ leads: 2, opportunities: 1 });
    expect(model.daily[0].leads).toBe(1);
    expect(model.leads.count).toBe(3);
  });

  it("compares with the previous period only when the read reaches back past it", () => {
    expect(derive([sub("a", 1), sub("a2", 2), sub("b", 40)]).leads.delta).toEqual({ previous: 1, change: 1, percent: 100 });
    // A full read whose oldest row is inside the previous period cannot see all of it.
    const full = Array.from({ length: 200 }, (_, index) => sub(`s${index}`, index < 150 ? 2 : 35));
    expect(derive(full).leads.delta).toBeNull();
    expect(derive(full).opportunities.delta).toBeNull();
    // ...but a full read that reaches past the previous period's start can.
    const deep = Array.from({ length: 200 }, (_, index) => sub(`s${index}`, index < 150 ? 2 : 70));
    expect(derive(deep).leads.delta).toEqual({ previous: 0, change: 150, percent: null });
  });

  it("marks the count as a floor when every row of a full read sits inside the period", () => {
    const full = Array.from({ length: 200 }, (_, index) => sub(`s${index}`, 1));
    expect(derive(full).capped).toBe(true);
    expect(derive([sub("a", 1)]).capped).toBe(false);
  });

  it("groups sources by tracking tag, case-insensitively, folding past four into Other", () => {
    const tags = ["News", "news", "linkedin", "podcast", "partner", "ads", null];
    const model = derive(tags.map((tag, index) => sub(`s${index}`, 1, { trackingSource: tag })));
    expect(model.sources.map((slice) => [slice.label, slice.count, slice.kind])).toEqual([
      ["News", 2, "tag"], ["ads", 1, "tag"], ["linkedin", 1, "tag"], ["partner", 1, "tag"],
      ["Other sources", 1, "other"], ["No tracking tag", 1, "untagged"],
    ]);
    expect(model.leads.tagged).toBe(6);
  });

  it("ranks forms by leads and names a form that no longer exists honestly", () => {
    const model = derive([sub("a", 1), sub("b", 1, { formId: "f2" }), sub("c", 2, { formId: "f2" })], {
      artifacts: [{ id: "f2", type: "form", name: "Scorecard" }] as never,
    });
    expect(model.topContent).toEqual([{ id: "f2", name: "Scorecard", count: 2 }, { id: "f1", name: "A form no longer listed", count: 1 }]);
  });

  it("sorts briefs into plain statuses; a blocker outranks the lifecycle and archived is left out", () => {
    const model = derive([], { briefs: [
      brief("a", "active"), brief("b", "active", { blocker: "waiting" }), brief("c", "ready_for_review"),
      brief("d", "approved"), brief("e", "archived"), brief("f", "completed", { createdAt: ago(3) }),
    ] });
    expect(Object.fromEntries(model.status.map((slice) => [slice.key, slice.count]))).toEqual({ running: 1, approved: 1, review: 1, draft: 0, paused: 0, blocked: 1, completed: 1 });
    expect(model.campaigns).toEqual({ total: 5, running: 1, blocked: 1, newInPeriod: 1 });
  });
});

describe("Marketing Overview model across a daylight-saving change", () => {
  const original = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/New_York"; });
  afterAll(() => { process.env.TZ = original; });

  it("keeps every calendar day, starts the period at midnight and charts every counted lead (US spring-forward 2027-03-14)", () => {
    const now = new Date(2027, 2, 20, 12, 0, 0).getTime();
    const at = (day: number, hour: number, minute = 0) => new Date(2027, 2, day, hour, minute).toISOString();
    const rows = [
      sub("on-change-day", 0, { createdAt: at(14, 1) }),
      sub("first-minute", 0, { createdAt: at(14, 0, 30) }),
      sub("day-before", 0, { createdAt: at(13, 23, 30) }), // outside a 7-day period ending the 20th
      sub("today", 0, { createdAt: at(20, 9) }),
    ];
    const model = derive(rows, { periodDays: 7, now });
    expect(model.daily.map((point) => point.day)).toEqual(["2027-03-14", "2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19", "2027-03-20"]);
    expect(model.leads.count).toBe(3);
    expect(model.daily.reduce((sum, point) => sum + point.leads, 0)).toBe(model.leads.count);
    expect(model.daily[0].leads).toBe(2);
  });
});

describe("Marketing Overview model edges", () => {
  it("counts a lead stamped ahead of this clock as today, and charts it", () => {
    const model = derive([sub("ahead", -0.6), sub("a", 1)]); // 14 hours ahead of noon: tomorrow by this clock
    expect(model.leads.count).toBe(2);
    expect(model.daily.at(-1)?.leads).toBe(1);
  });

  it("is not a floor when a full read already reaches back before the period", () => {
    const rows = Array.from({ length: 200 }, (_, index) => sub(`s${index}`, index < 190 ? 1 : 45));
    const model = derive(rows);
    expect(model.capped).toBe(false);
    expect(model.leads.count).toBe(190);
    // ...and still a floor when a future-stamped row sits in an otherwise full in-period read.
    expect(derive([...Array.from({ length: 199 }, (_, index) => sub(`f${index}`, 2)), sub("ahead", -0.01)]).capped).toBe(true);
  });
});
