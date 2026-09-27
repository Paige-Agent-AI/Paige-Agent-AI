// Render-harness stand-in for "@/hooks/useTenantContext": one resolved, synthetic workspace.
export function useTenantContext() {
  return { activeTenantId: "tenant-render", loading: false };
}
