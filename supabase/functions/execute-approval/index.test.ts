// execute-approval — the REAL handler (index.ts), driven end to end against an in-memory service client
// and a fake fetch. It proves, at the door itself rather than in a helper:
//   • every send_via_approval approval — the legacy nested client.followup shape included, named by
//     metadata.action_id OR only by the action's approval_id back-pointer, ids in any letter case — is
//     refused with 409 send_requires_review and a per-kind reason_code: no claim, no acknowledge, no
//     send-message call, no write at all;
//   • a failed acknowledge write releases the claim instead of leaving the row held;
//   • a non-send action approval and a non-action approval behave exactly as before;
//   • a quiet-hours / do-not-disturb hold on the generic comms path is HELD (#2132): nothing queued or
//     sent, the approval pending and unclaimed; a copy send-message queues anyway is cancelled, and one
//     that cannot be cancelled keeps the claim (no second copy) with its link write checked. The cancel runs
//     on the caller's own login (the service-role client is refused by the RPC, as on production), and the
//     link is written only onto a row that is still pending.
// Nothing here reaches a network or a database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  handler: null as ((req: Request) => Promise<Response>) | null,
  createClient: vi.fn(),
  executeApprovedLayerCAct: vi.fn(),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: mocks.createClient }));
vi.mock("../_shared/paige-orchestration/approve-executor.ts", () => ({
  executeApprovedLayerCAct: mocks.executeApprovedLayerCAct,
  approvalRefusalMessage: () => "refused",
}));

const USER = "70000000-0000-4000-8000-000000000001";
const T = "10000000-0000-4000-8000-000000000001";
const A = "2000000a-0000-4000-8000-0000000000aa", ACT = "4000000b-0000-4000-8000-0000000000bb";
const C = "30000000-0000-4000-8000-000000000001";

interface Write { table: string; values: Row; filters: [string, string, unknown][] }

