// Harness-only: one fictional canonical SOLO workspace (account_type standalone, so the §60 tier helper
// gives it Team Hub agents, as the real Solo shell does).
export const useTenantContext = () => ({
  activeTenant: { id: "t-harness", account_type: "standalone", parent_tenant_id: null }, activeTenantId: "t-harness", activeUserId: "u-me",
  loading: false, accountContextStatus: "ready", refresh: () => undefined, isPlatformStaff: false,
});
