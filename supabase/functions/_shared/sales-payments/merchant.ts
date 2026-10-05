/** Server-owned facts only. Tenant declarations/return URLs never establish readiness. */
export type SalesPaymentProvider = 'stripe' | 'paypal';
export type ProviderEnvironment = 'test' | 'live';
export interface MerchantBinding {
  tenant_id: string;
  provider: SalesPaymentProvider;
  merchant_id: string;
  environment: ProviderEnvironment;
  version: number;
}
export interface MerchantObservation {
  tenant_id: string;
  provider: SalesPaymentProvider;
  binding_version: number;
  merchant_id: string;
  environment: ProviderEnvironment;
  observed_at: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  payment_permission: boolean;
  email_confirmed: boolean;
  partner_authorized: boolean;
  disabled_reason: string | null;
}
export interface MerchantReadiness {
  eligible: boolean;
  state: 'ready' | 'unverified' | 'restricted';
  reason: string;
  provider_execution_verified: false;
}
export function merchantReadiness(binding: MerchantBinding, facts: MerchantObservation | null, now: number): MerchantReadiness {
  const result = (state: MerchantReadiness['state'], reason: string): MerchantReadiness =>
    ({ eligible: state === 'ready', state, reason, provider_execution_verified: false });
  if (!binding.tenant_id || !binding.merchant_id || !Number.isSafeInteger(binding.version) || binding.version < 1 ||
      !['stripe', 'paypal'].includes(binding.provider) || !['test', 'live'].includes(binding.environment)) {
    return result('unverified', 'MERCHANT_BINDING_INVALID');
  }
  if (!facts) return result('unverified', 'MERCHANT_READBACK_REQUIRED');
  if (facts.tenant_id !== binding.tenant_id || facts.provider !== binding.provider || facts.binding_version !== binding.version ||
      facts.merchant_id !== binding.merchant_id || facts.environment !== binding.environment)
    return result('unverified', 'MERCHANT_MISMATCH');
  const observedAt = Date.parse(facts.observed_at);
  if (!Number.isFinite(now) || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 300_000)
    return result('unverified', 'MERCHANT_READBACK_STALE');
  if (facts.charges_enabled !== true || facts.payment_permission !== true || facts.disabled_reason !== null)
    return result('restricted', 'MERCHANT_PAYMENTS_RESTRICTED');
  if (binding.provider === 'paypal' && (facts.partner_authorized !== true || facts.email_confirmed !== true))
    return result('restricted', 'PAYPAL_SELLER_PERMISSION_REQUIRED');
  return result('ready', 'MERCHANT_READY');
}
export interface StripeAccountReader {
  environment: ProviderEnvironment;
  /** Existing platform client retrieves this exact connected account; payment objects use account scoping separately. */
  retrieveAccount(accountId: string): Promise<{
    id: string; metadata?: { tenant_id?: string }; deleted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean;
    details_submitted?: boolean; capabilities?: { card_payments?: string };
    requirements?: { disabled_reason?: string | null } | null;
  }>;
}
export async function readStripeMerchant(binding: MerchantBinding, reader: StripeAccountReader, clock: () => number): Promise<MerchantObservation> {
  if (binding.provider !== 'stripe' || !/^acct_[A-Za-z0-9]+$/.test(binding.merchant_id)) throw new Error('MERCHANT_BINDING_INVALID');
  if (reader.environment !== binding.environment) throw new Error('MERCHANT_ENVIRONMENT_MISMATCH');
  const account = await reader.retrieveAccount(binding.merchant_id);
  if (account.id !== binding.merchant_id) throw new Error('MERCHANT_MISMATCH');
  if (account.deleted) throw new Error('MERCHANT_UNAVAILABLE');
  // Legacy database identity was browser-writable. Do not promote it without provider-side tenant provenance.
  if (account.metadata?.tenant_id !== binding.tenant_id) throw new Error('MERCHANT_TENANT_MISMATCH');
  return {
    tenant_id: binding.tenant_id, provider: binding.provider, binding_version: binding.version,
    merchant_id: account.id, environment: binding.environment, observed_at: new Date(clock()).toISOString(),
    charges_enabled: account.charges_enabled === true, payouts_enabled: account.payouts_enabled === true,
    details_submitted: account.details_submitted === true, payment_permission: account.capabilities?.card_payments === 'active',
    email_confirmed: false, partner_authorized: false, disabled_reason: account.requirements?.disabled_reason ?? null,
  };
}
