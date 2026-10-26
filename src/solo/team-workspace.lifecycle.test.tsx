/**
 * EXP08 Settings → Team lifecycle (approved design 2026-10-26): the Team conversations switch,
 * suspend, reinstate, Invited rows in the roster, the filter picker, and the honest states around
 * them — first use, loading, error, and an act whose function is not deployed yet.
 *
 * jsdom against the real components; the Supabase client is mocked with answers shaped like the
 * migration (supabase/migrations/20271115040008_exp08_team_lifecycle.sql): suspend/reinstate/switch
 * return { tenant_id, membership_id, user_id, status | team_hub_access, ... } and refuse by RAISE,
 * which supabase-js delivers as { error: { message } }. A function missing from the schema cache
 * arrives as PGRST202. "Persisted" here means the roster is RE-READ from the server after a write
 * and the row shows what that re-read returned, not what the click assumed.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberEditor, SoloTeamWorkspace } from "./team-workspace";
import type { TeamInviteRecord, TeamMemberRecord, TeamWorkspaceRecord } from "./team-workspace-contract";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(),
  tenant: { activeTenantId: "tenant-1" as string | null, activeUserId: "owner-1" as string | null },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: mocks.tenant.activeUserId } } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    rpc: mocks.rpc, functions: { invoke: mocks.invoke },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: mocks.tenant.activeTenantId, activeUserId: mocks.tenant.activeUserId, loading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= function () { return false; };
Element.prototype.releasePointerCapture ??= function () {};

const member = (over: Partial<TeamMemberRecord> = {}): TeamMemberRecord => ({
  membership_id: "membership-1", user_id: "member-1", full_name: "Theo Brandt", email: "theo@example.com",
  avatar_url: null, status: "active", permission: "member", is_owner: false,
  job_title: "Contract Copywriter", responsibilities: "Spot jobs.", last_sign_in_at: null, ...over,
});
const owner = member({ membership_id: "m-owner", user_id: "owner-1", full_name: "Morgan Hale", email: "morgan@example.com", permission: "owner", is_owner: true, job_title: "Founder" });
const roster = (members: TeamMemberRecord[], over: Partial<TeamWorkspaceRecord> = {}): TeamWorkspaceRecord => ({
  tenant_id: "tenant-1", tenant_name: "Northstar Studio", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true,
  total_members: members.length, members, invitations: [], ...over,
});
/** team_hub_list_conversations, as the migration returns it (section F): active seats with their switch. */
const hub = (people: Array<{ user_id: string; on: boolean }>) => ({
  data: { ok: true, tenant_id: "tenant-1", me: { user_id: "owner-1" }, people: people.map((p) => ({ user_id: p.user_id, display_name: "x", title: null, permission: "member", team_conversations: p.on })), conversations: [] },
  error: null,
});
const missing = (fn: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}(_expected_tenant_id, _member_user_id) in the schema cache` } });

type Route = (args: Record<string, unknown>) => unknown;
function route(routes: Record<string, Route>) {
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => (routes[name] ? routes[name](args) : { data: null, error: { message: `unexpected ${name}` } }));
}
const wait = (ms = 250) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => Array.from(document.querySelectorAll("button"));
const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t);
const notice = () => document.querySelector(".stw-notice");
const sw = (name: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="Team conversations for ${name}"]`);
async function open() {
  const host = document.createElement("div");
  host.setAttribute("data-pg", "light");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => root.render(<SoloTeamWorkspace />));
  await wait();
  return { host, root };
}
// Unmounted after each test: a stale dialog's window Escape listener would otherwise handle the
// next test's Escape first.
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); });
async function menu(name: string, item: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${name}"]`)!.click());
  const node = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) => n.textContent?.includes(item));
  expect(node, `menu item ${item}`).toBeTruthy();
  await act(async () => (node as HTMLButtonElement).click());
  await wait(30);
}
const calls = (fn: string) => mocks.rpc.mock.calls.filter(([n]) => n === fn);

beforeEach(() => {
  document.body.innerHTML = "";
  for (const m of [mocks.rpc, mocks.invoke, mocks.success, mocks.error, mocks.warning]) m.mockReset();
  mocks.tenant.activeTenantId = "tenant-1";
  mocks.tenant.activeUserId = "owner-1";
});

