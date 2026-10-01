import { useSyncExternalStore } from "react";

const contexts = [
  { id: "test-tenant-incoming-a", account_number: "test-account-a", name: "Test workspace A" },
  { id: "test-tenant-incoming-b", account_number: "test-account-b", name: "Test workspace B" },
];
let current = 0;
const listeners = new Set<() => void>();
window.addEventListener("incoming-harness-switch", () => {
  current = current === 0 ? 1 : 0;
  listeners.forEach(notify => notify());
});
export const currentTenant = () => contexts[current];
export function useTenantContext() {
  const index = useSyncExternalStore(notify => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => current);
  return { activeTenantId: contexts[index].id, activeTenant: contexts[index], tenants: contexts,
    activeUserId: `test-owner-${index}`, loading: false, isPlatformStaff: false };
}
export const useOptionalTenantContext = useTenantContext;
export default { useTenantContext, useOptionalTenantContext };
