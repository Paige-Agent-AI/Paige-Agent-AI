import { createContext, useContext, type ReactNode } from "react";
const Context = createContext("");
export function ProofTenant({ tenantId, children }: { tenantId: string; children: ReactNode }) { return <Context.Provider value={tenantId}>{children}</Context.Provider>; }
export function useTenantContext() { return { activeTenantId: useContext(Context), activeUserId: "test-actor", accountContextLoading: false, accountContextStatus: "ready" }; }
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: "test-actor" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  rpc: async (name: string, args: { _tenant_id: string }) => {
    if (name !== "can_manage_tenant_brand") throw new Error("Proof adapter permits no business operation");
    if (args._tenant_id === "test-tenant-checking") return new Promise(() => {});
    if (args._tenant_id === "test-tenant-error") return { data: null, error: new Error("Synthetic transport failure") };
    if (args._tenant_id === "test-tenant-denied") return { data: false, error: null };
    if (args._tenant_id === "test-tenant-allowed") return { data: true, error: null };
    throw new Error("Unexpected proof tenant");
  },
};
