// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {preparePaymentReview,executeInvoicePaymentRequest,type PaymentCaller} from './invoice-payment-adapter.ts';
import type {SalesPaymentAdmin} from './database-port.ts';
const h=vi.hoisted(()=>({reads:[] as string[],effects:[] as string[],tenant:''}));
vi.mock('./stripe-client.ts',()=>({salesStripeClient:()=>({environment:'test',retrieveAccount:async(id:string)=>{
 h.reads.push(id);return {id,metadata:{tenant_id:h.tenant},charges_enabled:true,payouts_enabled:true,
 details_submitted:true,capabilities:{card_payments:'active'},requirements:{disabled_reason:null}};
},createSession:async()=>{h.effects.push('POST');throw Error('Synthetic provider POST is forbidden in this recovery proof');},
 retrieveSession:async()=>{h.effects.push('GET');throw Error('Synthetic unavailable readback');},
 listSessions:async()=>{h.effects.push('GET');throw Error('Synthetic unavailable readback');}})}));
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',
 invoice='33333333-3333-4333-8333-333333333333',client='44444444-4444-4444-8444-444444444444';
const reference={commercial_terms_id:'55555555-5555-4555-8555-555555555555',signing_id:'66666666-6666-4666-8666-666666666666',signing_version:4,terms_version:1,sequence:1};
const obligation={reference,source_digest:'a'.repeat(64),due_date:'2026-10-15',scheduled_minor:50000,remaining_minor:50000};
const source={financial_evidence_version:3,tenant_id:tenant,client_id:client,invoice_id:invoice,invoice_version:2,issued_snapshot_version:1,
 status:'issued',currency:'usd',financial_standing:'recorded',actual_outstanding_minor:350000,refund_payable_minor:10000,source_hash:'b'.repeat(64),obligation};
