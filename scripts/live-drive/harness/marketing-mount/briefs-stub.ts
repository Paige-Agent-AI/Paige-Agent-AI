// Replaces only the owner-briefs read. A fictional business's briefs (§63).
import { mode } from "./mode";

const brief = (id: string, name: string, extra: Record<string, unknown>) => ({
  id, shortRef: null, name, objective: null, audience: null, positioning: null, channels: [],
  desiredOutcome: null, successDefinition: null, budgetTarget: null, timing: null, constraints: null,
  contentNeeds: null, conversionDestination: null, followupPath: null, lifecycleStatus: "draft",
  blocker: null, offerId: null, offerName: null, pipelineId: null, pipelineName: null, pipelineDealCount: 0,
  missionId: null, version: 1, createdThrough: "human", createdAt: null, updatedAt: null, ...extra,
});

const BRIEFS = [
  brief("b1", "Spring advisory intake", { createdAt: new Date(Date.now() - 12 * 86400000).toISOString(), shortRef: "CB-SPRING", lifecycleStatus: "active", timing: "Weeks 1–4 of April", objective: "Book 8 discovery calls from past webinar attendees" }),
  brief("b2", "Q2 retainer upgrade", { lifecycleStatus: "ready_for_review", timing: "Mid-May", objective: "Move 3 project clients onto a monthly retainer" }),
  brief("b3", "Podcast guest series", { shortRef: "CB-PODCAST", lifecycleStatus: "blocked", blocker: "No capture form chosen yet", timing: "June" }),
  brief("b4", "Winter workshop follow-up", { lifecycleStatus: "completed", timing: "January" }),
  brief("b5", "Referral partner outreach", { lifecycleStatus: "draft" }),
];

export function useSoloCampaignBriefs() {
  const phase = mode === "loading" ? "loading" : mode === "error" ? "error" : "ready";
  return {
    tenantId: "t", phase, briefs: mode === "populated" || mode === "readonly" ? BRIEFS : [], archivedCount: 0,
    canManage: mode !== "readonly",
    retry: () => {}, saveBrief: async () => ({ ok: true, message: "Saved." }),
    transitionBrief: async () => ({ ok: true, message: "Saved." }), archiveBrief: async () => ({ ok: true, message: "Saved." }),
  };
}
