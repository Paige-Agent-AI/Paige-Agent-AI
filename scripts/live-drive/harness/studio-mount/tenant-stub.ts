// Synthetic workspace for the Studio harness (§63 — no real business).
export function useTenantContext() {
  return { activeTenantId: "t-northwind", activeTenant: { id: "t-northwind", slug: "northwind-studio", name: "Northwind Studio" } };
}
