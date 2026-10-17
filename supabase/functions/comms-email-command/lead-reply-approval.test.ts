// Experience 03 · S3 — the governed email door binds a drafted lead reply's approval to ONE send,
// and recognises a verified PAIGE Email (SendGrid) sender.
//
// Drives the REAL comms-email-command handler (Deno.serve captured) with only its module boundary
// substituted: @supabase/supabase-js → the recording fake (scripts/client-memory-authz), `fetch` →
// a stub that records the call to send-message and answers it. No HTTP leaves this process and no
// provider is ever called: the door's only outbound request is to send-message, which is stubbed.
//
// Run: node --import ./scripts/client-memory-authz/register.mjs --test supabase/functions/comms-email-command/lead-reply-approval.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { setScenario } from "../../../scripts/client-memory-authz/fake-supabase.mjs";
import { verifyLeadReplyApproval, storedApprovalMatches, recordLeadReplySend, bindingApprovalMatches, leadReplyPrepareRefusal } from "./lead-reply-approval.ts";

const T = "a3e30300-0000-4000-8000-000000000001"; // this business
const T2 = "a3e30300-0000-4000-8000-000000000002"; // another business
const U = "a3e30300-0000-4000-8000-0000000000a1";
const C = "a3e30300-0000-4000-8000-0000000000c1"; // the lead
const C2 = "a3e30300-0000-4000-8000-0000000000c2"; // someone else
const AP = "a3e30300-0000-4000-8000-0000000000d1", AP2 = "a3e30300-0000-4000-8000-0000000000d2";
const ACT = "a3e30300-0000-4000-8000-0000000000e1", ACT2 = "a3e30300-0000-4000-8000-0000000000e2";
const SG = "a3e30300-0000-4000-8000-0000000000f1";
const MSG = "a3e30300-0000-4000-8000-000000000101";
const SECRET_SG = "SG.secret-value-never-in-a-response";

type Row = Record<string, unknown>;
type Filter = unknown[];
const eqs = (filters: Filter[]) => Object.fromEntries(filters.filter((f) => f[0] === "eq").map((f) => [f[1], f[2]]));
const matching = (rows: Row[], filters: Filter[]) => { const e = eqs(filters); return rows.filter((r) => Object.entries(e).every(([k, v]) => r[k] === v)); };

interface World {
  approvals: Row[]; actions: Row[]; domains: Row[]; connectors: Row[];
  proposals: Row[]; sent: boolean; recordResult: { data: unknown; error: unknown } | (() => never);
  rpcCalls: { name: string; args: Row }[]; fetches: string[];
  /** Governed sends as `messages` rows, keyed the way the door filters them (tenant + binding approval). */
  messages: Row[];
  /** The approval the replayed operation's binding was prepared for (read_comms_email_send_binding). */
  bindingApproval: string | null;
  /** When set, prepare_comms_email_send answers this database error. */
  prepareError: { code: string; message: string } | null;
}
const BINDING_APPROVAL = "meta->comms_email_binding->>approval_id";
function world(overrides: Partial<World> = {}): World {
  return {
    approvals: [
      { id: AP, tenant_id: T, status: "pending", contact_id: C, metadata: { action_id: ACT } },
      { id: AP2, tenant_id: T, status: "pending", contact_id: C, metadata: { action_id: ACT2 } },
    ],
    actions: [
      { id: ACT, tenant_id: T, approval_id: AP, action_kind: "owner.lead_followup", contact_id: C },
      { id: ACT2, tenant_id: T, approval_id: AP2, action_kind: "owner.lead_followup", contact_id: C },
    ],
    domains: [{ tenant_id: T, domain: "own.example.invalid", sendgrid_status: "verified", sendgrid_domain_id: "sg-dom-1", sendgrid_verified_at: "2026-10-13T00:00:00Z" }],
    connectors: [{ id: SG, tenant_id: T, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: "sendgrid", from_address: "Hello@Own.example.invalid", active: true, status: "active", credentials_vault_ref: null, config: {} }],
    proposals: [], sent: false, recordResult: { data: { ok: true, state: "provider_accepted" }, error: null },
    rpcCalls: [], fetches: [], messages: [], bindingApproval: AP, prepareError: null,
    ...overrides,
  };
}

