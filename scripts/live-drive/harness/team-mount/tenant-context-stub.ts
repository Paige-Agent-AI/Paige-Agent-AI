import { useSyncExternalStore } from "react";

// Two workspaces, so a drive can prove the Team screen on a second known-good tenant and across a
// live workspace switch. `?tenant=harbor` opens on the second; the default is unchanged, so every
// existing drive against this harness sees exactly what it saw before.
export const WORKSPACES = { "team-harness-tenant": "Northstar Studio", "team-harness-tenant-2": "Harbor Wellness" } as const;
export type WorkspaceId = keyof typeof WORKSPACES;

let active: WorkspaceId = new URLSearchParams(window.location.search).get("tenant") === "harbor" ? "team-harness-tenant-2" : "team-harness-tenant";
const listeners = new Set<() => void>();
export const activeWorkspace = () => active;
export function switchWorkspace(id: WorkspaceId) { active = id; listeners.forEach((listener) => listener()); }
// The drive switches workspace the way the shell does: the tenant context changes under a mounted screen.
(window as unknown as { __switchWorkspace: (to: string) => void }).__switchWorkspace = (to) =>
  switchWorkspace(to === "harbor" ? "team-harness-tenant-2" : "team-harness-tenant");

export function useTenantContext() {
  const id = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => active);
  return { activeTenantId: id, activeTenant: { id, name: WORKSPACES[id] }, tenants: [], loading: false, isPlatformStaff: false };
}
export default { useTenantContext };
