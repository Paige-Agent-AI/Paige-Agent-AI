// execute-approval — the REAL handler (index.ts), driven end to end against an in-memory service client
// and a fake fetch. It proves, at the door itself rather than in a helper:
//   • every send_via_approval approval — the legacy nested client.followup shape included — is refused
//     with 409 send_requires_review: no claim, no acknowledge, no send-message call, no write at all;
//   • a non-send action approval and a non-action approval behave exactly as before;
//   • a queued_* hold on the generic comms path keeps the claim (no second copy on a second Approve).
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
const A = "20000000-0000-4000-8000-000000000001", ACT = "40000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001";

interface Write { table: string; values: Row; filters: [string, string, unknown][] }

/** A small PostgREST-shaped fake: select/update with eq/is, maybeSingle or await. Records every write. */
function fakeDb(tables: Record<string, Row[]>, failSelect: string[] = []) {
  const writes: Write[] = [];
  const rpcs: string[] = [];
  const from = (table: string) => {
    let op: "select" | "update" = "select";
    let values: Row = {};
    const filters: [string, string, unknown][] = [];
    const run = (single: boolean) => {
      if (op === "select" && failSelect.includes(table)) return { data: null, error: { message: "boom" } };
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every(([o, k, v]) => (o === "eq" ? r[k] === v : (r[k] ?? null) === v)));
      if (op === "update") rows.forEach((r) => Object.assign(r, values));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const q = {
      select: () => q,
      update: (v: Row) => { op = "update"; values = v; writes.push({ table, values: v, filters }); return q; },
      eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
      is: (k: string, v: unknown) => { filters.push(["is", k, v]); return q; },
      maybeSingle: () => Promise.resolve(run(true)),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return q;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: async (name: string) => { rpcs.push(name); return { data: true, error: null }; },
    from,
  };
  return { client, writes, rpcs, tables };
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

async function load(db: ReturnType<typeof fakeDb>) {
  vi.resetModules();
  mocks.handler = null;
  mocks.createClient.mockReset().mockImplementation(() => db.client);
  const env: Record<string, string> = { SUPABASE_URL: "https://unit.invalid", SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_ANON_KEY: "anon" };
  vi.stubGlobal("Deno", { serve: (h: (req: Request) => Promise<Response>) => { mocks.handler = h; }, env: { get: (k: string) => env[k] } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
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

beforeEach(() => { fetchCalls = []; sendAnswer = { status: 200, body: { status: "sent", audit_id: "aud-1" } }; mocks.executeApprovedLayerCAct.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("execute-approval: a send_via_approval approval is never sent and never completed here", () => {
  it("the legacy nested client.followup shape (125 such rows pending in production) → 409, nothing written, nothing sent", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval()], paige_actions: [action("client.followup")], paige_action_kinds: kinds, clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, executed: false, error: "send_requires_review", approval_id: A });
    expect(typeof r.body.reason).toBe("string");
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
    expect(r.body.error).toBe("send_requires_review");
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

  it("a non-action approval with no automated executor is acknowledged as before", async () => {
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "content", type: "other", metadata: {}, draft_content: { text: "x" } })] });
    await load(db);
    expect(await approve()).toEqual({ status: 200, body: { ok: true, executed: false, acknowledged: true, approval_id: A } });
  });

  it("a QUEUED send (quiet hours) keeps the claim — the row is not released and not approved", async () => {
    sendAnswer = { status: 200, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z", message_id: "m1" } };
    const db = fakeDb({ paige_pending_approvals: [approval({ category: "followup", metadata: {}, draft_content: { channel: "email", subject: "S", body: "B" } })], clients: [contact] });
    await load(db);
    const r = await approve();
    expect(r.body).toMatchObject({ ok: true, executed: false, queued: true, outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z" });
    const row = db.tables.paige_pending_approvals[0];
    expect(row.claimed_at).not.toBeNull();   // kept: a second Approve gets "in_progress", not a second copy
    expect(row.status).toBe("pending");
    expect(db.writes.some((w) => w.values.claimed_at === null)).toBe(false);
    expect((row.metadata as Row).send_queued).toMatchObject({ outcome: "queued_quiet_hours", message_id: "m1" });

    // A second press cannot queue a second copy.
    fetchCalls = [];
    expect((await approve()).body).toMatchObject({ already: "in_progress" });
    expect(fetchCalls).toEqual([]);
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