function scenario(w: World) {
  const proposalsTable = (filters: Filter[]) => {
    const upd = filters.find((f) => f[0] === "update");
    const fp = eqs(filters).fingerprint;
    if (upd) {
      // The claim (gt expires_at) consumes one live proposal; the expired sweep (lte) touches none.
      if (filters.some((f) => f[0] === "lte")) return [];
      const live = w.proposals.find((p) => p.fingerprint === fp && !p.consumed_at);
      if (!live) return [];
      live.consumed_at = new Date().toISOString();
      return [{ args: live.args }];
    }
    const contains = filters.find((f) => f[0] === "contains") as [string, string, Row] | undefined;
    if (contains) return w.proposals.filter((p) => !p.consumed_at && (p.args as Row).operation_id === contains[2].operation_id).slice(-1).map((p) => ({ args: p.args }));
    const last = w.proposals[w.proposals.length - 1];
    return last ? [{ summary: last.summary, expires_at: last.expires_at }] : [];
  };
  const tables: Record<string, (f: Filter[]) => Row[]> = {
    tenant_members: () => [{ role: "owner", status: "active" }],
    profiles: () => [{ user_id: U, active_tenant_id: T }],
    clients: (f) => matching([
      { id: C, tenant_id: T, first_name: "Riley", last_name: "Lead", client_contact_methods: [{ kind: "email", value: "riley@lead.example.invalid", is_primary: true, position: 0 }] },
      { id: C2, tenant_id: T, first_name: "Sam", last_name: "Other", client_contact_methods: [{ kind: "email", value: "sam@other.example.invalid", is_primary: true, position: 0 }] },
    ], f),
    channel_connectors: (f) => matching(w.connectors, f),
    tenant_email_domains: (f) => matching(w.domains, f),
    paige_pending_approvals: (f) => matching(w.approvals, f),
    paige_actions: (f) => matching(w.actions, f),
    messages: (f) => matching(w.messages, f),
    paige_pending_confirmations: proposalsTable,
  };
  const result = (outcome: string) => ({ ok: outcome === "provider_accepted", outcome, operation_id: OP, message_id: MSG, delivery_confirmed: false, provider: "sendgrid", reconcilable: false });
  const rpc = (name: string, value: (args: Row) => unknown) => (args: Row) => { w.rpcCalls.push({ name, args }); return value(args); };
  return {
    authUser: { id: U },
    tables, serviceTables: tables,
    onInsert: (table: string, row: Row) => { if (table === "paige_pending_confirmations") w.proposals.push({ ...row }); return null; },
    rpcs: {
      current_user_tenant_id: { data: T, error: null },
      comms_provider_execution_allowed: { data: true, error: null },
      resolve_tool_autonomy: { data: "confirm", error: null },
      find_comms_email_pending_reconciliation: { data: null, error: null },
      read_comms_email_send_result: rpc("read_comms_email_send_result", (args) => ({ data: w.sent && args._operation_id === OP ? result("provider_accepted") : null, error: null })),
      // Like the real prepare: the send is written with the approval the door's governance carried.
      prepare_comms_email_send: rpc("prepare_comms_email_send", (args) => {
        if (w.prepareError) return { data: null, error: w.prepareError };
        const approval = ((args._governance as Row).approval_id as string | undefined) ?? null;
        w.messages.push({ tenant_id: T, [BINDING_APPROVAL]: approval, operation_id: args._operation_id, state: "prepared" });
        return { data: { ok: true, replayed: false, state: "prepared", message_id: MSG }, error: null };
      }),
      read_comms_email_send_binding: rpc("read_comms_email_send_binding", () => ({ data: { message_id: MSG, operation_id: OP, approval_id: w.bindingApproval }, error: null })),
      lead_reply_record_send_service: rpc("lead_reply_record_send_service", () => { if (typeof w.recordResult === "function") return w.recordResult(); return w.recordResult; }),
      mark_support_case_outbound: { data: null, error: null },
    },
  };
}

const OP = "a3e30300-0000-4000-8000-000000000201";
const env: Record<string, string> = { SUPABASE_URL: "https://proj.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-role-key", SUPABASE_ANON_KEY: "anon-key", SENDGRID_MAIL_SEND_API_KEY: SECRET_SG };
let handler: (req: Request) => Promise<Response>;
(globalThis as Record<string, unknown>).Deno = { serve: (h: typeof handler) => { handler = h; }, env: { get: (k: string) => env[k] } };
await import("./index.ts");

