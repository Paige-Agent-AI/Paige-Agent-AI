import { describe, expect, it } from 'vitest';
import { dispatchSalesInvoiceChat } from '../../supabase/functions/_shared/sales-invoice-chat.ts';
import {acceptedPlanFixture} from '../../scripts/live-drive/sales-payments/accepted-plan-fixture';

const tenant = '11111111-1111-4111-8111-111111111111';
const invoice = '2222222a-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const context = {
  tenantId: tenant, userId: tenant, toolName: 'read_sales_invoice', args: { invoice_id: invoice },
  approved: new Set<string>(), sameToolCalls: 1,
  turn: { thread_id: null, user_turn_ordinal: 1, user_turn: 'Read this invoice' },
};
const record = { id: invoice, tenant_id: tenant, version: 2, status: 'issued', currency: 'usd',
  amount_total_cents: 5000, remaining_cents: 0, payments: [] };

async function read(data: unknown, error: unknown = null, ctx = context) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await dispatchSalesInvoiceChat(ctx, {
    admin: { from() { throw new Error('Invoice reads cannot select an approval'); } },
    caller: {
      async rpc(name, args) { calls.push({ name, args }); return { data, error }; },
      functions: { async invoke() { throw new Error('Invoice reads cannot invoke a mutation'); } },
    },
  });
  return { result, calls };
}

describe('canonical invoice Chat readback', () => {
  it('retrieves the same immutable manual split and correction through caller JWT, without an approval or mutation',async()=>{
    const fixture=await acceptedPlanFixture(),paymentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',actualInvoice=fixture.invoice.id;
    const receipt={id:paymentId,kind:'receipt',amount_cents:80000,evidence_kind:'manual_recorded'},assignments={invoice_id:actualInvoice,invoice_version:2,payment_id:paymentId,amount_cents:80000,currency:'usd',state:'assigned',reversal_payment_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',allocations:[{obligation:fixture.view.obligations[0],amount_cents:50000},{obligation:fixture.view.obligations[1],amount_cents:30000}]};
    const calls:Array<{name:string;args:Record<string,unknown>}>=[];
    const result=await dispatchSalesInvoiceChat({...context,args:{invoice_id:actualInvoice,manual_payment_id:paymentId}}, {admin:{from(){throw Error('No admin read/approval')}},caller:{rpc:async(name,args)=>{calls.push({name,args});return{data:name==='read_sales_invoice'?{...record,id:actualInvoice,payments:[receipt]}:assignments,error:null}},functions:{invoke:async()=>{throw Error('No mutation')}}}});
    expect(result.content).toMatchObject({success:true,manual_payment_assignments:{state:'assigned',allocations:assignments.allocations,reversalPaymentId:assignments.reversal_payment_id}});
    expect(calls).toEqual([{name:'read_sales_invoice',args:{_expected_tenant_id:tenant,_invoice_id:actualInvoice}},{name:'read_sales_invoice_manual_allocations',args:{_expected_tenant_id:tenant,_invoice_id:actualInvoice,_expected_version:2,_payment_id:paymentId}}]);
    expect(result.content).not.toHaveProperty('needs_confirm');
  });
  it.each(['provider','absent','reversal'] as const)('does not read manual assignments for %s payment evidence',async kind=>{
    const paymentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const payments=kind==='absent'?[]:[{id:paymentId,kind:kind==='reversal'?'reversal':'receipt',amount_cents:80000,evidence_kind:kind==='provider'?'provider_verified':'manual_recorded'}];
    const calls:string[]=[];
    const result=await dispatchSalesInvoiceChat({...context,args:{invoice_id:invoice,manual_payment_id:paymentId}}, {admin:{from(){throw Error('No admin read')}},caller:{rpc:async name=>{calls.push(name);return{data:{...record,payments},error:null}},functions:{invoke:async()=>{throw Error('No mutation')}}}});
    expect(result.content).toMatchObject({success:true,manual_payment_assignments:{state:'refused'}});expect(calls).toEqual(['read_sales_invoice']);
  });
  it('keeps an invoice read distinct from denied receipt-assignment currentness',async()=>{
    const paymentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const result=await dispatchSalesInvoiceChat({...context,args:{invoice_id:invoice,manual_payment_id:paymentId}}, {admin:{from(){throw Error('No admin read')}},caller:{rpc:async name=>name==='read_sales_invoice'?{data:{...record,payments:[{id:paymentId,kind:'receipt',amount_cents:80000}]},error:null}:{data:null,error:{code:'40001'}},functions:{invoke:async()=>{throw Error('No mutation')}}}});
    expect(result.content).toMatchObject({success:true,manual_payment_assignments:{state:'stale'}});expect(result.content.manual_payment_assignments).not.toHaveProperty('allocations');
  });
  it.each([null, [], true, 'unavailable', {}, { ...record, id: undefined },
    { ...record, tenant_id: undefined }, { ...record, id: other },
    { ...record, tenant_id: other }, { ...record, version: undefined },
    { ...record, version: 0 }, { ...record, version: 1.5 },
    { ...record, version: '2' }, { ...record, version: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not report an absent, mismatched or unusable native record as read', async data => {
    const { result, calls } = await read(data);
    expect(result.content.success).toBe(false);
    expect(result.content).not.toHaveProperty('invoice');
    expect(calls).toEqual([{ name: 'read_sales_invoice', args: {
      _expected_tenant_id: tenant, _invoice_id: invoice,
    } }]);
  });

  it.each([{ ...record, version: 1, status: 'draft', remaining_cents: 5000 }, record,
    { ...record, id: other, tenant_id: other, version: 4 },
  ])('preserves valid canonical records across eligible workspaces and record versions', async data => {
    const ctx = { ...context, tenantId: data.tenant_id, args: { invoice_id: data.id.toUpperCase() } };
    const { result, calls } = await read({ ...data, document: 'private', actor_user_id: 'private' }, null, ctx);
    expect(result.content).toMatchObject({ success: true, invoice: {
      id: data.id, version: data.version, remaining_cents: data.remaining_cents,
    } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.content.invoice).not.toHaveProperty('tenant_id');
    expect(calls).toEqual([{ name: 'read_sales_invoice', args: {
      _expected_tenant_id: data.tenant_id, _invoice_id: data.id,
    } }]);
  });

  it('preserves native permission errors even when data is also present', async () => {
    const { result } = await read(record, { code: '42501', message: 'private' });
    expect(result.content.success).toBe(false);
    expect(result.content).not.toHaveProperty('invoice');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
