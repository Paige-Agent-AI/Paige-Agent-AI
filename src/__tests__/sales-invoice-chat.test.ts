import { describe, expect, it } from 'vitest';
import { SALES_INVOICE_TOOLS, salesInvoiceOperationId, dispatchSalesInvoiceChat, salesInvoiceSafeResult } from '../../supabase/functions/_shared/sales-invoice-chat.ts';

const tenant = '11111111-1111-4111-8111-111111111111';
const invoice = '22222222-2222-4222-8222-222222222222';
const operation = '33333333-3333-4333-8333-333333333333';
const fingerprint = 'abcdef0123456789';
const command = { action: 'invoice.publish', invoice_id: invoice, expected_version: 1 };
const context = { tenantId: tenant, userId: 'actor', toolName: 'sales_publish_invoice', args: { invoice_id: invoice, expected_version: 99 }, approved: new Set([fingerprint]), sameToolCalls: 1, turn: { thread_id: null, user_turn_ordinal: 1, user_turn: 'issue it' } };
function harness(rows: unknown[] = []) {
  const predicates: unknown[][] = [];
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'is', 'not', 'gt']) query[name] = (...args: unknown[]) => { predicates.push([name, ...args]); return query; };
  query.limit = async (...args: unknown[]) => { predicates.push(['limit', ...args]); return { data: rows, error: null }; };
  const calls: unknown[] = [];
  return { predicates, calls, deps: { admin: { from: () => query }, caller: { functions: { invoke: async (_name: string, options: unknown): Promise<{data: Record<string, unknown>; error: null}> => { calls.push(options); return { data: { ok: true, outcome: 'published', access_token: 'secret' }, error: null }; } }, rpc: async ():Promise<{data:unknown;error:unknown}> => ({ data: { id: invoice, status: 'issued' }, error: null }) } } };
}
describe('Sales invoice canonical Chat door', () => {
  it('records imported partial receipts through the canonical Collections door and same payment policy',async()=>{
    const h=harness();let endpoint='';h.deps.caller.functions.invoke=async(name,options)=>{endpoint=name;h.calls.push(options);return {data:{ok:true,operation:{id:operation,action:'collection.record_receipt'},row:{status:'recorded',remaining_cents:5000,currency:'jpy',version:2}},error:null}};
    const result=await dispatchSalesInvoiceChat({...context,toolName:'sales_record_manual_payment',approved:new Set(),args:{record_kind:'imported',invoice_id:invoice,expected_version:1,amount_cents:1000,currency:'jpy',method:'wire',received_at:'2026-10-03T12:00:00.000Z'}},h.deps as never);
    expect(endpoint).toBe('sales-collection-command');expect(h.calls[0]).toMatchObject({body:{command:{action:'collection.record_receipt',currency:'jpy',amount_cents:1000}}});expect(result.content).toMatchObject({success:true,outcome:'manual_payment_recorded',invoice:{status:'recorded',currency:'jpy',remaining_cents:5000}});
  });
  it('routes SMS through the same governed tool with server-selected connection and closed outcome',async()=>{
    const h=harness();h.deps.caller.functions.invoke=async(_name,options)=>{h.calls.push(options);return {data:{ok:true,outcome:'provider_accepted',provider_receipt_available:true,delivery_confirmed:false,operation_id:operation,recipient:'private',access_token:'private'},error:null}};
    const result=await dispatchSalesInvoiceChat({...context,toolName:'billing_send_invoice',approved:new Set(),args:{invoice_id:invoice,expected_version:2,channel:'sms'}},h.deps as never);
    expect(h.calls[0]).toMatchObject({body:{command:{action:'invoice.sms_send',connector_id:null,invoice_id:invoice,expected_version:2}}});
    expect(result.content).toMatchObject({success:true,outcome:'provider_accepted',delivery_confirmed:false});expect(JSON.stringify(result)).not.toContain('private');expect(result.content).not.toHaveProperty('operation_id');
  });
  it('rejects iMessage and arbitrary SMS destination arguments without dispatch',async()=>{
    for(const extra of [{channel:'imessage'},{channel:'sms',to:'+15555555555'}]){const h=harness();expect((await dispatchSalesInvoiceChat({...context,toolName:'billing_send_invoice',approved:new Set(),args:{invoice_id:invoice,expected_version:2,...extra}},h.deps as never)).content.success).toBe(false);expect(h.calls).toHaveLength(0)}
  });
  it('rejects non-string delivery and record-kind discriminators',async()=>{
    for(const [toolName,extra] of [['billing_send_invoice',{channel:['sms']}],['sales_record_manual_payment',{record_kind:['imported']}]] as const){const h=harness();const result=await dispatchSalesInvoiceChat({...context,toolName,approved:new Set(),args:{invoice_id:invoice,expected_version:2,...extra}},h.deps as never);expect(result.content.success).toBe(false);expect(h.calls).toHaveLength(0)}
  });
  it('omits bearer-link tools', () => expect(SALES_INVOICE_TOOLS.map(t => t.function.name)).not.toContain('sales_create_invoice_link'));
  it('uses stable turn and canonical command retry identity', async () => {
    const a = await salesInvoiceOperationId(tenant, 'actor', command, context.turn);
    expect(a).toMatch(/^[a-f0-9-]{36}$/);
    expect(await salesInvoiceOperationId(tenant, 'actor', { expected_version: 1, invoice_id: invoice, action: 'invoice.publish' }, context.turn)).toBe(a);
    expect(await salesInvoiceOperationId(tenant, 'actor', command, { ...context.turn, user_turn_ordinal: 2 })).not.toBe(a);
  });
  it('forwards stored approved command and operation, never model drift; never exposes bearer', async () => {
    const h = harness([{ fingerprint, args: { command, operation_id: operation, expected_tenant_id: tenant, approval_subject: `invoice.publish:${invoice}` } }]);
    const result = await dispatchSalesInvoiceChat(context, h.deps as never);
    expect(h.calls).toEqual([{ body: { command, operation_id: operation, expected_tenant_id: tenant, approved_fingerprint: fingerprint } }]);
    expect(JSON.stringify(result)).not.toContain('secret');
    for (const predicate of [['eq','tenant_id',tenant],['eq','user_id','actor'],['eq','tool_name','sales_publish_invoice'],['is','thread_id',null],['is','scoped_client_id',null],['is','consumed_at',null],['not','server_issued_at','is',null],['not','issued_in_request','is',null]]) expect(h.predicates).toContainEqual(predicate);
    expect(h.predicates.some(p => p[0] === 'gt' && p[1] === 'expires_at')).toBe(true);
  });
  it('does not spend a scoped token as a bare approval', async () => {
    const h = harness([{ fingerprint, args: { command, operation_id: operation, expected_tenant_id: tenant } }]);
    const result = await dispatchSalesInvoiceChat({ ...context, approved: new Set([`${fingerprint}:${invoice}`]) }, h.deps as never);
    expect(result.refusal).toBe('unclaimable'); expect(h.calls).toHaveLength(0);
  });
  it('refuses malformed stored scope rather than reproposing', async () => {
    const h = harness([{ fingerprint, args: { command, operation_id: operation, expected_tenant_id: invoice } }]);
    expect((await dispatchSalesInvoiceChat(context, h.deps as never)).refusal).toBe('unclaimable'); expect(h.calls).toHaveLength(0);
  });
  it('refuses ambiguous approvals without execution', async () => {
    const h = harness([{ fingerprint, args: {} }, { fingerprint: '0123456789abcdef', args: {} }]);
    expect((await dispatchSalesInvoiceChat(context, h.deps as never)).refusal).toBe('ambiguous'); expect(h.calls).toHaveLength(0);
  });
  it('fails closed on lookup throw and error', async () => {
    const h = harness(); h.deps.admin.from = () => { throw new Error('unavailable'); };
    expect((await dispatchSalesInvoiceChat(context, h.deps as never)).refusal).toBe('lookup_failed'); expect(h.calls).toHaveLength(0);
  });
  it('reads through authenticated RPC and projects no PII, actor or document', async () => {
    const h = harness();
    h.deps.caller.rpc = async () => ({ data: { id: invoice, status: 'issued', amount_total_cents: 100, remaining_cents: 20, billing_draft: { email: 'private' }, document: 'private', issued_by: 'private', payments: [{ id: operation, method: 'cash', amount_cents: 80, reference: 'private', notes: 'private', actor_user_id: 'private' }] }, error: null });
    const result = await dispatchSalesInvoiceChat({ ...context, toolName: 'read_sales_invoice', args: { invoice_id: invoice } }, h.deps as never);
    expect(result.content.success).toBe(true); expect(JSON.stringify(result)).not.toContain('private'); expect(h.calls).toHaveLength(0);
    expect(result.content.invoice).toMatchObject({ remaining_cents: 20, payments: [{ method: 'cash', amount_cents: 80 }] });
  });
  it('rejects invalid JSON shapes, action injection and model operation IDs', async () => {
    for (const args of [null, [], { ...context.args, action: 'invoice.void' }, { ...context.args, operation_id: operation }]) {
      const h = harness(); const result = await dispatchSalesInvoiceChat({ ...context, approved: new Set(), args: args as never }, h.deps as never);
      expect(result.content.success).toBe(false); expect(h.calls).toHaveLength(0);
    }
  });
  it('does not turn a missing transport response into success or automatic retry', async () => {
    const h = harness(); h.deps.caller.functions.invoke = async () => { throw new Error('timeout'); };
    const result = await dispatchSalesInvoiceChat({ ...context, approved: new Set() }, h.deps as never);
    expect(result.content).toMatchObject({ success: false, outcome: 'outcome_unknown' });
  });
  it('returns canonical card fields only for an actual approval proposal', async () => {
    const h = harness(); h.deps.caller.functions.invoke = async () => ({ data: { ok: false, outcome: 'approval_required', fingerprint, summary: 'Issue invoice', access_token: 'private', preview: { document: 'private' } }, error: null });
    const result = await dispatchSalesInvoiceChat({ ...context, approved: new Set() }, h.deps as never);
    expect(result.content).toMatchObject({ needs_confirm: true, confirm_fingerprint: fingerprint, success: false }); expect(JSON.stringify(result)).not.toContain('private');
  });
  it('drops credentials even from unexpected nested endpoint values', () => {
    expect(salesInvoiceSafeResult({ ok: true, invoice: { status: 'issued', document: { access_token: 'private' } }, access_token: 'private', url: 'private' })).toEqual({ ok: true, invoice: { status: 'issued' } });
  });
  it('projects actual canonical command row and operation receipt', () => {
    expect(salesInvoiceSafeResult({ ok: true, row: { status: 'issued', remaining_cents: 100, billing_draft: 'private' }, operation: { id: operation, action: 'invoice.publish' } })).toEqual({ ok: true, invoice: { status: 'issued', remaining_cents: 100 }, operation_id: operation, outcome: 'published' });
  });
  it('identifies replay readback as historical rather than a current balance', async () => {
    const h = harness();
    h.deps.caller.functions.invoke = async () => ({ data: { ok: true, outcome: 'manual_payment_recorded', replayed: true, row: { remaining_cents: 100 } }, error: null });
    const result = await dispatchSalesInvoiceChat({ ...context, approved: new Set() }, h.deps as never);
    expect(result.content).toMatchObject({ success: true, replayed: true });
    expect(result.content.note).toContain('Read the invoice again');
  });
  it('binds email to the same canonical endpoint and never calls a provider directly', async () => {
    const h = harness();
    await dispatchSalesInvoiceChat({ ...context, toolName: 'billing_send_invoice', args: { invoice_id: invoice, expected_version: 1, connector_id: operation }, approved: new Set() }, h.deps as never);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ body: { command: { action: 'invoice.email_send', connector_id: operation } } });
  });
  it('bounds receipt history while preserving full balance and replay truth', () => {
    const safe = salesInvoiceSafeResult({ remaining_cents: 20, replayed: true, payments: Array.from({ length: 50 }, () => ({ amount_cents: 1 })), payments_count: 60, payments_has_more: true });
    expect(safe).toMatchObject({ remaining_cents: 20, replayed: true, payment_record_count: 60, payment_records_truncated: true });
    expect(safe.payments).toHaveLength(50);
  });
  it('reports provider acceptance without delivery, payment or provider identifiers', async () => {
    const h = harness();
    h.deps.caller.functions.invoke = async () => ({ data: { ok: true, outcome: 'provider_accepted', provider_receipt_available: true, delivery_confirmed: false, operation_id: operation, message_id: 'private', recipient: 'private', access_token: 'private' }, error: null });
    const result = await dispatchSalesInvoiceChat({ ...context, toolName: 'billing_send_invoice', args: { invoice_id: invoice, expected_version: 1, connector_id: operation }, approved: new Set() }, h.deps as never);
    expect(result.content).toEqual({ ok: true, outcome: 'provider_accepted', provider_receipt_available: true, delivery_confirmed: false, success: true });
  });
  it('does not present prepared or unknown email results as completed sends', async () => {
    for (const outcome of ['prepared', 'dispatching', 'unknown', 'outcome_unknown']) {
      const h = harness();
      h.deps.caller.functions.invoke = async () => ({ data: { ok: true, outcome, access_token: 'private' }, error: null });
      const result = await dispatchSalesInvoiceChat({ ...context, toolName: 'billing_send_invoice', args: { invoice_id: invoice, expected_version: 1, connector_id: operation }, approved: new Set() }, h.deps as never);
      expect(result.content).toMatchObject({ outcome, success: false });
    }
  });
});

