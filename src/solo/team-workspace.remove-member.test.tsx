/**
 * Removal, now reached through the departure review (EXP08, approved design 2026-10-26), driven as a
 * person drives it: a row's "⋯" menu → "Remove from team…" → the drawer reads what the person holds
 * (team_member_holdings) → Continue → Remove.
 *
 * The inline removal block that used to live inside MemberEditor is gone; this file used to test
 * it. Every guarantee that block earned is re-proved here against the drawer, under the same names
 * where they still apply: one request per click inside one batch; never dismissible while in flight;
 * a refusal is never reported as a removal; a server that acted on another workspace is not claimed;
 * a workspace switch mid-call is reported through the channel that outlives the drawer. The
 * permission/removal overlap cases are gone because the two no longer share a dialog.
 *
 * jsdom against the real components with the Supabase client mocked. The RPC answers mirror the
 * shapes and refusal sentences in supabase/migrations/20271115040008_exp08_team_lifecycle.sql. They
 * prove what the SCREEN does with those answers, not that the database gives them.
 */
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoloTeamWorkspace } from "./team-workspace";
import { DepartureReview } from "./team-departure";
import { removalRefusal, type TeamMemberRecord, type TeamWorkspaceRecord } from "./team-workspace-contract";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(),
  tenant: { activeTenantId: "tenant-1" as string | null, activeUserId: "owner-1" as string | null },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: mocks.tenant.activeUserId } } }), getSession: async () => ({ data: { session: { user: { id: mocks.tenant.activeUserId } } }, error: null }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    rpc: mocks.rpc, functions: { invoke: mocks.invoke },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: mocks.tenant.activeTenantId, activeUserId: mocks.tenant.activeUserId, loading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: the Select primitive scrolls its option into view and checks pointer capture.
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= function () { return false; };
Element.prototype.releasePointerCapture ??= function () {};

const member = (over: Partial<TeamMemberRecord> = {}): TeamMemberRecord => ({
  membership_id: "membership-1", user_id: "member-1", full_name: "Dana Reyes", email: "dana@example.com",
  avatar_url: null, status: "active", permission: "member", is_owner: false,
  job_title: "Client Coordinator", responsibilities: "Owns client handoffs.", last_sign_in_at: null, ...over,
});
const owner = member({ membership_id: "m-owner", user_id: "owner-1", full_name: "Ada Owner", email: "ada@example.com", permission: "owner", is_owner: true });
const avery = member({ membership_id: "m-avery", user_id: "admin-2", full_name: "Avery Cole", email: "avery@example.com", permission: "admin" });
const dana = member();
const roster = (members: TeamMemberRecord[], over: Partial<TeamWorkspaceRecord> = {}): TeamWorkspaceRecord => ({
  tenant_id: "tenant-1", tenant_name: "Example Team", viewer_permission: "owner",
  can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true,
  total_members: members.length, members, invitations: [], ...over,
});

/** team_member_holdings, shaped exactly as the migration returns it (section K). */
const holdings = (over: Partial<Record<string, unknown[]>> = {}, counts: Partial<Record<string, number>> = {}) => {
  const lists = { work: [], crm_tasks: [], clients: [], deals: [], approvals: [], mailboxes: [], ...over } as Record<string, unknown[]>;
  return {
    ok: true,
    member: { user_id: "member-1", display_name: "Dana Reyes", role: "member", status: "active", team_hub_access: true },
    holdings: lists,
    counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, counts[k] ?? v.length])),
  };
};
const WORK = { id: "w-1", title: "Kickoff cover options", status: "in_progress", due_at: "2026-10-28T17:00:00Z", updated_at: "2026-10-26T10:00:00.000Z", client_id: "c-1", client_label: "Brightline Co." };
const CLIENT_ASSIGNED = { id: "c-2", label: "Harbor & Pine", relation: "assigned", updated_at: "2026-10-25T09:00:00.000Z" };
const APPROVAL = { id: "a-1", kind: "email", summary: "Follow-up email to Brightline Co.", status: "pending", created_at: "2026-10-25T09:00:00Z" };
const MAILBOX = { id: "mb-1", channel: "email", provider: "google", mailbox_class: "personal", label: "Dana Reyes", address: "dana@example.com" };

type Route = (args: Record<string, unknown>) => unknown;
function route(routes: Record<string, Route>) {
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const r = routes[name];
    if (r) return r(args);
    // Team Hub's roster is read for the Team conversations column; unmocked, it is "unknown".
    return { data: null, error: { message: `unexpected ${name}` } };
  });
}

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  host.setAttribute("data-pg", "light");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  return { host, root, render: async () => act(async () => root.render(node)) };
}
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => { for (const root of mounted.splice(0)) act(() => root.unmount()); });
const wait = (ms = 250) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => Array.from(document.querySelectorAll("button"));
const byText = (text: string | RegExp) => buttons().find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent?.trim() ?? "")));
const drawer = () => document.querySelector(".stw-drawer");
// The drawer's destructive control (danger): "Remove Dana Reyes", then "Removing…" or "Try again".
const removeButton = () => drawer()?.querySelector<HTMLButtonElement>(".stw-btn.danger") ?? undefined;
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

