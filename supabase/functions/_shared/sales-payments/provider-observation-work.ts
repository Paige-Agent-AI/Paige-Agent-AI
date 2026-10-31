import type {SalesPaymentAdmin} from './database-port.ts';
import type {VerifiedSettlement} from './payment-contract.ts';
import {parseClaimedPayment} from './operation-projection.ts';
import {readStripePaymentAdjustments,type StripeAdjustmentClient} from './stripe-hosted.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventId=/^evt_[A-Za-z0-9]{1,124}$/;
const version=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<Number.MAX_SAFE_INTEGER;
type ObservationClaim={work_id:string;tenant_id:string;operation_id:string;event_id:string;server_idempotency_key:string;attempt_count:number};
function parseClaim(value:unknown):ObservationClaim {
 const row=object(value);
 if(!row||!['work_id','tenant_id','operation_id'].every(k=>typeof row[k]==='string'&&uuid.test(String(row[k])))
  ||typeof row.event_id!=='string'||!eventId.test(row.event_id)||typeof row.server_idempotency_key!=='string'
  ||!/^paige-work:[0-9a-f-]{36}$/i.test(row.server_idempotency_key)||!Number.isInteger(row.attempt_count)
  ||Number(row.attempt_count)<1||Number(row.attempt_count)>25)throw Error('PROVIDER_OBSERVATION_WORK_UNAVAILABLE');
 return row as ObservationClaim;
}
function parseContext(value:unknown,work:ObservationClaim){
 const row=object(value),dispatch=object(row?.dispatch),s=object(row?.settlement),capture=object(dispatch?.verified_readback);
 if(!row||row.work_id!==work.work_id||row.event_id!==work.event_id||!dispatch||typeof dispatch.actor_user_id!=='string'
  ||!uuid.test(dispatch.actor_user_id)||!s||!capture||!version(row.observation_version)||row.observation_version!==dispatch.provider_observation_version
  ||row.observation_id!==dispatch.provider_observation_operation_id)throw Error('PROVIDER_OBSERVATION_CONTEXT_UNAVAILABLE');
 const claim=parseClaimedPayment(dispatch,work.tenant_id,dispatch.actor_user_id,work.operation_id);
 if(claim.operation.state!=='settled'||!claim.claimToken||typeof s.id!=='string'||!uuid.test(s.id)||s.id!==dispatch.allocation_payment_id
  ||s.tenant_id!==work.tenant_id||s.operation_id!==work.operation_id||s.provider!=='stripe'||s.merchant_id!==claim.operation.merchant_id
  ||s.environment!==claim.operation.environment||s.state!=='verified'||s.amount_minor!==claim.request.amount_minor||s.currency!==claim.request.currency
  ||typeof s.provider_transaction_id!=='string'||!/^ch_[A-Za-z0-9]{1,125}$/.test(s.provider_transaction_id)
  ||typeof s.provider_settlement_id!=='string'||!/^txn_[A-Za-z0-9]{1,124}$/.test(s.provider_settlement_id)
  ||typeof s.readback_reference!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(s.readback_reference)
  ||s.provider_transaction_id!==capture.provider_transaction_id||s.provider_settlement_id!==capture.provider_settlement_id
  ||s.amount_minor!==capture.amount_minor||s.currency!==capture.currency||s.readback_reference!==capture.readback_reference
  ||(row.observation_version===0?row.observation_id!==null:typeof row.observation_id!=='string'||!uuid.test(row.observation_id)))
  throw Error('PROVIDER_OBSERVATION_CONTEXT_UNAVAILABLE');
 const settlement:VerifiedSettlement={id:s.id,tenant_id:work.tenant_id,operation_id:work.operation_id,provider:'stripe',merchant_id:s.merchant_id,
  environment:claim.operation.environment,state:'verified',amount_minor:s.amount_minor,currency:s.currency,provider_transaction_id:s.provider_transaction_id,
  provider_settlement_id:s.provider_settlement_id,readback_reference:s.readback_reference};
 return {claim,settlement,observationVersion:row.observation_version};
}
/** Internal GET-only continuation; deliberately UNMOUNTED until its canonical native
 * carrier and ingress are released. No sender, timer, dispatch, refund or credit API.
 * Observed means source evidence was retained; it never means a financial action ran. */
