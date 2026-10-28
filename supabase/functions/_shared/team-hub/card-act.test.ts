// node --test supabase/functions/_shared/team-hub/card-act.test.ts
// EXP08 Team Hub agents A2b — Approve / Not now on a Team Hub card, and the outcome in its thread (plan
// section 3 "Redeem"; D8, D9). Every database call and every door call goes to an in-memory fake that
// records exactly what would be sent, so each assertion is about the real request. No model exists here.
// EVIDENCE CLASS: automated unit tests of the module. The definers (decide, settle, the outcome post and
// accept, the card read) are proved in supabase/tests/exp08_team_hub_a2b_cards.sql; the doors are their
// own owners'. No authenticated drive is claimed here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isTeamHubCardActRequest, parseCardActRequest, runTeamHubCardAct, type CardActDeps } from "./card-act.ts";
import { uuidFrom } from "./agent-turn.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { eqOf, fakeDb, type Query } from "./a2b-test-fakes.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const ZION_DM = "99999999-9999-4999-8999-999999999999";
const CARD = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const ASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONF = "15151515-1515-4151-8151-151515151515";
const TASK = "12121212-1212-4121-8121-121212121212";
const PAGE = "14141414-1414-4141-8141-141414141414";
const TURN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTCOME_MSG = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const ISSUED = "issued-in-request-1";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const TOKEN = "07".repeat(32);

const CRM_ARGS = { command: { action: "task.cancel", task_id: TASK, expected_updated_at: "2026-10-28T09:00:00.000000+00:00" }, idempotency_key: "k".repeat(16), approval_subject: `task:${TASK}` };
const PUBLISH_ARGS = { action: "publish", kind: "page", id: PAGE, expected_tenant_id: TENANT, approval_subject: `publish:page:${PAGE}`, approval_cycle_nonce: "16161616-1616-4161-8161-161616161616" };

type Call = { who: "caller" | "service" | "door"; name: string; args: Record<string, unknown> };
type Opts = {
  tool?: "crm_cancel_task" | "crm_assign_task" | "growth_page_publish"; decide?: (a: Record<string, unknown>) => unknown; settle?: (a: Record<string, unknown>) => unknown;
  door?: (name: string, body: Record<string, unknown>) => unknown; rowAfter?: () => Record<string, unknown> | null; row?: (fp: string) => Record<string, unknown> | null;
  accept?: () => unknown; post?: () => unknown;
  /** The card's message row as the service read returns it, or "error" for a read that does not answer. */
  msg?: Record<string, unknown> | null | "error";
  /** The task's title and the assignee's name, as the done note reads them (absent: no row). */
  title?: string; fullName?: string; args?: Record<string, unknown>;
};

