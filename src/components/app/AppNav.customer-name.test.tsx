import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";

// D-QA5 (live QA as a synthetic customer, 2026-10-19): the header showed the customer's login email where a
// name was known. A customer reads their own name; staff and anyone without a customer frame keep the email.
const f = vi.hoisted(() => ({mobile: false, admin: false}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.admin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => null }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({ useUnreadSupportCount: () => ({ count: 0 }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({
  brand: { tenant_id: "e0923000-0000-0000-0000-000000000001", tenant_name: "Northwind Studio", logo_url: null, primary_color: null },
  loading: false, error: false, multipleBusinesses: false,
}) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: {}, loading: false }) }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: [{ key: "home", label: "Home" }] }, persona: { name: "Owner assistant" } }) }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "u1", email: "jordan.rivera@example.test" } as User;
const frame = (profile: Record<string, string | null>) => ({
  actorId: "u1",
  profile: { id: "c1", tenant_id: "e0923000-0000-0000-0000-000000000001", first_name: null, last_name: null, entity_name: null, ...profile },
  brand: { tenant_id: "e0923000-0000-0000-0000-000000000001", tenant_name: "Northwind Studio" },
  config: {},
}) as unknown as CustomerIdentityState["frame"];

let root: Root, host: HTMLDivElement;
beforeEach(() => {f.mobile = false; f.admin = false; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (state: CustomerIdentityState) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app"]}><CustomerIdentityProvider state={state}><AppNav user={user} /></CustomerIdentityProvider></MemoryRouter>,
  ));
};
const accountName = () => host.querySelector('[data-testid="account-name"]')?.textContent?.trim();

it("shows a customer their own name, not their login email", async () => {
  await render({ frame: frame({ first_name: "Jordan", last_name: "Rivera" }), phase: "ready" });
  expect(accountName()).toBe("Jordan Rivera");
});

it("uses the business name on a record with no person's name", async () => {
  await render({ frame: frame({ entity_name: "Rivera Design LLC" }), phase: "ready" });
  expect(accountName()).toBe("Rivera Design LLC");
});

it("falls back to the email when the record has no name", async () => {
  await render({ frame: frame({}), phase: "ready" });
  expect(accountName()).toBe("jordan.rivera@example.test");
});

it("keeps the email for staff and for a person with no customer frame", async () => {
  await render({ frame: null, phase: "not-client", staff: true, staffAssistantName: "Owner assistant" });
  expect(accountName()).toBe("jordan.rivera@example.test");
  await render({ frame: null, phase: "not-client", staff: false });
  expect(accountName()).toBe("jordan.rivera@example.test");
});
it("a customer who also has a separate staff role gets customer chrome and a full-navigation business choice", async () => {
  f.admin = true;
  await render({frame: frame({first_name: "Jordan"}), phase: "ready"});
  expect(host.querySelector('[data-testid="portal-role-badge"]')?.textContent).toBe("Client");
  const trigger = host.querySelector('[data-testid="account-name"]')!.closest("button")!;
  await act(async () => trigger.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0, ctrlKey: false})));
  const choice = document.querySelector('a[href="/app?chooseBusiness=1"]'); expect(choice?.textContent).toContain("Choose business");
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Support");
});
it("the mobile customer drawer offers the same business-choice entry", async () => {
  f.mobile = true; await render({frame: frame({first_name: "Jordan"}), phase: "ready"});
  await act(async () => (host.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click());
  expect(document.querySelector('a[href="/app?chooseBusiness=1"]')?.textContent).toContain("Choose business");
});