describe("the Team conversations switch", () => {
  it("shows each person's real value, from Team Hub's roster, and never guesses one it wasn't given", async () => {
    const lena = member({ membership_id: "m-lena", user_id: "member-2", full_name: "Lena Ortiz", email: "lena@example.com" });
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member(), lena]), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "owner-1", on: true }, { user_id: "member-1", on: false }]),
    });
    await open();
    expect(calls("team_hub_list_conversations")[0][1]).toEqual({ p_expected_tenant: "tenant-1" });
    expect(sw("Theo Brandt")?.getAttribute("aria-checked")).toBe("false");
    expect(sw("Lena Ortiz"), "no value was returned for Lena, so no switch is drawn").toBeNull();
    expect(document.querySelector('[data-status="active"]:nth-child(3) .stw-swc')?.textContent).toContain("Not shown yet");
  });

  it("turns it on through the switch, re-reads the roster, and offers the reverse", async () => {
    let on = false;
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "member-1", on }]),
      set_solo_team_member_team_hub_access: (args) => { on = args._on as boolean; return { data: { tenant_id: "tenant-1", membership_id: "membership-1", user_id: "member-1", team_hub_access: on, changed: true, joined_channels: 3 }, error: null }; },
    });
    await open();
    const before = calls("get_solo_team_workspace").length;
    // A real click focuses the button; jsdom's .click() does not, so focus it as a person would.
    await act(async () => { sw("Theo Brandt")!.focus(); sw("Theo Brandt")!.click(); });
    await wait(60);
    expect(calls("set_solo_team_member_team_hub_access")[0][1]).toEqual({ _member_user_id: "member-1", _expected_tenant_id: "tenant-1", _on: true });
    expect(sw("Theo Brandt")?.getAttribute("aria-checked")).toBe("true");
    expect(notice()?.textContent).toContain("Theo Brandt is back in Team Hub, in every open team channel");
    expect(calls("get_solo_team_workspace").length, "the roster is re-read from the server").toBeGreaterThan(before);
    expect(document.activeElement, "focus stays on the switch that acted").toBe(sw("Theo Brandt"));
    await act(async () => byText("Turn off again")!.click());
    await wait(60);
    expect(calls("set_solo_team_member_team_hub_access")[1][1]._on).toBe(false);
    expect(sw("Theo Brandt")?.getAttribute("aria-checked")).toBe("false");
  });

  it("does not move the switch when the change is refused, and says so with a Retry", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "member-1", on: true }]),
      set_solo_team_member_team_hub_access: () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }),
    });
    await open();
    await act(async () => sw("Theo Brandt")!.click());
    await wait(30);
    expect(sw("Theo Brandt")?.getAttribute("aria-checked"), "unchanged").toBe("true");
    expect(notice()?.getAttribute("data-tone")).toBe("bad");
    // A lost reply: the write may have landed, so the screen must not claim it didn't.
    expect(notice()?.textContent).toContain("we can't say whether this changed for Theo Brandt");
    expect(notice()?.textContent).not.toContain("didn't change");
    expect(byText("Retry")).toBeTruthy();
  });

  it("says the act isn't available yet where the function isn't deployed — never a fake success", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "member-1", on: true }]),
      set_solo_team_member_team_hub_access: () => missing("set_solo_team_member_team_hub_access"),
    });
    await open();
    await act(async () => sw("Theo Brandt")!.click());
    await wait(30);
    expect(notice()?.textContent).toContain("This isn't available in Northstar Studio yet. Nothing was changed.");
    expect(notice()?.textContent).not.toMatch(/PGRST|schema cache/);
    expect(byText("Retry"), "a retry that cannot work is not offered").toBeFalsy();
    expect(sw("Theo Brandt")?.getAttribute("aria-checked")).toBe("true");
  });

  it("an admin may not switch another admin, and the owner's own row is fixed On", async () => {
    mocks.tenant.activeUserId = "admin-1";
    const avery = member({ membership_id: "m-avery", user_id: "admin-1", full_name: "Avery Cole", permission: "admin" });
    const dana = member({ membership_id: "m-dana", user_id: "admin-2", full_name: "Dana Reyes", permission: "admin" });
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, avery, dana, member()], { viewer_permission: "admin", can_change_permissions: false }), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "admin-1", on: true }, { user_id: "admin-2", on: true }, { user_id: "member-1", on: true }]),
    });
    await open();
    expect(sw("Theo Brandt"), "a member: switchable").toBeTruthy();
    expect(sw("Dana Reyes"), "another admin: read-only").toBeNull();
    expect(sw("Avery Cole"), "themselves: read-only").toBeNull();
    expect(sw("Morgan Hale")).toBeNull();
  });
});