const intent={action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'deposit',obligation_reference:reference};
function fixture(){
 h.reads=[];h.tenant=tenant;const calls:{name:string;args:Record<string,unknown>}[]=[];
 let native:unknown=structuredClone(source),failure=false,current=true;
 const caller:PaymentCaller={tenantId:tenant,actorId:actor,operationId:'77777777-7777-4777-8777-777777777777',stillCurrent:async()=>current};
 const admin={from:(table:string)=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:invoice,tenant_id:tenant,contact_id:client,billing_lifecycle_version:2,billing_issued_snapshot_version:1,status:'issued',currency:'USD'},error:null})}),maybeSingle:async()=>({data:{stripe_account_id:'acct_fixtureA',binding_version:1,provider_environment:'test',country:'US',default_currency:'usd',requirements:{}},error:null})})})}),
  rpc:async(name:string,args:Record<string,unknown>)=>{
   calls.push({name,args});
   if(name==='read_sales_invoice_payment_obligation')return {data:native,error:failure?{code:'42501',message:'private refusal'}:null};
   if(name==='record_sales_stripe_readback')return {data:1,error:null};
   throw Error('Unexpected original adapter RPC '+name);
  }} as unknown as SalesPaymentAdmin;
 return {calls,run:(value:unknown=intent)=>preparePaymentReview(admin,caller,value,'synthetic-test-only'),
  native:(value:unknown)=>{native=value;},deny:()=>{failure=true;},leave:()=>{current=false;}};
}
describe('actual payment review adapter with synthetic native/Stripe GET ports',()=>{
 it.each(['deposit','installment'])('binds accepted %s from original native source',async purpose=>{
  const f=fixture(),sequence=purpose==='deposit'?1:2;
  const selected={...obligation,reference:{...reference,sequence}};
  f.native({...source,obligation:selected});
  const result=await f.run({...intent,purpose,obligation_reference:selected.reference});
  expect(result).toMatchObject({purpose,amount_minor:50000,obligation:selected});
  expect(f.calls.find(c=>c.name==='read_sales_invoice_payment_obligation')?.args).toEqual({
   _actor_user_id:actor,_expected_tenant_id:tenant,_invoice_id:invoice,_reference:{financial_evidence_version:3,reference:selected.reference}});
  expect(h.reads).toEqual(['acct_fixtureA']);
 });
 it('a full request uses actual debt without subtracting a separate refund payable',async()=>{
  const f=fixture();f.native({...source,obligation:null});const result=await f.run({action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'full'});
  expect(result.amount_minor).toBe(350000);expect(result).not.toHaveProperty('obligation');
  expect(f.calls.find(c=>c.name==='read_sales_invoice_payment_obligation')?.args._reference).toEqual({financial_evidence_version:3,reference:null});
  expect(f.calls.some(c=>c.name==='_sales_invoice_read')).toBe(false);
 });
 it('native refusal stops before provider readiness read or review',async()=>{
  const f=fixture();f.deny();await expect(f.run()).rejects.toThrow('PAYMENT_CONTEXT_UNAVAILABLE');expect(h.reads).toEqual([]);
 });
 it.each(['tenant_id','client_id','invoice_id','invoice_version','issued_snapshot_version'])('refuses changed native %s before provider read',async field=>{
  const f=fixture();f.native({...source,[field]:field.endsWith('version')?3:'88888888-8888-4888-8888-888888888888'});
  await expect(f.run()).rejects.toThrow('PAYMENT_CONTEXT_CHANGED');expect(h.reads).toEqual([]);
 });
 it('refuses a different accepted selector before provider read',async()=>{
  const f=fixture();f.native({...source,obligation:{...obligation,reference:{...reference,sequence:2}}});
  await expect(f.run()).rejects.toThrow('PAYMENT_OBLIGATION_CHANGED');expect(h.reads).toEqual([]);
 });
 it('an allocated target cannot create another review',async()=>{
  const f=fixture();f.native({...source,obligation:{...obligation,remaining_minor:0}});
  await expect(f.run()).rejects.toThrow('PAYMENT_OBLIGATION_ALREADY_ALLOCATED');expect(h.reads).toEqual([]);
 });
 it('workspace loss stops before provider read and readback persistence',async()=>{
  const f=fixture();f.leave();await expect(f.run()).rejects.toThrow('WORKSPACE_CHANGED');expect(h.reads).toEqual([]);
  expect(f.calls.some(c=>c.name==='record_sales_stripe_readback')).toBe(false);
 });
 it.each([
  {financial_evidence_version:2},{financial_standing:'needs_review',actual_outstanding_minor:null,refund_payable_minor:null},
  {source_hash:null},{source_hash:'x'.repeat(64)},{actual_outstanding_minor:-1},{actual_outstanding_minor:1.5},
  {refund_payable_minor:-1},{invented_provider_balance:0},{status:'void'},{issued_snapshot_version:null},
 ])('missing or malformed current financial facts stop before provider readiness: %j',async patch=>{
  const f=fixture();f.native({...source,...patch});await expect(f.run()).rejects.toThrow('PAYMENT_CONTEXT_UNAVAILABLE');expect(h.reads).toEqual([]);
 });
 it('a whole invoice refund can be collected again from the authoritative amount',async()=>{
  const f=fixture();f.native({...source,actual_outstanding_minor:10000,refund_payable_minor:0,obligation:null});
  const result=await f.run({action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'full'});
  expect(result.amount_minor).toBe(10000);expect(f.calls.some(c=>c.name==='_sales_invoice_read')).toBe(false);
 });
 it('zero actual debt refuses before any provider readiness request',async()=>{
  const f=fixture();f.native({...source,actual_outstanding_minor:0,obligation:null});
  await expect(f.run({action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'full'})).rejects.toThrow('PAYMENT_CONTEXT_UNAVAILABLE');
  expect(h.reads).toEqual([]);
 });
});

