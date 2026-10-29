import { decideContentRead } from "../inbox-intelligence/policy.ts";
// Experience 03 · S3 — the SendGrid arm of the REAL send-message handler on the governed
// comms_email path (PAIGE Email). Same technique as send-message.test.ts: the handler source is
// transpiled and executed with only its imports and the network substituted. `fetch` is a stub:
// no HTTP request leaves this process and no provider is called.
//
// Proves: a SendGrid binding is admitted; the request carries custom_args (tenant, operation, message)
// for receipt correlation, the platform Mail Send credential (never echoed), and an abort signal; a
// 202 with X-Message-Id is provider_accepted (never delivery); a 202 without it, a timeout or a network
// throw stay UNKNOWN; a definitive 4xx is failed; an ineligible binding never reaches the provider.
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../comms-provider-boundary.ts";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { senderDisplayName } from "../email/sender-display-name.ts";
import { tenantFrom, PLATFORM_FROM_DOMAIN } from "../email/platform-sendgrid.ts";
import { createHash } from "node:crypto";
import { capturePreparedSignatureMessage,isPreparedAgreementMessage,prepareSignatureMessage,assertPreparedSignatureSenderEnvelope } from "../agreements/prepared-signature-message.ts";
import { PREPARED_SIGNING_LINK_MARKER } from "../agreements/prepared-signature-review-contract.ts";

const OP = "22222222-2222-4222-8222-2222222222aa";
const MSG = "33333333-3333-4333-8333-3333333333aa";
const TENANT = "44444444-4444-4444-8444-4444444444aa";
const CONTACT = "55555555-5555-4555-8555-5555555555aa";
const CONNECTOR = "66666666-6666-4666-8666-6666666666aa";
const ACTOR = "77777777-7777-4777-8777-7777777777aa";
const SG_KEY = "SG.mail-send-secret-do-not-leak";
const SG_ID = "sg-x-message-id-123";

const binding = {
  operation_id: OP, tenant_id: TENANT, actor_user_id: ACTOR, contact_id: CONTACT,
  recipient: "lead@example.test", connector_id: CONNECTOR, from_address: "hello@own.example.test",
  provider: "sendgrid", subject: "Thanks for reaching out", body_text: "Hi", body_html: "<p>Hi</p>",
  content_digest: "c".repeat(64), state: "prepared", attempts: 0,
};