const prefs={prefix:'INV-',next_number:1,padding:4,template:'modern',accent:'#475569',logo_data_uri:null,footer:'',payment_instructions:''};
describe('invoice preferences canonical Chat door',()=>{
 it('binds actual read and mutation tools',()=>{expect(SALES_INVOICE_TOOLS.map(t=>t.function.name)).toContain('read_sales_invoice_preferences');expect(SALES_INVOICE_TOOLS.map(t=>t.function.name)).toContain('sales_update_invoice_settings')});
 it('reads only caller scoped preferences and excludes embedded logo payload',async()=>{const h=harness();h.deps.caller.rpc=async()=>({data:{tenant_id:tenant,version:0,settings:{...prefs,logo_data_uri:'private-logo'},can_manage:true},error:null});const r=await dispatchSalesInvoiceChat({...context,toolName:'read_sales_invoice_preferences',args:{},approved:new Set()},h.deps as never);expect(r.content).toMatchObject({success:true,version:0,settings:{logo_available:true}});expect(JSON.stringify(r)).not.toContain('private-logo');expect(h.calls).toHaveLength(0)});
 it('executes canonical settings without invented invoice ID and projects only saved version',async()=>{const c={action:'invoice.settings_update',expected_version:0,settings:prefs};const h=harness([{fingerprint,args:{command:c,operation_id:operation,expected_tenant_id:tenant,approval_subject:'invoice.settings_update:'+tenant}}]);h.deps.caller.functions.invoke=async(_n,options)=>{h.calls.push(options);return {data:{ok:true,preferences:{tenant_id:tenant,version:1,settings:{logo_data_uri:'private'}}},error:null}};const r=await dispatchSalesInvoiceChat({...context,toolName:'sales_update_invoice_settings',args:{expected_version:0,settings:prefs}},h.deps as never);expect(h.calls).toEqual([{body:{expected_tenant_id:tenant,operation_id:operation,command:c,approved_fingerprint:fingerprint}}]);expect(r.content).toMatchObject({success:true,version:1,outcome:'settings_saved'});expect(JSON.stringify(r)).not.toContain('private')});
});