async function openScreen() {
  const screen = mount(<SoloTeamWorkspace />);
  await act(async () => screen.root.render(<SoloTeamWorkspace />));
  await wait();
  return screen;
}
async function openRemoval(name = "Dana Reyes") {
  const more = document.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${name}"]`);
  expect(more, `the actions menu for ${name}`).toBeTruthy();
  await act(async () => more!.click());
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) => n.textContent?.includes("Remove from team"));
  expect(item, "the menu offers Remove from team").toBeTruthy();
  await act(async () => (item as HTMLButtonElement).click());
  await wait(30);
}
const removeCalls = () => mocks.rpc.mock.calls.filter(([n]) => n === "remove_solo_team_member");

beforeEach(() => {
  document.body.innerHTML = "";
  for (const m of [mocks.rpc, mocks.invoke, mocks.success, mocks.error, mocks.warning]) m.mockReset();
  mocks.tenant.activeTenantId = "tenant-1";
  mocks.tenant.activeUserId = "owner-1";
});

describe("who is offered the way in at all", () => {
  it("an owner gets a menu on every admin and member row, never on the owner's own row", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, avery, dana]), error: null }) });
    await openScreen();
    expect(document.querySelector('[aria-label="Actions for Dana Reyes"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Actions for Avery Cole"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Actions for Ada Owner"]'), "nobody acts on the owner").toBeNull();
  });

  it("an admin gets a menu on member rows only — not on another admin, and not on themselves", async () => {
    mocks.tenant.activeUserId = "admin-2";
    const brook = member({ membership_id: "m-brook", user_id: "admin-3", full_name: "Brook Hale", email: "brook@example.com", permission: "admin" });
    route({ get_solo_team_workspace: () => ({ data: roster([owner, avery, brook, dana], { viewer_permission: "admin", can_change_permissions: false }), error: null }) });
    await openScreen();
    expect(document.querySelector('[aria-label="Actions for Dana Reyes"]'), "a member row").toBeTruthy();
    expect(document.querySelector('[aria-label="Actions for Brook Hale"]'), "another admin").toBeNull();
    expect(document.querySelector('[aria-label="Actions for Avery Cole"]'), "themselves").toBeNull();
    expect(document.querySelector('[aria-label="Actions for Ada Owner"]')).toBeNull();
  });

  it("a member sees the roster with no menus at all", async () => {
    mocks.tenant.activeUserId = "member-1";
    route({ get_solo_team_workspace: () => ({ data: roster([owner, avery, dana], { viewer_permission: "member", can_manage_profiles: false, can_manage_invitations: false, can_change_permissions: false }), error: null }) });
    await openScreen();
    expect(document.querySelectorAll(".stw-more").length).toBe(0);
    expect(document.body.textContent).toContain("Dana Reyes");
  });

  it("never offers it on a legacy specialised permission", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, member({ permission: "coach" })]), error: null }) });
    await openScreen();
    expect(document.querySelector('[aria-label="Actions for Dana Reyes"]')).toBeNull();
  });
});

describe("the departure review", () => {
  it("reads what the person holds, in the workspace it was opened in, and shows only real hand-over controls", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, avery, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings({ work: [WORK], clients: [CLIENT_ASSIGNED], approvals: [APPROVAL], mailboxes: [MAILBOX] }), error: null }),
    });
    await openScreen();
    await openRemoval();
    const call = mocks.rpc.mock.calls.find(([n]) => n === "team_member_holdings");
    expect(call?.[1]).toEqual({ _member_user_id: "member-1", _expected_tenant_id: "tenant-1" });
    const text = drawer()?.textContent ?? "";
    expect(text).toContain("What Dana Reyes holds");
    expect(text).toContain("Kickoff cover options");
    expect(text).toContain("Brightline Co.");
    expect(text).toContain("0 of 2 will be handed over");
    // Approvals and the mailbox have no writer: listed, with the truth, and no picker.
    expect(text).toContain("Can't be handed over yet. It stays assigned to Dana and waiting");
    expect(text).toContain("It stays connected after Dana leaves");
    const pickers = drawer()!.querySelectorAll('[role="combobox"]');
    expect(pickers.length, "one per movable item plus Hand everything to").toBe(3);
    expect(drawer()!.querySelector("select"), "no native select").toBeNull();
    expect(removeCalls(), "reading is not removing").toHaveLength(0);
  });

  it("says plainly when someone holds nothing, and removal follows", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
    });
    await openScreen();
    await openRemoval();
    expect(drawer()?.textContent).toContain("Dana Reyes holds nothing to hand over");
    await act(async () => byText("Continue")!.click());
    expect(drawer()?.textContent).toContain("Remove Dana Reyes from Example Team?");
    expect(removeButton()).toBeTruthy();
  });

  it("does not remove anyone while the list cannot load — it offers Try again and Suspend instead", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }),
    });
    await openScreen();
    await openRemoval();
    expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain("We couldn't load what Dana holds.");
    expect(byText("Suspend instead")).toBeTruthy();
    expect(byText("Try again")).toBeTruthy();
    expect(removeButton(), "no Remove while the list is unknown").toBeFalsy();
  });

  it("keeps removal available, honestly, where the review isn't deployed yet (§58)", async () => {
    // Production today: remove_solo_team_member exists, team_member_holdings does not (PGRST202).
    // Removal was available before the review existed, so it is not withheld; the screen says it
    // can't list what they hold, and what that means.
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.team_member_holdings(_expected_tenant_id, _member_user_id) in the schema cache" } }),
      remove_solo_team_member: () => ({ data: { tenant_id: "tenant-1", membership_id: "membership-1", removed_user_id: "member-1" }, error: null }),
    });
    await openScreen();
    await openRemoval();
    const text = drawer()?.textContent ?? "";
    expect(text).toContain("The list of what Dana holds isn't available in Example Team yet.");
    expect(text).not.toMatch(/PGRST|schema cache|team_member_holdings/);
    await act(async () => removeButton()!.click());
    await wait(50);
    expect(removeCalls()[0][1]).toEqual({ _member_user_id: "member-1", _expected_tenant_id: "tenant-1" });
  });
});

