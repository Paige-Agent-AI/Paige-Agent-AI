import {parseCanonicalPaymentRequestCommand} from './request-command.ts';
import type {ClaimedPayment} from './request-execution.ts';
import type {ProviderOperationState} from './payment-contract.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const states=['prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','settled','failed','expired','cancelled'];
/** Internal database rows never pass directly to Chat/UI/Rail. All immutable facts are checked
 * against the saved exact command before they can be supplied to the provider adapter. */
export function parseClaimedPayment(value:unknown,tenantId:string,actorId:string,operationId:string):ClaimedPayment {
 const row=record(value);if(!row)throw new Error('PAYMENT_OPERATION_UNAVAILABLE');
 const command=parseCanonicalPaymentRequestCommand(row.command);
 if(row.id!==operationId||row.tenant_id!==tenantId||row.actor_user_id!==actorId||!UUID.test(operationId)||
  row.invoice_id!==command.invoice_id||row.client_id!==command.client_id||row.invoice_version!==command.expected_version||
  row.issued_snapshot_version!==command.issued_snapshot_version||row.amount_minor!==command.amount_minor||row.currency!==command.currency||
  row.provider!==command.provider||row.merchant_account_id!==command.merchant_account_id||row.merchant_binding_version!==command.merchant_binding_version||
  row.environment!==command.environment||row.purpose!==command.purpose||typeof row.idempotency_key!=='string'||row.idempotency_key!==`sales-payment-${operationId}`||
  typeof row.state!=='string'||!states.includes(row.state)||
  (row.provider_object_id!==null&&(typeof row.provider_object_id!=='string'||!/^cs_[A-Za-z0-9_]{1,124}$/.test(row.provider_object_id))))throw new Error('PAYMENT_OPERATION_UNAVAILABLE');
 const prepared=row.state==='prepared';
 const undispatched=prepared||(row.state==='cancelled'&&row.dispatch_claim_token===null&&row.dispatch_started_at===null&&row.provider_object_id===null);
 if(prepared&&(row.dispatch_claim_token!==null||row.dispatch_started_at!==null||row.provider_object_id!==null))throw new Error('PAYMENT_OPERATION_UNAVAILABLE');
 if(!undispatched&&(typeof row.dispatch_claim_token!=='string'||!UUID.test(row.dispatch_claim_token)||typeof row.dispatch_started_at!=='string'||!Number.isFinite(Date.parse(row.dispatch_started_at))))throw new Error('PAYMENT_OPERATION_UNAVAILABLE');
 return {request:{id:operationId,tenant_id:tenantId,invoice_id:command.invoice_id,invoice_version:command.expected_version,
  issued_snapshot_version:command.issued_snapshot_version,client_id:command.client_id,commercial_package_id:null,amount_minor:command.amount_minor,
  currency:command.currency,purpose:command.purpose,idempotency_key:row.idempotency_key},
  operation:{id:operationId,tenant_id:tenantId,request_id:operationId,provider:command.provider,merchant_id:command.merchant_account_id,
   merchant_version:command.merchant_binding_version,environment:command.environment,idempotency_key:row.idempotency_key,
   provider_operation_id:row.provider_object_id as string|null,state:row.state as ProviderOperationState,application_fee_minor:0},
  claimToken:undispatched?'':row.dispatch_claim_token as string,dispatchStartedAt:undispatched?'':row.dispatch_started_at as string};
}
export function safePaymentOperation(value:unknown):Record<string,unknown> {
 const row=record(value);if(!row||typeof row.state!=='string'||!states.includes(row.state))throw new Error('PAYMENT_READBACK_UNAVAILABLE');
 const result:Record<string,unknown>={ok:true,outcome:row.state};
 for(const key of ['id','invoice_id','client_id','amount_minor','currency','provider','merchant_account_id','environment','provider_object_id','created_at','updated_at','expires_at']){
  const v=row[key];if(typeof v==='string'||typeof v==='number'||v===null)result[key==='id'?'operation_id':key]=v;
 }
 // Hosted capability URL is emitted only for customer action, never a guessed or stale link.
 if(row.state==='customer_action_required'&&typeof row.provider_url==='string'&&typeof row.expires_at==='string'&&Date.parse(row.expires_at)>Date.now()){
  const u=new URL(row.provider_url);if(u.protocol==='https:'&&u.hostname==='checkout.stripe.com'&&!u.username&&!u.password&&!u.port)result.payment_url=row.provider_url;
 }
 return result;
}
