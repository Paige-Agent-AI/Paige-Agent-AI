import type {ClaimedPayment} from './request-execution.ts';
import {readStripeHostedRequest,type HostedPaymentReadback,type StripeHostedClient} from './stripe-hosted.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface SalesStripeEventPorts {
 stripe:StripeHostedClient;
 readOperation(tenantId:string,operationId:string):Promise<ClaimedPayment>;
 merchantStillBound(claim:ClaimedPayment):Promise<boolean>;
 persistReadback(claim:ClaimedPayment,result:HostedPaymentReadback,eventId:string):Promise<void>;
}
/** Called ONLY after the canonical ingress authenticates the Stripe signature. Event metadata
 * locates an immutable operation; no event amount/status can become settlement truth. A fresh
 * account-scoped provider GET/list decides the outcome. Persist failure returns retryable 503. */
export async function reconcileVerifiedSalesStripeEvent(eventValue:unknown,verifiedPlatform:'legacy'|'v2',ports:SalesStripeEventPorts):Promise<{handled:boolean;status:number;code:string}> {
 const event=object(eventValue),data=object(event?.data),payload=object(data?.object),meta=object(payload?.metadata);
 if(!meta||meta.paige_operation_id===undefined)return {handled:false,status:200,code:'OTHER_DOMAIN'};
 if(typeof meta.paige_operation_id!=='string'||!UUID.test(meta.paige_operation_id)||typeof meta.tenant_id!=='string'||!UUID.test(meta.tenant_id)||
  !event||typeof event.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(event.id)||typeof event.account!=='string'||
  !/^acct_[A-Za-z0-9]+$/.test(event.account)||typeof event.livemode!=='boolean'||verifiedPlatform!=='legacy')return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
 try {
  const claim=await ports.readOperation(meta.tenant_id,meta.paige_operation_id),op=claim.operation;
  if(op.provider!=='stripe'||op.merchant_id!==event.account||op.environment!==(event.livemode?'live':'test')||
   op.tenant_id!==meta.tenant_id||op.id!==meta.paige_operation_id||op.environment!==ports.stripe.environment||!await ports.merchantStillBound(claim))return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
  if(claim.operation.state==='prepared'||!claim.claimToken)return {handled:true,status:409,code:'PAYMENT_DISPATCH_NOT_ESTABLISHED'};
  if(typeof event.type!=='string')return {handled:true,status:400,code:'PAYMENT_EVENT_SCOPE_REFUSED'};
  if(event.type.startsWith('checkout.session.')&&op.provider_operation_id!==null&&payload?.id!==op.provider_operation_id)return {handled:true,status:400,code:'PAYMENT_EVENT_OBJECT_REFUSED'};
  const started=Date.parse(claim.dispatchStartedAt);
  if(!Number.isFinite(started))return {handled:true,status:503,code:'PAYMENT_READBACK_REQUIRED'};
  const result=await readStripeHostedRequest(claim.request,op,ports.stripe,op.provider_operation_id,Math.max(0,Math.floor(started/1000)-60));
  await ports.persistReadback(claim,result,event.id);
  return {handled:true,status:result.state==='outcome_unknown'?503:200,code:result.state==='outcome_unknown'?'PAYMENT_READBACK_REQUIRED':'PAYMENT_EVENT_RECONCILED'};
 }catch {return {handled:true,status:503,code:'PAYMENT_READBACK_REQUIRED'};}
}