let current: World;
globalThis.fetch = (async (url: string | URL) => {
  current.fetches.push(String(url));
  current.sent = true;
  for (const m of current.messages) if (m.state === "prepared") m.state = "provider_accepted";
  return new Response(JSON.stringify({ ok: true, outcome: "provider_accepted", delivery_confirmed: false }), { status: 200 });
}) as typeof fetch;

async function call(w: World, extra: Row = {}, command: Row = {}) {
  current = w;
  setScenario(scenario(w));
  const res = await handler(new Request("https://door.example.invalid/comms-email-command", {
    method: "POST", headers: { Authorization: "Bearer user-jwt" },
    body: JSON.stringify({ expected_tenant_id: T, operation_id: OP, command: { action: "comms.email_send", contact_id: C, subject: "Thanks for reaching out", body: "Hi Riley, thanks for your note.", ...command }, ...extra }),
  }));
  return { status: res.status, body: await res.json() as Row };
}
const rpcNames = (w: World) => w.rpcCalls.map((c) => c.name);

// ── the door, end to end ─────────────────────────────────────────────────────────────────────
test("a verified PAIGE Email (SendGrid) sender is proposed; approval_id is part of the fingerprinted call", async () => {
  const w = world();
  const r = await call(w, { approval_id: AP });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.outcome, "approval_required");
  assert.equal(w.proposals.length, 1);
  assert.equal((w.proposals[0].args as Row).approval_id, AP);
  assert.equal((r.body.preview as Row).from_address, "hello@own.example.invalid");
  assert.deepEqual(w.fetches, []);
  assert.ok(!JSON.stringify(r.body).includes(SECRET_SG));
});

test("an unverified SendGrid sender is never proposed (SENDER_VERIFICATION_MISSING)", async () => {
  const w = world({ domains: [] });
  const r = await call(w, { approval_id: AP });
  assert.equal(r.status, 422);
  assert.deepEqual([r.body.outcome, r.body.reason], ["needs_setup", "SENDER_VERIFICATION_MISSING"]);
  assert.equal(w.proposals.length, 0);
});

test("approve → send → record: provider_accepted is recorded on the approval by the service door", async () => {
  const w = world();
  const proposed = await call(w, { approval_id: AP });
  const r = await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.outcome, r.body.record_status, r.body.approval_id, r.body.delivery_confirmed], [true, "provider_accepted", "recorded", AP, false]);
  const rec = w.rpcCalls.find((c) => c.name === "lead_reply_record_send_service");
  assert.deepEqual(rec?.args, { _approval_id: AP, _operation_id: OP, _actor: U });
  assert.equal(w.fetches.length, 1);
  assert.match(w.fetches[0], /\/functions\/v1\/send-message$/);
  assert.ok(!w.fetches.some((u) => u.includes("sendgrid.com")), "the door never calls a provider itself");
});

test("a failed record never turns an accepted send into a failure: pending_record", async () => {
  for (const recordResult of [{ data: null, error: { code: "55000", message: "LEAD_REPLY_NOT_PENDING" } }, { data: { ok: false, state: "unknown" }, error: null }, (() => { throw new Error("network"); }) as () => never]) {
    const w = world({ recordResult });
    const proposed = await call(w, { approval_id: AP });
    const r = await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.ok, r.body.outcome, r.body.record_status], [true, "provider_accepted", "pending_record"]);
  }
});

test("re-POSTing the same accepted operation records it (the reconcilable path)", async () => {
  const w = world({ sent: true });
  const r = await call(w, { approval_id: AP });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.replayed, r.body.record_status], [true, "recorded"]);
  assert.ok(!rpcNames(w).includes("prepare_comms_email_send"));
});

