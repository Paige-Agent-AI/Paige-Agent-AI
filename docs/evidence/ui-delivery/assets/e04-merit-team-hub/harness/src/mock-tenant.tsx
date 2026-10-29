import { createContext, useContext, useState, type ReactNode } from "react";
// Two FICTIONAL source-render contexts; neither is an authenticated account.
const contexts = [
  { id: "t-harness", account_number: 4242424, name: "Offline consultant fixture" },
  { id: "t-harness-control", account_number: 4343434, name: "Offline creative control fixture" },
];
let selected = new URLSearchParams(location.search).get("cohort") === "b" ? 1 : 0;
export const fixtureTenant = () => contexts[selected];
const FixtureContext = createContext({ index: selected, switchFixture: () => contexts[0].account_number });
export function FixtureTenantProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(selected);
  return <FixtureContext.Provider value={{ index, switchFixture: () => {
    selected = selected === 0 ? 1 : 0; setIndex(selected); return contexts[selected].account_number;
  } }}>{children}</FixtureContext.Provider>;
}
export const useFixtureSwitch = () => useContext(FixtureContext).switchFixture;
export function useTenantContext() {
  const { index } = useContext(FixtureContext), activeTenant = {
    ...contexts[index], account_type: "standalone", parent_tenant_id: null,
  };
  return { activeTenant, activeTenantId: activeTenant.id, activeUserId: "u-me", loading: false,
    accountContextLoading: false, accountContextStatus: "ready", refresh: () => undefined,
    isPlatformStaff: false, isPlatformOwner: false, tenants: [], soloShellEnabled: true };
}
export const useOptionalTenantContext = useTenantContext;
