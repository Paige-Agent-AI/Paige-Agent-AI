import { decideContentRead } from "../inbox-intelligence/policy.ts";
// Experience 03 · S3 — security H2: PAIGE Email (SendGrid) sends ONLY as the governed email door's
// dispatch. The REAL send-message handler is transpiled and executed with only its imports and the
// network substituted (send-message-sendgrid.test.ts technique). `fetch` is a stub that records every
// call: no HTTP request leaves this process and no provider is called.
//
// Proves: a SendGrid connector named by a user's generic send, by a service-role send that names no
// prepared comms_email operation, or by a scheduled release is refused with
// `paige_email_requires_governed_send` BEFORE any provider call (zero fetches), while a Resend
// connector on the identical request still reaches its provider (the gate is SendGrid-only).
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../comms-provider-boundary.ts";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { senderDisplayName } from "../email/sender-display-name.ts";
import { isPreparedAgreementMessage } from "../agreements/prepared-signature-message.ts";
import { tenantFrom, PLATFORM_FROM_DOMAIN } from "../email/platform-sendgrid.ts";
import { parseCommsEmailAttachmentManifest, readGovernedCommsEmailAttachments } from "./attachments.ts";
import { COMMS_EMAIL_FILE_PROVIDERS } from "./contract.ts";

const MSG = "33333333-3333-4333-8333-3333333333bb";
const TENANT = "44444444-4444-4444-8444-4444444444bb";
const CONTACT = "55555555-5555-4555-8555-5555555555bb";
const CONNECTOR = "66666666-6666-4666-8666-6666666666bb";
const ACTOR = "77777777-7777-4777-8777-7777777777bb";
const SERVICE = "internal-service-key";

