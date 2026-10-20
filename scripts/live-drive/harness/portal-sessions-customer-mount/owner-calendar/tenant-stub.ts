// Tenant context for the owner calendar harness: the owner is signed in to ONE workspace, already resolved.
// useSoloDealClients reads the client list only when the tenant it is given IS the active one (§9), so the
// active tenant here matches the activeTenantId the workspace is mounted with in main.tsx.
export const HARNESS_TENANT = "harness-tenant";
export function useTenantContext() {
  return { activeTenantId: HARNESS_TENANT, accountContextLoading: false, loading: false, tenants: [], refresh: async () => undefined };
}
export function TenantContextProvider({ children }: { children: unknown }) { return children; }