describe("removing", () => {
  const ready = (removal: Route) => route({
    get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
    team_member_holdings: () => ({ data: holdings(), error: null }),
    remove_solo_team_member: removal,
  });
  async function toRemove() {
    const screen = await openScreen();
    await openRemoval();
    await act(async () => byText("Continue")!.click());
    return screen;
  }

  it("issues exactly ONE request when Remove is clicked twice inside one batch", async () => {
    ready(() => new Promise(() => {}));
    await toRemove();
    const button = removeButton()!;
    await act(async () => { button.click(); button.click(); });
    expect(removeCalls()).toHaveLength(1);
  });

  it("closes the drawer, announces the outcome outside it, and the row is gone after the re-read", async () => {
    let removed = false;
    route({
      get_solo_team_workspace: () => ({ data: roster(removed ? [owner] : [owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
      remove_solo_team_member: () => { removed = true; return { data: { tenant_id: "tenant-1", membership_id: "membership-1", removed_user_id: "member-1" }, error: null }; },
    });
    await toRemove();
    await act(async () => removeButton()!.click());
    await wait();
    expect(drawer(), "the drawer is gone").toBeNull();
    const notice = document.querySelector(".stw-notice");
    expect(notice?.textContent).toContain("Dana Reyes is no longer on the team.");
    expect(document.activeElement, "focus moves to the notice, not <body>").toBe(notice);
    expect(document.querySelector('[aria-label="Actions for Dana Reyes"]'), "her row is gone").toBeNull();
  });

  it("never reports a removal when the server refused, and says why in plain words", async () => {
    ready(() => ({ data: null, error: { message: "only the workspace owner may remove an admin from this workspace" } }));
    await toRemove();
    await act(async () => removeButton()!.click());
    await wait(30);
    expect(drawer(), "the drawer stays open with the refusal").toBeTruthy();
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toContain("Only the workspace owner can remove an admin.");
    expect(document.querySelector(".stw-notice"), "no success notice").toBeNull();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(removeButton()!.disabled, "a refusal that would refuse again offers no retry").toBe(true);
  });

  it("offers a retry when the request itself broke, and claims nothing either way", async () => {
    ready(() => ({ data: null, error: { message: "TypeError: Failed to fetch" } }));
    await toRemove();
    await act(async () => removeButton()!.click());
    await wait(30);
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toContain("we can't say whether Dana Reyes was removed");
    expect(removeButton()!.textContent).toBe("Try again");
    expect(removeButton()!.disabled).toBe(false);
  });

  it("does not claim a removal it did not perform when the person was already gone", async () => {
    ready(() => ({ data: null, error: { message: "that person is not on this workspace's team" } }));
    await toRemove();
    await act(async () => removeButton()!.click());
    await wait();
    expect(document.querySelector(".stw-notice")?.textContent).toContain("Dana Reyes is no longer on this team. Nothing further was changed.");
    expect(document.querySelector(".stw-notice")?.textContent).not.toContain("is no longer on the team.");
  });

  it("refuses to claim success when the server acted on a different workspace", async () => {
    ready(() => ({ data: { tenant_id: "tenant-OTHER" }, error: null }));
    await toRemove();
    await act(async () => removeButton()!.click());
    await wait();
    expect(String(mocks.error.mock.calls.at(-1)?.[0])).toContain("acting on a different workspace, so nothing is being claimed");
    expect(document.querySelector(".stw-notice")).toBeNull();
  });

  it("cannot be dismissed while a removal is in flight, so a refusal is never lost in silence", async () => {
    let settle: (v: unknown) => void = () => {};
    ready(() => new Promise((res) => { settle = res; }));
    await toRemove();
    await act(async () => removeButton()!.click());
    const closeX = drawer()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    const back = byText("Back")!;
    expect(closeX.disabled && back.disabled, "every close control is disabled, not live-looking and inert").toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { document.querySelector(".stw-modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(drawer(), "still open while the call is in flight").toBeTruthy();
    await act(async () => { settle({ data: null, error: { message: "only the workspace owner may remove someone from this workspace" } }); });
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toContain("Only the workspace owner");
  });

  it("reports a removal that SUCCEEDED after a workspace switch, naming the workspace it happened in", async () => {
    let settle: (v: unknown) => void = () => {};
    ready(() => new Promise((res) => { settle = res; }));
    const screen = await toRemove();
    await act(async () => removeButton()!.click());
    mocks.tenant.activeTenantId = "tenant-2";
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    await act(async () => { settle({ data: { tenant_id: "tenant-1", membership_id: "membership-1" }, error: null }); });
    await wait(30);
    expect(String(mocks.success.mock.calls.at(-1)?.[0])).toBe("Dana Reyes was removed from Example Team. You have since switched workspace, so this roster does not show it.");
    expect(drawer()).toBeNull();
  });

  it("does not swallow a REFUSAL that lands mid-switch", async () => {
    let settle: (v: unknown) => void = () => {};
    ready(() => new Promise((res) => { settle = res; }));
    const screen = await toRemove();
    await act(async () => removeButton()!.click());
    mocks.tenant.activeTenantId = "tenant-2";
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    await act(async () => { settle({ data: null, error: { message: "only the workspace owner may remove someone from this workspace" } }); });
    expect(String(mocks.error.mock.calls.at(-1)?.[0])).toContain("Only the workspace owner");
  });

  it("never treats an UNKNOWN live tenant as a switch that already happened", async () => {
    let settle: (v: unknown) => void = () => {};
    ready(() => new Promise((res) => { settle = res; }));
    const screen = await toRemove();
    await act(async () => removeButton()!.click());
    mocks.tenant.activeTenantId = null;
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    await act(async () => { settle({ data: null, error: { message: "only the workspace owner may remove someone from this workspace" } }); });
    // Unknown is not "switched": the refusal stays in the drawer, where it is still true.
    expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain("Only the workspace owner");
  });

  it("pauses failed departure retry without starting a new roster read under unknown context", async () => {
    let rosterReads = 0;
    route({
      get_solo_team_workspace: () => ++rosterReads === 1 ? { data: roster([owner, avery, dana]), error: null } : { data: null, error: null },
      team_member_holdings: () => ({ data: null, error: { message: "Holdings are temporarily unavailable." } }),
    });
    const screen = await openScreen();
    await openRemoval();
    expect(drawer()?.textContent).toContain("We couldn't load what Dana holds");
    mocks.tenant.activeTenantId = null;
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    const retry = Array.from(drawer()!.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Try again")!;
    const before = mocks.rpc.mock.calls.length;
    await act(async () => retry.click());
    expect(mocks.rpc.mock.calls.length, "neither holdings nor uncached roster may reread while paused").toBe(before);
    expect(retry.disabled).toBe(true);
    expect(drawer()?.textContent).toContain("review is paused");
  });
});

describe("handing over, then removing", () => {
  async function chooseIn(trigger: HTMLElement, label: string) {
    await act(async () => { key(trigger, "Enter"); });
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes(label));
    expect(option, `option ${label}`).toBeTruthy();
    await act(async () => { key(option!, "Enter"); });
  }

  it("pauses queued hand-overs after the in-flight result and resumes only after a fresh same-workspace Team read", async () => {
    let finishFirst!: (answer: unknown) => void;
    let finishRead!: (answer: unknown) => void;
    let holdRead = false;
    let writes = 0;
    route({
      get_solo_team_workspace: () => holdRead ? new Promise((resolve) => { finishRead = resolve; }) : { data: roster([owner, avery, dana]), error: null },
      team_member_holdings: () => ({ data: holdings({ work: [WORK, { ...WORK, id: "w-2", title: "Second hand-over" }] }), error: null }),
      plan_update_item_versioned: (args) => ++writes === 1 ? new Promise((resolve) => { finishFirst = resolve; }) : { data: { ok: true, item_id: args.p_item_id, tenant_id: "tenant-1", actor_id: "owner-1" }, error: null },
    });
    const screen = await openScreen();
    await openRemoval();
    await chooseIn(drawer()!.querySelector<HTMLElement>('[aria-labelledby="stw-handall-l"]')!, "Avery Cole");
    await act(async () => byText("Continue")!.click());
    await act(async () => byText("Start hand-over")!.click());
    await wait(30);
    expect(writes).toBe(1);
    mocks.tenant.activeTenantId = null;
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    await act(async () => finishFirst({ data: { ok: true, item_id: "w-1", tenant_id: "tenant-1", actor_id: "owner-1" }, error: null }));
    await wait(30);
    expect(writes, "the next original writer waits for renewed context").toBe(1);
    expect(drawer()?.textContent).toContain("1 of 2 saved");
    expect(drawer()?.textContent).toContain("review is paused");
    holdRead = true;
    mocks.tenant.activeTenantId = "tenant-1";
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    await wait();
    expect(writes, "workspace selection alone is not a fresh native Team read").toBe(1);
    await act(async () => finishRead({ data: roster([owner, avery, dana]), error: null }));
    await wait(30);
    expect(writes).toBe(2);
    expect(mocks.rpc.mock.calls.filter(([n]) => n === "plan_update_item_versioned").map(([, args]) => args.p_item_id)).toEqual(["w-1", "w-2"]);
    expect(drawer()?.textContent).toContain("2 of 2 saved");
  });

  it("hands work through Operations' writer and a client through crm-command's confirmation, each on its own", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, avery, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings({ work: [WORK], clients: [CLIENT_ASSIGNED] }), error: null }),
      plan_update_item_versioned: (args) => ({ data: { ok: true, item_id: args.p_item_id, tenant_id: "tenant-1", actor_id: "owner-1" }, error: null }),
      remove_solo_team_member: () => ({ data: { tenant_id: "tenant-1" }, error: null }),
    });
    mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => body.approved_fingerprint
      ? { data: { ok: true, readback: { id: "c-2" } }, error: null }
      : { data: { outcome: "approval_required", fingerprint: "0123456789abcdef", summary: "Change contact c-2's coach to admin-2." }, error: null });
    await openScreen();
    await openRemoval();
    const all = drawer()!.querySelector<HTMLElement>('[aria-labelledby="stw-handall-l"]')!;
    await chooseIn(all, "Avery Cole");
    expect(drawer()!.textContent).toContain("2 of 2 will be handed over");
    await act(async () => byText("Continue")!.click());
    expect(drawer()!.textContent).toContain("2 to Avery Cole");
    expect(drawer()!.textContent).toContain("1 of them (clients, deals and CRM tasks) ask you to confirm");
    await act(async () => byText("Start hand-over")!.click());
    await wait(60);

    const plan = mocks.rpc.mock.calls.find(([n]) => n === "plan_update_item_versioned")!;
    expect(plan[1]).toMatchObject({ p_item_id: "w-1", p_expected_tenant_id: "tenant-1", p_expected_actor_id: "owner-1", p_expected_updated_at: WORK.updated_at, p_assigned_to_user_id: "admin-2" });
    const first = mocks.invoke.mock.calls[0];
    expect(first[0]).toBe("crm-command");
    expect(first[1].body).toMatchObject({ expected_tenant_id: "tenant-1", command: { action: "contact.assign_coach", contact_id: "c-2", expected_updated_at: CLIENT_ASSIGNED.updated_at, owner_user_id: "admin-2" } });
    expect(first[1].body.approved_fingerprint).toBeUndefined();
    expect(drawer()!.textContent).toContain("Assign the client Harbor & Pine to Avery Cole.");
    expect(drawer()!.textContent).toContain("1 of 2 saved");

    await act(async () => byText("Confirm")!.click());
    await wait(30);
    const second = mocks.invoke.mock.calls[1][1].body;
    expect(second.approved_fingerprint).toBe("0123456789abcdef");
    expect(second.idempotency_key, "the confirmation carries the same change's key").toBe(first[1].body.idempotency_key);
    expect(drawer()!.textContent).toContain("2 of 2 saved");
    expect(drawer()!.textContent).toContain("Every change saved.");

    await act(async () => removeButton()!.click());
    await wait();
    expect(document.querySelector(".stw-notice")?.textContent).toContain("Dana Reyes is no longer on the team. 2 things handed over.");
  });

  it("keeps an assigned client's own choice when everything goes to a member, because only an owner or admin may take it", async () => {
    const sam = member({ membership_id: "m-sam", user_id: "member-2", full_name: "Sam Lee", email: "sam@example.com" });
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, sam, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings({ work: [WORK], clients: [CLIENT_ASSIGNED] }), error: null }),
    });
    await openScreen();
    await openRemoval();
    await chooseIn(drawer()!.querySelector<HTMLElement>('[aria-labelledby="stw-handall-l"]')!, "Sam Lee");
    expect(drawer()!.textContent).toContain("1 of 2 will be handed over");
    expect(drawer()!.textContent).toContain("Harbor & Pine can only go to an owner or admin");
  });

  it("reports a changed record as Changed, reads it again, and tries once more with the new version", async () => {
    let reads = 0;
    const fresh = { ...WORK, updated_at: "2026-10-26T11:30:00.000Z" };
    let planCalls = 0;
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, avery, dana]), error: null }),
      team_member_holdings: () => { reads += 1; return { data: holdings({ work: [reads === 1 ? WORK : fresh] }), error: null }; },
      plan_update_item_versioned: (args) => { planCalls += 1; return planCalls === 1 ? { data: null, error: { code: "40001", message: "PLAN_WORK_CHANGED" } } : { data: { ok: true, item_id: args.p_item_id, tenant_id: "tenant-1", actor_id: "owner-1" }, error: null }; },
    });
    await openScreen();
    await openRemoval();
    await chooseIn(drawer()!.querySelector<HTMLElement>('[aria-label^="Hand Kickoff cover options to"]')!, "Avery Cole");
    await act(async () => byText("Continue")!.click());
    await act(async () => byText("Start hand-over")!.click());
    await wait(40);
    expect(drawer()!.querySelector('.stw-chip[data-s="changed"]'), "Changed, not failed and not saved").toBeTruthy();
    expect(drawer()!.textContent).toContain("Someone changed this after you opened the review, so nothing was saved.");
    await act(async () => byText("Check again")!.click());
    await wait(40);
    const retried = mocks.rpc.mock.calls.filter(([n]) => n === "plan_update_item_versioned")[1][1];
    expect(retried.p_expected_updated_at, "the retry carries the version it just read").toBe(fresh.updated_at);
    expect(drawer()!.querySelector('.stw-chip[data-s="saved"]')).toBeTruthy();
  });

  it("closing after a partial hand-over keeps the person on the team and says what saved", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, avery, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings({ work: [WORK] }), error: null }),
      plan_update_item_versioned: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
    });
    await openScreen();
    await openRemoval();
    await chooseIn(drawer()!.querySelector<HTMLElement>('[aria-label^="Hand Kickoff cover options to"]')!, "Avery Cole");
    await act(async () => byText("Continue")!.click());
    await act(async () => byText("Start hand-over")!.click());
    await wait(40);
    expect(drawer()!.textContent).toContain("1 change hasn't finished. If you remove Dana now, it stays with Dana.");
    expect(byText(/^Retry$/)).toBeTruthy();
    await act(async () => byText("Close")!.click());
    expect(removeCalls()).toHaveLength(0);
    expect(document.querySelector(".stw-notice")?.textContent).toContain("Dana Reyes is still on the team. 0 of 1 hand-overs saved, and they stay saved.");
    expect(byText("Review again")).toBeTruthy();
  });
});

