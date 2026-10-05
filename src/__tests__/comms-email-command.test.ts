// @vitest-environment node
// INT-328 — the REAL comms-email-command handler, executed with only its network/runtime edges
// substituted (mirrors src/solo/sales/invoiceCommandEndpoint.test.ts). The canonical gate, the Kit
// declaration, the fingerprint, the command contract, party resolution and the executor are all the
// production modules; the database and send-message are a small in-memory world that enforces the
// same rules the migration does (one binding per operation, replay, recipient/sender re-check).
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, expect, it } from "vitest";
import { decideDeclaredCapability } from "../../supabase/functions/_shared/capability-kit/decision";
import { confirmFingerprint } from "../../supabase/functions/_shared/confirm-fingerprint";
import { COMMS_EMAIL_SEND_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/comms";
import { COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest } from "../../supabase/functions/_shared/comms-email/contract";
import { resolveCommsEmailParties, commsEmailReadinessOutcome, type CommsEmailReadiness } from "../../supabase/functions/_shared/comms-email/readiness";
import { executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult } from "../../supabase/functions/_shared/comms-email/adapter";

const TENANT = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const ACTOR = "40000000-0000-4000-8000-000000000001";
const CONTACT = "30000000-0000-4000-8000-000000000001";
const FOREIGN_CONTACT = "30000000-0000-4000-8000-000000000002";
const SENDER = "50000000-0000-4000-8000-000000000001";
const SENDER_2 = "50000000-0000-4000-8000-000000000002";
const OP = "20000000-0000-4000-8000-000000000001";
const OP_2 = "20000000-0000-4000-8000-000000000002";
const PROVIDER_ID = "re_provider_receipt_SECRET";
const command = { action: "comms.email_send", contact_id: CONTACT, subject: "Checking in", body: "Hi Dana,\n\nJust checking in on next week." };

const source = readFileSync("supabase/functions/comms-email-command/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Row = Record<string, unknown>;
type Filter = { method: string; args: unknown[] };
function matches(row: Row, filters: Filter[]) {
  return filters.every(({ method, args: [col, a, b] }) => {
    const v = row[col as string];
    if (method === "eq") return v === a;
    if (method === "neq") return v !== a;
    if (method === "is") return a === null ? v == null : v === a;
    if (method === "not") return a === "is" && b === null ? v != null : true;
    if (method === "gt") return String(v) > String(a);
    if (method === "lte") return String(v) <= String(a);
    if (method === "contains") return Object.entries(a as Row).every(([k, x]) => (v as Row | undefined)?.[k] === x);
    return true;
  });
}

type Setup = {
  authenticated?: boolean; currentTenant?: string; role?: string; connectors?: Row[]; contacts?: Row[];
  readiness?: Partial<CommsEmailReadiness>; sendBehavior?: "accept" | "throw" | "reject" | "not_admitted" | "hang_prepared"; auditFails?: boolean; lane?: string;
  // current_user_tenant_id answers, in order (the last one repeats). Overrides currentTenant.
  tenantSequence?: string[]; approvalStoreFails?: boolean;
};
function setup(options: Setup = {}) {
  const tables: Record<string, Row[]> = {
    tenant_members: [{ tenant_id: TENANT, user_id: ACTOR, role: options.role ?? "owner", status: "active" }],
    clients: options.contacts ?? [
      { id: CONTACT, tenant_id: TENANT, first_name: "Dana", last_name: "Reyes", entity_name: null, client_contact_methods: [{ kind: "email", value: " Dana@Example.test ", label: null, is_primary: true, position: 0 }, { kind: "email", value: "old@example.test", label: null, is_primary: false, position: 1 }] },
      { id: FOREIGN_CONTACT, tenant_id: FOREIGN, first_name: "Other", last_name: "Tenant", client_contact_methods: [{ kind: "email", value: "x@foreign.test", is_primary: true, position: 0 }] },
    ],
    channel_connectors: options.connectors ?? [{ id: SENDER, tenant_id: TENANT, channel_type: "email", provider: "resend", from_address: "Owner@Business.test", active: true, status: "active" }],
    paige_pending_confirmations: [],
    paige_audit_log: [],
  };
  const bindings = new Map<string, Row>(); // operation_id -> binding (with message_id)
  const calls: { name: string; args: Row }[] = [];
  const sends: Row[] = [];
  const builder = (table: string) => {
    const filters: Filter[] = [];
    let mutation: { kind: "update" | "insert"; value: Row } | null = null;
    const rows = () => (tables[table] ??= []);
    const run = (): { data: unknown; error: unknown } => {
      if (mutation?.kind === "insert") {
        const value = mutation.value;
        if (table === "paige_audit_log" && options.auditFails) return { data: null, error: { code: "XX000" } };
        if (table === "paige_pending_confirmations" && rows().some(r => r.user_id === value.user_id && r.tool_name === value.tool_name && r.fingerprint === value.fingerprint && r.consumed_at == null)) return { data: null, error: { code: "23505" } };
        rows().push({ ...value });
        return { data: [value], error: null };
      }
      if (table === "paige_pending_confirmations" && options.approvalStoreFails && !mutation) return { data: null, error: { code: "PGRST000", message: "store down" } };
      const found = rows().filter(r => matches(r, filters));
      if (mutation?.kind === "update") { found.forEach(r => Object.assign(r, mutation!.value)); calls.push({ name: `update:${table}`, args: { filters, value: mutation.value, hit: found.length } }); }
      return { data: found, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "is", "not", "gt", "lte", "contains"]) b[m] = (...args: unknown[]) => { filters.push({ method: m, args }); return b; };
    b.order = () => b; b.limit = () => b; b.select = () => b;
    b.update = (value: Row) => { mutation = { kind: "update", value }; return b; };
    b.insert = (value: Row) => { mutation = { kind: "insert", value }; calls.push({ name: `insert:${table}`, args: value }); return b; };
    b.maybeSingle = async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; };
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject);
    return b;
  };
  const resultOf = (binding: Row) => ({ ok: binding.state === "provider_accepted", outcome: binding.state, operation_id: binding.operation_id, message_id: binding.message_id,
    provider_receipt_available: binding.state === "provider_accepted", delivery_confirmed: false, provider: binding.provider,
    reconcilable: binding.provider === "resend" && binding.state === "unknown", ...(binding.outcome_reason ? { reason: binding.outcome_reason } : {}) });
  const admin = {
    from: builder,
    rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      if (name === "read_comms_email_send_result") { const b = bindings.get(String(args._operation_id).toLowerCase()); return { data: b ? resultOf(b) : null, error: null }; }
      if (name === "find_comms_email_pending_reconciliation") {
        const hit = [...bindings.values()].find(b => b.tenant_id === args._expected_tenant_id && b.recipient === args._recipient && b.content_digest === args._content_digest && ["dispatching", "unknown"].includes(String(b.state)));
        return { data: hit?.operation_id ?? null, error: null };
      }
      if (name === "read_comms_email_send_binding") { const b = [...bindings.values()].find(x => x.message_id === args._message_id); return { data: b ? { ...b } : null, error: null }; }
      if (name === "prepare_comms_email_send") {
        const op = String(args._operation_id).toLowerCase(); // a uuid parameter: stored as lowercase text
        const existing = bindings.get(op);
        if (existing) return { data: { ok: true, replayed: true, state: existing.state, message_id: existing.message_id }, error: null };
        const contact = tables.clients.find(c => c.id === args._contact_id && c.tenant_id === args._expected_tenant_id);
        if (!contact) return { data: null, error: { code: "42501", message: "COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE" } };
        if (!(contact.client_contact_methods as Row[]).some(m => m.kind === "email" && String(m.value).trim().toLowerCase() === args._recipient)) return { data: null, error: { code: "40001", message: "COMMS_EMAIL_RECIPIENT_CHANGED" } };
        const c = tables.channel_connectors.find(x => x.id === args._connector_id && x.tenant_id === args._expected_tenant_id);
        if (!c || String(c.from_address).toLowerCase() !== args._from_address) return { data: null, error: { code: "40001", message: "COMMS_EMAIL_SENDER_CHANGED" } };
        const digest = await commsEmailContentDigest({ recipient: args._recipient as string, connectorId: args._connector_id as string, subject: args._subject as string, bodyText: args._body_text as string });
        if (digest !== args._content_digest) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_DIGEST_MISMATCH" } };
        const governance = args._governance as Row;
        if (governance.approval_channel !== "operator_card" || !FINGERPRINT.test(String(governance.approved_fingerprint)) || governance.tool !== COMMS_EMAIL_TOOL) return { data: null, error: { code: "42501", message: "COMMS_EMAIL_GOVERNANCE_REQUIRED" } };
        const message_id = `60000000-0000-4000-8000-${String(bindings.size + 1).padStart(12, "0")}`;
        bindings.set(op, { operation_id: op, tenant_id: args._expected_tenant_id, actor_user_id: args._actor_user_id, contact_id: args._contact_id, recipient: args._recipient, connector_id: args._connector_id, from_address: args._from_address, provider: c.provider, subject: args._subject, body_text: args._body_text, body_html: args._body_html, content_digest: digest, command: args._command, state: "prepared", message_id });
        return { data: { ok: true, replayed: false, state: "prepared", message_id }, error: null };
      }
      return { data: null, error: { code: "42883", message: "unknown rpc" } };
    },
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: ACTOR } }, error: null }) },
    rpc: async (name: string) => {
      if (name !== "current_user_tenant_id") return { data: options.lane ?? "auto", error: null };
      const seq = options.tenantSequence;
      return { data: seq ? (seq.length > 1 ? seq.shift() : seq[0]) : options.currentTenant ?? TENANT, error: null };
    },
  };
  // send-message, as far as this door can observe it: it claims and finalizes the bound row.
  const fetchStub = async (_url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body) as Row;
    sends.push(payload);
    const binding = bindings.get(String(payload.comms_email_operation_id).toLowerCase());
    if (options.sendBehavior === "throw") { if (binding) binding.state = "unknown"; throw new Error("network"); }
    // Timed out before send-message claimed: the row is still 'prepared', but the call never answered.
    if (options.sendBehavior === "hang_prepared") throw new DOMException("aborted", "AbortError");
    // send-message compares the operation id to the binding's stored (lowercase) text exactly.
    if (!binding || payload.comms_email_operation_id !== binding.operation_id || payload.message_id !== binding.message_id || payload.to !== binding.recipient || payload.body !== binding.body_html || payload.subject !== binding.subject) return { ok: false, status: 409, json: async () => ({ error: "comms_email_binding_invalid" }) };
    // The claim did not admit the row (an identical send in flight): send-message answers 409 and the row stays prepared.
    if (options.sendBehavior === "not_admitted") return { ok: false, status: 409, json: async () => ({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_NOT_CLAIMABLE", delivery_confirmed: false }) };
    if (options.sendBehavior === "reject") { binding.state = "failed"; binding.outcome_reason = "provider_rejected"; }
    else { binding.state = "provider_accepted"; binding.provider_message_id = PROVIDER_ID; }
    return { ok: true, status: 200, json: async () => ({ ok: binding.state === "provider_accepted", outcome: binding.state, provider_message_id: PROVIDER_ID }) };
  };
  const readiness: CommsEmailReadiness = { eligible: true, state: "ready", reason: "READY_FOR_GOVERNED_REVIEW", provider_execution_verified: false, ...options.readiness } as CommsEmailReadiness;
  let handler: (request: Request) => Promise<Response>;
  const scope = {
    Deno: { env: { get: (key: string) => key }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: (_url: string, key: string) => key === "SUPABASE_ANON_KEY" ? caller : admin,
    fetch: fetchStub,
    confirmFingerprint, decideDeclaredCapability, COMMS_EMAIL_SEND_CAPABILITY,
    COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest,
    resolveCommsEmailParties, commsEmailReadinessOutcome, runPreSend: async () => { throw new Error("readiness is substituted in this suite"); },
    readCommsEmailReadiness: async (_admin: unknown, input: Row) => { calls.push({ name: "readiness", args: input }); return readiness; },
    executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult,
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (extra: Row = {}) => {
    const response = await handler!(new Request("https://example.test/comms-email-command", { method: "POST", headers: { Authorization: "Bearer signed-session" }, body: JSON.stringify({ expected_tenant_id: TENANT, operation_id: OP, command, ...extra }) }));
    return { status: response.status, body: await response.json() as Row, text: "" };
  };
  const named = (name: string) => calls.filter(c => c.name === name);
  const raw = async (init: RequestInit) => {
    const response = await handler!(new Request("https://example.test/comms-email-command", { headers: { Authorization: "Bearer signed-session" }, ...init }));
    return { status: response.status, body: await response.json() as Row };
  };
  return { request, raw, calls, sends, tables, bindings, named, options };
}

describe("comms-email-command: authority before anything", () => {
  it("refuses an unsigned caller, a switched workspace, a read-only member and request-authored authority before any read", async () => {
    for (const [opts, extra, status] of [[{ authenticated: false }, {}, 401], [{ currentTenant: FOREIGN }, {}, 409], [{ role: "member" }, {}, 403], [{}, { governance: { approved: true } }, 400]] as const) {
      const t = setup(opts);
      expect((await t.request(extra)).status).toBe(status);
      expect(t.calls.filter(c => c.name !== "update:paige_pending_confirmations")).toEqual([]);
      expect(t.sends).toEqual([]);
    }
  });
  it("refuses a command carrying a recipient, an HTML body or a line break in the subject", async () => {
    for (const bad of [{ ...command, to: "evil@x.test" }, { ...command, body_html: "<b>x</b>" }, { ...command, subject: "a\r\nBcc: x@y.z" }, { ...command, body: "" }]) {
      const t = setup();
      expect((await t.request({ command: bad })).body.code).toBe("COMMS_EMAIL_COMMAND_INVALID");
      expect(t.sends).toEqual([]);
    }
  });
});

describe("comms-email-command: server-resolved parties and readiness before a proposal", () => {
  it("refuses a contact in another workspace without a proposal", async () => {
    const t = setup();
    const r = await t.request({ command: { ...command, contact_id: FOREIGN_CONTACT } });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "CONTACT_NOT_IN_WORKSPACE" });
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("asks which sender when the workspace has two, and raises no card", async () => {
    const t = setup({ connectors: [
      { id: SENDER, tenant_id: TENANT, channel_type: "email", provider: "resend", from_address: "owner@business.test", active: true, status: "active" },
      { id: SENDER_2, tenant_id: TENANT, channel_type: "email", provider: "gmail", from_address: "team@business.test", active: true, status: "active" },
    ] });
    const r = await t.request();
    expect(r.body).toMatchObject({ ok: false, outcome: "sender_choice_required" });
    expect(r.body.senders).toEqual([{ connector_id: SENDER, from_address: "owner@business.test" }, { connector_id: SENDER_2, from_address: "team@business.test" }]);
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]); expect(t.named("readiness")).toEqual([]);
  });
  it("needs setup when the workspace has no email sender", async () => {
    const t = setup({ connectors: [] });
    expect((await t.request()).body).toMatchObject({ ok: false, outcome: "needs_setup", reason: "TENANT_EMAIL_SENDER_MISSING" });
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
  });
  it("needs setup when the contact has no primary email", async () => {
    const t = setup({ contacts: [{ id: CONTACT, tenant_id: TENANT, first_name: "Dana", client_contact_methods: [{ kind: "phone", value: "+12025550123", is_primary: true, position: 0 }] }] });
    expect((await t.request()).body).toMatchObject({ outcome: "needs_setup", reason: "RECIPIENT_EMAIL_MISSING" });
  });
  it("does not raise a card for a suppressed recipient", async () => {
    const t = setup({ readiness: { eligible: false, state: "held", reason: "BLOCKED_SUPPRESSED" } });
    expect((await t.request()).body).toMatchObject({ ok: false, outcome: "refused", reason: "BLOCKED_SUPPRESSED" });
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]); expect(t.sends).toEqual([]);
  });
});

