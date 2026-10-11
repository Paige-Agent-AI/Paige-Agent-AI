// MOCK THE PROVIDER, NEVER THE CONTRACT. Fixtures for the Ads department harness: a fictional
// business's own pictures and videos (marketing_content kind image|video), its Sales pipelines, and the
// answers the contracted server reads give (get_pipeline_lead_funnel, set_ad_creative_featured). Every
// component under test is the real one. Never an owner's real account (§63).
//
// `?funnel=missing` answers the funnel read the way an undeployed function does (PGRST202), so the page
// draws its records fallback.
import { useSoloCampaigns as marketingCampaigns } from "../marketing-mount/stubs";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
export const funnelMissing = new URLSearchParams(window.location.search).get("funnel") === "missing";

export const MEDIA_IDS = {
  workshop: "7c1d0000-0000-4000-8000-000000000001",
  session: "7c1d0000-0000-4000-8000-000000000002",
  scorecard: "7c1d0000-0000-4000-8000-000000000003",
  story: "7c1d0000-0000-4000-8000-000000000004",
};
export const media: Record<string, unknown>[] = [
  { id: MEDIA_IDS.scorecard, kind: "image", title: "Scorecard banner", image_url: "/media/scorecard.svg", updated_at: day(0), meta: {} },
  { id: MEDIA_IDS.session, kind: "image", title: "Planning session story", image_url: "/media/planning-session.svg", updated_at: day(6), meta: {} },
  { id: MEDIA_IDS.story, kind: "image", title: "Client story card", image_url: "/media/client-story.svg", updated_at: day(12), meta: {} },
  { id: MEDIA_IDS.workshop, kind: "image", title: "Spring workshop square", image_url: "/media/spring-workshop.svg", updated_at: day(20), meta: { ads_featured: true, ads_featured_at: day(3) } },
];

/* Sales: three pipelines, the default listed second so "default first" is visible. */
const stage = (id: string, pipelineId: string, orderIndex: number, label: string, stageType: "open" | "won" | "lost" = "open") =>
  ({ id, pipelineId, label, description: "", orderIndex, archivedAt: null, movePolicy: "direct", stageType, version: 1 });
const pipeline = (id: string, name: string, isDefault: boolean, dealCount: number) =>
  ({ id, shortRef: id.toUpperCase(), folderId: null, folderName: null, name, description: "", isDefault, lifecycleStatus: "active", version: 1, createdAt: day(90), updatedAt: day(2), createdThrough: "owner", createdByName: null, requestedByName: null, stageCount: 5, dealCount });
export const pipelines = [pipeline("p-retainers", "Retainers", false, 3), pipeline("p-intake", "Client intake", true, 32), pipeline("p-audits", "Business audits", false, 0), pipeline("p-partners", "Partner referrals", false, 2)];
export const stages = [
  stage("s-new", "p-intake", 1, "New lead"), stage("s-call", "p-intake", 2, "Discovery call"), stage("s-proposal", "p-intake", 3, "Proposal sent"),
  stage("s-won", "p-intake", 4, "Signed", "won"), stage("s-lost", "p-intake", 5, "Not now", "lost"),
  stage("r-talk", "p-retainers", 1, "Talking"), stage("r-won", "p-retainers", 2, "Renewed", "won"),
  stage("a-scope", "p-audits", 1, "Scoping"), stage("a-done", "p-audits", 2, "Delivered", "won"),
  stage("x-intro", "p-partners", 1, "Introduced"),
];
// Every submission that carries a deal gets one on Client intake, spread across its stages, so the
// records fallback (?funnel=missing) has a real shape; a few more sit on Retainers.
const seed = marketingCampaigns();
const INTAKE = ["s-new", "s-new", "s-call", "s-new", "s-proposal", "s-won", "s-call", "s-lost", "s-new", "s-won"];
export const deals = [
  ...seed.submissions.filter((s) => s.dealId).map((s, i) => ({ id: s.dealId as string, pipelineId: "p-intake", stageId: INTAKE[i % INTAKE.length] })),
  { id: "r1", pipelineId: "p-retainers", stageId: "r-talk" }, { id: "r2", pipelineId: "p-retainers", stageId: "r-won" }, { id: "r3", pipelineId: "p-retainers", stageId: "r-won" },
  { id: "x1", pipelineId: "p-partners", stageId: "x-intro" }, { id: "x2", pipelineId: "p-partners", stageId: "x-intro" },
];
// The ad each tagged lead arrived from: the planning-session story most, then the client story card.
const AD_OF = [MEDIA_IDS.session, MEDIA_IDS.session, null, MEDIA_IDS.story, MEDIA_IDS.session, null, MEDIA_IDS.workshop];
export const submissions = seed.submissions.map((s, i) => ({ ...s, trackingContent: s.trackingSource ? AD_OF[i % AD_OF.length] : null }));
export const submissionRows = submissions.map((s) => ({ id: s.id, created_at: s.createdAt, deal_id: s.dealId, utm_json: { ...(s.trackingSource ? { utm_source: s.trackingSource } : {}), ...(s.trackingCampaign ? { utm_campaign: s.trackingCampaign } : {}), ...(s.trackingContent ? { utm_content: s.trackingContent } : {}) } }));

