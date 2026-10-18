import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "./AppNav";
import { closeMenus, desktopNavHrefs, groupTriggers, openGroup } from "./appNavTestUtils";

// E09 Slice M — the customer portal menu, grouped and configurable per tenant. Synthetic tenant only.
type Overlay = { key: string; visible?: boolean; order?: number; label?: string };
const f = vi.hoisted(() => ({
  mobile: false,
  isAdmin: false,
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
  brandLoading: false,
  multiple: false,
  // What usePlaybook() returns: the viewer's own tenant read (a customer's is RLS-denied, so the generic default).
  modules: [] as { key: string; label: string }[],
  config: {} as { modules?: Overlay[]; catalog?: { slug: string | null; authoredUsable: boolean; modules: { key: string; label: string }[] | null } },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ isAdmin: f.isAdmin, mode: "internal", setMode: vi.fn() }) }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/brand/PaigeCommandMark", () => ({ PaigeCommandMark: () => <span>Paige</span> }));
vi.mock("@/hooks/useUnreadSupportCount", () => ({ useUnreadSupportCount: () => ({ count: 0 }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: f.brandLoading, error: false, multipleBusinesses: f.multiple }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: f.config, loading: false }) }));
vi.mock("@/lib/playbook", async (orig) => ({ ...(await orig<typeof import("@/lib/playbook")>()), usePlaybook: () => ({ portal: { modules: f.modules }, persona: { name: "Paige" } }) }));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn(), customerSignOutTarget: vi.fn(), cachePortalSlug: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GENERIC = [
  { key: "home", label: "Home" }, { key: "sessions", label: "Sessions" }, { key: "progress", label: "Progress" },
  { key: "messages", label: "Messages" }, { key: "resources", label: "Resources" }, { key: "billing", label: "Billing" },
];
const user = { id: "u1", email: "jordan.rivera@example.test" } as User;
let root: Root, host: HTMLDivElement;
const render = async (path = "/app") => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><AppNav user={user} /></MemoryRouter>));
};
const nav = () => host.querySelector('nav[aria-label="Customer navigation"]')!;
const topLevel = () => Array.from(nav().querySelectorAll<HTMLElement>(":scope > a, :scope > button")).map((el) => el.getAttribute("data-portal-group") ? `[${el.getAttribute("data-portal-group")}]` : el.textContent?.trim());
const openDrawer = async () => { await act(async () => (document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement).click()); };
const drawer = () => document.querySelector('nav[aria-label="Customer navigation"]')!;

beforeEach(() => {
  f.mobile = false; f.isAdmin = false; f.brandLoading = false; f.multiple = false;
  f.modules = GENERIC; f.config = {};
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000002", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await closeMenus(); act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

describe("desktop bar", () => {
  it("shows Home and Messages, then each group as a menu, and a one-item group as a plain link", async () => {
    await render();
    expect(topLevel()).toEqual(["Home", "Messages", "[Your work]", "Documents", "Resources"]);
    const work = await openGroup("Your work");
    expect(work.map((i) => i.querySelector("[data-portal-label]")?.textContent)).toEqual(["Progress", "Action items", "Sessions"]);
    expect(work.map((i) => i.getAttribute("href"))).toEqual(["/app/progress", "/app/actions", "/app/sessions"]);
  });

  it("opens a group from the keyboard, with a labelled trigger and items a screen reader announces as a menu", async () => {
    await render();
    const [trigger] = groupTriggers();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await openGroup("Your work");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-labelledby")).toBe(trigger.id);
    await closeMenus();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the current page, and the group that holds it, without spending gold on a resting selection (§11)", async () => {
    await render("/app/sessions");
    const [trigger] = groupTriggers();
    expect(trigger.getAttribute("data-active")).toBe("true");
    const home = Array.from(nav().querySelectorAll("a")).find((a) => a.getAttribute("href") === "/app")!;
    expect(home.getAttribute("aria-current")).toBeNull();
    const items = await openGroup("Your work");
    expect(items.find((i) => i.getAttribute("href") === "/app/sessions")?.getAttribute("aria-current")).toBe("page");
    expect(nav().innerHTML).not.toMatch(/\btext-accent\b/);
  });

  it("applies the business's names, order and hidden entries — Action items can now be hidden, Messages cannot", async () => {
    f.config = { modules: [
      { key: "sessions", label: "Coaching calls", order: 0 }, { key: "actions", visible: false }, { key: "progress", order: 1 },
      { key: "messages", visible: false, label: "Inbox" }, { key: "resources", visible: false },
    ] };
    await render();
    expect(topLevel()).toEqual(["Home", "Messages", "[Your work]", "Documents"]);
    const work = await openGroup("Your work");
    expect(work.map((i) => i.querySelector("[data-portal-label]")?.textContent)).toEqual(["Coaching calls", "Progress"]);
  });

  it("reads the customer's catalog from the portal config, not the RLS-denied tenant read (§57)", async () => {
    f.config = { catalog: { slug: null, authoredUsable: true, modules: [{ key: "home", label: "Home" }, { key: "agreements", label: "Agreements" }, { key: "approvals", label: "Approvals" }] } };
    await render();
    expect(await desktopNavHrefs(host)).toEqual(["/app", "/app/messages", "/app/progress", "/app/actions", "/app/sessions", "/app/approvals", "/app/documents", "/app/agreements"]);
  });

  it("keeps staff on their own Playbook read", async () => {
    f.isAdmin = true; f.brand = null;
    f.modules = [{ key: "home", label: "Home" }, { key: "approvals", label: "Approvals" }];
    // Staff have no customer relationship, so the customer config read returns nothing.
    f.config = {};
    await render();
    expect(await desktopNavHrefs(host)).toEqual(["/app", "/app/approvals", "/app/planning"]);
  });

  it("never renders Payments while its route is not live", async () => {
    f.config = { modules: [{ key: "billing", visible: true }] };
    await render();
    expect((await desktopNavHrefs(host))).not.toContain("/app/billing");
    expect(host.textContent).not.toContain("Payments");
  });
});

describe("phone drawer", () => {
  it("lists every entry with the group names as headings, and the fixed items last", async () => {
    f.mobile = true;
    await render();
    await openDrawer();
    const rows = Array.from(drawer().querySelectorAll<HTMLElement>("[data-portal-heading], button")).map((el) =>
      el.hasAttribute("data-portal-heading") ? `# ${el.textContent?.trim()}` : el.textContent?.trim());
    expect(rows).toEqual([
      "Home", "Messages", "# Your work", "Progress", "Action items", "Sessions", "# Paperwork", "Documents", "# Learn", "Resources",
      "Get help", "Account", "Settings", "Sign Out",
    ]);
    const work = drawer().querySelector('[role="group"][aria-labelledby]')!;
    expect(document.getElementById(work.getAttribute("aria-labelledby")!)?.textContent).toBe("Your work");
  });

  it("drops a heading whose group has nothing visible", async () => {
    f.mobile = true;
    f.config = { modules: [{ key: "documents", visible: false }] };
    await render();
    await openDrawer();
    expect(Array.from(drawer().querySelectorAll("[data-portal-heading]")).map((h) => h.textContent)).toEqual(["Your work", "Learn"]);
  });
});