describe("departure review lifecycle", () => {
  it("focuses the authored refusal inside the review when removal becomes disabled", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
      remove_solo_team_member: () => ({ data: null, error: { code: "42501", message: "TEAM_MEMBER_PROTECTED: this Paige account is protected; nothing was changed" } }),
    });
    await openScreen();
    await openRemoval();
    await act(async () => byText("Continue")!.click());
    await act(async () => { removeButton()!.focus(); removeButton()!.click(); });
    expect(removeButton()!.disabled).toBe(true);
    expect(document.activeElement).toBe(drawer()!.querySelector('[role="alert"]'));
    expect(removeCalls()).toHaveLength(1);
  });

  it("finishes the original holdings read after StrictMode effect teardown and setup", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }), team_member_holdings: () => ({ data: holdings(), error: null }) });
    const screen = mount(<StrictMode><SoloTeamWorkspace /></StrictMode>);
    await screen.render();
    await wait();
    await openRemoval();
    expect(drawer()?.textContent).toContain("Dana Reyes holds nothing to hand over");
    expect(drawer()?.textContent).not.toContain("Checking Dana's open work");
    expect(removeCalls()).toHaveLength(0);
  });

  it("still suppresses a removal result after a genuine unmount", async () => {
    let settle!: (value: unknown) => void;
    const removed = vi.fn();
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
      remove_solo_team_member: () => new Promise((resolve) => { settle = resolve; }),
    });
    const screen = mount(<StrictMode><DepartureReview member={dana} workspace={roster([owner, dana])} viewerId="owner-1" members={[owner, dana]} onClose={vi.fn()} onRemoved={removed} /></StrictMode>);
    await screen.render();
    await wait(30);
    await act(async () => byText("Continue")!.click());
    await act(async () => removeButton()!.click());
    expect(removeCalls()).toHaveLength(1);
    act(() => screen.root.unmount());
    await act(async () => settle({ data: { tenant_id: "tenant-1" }, error: null }));
    expect(removed).not.toHaveBeenCalled();
  });
});

