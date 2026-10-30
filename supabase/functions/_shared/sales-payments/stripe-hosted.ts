import type {PaymentRequest,ProviderOperation,VerifiedSettlement} from './payment-contract.ts';
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
function bind(request:PaymentRequest,op:ProviderOperation,client:Pick<StripeHostedClient,'environment'>) {
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

/** GET-only ports on the same pinned Stripe client. This reader cannot create a refund,
 * decide a credit, change an invoice, or reclassify the original immutable settlement. */
export interface StripeAdjustmentClient {
 environment:ProviderEnvironment;
 retrieveCharge(id:string,params:{expand:string[]},options:{stripeAccount:string}):Promise<unknown>;
 listRefunds(params:{charge:string;limit:number;starting_after?:string;expand:string[]},options:{stripeAccount:string}):Promise<unknown>;
 listDisputes(params:{charge:string;limit:number;starting_after?:string},options:{stripeAccount:string}):Promise<unknown>;
}
interface ProviderBalanceObservation {
 id:string;amount_minor:number;currency:string;status:'available'|'pending';created_at:string;
}
interface RefundObservation {
 id:string;amount_minor:number;currency:string;created_at:string;status:'pending'|'requires_action'|'succeeded'|'failed'|'canceled';
 balance_transaction:ProviderBalanceObservation|null;failure_balance_transaction:ProviderBalanceObservation|null;
}
interface DisputeObservation {
 id:string;amount_minor:number;currency:string;created_at:string;status:string;balance_transactions:ProviderBalanceObservation[];
}
export type StripePaymentAdjustments = {
 state:'observed';provider_transaction_id:string;provider_settlement_id:string;
 refunds:RefundObservation[];disputes:DisputeObservation[];
}|{state:'outcome_unknown';code:'PROVIDER_ADJUSTMENT_READBACK_REQUIRED'};
const adjustmentUnknown=():StripePaymentAdjustments=>({state:'outcome_unknown',code:'PROVIDER_ADJUSTMENT_READBACK_REQUIRED'});
const minor=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=2147483647;
const providerTime=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=Math.floor(Date.now()/1000);
const refundStates=['pending','requires_action','succeeded','failed','canceled'] as const;
// API versions may add states. An unrecognised state remains verification-pending instead
// of guessing whether the customer or merchant won or money was returned.
const disputeStates=['warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost'];
function providerBalance(value:unknown,source:string,amount:number,currency:string,type:string):ProviderBalanceObservation {
 const row=record(value);
 if(!row||typeof row.id!=='string'||!/^txn_[A-Za-z0-9]+$/.test(row.id)||row.source!==source||row.type!==type||
  row.amount!==amount||row.currency!==currency||typeof row.status!=='string'||!['available','pending'].includes(row.status)||!providerTime(row.created))throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
 return {id:row.id,amount_minor:amount,currency,status:row.status as 'available'|'pending',created_at:new Date(Number(row.created)*1000).toISOString()};
}
/** The native original-operation reader must supply the already verified settlement.
 * Provider event payloads and user-entered refund amounts are never accepted as its source.
 * Native persistence/financial interpretation is a separate, not-yet-mounted contract. */
export async function readStripePaymentAdjustments(request:PaymentRequest,op:ProviderOperation,settlement:VerifiedSettlement,client:StripeAdjustmentClient,deadline=Date.now()+40_000):Promise<StripePaymentAdjustments> {
 try {
  bind(request,op,client);
  if(op.state!=='settled'||settlement.state!=='verified'||settlement.tenant_id!==request.tenant_id||
   settlement.operation_id!==op.id||settlement.provider!==op.provider||settlement.merchant_id!==op.merchant_id||settlement.environment!==op.environment||
   !minor(settlement.amount_minor)||settlement.amount_minor!==request.amount_minor||settlement.currency!==request.currency||
   !/^ch_[A-Za-z0-9]+$/.test(settlement.provider_transaction_id)||!/^txn_[A-Za-z0-9]+$/.test(settlement.provider_settlement_id)||
   !settlement.id||!settlement.readback_reference||Date.now()>=deadline)return adjustmentUnknown();
  const sourceFingerprint=(value:unknown)=>{
   const row=record(value),payment=record(row?.payment_intent),entry=record(row?.balance_transaction),meta=record(payment?.metadata);
   return JSON.stringify([
    ...['id','object','livemode','status','paid','captured','amount','amount_captured','amount_refunded','currency','refunded','disputed','created','application_fee_amount','transfer','transfer_data'].map(key=>row?.[key]),
    ...['id','source','amount','currency','status','created','type'].map(key=>entry?.[key]),
    ...['id','livemode','status','amount','amount_received','currency'].map(key=>payment?.[key]),
    ...Object.keys(metadata(request,op)).map(key=>meta?.[key]),
   ]);
  };
  const options={stripeAccount:op.merchant_id},params={expand:['payment_intent','balance_transaction']};
  const raw=await client.retrieveCharge(settlement.provider_transaction_id,params,options),charge=record(raw),intent=record(charge?.payment_intent);
  if(!charge||!intent||charge.id!==settlement.provider_transaction_id||charge.object!=='charge'||charge.livemode!==(op.environment==='live')||
   charge.status!=='succeeded'||charge.paid!==true||charge.captured!==true||charge.amount!==request.amount_minor||charge.amount_captured!==request.amount_minor||
   charge.currency!==request.currency||!providerTime(charge.created)||!Number.isSafeInteger(charge.amount_refunded)||Number(charge.amount_refunded)<0||Number(charge.amount_refunded)>request.amount_minor||
   typeof charge.refunded!=='boolean'||charge.refunded!==(charge.amount_refunded===request.amount_minor)||typeof charge.disputed!=='boolean'||
   (charge.application_fee_amount!==null&&charge.application_fee_amount!==0)||charge.transfer!==null||charge.transfer_data!==null||
   typeof intent.id!=='string'||!/^pi_[A-Za-z0-9]+$/.test(intent.id)||intent.livemode!==(op.environment==='live')||intent.status!=='succeeded'||
   intent.amount!==request.amount_minor||intent.amount_received!==request.amount_minor||intent.currency!==request.currency||!matchesMetadata(intent.metadata,metadata(request,op)))return adjustmentUnknown();
  const captureBalance=providerBalance(charge.balance_transaction,charge.id as string,request.amount_minor,request.currency,'charge');
  if(captureBalance.id!==settlement.provider_settlement_id||captureBalance.status!=='available')return adjustmentUnknown();
  const originalSourceFingerprint=sourceFingerprint(raw);
  const readAll=async(kind:'refunds'|'disputes'):Promise<JsonRecord[]>=>{
   const rows:JsonRecord[]=[],ids=new Set<string>();let cursor:string|undefined;
   for(let page=0;page<10;page++){
    if(Date.now()>=deadline)throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
    const scope={charge:settlement.provider_transaction_id,limit:100,...(cursor?{starting_after:cursor}:{})};
    const result=record(await(kind==='refunds'?client.listRefunds({...scope,expand:['data.balance_transaction','data.failure_balance_transaction']},options):client.listDisputes(scope,options)));
    if(!result||result.object!=='list'||!Array.isArray(result.data)||result.data.length>100||typeof result.has_more!=='boolean')throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
    for(const item of result.data){const row=record(item);if(!row||typeof row.id!=='string'||ids.has(row.id))throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');ids.add(row.id);rows.push(row);}
    if(result.has_more===false)return rows;
    if(result.data.length===0)throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
    cursor=rows.at(-1)!.id as string;
   }
   throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
  };
  const rawRefunds=await readAll('refunds'),rawDisputes=await readAll('disputes'),balanceIds=new Set([captureBalance.id]);
  const retainBalance=(value:unknown,source:string,amount:number,type:string)=>{
   const result=providerBalance(value,source,amount,request.currency,type);if(balanceIds.has(result.id))throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');balanceIds.add(result.id);return result;
  };
  const refunds:RefundObservation[]=rawRefunds.map(row=>{
   if(!/^re_[A-Za-z0-9]+$/.test(row.id as string)||row.object!=='refund'||row.charge!==charge.id||row.payment_intent!==intent.id||row.currency!==request.currency||
    !minor(row.amount)||row.amount>request.amount_minor||!providerTime(row.created)||!refundStates.includes(row.status as typeof refundStates[number])||
    row.source_transfer_reversal!==null||row.transfer_reversal!==null)throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
   const debit=row.balance_transaction===null?null:retainBalance(row.balance_transaction,row.id as string,-row.amount,'refund');
   const failure=row.failure_balance_transaction===null?null:retainBalance(row.failure_balance_transaction,row.id as string,row.amount,'refund_failure');
   if((row.status==='succeeded'&&(!debit||failure))||(failure&&(!debit||!['failed','canceled'].includes(String(row.status))))||
    (debit&&['failed','canceled'].includes(String(row.status))&&!failure))throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
   return {id:row.id as string,amount_minor:row.amount,currency:request.currency,created_at:new Date(Number(row.created)*1000).toISOString(),status:row.status as RefundObservation['status'],balance_transaction:debit,failure_balance_transaction:failure};
  });
  const disputes:DisputeObservation[]=rawDisputes.map(row=>{
   if(!/^du_[A-Za-z0-9]+$/.test(row.id as string)||row.object!=='dispute'||row.charge!==charge.id||row.payment_intent!==intent.id||row.livemode!==(op.environment==='live')||
    row.currency!==request.currency||!minor(row.amount)||row.amount>request.amount_minor||!providerTime(row.created)||typeof row.status!=='string'||!disputeStates.includes(row.status)||
    !Array.isArray(row.balance_transactions)||row.balance_transactions.length>2)throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
   const amount=row.amount,moves=row.balance_transactions.map(value=>{
    const item=record(value);if(!item||![amount,-amount].includes(Number(item.amount)))throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
    return retainBalance(item,row.id as string,Number(item.amount),'adjustment');
   });
   if(moves.length===2&&moves[0].amount_minor===moves[1].amount_minor)throw Error('PROVIDER_ADJUSTMENT_READBACK_REQUIRED');
   return {id:row.id as string,amount_minor:amount,currency:request.currency,created_at:new Date(Number(row.created)*1000).toISOString(),status:row.status,balance_transactions:moves};
  });
  if(charge.disputed&&disputes.length===0)return adjustmentUnknown();
  const succeeded=refunds.filter(row=>row.status==='succeeded').reduce((sum,row)=>sum+row.amount_minor,0),inFlight=refunds.filter(row=>row.status==='pending'||row.status==='requires_action').reduce((sum,row)=>sum+row.amount_minor,0);
  // Provider consistency only, never a receivable or available-cash calculation.
  if(Number(charge.amount_refunded)<succeeded||Number(charge.amount_refunded)>succeeded+inFlight||Date.now()>=deadline)return adjustmentUnknown();
  const latest=await client.retrieveCharge(settlement.provider_transaction_id,params,options);
  if(sourceFingerprint(latest)!==originalSourceFingerprint||Date.now()>=deadline)return adjustmentUnknown();
  return {state:'observed',provider_transaction_id:settlement.provider_transaction_id,provider_settlement_id:settlement.provider_settlement_id,refunds,disputes};
 }catch {return adjustmentUnknown();}
}