export async function reconcileSalesProviderObservationWork(admin:SalesPaymentAdmin,stripe:StripeAdjustmentClient,limit=3):Promise<{
 claimed:number;observed:number;verificationPending:number;unverified:number;
}>{
 if(!Number.isInteger(limit)||limit<1||limit>3)throw Error('PROVIDER_OBSERVATION_BATCH_INVALID');
 const batch=await admin.rpc('claim_sales_provider_observation_work',{_limit:limit}),body=object(batch.data);
 if(batch.error||!body||!Array.isArray(body.claims)||body.claims.length>limit)throw Error('PROVIDER_OBSERVATION_WORK_UNAVAILABLE');
 const claims=body.claims.map(parseClaim);
 if(new Set(claims.map(c=>c.work_id)).size!==claims.length)throw Error('PROVIDER_OBSERVATION_WORK_UNAVAILABLE');
 const counts={claimed:claims.length,observed:0,verificationPending:0,unverified:0},deadline=Date.now()+40_000;
 await Promise.all(claims.map(async work=>{
  const lease={_expected_tenant_id:work.tenant_id,_work_id:work.work_id,_server_idempotency_key:work.server_idempotency_key,_attempt_count:work.attempt_count};
  const context=async()=>{const r=await admin.rpc('read_sales_provider_observation_work_context',lease);
   if(r.error)throw Error('PROVIDER_OBSERVATION_LEASE_UNAVAILABLE');return parseContext(r.data,work);};
  try{
   const before=await context();
   const result=await readStripePaymentAdjustments(before.claim.request,before.claim.operation,before.settlement,stripe,deadline);
   const after=await context();
   // Retain the incarnation read BEFORE the provider request. A later heartbeat
   // cannot upgrade old facts to a new source version or merchant binding.
   if(after.observationVersion!==before.observationVersion||JSON.stringify(after.settlement)!==JSON.stringify(before.settlement)
    ||JSON.stringify(after.claim)!==JSON.stringify(before.claim))throw Error('PROVIDER_OBSERVATION_SOURCE_CHANGED');
   const finish=await admin.rpc('complete_sales_provider_observation_work',{...lease,
    _expected_observation_version:result.state==='observed'?before.observationVersion:null,_snapshot:result.state==='observed'?result:null});
   const completed=object(finish.data);
   if(finish.error||!completed||completed.work_id!==work.work_id||typeof completed.replayed!=='boolean')throw Error('PROVIDER_OBSERVATION_READBACK_UNAVAILABLE');
   if(result.state==='outcome_unknown'){
    if(completed.work_status!=='blocked'||!['provider_observation_unknown','provider_observation_exhausted'].includes(String(completed.blocked_reason)))
     throw Error('PROVIDER_OBSERVATION_READBACK_UNAVAILABLE');
    counts.verificationPending++;return;
   }
   const receipt=object(completed.receipt);
   if(completed.work_status!=='succeeded'||completed.effect!=='provider_observation_only'||!receipt||receipt.verified_readback!==true
    ||receipt.effect!=='provider_observation_only'||receipt.provider_operation_id!==work.operation_id||typeof receipt.observation_id!=='string'
    ||!uuid.test(receipt.observation_id)||(!version(receipt.observation_version)&&receipt.observation_version!==Number.MAX_SAFE_INTEGER)||Number(receipt.observation_version)<1
    ||receipt.requested_observation_version!==before.observationVersion||typeof receipt.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.source_hash))
    throw Error('PROVIDER_OBSERVATION_READBACK_UNAVAILABLE');
   counts.observed++;
  }catch{
   // Lost acknowledgments stay unresolved here. The SAME canonical work/journal
   // handles retry; never issue a second completion or provider write on catch.
   counts.unverified++;
  }
 }));
 return counts;
}
