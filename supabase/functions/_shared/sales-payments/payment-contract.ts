import type { MerchantBinding, ProviderEnvironment, SalesPaymentProvider } from './merchant.ts';
/** Canonical invoice remains the receivable. These are bounded references, never a second balance ledger. */
export interface PaymentRequest {
  id: string; tenant_id: string; invoice_id: string; invoice_version: number; issued_snapshot_version: number;
  client_id: string; commercial_package_id: string | null; amount_minor: number; currency: string;
  purpose: 'full' | 'partial' | 'deposit' | 'installment'; idempotency_key: string;
}
export interface InvoicePaymentContext {
  id: string; tenant_id: string; client_id: string; lifecycle_version: number; issued_snapshot_version: number;
  status: string; currency: string; outstanding_minor: number;
}
export type ProviderOperationState = 'prepared' | 'dispatching' | 'externally_accepted' | 'failed' | 'outcome_unknown' | 'reconciled';
export interface ProviderOperation {
  id: string; tenant_id: string; request_id: string; provider: SalesPaymentProvider; merchant_id: string;
  merchant_version: number; environment: ProviderEnvironment; idempotency_key: string;
  provider_operation_id: string | null; state: ProviderOperationState; application_fee_minor: 0;
}
export interface ProviderTransaction {
  id: string; tenant_id: string; operation_id: string; provider: SalesPaymentProvider; merchant_id: string;
  environment: ProviderEnvironment; provider_transaction_id: string; amount_minor: number; currency: string;
  state: 'authorized' | 'processing' | 'succeeded' | 'failed' | 'outcome_unknown'; readback_reference: string;
}
export interface VerifiedSettlement {
  id: string; tenant_id: string; operation_id: string; provider: SalesPaymentProvider; merchant_id: string;
  environment: ProviderEnvironment; provider_transaction_id: string; provider_settlement_id: string;
  amount_minor: number; currency: string; state: 'pending' | 'verified' | 'outcome_unknown'; readback_reference: string;
}
export interface SettlementAllocation {
  id: string; tenant_id: string; settlement_id: string; invoice_id: string; amount_minor: number; currency: string;
}
const money = (amount: number) => Number.isSafeInteger(amount) && amount > 0 && amount <= 2147483647;
const nonempty = (v: string) => typeof v === 'string' && v.length > 0 && v.length <= 200 && v.trim() === v;
export function validatePaymentRequest(request: PaymentRequest, invoice: InvoicePaymentContext): string | null {
  if (![request.id, request.tenant_id, request.invoice_id, request.client_id, request.idempotency_key].every(nonempty) ||
      !money(request.amount_minor) || !/^[a-z]{3}$/.test(request.currency) ||
      !['full', 'partial', 'deposit', 'installment'].includes(request.purpose) ||
      !Number.isSafeInteger(request.invoice_version) || request.invoice_version < 1 ||
      !Number.isSafeInteger(request.issued_snapshot_version) || request.issued_snapshot_version < 1)
    return 'PAYMENT_REQUEST_INVALID';
  if (request.tenant_id !== invoice.tenant_id || request.invoice_id !== invoice.id || request.client_id !== invoice.client_id)
    return 'INVOICE_SCOPE_MISMATCH';
  if (request.invoice_version !== invoice.lifecycle_version || request.issued_snapshot_version !== invoice.issued_snapshot_version)
    return 'INVOICE_VERSION_CHANGED';
  if (!['issued', 'sent'].includes(invoice.status)) return 'INVOICE_NOT_COLLECTIBLE';
  if (request.currency !== invoice.currency) return 'CURRENCY_MISMATCH';
  if (!money(invoice.outstanding_minor) || request.amount_minor > invoice.outstanding_minor) return 'AMOUNT_EXCEEDS_BALANCE';
  return null;
}
/** Authority/readiness must be resolved by the shared gateway before dispatch. This function grants neither. */
export function bindProviderOperation(request: PaymentRequest, merchant: MerchantBinding, id: string, key: string): ProviderOperation {
  if (request.tenant_id !== merchant.tenant_id) throw new Error('MERCHANT_TENANT_MISMATCH');
  if (![id, key, merchant.merchant_id].every(nonempty) || !Number.isSafeInteger(merchant.version) || merchant.version < 1 ||
      !['stripe', 'paypal'].includes(merchant.provider) || !['test', 'live'].includes(merchant.environment))
    throw new Error('PROVIDER_OPERATION_INVALID');
  return {id, tenant_id: request.tenant_id, request_id: request.id, provider: merchant.provider,
    merchant_id: merchant.merchant_id, merchant_version: merchant.version, environment: merchant.environment,
    idempotency_key: key, provider_operation_id: null, state: 'prepared', application_fee_minor: 0};
}
/** Validation only: S4 owns atomic persisted uniqueness and canonical balance readback. No S1 allocation writer. */
export function validateSettlementAllocation(allocation: SettlementAllocation, settlement: VerifiedSettlement,
  operation: ProviderOperation, request: PaymentRequest): string | null {
  if (settlement.state !== 'verified' || ![settlement.id, settlement.provider_transaction_id,
    settlement.provider_settlement_id, settlement.readback_reference].every(nonempty)) return 'VERIFIED_SETTLEMENT_REQUIRED';
  if (settlement.tenant_id !== request.tenant_id || allocation.tenant_id !== request.tenant_id || operation.tenant_id !== request.tenant_id ||
      allocation.invoice_id !== request.invoice_id || allocation.settlement_id !== settlement.id ||
      settlement.operation_id !== operation.id || operation.request_id !== request.id ||
      settlement.provider !== operation.provider || settlement.merchant_id !== operation.merchant_id ||
      settlement.environment !== operation.environment) return 'SETTLEMENT_SCOPE_MISMATCH';
  if (settlement.currency !== request.currency || allocation.currency !== request.currency) return 'CURRENCY_MISMATCH';
  if (!money(settlement.amount_minor) || !money(allocation.amount_minor) ||
      settlement.amount_minor > request.amount_minor || allocation.amount_minor > settlement.amount_minor)
    return 'ALLOCATION_AMOUNT_INVALID';
  return null;
}
