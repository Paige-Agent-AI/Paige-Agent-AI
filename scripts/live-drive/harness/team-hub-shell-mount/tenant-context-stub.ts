/**
 * The tenant seam for the Team Hub real-shell mount, answered from a small store so a drive can SWITCH
 * workspace the way the app does: the active tenant changes, every subscriber re-renders, and SoloApp's own
 * redirect moves the address to the new account (it is never typed into the URL by the drive).
 *
 * Two fictional canonical SOLO workspaces with distinct account numbers. Neither is an owner business
 * account (§63). `?tenant=b` starts on the second one; `window.__harnessSwitchTenant("b")` switches.
 */
import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";

const base = {
  slug: "", status: "active", plan_offer: null, seat_limit: 5, customer_limit: 100, account_type: "standalone",
  parent_tenant_id: null, owner_user_id: "u-me", revenue_class: null,
  // Setup done, so the shell's own readiness notice (a real element, shown only before Setup) is not in the frame.
  features: { solo_setup_complete: true, solo_shell_enabled: true },
};
export const HARNESS_TENANTS = {
  a: { ...base, id: "t-harbor-lane", slug: "harbor-lane", name: "Harbor Lane Studio", account_number: 3855 },
  b: { ...base, id: "t-juniper-row", slug: "juniper-row", name: "Juniper Row Consulting", account_number: 4120 },
} as const;
type Key = keyof typeof HARNESS_TENANTS;

let active: Key = new URLSearchParams(window.location.search).get("tenant") === "b" ? "b" : "a";
const listeners = new Set<() => void>();
export function harnessActiveTenant() { return HARNESS_TENANTS[active]; }
function setActive(next: Key) { active = next; for (const listener of listeners) listener(); }
(window as unknown as { __harnessSwitchTenant: (key: Key) => void }).__harnessSwitchTenant = setActive;

const state = (key: Key) => {
  const tenant = HARNESS_TENANTS[key];
  return {
    loading: false, accountContextLoading: false, accountContextStatus: "ready" as const,
    isPlatformOwner: false, isPlatformStaff: false,
    tenants: [HARNESS_TENANTS.a, HARNESS_TENANTS.b],
    activeUserId: "u-me", activeTenantId: tenant.id, activeTenant: tenant,
    soloShellEnabled: true, agencyShellEnabled: false,
    switchTenant: async (id: string | null) => { const key = (Object.keys(HARNESS_TENANTS) as Key[]).find((k) => HARNESS_TENANTS[k].id === id); if (key) setActive(key); return Boolean(key); },
    exitOperatorActAs: async () => true,
    exitOperatorActAsFrom: async () => "exited" as const,
    enterOperatorActAs: async () => "refused" as const,
    probeOperatorActAs: async () => "not_acting" as const,
    endActAsBeforeSignOut: async () => "clear" as const,
    refresh: async () => undefined,
  };
};
const snapshots = { a: state("a"), b: state("b") };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useTenantContext() {
  return useSyncExternalStore(subscribe, () => snapshots[active]);
}
export const useOptionalTenantContext = useTenantContext;
export function TenantProvider({ children }: { children?: ReactNode }) { return createElement(Fragment, null, children); }
export default { useTenantContext, TenantProvider };
