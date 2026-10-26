// node --test supabase/functions/_shared/team-lifecycle/chat.test.ts   (also runs under `deno test`)
// EXP08 team lifecycle — PAIGE's team reads and approved team writes (team-lifecycle/chat.ts).
// EVIDENCE CLASS: unit tests over the dispatch module with an in-memory caller double. They prove the
// exact RPC each tool calls, that the tenant is the server's and the actor the session's, how answered
// refusals and unknown outcomes are told apart, and what the cards say. They are not a run against a
// database; the definers' own authority is proven by supabase/tests/exp08_team_lifecycle.sql.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_LIFECYCLE_READERS, runTeamLifecycleWrite, teamLifecycleRefusal, teamLifecycleConfirmSummary,
  holdingsSentence, parseHandoverArgs, conversationsValue, readHoldingsForCard, readWorkItemForCard, teamText,
  type TeamLifecycleCaller,
} from "./chat.ts";

const T = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP = "55555555-5555-4555-8555-555555555555";
const scope = { tenantId: T, userId: ME };

type Call = { name: string; args: Record<string, unknown> | undefined };
function caller(answer: (name: string, args: Record<string, unknown> | undefined) => { data: unknown; error: { code?: string; message?: string } | null } | Promise<never>) {
  const calls: Call[] = [];
  const c: TeamLifecycleCaller = { rpc(name, args) { calls.push({ name, args }); return answer(name, args) as any; } };
  return { c, calls };
}
const ok = (data: unknown) => () => ({ data, error: null });
const refuse = (message: string, code = "P0001") => () => ({ data: null, error: { code, message } });

describe("each approved write calls exactly its definer, on the caller, with the server tenant", () => {
  for (const [tool, rpc, status] of [["team_suspend_member", "suspend_solo_team_member", "suspended"], ["team_reinstate_member", "reinstate_solo_team_member", "active"]] as const) {
    it(`${tool} -> ${rpc}`, async () => {
      const { c, calls } = caller(ok({ tenant_id: T, membership_id: MEMBERSHIP, user_id: SAM, status }));
      const r = await runTeamLifecycleWrite(tool, scope, c, { member_user_id: SAM, tenant_id: "99999999-9999-4999-8999-999999999999", actor: ME });
      assert.deepEqual(calls, [{ name: rpc, args: { _member_user_id: SAM, _expected_tenant_id: T } }]);
      assert.equal(r.success, true);
      assert.deepEqual((r as any).record_locator, { table: "tenant_members", id: MEMBERSHIP });
    });
  }
  it("team_remove_member -> remove_solo_team_member and confirms the removed person", async () => {
    const { c, calls } = caller(ok({ tenant_id: T, membership_id: MEMBERSHIP, removed_user_id: SAM }));
    const r = await runTeamLifecycleWrite("team_remove_member", scope, c, { member_user_id: SAM });
    assert.deepEqual(calls, [{ name: "remove_solo_team_member", args: { _member_user_id: SAM, _expected_tenant_id: T } }]);
    assert.equal(r.success, true);
  });
  it("team_set_conversations passes the boolean as _on", async () => {
    const { c, calls } = caller(ok({ tenant_id: T, membership_id: MEMBERSHIP, user_id: SAM, team_hub_access: false, changed: true, joined_channels: 0 }));
    const r = await runTeamLifecycleWrite("team_set_conversations", scope, c, { member_user_id: SAM, on: false });
    assert.deepEqual(calls, [{ name: "set_solo_team_member_team_hub_access", args: { _member_user_id: SAM, _expected_tenant_id: T, _on: false } }]);
    assert.equal((r as any).team_conversations, "off");
  });
  it("team_handover_work -> plan_update_item_versioned with the caller as expected actor and status/due unchanged", async () => {
    const at = "2026-10-26T10:00:00.123456+00:00";
    const { c, calls } = caller(ok({ ok: true, item_id: ITEM, tenant_id: T, actor_id: ME }));
    const r = await runTeamLifecycleWrite("team_handover_work", scope, c, { item_id: ITEM, expected_updated_at: at, assigned_to_user_id: SAM, status: "done", p_expected_actor_id: SAM });
    assert.deepEqual(calls, [{ name: "plan_update_item_versioned", args: {
      p_item_id: ITEM, p_expected_actor_id: ME, p_expected_tenant_id: T, p_expected_updated_at: at,
      p_status: null, p_due_at: null, p_assigned_to_user_id: SAM } }]);
    assert.equal(r.success, true);
    assert.deepEqual((r as any).record_locator, { table: "plan_items", id: ITEM });
  });
});

