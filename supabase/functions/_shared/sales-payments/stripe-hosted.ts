import type {PaymentRequest,ProviderOperation} from './payment-contract.ts';
import type {ProviderEnvironment} from './merchant.ts';

type JsonRecord=Record<string,unknown>;
const record=(v:unknown):JsonRecord|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as JsonRecord:null;
export type HostedPaymentState='provider_accepted'|'customer_action_required'|'outcome_unknown'|'settled'|'failed'|'expired';
export interface HostedPaymentReadback {
 state:HostedPaymentState;code?:string;provider_object_id?:string;hosted_url?:string;
 provider_transaction_id?:string;provider_settlement_id?:string;amount_minor?:number;currency?:string;
 provider_received_at?:string;expires_at?:string;
}
/** Adapter to the existing Stripe client, not a provider gateway or an authority resolver.
 * Its caller must already have canonical actor/Trust/merchant readiness and a persisted dispatch claim.
 * No raw Stripe response or credentials leave this module. */
export interface StripeHostedClient {
 environment:ProviderEnvironment;
 createSession(params:JsonRecord,options:{stripeAccount:string;idempotencyKey:string}):Promise<unknown>;
 retrieveSession(id:string,params:{expand:string[]},options:{stripeAccount:string}):Promise<unknown>;
 listSessions(params:{limit:number;created:{gte:number};starting_after?:string},options:{stripeAccount:string}):Promise<unknown>;
}
const unknown=():HostedPaymentReadback=>({state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});
function definiteRequestRefusal(error:unknown):boolean {
 const e=record(error);
 // Only explicit SDK HTTP refusal classes. Conflicting/retained idempotency and transport
 // failures remain uncertain; raw messages/response bodies never become public evidence.
 return !!e&&((e.type==='StripeAuthenticationError'&&e.statusCode===401)||
  (e.type==='StripePermissionError'&&e.statusCode===403)||
  (e.type==='StripeInvalidRequestError'&&e.statusCode===400&&e.code!=='idempotency_key_in_use'));
}
function bind(request:PaymentRequest,op:ProviderOperation,client:StripeHostedClient) {
 if(op.provider!=='stripe'||op.tenant_id!==request.tenant_id||op.request_id!==request.id||
  !/^acct_[A-Za-z0-9]+$/.test(op.merchant_id)||!op.id||!op.idempotency_key||
  op.application_fee_minor!==0||!Number.isSafeInteger(op.merchant_version)||op.merchant_version<1||
  !Number.isSafeInteger(request.amount_minor)||request.amount_minor<=0||request.amount_minor>2147483647||
  !/^[a-z]{3}$/.test(request.currency)||!request.invoice_id||!request.client_id)
  throw new Error('PAYMENT_OPERATION_SCOPE_MISMATCH');
 if(!['test','live'].includes(op.environment)||client.environment!==op.environment)throw new Error('MERCHANT_ENVIRONMENT_MISMATCH');
}
function metadata(request:PaymentRequest,op:ProviderOperation) {
 return {paige_operation_id:op.id,paige_request_id:request.id,tenant_id:request.tenant_id,invoice_id:request.invoice_id,client_id:request.client_id};
}
function matchesMetadata(value:unknown,expected:JsonRecord):boolean {
 const meta=record(value);return !!meta&&Object.entries(expected).every(([key,value])=>meta[key]===value);
}
function hostedUrl(value:unknown):string|undefined {
 if(typeof value!=='string'||value.length>4096)return;
 try {const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&!url.username&&!url.password&&!url.port)return value;}catch { /* No external URL guessing. */ }
}
function project(request:PaymentRequest,op:ProviderOperation,value:unknown):HostedPaymentReadback {
 const session=record(value),expected=metadata(request,op),live=op.environment==='live';
 if(!session||typeof session.id!=='string'||!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id)||
  session.livemode!==live||session.mode!=='payment'||session.client_reference_id!==op.id||
  !matchesMetadata(session.metadata,expected)||session.amount_total!==request.amount_minor||session.currency!==request.currency)return unknown();
 const base={provider_object_id:session.id};
 if(session.status==='expired')return {state:'expired',...base};
 const url=hostedUrl(session.url);
 if(session.status==='open'){
  if(!url||!Number.isSafeInteger(session.expires_at)||Number(session.expires_at)<=Math.floor(Date.now()/1000))return unknown();
  return {state:'customer_action_required',...base,hosted_url:url,expires_at:new Date(Number(session.expires_at)*1000).toISOString()};
 }
 if(session.status!=='complete')return unknown();
 const intent=record(session.payment_intent);
 if(!intent)return {state:'provider_accepted',...base};
 if(typeof intent.id!=='string'||!/^pi_[A-Za-z0-9]+$/.test(intent.id)||intent.livemode!==live||
  intent.amount!==request.amount_minor||intent.currency!==request.currency||!matchesMetadata(intent.metadata,expected))return unknown();
 if(intent.status==='canceled')return {state:'failed',...base};
 if(intent.status!=='succeeded'||session.payment_status!=='paid')return {state:'provider_accepted',...base};
 const charge=record(intent.latest_charge),balance=record(charge?.balance_transaction);
 // Settlement is captured customer payment supported by an available provider balance entry,
 // not a tenant bank payout. Pending balance/intent/redirect never changes the invoice.
 if(intent.amount_received!==request.amount_minor||!charge||!balance||typeof charge.id!=='string'||!/^ch_[A-Za-z0-9]+$/.test(charge.id)||
  charge.livemode!==live||charge.status!=='succeeded'||charge.paid!==true||charge.captured!==true||
  !Number.isSafeInteger(charge.created)||Number(charge.created)<=0||Number(charge.created)>Math.floor(Date.now()/1000)||
  charge.amount!==request.amount_minor||charge.amount_captured!==request.amount_minor||charge.currency!==request.currency||
  charge.payment_intent!==intent.id||charge.amount_refunded!==0||charge.refunded!==false||charge.disputed!==false||
  (charge.application_fee_amount!==null&&charge.application_fee_amount!==0)||charge.transfer!==null||charge.transfer_data!==null||
  typeof balance.id!=='string'||!/^txn_[A-Za-z0-9]+$/.test(balance.id)||balance.source!==charge.id||balance.type!=='charge'||
  balance.amount!==request.amount_minor||balance.currency!==request.currency)return unknown();
 if(balance.status!=='available')return {state:'provider_accepted',...base};
 return {state:'settled',...base,provider_transaction_id:charge.id,provider_settlement_id:balance.id,amount_minor:request.amount_minor,currency:request.currency,provider_received_at:new Date(Number(charge.created)*1000).toISOString()};
}
export async function createStripeHostedRequest(request:PaymentRequest,op:ProviderOperation,client:StripeHostedClient,publicOrigin:string):Promise<HostedPaymentReadback> {
 bind(request,op,client);
 if(!['prepared','dispatching'].includes(op.state)||op.provider_operation_id!==null)return unknown();
 // Deployment-controlled origin only. This function never accepts customer/model redirect URLs.
 const origin=new URL(publicOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('PAYMENT_PUBLIC_ORIGIN_INVALID');
 const meta=metadata(request,op);
 try {
  const value=await client.createSession({mode:'payment',client_reference_id:op.id,metadata:meta,
   line_items:[{quantity:1,price_data:{currency:request.currency,unit_amount:request.amount_minor,product_data:{name:'Invoice payment'}}}],
   payment_intent_data:{metadata:meta},success_url:`${origin.origin}/payment-return`,cancel_url:`${origin.origin}/payment-return`},
   {stripeAccount:op.merchant_id,idempotencyKey:op.idempotency_key});
  const result=project(request,op,value);
  return result.state==='settled'?{state:'provider_accepted',provider_object_id:result.provider_object_id}:result;
 }catch(error) {return definiteRequestRefusal(error)?{state:'failed',code:'PAYMENT_REQUEST_REFUSED'}:unknown();}
}
/** Recovery never dispatches. If the provider identity was lost, bounded account-scoped listing
 * locates the immutable reference. Truncation/zero/multiple matches remain unknown; no blind retry. */
export async function readStripeHostedRequest(request:PaymentRequest,op:ProviderOperation,client:StripeHostedClient,objectId:string|null,createdAfter?:number,deadline=Date.now()+40_000):Promise<HostedPaymentReadback> {
 bind(request,op,client);
 if(op.provider_operation_id!==null&&objectId!==op.provider_operation_id)return unknown();
 try {
  let id=objectId;
  if(!id){
   if(!Number.isSafeInteger(createdAfter)||(createdAfter as number)<0)return unknown();
   let cursor:string|undefined;const candidates:string[]=[];let complete=false;
   for(let page=0;page<10;page++){
    if(Date.now()>=deadline)return unknown();
    const response=record(await client.listSessions({limit:100,created:{gte:createdAfter as number},...(cursor?{starting_after:cursor}:{})},{stripeAccount:op.merchant_id}));
    if(!response||!Array.isArray(response.data)||response.data.length>100||typeof response.has_more!=='boolean')return unknown();
    for(const item of response.data){const session=record(item);if(session?.client_reference_id===op.id&&matchesMetadata(session.metadata,metadata(request,op))&&typeof session.id==='string')candidates.push(session.id);}
    if(candidates.length>1)return unknown();
    if(response.has_more===false){complete=true;break;}
    const last=record(response.data.at(-1));if(!last||typeof last.id!=='string'||last.id===cursor)return unknown();cursor=last.id;
   }
   if(!complete||candidates.length!==1)return unknown();id=candidates[0];
  }
  if(!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(id))return unknown();
  if(Date.now()>=deadline)return unknown();
  const value=await client.retrieveSession(id,{expand:['payment_intent.latest_charge.balance_transaction']},{stripeAccount:op.merchant_id});
  if(record(value)?.id!==id)return unknown();return project(request,op,value);
 }catch {return unknown();}
}
