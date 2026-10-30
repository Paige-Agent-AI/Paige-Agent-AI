// Harness-only: two fictional canonical SOLO workspaces (account_type standalone, so the §60 tier helper
// gives them Team Hub agents, as the real Solo shell does). `t=b` selects the second one; every Team Hub
// read the hub makes then carries its id as p_expected_tenant (recorded by the double).
const b = new URLSearchParams(location.search).get("t") === "b";
const tenant = b ? { id: "t-harness-b", account_type: "standalone", parent_tenant_id: null, account_number: 4120 }
  : { id: "t-harness", account_type: "standalone", parent_tenant_id: null, account_number: 3855 };
export const useTenantContext = () => ({
  activeTenant: tenant, activeTenantId: tenant.id, activeUserId: "u-me",
  loading: false, accountContextStatus: "ready", refresh: () => undefined, isPlatformStaff: false,
});
