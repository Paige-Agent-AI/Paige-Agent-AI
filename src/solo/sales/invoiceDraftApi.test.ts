import { describe, expect, it, vi } from 'vitest';
import { listInvoiceDrafts, readInvoiceDraft, saveInvoiceDraft } from './invoiceDraftApi';
import { snapshotEditInput, type InvoiceSnapshot } from './invoiceDraftSnapshot';
const tenant='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222', client='33333333-3333-4333-8333-333333333333';
const snapshot: InvoiceSnapshot = {
  schema_version:2, client_id:client, items:[{price_id:null,item:'Service',unit_minor:999,quantity:2,price_snapshot:null}],
  kind:'one_time',deposit_basis_points:null,currency:'usd',cadence:null,
  recipient_email:'billing@example.test',recipient_phone:null,email_source_method_id:null,phone_source_method_id:null,
  billing_address:{line1:'Example St',line2:null,city:null,region:null,postal_code:null,country:null},
  agreement_id:null,agreement_snapshot:null,processor_intent:null,payment_method_intents:[],delivery_channel_intents:['email','sms'],
  due_date:null,memo:null,total_minor:1998,due_now_minor:1998,remainder_minor:0,
};
const row=(patch:Record<string,unknown>={})=>({id,tenant_id:tenant,invoice_number:'DRAFT-'+id,status:'draft',billing_draft_version:1,amount_total_cents:1998,billing_draft:snapshot,...patch});
const request={openedTenantId:tenant,invoiceId:id,expectedVersion:0,operationId:'44444444-4444-4444-8444-444444444444',draft:snapshotEditInput(snapshot)};
describe('dual-schema durable invoice API',()=>{
  it('reads historical and expanded drafts without mutating either',async()=>{
    const old={...snapshot.items[0],client_id:client,kind:'one_time',provider:'paypal',currency:'usd',cadence:null,deposit_basis_points:null,recipient_email:'original@example.test',due_date:null,memo:null,due_now_minor:1998,remainder_minor:0};
    const rpc=vi.fn().mockResolvedValue({data:{rows:[row(),row({billing_draft:old})],has_more:false,next_cursor:null},error:null});
    const result=await listInvoiceDrafts(rpc,tenant);
    expect(result).toMatchObject({ok:true,value:{rows:[{schemaVersion:2,snapshot:{delivery_channel_intents:['email','sms']}},{schemaVersion:1,snapshot:{recipient_email:'original@example.test',recipient_phone:null}}]}});
  });
  it('saves the opened tenant, original request and stable operation without altering contact snapshots',async()=>{
    const before=JSON.stringify(request);
    const rpc=vi.fn().mockResolvedValue({data:{row:row()},error:null});
    expect(await saveInvoiceDraft(rpc,request)).toMatchObject({ok:true,value:{version:1,snapshot:{billing_address:{line1:'Example St',country:null}}}});
    expect(rpc).toHaveBeenCalledWith('save_sales_billing_draft',{_expected_tenant_id:tenant,_invoice_id:id,_expected_version:0,_operation_id:request.operationId,_draft:request.draft});
    expect(JSON.stringify(request)).toBe(before);
  });
  it('isolates nested edited inputs from saved snapshot arrays and address',()=>{
    const edited=snapshotEditInput(snapshot);
    edited.billing_address!.line1='Override'; edited.delivery_channel_intents.pop(); edited.items[0].item='Edit';
    expect(snapshot.billing_address!.line1).toBe('Example St'); expect(snapshot.delivery_channel_intents).toHaveLength(2); expect(snapshot.items[0].item).toBe('Service');
  });
  it.each([{tenant_id:id},{status:'paid'},{billing_draft_version:0},{amount_total_cents:2000},{billing_draft:{...snapshot,schema_version:3}}])('refuses untrusted rows instead of dropping fields',patch=>expect(readInvoiceDraft(row(patch),tenant)).toBeNull());
  it('fails the whole list for unsupported schemas and cross-tenant rows',async()=>{
    for(const bad of [row({tenant_id:id}),row({billing_draft:{...snapshot,schema_version:3}})]) {
      expect(await listInvoiceDrafts(vi.fn().mockResolvedValue({data:{rows:[row(),bad],has_more:false,next_cursor:null},error:null}),tenant)).toMatchObject({ok:false});
    }
  });
  it('keeps unknown transport distinct from refusal and unavailable',async()=>{
    expect(await saveInvoiceDraft(vi.fn().mockRejectedValue(new Error('secret')),request)).toMatchObject({ok:false,outcome:'unknown'});
    expect(await saveInvoiceDraft(vi.fn().mockResolvedValue({data:null,error:{code:'40001'}}),request)).toMatchObject({ok:false,outcome:'refused'});
    expect(await saveInvoiceDraft(vi.fn().mockResolvedValue({data:null,error:{code:'PGRST202'}}),request)).toMatchObject({ok:false,outcome:'unavailable'});
  });
  it('validates response identity/revision and forwards the exact keyset cursor',async()=>{
    expect(await saveInvoiceDraft(vi.fn().mockResolvedValue({data:{row:row({id:tenant})},error:null}),request)).toMatchObject({ok:false,outcome:'unknown'});
    expect(await saveInvoiceDraft(vi.fn().mockResolvedValue({data:{row:row({billing_draft_version:2})},error:null}),request)).toMatchObject({ok:false,outcome:'unknown'});
    const rpc=vi.fn().mockResolvedValue({data:{rows:[],has_more:false,next_cursor:null},error:null});
    expect(await listInvoiceDrafts(rpc,tenant,id)).toMatchObject({ok:true});
    expect(rpc).toHaveBeenCalledWith('list_sales_billing_drafts',{_expected_tenant_id:tenant,_limit:50,_before_id:id});
  });
});
