import type {SalesPaymentAdmin} from './database-port.ts';
import {buildPaymentRequestCommand,parsePaymentRequestIntent,paymentObligationForRequest,type PaymentRequestCommand} from './request-command.ts';
import {readStripeMerchant,type MerchantBinding} from './merchant.ts';
import {salesStripeClient} from './stripe-client.ts';
import {parseClaimedPayment,safePaymentOperation} from './operation-projection.ts';
import {dispatchPreparedPayment,reconcilePayment,type PaymentExecutionPorts} from './request-execution.ts';
import {databaseAnswered} from '../approval-outcome.ts';
import {verifiedSettlementInput,observedCaptureInput} from './settlement-readback.ts';
import type {ClaimedPayment} from './request-execution.ts';
import type {HostedPaymentReadback,CapturedPaymentReadback,StripePaymentAdjustments} from './stripe-hosted.ts';
import {parseInvoicePaymentFinancialContext,type InvoicePaymentFinancialContext} from './accepted-obligation.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sameObservation(left:unknown,right:unknown):boolean {
 if(left===right)return true;
 if(Array.isArray(left)){
  if(!Array.isArray(right)||left.length!==right.length)return false;
  // Refunds, disputes and their balance transactions are ID sets. The original
  // native writer orders them canonically; compare every fact without requiring
  // provider order (or mutating either snapshot), and never accept duplicate IDs.
  const byId=new Map<string,unknown>(),seen=new Set<string>();
  for(const entry of right){
   const id=object(entry)?.id;
   if(typeof id!=='string'||byId.has(id))return false;
   byId.set(id,entry);
  }
  return left.every(entry=>{
   const id=object(entry)?.id;
   if(typeof id!=='string'||seen.has(id)||!byId.has(id))return false;
   seen.add(id);return sameObservation(entry,byId.get(id));
  });
 }
 const a=object(left),b=object(right);
 return !!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameObservation(a[k],b[k]));
}
export interface PaymentCaller {tenantId:string;actorId:string;operationId:string;stillCurrent:()=>Promise<boolean>}
export interface PaymentWorkLease {_expected_tenant_id:string;_work_id:string;_server_idempotency_key:string;_attempt_count:number}
/** One native transaction; never send a captured-only observation to the standalone allocator. */
export async function persistCapturedPaymentObservation(admin:SalesPaymentAdmin,claim:ClaimedPayment,lease:PaymentWorkLease,
 capture:CapturedPaymentReadback,snapshot:Extract<StripePaymentAdjustments,{state:'observed'}>):Promise<void> {
 if(lease._expected_tenant_id!==claim.operation.tenant_id||snapshot.provider_transaction_id!==capture.provider_transaction_id
  ||snapshot.provider_settlement_id!==capture.provider_settlement_id)throw Error('PAYMENT_OBSERVATION_SCOPE_CHANGED');
 const response=await admin.rpc('complete_sales_capture_observation_work',{...lease,
  _capture:observedCaptureInput(claim,capture,`initial-work-${lease._work_id}`),_snapshot:snapshot});
 const receipt=object(response.data),observation=object(receipt?.observation);
 if(response.error||!receipt||receipt.state!=='reconciled'||receipt.effect!=='capture_and_provider_observation'
  ||receipt.operation_id!==claim.operation.id||receipt.work_id!==lease._work_id||receipt.work_status!=='succeeded'
  ||typeof receipt.replayed!=='boolean'||typeof receipt.allocation_payment_id!=='string'||!uuid.test(receipt.allocation_payment_id)
  ||!observation||observation.state!=='observed'||observation.effect!=='provider_observation_only'
  ||observation.provider_operation_id!==claim.operation.id||typeof observation.observation_id!=='string'||!uuid.test(observation.observation_id)
  ||observation.observation_version!==1||observation.rail_recorded!==true||typeof observation.source_hash!=='string'
  ||!/^[a-f0-9]{64}$/.test(observation.source_hash)||!sameObservation(observation.snapshot,snapshot))throw Error('PAYMENT_OBSERVATION_READBACK_UNAVAILABLE');
}
export async function persistProviderPaymentReadback(admin:SalesPaymentAdmin,claim:ClaimedPayment,result:HostedPaymentReadback,reference:string):Promise<void> {
 const scope={_expected_tenant_id:claim.operation.tenant_id,_operation_id:claim.operation.id,_claim_token:claim.claimToken};
 if(result.state==='settled'){
  const r=await admin.rpc('allocate_verified_sales_invoice_payment',{...scope,_readback:verifiedSettlementInput(claim,result,reference)});
  if(r.error)throw new Error('PAYMENT_ALLOCATION_UNAVAILABLE');return;
 }
 const r=await admin.rpc('finalize_sales_invoice_payment_request',{...scope,_state:result.state,
  _provider_object_id:result.provider_object_id??claim.operation.provider_operation_id,_provider_status:result.state,
  _provider_url:result.hosted_url??null,_expires_at:result.expires_at??null});
 if(r.error)throw new Error('PAYMENT_EVIDENCE_UNAVAILABLE');
}
/** Provider-served merchant observation precedes exact review. Final SQL repeats the binding,
 * balance, version and authority checks under locks; this preview grants no permission. */