const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Caller = "user" | "service";
function setup(opts: { provider?: string; caller?: Caller; queued?: boolean; answer?: number | "throw"; row?: { status: string; error: string | null };
  // A governed email row (meta.comms_email_binding) and what claim_comms_email_send answers for it.
  binding?: Record<string, unknown>; claim?: Record<string, unknown>; connectorActive?: boolean;
  // The private bucket, as send-message's service-role storage client reads it.
  objects?: Record<string, { bytes: Uint8Array; type: string }> } = {}) {
  const provider = opts.provider ?? "sendgrid";
  const rpcCalls: string[] = [];
  const rpcArgs: { name: string; args: Record<string, unknown> }[] = [];
  const fetchCalls: string[] = [];
  const fetchBodies: Record<string, unknown>[] = [];
  const writes: { table: string; mode: string; values: unknown }[] = [];
  const adapters: Record<string, { send: (...a: unknown[]) => Promise<unknown> }> = {};
  const downloads: string[] = [];
  let handler: (req: Request) => Promise<Response>;
  const client = {
    storage: { from: (bucket: string) => ({ download: async (path: string) => {
      downloads.push(`${bucket}:${path}`);
      const o = opts.objects?.[path];
      return o ? { data: new Blob([o.bytes], { type: o.type }), error: null } : { data: null, error: { message: "Object not found" } };
    } }) },
    auth: { getUser: async () => ({ data: { user: { id: ACTOR } } }) },
    from: (table: string) => {
      let mode = "select";
      const q: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order", "select", "limit", "gte", "lte"]) q[m] = () => q;
      for (const m of ["insert", "upsert", "update"]) q[m] = (values: unknown) => { mode = m; writes.push({ table, mode: m, values }); return q; };
      const result = () => {
        if (mode !== "select") return { data: { id: table === "messages" ? MSG : "row-id" }, error: null };
        if (table === "messages") return { data: { tenant_id: TENANT, status: opts.row?.status ?? (opts.queued ? "queued" : "draft"), error: opts.row?.error ?? null, connector_id: CONNECTOR, contact_id: CONTACT, thread_key: `contact:${TENANT}:${CONTACT}`, channel_type: "email",
          meta: opts.binding ? { comms_email_binding: opts.binding } : { scheduled_binding: { contact_id: CONTACT, connector_id: CONNECTOR } } }, error: null };
        if (table === "clients") return { data: { tenant_id: TENANT, emails: ["lead@example.test"] }, error: null };
        if (table === "channel_connectors") return { data: { tenant_id: TENANT, status: "active", active: opts.connectorActive ?? true, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider, from_address: opts.binding ? String(opts.binding.from_address) : "hello@someone-elses.example.test", from_name: "Spoof", reply_to: null, credentials_vault_ref: null, config: null }, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => result();
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push(name);
      rpcArgs.push({ name, args });
      if (opts.binding && name === "read_comms_email_send_binding") return { data: { ...opts.binding, message_id: MSG, eligible: true }, error: null };
      if (opts.binding && name === "claim_comms_email_send") return { data: opts.claim ?? { state: "dispatching", attempts: 1, admitted: true }, error: null };
      if (opts.binding && name === "finalize_comms_email_send") return { data: { ok: args._outcome === "provider_accepted", outcome: args._outcome }, error: null };
      if (name === "comms_provider_execution_allowed" || name === "has_role") return { data: true, error: null };
      if (name === "current_user_tenant_id") return { data: TENANT, error: null };
      if (name === "is_platform_owner") return { data: false, error: null };
      return { data: null, error: null };
    },
  };
  const fetchMock = (url: string, init?: { body?: string }) => {
    fetchCalls.push(url);
    fetchBodies.push(init?.body ? JSON.parse(init.body) : {});
    if (opts.answer === "throw") return Promise.reject(new TypeError("socket hang up"));
    if (typeof opts.answer === "number") return Promise.resolve(new Response("{\"errors\":[]}", { status: opts.answer }));
    return Promise.resolve(new Response(JSON.stringify({ id: "provider-id" }), { status: url.includes("sendgrid") ? 202 : 200, headers: { "X-Message-Id": "sg-id" } }));
  };
  const scope = { decideContentRead, commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED, PAIGE_APP_ORIGIN: "https://app.example.test",isPreparedAgreementMessage, tenantFrom, PLATFORM_FROM_DOMAIN,
    parseCommsEmailAttachmentManifest, readGovernedCommsEmailAttachments, COMMS_EMAIL_FILE_PROVIDERS,
    Deno: {
      env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE : k === "SENDGRID_MAIL_SEND_API_KEY" ? "SG.platform-key" : k === "RESEND_API_KEY" ? undefined : k === "SUPABASE_URL" ? "https://proj.example.test" : "configured" },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => client,
    registerOutboundAdapter: (a: { channel_type: string; send: (...x: unknown[]) => Promise<unknown> }) => { adapters[a.channel_type] = a; },
    getOutboundAdapter: (channel: string) => adapters[channel],
    buildListUnsubscribeHeaders: () => ({}),
    senderDisplayName,
    runPreSend: async () => ({ proceed: true, outcome: "proceed" }),
    CLIENT_CONTACT_METHODS_EMBED: "client_contact_methods",
    clientAddresses: (row: { emails?: string[] }) => ({ emails: row.emails ?? [], phones: [] }),
    readInvoiceDeliveryReadiness: async () => { throw new Error("invoice readiness reached"); },
    parseDeliveryBinding: () => { throw new Error("invoice binding parser reached"); },
    fetch: fetchMock,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (body: Record<string, unknown>) => {
    const res = await handler!(new Request("https://example.test/send-message", {
      method: "POST", headers: { Authorization: `Bearer ${opts.caller === "service" ? SERVICE : "user-jwt"}` },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { request, rpcCalls, rpcArgs, fetchCalls, fetchBodies, writes, downloads };
}

const generic = { channel: "email", to: "lead@example.test", contact_id: CONTACT, connector_id: CONNECTOR, subject: "Hi", body: "<p>Hi</p>" };

describe("send-message refuses PAIGE Email (SendGrid) outside the governed email door", () => {
  it("a workspace admin's generic send through a SendGrid connector → refused, zero provider calls", async () => {
    const s = setup({ caller: "user" });
    const r = await s.request(generic);
    expect(s.fetchCalls).toEqual([]);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ outcome: "refused", error: "paige_email_requires_governed_send" });
    expect(JSON.stringify(r.body)).not.toMatch(/sendgrid/i);
  });

  it("a service-role send that names no prepared comms_email operation → refused, zero provider calls", async () => {
    const s = setup({ caller: "service" });
    const r = await s.request({ ...generic, idempotency_key: "anything" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls).toEqual([]);
    expect(s.rpcCalls).not.toContain("claim_comms_email_send");
  });

  it("a scheduled release through a SendGrid connector is terminalized for review, never sent", async () => {
    const s = setup({ caller: "service", queued: true });
    const r = await s.request({ ...generic, message_id: MSG });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls).toEqual([]);
    expect(s.writes.some((w) => w.table === "messages" && w.mode === "update" && (w.values as { status?: string }).status === "failed")).toBe(true);
  });

  it("control: the identical generic request through a managed (\"resend\") connector is not refused, and goes through SendGrid", async () => {
    // Experience 03: Resend is never called. The H2 refusal is for a SendGrid CONNECTOR outside the door;
    // a managed sender is sent through SendGrid with its From decided by tenantFrom.
    const s = setup({ caller: "user", provider: "resend" });
    const r = await s.request(generic);
    expect(r.body.error).not.toBe("paige_email_requires_governed_send");
    expect(s.fetchCalls.length).toBe(1);
    expect(s.fetchCalls[0]).toBe("https://api.sendgrid.com/v3/mail/send");
    // H2: the connector names a domain this business never verified; SendGrid would accept it on the
    // shared account, so it is never the From. The email goes as notifications@ under the sender's name.
    expect(s.fetchBodies[0].from).toEqual({ email: "notifications@mail.paigeagent.ai", name: "Spoof" });
    expect(JSON.stringify(s.fetchBodies[0].from)).not.toContain("someone-elses");
  });
});

// Experience 03: SendGrid has no idempotent replay, so an ordinary email whose answer was lost (5xx, a
// thrown request) may already be in the client's inbox. send-message must say so — never a plain
// "failed" a caller or a person would resend — and its rows must not record a definitive failure.
describe("an ordinary SendGrid send whose answer could not be read", () => {
  const audit = (s: ReturnType<typeof setup>) => s.writes.find((w) => w.table === "paige_messages_audit")?.values as Record<string, unknown>;
  const messageWrites = (s: ReturnType<typeof setup>) => s.writes.filter((w) => w.table === "messages").map((w) => ({ mode: w.mode, ...(w.values as Record<string, unknown>) }));

  it.each([503, 500, "throw"] as const)("a direct send answered %s → outcome_unknown + unconfirmed; the thread records it as unconfirmed", async (answer) => {
    const s = setup({ caller: "user", provider: "resend", answer });
    const r = await s.request(generic);
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
    expect(r.body).toMatchObject({ status: "failed", outcome: "outcome_unknown", unconfirmed: true });
    expect(String(audit(s).error)).toMatch(/^delivery_unconfirmed: /);
    expect(messageWrites(s)).toEqual([expect.objectContaining({ mode: "insert", status: "failed", error: "delivery_unconfirmed", provider_message_id: null })]);
  });

  it("a scheduled release answered 503 → the released row is marked unconfirmed, not a plain failure", async () => {
    const s = setup({ caller: "service", provider: "resend", queued: true, answer: 503 });
    const r = await s.request({ ...generic, message_id: MSG });
    expect(r.body).toMatchObject({ outcome: "outcome_unknown", unconfirmed: true });
    expect(messageWrites(s)).toEqual([expect.objectContaining({ mode: "update", status: "failed", error: "delivery_unconfirmed" })]);
  });

  it("a definitive 4xx stays a plain failure: no unconfirmed marker, no thread row (unchanged)", async () => {
    const s = setup({ caller: "user", provider: "resend", answer: 400 });
    const r = await s.request(generic);
    expect(r.body).toMatchObject({ status: "failed", outcome: "failed" });
    expect(r.body).not.toHaveProperty("unconfirmed");
    expect(String(audit(s).error)).toMatch(/^sendgrid_400/);
    expect(messageWrites(s)).toEqual([]);
  });

  it("Gmail keeps its own answer (unchanged): a Gmail failure is never marked unconfirmed by this rule", async () => {
    const s = setup({ caller: "user", provider: "gmail", answer: 503 });
    const r = await s.request(generic);
    expect(r.body).not.toHaveProperty("unconfirmed");
    expect(r.body.outcome).not.toBe("outcome_unknown");
  });

  it("a second send of a row already marked unconfirmed is refused with no provider call (SendGrid has no replay)", async () => {
    const s = setup({ caller: "user", provider: "resend", row: { status: "failed", error: "delivery_unconfirmed" } });
    const r = await s.request({ ...generic, message_id: MSG });
    expect(s.fetchCalls).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "failed", outcome: "outcome_unknown", unconfirmed: true, error: "delivery_unconfirmed", message_id: MSG });
    expect(s.writes.filter((w) => w.table === "messages")).toEqual([]);
  });

  it("a row with a plain definitive failure may still be sent again (unchanged)", async () => {
    const s = setup({ caller: "user", provider: "resend", row: { status: "failed", error: "sendgrid_400: bad recipient" } });
    await s.request({ ...generic, message_id: MSG });
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
  });
});

// "Approve now, send later": a scheduled governed email waits as a 'queued' row and is released only
// by the drainer's flagged request once due; every refusal is finalized, never written directly.
describe("send-message — a scheduled governed email", () => {
  const OP = "88888888-8888-4888-8888-8888888888bb";
  const due = new Date(Math.floor((Date.now() - 60_000) / 60_000) * 60_000).toISOString();
  const later = new Date(Math.floor((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString();
  const bound = (over: Record<string, unknown> = {}) => ({ operation_id: OP, tenant_id: TENANT, actor_user_id: ACTOR, contact_id: CONTACT, connector_id: CONNECTOR,
    recipient: "lead@example.test", from_address: "hello@own.example.test", provider: "sendgrid", subject: "Hi", body_html: "<p>Hi</p>", state: "prepared", send_at: due, ...over });
  const release = { ...generic, message_id: MSG, comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}`, comms_email_scheduled_release: true };
  const finalizes = (s: ReturnType<typeof setup>) => s.rpcArgs.filter((c) => c.name === "finalize_comms_email_send").map((c) => c.args);
  const directMessageWrites = (s: ReturnType<typeof setup>) => s.writes.filter((w) => w.table === "messages");

  it("the drainer's flagged release of a due, queued row is claimed and sent exactly once", async () => {
    const s = setup({ caller: "service", queued: true, binding: bound() });
    const r = await s.request(release);
    expect(s.rpcCalls).toContain("claim_comms_email_send");
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(finalizes(s)).toEqual([expect.objectContaining({ _outcome: "provider_accepted", _claimed_attempt: 1 })]);
    expect(directMessageWrites(s)).toEqual([]);
  });
  it("a scheduled binding released WITHOUT the flag is refused before any claim, and nothing is finalized", async () => {
    const s = setup({ caller: "service", queued: true, binding: bound() });
    const { comms_email_scheduled_release: _flag, ...unflagged } = release;
    const r = await s.request(unflagged);
    expect(r).toMatchObject({ status: 409, body: { outcome: "outcome_unknown", code: "COMMS_EMAIL_SCHEDULED_RELEASE_REQUIRED" } });
    expect(s.rpcCalls).not.toContain("claim_comms_email_send");
    expect(finalizes(s)).toEqual([]); expect(s.fetchCalls).toEqual([]); expect(directMessageWrites(s)).toEqual([]);
  });
  it("the flag on an immediate binding is refused (an immediate send is never a release)", async () => {
    const s = setup({ caller: "service", binding: bound({ send_at: undefined }) });
    const r = await s.request(release);
    expect(r).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_NOT_SCHEDULED" } });
    expect(s.rpcCalls).not.toContain("claim_comms_email_send"); expect(s.fetchCalls).toEqual([]); expect(finalizes(s)).toEqual([]);
  });
  it("before its time: not yet due, no claim, nothing written (and the claim's own clock is honoured too)", async () => {
    const early = setup({ caller: "service", queued: true, binding: bound({ send_at: later }) });
    expect(await early.request(release)).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_NOT_YET_DUE" } });
    expect(early.rpcCalls).not.toContain("claim_comms_email_send"); expect(finalizes(early)).toEqual([]);
    const dbClock = setup({ caller: "service", queued: true, binding: bound(), claim: { state: "prepared", attempts: 0, admitted: false, not_before: due } });
    expect(await dbClock.request(release)).toMatchObject({ status: 409, body: { code: "COMMS_EMAIL_NOT_YET_DUE" } });
    expect(dbClock.fetchCalls).toEqual([]); expect(finalizes(dbClock)).toEqual([]);
  });
  it("a queued governed row whose sender is no longer active is FINALIZED refused — never terminalized by a direct write", async () => {
    const s = setup({ caller: "service", queued: true, binding: bound(), connectorActive: false });
    await s.request(release);
    expect(finalizes(s)).toEqual([expect.objectContaining({ _outcome: "refused", _reason: "scheduled_connector_unavailable", _claimed_attempt: null })]);
    expect(directMessageWrites(s)).toEqual([]);
    expect(s.fetchCalls).toEqual([]);
  });
  it("only the service role may release, and the flag is `true` or absent, never a reconcile", async () => {
    const user = setup({ caller: "user", queued: true, binding: bound() });
    expect(await user.request(release)).toMatchObject({ status: 403, body: { error: "comms_email_binding_required" } });
    for (const bad of [{ comms_email_scheduled_release: false }, { comms_email_scheduled_release: "yes" }, { comms_email_reconcile: true }]) {
      const s = setup({ caller: "service", queued: true, binding: bound() });
      expect(await s.request({ ...release, ...bad }), JSON.stringify(bad)).toMatchObject({ status: 400, body: { error: "comms_email_send_shape_invalid" } });
      expect(s.fetchCalls).toEqual([]);
    }
  });
  it("an immediate governed send is unchanged: a draft row with no send_at is claimed and sent", async () => {
    const s = setup({ caller: "service", binding: bound({ send_at: undefined }) });
    const { comms_email_scheduled_release: _flag, ...immediate } = release;
    const r = await s.request(immediate);
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
  });
});

// INT-328 files: send-message sends ONLY the binding's governed copies, re-read and re-hashed before the
// claim. A copy missing or changed is an unclaimed prepared -> refused close: no claim, no provider call.
describe("send-message — the files a governed email carries", () => {
  const OP = "88888888-8888-4888-8888-8888888888cc";
  const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const gov = (n: number, name: string, tenant = TENANT, op = OP) => `${tenant}/governed/${op}/${n}-${name}`;
  const manifest = async () => [
    { path: gov(1, "proposal.pdf"), source_path: `${TENANT}/90000000-0000-4000-8000-000000000001-proposal.pdf`, name: "proposal.pdf", mime: "application/pdf", size: PDF.length, sha256: await sha(PDF) },
    { path: gov(2, "photo.png"), source_path: `${TENANT}/90000000-0000-4000-8000-000000000002-photo.png`, name: "photo.png", mime: "image/png", size: PNG.length, sha256: await sha(PNG) },
  ];
  const stored = () => ({ [gov(1, "proposal.pdf")]: { bytes: PDF, type: "application/pdf" }, [gov(2, "photo.png")]: { bytes: PNG, type: "image/png" } });
  const bound = async (over: Record<string, unknown> = {}) => ({ operation_id: OP, tenant_id: TENANT, actor_user_id: ACTOR, contact_id: CONTACT, connector_id: CONNECTOR,
    recipient: "lead@example.test", from_address: "hello@own.example.test", provider: "sendgrid", subject: "Hi", body_html: "<p>Hi</p>", state: "prepared",
    attachments: await manifest(), ...over });
  const send = { ...generic, message_id: MSG, comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}` };
  const finalizes = (s: ReturnType<typeof setup>) => s.rpcArgs.filter((c) => c.name === "finalize_comms_email_send").map((c) => c.args);

  it("verified copies go to SendGrid as exactly these base64 attachments, after the claim", async () => {
    const s = setup({ caller: "service", binding: await bound(), objects: stored() });
    const r = await s.request(send);
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(s.downloads).toEqual([`comms-attachments:${gov(1, "proposal.pdf")}`, `comms-attachments:${gov(2, "photo.png")}`]);
    expect(s.fetchCalls).toEqual(["https://api.sendgrid.com/v3/mail/send"]);
    expect(s.fetchBodies[0].attachments).toEqual([
      { content: Buffer.from(PDF).toString("base64"), filename: "proposal.pdf", type: "application/pdf", disposition: "attachment" },
      { content: Buffer.from(PNG).toString("base64"), filename: "photo.png", type: "image/png", disposition: "attachment" },
    ]);
    expect(s.rpcCalls.indexOf("claim_comms_email_send")).toBeGreaterThan(-1);
  });
  it("a copy changed or missing since approval: refused (finalized from prepared), no claim, zero SendGrid calls", async () => {
    for (const objects of [{ ...stored(), [gov(2, "photo.png")]: { bytes: new Uint8Array([...PNG, 0]), type: "image/png" } }, { [gov(1, "proposal.pdf")]: { bytes: PDF, type: "application/pdf" } }]) {
      const s = setup({ caller: "service", binding: await bound(), objects });
      const r = await s.request(send);
      expect(r.body).toMatchObject({ ok: false, outcome: "refused", reason: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
      expect(finalizes(s)).toEqual([expect.objectContaining({ _outcome: "refused", _reason: "comms_email_attachment_changed", _claimed_attempt: null })]);
      expect(s.rpcCalls).not.toContain("claim_comms_email_send");
      expect(s.fetchCalls).toEqual([]);
    }
  });
  it("a binding naming another business's or another operation's object is refused with ZERO downloads", async () => {
    const other = "99999999-9999-4999-8999-9999999999bb";
    for (const path of [gov(1, "proposal.pdf", "44444444-4444-4444-8444-444444444400"), gov(1, "proposal.pdf", TENANT, "88888888-8888-4888-8888-8888888888dd"), `${TENANT}/${other}-proposal.pdf`, `${TENANT}/team-hub/x/1-proposal.pdf`]) {
      const m = await manifest();
      const s = setup({ caller: "service", binding: await bound({ attachments: [{ ...m[0], path }] }), objects: { [path]: { bytes: PDF, type: "application/pdf" } } });
      const r = await s.request(send);
      expect(r.body, path).toMatchObject({ outcome: "refused", reason: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
      expect(s.downloads).toEqual([]);
      expect(s.fetchCalls).toEqual([]);
      expect(s.rpcCalls).not.toContain("claim_comms_email_send");
    }
  });
  it("a Gmail (or SMTP) binding with files is refused before any read, claim or provider call", async () => {
    for (const provider of ["gmail", "smtp"]) {
      const s = setup({ caller: "service", provider, binding: await bound({ provider }), objects: stored() });
      const r = await s.request(send);
      expect(r.body, provider).toMatchObject({ outcome: "refused", reason: "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED" });
      expect(s.downloads).toEqual([]); expect(s.fetchCalls).toEqual([]);
      expect(s.rpcCalls).not.toContain("claim_comms_email_send");
    }
  });
  it("files never ride the request: a governed send naming body.attachments is still refused", async () => {
    const s = setup({ caller: "service", binding: await bound(), objects: stored() });
    const r = await s.request({ ...send, attachments: [{ url: gov(1, "proposal.pdf") }] });
    expect(r).toMatchObject({ status: 400, body: { error: "comms_email_send_shape_invalid" } });
    expect(s.downloads).toEqual([]); expect(s.fetchCalls).toEqual([]);
  });
  it("a governed send without files reads nothing and sends no attachments (unchanged)", async () => {
    const s = setup({ caller: "service", binding: await bound({ attachments: undefined }) });
    const r = await s.request(send);
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(s.downloads).toEqual([]);
    expect(s.fetchBodies[0]).not.toHaveProperty("attachments");
  });
  it("a scheduled release with files re-checks them the same way", async () => {
    const due = new Date(Math.floor((Date.now() - 60_000) / 60_000) * 60_000).toISOString();
    const ok = setup({ caller: "service", queued: true, binding: await bound({ send_at: due }), objects: stored() });
    expect((await ok.request({ ...send, comms_email_scheduled_release: true })).body).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect((ok.fetchBodies[0].attachments as unknown[]).length).toBe(2);
    const gone = setup({ caller: "service", queued: true, binding: await bound({ send_at: due }), objects: {} });
    expect((await gone.request({ ...send, comms_email_scheduled_release: true })).body).toMatchObject({ outcome: "refused", reason: "COMMS_EMAIL_ATTACHMENT_CHANGED" });
    expect(gone.fetchCalls).toEqual([]);
  });
});
