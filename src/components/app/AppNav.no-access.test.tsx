import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";
import { AppNav } from "./AppNav";
import { closeMenus, desktopNavHrefs } from "./appNavTestUtils";

// E09 CURA round 3 (verifier 7 + compliance): a person whose portal access is not active (no customer frame,
// not staff) was offered Action items and Resources, pages that have nothing for them. They get Home only, and
// the menu waits until the shell knows who they are, so those entries never appear and then vanish.
// Synthetic people and business only.
const f = vi.hoisted(() => ({
  isAdmin: false,
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.isAdmin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => <span>Mark</span> }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({ useUnreadSupportCount: () => ({ count: 0 }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: false, error: false, multipleBusinesses: false }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: {}, loading: false }) }));
vi.mock("@/lib/playbook", async (orig) => ({
  ...(await orig<typeof import("@/lib/playbook")>()),
  usePlaybook: () => ({ portal: { modules: [{ key: "home", label: "Home" }, { key: "tasks", label: "Action items" }, { key: "resources", label: "Resources" }, { key: "messages", label: "Messages" }] }, persona: { name: "Owner assistant" } }),
}));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: "u1", email: "jordan.rivera@example.test" } as User;
let root: Root, host: HTMLDivElement;
const render = async (state: CustomerIdentityState | null) => {
  const nav = <MemoryRouter initialEntries={["/app"]}><AppNav user={user} /></MemoryRouter>;
  await act(async () => root.render(state ? <CustomerIdentityProvider state={state}>{nav}</CustomerIdentityProvider> : nav));
};
const navEl = () => host.querySelector('nav[aria-label="Customer navigation"]')!;

beforeEach(() => {
  f.isAdmin = false; f.brand = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await closeMenus(); act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

describe("menu for a person whose access is not active", () => {
  it("offers Home only, and keeps the Support button", async () => {
    await render({ frame: null, phase: "not-client", staff: false });
    expect(await desktopNavHrefs(host)).toEqual(["/app"]);
    expect(navEl().textContent).not.toMatch(/Action items|Resources|Messages/);
    expect(host.querySelector('button[aria-label="Contact support"]')).not.toBeNull();
  });

  it("shows the menu skeleton while the shell is still checking whether they are staff", async () => {
    await render({ frame: null, phase: "not-client", staff: null, staffChecking: true });
    expect(navEl().getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("[data-portal-nav-skeleton]")).not.toBeNull();
    expect(navEl().querySelectorAll("a[href]").length).toBe(0);
  });

  it("leaves a staff viewer's menu as it was", async () => {
    await render({ frame: null, phase: "not-client", staff: true, staffAssistantName: "Owner assistant" });
    const hrefs = await desktopNavHrefs(host);
    expect(hrefs[0]).toBe("/app");
    expect(hrefs.length).toBeGreaterThan(1);
  });

  it("leaves the menu as it was outside the /app shell, where there is no viewer to wait for", async () => {
    await render(null);
    expect((await desktopNavHrefs(host)).length).toBeGreaterThan(1);
  });
});
