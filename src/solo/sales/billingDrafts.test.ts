import { describe, expect, it, vi } from 'vitest';
import { billingDraftEditInput, listBillingDrafts, readBillingDraft, saveBillingDraft, type BillingDraftInput } from './billingDrafts';
const tenant='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const draft: BillingDraftInput={client_id:'33333333-3333-4333-8333-333333333333',price_id:null,item:'Service',unit_minor:1000,quantity:1,kind:'deposit',deposit_basis_points:2500,provider:'paypal',currency:'usd',due_date:'2026-10-16',recipient_email:'billing@example.com',memo:'',cadence:null};
const row=(override:Record<string,unknown>={})=>({id,tenant_id:tenant,invoice_number:'DRAFT-'+id,status:'draft',billing_draft_version:1,amount_total_cents:1000,billing_draft:{...draft,due_now_minor:250,remainder_minor:750},...override});
const request={openedTenantId:tenant,invoiceId:id,expectedVersion:0,operationId:'44444444-4444-4444-8444-444444444444',draft};
describe('canonical draft response boundary',()=>{
  it('accepts SQL-normalized absent optionals and a server-resolved catalog price',async()=>{
    const catalog={...draft,price_id:'55555555-5555-4555-8555-555555555555',unit_minor:null,memo:null,recipient_email:null,due_date:null};
    const persisted=row({billing_draft:{...catalog,unit_minor:1000,due_now_minor:250,remainder_minor:750}});
    const rpc=vi.fn().mockResolvedValue({data:{row:persisted},error:null});
    expect(await saveBillingDraft(rpc,{...request,draft:catalog})).toMatchObject({ok:true,value:{facts:{unit_minor:1000,memo:null}}});
    expect(rpc.mock.calls[0][1]._draft.unit_minor).toBeNull();
    expect(readBillingDraft(persisted,tenant)).not.toBeNull();
    const facts=readBillingDraft(persisted,tenant)!.facts;
    const edit=billingDraftEditInput({...facts,memo:'Updated'});
    expect(edit.unit_minor).toBeNull(); expect(edit.memo).toBe('Updated');
    expect(Object.keys(edit)).not.toContain('due_now_minor');
  });
  it('reads a persisted draft without claiming issue or provider connection',()=>expect(readBillingDraft(row(),tenant)?.dueNowMinor).toBe(250));
  it.each([{tenant_id:id},{status:'paid'},{billing_draft_version:0},{amount_total_cents:null},{billing_draft:{...draft,due_now_minor:251,remainder_minor:750}}])('rejects wrong scope, non-draft and incomplete facts',bad=>expect(readBillingDraft(row(bad),tenant)).toBeNull());
  it('sends the opened workspace and stable retry identity unchanged',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{row:row()},error:null});
    expect((await saveBillingDraft(rpc,request)).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('save_sales_billing_draft',{_expected_tenant_id:tenant,_invoice_id:id,_expected_version:0,_operation_id:request.operationId,_draft:draft});
  });
  it('never reports an unknown transport result as refusal or success',async()=>{
    const rpc=vi.fn().mockRejectedValue(new Error('provider-secret-must-not-render'));
    const result=await saveBillingDraft(rpc,request);
    expect(result).toMatchObject({ok:false,outcome:'unknown'});expect(JSON.stringify(result)).not.toContain('provider-secret');
  });
  it('distinguishes absent deployment and stale-version refusal',async()=>{
    expect(await saveBillingDraft(vi.fn().mockResolvedValue({data:null,error:{code:'PGRST202'}}),request)).toMatchObject({outcome:'unavailable'});
    expect(await saveBillingDraft(vi.fn().mockResolvedValue({data:null,error:{code:'40001'}}),request)).toMatchObject({outcome:'refused'});
  });
  it('refuses a response for a different invoice',async()=>expect(await saveBillingDraft(vi.fn().mockResolvedValue({data:{row:row({id:tenant})},error:null}),request)).toMatchObject({ok:false,outcome:'unknown'}));
  it('rejects cross-workspace rows instead of showing a partial list',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{rows:[row({tenant_id:id})],has_more:false,next_cursor:null},error:null});
    expect(await listBillingDrafts(rpc,tenant)).toMatchObject({ok:false});
  });
  it('accepts a real empty response only from the guarded list RPC',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{rows:[],has_more:false,next_cursor:null},error:null});
    expect(await listBillingDrafts(rpc,tenant)).toEqual({ok:true,value:{rows:[],hasMore:false,nextCursor:null}});
    expect(rpc).toHaveBeenCalledWith('list_sales_billing_drafts',{_expected_tenant_id:tenant,_limit:50,_before_id:null});
  });
});
