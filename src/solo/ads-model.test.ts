import { describe, expect, it } from "vitest";
import { deriveLeadFunnel, isMissingFunction, parseLeadFunnel, pipelineChoices, rankShowroomMedia, trackingTag, type FunnelSubmission, type MediaRow } from "./ads-model";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const stage = (id: string, pipelineId: string, orderIndex: number, label: string, stageType: "open" | "won" | "lost" = "open", archivedAt: string | null = null) =>
  ({ id, pipelineId, label, description: "", orderIndex, archivedAt, movePolicy: "direct" as const, stageType, version: 1 });
const deal = (id: string, pipelineId: string, stageId: string) => ({ id, pipelineId, stageId });
const STAGES = [
  stage("s3", "p1", 3, "Proposal"), stage("s1", "p1", 1, "New lead"), stage("s2", "p1", 2, "Call booked"),
  stage("s4", "p1", 4, "Won", "won"), stage("s5", "p1", 5, "Lost", "lost"), stage("sx", "p1", 6, "Retired", "open", "2026-01-01"),
  stage("r1", "p2", 1, "Talking"),
];
const DEALS = [deal("d1", "p1", "s1"), deal("d2", "p1", "s2"), deal("d3", "p1", "s4"), deal("d4", "p2", "r1"), deal("d5", "p1", "s5"), deal("d6", "p1", "s1"), deal("d7", "p1", "s4")];
const sub = (days: number, dealId: string | null, campaign: string | null = null, ad: string | null = null): FunnelSubmission => ({ createdAt: ago(days), dealId, campaign, ad });
const SUBMISSIONS = [
  sub(1, "d1", "CB-SPRING", "img-a"),
  sub(2, "d2", "CB-SPRING", null),
  sub(3, "d3", " CB-SPRING ", "img-b"), // won; the tag is trimmed
  sub(4, "d4", "CB-SPRING", "img-a"), // a deal on another pipeline: not this funnel's lead
  sub(5, "d5", null, "img-a"), // lost
  sub(6, null, "CB-SPRING", "img-a"), // no deal yet: not in any pipeline
  sub(7, "d7", "PODCAST", "img-b"), // won
  sub(45, "d6", "CB-SPRING", "img-c"), // outside a 30-day window
  sub(2, "missing", "CB-SPRING", null), // a deal the workspace can't see
  sub(8, "d6", "  ", ""), // blank tags count as untagged
];
const P1 = { id: "p1", name: "Discovery calls", isDefault: true };

describe("deriveLeadFunnel (the records fallback, in the server read's shape)", () => {
  it("counts every deal per stage of the chosen pipeline, in its order, leaving archived stages out", () => {
    const funnel = deriveLeadFunnel({ pipeline: P1, stages: STAGES, deals: DEALS, submissions: SUBMISSIONS, since: null });
    expect(funnel.pipeline).toEqual(P1);
    expect(funnel.stages.map((s) => [s.name, s.stageType, s.deals])).toEqual([["New lead", "open", 2], ["Call booked", "open", 1], ["Proposal", "open", 0], ["Won", "won", 2], ["Lost", "lost", 1]]);
  });

  it("counts only leads whose deal is on this pipeline and inside the window, tagged and untagged", () => {
    const all = deriveLeadFunnel({ pipeline: P1, stages: STAGES, deals: DEALS, submissions: SUBMISSIONS, since: null });
    expect(all.leads).toEqual({ total: 7, tagged: 6, untagged: 1 });
    const month = deriveLeadFunnel({ pipeline: P1, stages: STAGES, deals: DEALS, submissions: SUBMISSIONS, since: ago(30) });
    expect(month.leads).toEqual({ total: 6, tagged: 5, untagged: 1 });
    expect(month.since).toBe(ago(30));
  });

  it("rolls leads up by campaign tag with open/won/lost and the stage each stands in, won first", () => {
    const { campaigns } = deriveLeadFunnel({ pipeline: P1, stages: STAGES, deals: DEALS, submissions: SUBMISSIONS, since: ago(30) });
    expect(campaigns).toEqual([
      { campaign: "CB-SPRING", leads: 3, open: 2, won: 1, lost: 0, byStage: { s1: 1, s2: 1, s4: 1 } },
      { campaign: "PODCAST", leads: 1, open: 0, won: 1, lost: 0, byStage: { s4: 1 } },
    ]);
  });

  it("rolls leads up by ad tag, naming the campaign it ran under most, ordered by won then leads", () => {
    const { ads } = deriveLeadFunnel({ pipeline: P1, stages: STAGES, deals: DEALS, submissions: SUBMISSIONS, since: ago(30) });
    expect(ads).toEqual([
      { ad: "img-b", campaign: "CB-SPRING", leads: 2, open: 0, won: 2, lost: 0 },
      { ad: "img-a", campaign: "CB-SPRING", leads: 2, open: 1, won: 0, lost: 1 },
    ]);
  });
});