describe("the refusal vocabulary itself", () => {
  it("recognises every reason this seam authors, and degrades honestly for anything else", () => {
    const cases: Array<[string, RegExp, boolean, boolean]> = [
      ["only the workspace owner may remove someone from this workspace", /Only the workspace owner/, false, false],
      // EXP08: admins may remove members; only the owner removes an admin.
      ["only the workspace owner may remove an admin from this workspace", /Only the workspace owner can remove an admin\. Dana Reyes is still on this team\./, false, false],
      ["only an owner or an admin may remove someone from this workspace", /Only an owner or an admin can remove people/, false, false],
      ["an owner cannot be removed from this workspace here", /is an owner/, false, false],
      ["you cannot remove yourself from this workspace", /can't remove yourself/, false, false],
      ["only an Admin or a Member can be removed from this workspace", /access level isn't one Example Team's team settings can change/, false, false],
      ["your active workspace changed before this could run; nothing was removed", /workspace changed/, false, false],
      ["authentication required in an active workspace", /did not run, and nothing was removed/i, false, false],
      ["that person is not on this workspace's team", /no longer on this team/, false, true],
    ];
    for (const [raw, expected, retryable, reconciled] of cases) {
      const refusal = removalRefusal(raw, "Dana Reyes", "Example Team");
      expect(refusal.message, raw).toMatch(expected);
      expect(refusal.retryable, raw).toBe(retryable);
      expect(refusal.reconciled, raw).toBe(reconciled);
    }
  });

  it("never prints a backend identifier it did not author, and does not promise a retry that cannot work", () => {
    const refusal = removalRefusal("OWNER_GUARD: tenant ownership may only be changed via grant_co_owner()/revoke_co_owner()", "Dana Reyes", "Example Team");
    expect(refusal.message).not.toMatch(/OWNER_GUARD|grant_co_owner|::/);
    expect(refusal.message).toContain("Nothing changed");
    expect(refusal.retryable).toBe(false);
  });

  it("recognises the platform-owner role guard, which a removal can actually trigger", () => {
    const refusal = removalRefusal("Cannot remove admin role from platform owner", "Dana Reyes", "Example Team");
    expect(refusal.message).toMatch(/platform role/);
    expect(refusal.retryable).toBe(false);
  });

  it("translates the authored protected-account refusal without offering another removal", () => {
    expect(removalRefusal("TEAM_MEMBER_PROTECTED: this Paige account is protected; nothing was changed", "Dana Reyes", "Example Team")).toEqual({
      message: "Dana Reyes's Paige account is protected, so they can't be removed from the business here. Nothing changed.",
      retryable: false,
      reconciled: false,
    });
  });

  it("still offers a retry for a transport failure, and calls a server-decided timeout what it is", () => {
    for (const transient of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch", "request timed out"]) {
      expect(removalRefusal(transient, "Dana Reyes", "Example Team").retryable, transient).toBe(true);
    }
    expect(removalRefusal("canceling statement due to lock timeout", "Dana Reyes", "Example Team").message).toContain("cancelled, so nothing changed");
  });

  it("degrades honestly when there is no message at all", () => {
    for (const empty of [null, undefined, ""]) {
      const refusal = removalRefusal(empty, "Dana Reyes", "Example Team");
      expect(refusal.message).toContain("still on this team");
      expect(refusal.retryable).toBe(false);
    }
  });
});

describe("a selection that stops being live", () => {
  it("is cleared, not merely hidden — so the editor cannot reappear on its own later", async () => {
    // Kept: `refresh()` drops every page past the first, so a member reached through "Load more"
    // falls out of the roster on the refresh that follows a save. The selection must be CLEARED,
    // or a later "Load more" re-opens the dialog by itself.
    const page = (members: TeamMemberRecord[]) => roster(members, { total_members: 2 });
    let rosterCall = 0;
    route({
      get_solo_team_workspace: () => { rosterCall += 1; return { data: page(rosterCall === 2 || rosterCall === 4 ? [dana] : [owner]), error: null }; },
      set_solo_team_member_work_profile: () => ({ data: { job_title: "Changed", responsibilities: "Owns client handoffs." }, error: null }),
    });
    await openScreen();
    await act(async () => byText("Load more (1 remaining)")!.click());
    await wait(30);
    const name = Array.from(document.querySelectorAll("button.stw-namebtn")).find((b) => b.textContent?.includes("Dana Reyes")) as HTMLButtonElement;
    expect(name, "Dana's name after Load more").toBeTruthy();
    await act(async () => name.click());
    expect(document.querySelector('[role="dialog"]'), "editor open on the page-2 member").toBeTruthy();
    const title = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Client Success Manager"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Changed");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byText("Save work details")!.click());
    await wait();
    const loadMore = byText("Load more (1 remaining)");
    if (loadMore) await act(async () => loadMore.click());
    await wait(100);
    expect(document.querySelector('[role="dialog"]'), "a dialog must never re-open on its own").toBeFalsy();
  });
});

