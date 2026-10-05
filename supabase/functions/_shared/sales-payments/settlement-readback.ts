import type {ClaimedPayment} from './request-execution.ts';
import type {HostedPaymentReadback} from './stripe-hosted.ts';
/** Only a fresh provider adapter readback can construct this service-RPC input. Redirect/event
 * status and caller-authored amounts are not accepted. The SQL writer rechecks every identity. */
export function verifiedSettlementInput(claim:ClaimedPayment,result:HostedPaymentReadback,readbackReference:string):Record<string,unknown> {
 if(result.state!=='settled'||result.amount_minor!==claim.request.amount_minor||result.currency!==claim.request.currency||
  typeof result.provider_object_id!=='string'||!result.provider_transaction_id||!result.provider_settlement_id||
  !result.provider_received_at||!Number.isFinite(Date.parse(result.provider_received_at))||!/^[A-Za-z0-9_-]{1,200}$/.test(readbackReference)||
  (claim.operation.provider_operation_id!==null&&claim.operation.provider_operation_id!==result.provider_object_id))throw new Error('VERIFIED_SETTLEMENT_REQUIRED');
 return {status:'verified',provider:claim.operation.provider,merchant_account_id:claim.operation.merchant_id,environment:claim.operation.environment,
  invoice_id:claim.request.invoice_id,client_id:claim.request.client_id,invoice_version:claim.request.invoice_version,issued_snapshot_version:claim.request.issued_snapshot_version,
  amount_minor:result.amount_minor,currency:result.currency,provider_object_id:result.provider_object_id,provider_transaction_id:result.provider_transaction_id,
  provider_settlement_id:result.provider_settlement_id,provider_received_at:result.provider_received_at,readback_reference:readbackReference};
}
