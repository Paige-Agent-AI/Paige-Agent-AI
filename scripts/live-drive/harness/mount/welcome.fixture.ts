// Render-only adapter. No SDK import, HTTP, Auth principal, provisioning or provider effects.
import { useSyncExternalStore } from "react";
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "read-error";
const tenant = { id: "test-tenant-render", account_type: "standalone", parent_tenant_id: null, account_number: 123, name: "Synthetic workspace" };
const listeners = new Set<() => void>();
let attempt = 0;
let context = { accountContextLoading: false, accountContextStatus: "ready", activeUserId: "test-user-render", activeTenantId: null as string | null, activeTenant: null as typeof tenant | null, tenants: [] as typeof tenant[], refresh: async () => {
  if (scenario === "pending") return await new Promise<void>(() => undefined);
  context = { ...context, activeTenantId: tenant.id, activeTenant: tenant, tenants: [tenant] };
  listeners.forEach(listener => listener());
} };
export function useTenantContext() { return useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => context); }
const user = { id: "test-user-render" };
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: scenario === "signed-out" ? null : { user } }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
  functions: { invoke: async (name: string) => {
    if (name !== "solo-beta-enrollment-status") return { data: null, error: new Error("No effects in render harness") };
    attempt++;
    return { data: { state: "verified", reference_id: "synthetic-reference", retryable: true, destination: "/solo/123/command-center" }, error: null };
  } },
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    if (scenario === "read-error" || (scenario === "retry" && attempt === 1)) return { data: null, error: new Error("Synthetic unavailable read") };
    return { data: table === "profiles" ? { user_id: user.id, active_tenant_id: tenant.id } : tenant, error: null };
  } }) }) }),
  rpc: async () => ({ data: tenant.id, error: null }),
};