describe("comms-email-command: the canonical approval cycle", () => {
  it("proposes a high-risk send even on an auto lane, fingerprinting the resolved recipient and sender", async () => {
    const t = setup({ lane: "auto" });
    const r = await t.request();
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ outcome: "approval_required", summary: 'Email Dana Reyes at dana@example.test from owner@business.test: "Checking in"',
      preview: { kind: "email", to_name: "Dana Reyes", to_address: "dana@example.test", from_address: "owner@business.test", subject: "Checking in", body_text: command.body } });
    expect(r.body.fingerprint).toMatch(FINGERPRINT);
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(stored).toMatchObject({ expected_tenant_id: TENANT, operation_id: OP, recipient: "dana@example.test", from_address: "owner@business.test", command: { ...command, connector_id: SENDER } });
    expect(r.body.fingerprint).toBe(await confirmFingerprint(COMMS_EMAIL_TOOL, stored));
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("a changed subject is a different approval", async () => {
    const t = setup();
    const a = await t.request();
    const b = await t.request({ operation_id: OP_2, command: { ...command, subject: "Checking in (updated)" } });
    expect(b.body.outcome).toBe("approval_required");
    expect(b.body.fingerprint).not.toBe(a.body.fingerprint);
  });
  it("never dispatches without redeeming a canonical server-issued proposal", async () => {
    const t = setup();
    await t.request();
    const r = await t.request({ approved_fingerprint: "ffffffffffffffff" });
    expect(r.body.outcome).toBe("approval_required");
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("executes the STORED approved call, not the request's re-authored command", async () => {
    const t = setup();
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint, command: { ...command, subject: "Something else entirely", body: "Different body" } });
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted", delivery_confirmed: false, provider_receipt_available: true });
    const prepared = t.named("prepare_comms_email_send")[0].args;
    expect(prepared).toMatchObject({ _subject: "Checking in", _body_text: command.body, _recipient: "dana@example.test", _from_address: "owner@business.test", _connector_id: SENDER,
      _governance: { approval_channel: "operator_card", approved_fingerprint: proposal.body.fingerprint, decision_receipt_recorded: true, tool: COMMS_EMAIL_TOOL, action: COMMS_EMAIL_ACTION } });
    expect(t.sends).toHaveLength(1);
    expect(t.sends[0]).toMatchObject({ channel: "email", to: "dana@example.test", subject: "Checking in", body: "<p>Hi Dana,</p><p>Just checking in on next week.</p>", comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}` });
    expect(t.sends[0]).not.toHaveProperty("comms_email_reconcile");
    expect(t.tables.paige_audit_log.map(a => (a.payload as Row).decision)).toEqual(["propose", "execute"]);
    expect(JSON.stringify(r.body)).not.toContain(PROVIDER_ID);
  });
  it("refuses, and sends nothing, when the contact's address changed after approval", async () => {
    const t = setup();
    const proposal = await t.request();
    (t.tables.clients[0].client_contact_methods as Row[])[0].value = "dana.new@example.test";
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "RECIPIENT_CHANGED" });
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("refuses, and sends nothing, when the sender's address changed after approval", async () => {
    const t = setup();
    const proposal = await t.request();
    t.tables.channel_connectors[0].from_address = "someone-else@business.test";
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "SENDER_CHANGED" });
    expect(t.sends).toEqual([]);
  });
  it("an approval is single use and a replay of an accepted operation never dispatches twice", async () => {
    const t = setup();
    const proposal = await t.request();
    await t.request({ approved_fingerprint: proposal.body.fingerprint });
    const again = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(again.body).toMatchObject({ ok: true, outcome: "provider_accepted", replayed: true });
    expect(t.sends).toHaveLength(1);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
  });
  it("a consumed fingerprint is not authority for another operation", async () => {
    const t = setup();
    const proposal = await t.request();
    await t.request({ approved_fingerprint: proposal.body.fingerprint });
    const reused = await t.request({ operation_id: OP_2, approved_fingerprint: proposal.body.fingerprint });
    expect(reused.body.outcome).toBe("approval_required");
    expect(t.sends).toHaveLength(1);
    expect(t.bindings.has(OP_2)).toBe(false);
  });
  it("reports a definitive provider rejection as failed, never as sent", async () => {
    const t = setup({ sendBehavior: "reject" });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "failed", reason: "PROVIDER_REJECTED", provider_receipt_available: false });
  });
  it("an unanswered send is outcome_unknown, and the next identical request reconciles it instead of minting a new operation", async () => {
    const t = setup({ sendBehavior: "throw" });
    const proposal = await t.request();
    const first = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(first.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" });
    expect(first.status).toBe(503);
    const before = t.named("insert:paige_pending_confirmations").length;
    const t2sends = t.sends.length;
    const retry = await t.request({ operation_id: OP_2 }); // same content, a fresh turn
    expect(retry.body.reconciled_operation_id).toBe(OP);
    expect(t.named("insert:paige_pending_confirmations")).toHaveLength(before);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
    expect(t.sends.slice(t2sends)).toEqual([expect.objectContaining({ comms_email_operation_id: OP, comms_email_reconcile: true, idempotency_key: `comms-email:${OP}` })]);
    expect(t.bindings.has(OP_2)).toBe(false);
  });
  it("records the governed decision, and refuses when that receipt cannot be written", async () => {
    const t = setup({ auditFails: true });
    const r = await t.request();
    expect(r.body).toMatchObject({ ok: false, code: "COMMS_EMAIL_DECISION_RECEIPT_FAILED" });
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
  });
  it("an off lane refuses before any proposal", async () => {
    const t = setup({ lane: "off" });
    expect((await t.request()).body).toMatchObject({ outcome: "refused", code: "autonomy_off" });
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
  });
});

describe("comms-email-command: a refusal before any dispatch says 'refused', never 'unknown' (verifier #7)", () => {
  it("method, sign-in, command shape and a switched workspace all carry outcome 'refused' with a code", async () => {
    const cases: [Setup, () => Promise<{ status: number; body: Row }>, number, string][] = [];
    const get = setup(); cases.push([{}, () => get.raw({ method: "GET" }), 405, "METHOD_NOT_ALLOWED"]);
    const anon = setup({ authenticated: false }); cases.push([{}, () => anon.request(), 401, "UNAUTHENTICATED"]);
    const bad = setup(); cases.push([{}, () => bad.request({ command: { ...command, to: "evil@x.test" } }), 400, "COMMS_EMAIL_COMMAND_INVALID"]);
    const moved = setup({ currentTenant: FOREIGN }); cases.push([{}, () => moved.request(), 409, "WORKSPACE_CHANGED"]);
    // Switched between the first scope check and the replay read.
    const midway = setup({ tenantSequence: [TENANT, FOREIGN] }); cases.push([{}, () => midway.request(), 409, "WORKSPACE_CHANGED"]);
    for (const [, run, status, code] of cases) {
      const r = await run();
      expect(r.status, code).toBe(status);
      expect(r.body, code).toMatchObject({ ok: false, outcome: "refused", code, delivery_confirmed: false });
    }
    for (const t of [get, anon, bad, moved, midway]) expect(t.sends).toEqual([]);
  });
  it("a switched workspace after approval is a refusal: the approval was consumed, nothing was prepared or sent", async () => {
    const t = setup();
    const proposal = await t.request();
    // scope ok, replay ok, then the workspace moves before the execute step.
    t.options.tenantSequence = [TENANT, TENANT, TENANT, FOREIGN];
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", code: "WORKSPACE_CHANGED" });
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("the approval store being down while proposing is a refusal (no prepared operation exists)", async () => {
    const t = setup({ approvalStoreFails: true });
    const r = await t.request();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", code: "APPROVAL_STORE_UNAVAILABLE" });
    expect(t.sends).toEqual([]);
  });
});

describe("comms-email-command: operation ids are case-insensitive (verifier #8)", () => {
  it("an uppercase operation id is bound, sent and read back as the same lowercase operation", async () => {
    const t = setup();
    const OP = "abcdef00-0000-4000-8000-0000000000ab"; // carries hex letters, so case actually differs
    const upper = OP.toUpperCase();
    expect(upper).not.toBe(OP);
    const proposal = await t.request({ operation_id: upper });
    expect(proposal.body).toMatchObject({ outcome: "approval_required", operation_id: OP });
    const r = await t.request({ operation_id: upper, approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(t.named("prepare_comms_email_send")[0].args._operation_id).toBe(OP);
    expect(t.sends[0]).toMatchObject({ comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}` });
    const replay = await t.request({ operation_id: upper });
    expect(replay.body).toMatchObject({ ok: true, outcome: "provider_accepted", replayed: true });
    expect(t.sends).toHaveLength(1);
  });
});

