// One published form and a workspace with two pipelines. Invented data, labelled as such.
const pipeline = (id: string, name: string, isDefault: boolean) => ({
  id, shortRef: id, folderId: null, folderName: null, name, description: "", isDefault, lifecycleStatus: "active",
  version: 1, createdAt: "", updatedAt: "", createdThrough: null, createdByName: null, requestedByName: null, stageCount: 2, dealCount: 1,
});
const stage = (id: string, pipelineId: string, label: string, orderIndex: number) => ({
  id, pipelineId, label, description: "", orderIndex, archivedAt: null, movePolicy: "direct", stageType: "open", version: 1,
});
export function useSoloCampaigns() {
  return {
    tenantId: "harness-tenant", phase: "ready", campaigns: [], submissions: [],
    artifacts: [{
      id: "form-1", type: "form", name: "Discovery call request", slug: "discovery-call", status: "active",
      updatedAt: "2026-09-28T16:20:00Z", publicHref: "/form/form-1", recentSubmissions: 4, routingConfigured: true,
      routingState: "Active", routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 }, dispatchStatuses: {},
    }],
    pipelineWorkspace: {
      canManage: new URLSearchParams(window.location.search).get("member") !== "1", canArchiveFolders: true, folders: [],
      pipelines: [pipeline("p-sales", "Sales pipeline", true), pipeline("p-ref", "Referrals", false)],
      stages: [stage("s-new", "p-sales", "New inquiry", 1), stage("s-call", "p-sales", "Discovery call", 2), stage("s-ref", "p-ref", "Introduced", 1)],
      deals: [{ id: "deal-1", title: "Jordan Ellis", pipelineId: "p-sales", stageId: "s-new", clientId: "c-1", clientName: "Jordan Ellis", owner: "", status: "open", source: "paige_form", nextAction: "", tags: [], notes: "", createdAt: "", actualCloseDate: null, lostReason: null, outcomes: [], updatedAt: "", version: 1, history: [] }],
      automationRules: [],
    },
    pipelineAction: async () => ({ ok: true, message: "" }),
    retry: () => {},
  };
}
