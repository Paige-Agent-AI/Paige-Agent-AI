import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * E09 Slice 7, D10 (§58 call-out): turning the portal switch OFF for a joined client used to call
 * `admin-delete-user`, which deleted the person's login on every business. It now ENDS this
 * business's access through the tenant-scoped seam, behind a reason, and never touches the login.
 */
const f = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(), getSession: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
  client: { linked_user_id: "test-customer-a", portal_access_state: "open", portal_access_changed_at: "2026-10-01T00:00:00Z" } as Record<string, unknown>,
  clientReads: 0,
  invites: [] as unknown[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...a: unknown[]) => f.rpc(...a),
  functions: { invoke: (...a: unknown[]) => f.invoke(...a) },
  auth: { getSession: () => f.getSession() },
  from: (table: string) => {
    const result = () => table === "clients" ? (f.clientReads++, { data: { ...f.client }, error: null })
      : table === "tenant_invite_tokens" ? { data: f.invites, error: null } : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "order", "limit", "update"]) chain[k] = () => chain;
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (done: (v: unknown) => unknown) => Promise.resolve(result()).then(done);
    return chain;
  },
} }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "test-tenant-a", activeUserId: "test-owner-a", activeTenant: { name: "Test Studio" } }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true }) }));
vi.mock("@/lib/functions/adminAccountActions", () => ({ callAdminAccountAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: f.toast }));
import { ContactPortalPanel } from "./ContactPortalPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const all = () => document.body;
const byText = (name: string) => [...all().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name);
/** The confirm dialog's own button (the row has buttons with the same words). */
const inDialog = (name: string) => [...all().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === name);
const show = async () => { await act(async () => root.render(<ContactPortalPanel contactId="test-contact-a" email="jordan@tests.invalid" linkedUserId="test-customer-a" name="Jordan Test" />)); await flush(); };

