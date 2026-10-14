export const tenantId = "11111111-1111-4111-8111-111111111111";
export function useTenantContext() { return { activeTenantId: tenantId, accountType: "standalone", activeAccountType: "standalone", parentTenantId: null, isPlatformOwner: false, loading: false }; }
