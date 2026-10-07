import {describe,it,expect,vi} from 'vitest';
import {dispatchSalesInvoiceChat,SALES_INVOICE_TOOLS,type Context,type Dependencies} from '../../supabase/functions/_shared/sales-invoice-chat';
const tenant='20000000-0000-0000-0000-000000000001',invoice='60000000-0000-0000-0000-000000000001';
const context=(args:Record<string,unknown>):Context=>({tenantId:tenant,userId:'10000000-0000-0000-0000-000000000001',toolName:'read_sales_commercial_package',args,approved:new Set(),sameToolCalls:1,turn:{thread_id:null,user_turn_ordinal:1,user_turn:'Read this invoice package'}});
const projection=()=>({schema_version:1,tenant_id:tenant,receipt_id:'90000000-0000-0000-0000-000000000001',state:'needs_input',authority:'not_evaluated',execution:'not_started',missing_fields:['tax_and_fee_treatment'],conflicts:[],invoice:{id:invoice,client_id:'30000000-0000-0000-0000-000000000001',status:'issued',version:2,draft_version:1,issued_snapshot_version:1,obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,currency:'usd',receivable_total_minor:350000,allocated_minor:50000,manual_recorded_minor:0,provider_verified_minor:50000,outstanding_minor:300000,due_date:'2026-10-15',delivery_channels:['email']},offers:[],agreement:null,commercial_terms:null});
function dependencies(data:unknown=projection()){
 const rpc=vi.fn().mockResolvedValue({data,error:null}),invoke=vi.fn(),from=vi.fn();
 return {rpc,invoke,from,deps:{caller:{rpc,functions:{invoke}},admin:{from}} as unknown as Dependencies};
}
describe('Sales package read through existing Chat domain',()=>{
 it('offers an invoice-scoped read without owner/approval inputs',()=>{
  const tool=SALES_INVOICE_TOOLS.find(t=>t.function.name==='read_sales_commercial_package');
  expect(tool).toBeDefined();expect(tool?.function.parameters).toMatchObject({required:['invoice_id'],additionalProperties:false});
 });
 it('uses the caller RPC once and preserves missing facts without authority',async()=>{
  const d=dependencies();const result=await dispatchSalesInvoiceChat(context({invoice_id:invoice}),d.deps);
  expect(result.content).toMatchObject({success:true,state:'needs_input',missing_fields:['tax_and_fee_treatment'],authority:'not_evaluated',execution:'not_started',invoice:{outstanding_minor:300000}});
  expect(d.rpc).toHaveBeenCalledExactlyOnceWith('read_sales_commercial_package',{_expected_tenant_id:tenant,_invoice_id:invoice});
  expect(d.from).not.toHaveBeenCalled();expect(d.invoke).not.toHaveBeenCalled();expect(result.spent).toBeUndefined();
 });
 it.each([{invoice_id:invoice,approved:true},{invoice_id:invoice,tenant_id:tenant},{invoice_id:invoice,action:'invoice.publish'},{}])('refuses extended inputs without IO',async args=>{
  const d=dependencies();expect((await dispatchSalesInvoiceChat(context(args),d.deps)).content.success).toBe(false);expect(d.rpc).not.toHaveBeenCalled();expect(d.invoke).not.toHaveBeenCalled();expect(d.from).not.toHaveBeenCalled();
 });
 it('refuses stale/foreign source rather than forwarding it',async()=>{
  const data=projection();data.tenant_id='20000000-0000-0000-0000-000000000002';const d=dependencies(data);
  expect((await dispatchSalesInvoiceChat(context({invoice_id:invoice}),d.deps)).content.success).toBe(false);
 });
 it('redacts a failed RPC and never prepares a replacement act',async()=>{
  const d=dependencies();d.rpc.mockRejectedValueOnce(Error('private-provider-secret-marker'));
  const result=await dispatchSalesInvoiceChat(context({invoice_id:invoice}),d.deps);expect(result.content.success).toBe(false);expect(JSON.stringify(result)).not.toContain('private-provider-secret-marker');expect(d.invoke).not.toHaveBeenCalled();expect(d.from).not.toHaveBeenCalled();
 });
});