beforeEach(() => {
  vi.clearAllMocks();
  f.client = { linked_user_id: "test-customer-a", portal_access_state: "open", portal_access_changed_at: "2026-10-01T00:00:00Z" };
  f.clientReads = 0;
  f.invites = [];
  f.getSession.mockResolvedValue({ data: { session: { user: { id: "test-owner-a" } } }, error: null });
  f.rpc.mockResolvedValue({ data: { ok: true, replayed: false }, error: null });
  f.invoke.mockResolvedValue({ data: {}, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Contact portal panel — access is ended, never the login deleted", () => {
  it("switching off a joined client offers the reversible Pause first, through the same seam (§60: every tier the panel mounts on)", async () => {
    await show();
    const toggle = all().querySelector<HTMLButtonElement>('[aria-label="Toggle Paige AI platform access"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click()); await flush();
    expect(all().textContent).toContain("Pause Jordan Test’s portal access?");
    expect(inDialog("Pause access")?.disabled).toBe(true);
    const radio = [...all().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) => r.closest("label, div")?.textContent?.includes("Work is on hold"));
    await act(async () => radio!.click()); await flush();
    f.client = { linked_user_id: "test-customer-a", portal_access_state: "paused", portal_access_changed_at: "2026-10-18T12:00:00Z" };
    const dialogPause = [...all().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Pause access")!;
    await act(async () => dialogPause.click()); await flush();
    expect(f.rpc).toHaveBeenCalledWith("set_client_portal_access", expect.objectContaining({ p_action: "pause", p_reason: "engagement_paused" }));
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.toast.success).toHaveBeenCalledWith("Portal access paused. You can restore it later.");
    expect(all().textContent).toContain("Access paused");
  });

  it("a joined client has Pause and End on the panel, and Pause can step up to End", async () => {
    await show();
    expect(byText("Pause access")).toBeTruthy();
    await act(async () => byText("Pause access")!.click()); await flush();
    await act(async () => byText("End access instead")!.click()); await flush();
    expect(all().textContent).toContain("End Jordan Test’s portal access?");
  });

  it("ending a joined client is its own choice and never calls admin-delete-user", async () => {
    await show();
    await act(async () => byText("End access")!.click()); await flush();
    expect(all().textContent).toContain("End Jordan Test’s portal access?");
    expect(all().textContent).toContain("To bring them back you’ll send a new invitation");
    expect(inDialog("End access")?.disabled).toBe(true);
    const radio = [...all().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) => r.closest("label, div")?.textContent?.includes("Our work together has ended"));
    await act(async () => radio!.click()); await flush();
    f.client = { linked_user_id: null, portal_access_state: "ended", portal_access_changed_at: "2026-10-18T12:00:00Z" };
    await act(async () => inDialog("End access")!.click()); await flush();
    expect(f.rpc).toHaveBeenCalledWith("set_client_portal_access", expect.objectContaining({
      p_expected_actor_id: "test-owner-a", p_expected_tenant_id: "test-tenant-a", p_contact_id: "test-contact-a",
      p_action: "end", p_reason: "engagement_ended", p_expected_changed_at: "2026-10-01T00:00:00Z",
    }));
    expect(f.invoke.mock.calls.some(([name]) => name === "admin-delete-user")).toBe(false);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(all().textContent).toContain("Access ended");
    expect(f.toast.success).toHaveBeenCalledWith("Portal access ended. Their login is untouched and their history stays on this contact.");
  });

  it("reports nothing as ended when the fresh read still shows access open", async () => {
    await show();
    await act(async () => byText("End access")!.click()); await flush();
    const radio = [...all().querySelectorAll<HTMLButtonElement>('[role="radio"]')][0];
    await act(async () => radio.click()); await flush();
    const confirm = [...all().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "End access")!;
    await act(async () => confirm.click()); await flush();
    expect(f.toast.success).not.toHaveBeenCalled();
    expect(f.toast.error).toHaveBeenCalled();
  });

  it("shows a paused client as paused, and switching on restores through the same seam", async () => {
    f.client = { linked_user_id: "test-customer-a", portal_access_state: "paused", portal_access_changed_at: "2026-10-18T12:00:00Z" };
    await show();
    expect(all().textContent).toContain("Access paused");
    // Not the warning hue: beside the gold Restore it read as a second gold spend (review 10).
    const badge = [...all().querySelectorAll("div")].find((d) => d.textContent?.trim() === "Access paused")!;
    expect(badge.className).not.toMatch(/warning|amber|gold/);
    const toggle = all().querySelector<HTMLButtonElement>('[aria-label="Toggle Paige AI platform access"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click()); await flush();
    expect(all().textContent).toContain("Restore Jordan Test’s portal access?");
    const restore = [...all().querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent?.trim() === "Restore access")!;
    // Gold is the one act that gives access back, as on the record card (review 14).
    expect(restore.className).toContain("bg-gradient-gold");
    f.client = { linked_user_id: "test-customer-a", portal_access_state: "open", portal_access_changed_at: "2026-10-19T00:00:00Z" };
    await act(async () => restore.click()); await flush();
    expect(f.rpc).toHaveBeenCalledWith("set_client_portal_access", expect.objectContaining({ p_action: "restore", p_reason: null }));
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("a paused client keeps the account tools and can be ended from the panel", async () => {
    f.client = { linked_user_id: "test-customer-a", portal_access_state: "paused", portal_access_changed_at: "2026-10-18T12:00:00Z" };
    await show();
    expect(byText("Force sign out")).toBeTruthy();
    expect(byText("Send password reset")).toBeTruthy();
    await act(async () => byText("End access")!.click()); await flush();
    expect(all().textContent).toContain("End Jordan Test’s portal access?");
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("an ended client reads Ended and can be invited again", async () => {
    f.client = { linked_user_id: null, portal_access_state: "ended", portal_access_changed_at: "2026-10-18T12:00:00Z" };
    await act(async () => root.render(<ContactPortalPanel contactId="test-contact-a" email="jordan@tests.invalid" linkedUserId={null} name="Jordan Test" />)); await flush();
    expect(all().textContent).toContain("Access ended");
    expect(byText("Send invite")).toBeTruthy();
  });

  // §58: the panel's invitation history and agreements still load alongside the access state.
  it("still shows the invitation history next to the access state", async () => {
    f.invites = [{ id: "inv-1", email: "jordan@tests.invalid", expires_at: "2026-11-01T00:00:00Z", last_used_at: "2026-10-02T00:00:00Z", created_at: "2026-10-01T00:00:00Z", revoked_at: null }];
    await show();
    expect(all().textContent).toContain("Invite history");
    expect(all().textContent).toContain("accepted");
  });
});