describe("suspend and reinstate", () => {
  const live = () => {
    let status = "active";
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member({ status })]), error: null }),
      team_hub_list_conversations: () => hub([{ user_id: "member-1", on: true }]),
      team_member_holdings: () => ({ data: { ok: true, member: { user_id: "member-1", display_name: "Theo Brandt", role: "member", status, team_hub_access: true }, holdings: { work: [], crm_tasks: [], clients: [], deals: [], approvals: [{ id: "a1", kind: "email", summary: "Launch email to Harbor & Pine", status: "pending", created_at: "2026-10-25T00:00:00Z" }], mailboxes: [] }, counts: { work: 0, crm_tasks: 0, clients: 0, deals: 0, approvals: 1, mailboxes: 0 } }, error: null }),
      suspend_solo_team_member: () => { status = "suspended"; return { data: { tenant_id: "tenant-1", membership_id: "membership-1", user_id: "member-1", status: "suspended" }, error: null }; },
      reinstate_solo_team_member: () => { status = "active"; return { data: { tenant_id: "tenant-1", membership_id: "membership-1", user_id: "member-1", status: "active" }, error: null }; },
    });
  };

  it("suspends through a confirmation that opens on Cancel and says what stays assigned", async () => {
    live();
    await open();
    await menu("Theo Brandt", "Suspend access");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Suspend Theo Brandt?");
    expect(document.activeElement?.textContent, "focus starts on Cancel").toBe("Cancel");
    expect(dialog.textContent).toContain("1 approval assigned to Theo (“Launch email to Harbor & Pine”) stays assigned to Theo and waits");
    expect(dialog.textContent).toContain("Nothing is deleted or reassigned.");
    expect(calls("suspend_solo_team_member"), "opening the dialog changes nothing").toHaveLength(0);
    await act(async () => byText("Suspend access")!.click());
    await wait(60);
    expect(calls("suspend_solo_team_member")[0][1]).toEqual({ _member_user_id: "member-1", _expected_tenant_id: "tenant-1" });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(notice()?.textContent).toContain("Theo Brandt is suspended and can't open Northstar Studio. 1 approval stays assigned to Theo.");
    // The row shows what the server re-read says, not what the click assumed.
    expect(document.querySelector('[data-status="suspended"] .stw-stat')?.textContent).toContain("Suspended");
  });

  it("keeps the dialog and says why when suspension is refused", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
      team_member_holdings: () => missing("team_member_holdings"),
      suspend_solo_team_member: () => ({ data: null, error: { message: "only the workspace owner may suspend an admin in this workspace" } }),
    });
    await open();
    await menu("Theo Brandt", "Suspend access");
    // Holdings unavailable: the facts are said in general terms, not invented.
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Approvals assigned to Theo stay assigned and wait.");
    await act(async () => byText("Suspend access")!.click());
    await wait(30);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain("Only the workspace owner can do this for an admin. Nothing was changed.");
    expect(notice()).toBeNull();
  });

  it("reinstates in place from the row menu and from the suspend notice", async () => {
    live();
    await open();
    await menu("Theo Brandt", "Suspend access");
    await act(async () => byText("Suspend access")!.click());
    await wait(60);
    await act(async () => byText("Reinstate")!.click());
    await wait(60);
    expect(calls("reinstate_solo_team_member")[0][1]).toEqual({ _member_user_id: "member-1", _expected_tenant_id: "tenant-1" });
    expect(notice()?.textContent).toContain("Theo Brandt can open Northstar Studio again, as Member.");
    expect(document.querySelector('[data-status="suspended"]'), "the re-read shows them active").toBeNull();
    // and the menu now offers Suspend again, not Reinstate
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for Theo Brandt"]')!.click());
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent)).toEqual(["Edit details", "Suspend access…", "Remove from team…"]);
  });

  it("a suspended person's switch still saves, and says it takes effect when reinstated", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, member({ status: "suspended" })]), error: null }),
      team_hub_list_conversations: () => hub([]),
      team_member_holdings: () => ({ data: { ok: true, member: { user_id: "member-1", display_name: "Theo Brandt", role: "member", status: "suspended", team_hub_access: false }, holdings: { work: [], crm_tasks: [], clients: [], deals: [], approvals: [], mailboxes: [] }, counts: {} }, error: null }),
      set_solo_team_member_team_hub_access: () => ({ data: { tenant_id: "tenant-1", membership_id: "membership-1", user_id: "member-1", team_hub_access: true, changed: true, joined_channels: 0 }, error: null }),
    });
    await open();
    const s = sw("Theo Brandt")!;
    expect(s.getAttribute("aria-checked"), "read from the review for a suspended seat").toBe("false");
    expect(document.getElementById(s.getAttribute("aria-describedby")!)?.textContent).toBe("Takes effect when reinstated");
    await act(async () => s.click());
    await wait(30);
    expect(notice()?.textContent).toContain("Theo Brandt stays suspended. When reinstated, Theo will be in every open team channel");
  });

  it("a suspended person's permission can't be changed from the editor until they're reinstated", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push(root);
    await act(async () => root.render(<MemberEditor member={member({ status: "suspended", permission: "admin" })} workspace={roster([owner, member({ status: "suspended" })])} onClose={vi.fn()} onSaved={vi.fn()} />));
    expect(host.querySelector('[role="radio"]'), "no permission control is offered").toBeNull();
    expect(host.textContent).toContain("Reinstate Theo before changing their permission.");
    expect(host.querySelector("select")).toBeNull();
  });
});

