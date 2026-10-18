import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";

// Synthetic test tenant (Northwind Studio); never a real account.
const f = vi.hoisted(() => ({
  mobile: false,
  isAdmin: false,
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
  brandLoading: false,
  brandError: false,
  multiple: false,
  modules: [{ key: "home", label: "Home" }] as { key: string; label: string }[],
  overlay: undefined as undefined | { key: string; visible?: boolean; order?: number }[],
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.isAdmin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => <span>Paige</span> }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({ useUnreadSupportCount: () => ({ count: 0 }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: f.brandLoading, error: f.brandError, multipleBusinesses: f.multiple }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: { modules: f.overlay }, loading: false }) }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: f.modules }, persona: { name: "Paige" } }) }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "u1", email: "jordan.rivera@example.test" } as User;
let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/app"]}><AppNav user={user} /></MemoryRouter>));
};
const navOrder = () => Array.from(host.querySelectorAll("a")).map(a => a.getAttribute("href")).filter(h => h?.startsWith("/app"));

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.brandLoading = false; f.brandError = false; f.multiple = false;
  f.modules = [{ key: "home", label: "Home" }];
  f.overlay = undefined;
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000002", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

// E09 Slice 6: "Account" is the customer's own record at ONE business, shown with Messages and Sessions.
const openMenu = async () => {
  f.mobile = true; await render();
  await act(async () => (document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click());
  return Array.from(document.querySelectorAll('nav[aria-label="Customer navigation"] button')).map(b => b.textContent?.trim());
};

it("a customer of one business gets Account in the phone menu", async () => {
  expect(await openMenu()).toContain("Account");
});

it("staff never get Account (it would open a customer page that can't resolve)", async () => {
  f.brand = null; f.isAdmin = true;
  expect(await openMenu()).not.toContain("Account");
});

it("no Account while the relationship resolves, or after it failed to (not 'not a customer', not 'a customer' either)", async () => {
  f.brandLoading = true;
  expect(await openMenu()).not.toContain("Account");
  act(() => root.unmount()); root = createRoot(host);
  f.brandLoading = false; f.brandError = true;
  expect(await openMenu()).not.toContain("Account");
});

it("a customer of more than one business is not offered Account; that page is reachable by URL only until choosing a business ships (reviewer Minor 5)", async () => {
  f.brand = null; f.multiple = true;
  expect(await openMenu()).not.toContain("Account");
});
