// Harness-only: one fictional canonical SOLO workspace (account_type standalone, so the §60 tier helper
// gives it Team Hub agents, as the real Solo shell does). account_number (the repo's sample 3855) lets the
// A2a task card build its /solo/{n}/operations/work link; no frozen A2 frame carries a task card.
export const useTenantContext = () => ({
  activeTenant: { id: "t-harness", account_type: "standalone", parent_tenant_id: null, account_number: 3855 }, activeTenantId: "t-harness", activeUserId: "u-me",
  loading: false, accountContextStatus: "ready", refresh: () => undefined, isPlatformStaff: false,
});
