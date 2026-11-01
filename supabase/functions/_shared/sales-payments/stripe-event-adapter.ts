import type {SalesPaymentAdmin} from './database-port.ts';
import {salesStripeClient} from './stripe-client.ts';
import {readStripeHostedRequest} from './stripe-hosted.ts';
import {parseClaimedPayment} from './operation-projection.ts';
import {persistProviderPaymentReadback} from './invoice-payment-adapter.ts';
import {reconcileVerifiedSalesStripeEvent,type SalesStripeEventPorts} from './stripe-event.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export async function routeVerifiedSalesStripeEvent(admin:SalesPaymentAdmin,event:unknown,verifiedPlatform:'legacy'|'v2',secret:string):Promise<{handled:boolean;status:number;code:string}> {
 const value=object(event),payload=object(object(value?.data)?.object),meta=object(payload?.metadata);
 if(meta?.paige_operation_id===undefined&&value?.type!=='balance.available')return {handled:false,status:200,code:'OTHER_DOMAIN'};
 try {
  const stripe=salesStripeClient(secret);
  const ports:SalesStripeEventPorts={stripe,
   readOperation:async(tenantId,operationId)=>{
    const r=await admin.rpc('read_sales_invoice_payment_dispatch',{_expected_tenant_id:tenantId,_operation_id:operationId});
    const row=object(r.data);if(r.error||!row||typeof row.actor_user_id!=='string')throw new Error('PAYMENT_OPERATION_UNAVAILABLE');
    return parseClaimedPayment(row,tenantId,row.actor_user_id,operationId);
   },
   merchantStillBound:async claim=>{
    const r=await admin.from('tenant_stripe_accounts').select('stripe_account_id,binding_version,provider_environment').eq('tenant_id',claim.operation.tenant_id).maybeSingle();
    return !r.error&&r.data?.stripe_account_id===claim.operation.merchant_id&&r.data?.binding_version===claim.operation.merchant_version&&r.data?.provider_environment===claim.operation.environment;
   },
   persistReadback:(claim,result,eventId)=>persistProviderPaymentReadback(admin,claim,result,eventId),
  };
  if(value?.type!=='balance.available')return reconcileVerifiedSalesStripeEvent(event,verifiedPlatform,ports);
  // Balance availability lacks per-payment metadata. Resolve the exact signed connected account,
  // then reconcile only its already-authorized canonical requests. Platform Billing is untouched.
  if(typeof value.account!=='string'||verifiedPlatform!=='legacy')return {handled:false,status:200,code:'OTHER_DOMAIN'};
  if(value.livemode!==(stripe.environment==='live')||typeof value.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(value.id))return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
  const merchant=await admin.from('tenant_stripe_accounts').select('tenant_id,provider_environment').eq('stripe_account_id',value.account).maybeSingle();
  if(merchant.error)return {handled:true,status:503,code:'PAYMENT_READBACK_REQUIRED'};
  if(!merchant.data)return {handled:false,status:200,code:'OTHER_DOMAIN'};
  if(typeof merchant.data.tenant_id!=='string')throw new Error('PAYMENT_MERCHANT_UNAVAILABLE');
  if(merchant.data.provider_environment!==stripe.environment)return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
  // A signed availability event can read exhausted operations without resetting work.
  // Each successful readback leaves this event's bounded batch, so retries progress.
  const batch=await admin.rpc('read_sales_balance_event_operations',{_expected_tenant_id:merchant.data.tenant_id,_merchant_account_id:value.account,_environment:stripe.environment,_event_id:value.id,_limit:3});
  const body=object(batch.data);
  if(batch.error||!body||!Array.isArray(body.rows)||body.rows.length>3||typeof body.has_more!=='boolean')throw new Error('PAYMENT_READBACK_REQUIRED');
  let unknown=false;
  await Promise.all(body.rows.map(async rowValue=>{
   const row=object(rowValue);if(!row||typeof row.id!=='string'||typeof row.actor_user_id!=='string')throw new Error('PAYMENT_READBACK_REQUIRED');
   const claim=parseClaimedPayment(row,String(merchant.data!.tenant_id),row.actor_user_id,row.id);
   if(!await ports.merchantStillBound(claim))throw new Error('PAYMENT_READBACK_REQUIRED');
   const result=await readStripeHostedRequest(claim.request,claim.operation,stripe,claim.operation.provider_operation_id,Math.max(0,Math.floor(Date.parse(claim.dispatchStartedAt)/1000)-60));
   await ports.persistReadback(claim,result,String(value.id));
   if(result.state==='outcome_unknown'){unknown=true;return;}
   const complete=await admin.rpc('complete_sales_balance_event_readback',{_expected_tenant_id:claim.operation.tenant_id,_operation_id:claim.operation.id,_merchant_account_id:value.account,_environment:stripe.environment,_event_id:value.id});
   if(complete.error)throw new Error('PAYMENT_READBACK_REQUIRED');
  }));
  return {handled:true,status:body.has_more||unknown?503:200,code:body.has_more||unknown?'PAYMENT_READBACK_REQUIRED':'PAYMENT_EVENT_RECONCILED'};
 }catch {return {handled:true,status:503,code:'PAYMENT_READBACK_REQUIRED'};}
}

