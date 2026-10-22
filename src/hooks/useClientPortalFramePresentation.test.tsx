import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, expect, it, vi} from "vitest";
const f = vi.hoisted(() => ({rpc: vi.fn(), playbook: vi.fn(), admin: false}));
vi.mock("@/contexts/DashboardModeContext", () => ({useDashboardMode: () => ({isAdmin: f.admin})}));
vi.mock("@/hooks/useFinanceEntitlement", () => ({useFinancePortal: () => ({open: false})}));
vi.mock("@/lib/playbook", async original => ({...(await original<typeof import("@/lib/playbook")>()), usePlaybook: (enabled: boolean) => {
  f.playbook(enabled); return {portal: {modules: [{key: "private-staff-module", label: "Private staff module"}]}};
}}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc: (...args: unknown[]) => f.rpc(...args), auth: {
  getUser: async () => ({data: {user: {id: "test-staff"}}, error: null}), onAuthStateChange: () => ({data: {subscription: {unsubscribe: vi.fn()}}}),
}}}));
import {CustomerIdentityProvider, type CustomerIdentityState} from "@/lib/portal/customerIdentity";
import {readClientPortalFrame} from "@/lib/client-portal-frame";
import {useClientPortalBrandState} from "./useClientPortalBrand";
import {useClientPortalConfigState} from "./useClientPortalConfig";
import {useCustomerPortalNav} from "./useCustomerPortalNav";
const actor = "e0915000-0000-0000-0000-000000000001", a = "e0925000-0000-0000-0000-000000000001", b = "e0925000-0000-0000-0000-000000000002";
function frame(business: string) {return readClientPortalFrame({actor_id: actor,
  profile: {id: "e0935000-0000-0000-0000-000000000001", tenant_id: business, linked_user_id: actor, first_name: "Jordan", last_name: "Test", entity_name: null,
    street_address: null, city: null, state: null, zip_code: null, onboarding_stage: "invited", is_signup_contact: false,
    paige_shared_context_consent: false, paige_shared_context_consent_updated_at: null, updated_at: null, email: "client@tests.invalid", phone: null, contact_methods: []},
  brand: {tenant_id: business, tenant_name: business === a ? "Northwind Studio" : "Harbor Lane", tenant_slug: null, logo_url: null, primary_color: null, support_email: null},
  config: {welcome: {headline: business === a ? "Welcome A" : "Welcome B"}, modules: [{key: "documents", visible: business === a}]},
}, actor)!;}
let root: Root, host: HTMLDivElement, brand: ReturnType<typeof useClientPortalBrandState>, config: ReturnType<typeof useClientPortalConfigState>;
function Probe() {brand = useClientPortalBrandState(); config = useClientPortalConfigState(); return <output>{brand.brand?.tenant_name}:{config.config.welcome?.headline}</output>;}
const render = (state: CustomerIdentityState | null) => act(async () => root.render(state ? <CustomerIdentityProvider state={state}><Probe/></CustomerIdentityProvider> : <Probe/>));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {vi.clearAllMocks(); f.rpc.mockResolvedValue({data: null, error: null}); host = document.createElement("div"); root = createRoot(host);});
afterEach(() => act(() => root.unmount()));
it("uses the original atomic frame's matching brand and config without extra unscoped reads", async () => {
  await render({frame: frame(a), phase: "ready"}); expect(host.textContent).toBe("Northwind Studio:Welcome A"); expect(f.rpc).not.toHaveBeenCalled();
  await render({frame: frame(b), phase: "ready"}); expect(host.textContent).toBe("Harbor Lane:Welcome B"); expect(config.config.modules?.[0].visible).toBe(false); expect(f.rpc).not.toHaveBeenCalled();
});
it("a new/unknown customer scope cannot flash the previous frame or fetch a legacy fallback", async () => {
  await render({frame: frame(a), phase: "ready"}); await render({frame: null, phase: "loading"});
  expect(host.textContent).toBe(":"); expect(brand.loading).toBe(true); expect(config.loading).toBe(true); expect(f.rpc).not.toHaveBeenCalled();
});
it.each(["unavailable", "error", "choose-business"] as const)("%s does not recover another business's brand/config", async phase => {
  await render({frame: frame(a), phase: "ready"}); await render({frame: null, phase});
  expect(brand.brand).toBeNull(); expect(config.config).toEqual({}); expect(f.rpc).not.toHaveBeenCalled();
});
it("keeps original native brand/config readers for actual staff and outside the customer shell", async () => {
  await render({frame: null, phase: "not-client", staff: true}); expect(f.rpc.mock.calls.map(([name]) => name).sort()).toEqual(["get_client_portal_brand", "get_client_portal_config"]);
  await render(null); expect(brand.brand).toBeNull();
});
it("a selected customer, even with a separate staff role, never consumes the owner's retained Playbook catalogue", async () => {
  f.admin = true;
  let nav: ReturnType<typeof useCustomerPortalNav>;
  function Nav() {nav = useCustomerPortalNav(); return null;}
  await act(async () => root.render(<CustomerIdentityProvider state={{frame: frame(a), phase: "ready"}}><Nav/></CustomerIdentityProvider>));
  expect(f.playbook).toHaveBeenLastCalledWith(false); expect(nav!.viewer.isStaff).toBe(false); expect(nav!.viewer.isCustomer).toBe(true);
  expect(JSON.stringify(nav!.sections)).not.toContain("private-staff-module"); expect(f.rpc).not.toHaveBeenCalled(); f.admin = false;
});
