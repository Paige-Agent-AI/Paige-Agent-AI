// MOCK THE PROVIDER, NEVER THE CONTRACT. Replaces only the Campaigns read; every component under
// test is the real one. Fixtures are a fictional business, never an owner's real account (§63).
import { mode } from "./mode";

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();
const form = (id: string, name: string, recent: number, routed: boolean) => ({
  id, type: "form", name, slug: id, status: "active", updatedAt: daysAgo(2), publicHref: `/form/${id}`,
  recentSubmissions: recent, routingConfigured: routed, routingState: routed ? "Active" : "No route",
  routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 }, dispatchStatuses: {},
});
const page = (id: string, name: string) => ({
  id, type: "page", name, slug: id, status: "published", updatedAt: daysAgo(4), publicHref: `/p/harbor-pine/${id}`,
  recentSubmissions: 0, routingConfigured: false, routingState: "No route", routingTargets: [],
  recentDispatches: { succeeded: 0, failed: 0, other: 0 }, dispatchStatuses: {},
});
const submission = (id: string, formId: string, days: number, source: string | null, campaign: string | null, dealId: string | null, contactId: string | null) => ({
  id, formId, source: "paige_form", state: "done", createdAt: daysAgo(days), contactId, dealId,
  trackingSource: source, trackingCampaign: campaign,
});

const populated = {
  artifacts: [form("f1", "Discovery call request", 14, true), form("f2", "Scorecard opt-in", 6, false), page("p1", "Advisory scorecard landing page")],
  drafts: [{ id: "p2", type: "page", name: "Retainer upgrade page", updatedAt: daysAgo(1) }],
  submissions: [
    submission("s1", "f1", 1, "newsletter", "CB-SPRING", "d1", "c1"),
    submission("s2", "f1", 2, "newsletter", "CB-SPRING", "d2", "c2"),
    submission("s3", "f2", 3, "instagram", null, null, "c3"),
    submission("s4", "f1", 5, "linkedin", "CB-SPRING", "d3", "c4"),
    submission("s5", "f2", 6, null, null, null, "c5"),
    submission("s6", "f1", 9, "newsletter", null, null, "c6"),
    submission("s7", "f2", 12, "instagram", "CB-PODCAST", null, "c7"),
    submission("s8", "f1", 45, "linkedin", null, null, "c8"),
  ],
};

export function useSoloCampaigns() {
  const base = {
    tenantId: "t", campaigns: [],
    pipelineWorkspace: { canManage: mode !== "readonly", canArchiveFolders: true, folders: [], pipelines: [], stages: [], deals: [], automationRules: [] },
    pipelineAction: async () => ({ ok: true, message: "" }),
    retry: () => {},
  };
  if (mode === "loading") return { ...base, phase: "loading", artifacts: [], drafts: [], submissions: [] };
  if (mode === "error") return { ...base, phase: "error", artifacts: [], drafts: [], submissions: [] };
  if (mode === "first") return { ...base, phase: "ready", artifacts: [], drafts: [], submissions: [] };
  return { ...base, phase: "ready", ...populated };
}
