import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, expect, it } from "vitest";
import { decideDeclaredCapability } from "../../../supabase/functions/_shared/capability-kit/decision";
import { SALES_INVOICE_KIT_BY_ACTION } from "../../../supabase/functions/_shared/paige-spine/domains/sales_invoice";
import { FINGERPRINT, UUID, SALES_INVOICE_ACTIONS, parseSalesInvoiceCommand } from "../../../supabase/functions/_shared/sales-invoice-command/contract";
import { manualAllocationReviewMatches } from "../../../supabase/functions/_shared/sales-invoice-command/manual-allocation";
import { PAIGE_APP_ORIGIN } from "../../../supabase/functions/_shared/canonical-app-url";
import { invoicePublicOriginReady } from "../../../supabase/functions/_shared/sales-invoice-delivery/binding";
import {readProviderDispositionReview,providerDispositionReviewsEqual,providerDispositionResultMatches} from '../../../supabase/functions/_shared/sales-invoice-command/provider-disposition';

const tenant = "10000000-0000-4000-8000-000000000001";
const operation = "20000000-0000-4000-8000-000000000001";
const command = { action: "invoice.record_manual_payment", invoice_id: "30000000-0000-4000-8000-000000000001", expected_version: 2, amount_cents: 1000, currency: "usd", method: "cash", received_at: "2026-10-03T12:00:00.000Z" };
const source = readFileSync("supabase/functions/sales-invoice-command/index.ts", "utf8").replace(/^import .*;\r?\n/gm, "");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

