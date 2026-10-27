// @vitest-environment node
// INT-328 — the REAL comms-email-command handler, executed with only its network/runtime edges
// substituted (mirrors src/solo/sales/invoiceCommandEndpoint.test.ts). The canonical gate, the Kit
// declaration, the fingerprint, the command contract, party resolution and the executor are all the
// production modules; the database and send-message are a small in-memory world that enforces the
// same rules the migration does (one binding per operation, replay, recipient/sender re-check).
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideDeclaredCapability } from "../../supabase/functions/_shared/capability-kit/decision";
import { confirmFingerprint } from "../../supabase/functions/_shared/confirm-fingerprint";
import { COMMS_EMAIL_SEND_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/comms";
import { COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest, parseCommsEmailSendAt, canonicalCommsEmailSendAt, COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS, parseCommsEmailAttachmentRequest, COMMS_EMAIL_FILE_PROVIDERS } from "../../supabase/functions/_shared/comms-email/contract";
import { readCommsEmailAttachmentSources, copyCommsEmailAttachmentsToGoverned, parseCommsEmailAttachmentManifest, commsEmailManifestsEqual, commsEmailAttachmentPreview, commsEmailAttachmentSummary, commsEmailManifestDigest, readGovernedCommsEmailAttachmentFiles } from "../../supabase/functions/_shared/comms-email/attachments";
import { resolveCommsEmailParties, commsEmailReadinessOutcome, emailProvidersFor, type CommsEmailReadiness } from "../../supabase/functions/_shared/comms-email/readiness";
import { verifyLeadReplyApproval, storedApprovalMatches, recordLeadReplySend, bindingApprovalMatches, leadReplyPrepareRefusal } from "../../supabase/functions/comms-email-command/lead-reply-approval";
import { executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult } from "../../supabase/functions/_shared/comms-email/adapter";
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../../supabase/functions/_shared/comms-provider-boundary";

const TENANT = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const ACTOR = "40000000-0000-4000-8000-000000000001";
const ACTOR_2 = "40000000-0000-4000-8000-000000000002"; // a second admin of the same workspace (a teammate)
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
// Postgres jsonb containment (`@>`), which PostgREST's `cs` filter uses: an array contains another when
// every element of the second is contained in some element of the first.
function jsonContains(v: unknown, x: unknown): boolean {
  if (Array.isArray(x)) return Array.isArray(v) && x.every(xe => v.some(ve => jsonContains(ve, xe)));
  if (x && typeof x === "object") return !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(x as Row).every(([k, xv]) => jsonContains((v as Row)[k], xv));
  return v === x;
}
function matches(row: Row, filters: Filter[]) {
  return filters.every(({ method, args: [col, a, b] }) => {
    // PostgREST's JSON text path (`args->>key`) reads one key of a jsonb column as text.
    const [column, jsonKey] = String(col).split("->>");
    const v = jsonKey === undefined ? row[column] : (() => { const x = (row[column] as Row | undefined)?.[jsonKey]; return x === undefined || x === null ? null : String(x); })();
    if (method === "eq") return v === a;
    if (method === "neq") return v !== a;
    if (method === "is") return a === null ? v == null : v === a;
    if (method === "not") return a === "is" && b === null ? v != null : true;
    if (method === "gt") return String(v) > String(a);
    if (method === "lte") return String(v) <= String(a);
    if (method === "contains") return jsonContains(v, a);
    return true;
  });
}

type Setup = {
  authenticated?: boolean; currentTenant?: string; role?: string; connectors?: Row[]; contacts?: Row[];
  readiness?: Partial<CommsEmailReadiness>; sendBehavior?: "accept" | "throw" | "reject" | "not_admitted" | "hang_prepared"; auditFails?: boolean; lane?: string;
  // current_user_tenant_id answers, in order (the last one repeats). Overrides currentTenant.
  tenantSequence?: string[]; approvalStoreFails?: boolean;
  // Who is signed in (mutable between requests), the profile's active workspace (null = none set),
  // a replay read that errors, and a finalize that the database refuses.
  actor?: string; activeTenant?: string | null; readResultFails?: boolean; finalizeFails?: boolean;
  providerExecution?: unknown; providerBoundaryError?: boolean;
  cancelFails?: boolean;
  // The private bucket the composer uploads into: object path -> bytes + stored type. `storageFails`
  // makes every read answer an error.
  objects?: Record<string, { bytes: Uint8Array; type: string }>; storageFails?: boolean; bucketTypes?: string[] | null;
};
function setup(options: Setup = {}) {
  const tables: Record<string, Row[]> = {
    tenant_members: [{ tenant_id: TENANT, user_id: ACTOR, role: options.role ?? "owner", status: "active" }, { tenant_id: TENANT, user_id: ACTOR_2, role: "admin", status: "active" }],
    profiles: [{ user_id: ACTOR, active_tenant_id: options.activeTenant === undefined ? TENANT : options.activeTenant }, { user_id: ACTOR_2, active_tenant_id: TENANT }],
    clients: options.contacts ?? [
      { id: CONTACT, tenant_id: TENANT, first_name: "Dana", last_name: "Reyes", entity_name: null, client_contact_methods: [{ kind: "email", value: " Dana@Example.test ", label: null, is_primary: true, position: 0 }, { kind: "email", value: "old@example.test", label: null, is_primary: false, position: 1 }] },
      { id: FOREIGN_CONTACT, tenant_id: FOREIGN, first_name: "Other", last_name: "Tenant", client_contact_methods: [{ kind: "email", value: "x@foreign.test", is_primary: true, position: 0 }] },
    ],
    channel_connectors: options.connectors ?? [{ id: SENDER, tenant_id: TENANT, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: "resend", from_address: "Owner@Business.test", active: true, status: "active" }],
    paige_pending_confirmations: [],
    paige_audit_log: [],
  };
  const bindings = new Map<string, Row>(); // operation_id -> binding (with message_id)
  const calls: { name: string; args: Row }[] = [];
  const sends: Row[] = [];
  const sendWaits: number[] = [];
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
    // The database's former answer for a Resend operation. Experience 03 retires it in SQL too, but the
    // adapter must never re-send even when a stale database still says so (SendGrid has no idempotent replay).
    reconcilable: binding.provider === "resend" && binding.state === "unknown", ...(binding.outcome_reason && ["refused", "failed"].includes(String(binding.state)) ? { reason: binding.outcome_reason } : {}),
    // "Approve now, send later": the database names a scheduled operation's time (20271119000000).
    ...(typeof binding.send_at === "string" ? { send_at: binding.send_at } : {}) });
  const objects = new Map(Object.entries(options.objects ?? {}));
  const storageCalls: { op: string; path: string; upsert?: boolean }[] = [];
  const storage = {
    getBucket: async (id: string) => {
      storageCalls.push({ op: "getBucket", path: id });
      if (options.storageFails) return { data: null, error: { message: "storage down" } };
      return { data: { id, allowed_mime_types: options.bucketTypes === undefined ? BUCKET_TYPES : options.bucketTypes }, error: null };
    },
    from: (bucket: string) => ({
      download: async (path: string) => {
        storageCalls.push({ op: "download", path });
        const o = bucket === "comms-attachments" && !options.storageFails ? objects.get(path) : undefined;
        return o ? { data: new Blob([o.bytes], { type: o.type }), error: null } : { data: null, error: { message: "Object not found" } };
      },
      upload: async (path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }) => {
        storageCalls.push({ op: "upload", path, upsert: opts.upsert });
        if (options.storageFails) return { data: null, error: { message: "storage down" } };
        if (objects.has(path) && !opts.upsert) return { data: null, error: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } };
        objects.set(path, { bytes: new Uint8Array(body), type: opts.contentType });
        return { data: { path }, error: null };
      },
    }),
  };
  const admin = {
    storage,
    from: builder,
    rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      if (name === "comms_provider_execution_allowed") {
        if (options.providerBoundaryError) return { data: null, error: { code: "PGRST000" } };
        const ordinaryScope = args._tenant_id === TENANT && [ACTOR, ACTOR_2].includes(String(args._actor_user_id));
        return { data: options.providerExecution === undefined ? ordinaryScope : options.providerExecution, error: null };
      }
      if (name === "read_comms_email_send_result") {
        if (options.readResultFails) return { data: null, error: { code: "PGRST000", message: "readback down" } };
        const b = bindings.get(String(args._operation_id).toLowerCase());
        // The SQL read is tied to the actor: another actor's operation raises, never reads.
        if (b && b.actor_user_id !== args._actor_user_id) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_REPLAY_MISMATCH" } };
        return { data: b ? resultOf(b) : null, error: null };
      }
      // finalize_comms_email_send, as far as an unclaimed caller can use it: only a still-'prepared'
      // operation with no claimed attempt may be closed as refused/failed.
      if (name === "finalize_comms_email_send") {
        const b = [...bindings.values()].find(x => x.message_id === args._message_id && x.operation_id === args._operation_id);
        if (options.finalizeFails || !b || b.state !== "prepared" || args._claimed_attempt != null || !["refused", "failed"].includes(String(args._outcome))) return { data: null, error: { code: "42501", message: "COMMS_EMAIL_NOT_CLAIMED" } };
        b.state = args._outcome; b.outcome_reason = args._reason;
        return { data: { ok: false, outcome: args._outcome }, error: null };
      }
      if (name === "find_comms_email_pending_reconciliation") {
        const hit = [...bindings.values()].find(b => b.tenant_id === args._expected_tenant_id && b.recipient === args._recipient && b.content_digest === args._content_digest && ["dispatching", "unknown"].includes(String(b.state)));
        return { data: hit?.operation_id ?? null, error: null };
      }
      if (name === "read_comms_email_send_binding") { const b = [...bindings.values()].find(x => x.message_id === args._message_id); return { data: b ? { ...b } : null, error: null }; }
      // cancel_comms_email_send, as the SQL decides it: not found / not scheduled raise; a claimed or
      // settled operation answers cancelled:false with its state; a prepared one is closed as refused.
      if (name === "cancel_comms_email_send") {
        if (options.cancelFails) return { data: null, error: { message: "network" } };
        const b = bindings.get(String(args._operation_id));
        if (!b || b.tenant_id !== args._expected_tenant_id) return { data: null, error: { code: "P0002", message: "COMMS_EMAIL_OPERATION_NOT_FOUND" } };
        if (typeof b.send_at !== "string") return { data: null, error: { code: "55000", message: "COMMS_EMAIL_NOT_SCHEDULED" } };
        if (b.state !== "prepared") return { data: { cancelled: false, outcome: b.state, reason: b.outcome_reason ?? null, operation_id: b.operation_id, message_id: b.message_id }, error: null };
        b.state = "refused"; b.outcome_reason = "cancelled_by_owner";
        return { data: { cancelled: true, outcome: "refused", reason: "cancelled_by_owner", operation_id: b.operation_id, message_id: b.message_id, send_at: b.send_at }, error: null };
      }
      if (name === "prepare_comms_email_send") {
        const op = String(args._operation_id).toLowerCase(); // a uuid parameter: stored as lowercase text
        const existing = bindings.get(op);
        // The 15-argument overload (20271120000000): the manifest names this operation's governed copies,
        // which exist; a replay with other (or no) files is a mismatch; a non-SendGrid-arm sender gets no row.
        if ("_attachments" in args) {
          const files = args._attachments as Row[];
          if (!Array.isArray(files) || !files.length || files.some(f => !String(f.path).startsWith(`${args._expected_tenant_id}/governed/${op}/`) || !objects.has(String(f.path)) || objects.get(String(f.path))!.bytes.length !== f.size)) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_ATTACHMENTS_INVALID" } };
          if (existing && (JSON.stringify(existing.attachments ?? null) !== JSON.stringify(files) || (existing.send_at ?? null) !== (args._send_at ?? null))) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_REPLAY_MISMATCH" } };
          const c0 = tables.channel_connectors.find(x => x.id === args._connector_id);
          if (!existing && !["sendgrid", "resend"].includes(String(c0?.provider))) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED" } };
        }
        // The 14-argument overload: a stored send time must equal the requested one (including none).
        if (existing && "_send_at" in args && !("_attachments" in args) && existing.send_at !== args._send_at) return { data: null, error: { code: "22023", message: "COMMS_EMAIL_REPLAY_MISMATCH" } };
        if (existing) return { data: { ok: true, replayed: true, state: existing.state, message_id: existing.message_id, ...("_send_at" in args && args._send_at !== null ? { send_at: existing.send_at } : {}) }, error: null };
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
        const scheduled = "_send_at" in args && args._send_at !== null;
        bindings.set(op, { operation_id: op, tenant_id: args._expected_tenant_id, actor_user_id: args._actor_user_id, contact_id: args._contact_id, recipient: args._recipient, connector_id: args._connector_id, from_address: args._from_address, provider: c.provider, subject: args._subject, body_text: args._body_text, body_html: args._body_html, content_digest: digest, command: args._command, state: "prepared", message_id,
          ...(scheduled ? { send_at: args._send_at, status: "queued" } : {}), ...("_attachments" in args ? { attachments: args._attachments } : {}) });
        return { data: { ok: true, replayed: false, state: "prepared", message_id, ...(scheduled ? { send_at: args._send_at } : {}) }, error: null };
      }
      return { data: null, error: { code: "42883", message: "unknown rpc" } };
    },
  };
  const caller = {
    auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: options.actor ?? ACTOR } }, error: null }) },
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
    (options as Row & { onSend?: (b: Map<string, Row>) => void }).onSend?.(bindings);
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
    commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED,
    confirmFingerprint, decideDeclaredCapability, COMMS_EMAIL_SEND_CAPABILITY,
    COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest,
    parseCommsEmailSendAt, canonicalCommsEmailSendAt, COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS,
    resolveCommsEmailParties, commsEmailReadinessOutcome, emailProvidersFor,
    verifyLeadReplyApproval, storedApprovalMatches, recordLeadReplySend, bindingApprovalMatches, leadReplyPrepareRefusal, runPreSend: async () => { throw new Error("readiness is substituted in this suite"); },
    readCommsEmailReadiness: async (_admin: unknown, input: Row) => { calls.push({ name: "readiness", args: input }); return readiness; },
    executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult,
    parseCommsEmailAttachmentRequest, COMMS_EMAIL_FILE_PROVIDERS, readCommsEmailAttachmentSources, copyCommsEmailAttachmentsToGoverned,
    parseCommsEmailAttachmentManifest, commsEmailManifestsEqual, commsEmailAttachmentPreview, commsEmailAttachmentSummary,
    commsEmailManifestDigest, readGovernedCommsEmailAttachmentFiles,
    // The door's send-message wait, recorded (the real timer still runs).
    setTimeout: (fn: () => void, ms: number) => { sendWaits.push(ms); return setTimeout(fn, ms); },
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
  return { request, raw, calls, sends, tables, bindings, named, options, objects, storageCalls, sendWaits };
}
// The comms-attachments bucket's live allowlist (storage.buckets, read 2026-10-27).
const BUCKET_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

