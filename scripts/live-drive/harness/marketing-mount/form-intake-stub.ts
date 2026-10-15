// Replaces only the form panel's own read (useFormIntake). Fictional submissions (§63). The panel,
// its editor and its submission list are the real components; saving resolves without a write.
export * from "@/solo/useFormIntake";
export { FORM_INTAKE_PAGE_SIZE } from "@/solo/useFormIntake";

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3600000).toISOString();

export function useFormIntake(_tenantId: string | null, formId: string) {
  const routed = formId === "f1";
  return {
    phase: "ready" as const, canEdit: true, loadMoreFailed: false,
    settings: { autoCreateDeal: routed, pipelineId: routed ? "pl1" : null, stageId: null, notifyEmail: null },
    fields: [{ key: "name", label: "Name", type: "text" }, { key: "email", label: "Work email", type: "email" }],
    submissions: [
      { id: `${formId}-s1`, createdAt: ago(3), state: "done", contactId: "c1", dealId: routed ? "d1" : null, alertSentAt: null, alertSkippedReason: null, answers: { name: "Jordan Ellis", email: "jordan@example.com" } },
      { id: `${formId}-s2`, createdAt: ago(27), state: "done", contactId: "c2", dealId: null, alertSentAt: null, alertSkippedReason: null, answers: { name: "Sam Rivera", email: "sam@example.com" } },
    ],
    hasMore: false, loadingMore: false, retry: () => {}, loadMore: () => {},
    save: async () => ({ ok: true, message: "Saved" }),
  };
}
