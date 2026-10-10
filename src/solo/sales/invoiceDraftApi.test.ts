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
  it('reads exact-deposit schema3 while preserving its canonical amount and edit identity',()=>{
    const exact={...snapshot,schema_version:3,kind:'deposit',deposit_basis_points:null,deposit_minor:50000,
      items:[{...snapshot.items[0],unit_minor:350000,quantity:1}],total_minor:350000,due_now_minor:50000,remainder_minor:300000};
    const before=structuredClone(exact);
    const read=readInvoiceDraft(row({billing_draft:exact,amount_total_cents:350000}),tenant);
    expect(read).toMatchObject({schemaVersion:3,totalMinor:350000,snapshot:{deposit_minor:50000,due_now_minor:50000,remainder_minor:300000}});
    expect(exact).toEqual(before);
    expect(readInvoiceDraft(row({billing_draft:{...exact,schema_version:4},amount_total_cents:350000}),tenant)).toBeNull();
  });
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
  it('isolates commercial-condition edits from the saved invoice snapshot',()=>{
    const conditions={schema_version:1 as const,tax:{state:'recorded' as const,source:'Recorded policy',policy:'Included in line 1',charges:[{line_index:0,amount_minor:100,currency:'usd' as const}]},fees:{state:'unknown' as const,source:null,policy:null,charges:[]}};
    const saved={...snapshot,commercial_conditions:conditions};
    const edited=snapshotEditInput(saved);
    edited.commercial_conditions!.tax.charges[0].amount_minor=200;
    expect(saved.commercial_conditions.tax.charges[0].amount_minor).toBe(100);
  });
  it('saves and reopens explicit conditions with an exact deposit without changing obligation amounts',async()=>{
    const exact:InvoiceSnapshot={...snapshot,schema_version:3,kind:'deposit',deposit_basis_points:null,deposit_minor:50000,
      items:[{...snapshot.items[0],unit_minor:350000,quantity:1}],total_minor:350000,due_now_minor:50000,remainder_minor:300000,
      commercial_conditions:{schema_version:1,tax:{state:'not_applicable',source:'Synthetic reviewed terms',policy:'No tax applies',charges:[]},fees:{state:'recorded',source:'Synthetic recorded invoice line',policy:'Fee already included in principal',charges:[{line_index:0,amount_minor:1000,currency:'usd'}]}}};
    const persisted=row({billing_draft:exact,amount_total_cents:350000});
    const rpc=vi.fn().mockResolvedValue({data:{row:persisted},error:null});
    const exactRequest={...request,draft:snapshotEditInput(exact)};
    const result=await saveInvoiceDraft(rpc,exactRequest);
    expect(result).toMatchObject({ok:true,value:{snapshot:{commercial_conditions:exact.commercial_conditions,due_now_minor:50000,remainder_minor:300000}}});
    expect(rpc.mock.calls[0][1]._draft.commercial_conditions).toEqual(exact.commercial_conditions);
    const reopened=readInvoiceDraft(structuredClone(persisted),tenant)!;
    expect(snapshotEditInput(reopened.snapshot).commercial_conditions).toEqual(exact.commercial_conditions);
    expect(readInvoiceDraft({...persisted,status:'issued'},tenant)).toBeNull();
    expect(readInvoiceDraft({...persisted,tenant_id:id},tenant)).toBeNull();
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