/** A small PostgREST-shaped fake: select/update with eq/is, maybeSingle or await. Records every write. */
function fakeDb(tables: Record<string, Row[]>, failSelect: string[] = [], failUpdateWhen?: (table: string, values: Row) => boolean,
  rpcAnswers: Record<string, { data: unknown; error: unknown }> = {}) {
  const writes: Write[] = [];
  const rpcs: string[] = [];
  const rpcArgs: { name: string; args: unknown; by: "service" | "user" }[] = [];
  const from = (table: string) => {
    let op: "select" | "update" = "select";
    let values: Row = {};
    const filters: [string, string, unknown][] = [];
    const run = (single: boolean) => {
      if (op === "select" && failSelect.includes(table)) return { data: null, error: { message: "boom" } };
      if (op === "update" && failUpdateWhen?.(table, values)) return { data: null, error: { message: "SEND_REQUIRES_GOVERNED_SEND: refused by the database" } };
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every(([o, k, v]) => (o === "eq" ? r[k] === v : o === "in" ? (v as unknown[]).includes(r[k]) : (r[k] ?? null) === v)));
      if (op === "update") rows.forEach((r) => Object.assign(r, values));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const q = {
      select: () => q,
      update: (v: Row) => { op = "update"; values = v; writes.push({ table, values: v, filters }); return q; },
      eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
      is: (k: string, v: unknown) => { filters.push(["is", k, v]); return q; },
      in: (k: string, v: unknown[]) => { filters.push(["in", k, v]); return q; },
      // The pre-send seam's reads (or/order/limit) narrow nothing here: each test seeds only matching rows.
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve(run(true)),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return q;
  };
  const rpcFor = (by: "service" | "user") => async (name: string, args?: unknown) => {
    rpcs.push(name); rpcArgs.push({ name, args, by });
    // The SERVICE-ROLE client has no auth.uid(), so production's cancel_scheduled_message (super admin, or the
    // caller's active business with the admin role) refuses it with 42501 — exactly as it does on production.
    if (by === "service" && name === "cancel_scheduled_message") return { data: null, error: { code: "42501", message: "forbidden" } };
    return rpcAnswers[name] ?? { data: true, error: null };
  };
  // Two clients over the same tables, as in index.ts: the service-role client (SERVICE_ROLE_KEY) and the
  // caller's own login (ANON_KEY + the forwarded JWT). Which one made each rpc is recorded.
  const client = { auth: { getUser: async () => ({ data: { user: { id: USER } } }) }, rpc: rpcFor("service"), from };
  const userClient = { auth: client.auth, rpc: rpcFor("user"), from };
  return { client, userClient, writes, rpcs, rpcArgs, tables };
}

const kinds = [
  { slug: "client.followup", executor: "send_via_approval" },
  { slug: "owner.lead_followup", executor: "send_via_approval" },
  { slug: "owner.sms_nudge", executor: "send_via_approval" },
  { slug: "owner.lead_captured", executor: "record_only" },
];
const legacyNested = {
  ok: true, subagent: "email-composer",
  draft: { subject: "Checking in", body_html: "<p>Hi</p>", body_text: "Hi" },
  recipient: { email: "someone@x.test" },
};
const approval = (extra: Row = {}): Row => ({
  id: A, status: "pending", tenant_id: T, contact_id: C, conversation_id: null, claimed_at: null,
  category: "client.followup", type: "cs_draft", draft_content: legacyNested, metadata: { action_id: ACT }, ...extra,
});
const action = (kind: string) => ({ id: ACT, tenant_id: T, action_kind: kind, contact_id: C, approval_id: A, status: "pending_approval" });
const contact = { id: C, tenant_id: T, client_contact_methods: [{ kind: "email", value: "dana@x.test", is_primary: true, position: 0 }] };

let fetchCalls: { url: string; body: Row }[] = [];
let sendAnswer: { status: number; body: Row } = { status: 200, body: { status: "sent", audit_id: "aud-1" } };
/** Runs while send-message is "in flight" — lets a test change the world between the claim and the answer. */
let onSend: (() => void) | null = null;

async function load(db: ReturnType<typeof fakeDb>) {
  vi.resetModules();
  mocks.handler = null;
  mocks.createClient.mockReset().mockImplementation((_url: string, key: string) => (key === "anon" ? db.userClient : db.client));
  const env: Record<string, string> = { SUPABASE_URL: "https://unit.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_ANON_KEY: "anon" };
  vi.stubGlobal("Deno", { serve: (h: (req: Request) => Promise<Response>) => { mocks.handler = h; }, env: { get: (k: string) => env[k] } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    onSend?.();
    return new Response(JSON.stringify(sendAnswer.body), { status: sendAnswer.status, headers: { "Content-Type": "application/json" } });
  });
  await import("./index.ts");
  expect(mocks.handler).not.toBeNull();
}
const approve = async () => {
  const res = await mocks.handler!(new Request("https://unit.invalid/functions/v1/execute-approval", {
    method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: JSON.stringify({ approval_id: A }),
  }));
  return { status: res.status, body: await res.json() as Row };
};

beforeEach(() => { fetchCalls = []; onSend = null; sendAnswer = { status: 200, body: { status: "sent", audit_id: "aud-1" } }; mocks.executeApprovedLayerCAct.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("execute-approval: a send_via_approval approval is never sent and never completed here", () => {
  it("the legacy nested client.followup shape (125 such rows pending in production) → 409, nothing written, nothing sent", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval()], paige_actions: [action("client.followup")], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, executed: false, error: "send_requires_review", reason_code: "decline_only", approval_id: A });
    expect(r.body.reason).toBe("This can be declined for now; sending it from here isn't available yet.");
    expect(db.writes).toEqual([]);          // no claim, no reviewer stamp, no acknowledge
    expect(fetchCalls).toEqual([]);         // send-message never called
    expect(db.tables.paige_pending_approvals[0]).toMatchObject({ status: "pending", claimed_at: null });
    expect(db.rpcs).not.toContain("email_campaign_approve");
    expect(mocks.executeApprovedLayerCAct).not.toHaveBeenCalled();
  });

  it("a fully-formed email draft (channel email, a recipient, a body) on a send kind is still refused — the generic comms path never sees it", async () => {
    const draft = { channel: "email", to: "dana@x.test", subject: "Thanks", body: "Hi Dana", body_html: "<p>Hi Dana</p>" };
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "owner.lead_followup", draft_content: draft })], paige_actions: [action("owner.lead_followup")], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "send_requires_review", reason_code: "review_and_send" });
    expect(String(r.body.reason)).toContain("Review and send it from the reply screen");
    expect(fetchCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("the action's back-pointer ALONE is enough: metadata.action_id gone, the action still names this approval", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ metadata: {} })], paige_actions: [action("client.followup")], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(409);
    expect(r.body.reason_code).toBe("decline_only");
    expect(db.writes).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("an upper-case action_id names the same send action (no bypass by letter case)", async () => {
    expect(ACT.toUpperCase()).not.toBe(ACT);
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "followup", metadata: { action_id: ACT.toUpperCase() }, draft_content: { channel: "email", subject: "S", body: "B" } })],
      paige_actions: [{ ...action("client.followup"), approval_id: null }], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    expect((await approve()).status).toBe(409);
    expect(fetchCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("an SMS send kind is refused too (ALL send kinds)", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "owner.sms_nudge", draft_content: { channel: "sms", body: "hi" } })], paige_actions: [action("owner.sms_nudge")], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    expect((await approve()).status).toBe(409);
    expect(fetchCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("an orchestration-shaped or campaign-shaped row that names a send action is refused before those branches", async () => {
    const meta = { action_id: ACT, source: "paige_orchestration", event_id: "e", act_id: "a", email_campaign_version_id: "v" };
    const db = fakeDb({ paige_pending_approvals: [approval({ type: "campaign_send", metadata: meta })], paige_actions: [action("client.followup")], paige_action_kinds: kinds });
    await load(db);
    expect((await approve()).status).toBe(409);
    expect(db.rpcs).not.toContain("email_campaign_approve");
    expect(mocks.executeApprovedLayerCAct).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("an action read failure is 503 and writes nothing", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval()], paige_actions: [action("client.followup")], paige_action_kinds: kinds }, ["paige_actions"]);
    await load(db);
    const r = await approve();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: "unavailable", detail: "action_read_failed" });
    expect(db.writes).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  it("an already-decided row keeps its idempotent answer (unchanged)", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ status: "approved" })], paige_actions: [action("client.followup")], paige_action_kinds: kinds });
    await load(db);
    expect(await approve()).toEqual({ status: 200, body: { ok: true, executed: false, already: "approved", approval_id: A } });
    expect(db.writes).toEqual([]);
  });
});

