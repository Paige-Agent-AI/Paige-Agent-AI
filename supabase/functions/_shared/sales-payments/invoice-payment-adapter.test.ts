import {describe,it,expect,vi} from 'vitest';
import {preparePaymentReview,type PaymentCaller} from './invoice-payment-adapter.ts';
import type {SalesPaymentAdmin} from './database-port.ts';
const h=vi.hoisted(()=>({reads:[] as string[],tenant:''}));
vi.mock('./stripe-client.ts',()=>({salesStripeClient:()=>({environment:'test',retrieveAccount:async(id:string)=>{
 h.reads.push(id);return {id,metadata:{tenant_id:h.tenant},charges_enabled:true,payouts_enabled:true,
 details_submitted:true,capabilities:{card_payments:'active'},requirements:{disabled_reason:null}};
}})}));
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',
 invoice='33333333-3333-4333-8333-333333333333',client='44444444-4444-4444-8444-444444444444';
const reference={commercial_terms_id:'55555555-5555-4555-8555-555555555555',signing_id:'66666666-6666-4666-8666-666666666666',signing_version:4,terms_version:1,sequence:1};
const obligation={reference,source_digest:'a'.repeat(64),due_date:'2026-10-15',scheduled_minor:50000,remaining_minor:50000};
const source={tenant_id:tenant,client_id:client,invoice_id:invoice,invoice_version:2,issued_snapshot_version:1,obligation};
const intent={action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'deposit',obligation_reference:reference};
function fixture(){
 h.reads=[];h.tenant=tenant;const calls:{name:string;args:Record<string,unknown>}[]=[];
 let native:unknown=structuredClone(source),failure=false,current=true;
 const caller:PaymentCaller={tenantId:tenant,actorId:actor,operationId:'77777777-7777-4777-8777-777777777777',stillCurrent:async()=>current};
 const admin={from:(table:string)=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:invoice,tenant_id:tenant,contact_id:client},error:null})}),maybeSingle:async()=>({data:{stripe_account_id:'acct_fixtureA',binding_version:1,provider_environment:'test',country:'US',default_currency:'usd',requirements:{}},error:null})})})}),
  rpc:async(name:string,args:Record<string,unknown>)=>{
   calls.push({name,args});
   if(name==='_sales_invoice_read')return {data:{id:invoice,tenant_id:tenant,version:2,issued_snapshot_version:1,status:'issued',currency:'usd',remaining_cents:350000},error:null};
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
   _actor_user_id:actor,_expected_tenant_id:tenant,_invoice_id:invoice,_reference:selected.reference});
  expect(h.reads).toEqual(['acct_fixtureA']);
 });
 it('retains legacy full request without an accepted-target read',async()=>{
  const f=fixture();const result=await f.run({action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'full'});
  expect(result.amount_minor).toBe(350000);expect(result).not.toHaveProperty('obligation');
  expect(f.calls.some(c=>c.name==='read_sales_invoice_payment_obligation')).toBe(false);
 });
 it('native refusal stops before provider readiness read or review',async()=>{
  const f=fixture();f.deny();await expect(f.run()).rejects.toThrow('PAYMENT_OBLIGATION_UNAVAILABLE');expect(h.reads).toEqual([]);
 });
 it.each(['tenant_id','client_id','invoice_id','invoice_version','issued_snapshot_version'])('refuses changed native %s before provider read',async field=>{
  const f=fixture();f.native({...source,[field]:field.endsWith('version')?3:'88888888-8888-4888-8888-888888888888'});
  await expect(f.run()).rejects.toThrow('PAYMENT_OBLIGATION_CHANGED');expect(h.reads).toEqual([]);
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
});