describe("parseLeadFunnel (the server read's jsonb)", () => {
  const RAW = {
    pipeline: { id: "p1", name: "Discovery calls", is_default: true },
    stages: [{ id: "s2", name: "Call booked", order_index: 2, stage_type: "open", deals: 4 }, { id: "s1", name: "New lead", order_index: 1, stage_type: "open", deals: 9 }, { id: "s4", name: "Won", order_index: 4, stage_type: "won", deals: 3 }],
    leads: { total: 20, tagged: 14, untagged: 6 },
    campaigns: [{ campaign: "A", leads: 5, open: 4, won: 1, lost: 0, by_stage: { s1: 3, s4: 1 } }, { campaign: "B", leads: 9, open: 7, won: 2, lost: 0, by_stage: {} }, { campaign: "  ", leads: 1, open: 1, won: 0, lost: 0 }],
    ads: [{ ad: "img-1", campaign: "A", leads: 3, open: 3, won: 0, lost: 0 }, { ad: "img-2", campaign: null, leads: 2, open: 1, won: 1, lost: 0 }],
    since: "2026-07-13T00:00:00.000Z",
  };
  it("reads the contract shape, orders stages by order_index and rows by won then leads", () => {
    const funnel = parseLeadFunnel(RAW)!;
    expect(funnel.pipeline).toEqual({ id: "p1", name: "Discovery calls", isDefault: true });
    expect(funnel.stages.map((s) => s.id)).toEqual(["s1", "s2", "s4"]);
    expect(funnel.stages[2]).toEqual({ id: "s4", name: "Won", orderIndex: 4, stageType: "won", deals: 3 });
    expect(funnel.leads).toEqual({ total: 20, tagged: 14, untagged: 6 });
    expect(funnel.campaigns.map((c) => c.campaign)).toEqual(["B", "A"]);
    expect(funnel.campaigns[1].byStage).toEqual({ s1: 3, s4: 1 });
    expect(funnel.ads.map((a) => [a.ad, a.campaign])).toEqual([["img-2", null], ["img-1", "A"]]);
    expect(parseLeadFunnel(JSON.stringify(RAW))?.pipeline.id).toBe("p1");
  });
  it("returns null for anything that is not that shape, so the page falls back instead of half-drawing", () => {
    expect(parseLeadFunnel(null)).toBeNull();
    expect(parseLeadFunnel({ stages: [] })).toBeNull();
    expect(parseLeadFunnel({ pipeline: { id: "p1" } })).toBeNull();
    expect(parseLeadFunnel("not json")).toBeNull();
  });
  it("never reports a negative or fractional count", () => {
    const funnel = parseLeadFunnel({ ...RAW, stages: [{ id: "s1", name: "x", order_index: 1, stage_type: "weird", deals: -3 }], leads: { total: 2.7 } })!;
    expect(funnel.stages[0]).toMatchObject({ deals: 0, stageType: "open" });
    expect(funnel.leads).toEqual({ total: 2, tagged: 0, untagged: 2 });
  });
});