test("an approval swapped between proposal and confirmation is refused before anything is prepared", async () => {
  const w = world();
  const proposed = await call(w, { approval_id: AP });
  const swapped = await call(w, { approval_id: AP2, approved_fingerprint: proposed.body.fingerprint });
  assert.equal(swapped.status, 403);
  assert.deepEqual([swapped.body.outcome, swapped.body.code], ["refused", "LEAD_REPLY_APPROVAL_MISMATCH"]);
  const w2 = world();
  const proposed2 = await call(w2, { approval_id: AP });
  const dropped = await call(w2, { approved_fingerprint: proposed2.body.fingerprint });
  assert.equal(dropped.body.code, "LEAD_REPLY_APPROVAL_MISMATCH", "confirming without the approval is a swap too");
  const w3 = world();
  const plain = await call(w3, {});
  const added = await call(w3, { approval_id: AP, approved_fingerprint: plain.body.fingerprint });
  assert.equal(added.body.code, "LEAD_REPLY_APPROVAL_MISMATCH", "an approval cannot be attached at confirmation");
  for (const x of [w, w2, w3]) {
    assert.ok(!rpcNames(x).includes("prepare_comms_email_send"));
    assert.ok(!rpcNames(x).includes("lead_reply_record_send_service"));
    assert.deepEqual(x.fetches, []);
  }
});

test("wrong business, wrong contact, non-pending and wrong-kind approvals are refused before any card", async () => {
  const cases: [string, Partial<World>, Row, string][] = [
    ["another business's approval", { approvals: [{ id: AP, tenant_id: T2, status: "pending", contact_id: C, metadata: { action_id: ACT } }] }, {}, "LEAD_REPLY_APPROVAL_NOT_FOUND"],
    ["an approval for another person", { actions: [{ id: ACT, tenant_id: T, approval_id: AP, action_kind: "owner.lead_followup", contact_id: C2 }] }, {}, "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH"],
    // D2: the action is for this lead, but the APPROVAL row itself names someone else.
    ["an approval row that names another person", { approvals: [{ id: AP, tenant_id: T, status: "pending", contact_id: C2, metadata: { action_id: ACT } }] }, {}, "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH"],
    ["an already-decided approval", { approvals: [{ id: AP, tenant_id: T, status: "rejected", contact_id: C, metadata: { action_id: ACT } }] }, {}, "LEAD_REPLY_APPROVAL_NOT_PENDING"],
    ["a client.followup approval", { actions: [{ id: ACT, tenant_id: T, approval_id: AP, action_kind: "client.followup", contact_id: C }] }, {}, "LEAD_REPLY_APPROVAL_WRONG_KIND"],
    ["an action that does not point back", { actions: [{ id: ACT, tenant_id: T, approval_id: AP2, action_kind: "owner.lead_followup", contact_id: C }] }, {}, "LEAD_REPLY_APPROVAL_WRONG_KIND"],
  ];
  for (const [label, o, extra, code] of cases) {
    const w = world(o);
    const r = await call(w, { approval_id: AP, ...extra });
    assert.equal(r.status, 409, label);
    assert.deepEqual([r.body.outcome, r.body.code], ["refused", code], label);
    assert.equal(w.proposals.length, 0, label);
  }
});

test("an approval that stops being pending after the card is refused at confirmation", async () => {
  const w = world();
  const proposed = await call(w, { approval_id: AP });
  w.approvals[0].status = "approved";
  const r = await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint });
  assert.equal(r.body.code, "LEAD_REPLY_APPROVAL_NOT_PENDING");
  assert.ok(!rpcNames(w).includes("prepare_comms_email_send"));
});

test("the approval is re-proved against the STORED call's contact, not the confirming request's", async () => {
  // Card raised for Riley. Before confirmation the reply's action is re-pointed at Sam, and the confirm
  // request names Sam: the request passes the pre-check, but the approved (stored) email is to Riley.
  const w = world();
  const proposed = await call(w, { approval_id: AP });
  w.actions[0].contact_id = C2;
  w.approvals[0].contact_id = C2;
  const r = await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint }, { contact_id: C2 });
  assert.equal(r.body.code, "LEAD_REPLY_APPROVAL_CONTACT_MISMATCH", JSON.stringify(r.body));
  assert.ok(!rpcNames(w).includes("prepare_comms_email_send"));
  assert.deepEqual(w.fetches, []);
});