describe("execute-approval: everything else behaves exactly as before", () => {
  it("a NON-send action approval is acknowledged as before (claim, then approved with executed:false)", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "owner.lead_captured", draft_content: { note: "x" } })], paige_actions: [action("owner.lead_captured")], paige_action_kinds: kinds });
    await load(db);
    const r = await approve();
    expect(r).toEqual({ status: 200, body: { ok: true, executed: false, acknowledged: true, approval_id: A } });
    expect(db.writes.map((w) => Object.keys(w.values).sort())).toEqual([["claimed_at", "reviewed_by_user_id"], ["metadata", "reviewed_at", "reviewed_by_user_id", "status"]]);
    expect(db.writes[1].values.status).toBe("approved");
    expect(fetchCalls).toEqual([]);
  });

  it("a non-action email approval still sends through send-message", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "followup", metadata: {}, draft_content: { channel: "email", subject: "S", body: "B" } })], clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r).toEqual({ status: 200, body: { ok: true, executed: true, channel: "email", approval_id: A, audit_id: "aud-1" } });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://unit.invalid/functions/v1/send-message");
    expect(fetchCalls[0].body).toMatchObject({ channel: "email", to: "dana@x.test", subject: "S", body: "B", approval_id: A });
  });

  it("a failed acknowledge write releases the claim (never left held) and reports the failure", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "content", type: "other", metadata: {}, draft_content: { text: "x" } })] },
      [], (table, values) => table === "paige_pending_approvals" && values.status === "approved");
    await load(db);
    const r = await approve();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, executed: false, approval_id: A });
    const row = db.tables.paige_pending_approvals[0];
    expect(row.claimed_at).toBeNull();
    expect(row.status).toBe("pending");
    expect(db.writes.at(-1)?.values).toEqual({ claimed_at: null });
  });

  it("a non-action approval with no automated executor is acknowledged as before", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "content", type: "other", metadata: {}, draft_content: { text: "x" } })] });
    await load(db);
    expect(await approve()).toEqual({ status: 200, body: { ok: true, executed: false, acknowledged: true, approval_id: A } });
  });

  it("a FAILED send releases the claim and never reports success", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "blocked_suppressed" } };
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "followup", metadata: {}, draft_content: { channel: "email", subject: "S", body: "B" } })], clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, executed: false });
    expect(db.tables.paige_pending_approvals[0].claimed_at).toBeNull();
  });
});