async function world(opts: Opts = {}) {
  const tool = opts.tool ?? "crm_cancel_task";
  const args = opts.args ?? (tool === "growth_page_publish" ? PUBLISH_ARGS : CRM_ARGS);
  const fp = await confirmFingerprint(tool, args);
  const calls: Call[] = [];
  const queries: Query[] = [];
  let rowReads = 0;
  const live = { id: CONF, fingerprint: fp, tool_name: tool, args, consumed_at: null, expires_at: "2999-01-01T00:00:00Z",
    server_issued_at: "2026-10-28T10:00:05Z", issued_in_request: ISSUED };
  const caller = {
    rpc(name: string, a: Record<string, unknown> = {}) {
      calls.push({ who: "caller", name, args: a });
      const answer = (() => {
        switch (name) {
          case "get_paige_persona_context": return [{ tenant_id: TENANT }];
          case "team_hub_decide_card": return opts.decide ? opts.decide(a) : a.p_decision === "decline"
            ? { ok: true, decision: "declined", confirmation_id: CONF } : { ok: true, decision: "approved", confirmation_id: CONF };
          case "team_hub_settle_card": return opts.settle ? opts.settle(a) : { ok: true, outcome: (a.p_outcome as any).state };
          case "team_hub_post_agent_message": return opts.post ? opts.post() : { ok: true, message: { id: OUTCOME_MSG } };
          case "team_hub_list_messages": return { ok: true, messages: [{ id: OUTCOME_MSG, author_kind: "agent", agent_key: "zion", body: "x", parent_message_id: CARD }], has_more: false,
            root: { id: CARD, author_kind: "agent", agent_key: "zion" } };
          case "team_hub_card_states": return { ok: true, cards: [{ message_id: CARD, card: { state: "done", kind: "task_cancel", actions: [{ summary: "Cancel" }] }, outcome_message_id: OUTCOME_MSG, record: null }] };
          default: return null;
        }
      })();
      return Promise.resolve({ data: answer, error: null });
    },
  };
  const db = fakeDb((q) => {
    if (q.table === "paige_pending_confirmations" && q.op === "select") {
      rowReads += 1;
      if (rowReads > 1 && opts.rowAfter) return { data: opts.rowAfter(), error: null };
      return { data: opts.row ? opts.row(fp) : live, error: null };
    }
    if (q.table === "team_hub_messages") return opts.msg === "error" ? { data: null, error: { message: "down" } }
      : { data: opts.msg !== undefined ? opts.msg : { id: CARD, channel_id: ZION_DM, parent_message_id: null, agent_key: "zion", author_kind: "agent" }, error: null };
    if (q.table === "tasks") return { data: opts.title ? { title: opts.title } : null, error: null };
    if (q.table === "profiles") return { data: opts.fullName ? { full_name: opts.fullName } : null, error: null };
    if (q.table === "team_hub_agent_turns") return { data: { source_message_id: ASK, agent_key: "zion", channel_id: ZION_DM }, error: null };
    return { data: null, error: null };
  }, queries);
  const service = {
    rpc(name: string, a: Record<string, unknown> = {}) {
      calls.push({ who: "service", name, args: a });
      if (name === "team_hub_accept_agent_turn") return Promise.resolve({ data: opts.accept ? opts.accept() : { ok: true, turn_id: TURN, accepted_at: "2026-10-28T10:01:00Z" }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: db.from,
  };
  const invokeAs = async (name: string, body: Record<string, unknown>) => {
    calls.push({ who: "door", name, args: JSON.parse(JSON.stringify(body)) });
    const r = opts.door ? opts.door(name, body) : { data: name === "crm-command" ? { ok: true, outcome: "succeeded" } : { ok: true, id: PAGE, status: "published", url: "/p/x/spring" }, error: null };
    if (r instanceof Error) throw r;
    return r as { data: unknown; error: unknown };
  };
  let modelCalls = 0;
  const deps: CardActDeps & { complete: () => never } = { caller, service, userId: SAM, invokeAs, random: () => new Uint8Array(32).fill(7),
    complete: () => { modelCalls += 1; throw new Error("no model runs on a card act"); } };
  return { calls, queries, deps, fp, modelCalls: () => modelCalls };
}
const act = (fp: string, extra: Record<string, unknown> = {}) => ({ teamHubCardAct: { conversationId: ZION_DM, messageId: CARD, act: "approve", fingerprint: fp, ...extra } });
const named = (w: Awaited<ReturnType<typeof world>>, name: string) => w.calls.filter((c) => c.name === name);
const order = (w: Awaited<ReturnType<typeof world>>, ...names: string[]) => names.map((n) => w.calls.findIndex((c) => c.name === n));

describe("the request is closed and strict", () => {
  it("routes on its own key only, and refuses anything beyond the four fields", async () => {
    const fp = "0123456789abcdef";
    assert.equal(isTeamHubCardActRequest(act(fp)), true);
    assert.equal(isTeamHubCardActRequest({ teamHubAgentTurn: {} }), false);
    for (const bad of [{ ...act(fp), messages: [] }, act(fp, { tenantId: TENANT }), act(fp, { args: {} }), act(fp, { tool: "crm_delete_task" }),
      act(fp, { act: "run" }), act(fp, { fingerprint: "ABC" }), act(`${fp}:${CONF}`), act(fp, { messageId: "card" }), act(fp, { conversationId: null }), { teamHubCardAct: "x" }]) {
      assert.ok("problem" in parseCardActRequest(bad), JSON.stringify(bad));
    }
  });
  it("an invalid request or a control hint is a 400 and touches nothing", async () => {
    const w = await world();
    assert.equal((await runTeamHubCardAct(w.deps, act(w.fp, { tenantId: TENANT }))).status, 400);
    assert.equal((await runTeamHubCardAct({ ...w.deps, controlHint: "status" }, act(w.fp))).status, 400);
    assert.equal(w.calls.length, 0);
  });
});

describe("Approve (CRM): decide, the stored call through its door, settle, then the outcome post", () => {
  it("runs the door's STORED command with exactly this fingerprint, settles done with the task as the record, then posts once in the card's thread", async () => {
    const w = await world();
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(r.status, 200);
    assert.equal((r.body as any).outcome, "done");
    assert.equal((r.body as any).ok, true);
    const [decide] = named(w, "team_hub_decide_card");
    assert.deepEqual(decide.args, { p_expected_tenant: TENANT, p_message_id: CARD, p_decision: "approve", p_fingerprint: w.fp });
    assert.equal(decide.who, "caller");
    const [door] = named(w, "crm-command");
    assert.deepEqual(door.args, { command: CRM_ARGS.command, expected_tenant_id: TENANT, idempotency_key: CRM_ARGS.idempotency_key, approved_fingerprint: w.fp });
    const rowRead = w.queries.find((q) => q.table === "paige_pending_confirmations")!;
    assert.equal(eqOf(rowRead, "id"), CONF);
    assert.equal(eqOf(rowRead, "user_id"), SAM);
    const [settle] = named(w, "team_hub_settle_card");
    assert.deepEqual(settle.args.p_outcome, { state: "done", note: "The task is cancelled.", record: { destination: "operations_work", record_id: TASK } });
    const [accept] = named(w, "team_hub_accept_agent_turn");
    assert.equal(accept.who, "service");
    assert.deepEqual(accept.args, { p_tenant: TENANT, p_asker: SAM, p_channel_id: ZION_DM, p_source_message_id: ASK, p_agent_key: "zion", p_intent: `outcome:${CARD}`, p_token_hash: sha(TOKEN) });
    const [post] = named(w, "team_hub_post_agent_message");
    assert.equal(post.who, "caller");
    assert.equal(post.args.p_body, "Done. The task is cancelled.");
    assert.equal(post.args.p_parent_message_id, CARD, "the outcome answers in the card's thread");
    assert.equal(post.args.p_asked_in_message_id, null);
    assert.equal(post.args.p_intent, `outcome:${CARD}`);
    assert.equal(post.args.p_turn_token, TOKEN);
    assert.equal(post.args.p_client_request_id, await uuidFrom(CARD, "zion", "outcome"));
    assert.deepEqual(post.args.p_card_outcome, { state: "done" });
    assert.equal((r.body as any).outcome_message.id, OUTCOME_MSG);
    const receipt = w.calls.find((c) => c.name === "record_capability_run")!;
    assert.equal(receipt.args._capability_key, "team_hub_agent_post");
    assert.ok(!JSON.stringify(receipt.args).includes("zion") && !JSON.stringify(receipt.args).includes(TASK), "metadata only");
    assert.ok(!JSON.stringify(r.body).includes(TOKEN));
    assert.equal(w.modelCalls(), 0, "no model runs");
  });
  it("the outcome is settled BEFORE the outcome turn is accepted and before anything is posted (D9)", async () => {
    const w = await world();
    await runTeamHubCardAct(w.deps, act(w.fp));
    const [decide, door, settle, accept, post] = order(w, "team_hub_decide_card", "crm-command", "team_hub_settle_card", "team_hub_accept_agent_turn", "team_hub_post_agent_message");
    assert.ok(decide < door && door < settle && settle < accept && accept < post, JSON.stringify({ decide, door, settle, accept, post }));
  });
  it("a settle that does not land posts nothing and accepts no outcome turn", async () => {
    for (const settle of [() => null, () => ({ ok: false, code: "not_allowed" })]) {
      const w = await world({ settle });
      const r = await runTeamHubCardAct(w.deps, act(w.fp));
      assert.equal(named(w, "team_hub_accept_agent_turn").length, 0);
      assert.equal(named(w, "team_hub_post_agent_message").length, 0);
      assert.equal((r.body as any).outcome_message, null);
    }
  });
  it("the door's claim found nothing and the proposal is still live: didn't run, and settle is told failed (it consumes the row)", async () => {
    const w = await world({ door: () => ({ data: null, error: { name: "FunctionsHttpError", context: { status: 403, json: async () => ({ ok: false, outcome: "refused", code: "CRM_APPROVAL_UNCONFIRMED" }) } } }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "failed");
    assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "failed", note: "that approval couldn't be used" });
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "That didn't run: that approval couldn't be used. Nothing was changed.");
  });
  it("the claim found nothing because another request used it: couldn't confirm, never 'didn't run'", async () => {
    const w = await world({ rowAfter: () => ({ id: CONF, consumed_at: "2026-10-28T10:02:00Z", expires_at: "2999-01-01T00:00:00Z" }),
      door: () => ({ data: null, error: { name: "FunctionsHttpError", context: { status: 403, json: async () => ({ ok: false, code: "CRM_APPROVAL_UNCONFIRMED" }) } } }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "unconfirmed");
    assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "unconfirmed" });
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "I couldn't confirm that ran. Check it before asking again.");
  });
  it("a transport error at the door (the answer never came back) is couldn't confirm", async () => {
    for (const door of [() => new Error("TypeError: fetch failed"), () => ({ data: null, error: { name: "FunctionsFetchError", message: "fetch failed" } })]) {
      const w = await world({ door });
      const r = await runTeamHubCardAct(w.deps, act(w.fp));
      assert.equal((r.body as any).outcome, "unconfirmed");
      assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "unconfirmed" });
    }
  });
  it("a version conflict is didn't run, in the closed reason set (never the door's own words)", async () => {
    const w = await world({ door: () => ({ data: null, error: { name: "FunctionsHttpError", context: { status: 409, json: async () => ({ ok: false, outcome: "failed", code: "CRM_TASK_VERSION_CONFLICT", message: "CRM_TASK_VERSION_CONFLICT internal" }) } } }) });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "That didn't run: the task changed after I read it. Nothing was changed.");
  });
  it("a proposal past its window is not sent to the door: didn't run, expired", async () => {
    const w = await world({ row: (fp) => ({ id: CONF, fingerprint: fp, tool_name: "crm_cancel_task", args: CRM_ARGS, consumed_at: null, expires_at: "2020-01-01T00:00:00Z", issued_in_request: ISSUED }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "failed");
    assert.equal(named(w, "crm-command").length, 0);
    assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "failed", note: "the approval ran out of time" });
  });
  it("a stored row whose arguments no longer hash to its fingerprint is never run", async () => {
    const w = await world({ row: (fp) => ({ id: CONF, fingerprint: fp, tool_name: "crm_cancel_task", args: { ...CRM_ARGS, command: { ...CRM_ARGS.command, task_id: PAGE } },
      consumed_at: null, expires_at: "2999-01-01T00:00:00Z", issued_in_request: ISSUED }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "crm-command").length, 0);
    assert.equal((r.body as any).outcome, "failed");
  });
});

