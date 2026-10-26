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
  teamLifecyclePreCardProblem, findTeamRosterMember, readSentence, TEAM_LIFECYCLE_REFUSALS, NOT_GONE_THROUGH,
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
    ["PLAN_FORBIDDEN: Solo Operations unavailable", /only on a standalone business account, not an agency or a sub-account/],
    ["PLAN_UPDATE_UNCONFIRMED", /couldn't confirm the hand-over, so it was rolled back and nothing was moved/],
    ["PLAN_ASSIGNEE_NOT_IN_TENANT", /isn't an active teammate/],
    ["PLAN_ITEM_UNAVAILABLE", /isn't available to you/],
    ["PLAN_SCOPE_CHANGED", /workspace changed/],
  ];
  for (const [message, want] of cases) it(message, () => assert.match(teamLifecycleRefusal(message) ?? "", want));
  it("the write result carries the sentence, not the code, and is not applied", async () => {
    const { c } = caller(refuse("only the workspace owner may remove an admin from this workspace", "42501"));
    const r = await runTeamLifecycleWrite("team_remove_member", scope, c, { member_user_id: SAM }) as any;
    assert.equal(r.not_applied, true);
    assert.doesNotMatch(r.error, /42501|P0001|PLAN_/);
    assert.match(r.error, /Only the workspace owner/);
  });
  it("a version conflict (40001) says it changed since you looked", async () => {
    const { c } = caller(refuse("PLAN_WORK_CHANGED", "40001"));
    const r = await runTeamLifecycleWrite("team_handover_work", scope, c, { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z", assigned_to_user_id: SAM }) as any;
    assert.equal(r.reason, "changed");
    assert.match(r.error, /changed since you looked.*holdings again/);
  });
  it("an unknown SQLSTATE refusal says it didn't go through, never that it wasn't allowed", async () => {
    for (const [tool, input, code] of [
      ["team_suspend_member", { member_user_id: SAM }, "P0001"],
      ["team_remove_member", { member_user_id: SAM }, "57014"],
      ["team_handover_work", { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z", assigned_to_user_id: SAM }, "40P01"],
    ] as const) {
      const { c } = caller(refuse("something new", code));
      const r = await runTeamLifecycleWrite(tool, scope, c, input) as any;
      assert.equal(r.not_applied, true, tool);
      assert.equal(r.error, NOT_GONE_THROUGH, tool);
      assert.doesNotMatch(r.error, /allowed/, tool);
    }
  });
  it("a hand-over the writer could not confirm (PLAN_UPDATE_UNCONFIRMED) says so, not 'not allowed'", async () => {
    const { c } = caller(refuse("PLAN_UPDATE_UNCONFIRMED", "P0001"));
    const r = await runTeamLifecycleWrite("team_handover_work", scope, c, { item_id: ITEM, expected_updated_at: "2026-10-26T10:00:00Z", assigned_to_user_id: SAM }) as any;
    assert.equal(r.not_applied, true);
    assert.match(r.error, /couldn't confirm the hand-over/);
    assert.doesNotMatch(r.error, /allowed/);
  });
  it("a read refusal never says 'nothing was changed' as well as 'Nothing was read'", async () => {
    for (const [, sentence] of TEAM_LIFECYCLE_REFUSALS) assert.doesNotMatch(readSentence(sentence), /nothing was (changed|moved)/i, sentence);
    const { c } = caller(refuse("your active workspace changed before this could run; nothing was changed", "42501"));
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings(scope, c, { member_user_id: SAM });
    assert.equal(r.status, "refused");
    assert.equal(r.message, 'Tell the person: "Your active workspace changed before this could run. Open the workspace you mean and ask again." Nothing was read.');
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
      assert.equal(r.not_applied, true, tool);
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
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings({ ...scope, accountShape: "solo" }, c, { member_user_id: SAM, _expected_tenant_id: "99999999-9999-4999-8999-999999999999" }) as any;
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
    assert.equal(r.member.team_conversations, "on");
  });
  it("outside a standalone business account no work hand-over is offered, and it says why", async () => {
    for (const accountShape of ["not_solo", "unknown", undefined] as const) {
      const { c } = caller(ok(holdingsAnswer));
      const r = await TEAM_LIFECYCLE_READERS.team_member_holdings({ ...scope, accountShape }, c, { member_user_id: SAM }) as any;
      assert.equal(r.status, "available", String(accountShape));
      assert.ok(r.work.items.length === 1 && !("hand_over" in r.work.items[0]), String(accountShape));
      assert.doesNotMatch(JSON.stringify(r.work), /team_handover_work/, String(accountShape));
      assert.equal(typeof r.work.cannot_hand_over, "string", String(accountShape));
      // The CRM hand-overs are not the Work writer and stay offered on every account shape.
      assert.equal(r.crm_tasks.items[0].hand_over.tool, "crm_assign_task");
    }
    const { c } = caller(ok(holdingsAnswer));
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings({ ...scope, accountShape: "not_solo" }, c, { member_user_id: SAM }) as any;
    assert.match(r.work.cannot_hand_over, /only on a standalone business account, not an agency or a sub-account/);
  });
  it("a client hand-over names the contact by client_ref (its account number) as the CRM tools ask, and keeps contact_id", async () => {
    const DANA = "77777777-7777-4777-8777-777777777777";
    const reads: Array<[string, unknown]> = [];
    const chain = { select(cols: string) { reads.push(["select", cols]); return this; }, eq(k: string, v: unknown) { reads.push([k, v]); return this; },
      in: async (k: string, v: unknown) => { reads.push([k, v]); return { data: [{ id: DANA, tenant_id: T, account_number: "clt-000123" }, { id: "99999999-9999-4999-8999-999999999999", tenant_id: T, account_number: "CLT-9" }], error: null }; } };
    const c: any = { rpc: async () => ({ data: holdingsAnswer, error: null }), from: (t: string) => { assert.equal(t, "clients"); return chain; } };
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings({ ...scope, accountShape: "solo" }, c, { member_user_id: SAM }) as any;
    assert.deepEqual(r.clients.items.map((x: any) => x.hand_over.args), [
      { client_ref: "CLT-000123", contact_id: DANA, expected_updated_at: "2026-10-24T09:00:00+00:00", owner_user_id: "<receiver user_id>" },
      { client_ref: "CLT-000123", contact_id: DANA, expected_updated_at: "2026-10-24T09:00:00+00:00", owner_user_id: "<receiver user_id>" },
    ]);
    assert.deepEqual(reads, [["select", "id, tenant_id, account_number"], ["tenant_id", T], ["id", [DANA]]]);
  });
  it("without a readable account number the client hint keeps contact_id alone (crm-command accepts it)", async () => {
    const c: any = { rpc: async () => ({ data: holdingsAnswer, error: null }), from: () => { throw new Error("no table read"); } };
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings({ ...scope, accountShape: "solo" }, c, { member_user_id: SAM }) as any;
    assert.deepEqual(Object.keys(r.clients.items[0].hand_over.args), ["contact_id", "expected_updated_at", "owner_user_id"]);
  });
  it("Team conversations read as unknown when the review did not say", async () => {
    const { c } = caller(ok({ ...holdingsAnswer, member: { ...holdingsAnswer.member, team_hub_access: undefined } }));
    const r = await TEAM_LIFECYCLE_READERS.team_member_holdings(scope, c, { member_user_id: SAM }) as any;
    assert.equal(r.member.team_conversations, "unknown");
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
    assert.match(s, /Once they've left, nobody can disconnect that mailbox/);
  });
  it("removal of someone with no mailbox says nothing about disconnecting one", () => {
    assert.doesNotMatch(holdingsSentence({ ...counts, mailboxes: 0 }), /disconnect/);
  });
  it("suspension mentions a mailbox only when they have one or it could not be checked", () => {
    assert.doesNotMatch(teamLifecycleConfirmSummary("team_suspend_member", { who: "Sam", holdings: { counts: { ...counts, mailboxes: 0 }, teamConversations: true } }), /mailbox/);
    assert.match(teamLifecycleConfirmSummary("team_suspend_member", { who: "Sam", holdings: { counts, teamConversations: true } }), /Sends from the mailbox they connected stop/);
    assert.match(teamLifecycleConfirmSummary("team_suspend_member", { who: "Sam", holdings: null }), /Sends from any mailbox they connected stop/);
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
  it("the switch promises channel effects only on a standalone business account", () => {
    const solo = teamLifecycleConfirmSummary("team_set_conversations", { who: "Sam", on: true, accountShape: "solo" });
    assert.match(solo, /^Turn Team conversations ON for Sam\. They rejoin every open team channel/);
    for (const on of [true, false]) {
      const other = teamLifecycleConfirmSummary("team_set_conversations", { who: "Sam", on, accountShape: "not_solo" });
      assert.match(other, /Team Hub runs only on a standalone business account/);
      assert.doesNotMatch(other, /rejoin|won't be able to read or post/);
    }
    assert.match(teamLifecycleConfirmSummary("team_set_conversations", { who: "Sam", on: true, accountShape: "unknown" }),
      /If this workspace has Team Hub \(a standalone business account\), they rejoin/);
  });
  it("the hand-over names the work, the receiver and the holder", () => {
    assert.equal(teamLifecycleConfirmSummary("team_handover_work", { who: "", title: "Prep the kickoff", receiver: "Ana", holder: "Sam" }),
      "Hand \"Prep the kickoff\" to Ana. It moves off Sam's work list onto theirs; its status and due date stay as they are.");
  });
  it("an unassigned piece of work is not said to move off anyone's list", () => {
    const s = teamLifecycleConfirmSummary("team_handover_work", { who: "", title: "Prep", receiver: "Ana", holder: null, unassigned: true });
    assert.match(s, /isn't assigned to anyone yet, so approving puts it on their work list/);
    assert.doesNotMatch(s, /moves off/);
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

describe("the hand-over reads the assignment back", () => {
  const at = "2026-10-26T10:00:00Z";
  const withRow = (row: unknown) => ({
    rpc: async () => ({ data: { ok: true, item_id: ITEM, tenant_id: T, actor_id: ME }, error: null }),
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: row, error: null }) }),
  });
  it("success says it read the new assignee back", async () => {
    const r = await runTeamLifecycleWrite("team_handover_work", scope, withRow({ id: ITEM, tenant_id: T, title: "Prep", status: "open", assigned_to_user_id: SAM }) as any,
      { item_id: ITEM, expected_updated_at: at, assigned_to_user_id: SAM }) as any;
    assert.equal(r.success, true);
    assert.equal(r.assignment_read_back, true);
  });
  it("a read-back showing someone else is outcome unknown, never success", async () => {
    const r = await runTeamLifecycleWrite("team_handover_work", scope, withRow({ id: ITEM, tenant_id: T, title: "Prep", status: "open", assigned_to_user_id: ME }) as any,
      { item_id: ITEM, expected_updated_at: at, assigned_to_user_id: SAM }) as any;
    assert.equal(r.outcome_unknown, true);
  });
  it("no read-back possible keeps the writer's confirmation and says it was not re-read", async () => {
    const r = await runTeamLifecycleWrite("team_handover_work", scope, withRow(null) as any, { item_id: ITEM, expected_updated_at: at, assigned_to_user_id: SAM }) as any;
    assert.equal(r.success, true);
    assert.equal(r.assignment_read_back, false);
    assert.match(r.note, /couldn't read it back/);
  });
});

describe("the card gate refuses, before any card, what every definer would refuse", () => {
  const member = (user_id: string, permission: string, status = "active", is_owner = false) => ({ user_id, permission, status, is_owner });
  const ANA = "66666666-6666-4666-8666-666666666666";
  const cases: Array<[string, string, Parameters<typeof teamLifecyclePreCardProblem>[1], RegExp | null]> = [
    ["self", "team_suspend_member", { target: member(ME, "admin"), viewerId: ME, viewerPermission: "admin" }, /themselves/],
    ["the owner", "team_remove_member", { target: member(ANA, "owner", "active", true), viewerId: ME, viewerPermission: "owner" }, /workspace owner/],
    ["unknown person", "team_remove_member", { target: null, viewerId: ME, viewerPermission: "owner" }, /can't confirm who that is/],
    ["a member caller", "team_suspend_member", { target: member(SAM, "member"), viewerId: ME, viewerPermission: "member" }, /owner or an admin can do that/],
    ["admin on admin", "team_suspend_member", { target: member(SAM, "admin"), viewerId: ME, viewerPermission: "admin" }, /Only the workspace owner can do that to an admin/],
    ["older access kind", "team_suspend_member", { target: member(SAM, "coach"), viewerId: ME, viewerPermission: "owner" }, /Admin or Member/],
    ["suspend a suspended person", "team_suspend_member", { target: member(SAM, "member", "suspended"), viewerId: ME, viewerPermission: "owner" }, /nothing to suspend/],
    ["reinstate an active person", "team_reinstate_member", { target: member(SAM, "member", "active"), viewerId: ME, viewerPermission: "owner" }, /nothing to reinstate/],
    ["switch for a non-current person", "team_set_conversations", { target: member(SAM, "member", "removed"), viewerId: ME, viewerPermission: "owner" }, /current teammate/],
    ["owner suspends an admin", "team_suspend_member", { target: member(SAM, "admin"), viewerId: ME, viewerPermission: "owner" }, null],
    ["admin reinstates a suspended member", "team_reinstate_member", { target: member(SAM, "member", "suspended"), viewerId: ME, viewerPermission: "admin" }, null],
    ["admin removes a suspended member", "team_remove_member", { target: member(SAM, "member", "suspended"), viewerId: ME, viewerPermission: "admin" }, null],
    ["switch for a suspended member", "team_set_conversations", { target: member(SAM, "member", "suspended"), viewerId: ME, viewerPermission: "owner" }, null],
  ];
  for (const [label, tool, facts, want] of cases) it(label, () => {
    const problem = teamLifecyclePreCardProblem(tool, facts);
    if (want) { assert.match(problem ?? "", want); assert.match(problem ?? "", /haven't asked you to approve anything/); }
    else assert.equal(problem, null);
  });
});

describe("a teammate past the first roster page can be named", () => {
  const person = (i: number) => ({ user_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, full_name: `Person ${i}` });
  const pager = (total: number, pageSize: number) => {
    const offsets: number[] = [];
    return { offsets, read: async (offset: number) => { offsets.push(offset);
      return { tenant_id: T, total_members: total, members: Array.from({ length: Math.max(0, Math.min(pageSize, total - offset)) }, (_, k) => person(offset + k)) }; } };
  };
  it("finds the 150th person by reading the second page", async () => {
    const p = pager(250, 100);
    assert.equal((await findTeamRosterMember(p.read, person(150).user_id))?.full_name, "Person 150");
    assert.deepEqual(p.offsets, [0, 100]);
  });
  it("stops at the stated total, a short page or an unreadable page", async () => {
    const p = pager(120, 100);
    assert.equal(await findTeamRosterMember(p.read, "99999999-9999-4999-8999-999999999999"), null);
    assert.deepEqual(p.offsets, [0, 100]);
    assert.equal(await findTeamRosterMember(async () => null, person(1).user_id), null);
    assert.equal(await findTeamRosterMember(p.read, "not-a-uuid"), null);
  });
  it("is bounded", async () => {
    const p = pager(1_000_000, 100);
    assert.equal(await findTeamRosterMember(p.read, "99999999-9999-4999-8999-999999999999", { pageSize: 100, max: 500 }), null);
    assert.deepEqual(p.offsets, [0, 100, 200, 300, 400]);
  });
});
