import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {verifySalesStripeIngress,routeSalesStripeIngress} from './stripe-ingress.ts';
import {salesStripeSecret,salesStripeObservationsEnabled} from './stripe-configuration.ts';
const forbidden=vi.hoisted(()=>vi.fn(()=>{throw Error('Provider reads are outside signal registration');}));
vi.mock('./stripe-client.ts',()=>({salesStripeClient:forbidden}));
const source=readFileSync(new URL('../../stripe-webhook/index.ts',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'ts',format:'cjs'}).code;
const workId='55555555-5555-4555-8555-555555555555';
function gateway(options:{enabled?:string;native?:unknown}={}){
 const rpc=vi.fn(async()=>({data:options.native??{state:'registered',work:{work_id:workId,work_status:'queued',attempt_count:1,max_attempts:25}},error:null}));
 const table=vi.fn(()=>{throw Error('Unexpected platform or customer table access');});
 const logs:unknown[]=[];
 const environment:Record<string,string>={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-not-a-key',
  STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_PLATFORM',STRIPE_SECRET_KEY_V2:'sk_live_SYNTHETIC_V2',
  STRIPE_WEBHOOK_SECRET:'primary-signing-fixture',STRIPE_WEBHOOK_SECRET_V2:'v2-signing-fixture',
  SALES_STRIPE_SECRET_KEY:'sk_test_SYNTHETIC_SALES',SALES_STRIPE_WEBHOOK_SECRET:'sales-signing-fixture',
  SALES_STRIPE_OBSERVATIONS_ENABLED:options.enabled??'false'};
 class SDK{
  static createSubtleCryptoProvider(){return {};}
  constructor(_key:string,_options:unknown){}
  webhooks={constructEventAsync:async(body:string,signature:string,secret:string)=>{
   if(signature!=='signed-'+secret)throw Error('Signature refused');return JSON.parse(body);
  }};
 }
 let handler:((req:Request)=>Promise<Response>)|undefined;
 const modules:Record<string,unknown>={
  '../_shared/sales-payments/stripe-ingress.ts':{verifySalesStripeIngress,routeSalesStripeIngress},
  '../_shared/sales-payments/stripe-configuration.ts':{salesStripeSecret,salesStripeObservationsEnabled},
  'https://deno.land/std@0.190.0/http/server.ts':{serve:(fn:typeof handler)=>{handler=fn;}},
  'https://esm.sh/stripe@18.5.0':SDK,
  'https://esm.sh/@supabase/supabase-js@2.57.2':{createClient:()=>({rpc,from:table})},
  '../_shared/platform-billing.ts':{upsertBillingAccount:()=>{throw Error('No platform fulfillment');}},
  '../_shared/contact-methods.ts':{findSoleClientByEmailAnyWorkspace:()=>{throw Error('No client lookup');}},
  '../_shared/payment-setup-reconciliation.ts':{reconcilePaymentSetup:()=>{throw Error('No platform setup');}},
  '../_shared/solo-beta-offer.ts':{SOLO_BETA_OFFER_CODE:'synthetic'},
  '../_shared/solo-beta-stripe-shapes.ts':{readInvoiceSubscriptionId:()=>{throw Error('No platform subscription');}},
 };
 const require=(name:string)=>{if(!Object.hasOwn(modules,name))throw Error('Unexpected import '+name);return modules[name];};
 new Function('require','exports','Deno','console',compiled)(require,{}, {env:{get:(name:string)=>environment[name]}},{log:(...args:unknown[])=>logs.push(args),error:(...args:unknown[])=>logs.push(args)});
 if(!handler)throw Error('Actual gateway did not register its handler');
 const send=async(event:unknown,signature='signed-sales-signing-fixture')=>{
  const response=await handler!(new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':signature},body:JSON.stringify(event)}));
  return {status:response.status,body:await response.json()};
 };
 return {send,rpc,table,logs};
}
const refund={id:'evt_refund',type:'refund.created',account:'acct_A',livemode:false,data:{object:{
 object:'refund',id:'re_fixture',charge:'ch_fixture',amount:1,status:'succeeded',metadata:{tenant_id:'untrusted'}}}};
describe('actual original webhook and canonical Sales signal adapters',()=>{
 it('authenticates the distinct Sales namespace and registers the original native work without a platform effect',async()=>{
  const f=gateway({enabled:'true'});expect(await f.send(refund)).toEqual({status:200,body:{code:'PROVIDER_OBSERVATION_REGISTERED'}});
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('register_sales_provider_observation_event',{
   _event_id:'evt_refund',_event_type:'refund.created',_merchant_account_id:'acct_A',_environment:'test',_provider_transaction_id:'ch_fixture'});
  expect(f.table).not.toHaveBeenCalled();expect(forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify(f.logs)).not.toContain('sk_test_SYNTHETIC_SALES');
 });
 it('keeps an unapproved observation activation from registering or dispatching anything',async()=>{
  const f=gateway();expect(await f.send(refund)).toEqual({status:200,body:{code:'OTHER_SALES_EVENT'}});
  expect(f.rpc).not.toHaveBeenCalled();expect(f.table).not.toHaveBeenCalled();
 });
 it('rejects an invalid signature before service/native access',async()=>{
  const f=gateway({enabled:'true'});expect((await f.send(refund,'invalid')).status).toBe(400);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.table).not.toHaveBeenCalled();
 });
 it('does not let a Sales-only signed non-commercial event reach subscription or fulfillment writers',async()=>{
  const f=gateway({enabled:'true'});expect(await f.send({id:'evt_other',type:'customer.subscription.created',data:{object:{}}})).toEqual({status:200,body:{code:'OTHER_SALES_EVENT'}});
  expect(f.rpc).not.toHaveBeenCalled();expect(f.table).not.toHaveBeenCalled();
 });
 it('preserves retryable verification pending instead of claiming a refund or allocation completed',async()=>{
  const f=gateway({enabled:'true',native:{state:'verification_pending'}});
  expect(await f.send(refund)).toEqual({status:503,body:{code:'PROVIDER_OBSERVATION_READBACK_REQUIRED'}});
  expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.table).not.toHaveBeenCalled();
 });
 it('routes original primary signatures through the same native signal contract',async()=>{
  const f=gateway({enabled:'true'});expect(await f.send(refund,'signed-primary-signing-fixture')).toEqual({status:200,body:{code:'PROVIDER_OBSERVATION_REGISTERED'}});
  expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.table).not.toHaveBeenCalled();
 });
 it('refuses a malformed connected-account reference before the native effect',async()=>{
  const f=gateway({enabled:'true'});expect((await f.send({...refund,account:'acct_bad!'})).status).toBe(400);
  expect(f.rpc).not.toHaveBeenCalled();expect(f.table).not.toHaveBeenCalled();
 });
});