test("an unknown request key or malformed approval id is refused before anything is read", async () => {
  const w = world();
  assert.equal((await call(w, { approval_id: "not-a-uuid" })).body.code, "COMMS_EMAIL_COMMAND_INVALID");
  assert.equal((await call(w, { approval: AP })).body.code, "COMMS_EMAIL_COMMAND_INVALID");
});

test("without approval_id the door behaves exactly as before (no approval read, no record)", async () => {
  const w = world();
  const proposed = await call(w, {});
  assert.equal(proposed.status, 202);
  assert.equal("approval_id" in (w.proposals[0].args as Row), false);
  const r = await call(w, { approved_fingerprint: proposed.body.fingerprint });
  assert.equal(r.body.outcome, "provider_accepted");
  assert.equal("record_status" in r.body, false);
  assert.ok(!rpcNames(w).includes("lead_reply_record_send_service"));
});

// ── one reply, one email (round-3 MAJOR-1 / MAJOR-2, security H1 / M1) ───────────────────────
const OP2 = "a3e30300-0000-4000-8000-000000000202";
test("the approval rides in the governance record to prepare (binding.approval_id); absent for a plain send", async () => {
  const w = world();
  const proposed = await call(w, { approval_id: AP });
  await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint });
  const prep = w.rpcCalls.find((c) => c.name === "prepare_comms_email_send");
  assert.equal((prep?.args._governance as Row).approval_id, AP);
  const w2 = world();
  const plain = await call(w2, {});
  await call(w2, { approved_fingerprint: plain.body.fingerprint });
  assert.equal("approval_id" in (w2.rpcCalls.find((c) => c.name === "prepare_comms_email_send")?.args._governance as Row), false);
});

test("record fails, then a NEW operation on the same reply: refused ALREADY_SENT, the lead gets ONE email", async () => {
  const w = world({ recordResult: { data: null, error: { code: "XX000", message: "boom" } } });
  const first = await call(w, { approval_id: AP });
  const sent = await call(w, { approval_id: AP, approved_fingerprint: first.body.fingerprint });
  assert.deepEqual([sent.body.outcome, sent.body.record_status], ["provider_accepted", "pending_record"]);
  const again = await call(w, { approval_id: AP, operation_id: OP2 });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.deepEqual([again.body.outcome, again.body.code], ["refused", "LEAD_REPLY_APPROVAL_ALREADY_SENT"]);
  assert.equal(w.fetches.length, 1, "exactly one email reached send-message");
  assert.equal(w.proposals.length, 1, "no second card was raised");
});

test("a second operation while another send of the reply is in flight: SEND_IN_PROGRESS; after it fails: allowed", async () => {
  for (const state of ["prepared", "dispatching", "unknown"]) {
    const w = world({ messages: [{ tenant_id: T, [BINDING_APPROVAL]: AP, operation_id: OP2, state }] });
    const r = await call(w, { approval_id: AP });
    assert.deepEqual([r.status, r.body.code], [409, "LEAD_REPLY_APPROVAL_SEND_IN_PROGRESS"], state);
    assert.equal(w.proposals.length, 0, state);
  }
  for (const state of ["failed", "refused"]) {
    const w = world({ messages: [{ tenant_id: T, [BINDING_APPROVAL]: AP, operation_id: OP2, state }] });
    const r = await call(w, { approval_id: AP });
    assert.equal(r.status, 202, `${state}: ${JSON.stringify(r.body)}`);
  }
  // A send prepared for ANOTHER approval does not block this one.
  const other = world({ messages: [{ tenant_id: T, [BINDING_APPROVAL]: AP2, operation_id: OP2, state: "provider_accepted" }] });
  assert.equal((await call(other, { approval_id: AP })).status, 202);
});

test("the database's one-send-per-approval refusal reaches the owner as its own code, never a generic one", async () => {
  for (const [db, code] of [["COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS", "LEAD_REPLY_APPROVAL_SEND_IN_PROGRESS"], ["COMMS_EMAIL_APPROVAL_ALREADY_SENT", "LEAD_REPLY_APPROVAL_ALREADY_SENT"], ["COMMS_EMAIL_APPROVAL_INVALID", "LEAD_REPLY_APPROVAL_INVALID"]]) {
    const w = world();
    const proposed = await call(w, { approval_id: AP });
    w.prepareError = { code: "55000", message: db };
    const r = await call(w, { approval_id: AP, approved_fingerprint: proposed.body.fingerprint });
    assert.deepEqual([r.body.ok, r.body.outcome, r.body.reason], [false, "refused", code], db);
    assert.deepEqual(w.fetches, [], db);
    assert.ok(!rpcNames(w).includes("lead_reply_record_send_service"), db);
  }
});