describe("Approve (page publish): the same door dispatch, pinned", () => {
  it("passes the pinned proposal and exactly Set([fp]): the door gets approved_fingerprint, and no approval lookup runs", async () => {
    const w = await world({ tool: "growth_page_publish" });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "done");
    const [door] = named(w, "growth-publish-command");
    assert.equal(door.args.approved_fingerprint, w.fp);
    assert.equal(door.args.id, PAGE);
    assert.equal(door.args.expected_tenant_id, TENANT);
    const lookups = w.queries.filter((q) => q.table === "paige_pending_confirmations" && q.filters.some(([op, k]) => op === "in" && k === "fingerprint"));
    assert.equal(lookups.length, 0, "pinned: the proposal is never chosen from a set");
    assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "done", note: "The page is live at /p/x/spring." }, "no record for a page (no Team Hub destination)");
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "Done. The page is live at /p/x/spring.");
  });
  it("APPROVAL_NOT_AVAILABLE with the proposal still live: failed, and settle consumes it", async () => {
    const w = await world({ tool: "growth_page_publish", door: () => ({ data: null, error: { name: "FunctionsHttpError",
      context: { status: 409, json: async () => ({ ok: false, refused: true, outcome: "refused", code: "APPROVAL_NOT_AVAILABLE", error: "That approval was already used or has expired" }) } } }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "failed");
    assert.deepEqual(named(w, "team_hub_settle_card")[0].args.p_outcome, { state: "failed", note: "that approval couldn't be used" });
  });
});

