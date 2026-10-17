import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";

const f = vi.hoisted(() => ({
  mobile: false,
  isAdmin: false,
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
  brandLoading: false,
  brandError: false,
  unreadArg: [] as (string | null)[],
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.isAdmin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => <span>Paige</span> }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({
  useUnreadSupportCount: (id: string | null) => { f.unreadArg.push(id); return { count: id ? 2 : 0 }; },
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: f.brandLoading, error: f.brandError }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: {}, loading: false }) }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ portal: { modules: [{ key: "home", label: "Home" }] }, persona: { name: "Paige" } }) }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "u1", email: "customer@example.test" } as User;
let root: Root, host: HTMLDivElement;
function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; }
const render = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/app"]}><AppNav user={user} /><Where /></MemoryRouter>));
};
const where = () => host.querySelector('[data-testid="where"]')?.textContent;
const topBarButton = (name: string) => Array.from(host.querySelectorAll("button"))
  .find(b => b.getAttribute("aria-label") === name || b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const openMobileMenu = async () => {
  await act(async () => (document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click());
};
const menuLabels = () => Array.from(document.querySelectorAll('nav[aria-label="Customer navigation"] button')).map(b => b.textContent?.trim());

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.brandLoading = false; f.brandError = false; f.unreadArg = [];
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000001", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("gives a customer an always-on Messages entry in the desktop nav", async () => {
  await render();
  const link = host.querySelector('a[href="/app/messages"]');
  expect(link?.textContent).toContain("Messages");
  expect(host.querySelector('a[href="/app/actions"]')).not.toBeNull();
});

it("replaces platform Support with Get help in the customer's mobile menu", async () => {
  f.mobile = true;
  await render();
  await openMobileMenu();
  const labels = menuLabels();
  expect(labels).toContain("Get help");
  expect(labels).toContain("Messages");
  expect(labels.some(l => l?.startsWith("Support"))).toBe(false);
  // The platform support unread plumbing never runs for a customer.
  expect(f.unreadArg.every(a => a === null)).toBe(true);
});

it("keeps platform Support (with its unread badge) for staff without a customer relationship", async () => {
  f.mobile = true; f.brand = null; f.isAdmin = true;
  await render();
  await openMobileMenu();
  const labels = menuLabels();
  expect(labels.some(l => l?.startsWith("Support"))).toBe(true);
  expect(labels).not.toContain("Get help");
  expect(labels).not.toContain("Messages");
  expect(f.unreadArg).toContain("u1");
});

it("shows neither help destination until the relationship resolves", async () => {
  f.mobile = true; f.brandLoading = true; f.brand = null;
  await render();
  await openMobileMenu();
  const labels = menuLabels();
  expect(labels).not.toContain("Get help");
  expect(labels.some(l => l?.startsWith("Support"))).toBe(false);
});

it("points the always-visible top-bar contact at the customer's own business, by name", async () => {
  await render();
  expect(topBarButton("Contact Advisor")).toBeUndefined();
  const btn = topBarButton("Message Northwind Studio")!;
  expect(btn.textContent).toContain("Message Northwind Studio");
  await act(async () => btn.click());
  expect(where()).toBe("/app/messages");
});

it("falls back to 'Message your team' when the business has no name on file", async () => {
  f.brand = { ...f.brand!, tenant_name: "  " };
  await render();
  expect(topBarButton("Message your team")).toBeDefined();
});

it("keeps Contact Advisor for a signed-in non-customer and gives them no Messages link", async () => {
  f.brand = null;
  await render();
  expect(topBarButton("Contact Advisor")).toBeDefined();
  expect(host.querySelector('a[href="/app/messages"]')).toBeNull();
});

it("shows no Messages link while the relationship is still resolving", async () => {
  f.brandLoading = true; f.brand = null;
  await render();
  expect(host.querySelector('a[href="/app/messages"]')).toBeNull();
  expect(topBarButton("Contact Advisor")).toBeUndefined();
});

it("on a failed brand read shows neither platform Support nor customer-only entries", async () => {
  f.brand = null; f.brandError = true; f.mobile = true;
  await render();
  await openMobileMenu();
  const labels = menuLabels();
  expect(labels).not.toContain("Get help");
  expect(labels).not.toContain("Messages");
  expect(labels.some(l => l?.startsWith("Support"))).toBe(false);
  expect(f.unreadArg.every(a => a === null)).toBe(true);
});

it("on a failed brand read the desktop bar offers no contact destination that could be wrong", async () => {
  f.brand = null; f.brandError = true;
  await render();
  expect(topBarButton("Contact Advisor")).toBeUndefined();
  expect(host.querySelector('a[href="/app/messages"]')).toBeNull();
});