test("a replay naming a different approval than the operation was prepared for is refused and records nothing", async () => {
  for (const bindingApproval of [AP2, null]) {
    const w = world({ sent: true, bindingApproval });
    const r = await call(w, { approval_id: AP });
    assert.equal(r.status, 403, String(bindingApproval));
    assert.deepEqual([r.body.ok, r.body.code], [false, "LEAD_REPLY_APPROVAL_MISMATCH"], String(bindingApproval));
    assert.ok(!rpcNames(w).includes("lead_reply_record_send_service"), String(bindingApproval));
  }
  // A replay that names no approval records nothing and is answered as before.
  const plain = world({ sent: true, bindingApproval: AP });
  const r = await call(plain, {});
  assert.deepEqual([r.status, r.body.outcome, "record_status" in r.body], [200, "provider_accepted", false]);
});

// ── the module, directly ─────────────────────────────────────────────────────────────────────
const admin = (w: World) => ({
  from: (table: string) => ({ select: () => {
    const filters: Filter[] = [];
    const rows = () => matching(table === "paige_pending_approvals" ? w.approvals : table === "messages" ? w.messages : w.actions, filters);
    const q = { eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; }, maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }), limit: async () => ({ data: rows(), error: null }) };
    return q;
  } }),
  rpc: async () => w.recordResult as { data: unknown; error: unknown },
});
test("verifyLeadReplyApproval / storedApprovalMatches / recordLeadReplySend", async () => {
  const w = world();
  assert.equal(await verifyLeadReplyApproval(admin(w), { tenantId: T, approvalId: AP, contactId: C }), null);
  assert.equal(await verifyLeadReplyApproval(admin(w), { tenantId: T2, approvalId: AP, contactId: C }), "LEAD_REPLY_APPROVAL_NOT_FOUND");
  assert.equal(await verifyLeadReplyApproval({ ...admin(w), from: () => ({ select: () => { const q = { eq: () => q, maybeSingle: async () => ({ data: null, error: { code: "XX" } }) }; return q; } }) }, { tenantId: T, approvalId: AP, contactId: C }), "LEAD_REPLY_APPROVAL_UNAVAILABLE");
  assert.equal(storedApprovalMatches({ approval_id: AP }, AP.toUpperCase()), true);
  assert.equal(storedApprovalMatches({}, undefined), true);
  assert.equal(storedApprovalMatches({ approval_id: AP }, undefined), false);
  assert.equal(storedApprovalMatches({}, AP), false);
  assert.equal(await recordLeadReplySend(admin(w), { approvalId: AP, operationId: OP, actorUserId: U }), "recorded");
  // The operation being confirmed is not "another send"; any other live one is.
  const live = world({ messages: [{ tenant_id: T, [BINDING_APPROVAL]: AP, operation_id: OP, state: "prepared" }] });
  assert.equal(await verifyLeadReplyApproval(admin(live), { tenantId: T, approvalId: AP, contactId: C, operationId: OP }), null);
  assert.equal(await verifyLeadReplyApproval(admin(live), { tenantId: T, approvalId: AP, contactId: C, operationId: OP2 }), "LEAD_REPLY_APPROVAL_SEND_IN_PROGRESS");
  assert.equal(bindingApprovalMatches({ approval_id: AP.toUpperCase() }, AP), true);
  assert.equal(bindingApprovalMatches({ approval_id: AP2 }, AP), false);
  assert.equal(bindingApprovalMatches({ approval_id: null }, AP), false);
  assert.equal(bindingApprovalMatches(null, AP), false);
  assert.equal(leadReplyPrepareRefusal({ message: "COMMS_EMAIL_APPROVAL_ALREADY_SENT" }), "LEAD_REPLY_APPROVAL_ALREADY_SENT");
  assert.equal(leadReplyPrepareRefusal({ message: "COMMS_EMAIL_SENDER_CHANGED" }), null);
});