describe("compliance fixes 1, 3 and 7: what the outcome says", () => {
  it("done names what now exists: the task by its title, the hand-over's person by name (or 'you')", async () => {
    let w = await world({ title: "Book  the\nvenue" });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_settle_card")[0].args.p_outcome.note, "\u201cBook the venue\u201d is cancelled.");
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "Done. \u201cBook the venue\u201d is cancelled.");
    const PRIYA = "33333333-3333-4333-8333-333333333333";
    const hand = (who: string) => ({ ...CRM_ARGS, command: { action: "task.assign", task_id: TASK, expected_updated_at: CRM_ARGS.command.expected_updated_at, patch: { assignee_user_id: who } } });
    w = await world({ tool: "crm_assign_task", title: "Book the venue", fullName: "Priya Shah", args: hand(PRIYA) });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_settle_card")[0].args.p_outcome.note, "\u201cBook the venue\u201d is handed over to Priya Shah.");
    w = await world({ tool: "crm_assign_task", title: "Book the venue", args: hand(SAM) });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_settle_card")[0].args.p_outcome.note, "\u201cBook the venue\u201d is handed over to you.");
  });
  it("a page is never called live without the address the door returned", async () => {
    const w = await world({ tool: "growth_page_publish", door: () => ({ data: { ok: true, id: PAGE, status: "published" }, error: null }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "done");
    const note = String(named(w, "team_hub_settle_card")[0].args.p_outcome.note);
    assert.ok(!/is live/.test(note), note);
    assert.equal(note, "The page is published. Its address didn't come back, so open it from your pages to check.");
  });
  it("a card settled before keeps ITS reason: the line uses the note settle returns, never 'it was refused' by default", async () => {
    let w = await world({ settle: () => ({ ok: true, already: true, outcome: "failed", note: "the approval ran out of time" }) });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "That didn't run: the approval ran out of time. Nothing was changed.");
    w = await world({ settle: () => ({ ok: true, already: true, outcome: "done", note: "The task is cancelled." }) });
    await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_post_agent_message")[0].args.p_body, "Done. The task is cancelled.");
  });
});