describe("what the owner hit on production — a save that reports success and reads back the old value", () => {
  it("shows the value it just saved, not the one it replaced, when the roster reload unmounts the editor", async () => {
    // OWNER-REPORTED, 2026-09-03. The write ALWAYS landed; the screen threw it away because the
    // roster reload remounted the editor from a stale snapshot. The roster is deliberately SLOW.
    const withTitle = () => roster([owner, member({ job_title: "", responsibilities: "" })]);
    let saved: { _job_title?: string } | null = null;
    mocks.rpc.mockImplementation((name: string, args: { _job_title?: string }) => {
      if (name === "get_solo_team_workspace") return new Promise((res) => setTimeout(() => res({ data: withTitle(), error: null }), 300));
      if (name === "set_solo_team_member_work_profile") { saved = args; return Promise.resolve({ data: { job_title: args._job_title, responsibilities: "" }, error: null }); }
      return new Promise(() => {});
    });
    const { render } = mount(<SoloTeamWorkspace />);
    await render();
    await wait(500);
    await act(async () => (Array.from(document.querySelectorAll("button.stw-namebtn")).find((b) => b.textContent?.includes("Dana Reyes")) as HTMLButtonElement).click());
    const field = () => document.querySelector<HTMLInputElement>('input[maxlength="121"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field(), "CEO/ Chairman");
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttons().find((b) => /save work details/i.test(b.textContent ?? ""))!.click());
    await wait(500);
    expect((saved as { _job_title?: string } | null)?._job_title).toBe("CEO/ Chairman");
    const onScreen = document.querySelector<HTMLInputElement>('input[maxlength="121"]');
    expect(onScreen, "the editor is still open after the save").toBeTruthy();
    expect(onScreen!.value).toBe("CEO/ Chairman");
  });
});