describe("the roster", () => {
  const invite = (over: Partial<TeamInviteRecord> = {}): TeamInviteRecord => ({ id: "inv-1", email: "jules@example.com", permission: "member", created_at: "2026-10-24T12:00:00Z", expires_at: "2099-11-02T12:00:00Z", revoked_at: null, uses: 0, ...over });

  it("folds pending invitations in as Invited rows, with resend and withdraw that say what happened", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner], { invitations: [invite()] }), error: null }) });
    mocks.invoke.mockResolvedValue({ data: { ok: true, emailed: true }, error: null });
    await open();
    const row = document.querySelector('[data-status="invited"]');
    expect(row?.textContent).toContain("jules@example.com");
    expect(row?.textContent).toContain("Hasn't accepted yet");
    expect(document.querySelector(".stw-toolbar p")?.textContent).toBe("1 person in Northstar Studio, plus 1 invited");
    await menu("jules@example.com", "Withdraw invitation");
    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ action: "revoke", expectedTenantId: "tenant-1", inviteId: "inv-1" });
    expect(notice()?.textContent).toContain("The invitation to jules@example.com was withdrawn. Its link no longer works.");
    await act(async () => byText("Send again")!.click());
    await wait(30);
    expect(mocks.invoke.mock.calls[1][1].body.action).toBe("resend");
    expect(notice()?.textContent).toContain("A new invitation went to jules@example.com.");
  });

  it("filters with the shared Select primitive, not a native select", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, member()], { invitations: [invite()] }), error: null }) });
    await open();
    expect(document.querySelector("select")).toBeNull();
    const trigger = document.querySelector<HTMLElement>('.stw-filters [role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Show: Everyone");
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    const invited = document.querySelector<HTMLElement>('[role="option"][data-value="invited"]')!;
    await act(async () => { invited.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await wait();
    expect(document.querySelectorAll('[data-status="invited"]').length).toBe(1);
    expect(document.querySelectorAll('[data-status="active"]').length, "only the invited show").toBe(0);
  });

  it("opens with skeleton rows, not a spinner line, and says it is loading", async () => {
    mocks.rpc.mockImplementation(() => new Promise(() => {}));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host); mounted.push(root);
    await act(async () => root.render(<SoloTeamWorkspace />));
    expect(host.querySelectorAll(".stw-skelrow").length).toBe(4);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading the team…");
  });

  it("says the team didn't load, that nothing changed, and offers Try again", async () => {
    route({ get_solo_team_workspace: () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }) });
    await open();
    const state = document.querySelector('.stw-rstate[role="alert"]');
    expect(state?.textContent).toContain("The team didn't load");
    expect(state?.textContent).toContain("Nothing on the team changed.");
    expect(byText("Try again")).toBeTruthy();
  });

  it("starts with the owner and an invitation to bring the first teammate", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner]), error: null }) });
    await open();
    expect(document.querySelector(".stw-first-use")?.textContent).toContain("Your workspace starts with you");
    expect(byText("Invite first teammate")).toBeTruthy();
  });

  it("never spends gold except on the act that sends something", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }) });
    await open();
    expect(document.querySelectorAll(".stw-btn.act").length, "nothing on the roster is the act").toBe(0);
    await act(async () => byText("Invite someone")!.click());
    const email = document.querySelector<HTMLInputElement>("input[type=email]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "jules@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll(".stw-btn.act").length, "the form step has no act yet").toBe(0);
    await act(async () => byText("Review invitation")!.click());
    expect(Array.from(document.querySelectorAll(".stw-btn.act")).map((b) => b.textContent)).toEqual(["Send invitation"]);
  });
});