/* get_pipeline_lead_funnel, as the server answers it (snake_case jsonb). */
export function funnelAnswer(pipelineId: string, since: string | null) {
  const p = pipelines.find((row) => row.id === pipelineId) ?? pipelines[1];
  const s = (id: string, name: string, order: number, type: string, deals: number) => ({ id, name, order_index: order, stage_type: type, deals });
  if (p.id === "p-intake") return {
    pipeline: { id: p.id, name: p.name, is_default: true },
    stages: [s("s-new", "New lead", 1, "open", 14), s("s-call", "Discovery call", 2, "open", 6), s("s-proposal", "Proposal sent", 3, "open", 4), s("s-won", "Signed", 4, "won", 5), s("s-lost", "Not now", 5, "lost", 3)],
    leads: since ? { total: 26, tagged: 19, untagged: 7 } : { total: 41, tagged: 29, untagged: 12 },
    campaigns: [
      { campaign: "CB-SPRING", leads: 12, open: 7, won: 4, lost: 1, by_stage: { "s-new": 4, "s-call": 2, "s-proposal": 1, "s-won": 4, "s-lost": 1 } },
      { campaign: "CB-PODCAST", leads: 5, open: 4, won: 1, lost: 0, by_stage: { "s-new": 3, "s-call": 1, "s-won": 1 } },
      { campaign: "partner-site", leads: 2, open: 2, won: 0, lost: 0, by_stage: { "s-new": 2 } },
    ],
    ads: [
      { ad: MEDIA_IDS.session, campaign: "CB-SPRING", leads: 11, open: 7, won: 3, lost: 1 },
      { ad: MEDIA_IDS.story, campaign: "CB-PODCAST", leads: 4, open: 3, won: 1, lost: 0 },
      { ad: MEDIA_IDS.workshop, campaign: "CB-SPRING", leads: 3, open: 3, won: 0, lost: 0 },
      { ad: "summer-reel", campaign: null, leads: 1, open: 1, won: 0, lost: 0 },
    ],
    since,
  };
  if (p.id === "p-retainers") return {
    pipeline: { id: p.id, name: p.name, is_default: false },
    stages: [s("r-talk", "Talking", 1, "open", 1), s("r-won", "Renewed", 2, "won", 2)],
    leads: { total: 0, tagged: 0, untagged: 0 }, campaigns: [], ads: [], since,
  };
  return { pipeline: { id: p.id, name: p.name, is_default: false }, stages: p.id === "p-audits" ? [s("a-scope", "Scoping", 1, "open", 0), s("a-done", "Delivered", 2, "won", 0)] : [s("x-intro", "Introduced", 1, "open", 2)], leads: { total: 0, tagged: 0, untagged: 0 }, campaigns: [], ads: [], since };
}