const adjustmentEvents:Readonly<Record<string,'charge'|'refund'|'dispute'>>={
 'charge.refunded':'charge','charge.refund.updated':'refund',
 'refund.created':'refund','refund.updated':'refund','refund.failed':'refund',
 'charge.dispute.created':'dispute','charge.dispute.updated':'dispute','charge.dispute.closed':'dispute',
 'charge.dispute.funds_withdrawn':'dispute','charge.dispute.funds_reinstated':'dispute',
};
/** UNMOUNTED candidate in the SAME adapter. The existing ingress must verify the
 * signature first. Payload metadata, amount and status are never financial truth;
 * native scope resolves the original receipt and registers its existing C4 work.
 * No provider call, refund/credit, balance write or new settlement dispatch. */
export async function registerVerifiedSalesStripeAdjustmentEvent(admin:SalesPaymentAdmin,event:unknown,
 verifiedPlatform:'legacy'|'v2',environment:'test'|'live'):Promise<{handled:boolean;status:number;code:string}>{
 const value=object(event),kind=typeof value?.type==='string'&&Object.hasOwn(adjustmentEvents,value.type)?adjustmentEvents[value.type]:undefined;
 if(!kind)return {handled:false,status:200,code:'OTHER_DOMAIN'};
 const payload=object(object(value?.data)?.object),charge=kind==='charge'?payload?.id:payload?.charge;
 const prefix=kind==='charge'?'ch':kind==='refund'?'re':'du';
 if(verifiedPlatform!=='legacy'||!value||typeof value.id!=='string'||!/^evt_[A-Za-z0-9]{1,124}$/.test(value.id)
  ||typeof value.account!=='string'||!/^acct_[A-Za-z0-9]{1,123}$/.test(value.account)||typeof value.livemode!=='boolean'
  ||!['test','live'].includes(environment)||value.livemode!==(environment==='live')||!payload||payload.object!==kind
  ||typeof payload.id!=='string'||!new RegExp('^'+prefix+'_[A-Za-z0-9]{1,125}$').test(payload.id)
  ||typeof charge!=='string'||!/^ch_[A-Za-z0-9]{1,125}$/.test(charge)
  ||(payload.livemode!==undefined&&payload.livemode!==value.livemode))return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
 try{
  const response=await admin.rpc('register_sales_provider_observation_event',{_event_id:value.id,_event_type:value.type,
   _merchant_account_id:value.account,_environment:environment,_provider_transaction_id:charge});
  const result=object(response.data);
  if(response.error||!result)throw Error('PROVIDER_OBSERVATION_READBACK_REQUIRED');
  if(result.state==='other_domain')return {handled:false,status:200,code:'OTHER_DOMAIN'};
  if(result.state==='verification_pending')return {handled:true,status:503,code:'PROVIDER_OBSERVATION_READBACK_REQUIRED'};
  const work=object(result.work);
  if(result.state!=='registered'||!work||typeof work.work_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(work.work_id)
   ||typeof work.work_status!=='string'||!/^[a-z_]{1,40}$/.test(work.work_status)||work.max_attempts!==25
   ||!Number.isSafeInteger(work.attempt_count)||Number(work.attempt_count)<1||Number(work.attempt_count)>25)throw Error('PROVIDER_OBSERVATION_READBACK_REQUIRED');
  // Registration/replay proves only that the original event occurrence exists.
  // It does not assert that a blocked/terminal work item will run or money moved.
  return {handled:true,status:200,code:'PROVIDER_OBSERVATION_REGISTERED'};
 }catch{return {handled:true,status:503,code:'PROVIDER_OBSERVATION_READBACK_REQUIRED'};}
}
