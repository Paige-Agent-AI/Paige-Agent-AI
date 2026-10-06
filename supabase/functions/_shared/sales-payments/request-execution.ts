import type {PaymentRequest,ProviderOperation} from './payment-contract.ts';
import {createStripeHostedRequest,readStripeHostedRequest,type HostedPaymentReadback,type StripeHostedClient} from './stripe-hosted.ts';

export interface ClaimedPayment {
 request:PaymentRequest; operation:ProviderOperation; claimToken:string; dispatchStartedAt:string;
}
/** Service adapter only. Authority and immutable preparation belong to the canonical Trust/RPC
 * door. A claim is persisted before the only provider dispatch; recovery never dispatches. */
export interface PaymentExecutionPorts {
 stillCurrent():Promise<boolean>;
 claim():Promise<ClaimedPayment|null>;
 readInternal():Promise<ClaimedPayment>;
 persist(claim:ClaimedPayment,result:HostedPaymentReadback):Promise<void>;
 readSafe():Promise<Record<string,unknown>>;
 stripe:StripeHostedClient;
 publicOrigin:string;
}
const uncertain=()=>({ok:false,outcome:'outcome_unknown',code:'PAYMENT_READBACK_REQUIRED'});
export async function dispatchPreparedPayment(ports:PaymentExecutionPorts):Promise<Record<string,unknown>> {
 if(!await ports.stillCurrent())return {ok:false,outcome:'refused',code:'WORKSPACE_CHANGED'};
 let claim:ClaimedPayment|null;
 try {claim=await ports.claim();}catch {return uncertain();}
 // A competing worker/crash recovery must not reuse a dispatch claim as permission to POST.
 if(!claim)return reconcilePayment(ports);
 if(claim.operation.state!=='dispatching'||!claim.claimToken)return uncertain();
 if(!await ports.stillCurrent()){
  // No provider call took place, but retain the persisted claim as uncertain rather than
  // reopening it for a second worker. Governed recovery can inspect/close the operation.
  try {await ports.persist(claim,{state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});}catch { /* Never imply rollback or a safe retry. */ }
  return {ok:false,outcome:'refused',code:'WORKSPACE_CHANGED'};
 }
 let result:HostedPaymentReadback;
 try {result=await createStripeHostedRequest(claim.request,claim.operation,ports.stripe,ports.publicOrigin);}
 catch {result={state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'};}
 try {await ports.persist(claim,result);return await ports.readSafe();}catch {return uncertain();}
}
export async function reconcilePayment(ports:PaymentExecutionPorts):Promise<Record<string,unknown>> {
 if(!await ports.stillCurrent())return {ok:false,outcome:'refused',code:'WORKSPACE_CHANGED'};
 try {
  const claim=await ports.readInternal();
  if(claim.operation.state==='prepared')return await ports.readSafe();
  if(['settled','failed','expired','cancelled'].includes(claim.operation.state))return await ports.readSafe();
  const started=Date.parse(claim.dispatchStartedAt);
  if(!claim.claimToken||!Number.isFinite(started))return uncertain();
  const result=await readStripeHostedRequest(claim.request,claim.operation,ports.stripe,
   claim.operation.provider_operation_id,Math.max(0,Math.floor(started/1000)-60));
  await ports.persist(claim,result);
  return await ports.readSafe();
 }catch {return uncertain();}
}
