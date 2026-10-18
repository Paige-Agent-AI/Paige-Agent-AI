import { createContext, useContext } from "react";
export const TenantContext = createContext({ loading: false, isPlatformStaff: false, activeTenantId: "tenant-a", activeTenant: { account_number: "test-tenant-a" }, activeTenants: [] });
export function useTenantContext() { return useContext(TenantContext); }
export const useTenantContextActAs = useTenantContext;
