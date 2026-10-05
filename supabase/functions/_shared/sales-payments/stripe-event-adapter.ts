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
