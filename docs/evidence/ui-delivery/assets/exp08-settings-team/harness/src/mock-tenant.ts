const q = new URLSearchParams(location.search);
export function useTenantContext() {
  return { activeTenantId: "t-northstar", activeUserId: q.get("viewer") === "admin" ? "u-dana" : q.get("viewer") === "theo" ? "u-theo" : "u-morgan", activeTenant: { id: "t-northstar", name: "Northstar Studio" }, loading: false, accountContextStatus: "ready", refresh: () => undefined };
}