type Setup = { role?: string; currentTenant?: string; replay?: unknown; auditFails?: boolean; claimed?: unknown; pendingCycle?: unknown; executeError?: unknown; executeResult?:unknown; authenticated?: boolean; deliveryResult?: unknown; publicOrigin?: string; readiness?:boolean; preview?:unknown; };
function setup(options: Setup = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const claims: Record<string, unknown>[][] = [];
  let handler: (request: Request) => Promise<Response>;
  const caller = { auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: "owner" } }, error: null }) }, rpc: async (name: string) => ({ data: name === "current_user_tenant_id" ? options.currentTenant ?? tenant : "auto", error: null }) };
  const admin = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "read_sales_invoice_command_result" || name === "read_sales_invoice_delivery_result") return { data: options.replay ?? null, error: null };
      if (name === "preview_sales_invoice_command" || name === "preview_sales_invoice_delivery_command") return { data: options.preview??{ eligible: true, summary: "Review the exact commercial action" }, error: null };
      return { data: options.executeResult??{ ok: true, row: { status: "issued", outstanding_cents: 9000 } }, error: options.executeError ?? null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown>[] = [];
      let mutation = "";
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "is", "not", "neq", "gt", "lte", "contains", "order", "limit"]) builder[method] = (...args: unknown[]) => { filters.push({ method, args }); return builder; };
      builder.select = () => builder;
      builder.update = () => { mutation = "update"; return builder; };
      builder.insert = (args: unknown) => {
        calls.push({ name: `insert:${table}`, args });
        mutation = "insert";
        return builder;
      };
      builder.maybeSingle = async () => {
        if (table === "tenant_members") return { data: { role: options.role ?? "owner", status: "active" }, error: null };
        if (mutation === "update") { claims.push(filters); return { data: options.claimed ? { args: options.claimed } : null, error: null }; }
        if (table === "paige_pending_confirmations" && !mutation) { calls.push({ name: "pending-cycle", args: filters }); return { data: options.pendingCycle ? { args: options.pendingCycle } : null, error: null }; }
        return { data: { summary: "Review payment", expires_at: "2026-10-03T13:00:00Z" }, error: null };
      };
      builder.then = (resolve: (value: {error: {code:string}|null}) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ error: table === "paige_audit_log" && options.auditFails ? { code: "failure" } : null }).then(resolve, reject);
      return builder;
    },
  };
  const scope = {
    Deno: { env: { get: (key: string) => key }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: (_url: string, key: string) => key === "SUPABASE_ANON_KEY" ? caller : admin,
    confirmFingerprint: async () => "1234567890abcdef", decideDeclaredCapability, SALES_INVOICE_KIT_BY_ACTION,
    databaseAnswered: (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"),
    mintSignerToken: () => "one-time-secret", sha256Hex: async () => "a".repeat(64),
    executeSalesInvoiceDelivery: async (args: unknown) => { calls.push({ name: "delivery", args }); return options.deliveryResult ?? { ok: true, outcome: "provider_accepted", provider_receipt_available: true, delivery_confirmed: false }; },
    FINGERPRINT, UUID, SALES_INVOICE_ACTIONS, parseSalesInvoiceCommand, manualAllocationReviewMatches,
    readProviderDispositionReview,providerDispositionReviewsEqual,providerDispositionResultMatches,
    PAIGE_APP_ORIGIN: options.publicOrigin ?? PAIGE_APP_ORIGIN, invoicePublicOriginReady,
    readInvoiceDeliveryReadiness:async()=>({eligible:options.readiness!==false,state:options.readiness===false?'needs_setup':'ready',reason:options.readiness===false?'SMS_A2P_NOT_APPROVED':'READY_FOR_GOVERNED_REVIEW',provider_execution_verified:false}),
  };
  // Execute the production handler itself, substituting only network/runtime boundaries.
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const request = async (extra: Record<string, unknown> = {}) => {
    const response = await handler!(new Request("https://example.test/sales-invoice-command", { method: "POST", headers: { Authorization: "Bearer signed-session" }, body: JSON.stringify({ expected_tenant_id: tenant, operation_id: operation, command, ...extra }) }));
    return { status: response.status, body: await response.json() };
  };
  const details=(name:string)=>{const value=calls.find(call=>call.name===name)?.args;if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Missing call '+name);return value as Record<string,unknown>;};
  return { request, calls, claims, details };
}

describe("actual invoice HTTP adapter authority and recovery", () => {
  const allocations=[{obligation:{reference:{commercial_terms_id:'40000000-0000-4000-8000-000000000001',signing_id:'50000000-0000-4000-8000-000000000001',signing_version:2,terms_version:1,sequence:1},source_digest:'a'.repeat(64),due_date:'2026-11-01',scheduled_minor:50000,remaining_minor:50000},amount_cents:1000}];
  it('proposes the exact native-validated manual allocation through the same high-risk gate',async()=>{
    const test=setup({preview:{eligible:true,summary:'Record one actual business-reported receipt against the reviewed accepted payment.',manual_allocations:allocations}});
    const result=await test.request({command:{...command,allocations}});
    expect(result.body).toMatchObject({outcome:'approval_required',preview:{manual_allocations:allocations}});
    expect(test.details('insert:paige_pending_confirmations')).toMatchObject({args:{command:{...command,allocations}}});
    expect(test.calls.some(c=>c.name==='execute_sales_invoice_command')).toBe(false);
  });
  it.each([undefined,[],[{...allocations[0],amount_cents:999}]])('refuses missing or mismatched native allocation review before minting approval %#',async manual_allocations=>{
    const test=setup({preview:{eligible:true,summary:'Legacy or inconsistent native preview',...(manual_allocations===undefined?{}:{manual_allocations})}});
    const result=await test.request({command:{...command,allocations}});
    expect(result.body).toMatchObject({outcome:'refused',code:'INVOICE_ALLOCATION_REVIEW_UNAVAILABLE'});
    expect(test.calls.some(c=>c.name==='insert:paige_pending_confirmations'||c.name==='execute_sales_invoice_command')).toBe(false);
  });
  it('returns the exact recorded split result before current native preview or another approval',async()=>{
    const result={ok:true,operation:{id:operation,action:'invoice.record_manual_payment'}};
    const test=setup({replay:result});
    expect((await test.request({command:{...command,allocations}})).body).toMatchObject({...result,replayed:true});
    expect(test.calls.map(c=>c.name)).toEqual(['read_sales_invoice_command_result']);
    expect(test.claims).toEqual([]);
  });
  it('does not raise or redeem approval for an unready invoice channel',async()=>{
    const test=setup({readiness:false});
    const result=await test.request({command:{action:'invoice.sms_send',invoice_id:command.invoice_id,expected_version:2,connector_id:null}});
    expect(result.body).toMatchObject({code:'INVOICE_DELIVERY_NOT_READY',outcome:'needs_setup'});
    expect(test.claims).toEqual([]);expect(test.calls.some(call=>call.name==='delivery'||call.name==='insert:paige_pending_confirmations')).toBe(false);
  });
  it("refuses an unsigned caller before any business RPC", async () => {
    const test = setup({ authenticated: false });
    expect((await test.request()).status).toBe(401); expect(test.calls).toEqual([]);
  });
  it("refuses a workspace switch before any invoice read", async () => {
    const test = setup({ currentTenant: "another-workspace" });
    expect((await test.request()).body.code).toBe("WORKSPACE_CHANGED"); expect(test.calls).toEqual([]);
  });
  it("refuses a read-only member before invoice read or approval", async () => {
    const test = setup({ role: "member" });
    expect((await test.request()).status).toBe(403); expect(test.calls).toEqual([]);
  });
  it("refuses request-authored authority", async () => {
    const test = setup();
    expect((await test.request({ governance: { approved: true } })).status).toBe(400); expect(test.calls).toEqual([]);
  });
  it("replays a committed receipt before consuming approval or checking current balance", async () => {
    const test = setup({ replay: { ok: true, payment: { id: operation } } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ ok: true, replayed: true });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_command_result"]); expect(test.claims).toEqual([]);
  });
  it("proposes a high-risk partial receipt rather than treating auto as approval", async () => {
    const test = setup();
    expect((await test.request()).body).toMatchObject({ outcome: "approval_required", fingerprint: "1234567890abcdef" });
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("creates a fresh approval cycle without changing an unrecorded receipt operation", async () => {
    const test = setup();
    expect((await test.request()).body.outcome).toBe("approval_required");
    const stored = test.details("insert:paige_pending_confirmations").args as Record<string,unknown>;
    expect(stored).toMatchObject({ command, operation_id: operation, expected_tenant_id: tenant });
    expect(stored.approval_cycle_nonce).toMatch(UUID);
    expect(test.claims).toEqual([]);
  });
  it("reuses the existing exact server-issued receipt proposal cycle", async () => {
    const cycle = { command, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.record_manual_payment:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id };
    const test = setup({ pendingCycle: cycle });
    expect((await test.request()).body.outcome).toBe("approval_required");
    expect(test.details("insert:paige_pending_confirmations")).toMatchObject({args:{approval_cycle_nonce:command.invoice_id}});
  });
  it("does not reuse a proposal cycle with a different receipt amount", async () => {
    const test = setup({ pendingCycle: { command: { ...command, amount_cents: 500 }, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.record_manual_payment:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id } });
    expect((await test.request()).body.code).toBe("APPROVAL_CYCLE_INVALID");
    expect(test.calls.some(call => call.name === "delivery" || call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("executes stored amount and operation after a fenced single-use claim", async () => {
    const stored = { command: { ...command, amount_cents: 500 }, operation_id: "20000000-0000-4000-8000-000000000002", expected_tenant_id: tenant };
    const test = setup({ claimed: stored });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.ok).toBe(true);
    expect(test.calls.find(call => call.name === "execute_sales_invoice_command")?.args).toMatchObject({ _operation_id: stored.operation_id, _command: { amount_cents: 500 }, _governance: { approval_channel: "operator_card", decision_receipt_recorded: true } });
    expect(test.claims[0]).toEqual(expect.arrayContaining([
      { method: "eq", args: ["user_id", "owner"] }, { method: "eq", args: ["tenant_id", tenant] },
      { method: "eq", args: ["tool_name", "sales_record_manual_payment"] },
      { method: "is", args: ["consumed_at", null] }, { method: "is", args: ["thread_id", null] }, { method: "is", args: ["scoped_client_id", null] },
      { method: "not", args: ["server_issued_at", "is", null] }, { method: "not", args: ["issued_in_request", "is", null] },
    ]));
  });
  it("fails closed if the decision receipt cannot be persisted", async () => {
    const test = setup({ auditFails: true, claimed: { command, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.code).toBe("SALES_DECISION_RECEIPT_FAILED");
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("rejects a claimed operation from a different tenant", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: "different-tenant" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.code).toBe("APPROVAL_CLAIM_INVALID");
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("returns a share token once without persisting its plaintext", async () => {
    const link = { action: "invoice.link_create", invoice_id: command.invoice_id, expected_version: 2, expires_in_days: 7, grant_scope: "share" };
    const test = setup({ claimed: { command: link, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ command: link, approved_fingerprint: "1234567890abcdef" })).body.access_token).toBe("one-time-secret");
    expect(JSON.stringify(test.calls)).not.toContain("one-time-secret");
    expect(test.details("execute_sales_invoice_command")).toMatchObject({_governance:{generated_link:{token_hash:"a".repeat(64)}}});
  });
  it("does not remint a bearer secret when recovering a committed link operation", async () => {
    const link = { action: "invoice.link_create", invoice_id: command.invoice_id, expected_version: 2, expires_in_days: 7, grant_scope: "share" };
    const test = setup({ replay: { ok: true, link: { grant_id: operation } } });
    const result = await test.request({ command: link });
    expect(result.body).toMatchObject({ replayed: true, link_recovery_required: true });
    expect(result.body.access_token).toBeUndefined();
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_command_result"]);
  });
  it("does not turn a missing database response into a safe retry claim", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: tenant }, executeError: { message: "Network response lost" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ outcome: "outcome_unknown", operation_id: operation });
  });
  it("returns a known database rejection as refused", async () => {
    const test = setup({ claimed: { command, operation_id: operation, expected_tenant_id: tenant }, executeError: { code: "23514" } });
    expect((await test.request({ approved_fingerprint: "1234567890abcdef" })).body.outcome).toBe("refused");
  });
  it("cannot dispatch invoice email without a canonical claim", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup();
    expect((await test.request({ command: email })).body.outcome).toBe("approval_required");
    expect(test.calls.some(call => call.name === "delivery")).toBe(false);
    expect(test.calls.map(call => call.name)).toContain("preview_sales_invoice_delivery_command");
  });
  it("fails readiness before approval if the controlled document origin is invalid", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ publicOrigin: "https://arbitrary.example/path?token=untrusted" });
    expect((await test.request({ command: email })).body.outcome).toBe("needs_setup");
    expect(test.calls.some(call => call.name === "delivery" || call.name === "insert:paige_pending_confirmations")).toBe(false);
  });
  it("uses the approved connector and command for the sole delivery executor", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const approvedEmail = { ...email, connector_id: command.invoice_id };
    const test = setup({ claimed: { command: approvedEmail, operation_id: operation, expected_tenant_id: tenant } });
    expect((await test.request({ command: email, approved_fingerprint: "1234567890abcdef" })).body).toMatchObject({ ok: true, outcome: "provider_accepted", delivery_confirmed: false });
    expect(test.calls.find(call => call.name === "delivery")?.args).toMatchObject({ command: { connector_id: command.invoice_id }, governance: { tool: "billing_send_invoice", approval_channel: "operator_card" } });
    expect(test.calls.some(call => call.name === "execute_sales_invoice_command")).toBe(false);
  });
  it("recovers accepted delivery without dispatching again", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: true, outcome: "provider_accepted" } });
    expect((await test.request({ command: email })).body).toMatchObject({ replayed: true, outcome: "provider_accepted" });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_delivery_result"]);
  });
  it("requires a fresh server-authored approval cycle for prepared delivery", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: false, outcome: "prepared" } });
    expect((await test.request({ command: email })).body.outcome).toBe("approval_required");
    const args = test.details("insert:paige_pending_confirmations").args as Record<string,unknown>;
    expect(args).toMatchObject({ command: email, operation_id: operation, expected_tenant_id: tenant });
    expect(args.approval_cycle_nonce).toMatch(UUID);
    expect(test.calls.some(call => call.name === "delivery")).toBe(false);
  });
  it("reuses and redeems the exact prepared recovery cycle", async () => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const cycle = { command: email, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.email_send:${command.invoice_id}`, approval_cycle_nonce: command.invoice_id };
    const test = setup({ replay: { ok: false, outcome: "prepared" }, pendingCycle: cycle, claimed: cycle });
    expect((await test.request({ command: email, approved_fingerprint: "1234567890abcdef" })).body.outcome).toBe("provider_accepted");
    expect(test.details("delivery").operationId).toBe(operation);
  });
  it.each(["unknown", "dispatching"])("never re-dispatches %s delivery on recovery", async outcome => {
    const email = { action: "invoice.email_send", invoice_id: command.invoice_id, expected_version: 2, connector_id: operation };
    const test = setup({ replay: { ok: false, outcome } });
    expect((await test.request({ command: email })).body).toMatchObject({ outcome, replayed: true });
    expect(test.calls.map(call => call.name)).toEqual(["read_sales_invoice_delivery_result"]);
  });
});

const prefsCommand={action:'invoice.settings_update',expected_version:0,settings:{prefix:'',next_number:1,padding:4,template:'classic',accent:'#475569',logo_data_uri:null,footer:'',payment_instructions:''}};
describe('actual governed preferences handler',()=>{
 it('proposes canonical settings approval without invoice ID or delivery',async()=>{const test=setup();const response=await test.request({command:prefsCommand});expect(response.status).toBe(202);expect(test.details('insert:paige_pending_confirmations').args).toMatchObject({command:prefsCommand,approval_subject:'invoice.settings_update:'+tenant});expect(test.calls.some(c=>c.name==='delivery'||c.name==='execute_sales_invoice_command')).toBe(false)});
 it('executes only stored tenant-scoped approved settings through existing RPC',async()=>{const stored={command:prefsCommand,operation_id:operation,expected_tenant_id:tenant};const test=setup({claimed:stored});const response=await test.request({command:prefsCommand,approved_fingerprint:'abcdef0123456789'});expect(response.status).toBe(200);expect(test.details('execute_sales_invoice_command')).toMatchObject({_command:prefsCommand,_operation_id:operation});expect(test.details('insert:paige_audit_log')).toMatchObject({target_type:'invoice_preferences',target_id:tenant});});
 it('refuses viewer settings before preview or write',async()=>{const test=setup({role:'viewer'});expect((await test.request({command:prefsCommand})).status).toBe(403);expect(test.calls).toEqual([])});
 it('retains ordinary twenty KB command bound',async()=>{const test=setup();expect((await test.request({command:{...command,notes:'x'.repeat(22000)}})).status).toBe(400)});
});


const financialCommand={action:'invoice.record_provider_disposition',invoice_id:command.invoice_id,expected_version:2,provider_operation_id:'e0448200-0000-4000-8000-000000000001',observation_id:'e0448200-0000-4000-8000-000000000002',observation_version:2,expected_disposition_version:0,decision:'credit_returned_principal',credit_minor:10000,reason:'Original reviewed credit'};

const financialReview=()=>({review_version:1,financial_evidence_version:3,effect:'internal_financial_disposition_only',invoice_id:command.invoice_id,invoice_version:2,client_id:'e0448200-0000-4000-8000-000000000003',client_name:'Fixture client',currency:'usd',provider_operation_id:financialCommand.provider_operation_id,observation_id:financialCommand.observation_id,observation_version:2,disposition_version:0,decision:financialCommand.decision,captured_minor:50000,retained_minor:40000,returned_minor:10000,credit_before_minor:0,credit_after_minor:10000,standing_before:'needs_review',outstanding_before_minor:null,outstanding_after_minor:300000,refund_payable_before_minor:null,refund_payable_after_minor:0,source_hash:'a'.repeat(64)});

const financialPreview=(review:unknown=financialReview())=>({eligible:true,invoice_number:'INV-1',currency:'usd',provider_disposition:review,summary:'Review original credit and balances'});

const financialArgs=(review:unknown=financialReview())=>({command:financialCommand,operation_id:operation,expected_tenant_id:tenant,approval_subject:'invoice.record_provider_disposition:'+command.invoice_id,provider_disposition_review:review});

const financialResult=()=>({ok:true,outcome:'financial_decision_recorded',effect:'internal_financial_disposition_only',payment_moved:false,customer_notified:false,rail_recorded:true,receipt_id:'e0448200-0000-4000-8000-000000000004',operation:{id:operation,action:financialCommand.action},provider_disposition_review:financialReview(),disposition_version:1,invoice_version:3,row:{id:command.invoice_id,tenant_id:tenant,version:3}});

describe('original HTTP door binds the complete native financial consequence',()=>{

 it('stores the exact native review in the existing approval rather than caller-authored money',async()=>{const h=setup({preview:financialPreview()});const r=await h.request({command:financialCommand});expect(r.status).toBe(202);expect(h.details('insert:paige_pending_confirmations').args).toMatchObject({command:financialCommand,provider_disposition_review:financialReview()});expect(h.calls.some(c=>c.name==='execute_sales_invoice_command')).toBe(false);});

 it.each([undefined,{...financialReview(),observation_version:3},{...financialReview(),credit_after_minor:9999}])('refuses a missing or changed native financial review %j',async review=>{const h=setup({preview:financialPreview(review===undefined?null:review)});const r=await h.request({command:financialCommand});expect(r.status).toBe(422);expect(r.body.code).toBe('INVOICE_FINANCIAL_REVIEW_UNAVAILABLE');expect(h.calls.some(c=>c.name==='insert:paige_pending_confirmations'||c.name==='execute_sales_invoice_command')).toBe(false);});

 it.each([null,{...financialReview(),source_hash:'b'.repeat(64)}])('cannot execute a missing or outdated stored financial consequence %j',async review=>{const h=setup({preview:financialPreview(),claimed:financialArgs(review),executeResult:financialResult()});const r=await h.request({command:financialCommand,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(409);expect(r.body.code).toBe('INVOICE_FINANCIAL_APPROVAL_CHANGED');expect(h.calls.some(c=>c.name==='execute_sales_invoice_command')).toBe(false);});

 it('passes only the stored native consequence through original invoice governance',async()=>{const h=setup({preview:financialPreview(),claimed:financialArgs(),executeResult:financialResult()});const r=await h.request({command:financialCommand,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(200);expect(h.details('execute_sales_invoice_command')._governance).toMatchObject({tool:'sales_record_provider_disposition',approved_financial_review:financialReview()});expect(r.body.payment_moved).toBe(false);});

 it.each([{...financialResult(),rail_recorded:false},{...financialResult(),payment_moved:true},{...financialResult(),customer_notified:true},{...financialResult(),invoice_version:4},{ok:true}])('an incomplete or contradictory native result is unknown, never success %j',async executeResult=>{const h=setup({preview:financialPreview(),claimed:financialArgs(),executeResult});const r=await h.request({command:financialCommand,approved_fingerprint:'0123456789abcdef'});expect(r.status).toBe(503);expect(r.body.outcome).toBe('outcome_unknown');expect(r.body.code).toBe('INVOICE_FINANCIAL_RESULT_UNVERIFIED');});

 it('validates historical replay before treating it as a financial receipt',async()=>{const h=setup({replay:{...financialResult(),customer_notified:true}});const r=await h.request({command:financialCommand});expect(r.status).toBe(503);expect(r.body.code).toBe('INVOICE_FINANCIAL_RESULT_UNVERIFIED');expect(h.calls.some(c=>c.name==='execute_sales_invoice_command')).toBe(false);});

 it('cannot smuggle a native review through the request envelope',async()=>{const h=setup({preview:financialPreview()});const r=await h.request({command:financialCommand,provider_disposition_review:financialReview()});expect(r.status).toBe(400);});

});
