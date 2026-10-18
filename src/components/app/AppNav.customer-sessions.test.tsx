import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";
import { closeMenus, desktopNavHrefs, openGroup } from "./appNavTestUtils";

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
// Slice M: the desktop bar groups entries; a group of two or more is a menu whose links mount only while open,
// so these read every destination by opening each group (appNavTestUtils), as a keyboard user would.
const navOrder = () => desktopNavHrefs(host);
const sessionsCount = async () => (await navOrder()).filter(h => h === "/app/sessions").length;
const sessionsLabel = async () => {
  const items = await openGroup("Your work");
  const text = items.find(i => i.getAttribute("href") === "/app/sessions")?.textContent?.trim();
  await closeMenus();
  return text;
};

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.brandLoading = false; f.brandError = false; f.multiple = false;
  f.modules = [{ key: "home", label: "Home" }];
  f.overlay = undefined;
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000002", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await closeMenus(); act(() => root.unmount()); host.remove(); });

// Slice M (owner ruling 2026-10-18): Sessions sits in "Your work" after Progress and Action items. Before
// Slice M it was injected right after Messages; the destination set is unchanged (§58, presentation only).
it("gives a customer of one business a Sessions entry in Your work, even when the Playbook predates the key", async () => {
  await render();
  expect(await sessionsCount()).toBe(1);
  expect(await sessionsLabel()).toContain("Sessions");
  const order = await navOrder();
  expect(order.indexOf("/app/sessions")).toBe(order.indexOf("/app/actions") + 1);
});

it("places Sessions where the Playbook lists it, exactly once", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }, { key: "learn", label: "Resources" }];
  await render();
  expect(await sessionsCount()).toBe(1);
  const order = await navOrder();
  expect(order.indexOf("/app/sessions")).toBeLessThan(order.indexOf("/app/learn"));
});

it("respects the business's portal overlay hiding Sessions", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }];
  f.overlay = [{ key: "sessions", visible: false }];
  await render();
  expect(await sessionsCount()).toBe(0);
});

it("respects the overlay even when the Playbook predates the key", async () => {
  f.overlay = [{ key: "sessions", visible: false }];
  await render();
  expect(await sessionsCount()).toBe(0);
});

it("never shows Sessions to staff, even when the Playbook lists it", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }];
  f.brand = null; f.isAdmin = true;
  await render();
  expect(await sessionsCount()).toBe(0);
});

it("never shows Sessions to a customer of more than one business", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }];
  f.brand = null; f.multiple = true;
  await render();
  expect(await sessionsCount()).toBe(0);
});

it("shows no Sessions while the relationship resolves or after it failed to", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }];
  f.brandLoading = true;
  await render();
  expect(await sessionsCount()).toBe(0);
  f.brandLoading = false; f.brandError = true;
  await render();
  expect(await sessionsCount()).toBe(0);
});

it("lists Sessions in the customer's mobile menu", async () => {
  f.mobile = true;
  await render();
  await act(async () => (document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click());
  const labels = Array.from(document.querySelectorAll('nav[aria-label="Customer navigation"] button')).map(b => b.textContent?.trim());
  expect(labels).toContain("Sessions");
});

it("lets the business's overlay reorder Sessions, which only a routed catalog key allows", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }];
  f.overlay = [{ key: "sessions", order: -1 }];
  await render();
  const order = await navOrder();
  expect(order.indexOf("/app/sessions")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("/app/sessions")).toBeLessThan(order.indexOf("/app/actions"));
});