// #2132 — an approval is never left claimed behind a queued message. A quiet-hours / do-not-disturb hold
// is answered HELD: nothing is queued, nothing is sent, the approval stays pending and unclaimed, and the
// person approves it again later. Quiet hours and DND are decided by the ONE pre-send seam (runPreSend) —
// the same function send-message runs — so nothing here sends during quiet hours or to a DND contact.
describe("execute-approval: a quiet-hours / do-not-disturb hold is HELD, never queued behind the approval (#2132)", () => {
  const emailDraft = { channel: "email", subject: "S", body: "B" };
  const pending = (extra: Row = {}) => approval({ category: "followup", type: "cs_draft", metadata: {}, draft_content: emailDraft, ...extra });
  // 2026-10-14T03:00:00Z is 23:00 the previous evening in New York — inside 20:00–08:00.
  const NIGHT = new Date("2026-10-14T03:00:00Z");
  const businessDnd = { tenant_id: T, autosend_dnd_enabled: true, autosend_dnd_start: "20:00:00", autosend_dnd_end: "08:00:00", autosend_dnd_timezone: "America/New_York", autosend_dnd_channels: ["email", "sms"] };

  it("the business's do-not-disturb hours: HELD — send-message is never called, the approval is pending and unclaimed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NIGHT);
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact], tenant_comms_preferences: [businessDnd] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, executed: false, held: true, outcome: "held", hold_reason: "tenant_dnd", retry_after: "2026-10-14T12:00:00.000Z", channel: "email", approval_id: A });
    expect(String(r.body.error)).toContain("Nothing went out");
    expect(fetchCalls).toEqual([]);                       // nothing queued, nothing sent
    const row = db.tables.paige_pending_approvals[0];
    expect(row).toMatchObject({ status: "pending", claimed_at: null });
    expect((row.metadata as Row).send_queued).toBeUndefined();
    // A second press is not "in progress": it is evaluated again (and held again while the hours last).
    expect((await approve()).body).toMatchObject({ held: true });
    expect(fetchCalls).toEqual([]);
  });

  it("SMS quiet hours in the contact's own time zone: HELD, never sent at night", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NIGHT);
    const smsContact = { ...contact, timezone: "America/New_York", client_contact_methods: [{ kind: "phone", value: "+15555550123", is_primary: true, position: 0 }] };
    const db = fakeDb({ paige_pending_approvals: [pending({ category: "sms", draft_content: { channel: "sms", body: "hi" } })], clients: [smsContact],
      paige_consent_events: [{ tenant_id: T, channel: "sms", action: "granted", created_at: "2026-01-01T00:00:00Z" }] });
    await load(db);
    const r = await approve();
    expect(r.body).toMatchObject({ ok: false, executed: false, held: true, hold_reason: "quiet_hours", channel: "sms", retry_after: "2026-10-14T12:00:00.000Z" });
    expect(fetchCalls).toEqual([]);
    expect(db.tables.paige_pending_approvals[0]).toMatchObject({ status: "pending", claimed_at: null });
  });

  it("outside the hours it sends exactly as before (the hold check never blocks a clear send)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T16:00:00Z")); // noon in New York
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact], tenant_comms_preferences: [businessDnd] });
    await load(db);
    expect(await approve()).toEqual({ status: 200, body: { ok: true, executed: true, channel: "email", approval_id: A, audit_id: "aud-1" } });
    expect(fetchCalls).toHaveLength(1);
  });

  it("a contact on do-not-disturb is still refused by send-message's own check (blocked, never sent, claim released)", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "blocked_client_dnd", reason: "This contact is on a do-not-disturb hold." } };
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [{ ...contact, dnd_active: true }] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, executed: false });
    expect(db.tables.paige_pending_approvals[0]).toMatchObject({ status: "pending", claimed_at: null });
  });

  it("a hold whose claim cannot be released says so (500), never reports a clean hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NIGHT);
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact], tenant_comms_preferences: [businessDnd] }, [],
      (table, values) => table === "paige_pending_approvals" && values.claimed_at === null);
    await load(db);
    const r = await approve();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, executed: false, error: "claim_release_failed", approval_id: A });
    expect(fetchCalls).toEqual([]);
  });

  it("if send-message queues anyway (the hours began between the check and the send), the queued copy is cancelled and the approval released", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_tenant_dnd", scheduled_for: "2026-10-14T12:00:00Z", message_id: "m1", reason: "Held until your team's quiet hours end." } };
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, executed: false, held: true, outcome: "held", hold_reason: "tenant_dnd", retry_after: "2026-10-14T12:00:00Z", returned_to_draft_message_id: "m1" });
    // The cancel runs as the CALLER (their login, so the RPC's own business/role check applies) — never as
    // the service role, which production refuses (42501) and which would leave the approval claimed.
    expect(db.rpcArgs.filter((c) => c.name === "cancel_scheduled_message")).toEqual([{ name: "cancel_scheduled_message", args: { _id: "m1" }, by: "user" }]);
    const row = db.tables.paige_pending_approvals[0];
    expect(row).toMatchObject({ status: "pending", claimed_at: null });
    expect((row.metadata as Row).send_queued).toBeUndefined();
  });

  it("a hold answer with no message id (send-message persisted no row) is simply HELD: nothing to cancel, claim released", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T12:00:00Z", message_id: null } };
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.body).toMatchObject({ ok: false, held: true, hold_reason: "quiet_hours" });
    expect(db.rpcs).not.toContain("cancel_scheduled_message");
    expect(db.tables.paige_pending_approvals[0]).toMatchObject({ status: "pending", claimed_at: null });
  });

  it("if that queued copy cannot be cancelled, the claim is KEPT (a second Approve would queue a second copy) and the link is recorded", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T12:00:00Z", message_id: "m1" } };
    // A second, unrelated pending approval: the link write must touch THIS approval only.
    const other = pending({ id: "00000000-0000-4000-8000-0000000000b2", metadata: { untouched: true } });
    const db = fakeDb({ paige_pending_approvals: [pending(), other], clients: [contact] }, [], undefined, { cancel_scheduled_message: { data: false, error: null } });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(202);
    expect(db.tables.paige_pending_approvals[1].metadata).toEqual({ untouched: true });
    expect(r.body).toMatchObject({ ok: false, executed: false, queued: true, outcome: "queued", message_id: "m1", scheduled_for: "2026-10-14T12:00:00Z" });
    const row = db.tables.paige_pending_approvals[0];
    expect(row.claimed_at).not.toBeNull();
    expect((row.metadata as Row).send_queued).toMatchObject({ outcome: "queued_quiet_hours", message_id: "m1", cancel_failed: true });
    fetchCalls = [];
    expect((await approve()).body).toMatchObject({ already: "in_progress" });
    expect(fetchCalls).toEqual([]);
  });

  it("the link is written only onto a row still PENDING: an approval declined while send-message ran is left as decided", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T12:00:00Z", message_id: "m1" } };
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact] }, [], undefined, { cancel_scheduled_message: { data: false, error: null } });
    onSend = () => { db.tables.paige_pending_approvals[0].status = "declined"; };   // a decline lands mid-send
    await load(db);
    await approve();
    const link = db.writes.find((w) => w.table === "paige_pending_approvals" && "metadata" in w.values);
    expect(link?.filters).toContainEqual(["eq", "status", "pending"]);
    const row = db.tables.paige_pending_approvals[0];
    expect(row.status).toBe("declined");
    expect((row.metadata as Row).send_queued).toBeUndefined();   // the decided row is not rewritten
  });

  it("if recording that link fails, it fails CLOSED: 500 with the message id, never a success", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T12:00:00Z", message_id: "m1" } };
    const db = fakeDb({ paige_pending_approvals: [pending()], clients: [contact] }, [],
      (table, values) => table === "paige_pending_approvals" && "metadata" in values,
      { cancel_scheduled_message: { data: null, error: { message: "forbidden" } } });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, executed: false, error: "queued_link_not_recorded", message_id: "m1", approval_id: A });
  });
});
