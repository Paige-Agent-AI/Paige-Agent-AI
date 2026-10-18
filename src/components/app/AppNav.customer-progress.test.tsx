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
const progressLinks = () => host.querySelectorAll('a[href="/app/progress"]');
const navOrder = () => Array.from(host.querySelectorAll("a")).map(a => a.getAttribute("href")).filter(h => h?.startsWith("/app"));

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.brandLoading = false; f.brandError = false; f.multiple = false;
  f.modules = [{ key: "home", label: "Home" }];
  f.overlay = undefined;
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000002", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("gives a customer of one business a Progress entry, after Sessions, even when the Playbook predates the key", async () => {
  await render();
  expect(progressLinks()).toHaveLength(1);
  expect(progressLinks()[0].textContent).toContain("Progress");
  const order = navOrder();
  expect(order.indexOf("/app/progress")).toBe(order.indexOf("/app/sessions") + 1);
});

it("places Progress where the Playbook lists it, exactly once, with the Playbook's label", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "progress", label: "Your progress" }, { key: "learn", label: "Resources" }];
  await render();
  expect(progressLinks()).toHaveLength(1);
  expect(progressLinks()[0].textContent).toContain("Your progress");
  const order = navOrder();
  expect(order.indexOf("/app/progress")).toBeLessThan(order.indexOf("/app/learn"));
});

it("respects the business's portal overlay hiding Progress", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "progress", label: "Progress" }];
  f.overlay = [{ key: "progress", visible: false }];
  await render();
  expect(progressLinks()).toHaveLength(0);
});

it("respects the overlay even when the Playbook predates the key", async () => {
  f.overlay = [{ key: "progress", visible: false }];
  await render();
  expect(progressLinks()).toHaveLength(0);
});

it("still lands Progress after Messages when the overlay hides Sessions", async () => {
  f.overlay = [{ key: "sessions", visible: false }];
  await render();
  const order = navOrder();
  expect(order.indexOf("/app/sessions")).toBe(-1);
  expect(order.indexOf("/app/progress")).toBe(order.indexOf("/app/messages") + 1);
});

it("never shows Progress to staff, even when the Playbook lists it", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "progress", label: "Progress" }];
  f.brand = null; f.isAdmin = true;
  await render();
  expect(progressLinks()).toHaveLength(0);
});

it("never shows Progress to a customer of more than one business", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "progress", label: "Progress" }];
  f.brand = null; f.multiple = true;
  await render();
  expect(progressLinks()).toHaveLength(0);
});

it("shows no Progress while the relationship resolves or after it failed to", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "progress", label: "Progress" }];
  f.brandLoading = true;
  await render();
  expect(progressLinks()).toHaveLength(0);
  f.brandLoading = false; f.brandError = true;
  await render();
  expect(progressLinks()).toHaveLength(0);
});

it("lists Progress in the customer's mobile menu", async () => {
  f.mobile = true;
  await render();
  await act(async () => (document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click());
  const labels = Array.from(document.querySelectorAll('nav[aria-label="Customer navigation"] button')).map(b => b.textContent?.trim());
  expect(labels).toContain("Progress");
});