describe("a workspace switch under the suspend dialog", () => {
  const base = (suspend: Route) => route({
    get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
    team_member_holdings: () => missing("team_member_holdings"),
    suspend_solo_team_member: suspend,
  });

  it("closes an idle dialog and says nothing was changed", async () => {
    base(() => ({ data: null, error: null }));
    const { root } = await open();
    await menu("Theo Brandt", "Suspend access");
    mocks.tenant.activeTenantId = "tenant-2";
    await act(async () => root.render(<SoloTeamWorkspace />));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(String(mocks.error.mock.calls.at(-1)?.[0])).toBe("You switched workspace, so suspending Theo Brandt in Northstar Studio was closed. Nothing was changed.");
    expect(calls("suspend_solo_team_member")).toHaveLength(0);
  });

  it("still reports a suspension that landed after the switch, naming the workspace it happened in", async () => {
    let settle: (v: unknown) => void = () => {};
    base(() => new Promise((res) => { settle = res; }));
    const { root } = await open();
    await menu("Theo Brandt", "Suspend access");
    await act(async () => byText("Suspend access")!.click());
    mocks.tenant.activeTenantId = "tenant-2";
    await act(async () => root.render(<SoloTeamWorkspace />));
    expect(document.querySelector('[role="alertdialog"]'), "not closed under a call in flight").toBeTruthy();
    await act(async () => { settle({ data: { tenant_id: "tenant-1", membership_id: "membership-1", user_id: "member-1", status: "suspended" }, error: null }); });
    expect(String(mocks.success.mock.calls.at(-1)?.[0])).toBe("Theo Brandt was suspended in Northstar Studio. You have since switched workspace, so this roster does not show it.");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("focus returns to the row's ⋯ when an overlay opened from it closes", () => {
  const esc = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  const more = () => document.getElementById("stw-more-member-1");
  const base = () => route({
    get_solo_team_workspace: () => ({ data: roster([owner, member()]), error: null }),
    team_hub_list_conversations: () => hub([{ user_id: "member-1", on: true }]),
    team_member_holdings: () => ({ data: { ok: true, member: { user_id: "member-1", display_name: "Theo Brandt", role: "member", status: "active", team_hub_access: true }, holdings: { work: [], crm_tasks: [], clients: [], deals: [], approvals: [], mailboxes: [] }, counts: { work: 0, crm_tasks: 0, clients: 0, deals: 0, approvals: 0, mailboxes: 0 } }, error: null }),
  });

  it("after Cancel and after Esc on the suspend dialog", async () => {
    base(); await open();
    await menu("Theo Brandt", "Suspend access");
    await act(async () => byText("Cancel")!.click());
    expect(document.activeElement).toBe(more());
    await menu("Theo Brandt", "Suspend access");
    await esc();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("the ⋯ menu takes focus on its first item and moves with the arrows, Home and End", async () => {
    base(); await open();
    await act(async () => more().click());
    await wait(20);
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(items[0]);
    const key = async (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
    await key("End");
    expect(document.activeElement).toBe(items[items.length - 1]);
    await key("Home");
    expect(document.activeElement).toBe(items[0]);
    await key("ArrowUp");
    expect(document.activeElement, "ArrowUp from the first wraps to the last").toBe(items[items.length - 1]);
    await key("Escape");
    expect(document.activeElement).toBe(more());
  });

  it("after Esc on the departure review and after closing the editor", async () => {
    base(); await open();
    await menu("Theo Brandt", "Remove from team");
    await wait(60);
    await esc();
    expect(document.querySelector(".stw-drawer")).toBeNull();
    expect(document.activeElement).toBe(more());
    await menu("Theo Brandt", "Edit details");
    await act(async () => byText("Close")!.click());
    expect(document.activeElement).toBe(more());
  });
});