describe("only a confirmed answer is success; anything else is unknown, never a guess", () => {
  it("an answer about another person is unknown", async () => {
    const { c } = caller(ok({ tenant_id: T, user_id: ME, status: "suspended" }));
    const r = await runTeamLifecycleWrite("team_suspend_member", scope, c, { member_user_id: SAM });
    assert.equal((r as any).outcome_unknown, true);
  });
  it("an answer about another workspace is unknown", async () => {
    const { c } = caller(ok({ tenant_id: "99999999-9999-4999-8999-999999999999", user_id: SAM, status: "suspended" }));
    assert.equal(((await runTeamLifecycleWrite("team_suspend_member", scope, c, { member_user_id: SAM })) as any).outcome_unknown, true);
  });
  it("the wrong landed status is unknown", async () => {
    const { c } = caller(ok({ tenant_id: T, user_id: SAM, status: "active" }));
    assert.equal(((await runTeamLifecycleWrite("team_suspend_member", scope, c, { member_user_id: SAM })) as any).outcome_unknown, true);
  });
  it("a switch answer with a different value is unknown", async () => {
    const { c } = caller(ok({ tenant_id: T, user_id: SAM, team_hub_access: true, changed: true }));
    assert.equal(((await runTeamLifecycleWrite("team_set_conversations", scope, c, { member_user_id: SAM, on: false })) as any).outcome_unknown, true);
  });
  it("a hand-over acknowledged for another actor is unknown", async () => {
    const { c } = caller(ok({ ok: true, item_id: ITEM, tenant_id: T, actor_id: SAM }));
    const r = await runTeamLifecycleWrite("team_handover_work", scope, c, { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z", assigned_to_user_id: SAM });
    assert.equal((r as any).outcome_unknown, true);
  });
  it("a thrown call is unknown", async () => {
    const { c } = caller(() => Promise.reject(new Error("socket hang up")));
    assert.equal(((await runTeamLifecycleWrite("team_remove_member", scope, c, { member_user_id: SAM })) as any).outcome_unknown, true);
  });
  it("an error without a SQLSTATE (a gateway) is unknown", async () => {
    const { c } = caller(refuse("TypeError: fetch failed", ""));
    assert.equal(((await runTeamLifecycleWrite("team_remove_member", scope, c, { member_user_id: SAM })) as any).outcome_unknown, true);
  });
});

describe("answered refusals become plain sentences, never a code", () => {
  const cases: Array<[string, RegExp]> = [
    ["only the workspace owner may suspend an admin in this workspace", /Only the workspace owner can do that to an admin/],
    ["only an owner or an admin may remove someone from this workspace", /owner or an admin can do that/],
    ["you cannot suspend yourself in this workspace", /themselves/],
    ["you cannot change your own team conversations here", /themselves/],
    ["an owner cannot be removed from this workspace here", /workspace owner/],
    ["an owner's team conversations cannot be changed here", /workspace owner/],
    ["that person is not on this workspace's team", /isn't on this workspace's team/],
    ["only an active teammate can be suspended; nothing was changed", /nothing to suspend/],
    ["only a suspended teammate can be reinstated; nothing was changed", /nothing to reinstate/],
    ["your active workspace changed before this could run; nothing was removed", /workspace changed/],
    ["only the workspace owner can change a suspended teammate's role or seat; nothing was changed", /suspended teammate's seat/],
    ["PLAN_FORBIDDEN: Solo Operations unavailable", /Solo business account/],
    ["PLAN_ASSIGNEE_NOT_IN_TENANT", /isn't an active teammate/],
    ["PLAN_ITEM_UNAVAILABLE", /isn't available to you/],
    ["PLAN_SCOPE_CHANGED", /workspace changed/],
  ];
  for (const [message, want] of cases) it(message, () => assert.match(teamLifecycleRefusal(message) ?? "", want));
  it("the write result carries the sentence, not the code, and is not applied", async () => {
    const { c } = caller(refuse("only the workspace owner may remove an admin from this workspace", "42501"));
    const r = await runTeamLifecycleWrite("team_remove_member", scope, c, { member_user_id: SAM }) as any;
    assert.equal(r.not_applied, true);
    assert.equal(r.refused_before_run, undefined, "the database answered; the call was made");
    assert.doesNotMatch(r.error, /42501|P0001|PLAN_/);
    assert.match(r.error, /Only the workspace owner/);
  });
  it("a version conflict (40001) says it changed since you looked", async () => {
    const { c } = caller(refuse("PLAN_WORK_CHANGED", "40001"));
    const r = await runTeamLifecycleWrite("team_handover_work", scope, c, { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z", assigned_to_user_id: SAM }) as any;
    assert.equal(r.reason, "changed");
    assert.match(r.error, /changed since you looked.*holdings again/);
  });
  it("an unknown SQLSTATE refusal still says nothing changed, in words", async () => {
    const { c } = caller(refuse("something new", "P0001"));
    const r = await runTeamLifecycleWrite("team_suspend_member", scope, c, { member_user_id: SAM }) as any;
    assert.equal(r.not_applied, true);
    assert.match(r.error, /nothing was changed/);
  });
});

describe("refused before any call", () => {
  it("no workspace, a malformed id, an unparsed switch or a bad hand-over never call the database", async () => {
    const { c, calls } = caller(ok({}));
    for (const [tool, s, input] of [
      ["team_suspend_member", { tenantId: null, userId: ME }, { member_user_id: SAM }],
      ["team_suspend_member", scope, { member_user_id: "3333" }],
      ["team_set_conversations", scope, { member_user_id: SAM, on: "maybe" }],
      ["team_handover_work", scope, { item_id: ITEM, expected_updated_at: "yesterday", assigned_to_user_id: SAM }],
      ["team_handover_work", scope, { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z" }],
      ["team_promote_member", scope, { member_user_id: SAM }],
    ] as const) {
      const r = await runTeamLifecycleWrite(tool, s, c, input) as any;
      assert.equal(r.success, false, tool);
      assert.equal(r.refused_before_run, true, tool);
    }
    assert.equal(calls.length, 0);
  });
  it("the switch accepts a boolean or its words", () => {
    assert.equal(conversationsValue(true), true);
    assert.equal(conversationsValue("Off"), false);
    assert.equal(conversationsValue("on"), true);
    assert.equal(conversationsValue(1), null);
  });
  it("parses the hand-over strictly", () => {
    assert.deepEqual(parseHandoverArgs({ item_id: ITEM.toUpperCase(), expected_updated_at: " 2026-10-26 10:00:00.5+00 ", assigned_to_user_id: SAM }),
      { itemId: ITEM, expectedUpdatedAt: "2026-10-26 10:00:00.5+00", receiverId: SAM });
    assert.ok("problem" in parseHandoverArgs({ item_id: ITEM, expected_updated_at: "2026-10-26", assigned_to_user_id: SAM }));
  });
});

describe("team_list_members", () => {
  const roster = { tenant_id: T, total_members: 3, members: [
    { user_id: ME, full_name: "Owner Person", email: "owner@example.com", status: "active", permission: "owner", is_owner: true, job_title: "Founder" },
    { user_id: SAM, full_name: "Sam\nRivera", email: "sam@example.com", status: "suspended", permission: "member", is_owner: false, job_title: null },
  ] };
  it("returns names, ids, access, status and title, never an email, and says showing N of M", async () => {
    const { c, calls } = caller(ok(roster));
    const r = await TEAM_LIFECYCLE_READERS.team_list_members(scope, c, { limit: 2, search: " sam " });
    assert.deepEqual(calls, [{ name: "get_solo_team_workspace", args: { _search: "sam", _permission: "all", _limit: 2, _offset: 0 } }]);
    assert.equal(r.status, "available");
    assert.doesNotMatch(JSON.stringify(r), /@example\.com/);
    assert.deepEqual((r.members as any[])[1], { user_id: SAM, name: "Sam Rivera", permission: "member", status: "suspended", title: null });
    assert.equal((r.members as any[])[0].permission, "owner");
    assert.match(String(r.message), /Showing 2 of 3 matching teammates/);
  });
  it("refuses a roster from another workspace", async () => {
    const { c } = caller(ok({ ...roster, tenant_id: "99999999-9999-4999-8999-999999999999" }));
    assert.equal((await TEAM_LIFECYCLE_READERS.team_list_members(scope, c, {})).status, "refused");
  });
  it("a bad limit is needs_input and calls nothing", async () => {
    const { c, calls } = caller(ok(roster));
    assert.equal((await TEAM_LIFECYCLE_READERS.team_list_members(scope, c, { limit: 500 })).status, "needs_input");
    assert.equal(calls.length, 0);
  });
});

const holdingsAnswer = {
  ok: true,
  member: { user_id: SAM, display_name: "Sam Rivera", role: "member", status: "active", team_hub_access: true },
  holdings: {
    work: [{ id: ITEM, title: "Prep the kickoff", status: "open", due_at: null, updated_at: "2026-10-26T10:00:00.123456+00:00", client_id: null, client_label: null }],
    crm_tasks: [{ id: "66666666-6666-4666-8666-666666666666", title: "Call back", status: "pending", due_date: null, updated_at: "2026-10-25T09:00:00+00:00" }],
    clients: [
      { id: "77777777-7777-4777-8777-777777777777", label: "Dana Lee", relation: "assigned", updated_at: "2026-10-24T09:00:00+00:00" },
      { id: "77777777-7777-4777-8777-777777777777", label: "Dana Lee", relation: "lead_owner", updated_at: "2026-10-24T09:00:00+00:00" },
    ],
    deals: [{ id: "88888888-8888-4888-8888-888888888888", title: "Retainer", status: "open", value_cents: 500000, currency: "usd", version: 7 }],
    approvals: [{ id: "a", kind: "email", summary: "Send the welcome", status: "pending", created_at: "2026-10-20T00:00:00Z" }],
    mailboxes: [{ id: "m", channel: "email", provider: "google", mailbox_class: "personal", label: "Sam's Gmail", address: "sam@example.com" }],
  },
  counts: { work: 60, crm_tasks: 1, clients: 2, deals: 1, approvals: 1, mailboxes: 1 },
};

describe("team_member_holdings", () => {
  it("calls the definer with the server tenant and names the exact hand-over call for every movable row", async () => {
    const { c, calls } = caller(ok(holdingsAnswer));
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings(scope, c, { member_user_id: SAM, _expected_tenant_id: "99999999-9999-4999-8999-999999999999" }) as any;
    assert.deepEqual(calls, [{ name: "team_member_holdings", args: { _member_user_id: SAM, _expected_tenant_id: T } }]);
    assert.equal(r.status, "available");
    assert.equal(r.work.shown, "showing 1 of 60");
    assert.deepEqual(r.work.items[0].hand_over, { tool: "team_handover_work", args: { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00.123456+00:00", assigned_to_user_id: "<receiver user_id>" } });
    assert.deepEqual(r.crm_tasks.items[0].hand_over.args.patch, { assignee_user_id: "<receiver user_id>" });
    assert.equal(r.crm_tasks.items[0].hand_over.tool, "crm_assign_task");
    assert.deepEqual(r.clients.items.map((x: any) => x.hand_over.tool), ["crm_assign_coach", "crm_assign_contact_owner"]);
    assert.equal(r.clients.items[0].hand_over.receiver_must_be, "an owner or admin");
    assert.deepEqual(r.deals.items[0].hand_over, { tool: "crm_assign_deal_owner", args: { deal_id: "88888888-8888-4888-8888-888888888888", expected_version: 7, owner_user_id: "<receiver user_id>" } });
    assert.match(r.approvals.cannot_hand_over, /cannot be handed over/);
    assert.match(r.mailboxes.cannot_hand_over, /cannot be handed over/);
    assert.doesNotMatch(JSON.stringify(r), /sam@example\.com/, "no mailbox address");
  });
  it("an answer about someone else is not shown", async () => {
    const { c } = caller(ok({ ...holdingsAnswer, member: { ...holdingsAnswer.member, user_id: ME } }));
    assert.equal((await TEAM_LIFECYCLE_READERS.team_member_holdings(scope, c, { member_user_id: SAM })).status, "unavailable");
  });
  it("an admin asking about an admin hears the owner-only rule in words", async () => {
    const { c } = caller(refuse("only the workspace owner may review what an admin holds", "42501"));
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings(scope, c, { member_user_id: SAM });
    assert.equal(r.status, "refused");
    assert.match(String(r.message), /Only the workspace owner can do that to an admin/);
    assert.doesNotMatch(String(r.message), /42501/);
  });
});

describe("the cards", () => {
  const counts = holdingsAnswer.counts;
  it("removal states what they still hold", () => {
    const s = teamLifecycleConfirmSummary("team_remove_member", { who: "Sam Rivera (sam@example.com)", holdings: { counts, teamConversations: true } });
    assert.match(s, /^Remove Sam Rivera \(sam@example\.com\) from this workspace\./);
    assert.match(s, /60 pieces of open work, 1 open CRM task, 2 client relationships and 1 open deal/);
    assert.match(s, /1 approval is assigned to them and 1 mailbox is connected in their name; those cannot be handed over/);
  });
  it("removal says plainly when it could not check", () => {
    assert.match(teamLifecycleConfirmSummary("team_remove_member", { who: "Sam", holdings: null }), /couldn't check what they still hold/);
  });
  it("removal of someone holding nothing says so", () => {
    assert.match(holdingsSentence({ work: 0, crm_tasks: 0, clients: 0, deals: 0, approvals: 0, mailboxes: 0 }), /hold no open work/);
  });
  it("the switch names on/off, what it means, and its current value", () => {
    const off = teamLifecycleConfirmSummary("team_set_conversations", { who: "Sam", on: false, holdings: { counts, teamConversations: true } });
    assert.match(off, /OFF for Sam.*won't be able to read or post.*keep their assigned work\. They are on now\./);
    const same = teamLifecycleConfirmSummary("team_set_conversations", { who: "Sam", on: true, holdings: { counts, teamConversations: true } });
    assert.match(same, /ON for Sam.*already on, so approving changes nothing/);
  });
  it("the hand-over names the work, the receiver and the holder", () => {
    assert.equal(teamLifecycleConfirmSummary("team_handover_work", { who: "", title: "Prep the kickoff", receiver: "Ana", holder: "Sam" }),
      "Hand \"Prep the kickoff\" to Ana. It moves off Sam's work list onto theirs; its status and due date stay as they are.");
  });
  it("readHoldingsForCard returns null on any refusal", async () => {
    const { c } = caller(refuse("only the workspace owner may review what an admin holds", "42501"));
    assert.equal(await readHoldingsForCard(scope, c, SAM), null);
  });
  it("readWorkItemForCard reads one item of this tenant on the caller and fails closed", async () => {
    const filters: Array<[string, unknown]> = [];
    const chain = (row: unknown) => ({ select() { return this; }, eq(k: string, v: unknown) { filters.push([k, v]); return this; }, maybeSingle: async () => ({ data: row, error: null }) });
    const reader = { from: (t: string) => { assert.equal(t, "plan_items"); return chain({ id: ITEM, tenant_id: T, title: "Prep", status: "done", assigned_to_user_id: SAM }); } };
    assert.deepEqual(await readWorkItemForCard(reader, T, ITEM), { title: "Prep", assignee: SAM, open: false });
    assert.deepEqual(filters, [["id", ITEM], ["tenant_id", T]]);
    assert.equal(await readWorkItemForCard({ from: () => chain(null) }, T, ITEM), null);
    assert.equal(await readWorkItemForCard(reader, null, ITEM), null);
  });
  it("tenant-authored text is flattened to one capped line", () => {
    assert.equal(teamText("a\n\nb\u2028c", 80), "a b c");
    assert.equal(teamText("x".repeat(200), 10)?.length, 10);
  });
});
