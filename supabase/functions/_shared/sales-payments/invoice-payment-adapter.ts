import type {SalesPaymentAdmin} from './database-port.ts';
import {buildPaymentRequestCommand,parsePaymentRequestIntent,type PaymentRequestCommand} from './request-command.ts';
import {readStripeMerchant,type MerchantBinding} from './merchant.ts';
import {salesStripeClient} from './stripe-client.ts';
import {parseClaimedPayment,safePaymentOperation} from './operation-projection.ts';
import {dispatchPreparedPayment,reconcilePayment,type PaymentExecutionPorts} from './request-execution.ts';
import {databaseAnswered} from '../approval-outcome.ts';
import {verifiedSettlementInput} from './settlement-readback.ts';
import type {ClaimedPayment} from './request-execution.ts';
import type {HostedPaymentReadback} from './stripe-hosted.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export interface PaymentCaller {tenantId:string;actorId:string;operationId:string;stillCurrent:()=>Promise<boolean>}
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
  admin.from('paige_invoices').select('id,tenant_id,contact_id').eq('tenant_id',caller.tenantId).eq('id',intent.invoice_id).maybeSingle(),
  admin.rpc('_sales_invoice_read',{_tenant:caller.tenantId,_invoice:intent.invoice_id}),
  admin.from('tenant_stripe_accounts').select('stripe_account_id,binding_version,provider_environment,country,default_currency,requirements').eq('tenant_id',caller.tenantId).maybeSingle(),
 ]);
 const row=object(invoiceRow.data),facts=object(invoiceFacts.data),merchant=object(merchantRow.data);
 if(invoiceRow.error||invoiceFacts.error||merchantRow.error||!row||!facts||!merchant||row.tenant_id!==caller.tenantId||facts.tenant_id!==caller.tenantId||row.id!==facts.id||typeof row.contact_id!=='string')throw new Error('PAYMENT_CONTEXT_UNAVAILABLE');
 const client=salesStripeClient(secret);
 if(merchant.provider_environment!==client.environment||typeof merchant.stripe_account_id!=='string'||!Number.isSafeInteger(merchant.binding_version))throw new Error('MERCHANT_BINDING_UNAVAILABLE');
 const binding:MerchantBinding={tenant_id:caller.tenantId,provider:'stripe',merchant_id:merchant.stripe_account_id,environment:client.environment,version:Number(merchant.binding_version)};
 const observation=await readStripeMerchant(binding,client,Date.now);
 if(!await caller.stillCurrent())throw new Error('WORKSPACE_CHANGED');
 const saved=await admin.rpc('record_sales_stripe_readback',{_tenant_id:caller.tenantId,_merchant_id:binding.merchant_id,_expected_version:binding.version,
  _environment:binding.environment,_charges_enabled:observation.charges_enabled,_payouts_enabled:observation.payouts_enabled,_details_submitted:observation.details_submitted,
  _payment_permission:observation.payment_permission,_country:merchant.country,_currency:merchant.default_currency,_requirements:merchant.requirements});
 if(saved.error||saved.data!==binding.version)throw new Error('MERCHANT_BINDING_CHANGED');
 return buildPaymentRequestCommand(intent,{id:String(facts.id),tenant_id:caller.tenantId,client_id:row.contact_id,
  lifecycle_version:Number(facts.version),issued_snapshot_version:Number(facts.issued_snapshot_version),status:String(facts.status),currency:String(facts.currency),outstanding_minor:Number(facts.remaining_cents)},binding,observation,Date.now());
}
export function paymentExecutionPorts(admin:SalesPaymentAdmin,caller:PaymentCaller,secret:string,origin:string):PaymentExecutionPorts {
 const scope={_expected_tenant_id:caller.tenantId,_operation_id:caller.operationId};
 const checked=(value:unknown)=>parseClaimedPayment(value,caller.tenantId,caller.actorId,caller.operationId);
 return {stillCurrent:caller.stillCurrent,stripe:salesStripeClient(secret),publicOrigin:origin,
  claim:async()=>{
   const result=await admin.rpc('claim_sales_invoice_payment_request',{...scope,_claim_token:crypto.randomUUID()});
   if(result.error?.code==='55000')return null;
   if(result.error)throw new Error('PAYMENT_CLAIM_UNAVAILABLE');
   const work=await admin.rpc('register_sales_payment_reconciliation_work',scope);if(work.error)throw new Error('PAYMENT_RECOVERY_UNAVAILABLE');
   return checked(result.data);
  },
  readInternal:async()=>{const r=await admin.rpc('read_sales_invoice_payment_dispatch',scope);if(r.error)throw new Error('PAYMENT_READBACK_UNAVAILABLE');return checked(r.data);},
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
