import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY_MS, defaultPipelineReady, defaultPipelineTarget, defaultRouteLabel, deriveMarketingOverview, periodStartOf, pipelineRouteOf, sendsToPipeline, withServerOverview } from "./marketing-overview-model";
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

describe("withServerOverview (MBC 2c)", () => {
  it("takes the server's counts, deltas and source mix, and keeps the record-drawn chart and top forms", () => {
    const records = deriveMarketingOverview({ briefs: [], artifacts: [], drafts: [], submissions: Array.from({ length: 200 }, (_, i) => sub(`s${i}`, 1)), periodDays: 30, now: NOW });
    expect(records.capped).toBe(true);
    const sources = ["a", "b", "c", "d", "e"].map((tag, i) => ({ key: `src:${tag}`, label: tag, count: 50 - i }));
    const merged = withServerOverview(records, { leads: 412, tagged: 250, opportunities: 31, sources, otherSources: 10, untagged: 152 }, { leads: 350, tagged: 0, opportunities: 31, sources: [], otherSources: 0, untagged: 0 });
    expect(merged.capped).toBe(false);
    expect(merged.leads).toEqual({ count: 412, tagged: 250, delta: { previous: 350, change: 62, percent: 18 } });
    expect(merged.opportunities).toEqual({ count: 31, delta: { previous: 31, change: 0, percent: 0 } });
    expect(merged.sources.map((s) => [s.label, s.count, s.kind])).toEqual([["a", 50, "tag"], ["b", 49, "tag"], ["c", 48, "tag"], ["d", 47, "tag"], ["Other sources", 56, "other"], ["No tracking tag", 152, "untagged"]]);
    expect(merged.daily).toBe(records.daily);
    expect(merged.topContent).toBe(records.topContent);
    expect(withServerOverview(records, { leads: 1, tagged: 0, opportunities: 0, sources: [], otherSources: 0, untagged: 1 }, null).leads.delta).toBeNull();
  });

  it("starts the server's period on the same local midnight as the records' period", () => {
    const start = periodStartOf(30, NOW);
    expect(new Date(start).getHours()).toBe(0);
    expect(Math.round((NOW - start) / DAY_MS)).toBe(30);
  });
});


// Owner ruling 2026-10-11 (20271021042001): a form with no route of its own files its leads into the
// business's DEFAULT pipeline, first open stage. These mirror growth_attach_submission_default_deal and
// marketing.forms.unrouted_current's default_ready.
describe("default pipeline routing", () => {
  const pipeline = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Pipeline ${id}`, isDefault: true, lifecycleStatus: "active", createdAt: "2026-09-01T00:00:00Z", ...extra });
  const stage = (id: string, pipelineId: string, extra: Record<string, unknown> = {}) => ({ id, pipelineId, label: `Stage ${id}`, stageType: "open", archivedAt: null, orderIndex: 0, ...extra });

  it("is ready only with a non-archived default pipeline that has a non-archived open stage", () => {
    expect(defaultPipelineReady(null)).toBe(false);
    expect(defaultPipelineReady(undefined)).toBe(false);
    expect(defaultPipelineReady({ pipelines: [], stages: [] })).toBe(false);
    // No default at all.
    expect(defaultPipelineReady({ pipelines: [pipeline("p", { isDefault: false })], stages: [stage("s", "p")] })).toBe(false);
    // The default pipeline is archived.
    expect(defaultPipelineReady({ pipelines: [pipeline("p", { lifecycleStatus: "archived" })], stages: [stage("s", "p")] })).toBe(false);
    // Its only open stage is archived.
    expect(defaultPipelineReady({ pipelines: [pipeline("p")], stages: [stage("s", "p", { archivedAt: "2026-10-01T00:00:00Z" })] })).toBe(false);
    // Only won and lost stages.
    expect(defaultPipelineReady({ pipelines: [pipeline("p")], stages: [stage("w", "p", { stageType: "won" }), stage("l", "p", { stageType: "lost" })] })).toBe(false);
    // An open stage in a different pipeline does not count.
    expect(defaultPipelineReady({ pipelines: [pipeline("p"), pipeline("q", { isDefault: false })], stages: [stage("s", "q")] })).toBe(false);
    // A draft default pipeline is not archived, so the server files into it.
    expect(defaultPipelineReady({ pipelines: [pipeline("p", { lifecycleStatus: "draft" })], stages: [stage("s", "p")] })).toBe(true);
    expect(defaultPipelineReady({ pipelines: [pipeline("p")], stages: [stage("s", "p")] })).toBe(true);
  });

  it("picks the oldest live default pipeline, then its first open stage by order, as the server does", () => {
    const target = defaultPipelineTarget({
      pipelines: [pipeline("new", { createdAt: "2026-10-01T00:00:00Z" }), pipeline("old", { name: "Client work", createdAt: "2026-08-01T00:00:00Z" }), pipeline("gone", { lifecycleStatus: "archived", createdAt: "2026-01-01T00:00:00Z" })],
      stages: [stage("won", "old", { stageType: "won", orderIndex: 0 }), stage("later", "old", { orderIndex: 5 }), stage("first", "old", { label: "New enquiry", orderIndex: 2 }), stage("x", "gone"), stage("y", "new")],
    });
    expect(target).toEqual({ pipelineId: "old", pipelineName: "Client work", stageId: "first", stageLabel: "New enquiry" });
    expect(defaultRouteLabel(target!)).toBe("Client work (default) → New enquiry");
    // The server checks only that oldest default: an open stage in a newer default does not make it ready.
    expect(defaultPipelineReady({ pipelines: [pipeline("new", { createdAt: "2026-10-01T00:00:00Z" }), pipeline("old", { createdAt: "2026-08-01T00:00:00Z" })], stages: [stage("y", "new")] })).toBe(false);
  });

  it("routes a form by its own route first, then the default pipeline, then nowhere", () => {
    const none = { routingTargets: [], intakePipelineId: null };
    const own = { routingTargets: [], intakePipelineId: "p" };
    const auto = { routingTargets: ["pipeline_attach"], intakePipelineId: null };
    const skipped = { routingTargets: ["notify_team"], intakePipelineId: "p" };
    expect([none, own, auto, skipped].map((form) => pipelineRouteOf(form, true))).toEqual(["default", "own", "own", "default"]);
    expect([none, own, auto, skipped].map((form) => pipelineRouteOf(form, false))).toEqual(["none", "own", "own", "none"]);
    // sendsToPipeline keeps its old meaning when the caller does not say the default is ready.
    expect([none, own, auto, skipped].map((form) => sendsToPipeline(form))).toEqual([false, true, true, false]);
    expect([none, own, auto, skipped].map((form) => sendsToPipeline(form, true))).toEqual([true, true, true, true]);
  });
});