const raw = readFileSync("supabase/functions/send-message/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Mode = "accepted" | "accepted_no_id" | "reject400" | "status500" | "throw" | "hang";
type AgreementCase = { omitToken?:boolean; wrongToken?:boolean; expired?:boolean; missingSource?:boolean; receiptError?:boolean;
  wrongScope?:boolean; witness?:boolean; changedName?:boolean; changedReply?:boolean; withdrawAfterClaim?:boolean;
  managed?:boolean; managedInvalid?:'fallback'|'foreign'|'address'|'unreadable'; managedWithdrawAfterClaim?:boolean;
  connectorProvider?:'gmail'|'smtp' };
const TOKEN='1a'.repeat(32),TOKEN_HASH=createHash('sha256').update(TOKEN).digest('hex');
const PARENT='88888888-8888-4888-8888-888888888801',WORK='99999999-9999-4999-8999-999999999999';
const AGREEMENT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SIGNER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PREPARATION='cccccccc-cccc-4ccc-8ccc-cccccccccccc',EVENT='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function setup(opts: { fetch?: Mode; eligible?: boolean; key?: boolean; agreement?:AgreementCase } = {}) {
  const a=opts.agreement;
  const governance={actor_user_id:ACTOR,tenant_id:TENANT,tool:'agreement_send',action:'agreement.send',approval_channel:'chat-canonical',
    decision_receipt_recorded:true,approved_fingerprint:'a'.repeat(16),purpose:'agreement_signature_request',agreement_work_id:WORK,
    agreement_operation_id:PARENT,agreement_request_sha256:'f'.repeat(64),signer_id:SIGNER,operation_id:OP};
  const approvedBody='Please review the agreement.\n\n'+PREPARED_SIGNING_LINK_MARKER;
  const b = { ...binding,...(a?{body_text:approvedBody,body_html:'<p>'+approvedBody+'</p>',governance}: {}),
    ...(a?.managed?{provider:'resend',from_address:'controlled-studio@mail.paigeagent.ai'}:{}),
    ...(a?.connectorProvider?{provider:a.connectorProvider}:{}) };
  const expiry=a?.expired?'2000-01-01T00:00:00Z':new Date(Date.now()+3_600_000).toISOString();
  const source={kind:'prepared_agreement_message_source',source_only:true,tenant_id:TENANT,actor_id:a?.wrongScope?PARENT:ACTOR,
    work_id:WORK,agreement_id:AGREEMENT,client_id:CONTACT,preparation_id:PREPARATION,preparation_sha256:'e'.repeat(64),document_sha256:'d'.repeat(64),
    operation_id:OP,agreement_operation_id:PARENT,request_sha256:'f'.repeat(64),credential_event_id:EVENT,
    credential_commitment:createHash('sha256').update(TOKEN_HASH).digest('hex'),credential_expires_at:expiry,recipient_ids:[SIGNER],
    signer:{id:SIGNER,email:b.recipient},message:{signer_id:SIGNER,to:b.recipient,subject:b.subject,body_text:b.body_text,body_html:b.body_html},
    sender:{connector_id:CONNECTOR,provider:'sendgrid',from_address:b.from_address,from_name:'Own Co',reply_to:null}};
  const db = { state: "prepared", attempts: 0 };
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const adapters: Record<string, { send: (...a: unknown[]) => Promise<unknown> }> = {};
  const writes:unknown[]=[];
  let handler: (req: Request) => Promise<Response>;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: ACTOR } } }) },
    from: (table: string) => {
      let mode = "select";
      const q: Record<string, (...args: unknown[]) => unknown> = {};
      for (const m of ["eq", "is", "in", "not", "neq", "order", "select"]) q[m] = () => q;
      for (const m of ["insert", "upsert", "update"]) q[m] = (values:unknown) => { mode = m;writes.push({table,mode:m,values});return q; };
      const result = () => {
        if (mode !== "select") return { data: { id: table === "messages" ? MSG : "row-id" }, error: null };
        if (table === "messages") return { data: { tenant_id: TENANT, status: "draft", connector_id: CONNECTOR, contact_id: CONTACT, thread_key: `contact:${TENANT}:${CONTACT}`, channel_type: "email", meta: { source: "comms-email-command", comms_email_binding: b } }, error: null };
        if (table === "clients") return { data: { tenant_id: TENANT, emails: a?.witness?[]:["Lead@Example.test"] }, error: null };
        if (table === "channel_connectors") return { data: { id:CONNECTOR,tenant_id: TENANT, status: "active", active: true, channel_type: "email", mailbox_class: "shared_support", mailbox_owner_user_id: null, provider: b.provider, from_address: b.from_address, from_name: a?.changedName?'Changed sender':"Own Co", reply_to: a?.changedReply?'changed@own.example.test':null, credentials_vault_ref: null, config: null }, error: null };
        if (table === "tenant_email_domains"&&a)return {data:{tenant_id:TENANT,domain:'own.example.test',sendgrid_status:'verified',sendgrid_domain_id:'synthetic-domain',sendgrid_verified_at:'2026-01-01T00:00:00Z'},error:null};
        return { data: null, error: null };
      };
      q.maybeSingle = async () => result();
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "comms_provider_execution_allowed") return { data: true, error: null };
      if (name === "read_comms_email_send_binding") return { data: { ...b,...(a?{state:db.state,attempts:db.attempts,...(a.missingSource?{}:{agreement_source:source})}:{}),message_id: MSG, tenant_id: TENANT, channel_type: "email", message_status: "draft", eligible: a?.withdrawAfterClaim&&db.state==='dispatching'?false:opts.eligible ?? true }, error: null };
      if (name === "tenant_sender_identity"&&a)return {data:{from_name:'Own Co',from_address:b.from_address,reply_to:null,tenant_name:'Own Co'},error:null};
      if (name === "resolve_tenant_sender"&&a?.managed){
        expect(args).toEqual({_tenant_id:TENANT});
        return {data:{tenant_id:a.managedInvalid==='foreign'?CONTACT:TENANT,
          kind:a.managedInvalid==='fallback'?'platform':'shared',source:a.managedInvalid==='fallback'?'platform_default':'shared',
          from_address:a.managedInvalid==='address'||a.managedWithdrawAfterClaim&&db.state==='dispatching'?'different@mail.paigeagent.ai':b.from_address},
          error:a.managedInvalid==='unreadable'?{code:'unavailable'}:null};
      }
      if (name === "_read_prepared_agreement_credentials"&&a)return {data:a.receiptError?null:{kind:'prepared_agreement_credentials',state:'recorded',tenant_id:TENANT,actor_id:ACTOR,
        operation_id:PARENT,agreement_id:AGREEMENT,preparation_id:PREPARATION,request_sha256:'f'.repeat(64),preparation_sha256:'e'.repeat(64),document_sha256:'d'.repeat(64),work_id:WORK,event_id:EVENT,
        credentials:[{signer_id:SIGNER,token_hash:TOKEN_HASH,expires_at:expiry}]},error:a.receiptError?{code:'unavailable'}:null};
      if (name === "claim_comms_email_send") { db.state = "dispatching"; db.attempts = 1; return { data: { state: "dispatching", attempts: 1, admitted: true }, error: null }; }
      if (name === "finalize_comms_email_send") {
        const attempt = args._claimed_attempt ?? null;
        const allowed = (db.state === "prepared" && attempt === null && (args._outcome === "failed" || args._outcome === "refused"))
          || (db.state === "dispatching" && args._outcome !== "refused" && attempt === db.attempts);
        if (!allowed) return { data: null, error: { code: "42501", message: "COMMS_EMAIL_NOT_CLAIMED" } };
        db.state = args._outcome as string;
        return { data: { ok: args._outcome === "provider_accepted", outcome: args._outcome, message_id: MSG }, error: null };
      }
      if (name === "current_user_tenant_id") return { data: TENANT, error: null };
      return { data: null, error: null };
    },
  };
  const fetchMock = (url: string, init: RequestInit = {}) => {
    fetchCalls.push({ url, init });
    const mode = opts.fetch ?? "accepted";
    if (mode === "accepted") return Promise.resolve(new Response(null, { status: 202, headers: { "X-Message-Id": SG_ID } }));
    if (mode === "accepted_no_id") return Promise.resolve(new Response(null, { status: 202 }));
    if (mode === "reject400") return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: "The from address does not match a verified Sender Identity" }] }), { status: 400 }));
    if (mode === "status500") return Promise.resolve(new Response("oops", { status: 500 }));
    if (mode === "throw") return Promise.reject(new TypeError(`network down near ${SG_KEY}`));
    return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  };
  const scope = { decideContentRead, commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED, PAIGE_APP_ORIGIN: "https://app.example.test",
    capturePreparedSignatureMessage,isPreparedAgreementMessage,prepareSignatureMessage,assertPreparedSignatureSenderEnvelope,
    Deno: {
      env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? "internal" : k === "SENDGRID_MAIL_SEND_API_KEY" ? (opts.key === false ? undefined : SG_KEY) : k === "RESEND_API_KEY" ? undefined : k === "SUPABASE_URL" ? "https://proj.example.test" : "configured" },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => admin,
    registerOutboundAdapter: (a: { channel_type: string; send: (...x: unknown[]) => Promise<unknown> }) => { adapters[a.channel_type] = a; },
    getOutboundAdapter: (channel: string) => adapters[channel],
    buildListUnsubscribeHeaders: () => ({}),
    senderDisplayName, tenantFrom, PLATFORM_FROM_DOMAIN,
    runPreSend: async () => ({ proceed: true, outcome: "proceed" }),
    CLIENT_CONTACT_METHODS_EMBED: "client_contact_methods",
    clientAddresses: (row: { emails?: string[] }) => ({ emails: row.emails ?? [], phones: [] }),
    readInvoiceDeliveryReadiness: async () => { throw new Error("invoice readiness reached on comms path"); },
    parseDeliveryBinding: () => { throw new Error("invoice binding parser reached on comms path"); },
    fetch: fetchMock,
    // The comms deadline fires at once for "hang", so the race resolves without waiting 20 s.
    setTimeout: (fn: () => void, ms: number) => { if (opts.fetch === "hang" && ms === 20_000) queueMicrotask(fn); return 1; },
    clearTimeout: () => {},
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async () => {
    const res = await handler!(new Request("https://example.test/send-message", {
      method: "POST", headers: { Authorization: "Bearer internal" },
      body: JSON.stringify({ channel: "email", to: b.recipient, contact_id: CONTACT, connector_id: CONNECTOR, message_id: MSG,
        subject: b.subject, body: b.body_html, comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}`,
        ...(a&&!a.omitToken?{agreement_signature_token:a.wrongToken?'2b'.repeat(32):TOKEN}:{}) }),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const finalizeCalls = () => rpcCalls.filter((c) => c.name === "finalize_comms_email_send").map((c) => c.args);
  return { request, rpcCalls, fetchCalls, finalizeCalls,writes };
}

describe("send-message SendGrid arm on the governed comms_email path", () => {
  it("202 + X-Message-Id → provider_accepted; custom_args, abort signal and the Mail Send key on the request", async () => {
    const s = setup();
    const r = await s.request();
    expect(r.body).toMatchObject({ ok: true, outcome: "provider_accepted", delivery_confirmed: false });
    expect(s.fetchCalls).toHaveLength(1);
    const call = s.fetchCalls[0];
    expect(call.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SG_KEY}`);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(call.init.body));
    expect(payload.custom_args).toEqual({ paige_tenant_id: TENANT, paige_operation_id: OP, paige_message_id: MSG });
    // A SendGrid connector's From is bound to a domain THIS business verified (H2), so it is sent as is,
    // and no idempotency header is relied on: SendGrid has no idempotent replay.
    expect(payload.from).toEqual({ email: "hello@own.example.test", name: "Own Co" });
    expect(payload.reply_to).toBeUndefined();
    expect(Object.keys(call.init.headers as Record<string, string>).filter((h) => /idempotency/i.test(h))).toEqual([]);
    expect(payload.personalizations).toEqual([{ to: [{ email: "lead@example.test" }] }]);
    expect(s.finalizeCalls()).toEqual([{ _message_id: MSG, _operation_id: OP, _outcome: "provider_accepted", _provider_message_id: SG_ID, _reason: null, _claimed_attempt: 1 }]);
    expect(JSON.stringify(r.body)).not.toContain(SG_KEY);
    expect(JSON.stringify(r.body)).not.toContain(SG_ID);
  });

  it.each([
    ["202 without X-Message-Id", "accepted_no_id", "unknown"],
    ["5xx", "status500", "unknown"],
    ["network throw", "throw", "unknown"],
    ["deadline / abort", "hang", "unknown"],
    ["definitive 400 rejection", "reject400", "failed"],
  ] as const)("%s → %s (never accepted, never delivered)", async (_label, mode, outcome) => {
    const s = setup({ fetch: mode });
    const r = await s.request();
    expect(s.finalizeCalls().map((c) => c._outcome)).toEqual([outcome]);
    expect(r.body.ok).not.toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(SG_KEY);
  });

  it("an ineligible SendGrid binding (verification lapsed) never reaches the provider", async () => {
    const s = setup({ eligible: false });
    await s.request();
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.rpcCalls.map((c) => c.name)).not.toContain("claim_comms_email_send");
  });

  it("a missing platform Mail Send credential fails before any claim or provider call", async () => {
    const s = setup({ key: false });
    await s.request();
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.finalizeCalls().map((c) => [c._outcome, c._claimed_attempt])).toEqual([["failed", null]]);
  });
});