describe("the editor's way into removal", () => {
  it("offers Remove from team… where the viewer may act, and it opens the departure review", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
    });
    await openScreen();
    await act(async () => (document.querySelector('button[aria-label="Dana Reyes, edit details"]') as HTMLButtonElement).click());
    await act(async () => byText("Remove from team…")!.click());
    await wait(30);
    expect(document.querySelector(".stw-modal"), "the editor closed").toBeNull();
    expect(drawer()?.textContent).toContain("Dana Reyes holds nothing to hand over");
  });

  it("does not offer it on the owner", async () => {
    route({ get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }) });
    await openScreen();
    await act(async () => (document.querySelector('button[aria-label="Ada Owner, edit details"]') as HTMLButtonElement).click());
    expect(document.querySelector(".stw-modal")).toBeTruthy();
    expect(byText("Remove from team…")).toBeFalsy();
  });
});

describe("a workspace switch under an idle departure review", () => {
  it("closes the review and says nothing was changed", async () => {
    route({
      get_solo_team_workspace: () => ({ data: roster([owner, dana]), error: null }),
      team_member_holdings: () => ({ data: holdings(), error: null }),
    });
    const screen = await openScreen();
    await openRemoval();
    expect(drawer()).toBeTruthy();
    mocks.tenant.activeTenantId = "tenant-2";
    await act(async () => screen.root.render(<SoloTeamWorkspace />));
    expect(drawer()).toBeNull();
    expect(String(mocks.error.mock.calls.at(-1)?.[0])).toBe("You switched workspace, so the review for Dana Reyes in Example Team was closed. Nothing was changed.");
    expect(removeCalls()).toHaveLength(0);
  });
});