describe("comms-email-command: authority before anything", () => {
  it("only proposes a personal sender for its granting actor and refuses drift on approval", async () => {
    const sender = { id: SENDER, tenant_id: TENANT, channel_type: "email", provider: "gmail", from_address: "owner@business.test", active: true, status: "active", mailbox_class: "personal", mailbox_owner_user_id: ACTOR };
    const own = setup({ connectors: [sender] });
    const proposal = await own.request();
    expect(proposal.body.outcome).toBe("approval_required");
    expect(own.sends).toHaveLength(0);
    expect(own.named("readiness")[0].args.actorUserId).toBe(ACTOR);
    own.tables.channel_connectors[0].mailbox_owner_user_id = ACTOR_2;
    expect((await own.request({ approved_fingerprint: proposal.body.fingerprint })).body.outcome).toBe("needs_setup");
    expect(own.sends).toHaveLength(0);
    const foreign = setup({ connectors: [{ ...sender, mailbox_owner_user_id: ACTOR_2 }] });
    expect((await foreign.request()).body.outcome).toBe("needs_setup");
    expect(foreign.tables.paige_pending_confirmations).toHaveLength(0);
    expect(foreign.sends).toHaveLength(0);
  });
  it("refuses restricted, malformed and unavailable provider authority before proposals or effects", async () => {
    for (const options of [{ providerExecution: false }, { providerExecution: null }, { providerExecution: "true" }, { providerExecution: { allowed: true } }, { providerBoundaryError: true }]) {
      const t = setup(options);
      expect(await t.request()).toMatchObject({ status: 403, body: { ok: false, outcome: "refused", code: COMMS_PROVIDER_EXECUTION_DISABLED } });
      expect(t.named("comms_provider_execution_allowed")).toEqual([{ name: "comms_provider_execution_allowed", args: { _tenant_id: TENANT, _actor_user_id: ACTOR, _recipient_email: null } }]);
      expect(t.named("read_comms_email_send_result")).toEqual([]);
      expect(t.named("readiness")).toEqual([]);
      expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
      expect(t.named("prepare_comms_email_send")).toEqual([]);
      expect(t.sends).toEqual([]);
    }
  });
  it("refuses an unsigned caller, a switched workspace, a read-only member and request-authored authority before any read", async () => {
    for (const [opts, extra, status] of [[{ authenticated: false }, {}, 401], [{ currentTenant: FOREIGN }, {}, 409], [{ role: "member" }, {}, 403], [{}, { governance: { approved: true } }, 400]] as const) {
      const t = setup(opts);
      expect((await t.request(extra)).status).toBe(status);
      expect(t.calls.filter(c => !["update:paige_pending_confirmations", "comms_provider_execution_allowed"].includes(c.name))).toEqual([]);
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
      { id: SENDER, tenant_id: TENANT, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: "resend", from_address: "owner@business.test", active: true, status: "active" },
      { id: SENDER_2, tenant_id: TENANT, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: "gmail", from_address: "team@business.test", active: true, status: "active" },
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
  it("the fingerprint binds every material field: changing any one of them is a different approval", async () => {
    const t = setup();
    await t.request();
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    const base = await confirmFingerprint(COMMS_EMAIL_TOOL, stored);
    const cmd = stored.command as Row;
    const mutations: [string, Row][] = [
      ["tenant", { ...stored, expected_tenant_id: "10000000-0000-4000-8000-0000000000ff" }],
      ["operation", { ...stored, operation_id: OP_2 }],
      ["contact", { ...stored, command: { ...cmd, contact_id: FOREIGN_CONTACT } }],
      ["sender connector", { ...stored, command: { ...cmd, connector_id: SENDER_2 } }],
      ["subject", { ...stored, command: { ...cmd, subject: "Checking in!" } }],
      ["body", { ...stored, command: { ...cmd, body: `${cmd.body} ` } }],
      ["resolved recipient address", { ...stored, recipient: "dana2@example.test" }],
      ["sender address", { ...stored, from_address: "owner2@business.test" }],
      ["content digest", { ...stored, content_digest: "0".repeat(64) }],
    ];
    for (const [field, mutated] of mutations) expect(await confirmFingerprint(COMMS_EMAIL_TOOL, mutated), field).not.toBe(base);
    // The same arguments under another tool are another approval too.
    expect(await confirmFingerprint("billing_send_invoice", stored)).not.toBe(base);
  });
  it("declined, expired and consumed approvals are terminal: none of them sends", async () => {
    for (const end of ["declined", "expired", "consumed"] as const) {
      const t = setup();
      const proposal = await t.request();
      const row = t.tables.paige_pending_confirmations[0];
      if (end === "expired") row.expires_at = "2000-01-01T00:00:00.000Z";
      else row.consumed_at = "2000-01-01T00:00:00.000Z"; // a decline consumes the row exactly like a use
      const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
      expect(r.body.outcome, end).not.toBe("provider_accepted");
      expect(t.named("prepare_comms_email_send"), end).toEqual([]);
      expect(t.sends, end).toEqual([]);
    }
  });
  it("a comms approval can be spent only by this door: the invoice door consumes only its own tool's rows", () => {
    const invoiceDoor = readFileSync("supabase/functions/sales-invoice-command/index.ts", "utf8");
    // The invoice door's consume is keyed to its own capability tool name, never comms_send_email.
    expect(invoiceDoor).toMatch(/\.update\(\{ consumed_at[^)]*\)[\s\S]{0,120}\.eq\("tool_name", capability\)/);
    expect(invoiceDoor).not.toContain("comms_send_email");
    const commsDoor = readFileSync("supabase/functions/comms-email-command/index.ts", "utf8");
    expect(commsDoor).toMatch(/\.update\(\{ consumed_at[^)]*\)[\s\S]{0,120}\.eq\("tool_name", COMMS_EMAIL_TOOL\)/);
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
  it("an unanswered send is outcome_unknown, and the next identical request is routed to it — never a new operation, never a second send", async () => {
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
    expect(retry.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED", reconcilable: false });
    // SendGrid has no idempotent replay, so the email that may already have gone out is not POSTed again.
    expect(t.sends.slice(t2sends)).toEqual([]);
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
  it("send-message answered but did not admit the row: 'refused SEND_NOT_ADMITTED', and the row is closed as refused (x2 #1)", async () => {
    const t = setup({ sendBehavior: "not_admitted" });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "SEND_NOT_ADMITTED", operation_id: OP, delivery_confirmed: false });
    // Closed by an UNCLAIMED finalize (no attempt number), so it never sits 'prepared' ("Sending…").
    expect(t.named("finalize_comms_email_send").map(c => c.args)).toEqual([{ _message_id: t.bindings.get(OP)?.message_id, _operation_id: OP, _outcome: "refused", _provider_message_id: null, _reason: "send_not_admitted", _claimed_attempt: null }]);
    expect(t.bindings.get(OP)).toMatchObject({ state: "refused", outcome_reason: "send_not_admitted" });
    // The operation is terminal: asking with the same operation replays "not sent", and sends nothing.
    const replay = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(replay.body).toMatchObject({ ok: false, outcome: "refused", reason: "SEND_NOT_ADMITTED", replayed: true });
    expect(t.sends).toHaveLength(1);
  });
  it("if the database will not close the row (another attempt claimed it meanwhile), it stays outcome_unknown — never 'Not sent'", async () => {
    const t = setup({ sendBehavior: "not_admitted", finalizeFails: true });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown" });
    expect(r.body.reason).toBeUndefined();
    expect(t.bindings.get(OP)?.state).toBe("prepared");
  });
  it("not admitted because an IDENTICAL email went in flight between prepare and claim: outcome_unknown naming that send, never 'Not sent'; this operation is closed", async () => {
    const OTHER_OP = "99999999-9999-4999-8999-999999999999";
    const t = setup({ sendBehavior: "not_admitted" });
    // Between this operation's prepare and its claim, another approved operation with the same
    // recipient + content starts dispatching (the SQL claim then refuses this one).
    (t.options as Row).onSend = (bindings: Map<string, Row>) => {
      const mine = bindings.get(OP)!;
      bindings.set(OTHER_OP, { ...mine, operation_id: OTHER_OP, message_id: "60000000-0000-4000-8000-000000000099", state: "dispatching" });
    };
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", reconciled_operation_id: OTHER_OP, delivery_confirmed: false });
    // THIS operation sent nothing and is closed; the in-flight one is untouched.
    expect(t.bindings.get(OP)).toMatchObject({ state: "refused", outcome_reason: "send_not_admitted" });
    expect(t.bindings.get(OTHER_OP)?.state).toBe("dispatching");
  });
  it("send-message never answered while the row is still prepared: outcome_unknown (it may still be admitted)", async () => {
    const t = setup({ sendBehavior: "hang_prepared" });
    const proposal = await t.request();
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" });
    expect(t.named("finalize_comms_email_send")).toEqual([]);
    expect(t.bindings.get(OP)?.state).toBe("prepared");
  });
  it("a lingering prepared row (the send never answered) needs a FRESH approval cycle on the SAME operation, then sends exactly once", async () => {
    const t = setup({ sendBehavior: "hang_prepared" });
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

describe("comms-email-command: the replay read and the active workspace (x2 #3)", () => {
  it("a replay read that fails is outcome_unknown, never 'refused' — the operation may already have been sent", async () => {
    const t = setup({ readResultFails: true });
    const r = await t.request({ approved_fingerprint: "0123456789abcdef" });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE", delivery_confirmed: false });
    expect(t.sends).toEqual([]); expect(t.named("prepare_comms_email_send")).toEqual([]);
  });
  it("no active workspace on the profile, or a different one, is WORKSPACE_CHANGED before any read — the SQL would refuse every send", async () => {
    for (const activeTenant of [null, FOREIGN]) {
      const t = setup({ activeTenant });
      const r = await t.request();
      expect(r.status, String(activeTenant)).toBe(409);
      expect(r.body, String(activeTenant)).toMatchObject({ ok: false, outcome: "refused", code: "WORKSPACE_CHANGED" });
      expect(t.calls.filter(c => !["update:paige_pending_confirmations", "comms_provider_execution_allowed"].includes(c.name)), String(activeTenant)).toEqual([]);
      expect(t.sends).toEqual([]);
    }
  });
});

describe("comms-email-command: a teammate's identical email of unknown outcome (x2 #4)", () => {
  it("is named as a teammate's unconfirmed send: outcome_unknown, nothing prepared, proposed or sent", async () => {
    const t = setup({ sendBehavior: "throw" });
    const proposal = await t.request();
    const first = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(first.body.outcome).toBe("outcome_unknown");
    expect(t.bindings.get(OP)?.state).toBe("unknown");
    const sendsBefore = t.sends.length;
    // A second admin asks for the very same email in their own turn.
    t.options.actor = ACTOR_2;
    const teammate = await t.request({ operation_id: OP_2 });
    expect(teammate.status).toBe(503);
    expect(teammate.body).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_TEAMMATE_IN_FLIGHT", operation_id: OP_2, delivery_confirmed: false });
    expect(teammate.body).not.toHaveProperty("reconciled_operation_id");
    expect(t.sends).toHaveLength(sendsBefore);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
    expect(t.named("insert:paige_pending_confirmations")).toHaveLength(1);
    expect(t.bindings.has(OP_2)).toBe(false);
    // The original actor asking again still reconciles their own send.
    t.options.actor = ACTOR;
    const own = await t.request({ operation_id: OP_2 });
    expect(own.body.reconciled_operation_id).toBe(OP);
  });
});

describe("comms-email-command: approve now, send later", () => {
  afterEach(() => { vi.useRealTimers(); });
  // A whole-minute instant an hour ahead, in the canonical text the door stores.
  const later = (ms = 3_600_000) => new Date(Math.floor((Date.now() + ms) / 60_000) * 60_000).toISOString();

  it("a card for a scheduled email fingerprints the time, names it, and prepares or sends nothing", async () => {
    const t = setup();
    const sendAt = later();
    const scheduled = await t.request({ send_at: sendAt });
    expect(scheduled.status).toBe(202);
    expect(scheduled.body).toMatchObject({ outcome: "approval_required", preview: { send_at: sendAt } });
    expect(String(scheduled.body.summary)).toMatch(new RegExp(` — scheduled for ${sendAt.slice(0, 16).replace("T", " ")} UTC$`));
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(stored.send_at).toBe(sendAt);
    expect(scheduled.body.fingerprint).toBe(await confirmFingerprint(COMMS_EMAIL_TOOL, stored));
    const { send_at: _drop, ...immediate } = stored;
    expect(await confirmFingerprint(COMMS_EMAIL_TOOL, immediate)).not.toBe(scheduled.body.fingerprint);
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("an immediate card is byte-for-byte what it was: no send_at in its args, preview or summary", async () => {
    const t = setup();
    const r = await t.request();
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(stored).not.toHaveProperty("send_at");
    expect(r.body.preview).not.toHaveProperty("send_at");
    expect(r.body.summary).toBe('Email Dana Reyes at dana@example.test from owner@business.test: "Checking in"');
    const sent = await t.request({ approved_fingerprint: r.body.fingerprint });
    expect(sent.body.outcome).toBe("provider_accepted");
    expect(t.named("prepare_comms_email_send")[0].args).not.toHaveProperty("_send_at");
  });
  it("refuses an unreadable, zone-less, past or too-distant time before any read", async () => {
    for (const send_at of ["tomorrow at 9", "2030-01-01T09:00:00", new Date(Date.now() - 60_000).toISOString(), later(60_000), later(31 * 86_400_000), 1234]) {
      const t = setup();
      const r = await t.request({ send_at });
      expect(r, String(send_at)).toMatchObject({ status: 400, body: { ok: false, outcome: "refused", code: "COMMS_EMAIL_SEND_AT_INVALID" } });
      expect(t.calls.filter(c => c.name !== "comms_provider_execution_allowed")).toEqual([]);
    }
  });
  it("a drafted lead reply is never scheduled", async () => {
    const t = setup();
    const r = await t.request({ send_at: later(), approval_id: "70000000-0000-4000-8000-000000000001" });
    expect(r).toMatchObject({ status: 400, body: { outcome: "refused", code: "COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED" } });
    expect(t.calls.filter(c => c.name !== "comms_provider_execution_allowed")).toEqual([]);
  });
  it("approving prepares the row with the approved time and answers 'scheduled': send-message is never called", async () => {
    const t = setup();
    const sendAt = later();
    const proposal = await t.request({ send_at: sendAt });
    const r = await t.request({ send_at: sendAt, approved_fingerprint: proposal.body.fingerprint });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, outcome: "scheduled", send_at: sendAt, operation_id: OP, delivery_confirmed: false });
    expect(r.body.message_id).toMatch(UUID);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
    expect(t.named("prepare_comms_email_send")[0].args._send_at).toBe(sendAt);
    expect(t.sends).toEqual([]);
    // ok:true is not "sent": the support case is moved only by a provider-accepted send.
    expect(t.named("mark_support_case_outbound")).toEqual([]);
    expect(t.bindings.get(OP)).toMatchObject({ state: "prepared", send_at: sendAt, status: "queued" });
  });
  it("the stored call's time runs, whatever a confirm names", async () => {
    const t = setup();
    const sendAt = later();
    const proposal = await t.request({ send_at: sendAt });
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r.body).toMatchObject({ ok: true, outcome: "scheduled", send_at: sendAt });
    expect(t.sends).toEqual([]);
  });
  it("a scheduled operation asked about again is answered 'scheduled' — never a fresh card, never a send", async () => {
    const t = setup();
    const sendAt = later();
    const proposal = await t.request({ send_at: sendAt });
    await t.request({ send_at: sendAt, approved_fingerprint: proposal.body.fingerprint });
    const cards = t.named("insert:paige_pending_confirmations").length;
    for (const extra of [{}, { send_at: sendAt }, { send_at: later(7_200_000) }]) {
      const again = await t.request(extra);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ ok: true, outcome: "scheduled", send_at: sendAt, operation_id: OP, replayed: true });
    }
    expect(t.named("insert:paige_pending_confirmations")).toHaveLength(cards);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
    expect(t.sends).toEqual([]);
  });
  it("past its release grace and still prepared, a scheduled operation is neither 'scheduled' nor a resend: outcome_unknown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    const sendAt = later(180_000);
    const proposal = await t.request({ send_at: sendAt });
    await t.request({ send_at: sendAt, approved_fingerprint: proposal.body.fingerprint });
    // Inside the grace it is still being released: still answered as scheduled.
    vi.setSystemTime(Date.parse(sendAt) + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS - 1000);
    expect((await t.request()).body).toMatchObject({ ok: true, outcome: "scheduled" });
    vi.setSystemTime(Date.parse(sendAt) + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS + 1000);
    const late = await t.request();
    expect(late).toMatchObject({ status: 503, body: { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_SCHEDULED_RELEASE_UNSETTLED", operation_id: OP, replayed: true } });
    expect(t.sends).toEqual([]);
    expect(t.named("prepare_comms_email_send")).toHaveLength(1);
  });
  it("a live card for another time is a different approval cycle on the same operation", async () => {
    const t = setup();
    await t.request({ send_at: later() });
    const r = await t.request({ send_at: later(7_200_000) });
    expect(r).toMatchObject({ status: 409, body: { outcome: "refused", code: "APPROVAL_CYCLE_INVALID" } });
  });
  it("a scheduled approval confirmed after its time is refused before anything is prepared", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    const sendAt = later(180_000);
    const proposal = await t.request({ send_at: sendAt });
    vi.setSystemTime(Date.parse(sendAt) - 30_000);
    const r = await t.request({ approved_fingerprint: proposal.body.fingerprint });
    expect(r).toMatchObject({ status: 409, body: { ok: false, outcome: "refused", code: "COMMS_EMAIL_SEND_AT_PASSED" } });
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });

  describe("cancel", () => {
    const schedule = async (t: ReturnType<typeof setup>) => {
      const sendAt = later();
      const proposal = await t.request({ send_at: sendAt });
      await t.request({ send_at: sendAt, approved_fingerprint: proposal.body.fingerprint });
      return sendAt;
    };
    const cancel = (t: ReturnType<typeof setup>, extra: Row = {}) =>
      t.raw({ method: "POST", body: JSON.stringify({ expected_tenant_id: TENANT, operation_id: OP, cancel: true, ...extra }) });

    it("closes a scheduled email that has not gone out, under the database's decision", async () => {
      const t = setup();
      await schedule(t);
      const r = await cancel(t);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, cancelled: true, outcome: "refused", reason: "CANCELLED_BY_OWNER", operation_id: OP, delivery_confirmed: false });
      expect(t.named("cancel_comms_email_send")[0].args).toEqual({ _actor_user_id: ACTOR, _expected_tenant_id: TENANT, _operation_id: OP });
      expect(t.bindings.get(OP)?.state).toBe("refused");
      expect(t.sends).toEqual([]);
    });
    it("too late once the release has taken it: the send's own state is reported, never 'cancelled'", async () => {
      const t = setup();
      await schedule(t);
      t.bindings.get(OP)!.state = "dispatching";
      expect(await cancel(t)).toMatchObject({ status: 409, body: { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "outcome_unknown" } });
      t.bindings.get(OP)!.state = "provider_accepted";
      expect(await cancel(t)).toMatchObject({ status: 409, body: { cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "provider_accepted" } });
    });
    it("too late on a closed send carries the recorded reason, and only a well-formed one", async () => {
      const t = setup();
      await schedule(t);
      Object.assign(t.bindings.get(OP)!, { state: "refused", outcome_reason: "scheduled_release_missed" });
      expect(await cancel(t)).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome: "refused", reason: "scheduled_release_missed" } });
      Object.assign(t.bindings.get(OP)!, { outcome_reason: "<b>not a code</b>" });
      expect((await cancel(t)).body).not.toHaveProperty("reason");
      Object.assign(t.bindings.get(OP)!, { state: "provider_accepted", outcome_reason: "scheduled_release_missed" });
      expect((await cancel(t)).body).not.toHaveProperty("reason");
    });
    it("an immediate send cannot be cancelled here, and an unknown operation is not found", async () => {
      const t = setup();
      const proposal = await t.request();
      await t.request({ approved_fingerprint: proposal.body.fingerprint });
      expect(await cancel(t)).toMatchObject({ status: 409, body: { cancelled: false, code: "COMMS_EMAIL_NOT_SCHEDULED" } });
      expect(await cancel(t, { operation_id: OP_2 })).toMatchObject({ status: 404, body: { cancelled: false, code: "COMMS_EMAIL_NOT_FOUND" } });
    });
    it("a teammate owner/admin may cancel (a brake needs no special authority); a read-only member may not", async () => {
      const t = setup();
      await schedule(t);
      t.options.actor = ACTOR_2;
      expect((await cancel(t)).body).toMatchObject({ ok: true, cancelled: true });
      const m = setup({ role: "member" });
      expect(await cancel(m)).toMatchObject({ status: 403, body: { code: "COMMS_EMAIL_FORBIDDEN" } });
      expect(m.named("cancel_comms_email_send")).toEqual([]);
    });
    it("is not held behind the provider kill switch, but is behind the open workspace", async () => {
      const t = setup();
      await schedule(t);
      t.options.providerExecution = false;
      expect((await cancel(t)).body).toMatchObject({ cancelled: true });
      const other = setup({ activeTenant: FOREIGN });
      expect(await cancel(other)).toMatchObject({ status: 409, body: { code: "WORKSPACE_CHANGED" } });
      expect(other.named("cancel_comms_email_send")).toEqual([]);
    });
    it("the body is exactly the three keys; nothing else may ride with a cancel", async () => {
      for (const extra of [{ command }, { send_at: later() }, { approved_fingerprint: "0123456789abcdef" }, { cancel: false }, { cancel: "yes" }]) {
        const t = setup();
        expect(await cancel(t, extra), JSON.stringify(extra)).toMatchObject({ status: 400, body: { code: "COMMS_EMAIL_COMMAND_INVALID" } });
        expect(t.named("cancel_comms_email_send")).toEqual([]);
      }
    });
    it("an unreadable cancel answer says it could not be verified, never 'cancelled'", async () => {
      const t = setup({ cancelFails: true });
      expect(await cancel(t)).toMatchObject({ status: 503, body: { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_UNVERIFIED" } });
    });
  });
});

describe("comms-email-command: files the approved email carries", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const PDF = enc("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const UP1 = "90000000-0000-4000-8000-000000000001", UP2 = "90000000-0000-4000-8000-000000000002";
  const src1 = `${TENANT}/${UP1}-proposal.pdf`, src2 = `${TENANT}/${UP2}-site_photo.png`;
  const gov = (n: number, name: string) => `${TENANT}/governed/${OP}/${n}-${name}`;
  const files = () => ({ [src1]: { bytes: PDF, type: "application/pdf" }, [src2]: { bytes: PNG, type: "image/png" } });
  const ready = { sender_provider: "resend" } as Partial<CommsEmailReadiness>;
  const attachments = [{ path: src1 }, { path: src2 }];
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map(x => x.toString(16).padStart(2, "0")).join("");
  // The fingerprint this exact request had before files existed (fe98354b0), with a fixed cycle nonce.
  const GOLDEN_NO_FILES_FINGERPRINT = "c36cec82fca15481";

  it("without files the approved call is byte-for-byte what it was: the same keys and the same fingerprint (golden)", async () => {
    const t = setup();
    const card = await t.request();
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(Object.keys(stored).sort()).toEqual(["approval_cycle_nonce", "command", "content_digest", "expected_tenant_id", "from_address", "operation_id", "recipient"]);
    expect(card.body.preview).not.toHaveProperty("attachments");
    expect(card.body.summary).toBe('Email Dana Reyes at dana@example.test from owner@business.test: "Checking in"');
    expect(await confirmFingerprint(COMMS_EMAIL_TOOL, { ...stored, approval_cycle_nonce: "70000000-0000-4000-8000-0000000000aa" })).toBe(GOLDEN_NO_FILES_FINGERPRINT);
  });
  it("a card with files fingerprints each file (governed path, type, size, sha256), names them, and copies nothing yet", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    expect(card.status).toBe(202);
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(stored.attachments).toEqual([
      { path: gov(1, "proposal.pdf"), source_path: src1, name: "proposal.pdf", mime: "application/pdf", size: PDF.length, sha256: await sha(PDF) },
      { path: gov(2, "site_photo.png"), source_path: src2, name: "site_photo.png", mime: "image/png", size: PNG.length, sha256: await sha(PNG) },
    ]);
    expect(card.body.fingerprint).toBe(await confirmFingerprint(COMMS_EMAIL_TOOL, stored));
    const { attachments: _drop, ...without } = stored;
    expect(await confirmFingerprint(COMMS_EMAIL_TOOL, without)).not.toBe(card.body.fingerprint);
    expect(card.body.preview).toMatchObject({ attachments: [{ name: "proposal.pdf", size: PDF.length, mime: "application/pdf" }, { name: "site_photo.png", size: PNG.length, mime: "image/png" }] });
    expect(card.body.summary).toBe('Email Dana Reyes at dana@example.test from owner@business.test: "Checking in" — with 2 files: proposal.pdf, site_photo.png');
    expect(t.storageCalls.filter(c => c.op === "upload")).toEqual([]);
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("approving copies the bytes it hashed to the governed paths (never overwriting) and prepares the 15-argument call", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    const r = await t.request({ attachments, approved_fingerprint: card.body.fingerprint });
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(t.storageCalls.filter(c => c.op === "upload")).toEqual([{ op: "upload", path: gov(1, "proposal.pdf"), upsert: false }, { op: "upload", path: gov(2, "site_photo.png"), upsert: false }]);
    expect(t.objects.get(gov(1, "proposal.pdf"))?.bytes).toEqual(PDF);
    const prepared = t.named("prepare_comms_email_send")[0].args;
    expect(prepared._send_at).toBeNull();
    expect(prepared._attachments).toEqual((t.named("insert:paige_pending_confirmations")[0].args.args as Row).attachments);
    // Files never ride the send-message request: send-message reads them from the binding alone.
    expect(t.sends[0]).not.toHaveProperty("attachments");
    expect(t.bindings.get(OP)?.attachments).toEqual(prepared._attachments);
  });
  it("a file whose bytes changed between the card and the confirm redeems nothing: no copy, no prepare, no send", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    t.objects.set(src1, { bytes: enc("%PDF-1.7\nsomething else entirely\n"), type: "application/pdf" });
    const r = await t.request({ attachments, approved_fingerprint: card.body.fingerprint });
    expect(r.body.outcome).toBe("approval_required");
    expect(r.body.fingerprint).not.toBe(card.body.fingerprint);
    expect(t.tables.paige_pending_confirmations.find(p => p.fingerprint === card.body.fingerprint)?.consumed_at ?? null).toBeNull();
    expect(t.storageCalls.filter(c => c.op === "upload")).toEqual([]);
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("another business's file, a Team Hub or governed object, a traversal or a repeat is refused with ZERO storage calls", async () => {
    for (const bad of [
      [{ path: `${FOREIGN}/${UP1}-proposal.pdf` }], [{ path: `${TENANT}/team-hub/${UP1}-x.pdf` }], [{ path: `${TENANT}/governed/${OP}/1-proposal.pdf` }],
      [{ path: `${TENANT}/${UP1}-..pdf` }], [{ path: `${TENANT}/${UP1}-a%2Fb.pdf` }], [{ path: src1 }, { path: src1 }], [{ path: src1, name: "x" }], [], "a.pdf",
      Array.from({ length: 11 }, (_, i) => ({ path: `${TENANT}/${UP1.slice(0, -2)}${String(i).padStart(2, "0")}-f.pdf` })),
    ]) {
      const t = setup({ objects: files(), readiness: ready });
      expect(await t.request({ attachments: bad }), JSON.stringify(bad)).toMatchObject({ status: 400, body: { ok: false, outcome: "refused", code: "COMMS_EMAIL_ATTACHMENTS_INVALID" } });
      expect(t.storageCalls).toEqual([]);
      expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
    }
  });
  it("a file that is not what it claims, empty, too large, or of a type the bucket refuses raises no card", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PDF);
    for (const [object, code, opts] of [
      [{ bytes: PNG, type: "application/pdf" }, "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED", {}],
      [{ bytes: PDF, type: "image/png" }, "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED", {}],
      [{ bytes: new Uint8Array(0), type: "application/pdf" }, "COMMS_EMAIL_ATTACHMENT_EMPTY", {}],
      [{ bytes: big, type: "application/pdf" }, "COMMS_EMAIL_ATTACHMENT_TOO_LARGE", {}],
      [{ bytes: PDF, type: "application/pdf" }, "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED", { bucketTypes: ["image/png"] }],
    ] as const) {
      const t = setup({ objects: { [src1]: object }, readiness: ready, ...opts });
      expect(await t.request({ attachments: [{ path: src1 }] }), code).toMatchObject({ status: 422, body: { outcome: "refused", code } });
      expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
    }
    const missing = setup({ objects: {}, readiness: ready });
    expect(await missing.request({ attachments: [{ path: src1 }] })).toMatchObject({ status: 503, body: { outcome: "refused", code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" } });
  });
  it("files only through the SendGrid arm: a Gmail sender is refused before anything is read", async () => {
    const t = setup({ objects: files(), readiness: { sender_provider: "gmail" } });
    expect(await t.request({ attachments })).toMatchObject({ status: 422, body: { outcome: "refused", code: "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED" } });
    expect(t.storageCalls).toEqual([]);
    expect(COMMS_EMAIL_FILE_PROVIDERS).toEqual(["sendgrid", "resend"]);
  });
  it("a drafted lead reply never carries files", async () => {
    const t = setup({ objects: files(), readiness: ready });
    expect(await t.request({ attachments, approval_id: "70000000-0000-4000-8000-000000000001" })).toMatchObject({ status: 400, body: { code: "COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED" } });
    expect(t.storageCalls).toEqual([]);
  });
  it("a confirm that drops the files is not this approval: refused, nothing copied or prepared", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    expect(await t.request({ approved_fingerprint: card.body.fingerprint })).toMatchObject({ status: 409, body: { outcome: "refused", code: "COMMS_EMAIL_ATTACHMENTS_CHANGED" } });
    expect(t.storageCalls.filter(c => c.op === "upload")).toEqual([]);
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("a governed copy already there with other bytes is CHANGED: nothing is prepared", async () => {
    const t = setup({ objects: { ...files(), [gov(1, "proposal.pdf")]: { bytes: enc("%PDF-1.7\nplanted\n"), type: "application/pdf" } }, readiness: ready });
    const card = await t.request({ attachments });
    expect(await t.request({ attachments, approved_fingerprint: card.body.fingerprint })).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_ATTACHMENT_CHANGED" } });
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("a scheduled email with files prepares with its time and its files, and sends nothing now", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const sendAt = new Date(Math.floor((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString();
    const card = await t.request({ attachments, send_at: sendAt });
    expect(card.body.summary).toMatch(/ — with 2 files: proposal\.pdf, site_photo\.png — scheduled for /);
    const r = await t.request({ attachments, send_at: sendAt, approved_fingerprint: card.body.fingerprint });
    expect(r.body).toMatchObject({ ok: true, outcome: "scheduled", send_at: sendAt });
    expect(t.named("prepare_comms_email_send")[0].args).toMatchObject({ _send_at: sendAt });
    expect((t.named("prepare_comms_email_send")[0].args._attachments as Row[]).map(a => a.path)).toEqual([gov(1, "proposal.pdf"), gov(2, "site_photo.png")]);
    expect(t.sends).toEqual([]);
  });
  it("a request without files never touches storage, and a live cycle for other files is a different approval", async () => {
    const t = setup({ objects: files(), readiness: ready });
    await t.request({ attachments });
    expect(await t.request({ attachments: [{ path: src1 }] })).toMatchObject({ status: 409, body: { code: "APPROVAL_CYCLE_INVALID" } });
    const plain = setup();
    await plain.request();
    expect(plain.storageCalls).toEqual([]);
  });
});

describe("comms-email-command: files — review round 2", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const PDF = enc("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const UP1 = "90000000-0000-4000-8000-000000000001", UP2 = "90000000-0000-4000-8000-000000000002";
  const src1 = `${TENANT}/${UP1}-proposal.pdf`, src2 = `${TENANT}/${UP2}-site_photo.png`;
  const gov = (n: number, name: string, op = OP) => `${TENANT}/governed/${op}/${n}-${name}`;
  const files = () => ({ [src1]: { bytes: PDF, type: "application/pdf" }, [src2]: { bytes: PNG, type: "image/png" } });
  const ready = { sender_provider: "resend" } as Partial<CommsEmailReadiness>;
  const attachments = [{ path: src1 }, { path: src2 }];
  const OTHER = "20000000-0000-4000-8000-0000000000ee";
  // An identical-text email to Dana under another operation whose outcome is not settled yet.
  const pendingTwin = async (t: ReturnType<typeof setup>, withFiles: boolean) => {
    const digest = await commsEmailContentDigest({ recipient: "dana@example.test", connectorId: SENDER, subject: command.subject, bodyText: command.body });
    t.bindings.set(OTHER, { operation_id: OTHER, tenant_id: TENANT, actor_user_id: ACTOR, contact_id: CONTACT, recipient: "dana@example.test", connector_id: SENDER,
      from_address: "owner@business.test", provider: "resend", subject: command.subject, body_text: command.body, body_html: commsEmailBodyHtml(command.body),
      content_digest: digest, command: { ...command, connector_id: SENDER }, state: "dispatching", message_id: "60000000-0000-4000-8000-0000000000ee",
      ...(withFiles ? { attachments: [{ path: gov(1, "proposal.pdf", OTHER) }] } : {}) });
  };

  it("M1: a request WITH files is never handed an identical-text send's result — refused as in flight, nothing read or sent", async () => {
    const t = setup({ objects: files(), readiness: ready });
    await pendingTwin(t, false);
    const r = await t.request({ attachments });
    expect(r).toMatchObject({ status: 503, body: { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", reconciled_operation_id: OTHER, operation_id: OP } });
    expect(t.storageCalls).toEqual([]);
    expect(t.named("insert:paige_pending_confirmations")).toEqual([]);
    expect(t.sends).toEqual([]);
    expect(t.bindings.get(OTHER)?.state).toBe("dispatching");
  });
  it("M1: a request WITHOUT files is never handed the result of an identical-text send that carried files", async () => {
    const t = setup();
    await pendingTwin(t, true);
    const r = await t.request();
    expect(r).toMatchObject({ status: 503, body: { outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", reconciled_operation_id: OTHER } });
    expect(r.body).not.toHaveProperty("replayed");
    expect(t.sends).toEqual([]);
  });
  it("M1 control: two identical emails without files still settle as one (unchanged)", async () => {
    const t = setup();
    await pendingTwin(t, false);
    const r = await t.request();
    expect(r.body).toMatchObject({ reconciled_operation_id: OTHER });
    expect(r.body.code).not.toBe("COMMS_EMAIL_IDENTICAL_IN_FLIGHT");
  });
  it("M3: the approved call carries the manifest's digest, and the confirm redeems by that digest alone", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    const stored = t.named("insert:paige_pending_confirmations")[0].args.args as Row;
    expect(stored.attachments_digest).toBe(await commsEmailManifestDigest(stored.attachments as never));
    await t.request({ attachments, approved_fingerprint: card.body.fingerprint });
    const redeem = t.named("update:paige_pending_confirmations").find(c => (c.args.filters as Filter[]).some(f => f.method === "neq" && f.args[0] === "issued_in_request"))!;
    expect((redeem.args.filters as Filter[]).filter(f => f.method === "eq" && f.args[0] === "args->>attachments_digest").map(f => f.args[1])).toEqual([stored.attachments_digest]);
    expect((redeem.args.filters as Filter[]).some(f => f.method === "contains")).toBe(false);
    expect(redeem.args.hit).toBe(1);
  });
  it("M3: a confirm naming FEWER files (a subset) redeems nothing: the card stays unspent and nothing is copied", async () => {
    const t = setup({ objects: files(), readiness: ready });
    const card = await t.request({ attachments });
    const r = await t.request({ attachments: [{ path: src1 }], approved_fingerprint: card.body.fingerprint });
    expect(r.body.outcome).toBe("approval_required");
    expect(t.tables.paige_pending_confirmations.find(p => p.fingerprint === card.body.fingerprint)?.consumed_at ?? null).toBeNull();
    expect(t.storageCalls.filter(c => c.op === "upload")).toEqual([]);
    expect(t.named("prepare_comms_email_send")).toEqual([]); expect(t.sends).toEqual([]);
  });
  it("M4: the door waits 40 s on send-message only when the email carries files", async () => {
    const withFiles = setup({ objects: files(), readiness: ready });
    const card = await withFiles.request({ attachments });
    await withFiles.request({ attachments, approved_fingerprint: card.body.fingerprint });
    expect(withFiles.sendWaits).toEqual([40_000]);
    const plain = setup();
    const p = await plain.request();
    await plain.request({ approved_fingerprint: p.body.fingerprint });
    expect(plain.sendWaits).toEqual([25_000]);
  });
  it("(c) recovering a prepared send uses the governed copies it approved, even after the uploads are gone", async () => {
    const t = setup({ objects: files(), readiness: ready, sendBehavior: "hang_prepared" });
    const first = await t.request({ attachments });
    await t.request({ attachments, approved_fingerprint: first.body.fingerprint });
    expect(t.bindings.get(OP)?.state).toBe("prepared");
    t.objects.delete(src1); t.objects.delete(src2);
    t.options.sendBehavior = "accept";
    const before = t.storageCalls.length;
    const again = await t.request({ attachments });
    expect(again.body).toMatchObject({ outcome: "approval_required" });
    expect(t.storageCalls.slice(before).filter(c => c.op === "download").map(c => c.path)).toEqual([gov(1, "proposal.pdf"), gov(2, "site_photo.png")]);
    const done = await t.request({ attachments, approved_fingerprint: again.body.fingerprint });
    expect(done.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(t.sends).toHaveLength(2);
  });
  it("(c) …but a governed copy that changed, or uploads named differently, is refused — nothing is re-sent", async () => {
    const t = setup({ objects: files(), readiness: ready, sendBehavior: "hang_prepared" });
    const first = await t.request({ attachments });
    await t.request({ attachments, approved_fingerprint: first.body.fingerprint });
    t.objects.set(gov(2, "site_photo.png"), { bytes: new Uint8Array([...PNG, 1]), type: "image/png" });
    expect(await t.request({ attachments })).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_ATTACHMENT_CHANGED" } });
    expect(await t.request({ attachments: [{ path: src2 }, { path: src1 }] })).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_ATTACHMENTS_CHANGED" } });
    expect(t.sends).toHaveLength(1);
  });
});
