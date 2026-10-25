/**
 * The tenant seam for the Social tab's data hook, answered deterministically (EXP07 row 9).
 * `useSocialCommand` reads `useTenantContext` for the active workspace; Marketing's other tabs
 * never touch it, so the stub answers the one consumer. The tenant id matches the rows the
 * planned-supabase-stub serves (t-northfield), so presence and campaigns agree on one workspace.
 */
const HARNESS_TENANT = { id: "t-northfield", account_number: "1971670", name: "Northfield Studio", slug: "northfield-studio" };

export function useTenantContext() {
  return {
    activeTenantId: HARNESS_TENANT.id,
    loading: false,
    accountContextLoading: false,
    activeTenant: HARNESS_TENANT,
    tenants: [HARNESS_TENANT],
    isPlatformStaff: false,
  };
}

/** The real module's provider; nothing in the stub needs context, so this is a passthrough. */
export function TenantProvider({ children }: { children: React.ReactNode }) {
  return children;
}

/** The real module's optional context (null outside a provider); the stub answers the same shape. */
export function useOptionalTenantContext() {
  return useTenantContext();
}
