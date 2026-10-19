import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";
import { closeMenus, desktopNavHrefs, openGroup } from "./appNavTestUtils";

// E09 Slice 5 on the Slice M menu: the catalog key is `billing`; the customer-facing name is "Payments" (owner,
// 2026-10-18). Synthetic test tenant (Northwind Studio); never a real account.
type Overlay = { key: string; visible?: boolean; order?: number; label?: string };
const f = vi.hoisted(() => ({
  mobile: false,
  isAdmin: false,
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
  multiple: false,
  modules: [] as { key: string; label: string }[],
  config: {} as { modules?: Overlay[] },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.isAdmin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => <span>Paige</span> }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({ useUnreadSupportCount: () => ({ count: 0 }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: false, error: false, multipleBusinesses: f.multiple }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: f.config, loading: false }) }));
vi.mock("@/lib/playbook", async (orig) => ({ ...(await orig<typeof import("@/lib/playbook")>()), usePlaybook: () => ({ portal: { modules: f.modules }, persona: { name: "Paige" } }) }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "u1", email: "jordan.rivera@example.test" } as User;
let root: Root, host: HTMLDivElement;
const render = async (path = "/app") => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><AppNav user={user} /></MemoryRouter>));
};

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.multiple = false; f.config = {};
  f.modules = [{ key: "home", label: "Home" }];
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000002", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await closeMenus(); act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

it("places Payments in Paperwork where the Playbook lists billing, once, named Payments whatever the catalog calls it", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }, { key: "learn", label: "Resources" }];
  await render();
  const hrefs = await desktopNavHrefs(host);
  expect(hrefs.filter((h) => h === "/app/billing")).toHaveLength(1);
  expect(hrefs.indexOf("/app/billing")).toBeLessThan(hrefs.indexOf("/app/learn"));
  const paperwork = await openGroup("Paperwork");
  const pay = paperwork.find((i) => i.getAttribute("href") === "/app/billing");
  expect(pay?.querySelector("[data-portal-label]")?.textContent).toBe("Payments");
  expect(host.textContent + document.body.textContent).not.toContain("Billing");
});

it("is never force-injected: a Playbook without billing has no Payments entry", async () => {
  await render();
  expect(await desktopNavHrefs(host)).not.toContain("/app/billing");
});

it("respects the business's portal overlay hiding it", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }];
  f.config = { modules: [{ key: "billing", visible: false }] };
  await render();
  expect(await desktopNavHrefs(host)).not.toContain("/app/billing");
});

it("is shown only to a customer of one business", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }];
  f.multiple = true;
  await render();
  expect(await desktopNavHrefs(host)).not.toContain("/app/billing");
  act(() => root.unmount()); root = createRoot(host);
  f.multiple = false; f.brand = null; f.isAdmin = true;
  await render();
  expect(await desktopNavHrefs(host)).not.toContain("/app/billing");
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("stays the active entry on an invoice's own page, on desktop and in the phone menu", async () => {
  f.modules = [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }];
  const paperworkActive = () => document.querySelector('button[data-portal-group="Paperwork"]')?.getAttribute("data-active") === "true";
  await render("/app/billing/e0950000-0000-4000-9000-000000000001");
  expect(paperworkActive()).toBe(true);
  const items = await openGroup("Paperwork");
  expect(items.find((i) => i.getAttribute("href") === "/app/billing")?.getAttribute("aria-current")).toBe("page");
  expect(items.find((i) => i.getAttribute("href") === "/app/documents")?.getAttribute("aria-current")).toBeNull();
  expect(host.querySelector('a[href="/app"]')?.getAttribute("aria-current")).toBeNull();
  await closeMenus();
  act(() => root.unmount()); root = createRoot(host);
  // A sibling route that merely starts with the same letters is not the same section.
  await render("/app/billing-history");
  expect(paperworkActive()).toBe(false);
  act(() => root.unmount()); root = createRoot(host);
  f.mobile = true;
  await render("/app/billing/e0950000-0000-4000-9000-000000000001");
  await act(async () => { (document.querySelector('[aria-label="Open navigation"]') as HTMLButtonElement).click(); });
  const item = Array.from(document.querySelectorAll("nav[aria-label='Customer navigation'] button")).find((b) => b.textContent?.includes("Payments"));
  expect(item?.getAttribute("aria-current")).toBe("page");
});