function recoveryFixture(){
 h.reads=[];h.effects=[];h.tenant=tenant;
 const id='77777777-7777-4777-8777-777777777777',command={action:'invoice.payment_request' as const,invoice_id:invoice,client_id:client,expected_version:2,issued_snapshot_version:1,
  provider:'stripe' as const,merchant_account_id:'acct_fixtureA',merchant_binding_version:1,environment:'test' as const,amount_minor:10000,currency:'usd',purpose:'full' as const};
 const row={id,tenant_id:tenant,actor_user_id:actor,invoice_id:invoice,client_id:client,invoice_version:2,issued_snapshot_version:1,
  provider:'stripe',merchant_account_id:'acct_fixtureA',merchant_binding_version:1,environment:'test',amount_minor:10000,currency:'usd',purpose:'full',
  command,idempotency_key:'sales-payment-'+id,state:'prepared',provider_object_id:null,dispatch_claim_token:null,dispatch_started_at:null,
  provider_status:null,cancellation_reason:null};
 let saved:Record<string,unknown>={...row},claimCode='40001',cancelPatch:Record<string,unknown>={},loseCancellation=false,current=true;
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const admin={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='prepare_sales_invoice_payment_request')return {data:{...saved},error:null};
  if(name==='claim_sales_invoice_payment_request')return {data:null,error:{code:claimCode}};
  if(name==='cancel_prepared_sales_invoice_payment_request'){
   saved={...saved,state:'cancelled',provider_status:'not_dispatched',cancellation_reason:'invoice_changed'};
   const {dispatch_claim_token:omitted,...publicResult}=saved;void omitted;
   return loseCancellation?{data:null,error:{}}:{data:{...publicResult,...cancelPatch},error:null};
  }
  if(name==='read_sales_invoice_payment_dispatch'||name==='read_sales_invoice_payment_request')return {data:{...saved},error:null};
  throw Error('Unexpected recovery RPC '+name);
 }} as unknown as SalesPaymentAdmin;
 const caller:PaymentCaller={actorId:actor,tenantId:tenant,operationId:id,stillCurrent:async()=>current};
 return {id,calls,run:()=>executeInvoicePaymentRequest(admin,caller,command,{},'synthetic-test-only','https://unit-test.invalid'),
  patch:(value:Record<string,unknown>)=>{cancelPatch=value;},lose:()=>{loseCancellation=true;},leave:()=>{current=false;},
  saved:(value:Record<string,unknown>)=>{saved={...saved,...value};},
  claimed:()=>{claimCode='55000';saved={...saved,state:'dispatching',dispatch_claim_token:'88888888-8888-4888-8888-888888888888',dispatch_started_at:new Date().toISOString()};},
  deny:()=>{claimCode='42501';}};
}
describe('original undispatched recovery through the actual payment adapter',()=>{
 it('closes a stale unclaimed original request without dispatch, provider read or new work',async()=>{
  const f=recoveryFixture(),result=await f.run();expect(result).toMatchObject({ok:true,outcome:'cancelled',operation_id:f.id});
  expect(f.calls.map(c=>c.name)).toEqual(['prepare_sales_invoice_payment_request','claim_sales_invoice_payment_request','read_sales_invoice_payment_dispatch','cancel_prepared_sales_invoice_payment_request','read_sales_invoice_payment_dispatch','read_sales_invoice_payment_request']);
  expect(f.calls[3].args).toEqual({_expected_tenant_id:tenant,_operation_id:f.id,_reason:'invoice_changed'});
  expect(h.effects).toEqual([]);
 });
 it.each([
  {tenant_id:'99999999-9999-4999-8999-999999999999'},
  {actor_user_id:'99999999-9999-4999-8999-999999999999'},
  {id:'99999999-9999-4999-8999-999999999999'},
  {provider_object_id:'cs_test_alreadyDispatched'},
  {dispatch_started_at:new Date().toISOString()},
  {dispatch_claim_token:null},
 ])('ambiguous or mismatched cancellation cannot become a verified result: %j',async patch=>{
  const f=recoveryFixture();f.patch(patch);expect(await f.run()).toMatchObject({ok:false,outcome:'outcome_unknown'});
  expect(f.calls.filter(c=>c.name==='read_sales_invoice_payment_dispatch')).toHaveLength(1);expect(h.effects).toEqual([]);
 });
 it.each(['tenant_id','actor_user_id','id'])('a mismatched original %s is refused before any cancellation',async field=>{
  const f=recoveryFixture();f.saved({[field]:'99999999-9999-4999-8999-999999999999'});
  expect(await f.run()).toMatchObject({ok:false,outcome:'outcome_unknown'});
  expect(f.calls.some(c=>c.name==='cancel_prepared_sales_invoice_payment_request')).toBe(false);expect(h.effects).toEqual([]);
 });
 it('lost cancellation acknowledgement remains unknown and recovers the same original result later',async()=>{
  const f=recoveryFixture();f.lose();expect(await f.run()).toMatchObject({ok:false,outcome:'outcome_unknown'});
  expect(await f.run()).toMatchObject({ok:true,outcome:'cancelled',operation_id:f.id});
  expect(f.calls.filter(c=>c.name==='cancel_prepared_sales_invoice_payment_request')).toHaveLength(1);expect(h.effects).toEqual([]);
 });
 it('an already claimed request retains GET-only reconciliation and is never cancelled here',async()=>{
  const f=recoveryFixture();f.claimed();await f.run();
  expect(f.calls.some(c=>c.name==='cancel_prepared_sales_invoice_payment_request')).toBe(false);
  expect(h.effects).toContain('GET');expect(h.effects).not.toContain('POST');
 });
 it('a role refusal does not authorize cancellation or dispatch',async()=>{
  const f=recoveryFixture();f.deny();expect(await f.run()).toMatchObject({ok:false,outcome:'outcome_unknown'});
  expect(f.calls.some(c=>c.name==='cancel_prepared_sales_invoice_payment_request')).toBe(false);expect(h.effects).toEqual([]);
 });
 it('a departed workspace cannot start claim or recovery',async()=>{
  const f=recoveryFixture();f.leave();expect(await f.run()).toMatchObject({ok:false,outcome:'refused'});
  expect(f.calls.map(c=>c.name)).toEqual(['prepare_sales_invoice_payment_request']);expect(h.effects).toEqual([]);
 });
});