describe('original governed sender for an approved agreement signing request',()=>{
  it('dispatches a selected recorded managed alias through the SAME SendGrid adapter and original claim only',async()=>{
    const s=setup({agreement:{managed:true}}),r=await s.request();
    expect(r.body).toMatchObject({outcome:'provider_accepted',delivery_confirmed:false});
    expect(s.fetchCalls).toHaveLength(1);
    const call=s.fetchCalls[0],payload=JSON.parse(String(call.init.body));
    expect(call.url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(payload.from.email).toBe('controlled-studio@mail.paigeagent.ai');
    expect(JSON.stringify(payload)).toContain('/sign/'+TOKEN);
    expect(s.rpcCalls.filter(c=>c.name==='claim_comms_email_send')).toHaveLength(1);
    expect(JSON.stringify(s.writes)+JSON.stringify(r)).not.toContain(TOKEN);
  });
  it.each(['fallback','foreign','address','unreadable'] as const)('refuses managed identity %s before original claim and provider',async managedInvalid=>{
    const s=setup({agreement:{managed:true,managedInvalid}});await s.request();
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.rpcCalls.some(c=>c.name==='claim_comms_email_send')).toBe(false);
  });
  it('rechecks the recorded managed alias after the winning claim without making another provider attempt',async()=>{
    const s=setup({agreement:{managed:true,managedWithdrawAfterClaim:true}});await s.request();
    expect(s.rpcCalls.filter(c=>c.name==='claim_comms_email_send')).toHaveLength(1);
    expect(s.fetchCalls).toHaveLength(0);
  });
  it.each(['gmail','smtp'] as const)('cannot retarget an approved SendGrid request to %s',async connectorProvider=>{
    const s=setup({agreement:{connectorProvider}});await s.request();
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.rpcCalls.some(c=>c.name==='claim_comms_email_send')).toBe(false);
  });
  it('managed-alias uncertainty stays unknown without leaking the link or claiming delivery',async()=>{
    const s=setup({agreement:{managed:true},fetch:'status500'}),r=await s.request();
    expect(r.body).toMatchObject({outcome:'unknown',delivery_confirmed:false});
    expect(s.fetchCalls).toHaveLength(1);
    expect(JSON.stringify(s.writes)+JSON.stringify(r)).not.toContain(TOKEN);
  });
  it('managed-alias signing cannot fall back when the actual SendGrid key is missing',async()=>{
    const s=setup({agreement:{managed:true},key:false});await s.request();
    expect(s.fetchCalls).toHaveLength(0);
    expect(s.rpcCalls.some(c=>c.name==='claim_comms_email_send')).toBe(false);
  });
  it('uses the exact original credential in provider RAM only; drafts/audit/history and responses retain no working link',async()=>{
    const s=setup({agreement:{}}),r=await s.request();
    expect(r.body.outcome).toBe('provider_accepted');expect(s.fetchCalls).toHaveLength(1);
    const payload=JSON.parse(String(s.fetchCalls[0].init.body));
    expect(JSON.stringify(payload)).toContain('/sign/'+TOKEN);expect(JSON.stringify(payload)).not.toContain(PREPARED_SIGNING_LINK_MARKER);
    expect(payload.content.map((part:{type:string})=>part.type)).toEqual(['text/plain','text/html']);
    expect(payload.content[0].value).toContain('/sign/'+TOKEN);
    expect(JSON.stringify(s.writes)).not.toContain(TOKEN);expect(JSON.stringify(s.writes)).not.toContain(TOKEN_HASH);
    expect(JSON.stringify(r)).not.toContain(TOKEN);expect(s.rpcCalls.filter(c=>c.name==='_read_prepared_agreement_credentials')).toHaveLength(1);
  });
  it.each([
    ['missing credential',{omitToken:true}],['different credential',{wrongToken:true}],['expired original credential',{expired:true}],
    ['missing native source',{missingSource:true}],['unverified native credential record',{receiptError:true}],
    ['different original actor',{wrongScope:true}],['changed approved sender name',{changedName:true}],['changed approved reply address',{changedReply:true}],
  ] as const)('%s refuses BEFORE any claim/provider',async(_label,a)=>{
    const s=setup({agreement:a});await s.request();expect(s.fetchCalls).toHaveLength(0);
    expect(s.rpcCalls.some(c=>c.name==='claim_comms_email_send')).toBe(false);
  });
  it('revalidates the original native source after its winning claim and never dispatches a withdrawn request',async()=>{
    const s=setup({agreement:{withdrawAfterClaim:true}});await s.request();
    expect(s.rpcCalls.some(c=>c.name==='claim_comms_email_send')).toBe(true);expect(s.fetchCalls).toHaveLength(0);
  });
  it('accepts the original approved signer without manufacturing a CRM email contact',async()=>{
    const s=setup({agreement:{witness:true}});const r=await s.request();expect(r.body.outcome).toBe('provider_accepted');expect(s.fetchCalls).toHaveLength(1);
  });
  it('a provider uncertainty remains unknown and never claims delivery/signing/payment',async()=>{
    const s=setup({agreement:{},fetch:'status500'}),r=await s.request();expect(r.body.outcome).toBe('unknown');
    expect(r.body.delivery_confirmed).toBe(false);expect(s.fetchCalls).toHaveLength(1);expect(JSON.stringify(s.writes)).not.toContain(TOKEN);
  });
});