export async function preparePaymentReview(admin:SalesPaymentAdmin,caller:PaymentCaller,value:unknown,secret:string):Promise<PaymentRequestCommand> {
 const intent=parsePaymentRequestIntent(value);
 if(intent.provider!=='stripe')throw new Error('PAYPAL_MERCHANT_PERMISSION_REQUIRED');
 const [invoiceRow,invoiceFacts,merchantRow]=await Promise.all([
  admin.from('paige_invoices').select('id,tenant_id,contact_id,billing_lifecycle_version,billing_issued_snapshot_version,status,currency').eq('tenant_id',caller.tenantId).eq('id',intent.invoice_id).maybeSingle(),
  admin.rpc('read_sales_invoice_payment_obligation',{_actor_user_id:caller.actorId,_expected_tenant_id:caller.tenantId,
   _invoice_id:intent.invoice_id,_reference:{financial_evidence_version:3,reference:intent.obligation_reference??null}}),
  admin.from('tenant_stripe_accounts').select('stripe_account_id,binding_version,provider_environment,country,default_currency,requirements').eq('tenant_id',caller.tenantId).maybeSingle(),
 ]);
 const row=object(invoiceRow.data),merchant=object(merchantRow.data);
 if(invoiceRow.error||invoiceFacts.error||merchantRow.error||!row||!merchant)throw new Error('PAYMENT_CONTEXT_UNAVAILABLE');
 let facts:InvoicePaymentFinancialContext;
 try{facts=parseInvoicePaymentFinancialContext(invoiceFacts.data);}catch{throw new Error('PAYMENT_CONTEXT_UNAVAILABLE');}
 if(row.tenant_id!==caller.tenantId||row.id!==intent.invoice_id||facts.tenant_id!==caller.tenantId||facts.invoice_id!==intent.invoice_id
  ||row.contact_id!==facts.client_id||row.billing_lifecycle_version!==facts.invoice_version||facts.invoice_version!==intent.expected_version
  ||row.billing_issued_snapshot_version!==facts.issued_snapshot_version||row.status!==facts.status
  ||typeof row.currency!=='string'||row.currency.toLowerCase()!==facts.currency)throw new Error('PAYMENT_CONTEXT_CHANGED');
 const invoice={id:facts.invoice_id,tenant_id:facts.tenant_id,client_id:facts.client_id,
  lifecycle_version:facts.invoice_version,issued_snapshot_version:facts.issued_snapshot_version,
  status:facts.status,currency:facts.currency,outstanding_minor:facts.actual_outstanding_minor};
 let obligationSource:unknown;
 if(intent.obligation_reference){
  obligationSource={tenant_id:facts.tenant_id,client_id:facts.client_id,invoice_id:facts.invoice_id,
   invoice_version:facts.invoice_version,issued_snapshot_version:facts.issued_snapshot_version,obligation:facts.obligation};
 }else if(facts.obligation!==null){
  throw new Error('PAYMENT_CONTEXT_CHANGED');
 }
 const obligation=paymentObligationForRequest(intent,invoice,obligationSource);
 const requested=obligation?.remaining_minor??(intent.purpose==='full'?invoice.outstanding_minor:intent.amount_minor!);
 if(invoice.outstanding_minor<=0||requested>invoice.outstanding_minor)throw new Error('PAYMENT_CONTEXT_UNAVAILABLE');
 if(!await caller.stillCurrent())throw new Error('WORKSPACE_CHANGED');
 const client=salesStripeClient(secret);
 if(merchant.provider_environment!==client.environment||typeof merchant.stripe_account_id!=='string'||!Number.isSafeInteger(merchant.binding_version))throw new Error('MERCHANT_BINDING_UNAVAILABLE');
 const binding:MerchantBinding={tenant_id:caller.tenantId,provider:'stripe',merchant_id:merchant.stripe_account_id,environment:client.environment,version:Number(merchant.binding_version)};
 const observation=await readStripeMerchant(binding,client,Date.now);
 if(!await caller.stillCurrent())throw new Error('WORKSPACE_CHANGED');
 const saved=await admin.rpc('record_sales_stripe_readback',{_tenant_id:caller.tenantId,_merchant_id:binding.merchant_id,_expected_version:binding.version,
  _environment:binding.environment,_charges_enabled:observation.charges_enabled,_payouts_enabled:observation.payouts_enabled,_details_submitted:observation.details_submitted,
  _payment_permission:observation.payment_permission,_country:merchant.country,_currency:merchant.default_currency,_requirements:merchant.requirements});
 if(saved.error||saved.data!==binding.version)throw new Error('MERCHANT_BINDING_CHANGED');
 return buildPaymentRequestCommand(intent,invoice,binding,observation,Date.now(),obligationSource);
}
export function paymentExecutionPorts(admin:SalesPaymentAdmin,caller:PaymentCaller,secret:string,origin:string):PaymentExecutionPorts {
 const scope={_expected_tenant_id:caller.tenantId,_operation_id:caller.operationId};
 const checked=(value:unknown)=>parseClaimedPayment(value,caller.tenantId,caller.actorId,caller.operationId);
 const readInternal=async()=>{const r=await admin.rpc('read_sales_invoice_payment_dispatch',scope);if(r.error)throw new Error('PAYMENT_READBACK_UNAVAILABLE');return checked(r.data);};
 return {stillCurrent:caller.stillCurrent,stripe:salesStripeClient(secret),publicOrigin:origin,
  claim:async()=>{
   const result=await admin.rpc('claim_sales_invoice_payment_request',{...scope,_claim_token:crypto.randomUUID()});
   if(result.error?.code==='40001'){
    // Revalidate the original owner/operation BEFORE closing anything. The
    // native cancellation repeats its locked no-dispatch fence; a race to a
    // claimed or uncertain provider operation must remain GET-only recovery.
    const original=await readInternal();
    if(original.operation.state!=='prepared')return null;
    if(!await caller.stillCurrent())throw new Error('WORKSPACE_CHANGED');
    const cancelled=await admin.rpc('cancel_prepared_sales_invoice_payment_request',{...scope,_reason:'invoice_changed'});
    const row=object(cancelled.data);
    if(cancelled.error||!row||row.state!=='cancelled'||row.dispatch_started_at!==null||row.provider_object_id!==null
     ||Object.prototype.hasOwnProperty.call(row,'dispatch_claim_token')||row.provider_status!=='not_dispatched'
     ||!['merchant_changed','readiness_unavailable','invoice_changed','recovery_abandoned'].includes(String(row.cancellation_reason)))throw new Error('PAYMENT_RECOVERY_UNAVAILABLE');
    checked({...row,dispatch_claim_token:null});
    return null;
   }
   if(result.error?.code==='55000')return null;
   if(result.error)throw new Error('PAYMENT_CLAIM_UNAVAILABLE');
   const work=await admin.rpc('register_sales_payment_reconciliation_work',scope);if(work.error)throw new Error('PAYMENT_RECOVERY_UNAVAILABLE');
   return checked(result.data);
  },
  readInternal,
  persist:(claim,result)=>persistProviderPaymentReadback(admin,claim,result,`stripe-read-${result.provider_object_id??claim.operation.id}`),
  readSafe:async()=>{const r=await admin.rpc('read_sales_invoice_payment_request',{...scope,_actor_user_id:caller.actorId});if(r.error)throw new Error('PAYMENT_READBACK_UNAVAILABLE');return safePaymentOperation(r.data);},
 };
}
export async function executeInvoicePaymentRequest(admin:SalesPaymentAdmin,caller:PaymentCaller,command:PaymentRequestCommand,governance:Record<string,unknown>,secret:string,origin:string) {
 const prepared=await admin.rpc('prepare_sales_invoice_payment_request',{_actor_user_id:caller.actorId,_expected_tenant_id:caller.tenantId,_operation_id:caller.operationId,_command:command,_governance:governance});
 if(prepared.error)return {ok:false,outcome:databaseAnswered(prepared.error)?'refused':'outcome_unknown',code:databaseAnswered(prepared.error)?'PAYMENT_PREPARATION_REFUSED':'PAYMENT_READBACK_REQUIRED'};
 const ports=paymentExecutionPorts(admin,caller,secret,origin);
 return object(prepared.data)?.state==='prepared'?dispatchPreparedPayment(ports):reconcilePayment(ports);
}