describe("receivers come from the whole team, not the filtered roster on screen", () => {
  /** get_solo_team_workspace honouring its filters, as the SQL does (search, permission, paging). */
  const filtering = (everyone: TeamMemberRecord[]) => (args: Record<string, unknown>) => {
    const q = typeof args._search === "string" ? args._search.toLowerCase() : "";
    const p = args._permission as string;
    const hit = everyone.filter((m) => (!q || (m.full_name ?? "").toLowerCase().includes(q)) && (p === "all" || m.permission === p));
    const offset = (args._offset as number) ?? 0; const limit = (args._limit as number) ?? 25;
    return { data: roster(hit.slice(offset, offset + limit), { total_members: hit.length }), error: null };
  };
  const options = async (trigger: HTMLElement) => {
    await act(async () => { key(trigger, "Enter"); });
    const labels = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? "");
    await act(async () => { key(document.querySelector('[role="listbox"]')!, "Escape"); });
    return labels;
  };
  const typeSearch = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>(".stw-filters input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await wait(300);
  };

  it("with a search active, the owner and admins are still offered", async () => {
    route({ get_solo_team_workspace: filtering([owner, avery, dana]), team_member_holdings: () => ({ data: holdings({ work: [WORK], clients: [CLIENT_ASSIGNED] }), error: null }) });
    await openScreen();
    await typeSearch("Dana");
    expect(document.querySelector('[aria-label="Actions for Avery Cole"]'), "the roster on screen is filtered").toBeNull();
    await openRemoval();
    const all = await options(drawer()!.querySelector<HTMLElement>('[aria-labelledby="stw-handall-l"]')!);
    expect(all.some((l) => l.includes("Ada Owner")) && all.some((l) => l.includes("Avery Cole")), all.join(" | ")).toBe(true);
    const full = mocks.rpc.mock.calls.find(([n, a]) => n === "get_solo_team_workspace" && a._permission === "all" && a._search === null && a._limit === 100);
    expect(full, "the review reads the whole team itself").toBeTruthy();
  });

  it("under Show: Members, an assigned client can still go to the owner or an admin", async () => {
    route({ get_solo_team_workspace: filtering([owner, avery, dana]), team_member_holdings: () => ({ data: holdings({ clients: [CLIENT_ASSIGNED] }), error: null }) });
    await openScreen();
    const filter = document.querySelector<HTMLElement>('.stw-filters [role="combobox"]')!;
    await act(async () => { key(filter, "Enter"); });
    await act(async () => { key(document.querySelector('[role="option"][data-value="member"]')!, "Enter"); });
    await wait(300);
    expect(document.querySelector('[aria-label="Actions for Avery Cole"]'), "admins are filtered off screen").toBeNull();
    await openRemoval();
    const client = Array.from(drawer()!.querySelectorAll<HTMLElement>('[role="combobox"]')).find((c) => c.getAttribute("aria-label")?.startsWith("Hand Harbor & Pine to"))!;
    const labels = await options(client);
    expect(labels.some((l) => l.includes("Ada Owner")), labels.join(" | ")).toBe(true);
    expect(labels.some((l) => l.includes("Avery Cole")), labels.join(" | ")).toBe(true);
  });
});
