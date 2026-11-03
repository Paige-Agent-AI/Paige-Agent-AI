import type {SalesPaymentAdmin} from './database-port.ts';
import {parseClaimedPayment} from './operation-projection.ts';
import {readStripeHostedRequest,readStripePaymentAdjustments,type StripeHostedClient,type StripeAdjustmentClient} from './stripe-hosted.ts';
import {persistProviderPaymentReadback,persistCapturedPaymentObservation} from './invoice-payment-adapter.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Internal durable-work caller. No customer arguments, new authority, or provider POST. */
export async function reconcileSalesPaymentWork(admin:SalesPaymentAdmin,stripe:StripeHostedClient,limit=3,captureObservation=false,stripeForReadback?:(environment:'test'|'live')=>StripeHostedClient):Promise<{claimed:number;completed:number;checking:number;unverified:number}>{
 const batch=await admin.rpc('claim_sales_payment_reconciliation_work',{_limit:limit});const body=object(batch.data);
 if(batch.error||!body||!Array.isArray(body.claims)||body.claims.length>limit)throw Error('PAYMENT_WORK_UNAVAILABLE');
 const counts={claimed:body.claims.length,completed:0,checking:0,unverified:0};
 await Promise.all(body.claims.map(async value=>{
  try{
   const work=object(value);
   if(!work||typeof work.work_id!=='string'||typeof work.tenant_id!=='string'||typeof work.operation_id!=='string'
    ||![work.work_id,work.tenant_id,work.operation_id].every(v=>uuid.test(v))||typeof work.server_idempotency_key!=='string'
    ||typeof work.attempt_count!=='number'||!Number.isSafeInteger(work.attempt_count)||work.attempt_count<1)throw Error('PAYMENT_WORK_UNAVAILABLE');
   const lease={_expected_tenant_id:work.tenant_id,_work_id:work.work_id,_server_idempotency_key:work.server_idempotency_key,_attempt_count:work.attempt_count};
   const heartbeat=async()=>{const r=await admin.rpc('heartbeat_sales_payment_reconciliation_work',lease);if(r.error)throw Error('PAYMENT_WORK_LEASE_UNAVAILABLE');};
   await heartbeat();
   const read=await admin.rpc('read_sales_invoice_payment_dispatch',{_expected_tenant_id:work.tenant_id,_operation_id:work.operation_id});const row=object(read.data);
   if(read.error||!row||typeof row.actor_user_id!=='string')throw Error('PAYMENT_OPERATION_UNAVAILABLE');
   const claim=parseClaimedPayment(row,String(work.tenant_id),row.actor_user_id,String(work.operation_id));
   let state=claim.operation.state;
   if(!['settled','failed','expired','cancelled'].includes(state)){
    const merchant=await admin.from('tenant_stripe_accounts').select('stripe_account_id,binding_version,provider_environment').eq('tenant_id',claim.operation.tenant_id).maybeSingle();
    if(merchant.error||merchant.data?.stripe_account_id!==claim.operation.merchant_id||merchant.data?.binding_version!==claim.operation.merchant_version||merchant.data?.provider_environment!==claim.operation.environment)throw Error('MERCHANT_BINDING_CHANGED');
    const reader=stripeForReadback?.(claim.operation.environment)??stripe;
    if(reader.environment!==claim.operation.environment)throw Error('PROVIDER_ENVIRONMENT_MISMATCH');
    const createdAfter=Math.max(0,Math.floor(Date.parse(claim.dispatchStartedAt)/1000)-60),deadline=Date.now()+40_000;
    let result=captureObservation
     ?await readStripeHostedRequest(claim.request,claim.operation,reader,claim.operation.provider_operation_id,createdAfter,deadline,{captureObservation:true})
     :await readStripeHostedRequest(claim.request,claim.operation,reader,claim.operation.provider_operation_id,createdAfter);
    if(result.state==='capture_observed'){
     if(!captureObservation||!adjustmentClient(reader))throw Error('PAYMENT_ADJUSTMENT_READBACK_UNAVAILABLE');
     const snapshot=await readStripePaymentAdjustments(claim.request,claim.operation,result,reader,deadline,{captureObservation:true});
     await heartbeat();
     if(snapshot.state==='observed'){
      await persistCapturedPaymentObservation(admin,claim,lease,result,snapshot);
      counts.completed++;return;
     }
     result={state:'outcome_unknown',provider_object_id:result.provider_object_id};
    }else if(captureObservation&&result.state==='settled')throw Error('PAYMENT_ADJUSTMENT_READBACK_UNAVAILABLE');
    await heartbeat();
    await persistProviderPaymentReadback(admin,claim,result,`work-read-${claim.operation.id}`);
    state=result.state;
   }
   const outcome=['settled','failed','expired','cancelled'].includes(state)?state:state==='outcome_unknown'?'unknown':'pending';
   const finish=await admin.rpc('complete_sales_payment_reconciliation_work',{...lease,_outcome:outcome});
   if(finish.error)throw Error('PAYMENT_WORK_READBACK_UNAVAILABLE');
   if(['settled','failed','expired','cancelled'].includes(outcome))counts.completed++;else counts.checking++;
  }catch{counts.unverified++;}
 }));
 return counts;
}

function adjustmentClient(client:StripeHostedClient):client is StripeHostedClient&StripeAdjustmentClient {
 return 'retrieveCharge' in client&&typeof client.retrieveCharge==='function'
  &&'listRefunds' in client&&typeof client.listRefunds==='function'
  &&'listDisputes' in client&&typeof client.listDisputes==='function';
}
// The original entry point consumes this continuation only under its server activation gate.
export {reconcileSalesProviderObservationWork} from './provider-observation-work.ts';