describe("pipelineChoices", () => {
  it("puts the default first, then by name, and leaves archived pipelines out", () => {
    const record = (id: string, name: string, isDefault = false, lifecycleStatus: "active" | "archived" | "draft" = "active", dealCount = 0) => ({ id, name, isDefault, lifecycleStatus, dealCount });
    expect(pipelineChoices([record("a", "Retainers", false, "active", 3), record("b", "Old", false, "archived"), record("c", "Discovery", true, "active", 7), record("d", "Audits")]).map((p) => [p.id, p.isDefault, p.deals]))
      .toEqual([["c", true, 7], ["d", false, 0], ["a", false, 3]]);
  });
});

describe("rankShowroomMedia", () => {
  const media = (id: string, days: number, extra: Partial<MediaRow> = {}): MediaRow => ({ id, kind: "image", title: id, image_url: `https://cdn.example/${id}.png`, updated_at: ago(days), meta: {}, ...extra });
  const featured = (at: number) => ({ ads_featured: true, ads_featured_at: ago(at) });
  const LIB = [
    media("new", 0),
    media("old", 30),
    media("perf-leads", 20),
    media("perf-won", 25),
    media("fav-older", 40, { meta: featured(9) }),
    media("fav-newer", 50, { meta: featured(1) }),
    media("unsafe", 0, { image_url: "http://insecure.example/x.png" }),
    media("clip", 2, { kind: "video", image_url: "https://cdn.example/clip.mp4" }),
  ];
  const ADS = [{ ad: "PERF-LEADS", leads: 9, won: 0 }, { ad: "perf-won", leads: 2, won: 2 }, { ad: "fav-older", leads: 50, won: 9 }, { ad: "gone", leads: 4, won: 4 }];

  it("fills placements with featured (newest feature first), then performing (won, then leads), then newest", () => {
    const picks = rankShowroomMedia(LIB, ADS, 8);
    expect(picks.map((p) => [p.row.id, p.reason])).toEqual([
      ["fav-newer", "featured"], ["fav-older", "featured"],
      ["perf-won", "performing"], ["perf-leads", "performing"],
      ["new", "recent"], ["clip", "recent"], ["old", "recent"],
    ]);
    expect(picks.find((p) => p.row.id === "perf-leads")).toMatchObject({ leads: 9, won: 0 });
    expect(picks.find((p) => p.row.id === "clip")?.kind).toBe("video");
  });
  it("takes three by default, leaves out a picture with no safe file, and ranks by recency with no lead counts", () => {
    expect(rankShowroomMedia(LIB, ADS).map((p) => p.row.id)).toEqual(["fav-newer", "fav-older", "perf-won"]);
    expect(rankShowroomMedia(LIB, null, 8).some((p) => p.row.id === "unsafe")).toBe(false);
    expect(rankShowroomMedia([media("a", 3), media("b", 1)], null).map((p) => [p.row.id, p.reason])).toEqual([["b", "recent"], ["a", "recent"]]);
    expect(rankShowroomMedia([], ADS)).toEqual([]);
  });
  it("puts a picture uploaded in this visit first, ahead of the featured ones", () => {
    expect(rankShowroomMedia(LIB, ADS, 3, "old").map((p) => [p.row.id, p.reason])).toEqual([["old", "added"], ["fav-newer", "featured"], ["fav-older", "featured"]]);
    expect(rankShowroomMedia(LIB, ADS, 3, "unsafe").map((p) => p.row.id)).toEqual(["fav-newer", "fav-older", "perf-won"]);
  });
});

describe("helpers", () => {
  it("names the tag that credits a lead to a picture", () => expect(trackingTag("abc")).toBe("utm_content=abc"));
  it("tells a missing function from any other failure", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "Could not find the function public.get_pipeline_lead_funnel" })).toBe(true);
    expect(isMissingFunction({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