describe("comms-email-command: a send the claim did not admit, and the lingering prepared row", () => {
  it("send-message answered but did not admit the row: 'refused SEND_NOT_ADMITTED', not unknown", async () => {
    const t = setup({ sendBehavior: "not_admitted" });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "SEND_NOT_ADMITTED", operation_id: OP, delivery_confirmed: false });
    expect(t.bindings.get(OP)?.state).toBe("prepared");
  });
  it("send-message never answered while the row is still prepared: outcome_unknown (it may still be admitted)", async () => {
    const t = setup({ sendBehavior: "hang_prepared" });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" });
  });
  it("a lingering prepared row needs a FRESH approval cycle on the SAME operation, then sends exactly once", async () => {
    const t = setup({ sendBehavior: "not_admitted" });
    const first = await t.request();
    await t.request({ approved_fingerprint: first.body.fingerprint });
    expect(t.bindings.get(OP)?.state).toBe("prepared");
    const messageId = t.bindings.get(OP)?.message_id;
    // The consumed first approval is not authority again.
    t.options.sendBehavior = "accept";
    const stale = await t.request({ approved_fingerprint: first.body.fingerprint });
    expect(stale.body.outcome).toBe("approval_required");
    expect(t.sends).toHaveLength(1);
    // A new card for the same operation, carrying an approval-cycle nonce, so a new fingerprint.
    const again = await t.request();
    expect(again.body).toMatchObject({ outcome: "approval_required", operation_id: OP });
    expect(again.body.fingerprint).not.toBe(first.body.fingerprint);
    const cycleArgs = t.named("insert:paige_pending_confirmations").at(-1)!.args.args as Row;
    expect(cycleArgs).toMatchObject({ operation_id: OP, recipient: "dana@example.test" });
    expect(cycleArgs.approval_cycle_nonce).toMatch(UUID);
    const done = await t.request({ approved_fingerprint: again.body.fingerprint });
    expect(done.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    // Same operation, same bound row: the prepare replayed, nothing new was minted.
    expect(t.bindings.size).toBe(1);
    expect(t.bindings.get(OP)?.message_id).toBe(messageId);
    expect(t.sends.map(x => x.comms_email_operation_id)).toEqual([OP, OP]);
  });
});