describe("verifier fix 4: the conversation is checked BEFORE anything is decided", () => {
  it("a card that is not this conversation's (or not an agent's) is not_visible, and decide is never asked", async () => {
    for (const msg of [{ id: CARD, channel_id: "88888888-8888-4888-8888-888888888888", parent_message_id: null, agent_key: "zion", author_kind: "agent" },
      { id: CARD, channel_id: ZION_DM, parent_message_id: null, agent_key: null, author_kind: "user" }, null]) {
      const w = await world({ msg });
      const r = await runTeamHubCardAct(w.deps, act(w.fp));
      assert.equal((r.body as any).outcome, "not_visible", JSON.stringify(msg));
      assert.equal(named(w, "team_hub_decide_card").length, 0, "nothing is decided");
      assert.equal(named(w, "team_hub_settle_card").length, 0);
    }
  });
  it("a read that does not answer decides nothing either (could_not_start), for Approve and for Not now", async () => {
    for (const a of ["approve", "decline"]) {
      const w = await world({ msg: "error" });
      const r = await runTeamHubCardAct(w.deps, act(w.fp, { act: a }));
      assert.equal((r.body as any).outcome, "could_not_start");
      assert.equal(named(w, "team_hub_decide_card").length, 0);
    }
  });
});

describe("Not now, and the people who cannot decide", () => {
  it("decline: the door decides (and consumes); nothing is dispatched, settled or posted", async () => {
    const w = await world();
    const r = await runTeamHubCardAct(w.deps, act(w.fp, { act: "decline" }));
    assert.equal((r.body as any).outcome, "declined");
    assert.equal(named(w, "team_hub_decide_card")[0].args.p_decision, "decline");
    for (const n of ["crm-command", "growth-publish-command", "team_hub_settle_card", "team_hub_accept_agent_turn", "team_hub_post_agent_message"]) assert.equal(named(w, n).length, 0, n);
  });
  it("a non-asker, a hidden card, an expired one, one decided before, or Team conversations off: nothing runs", async () => {
    for (const [code, outcome] of [["not_yours", "not_yours"], ["not_found", "not_visible"], ["not_member", "not_visible"], ["expired", "expired"],
      ["already_decided", "already_decided"], ["conversations_off", "conversations_off"], ["invalid", "could_not_start"], ["scope_changed", "could_not_start"]]) {
      const w = await world({ decide: () => ({ ok: false, code }) });
      const r = await runTeamHubCardAct(w.deps, act(w.fp));
      assert.equal((r.body as any).outcome, outcome, code);
      assert.equal(named(w, "crm-command").length + named(w, "team_hub_settle_card").length + named(w, "team_hub_post_agent_message").length, 0, code);
    }
    const w = await world({ decide: () => ({ ok: true, already: true, decision: "approved", outcome: null, confirmation_id: CONF }) });
    assert.equal((await runTeamHubCardAct(w.deps, act(w.fp))).body.outcome, "already_decided");
    assert.equal(named(w, "crm-command").length, 0, "a second Approve never runs the act again");
  });
  it("a decide whose answer was lost is not retried (a retry could read our own decision as someone else's)", async () => {
    const w = await world({ decide: () => null });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal((r.body as any).outcome, "could_not_start");
    assert.equal(named(w, "team_hub_decide_card").length, 1);
    assert.equal(named(w, "crm-command").length, 0);
  });
  it("an outcome already posted (accept says duplicate) is read back, never posted twice", async () => {
    const w = await world({ accept: () => ({ ok: false, code: "duplicate", message_id: OUTCOME_MSG }) });
    const r = await runTeamHubCardAct(w.deps, act(w.fp));
    assert.equal(named(w, "team_hub_post_agent_message").length, 0);
    assert.equal((r.body as any).outcome_message.id, OUTCOME_MSG);
  });
});
