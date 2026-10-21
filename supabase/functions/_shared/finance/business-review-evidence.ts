/** A bounded presentation of canonical Finance reads, never another metric or ledger. */
export const FINANCE_REVIEW_SOURCE_LIMIT = 4;
export const FINANCE_REVIEW_ACCOUNT_LIMIT = 12;
export type FinanceReviewAccount = {
  native_id: string; label: string; product: string | null; currency: string | null;
  current_balance: string | null; available_cash: string | null;
  available_credit: string | null; credit_limit: string | null;
};
type FinanceReviewSourceBase = {
  company_id: string; company_label: string; company_version: number;
  binding_id: string; binding_revision: number; provider: 'plaid' | 'quickbooks';
};
export type FinanceReviewSource = FinanceReviewSourceBase & (
  | { state: 'unavailable'; reason: 'source_snapshot_unavailable' }
  | { state: 'available'; coverage: 'complete' | 'partial'; pages_complete: boolean;
      snapshot_version: number; source_observed_at: string; synchronized_at: string;
      observation_id: string; receipt_run_id: string; normalized_digest: string;
      accounts_count: number; accounts: FinanceReviewAccount[] }
);
export type FinanceReviewEvidence = {
  tenant_id: string; eligible_sources: number; sources: FinanceReviewSource[];
};
export const financeObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const financeUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const financeRevision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const decimal = (v: unknown): v is string => typeof v === 'string' && /^-?\d{1,24}(\.\d{1,6})?$/.test(v);
const moneyKeys = ['current_balance', 'available_cash', 'available_credit', 'credit_limit'] as const;
const instant = (v: unknown, now: number): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now + 300_000;
function closed(v: Record<string, unknown>, keys: string[]) {
  return Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
}

/** Preserve decimal major units verbatim, including a genuine zero. Never float-convert. */
export function formatFinanceSourceAmount(value: string | null, currency: string | null): string {
  return value !== null && decimal(value) && currency !== null && /^[A-Z]{3}$/.test(currency)
    ? `${currency} ${value}` : 'Unavailable';
}

/** Projection from the existing executeFinanceRead's closed account-source result. */
export function financeSourceObservation(base: FinanceReviewSourceBase, raw: unknown, now: number): Extract<FinanceReviewSource, { state: 'available' }> | null {
  if (!financeObject(raw) || !['complete', 'partial'].includes(String(raw.coverage)) || raw.binding_id !== base.binding_id
    || raw.binding_revision !== base.binding_revision || raw.provider !== base.provider || raw.environment !== 'production'
    || raw.temporal_basis !== 'source_snapshot' || raw.institution_freshness_verified !== false || raw.calculated_totals !== null
    || !financeRevision(raw.version) || typeof raw.pages_complete !== 'boolean' || raw.coverage === 'complete' && !raw.pages_complete
    || !instant(raw.source_observed_at, now) || !instant(raw.synchronized_at, now)
    || Date.parse(raw.synchronized_at) < Date.parse(raw.source_observed_at)
    || !financeUuid(raw.observation_id) || !financeUuid(raw.receipt_run_id)
    || typeof raw.normalized_digest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.normalized_digest)
    || !Array.isArray(raw.accounts) || raw.accounts.length > 500) return null;
  const accounts: FinanceReviewAccount[] = [];
  const identities = new Set<string>();
  for (const row of raw.accounts) {
    if (!financeObject(row) || !text(row.native_id) || identities.has(row.native_id)
      || row.source_label !== undefined && row.source_label !== null && (typeof row.source_label !== 'string' || row.source_label.length > 500)
      || row.product !== undefined && row.product !== null && (typeof row.product !== 'string' || row.product.length > 500)
      || row.currency !== undefined && row.currency !== null && (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency))
      || moneyKeys.some(key => row[key] !== undefined && row[key] !== null && !decimal(row[key]))) return null;
    identities.add(row.native_id);
    if (accounts.length < FINANCE_REVIEW_ACCOUNT_LIMIT) accounts.push({
      native_id: row.native_id, label: text(row.source_label) ? row.source_label : 'Source account',
      product: text(row.product) ? row.product : null, currency: typeof row.currency === 'string' ? row.currency : null,
      current_balance: typeof row.current_balance === 'string' ? row.current_balance : null,
      available_cash: typeof row.available_cash === 'string' ? row.available_cash : null,
      available_credit: typeof row.available_credit === 'string' ? row.available_credit : null,
      credit_limit: typeof row.credit_limit === 'string' ? row.credit_limit : null,
    });
  }
  return { ...base, state: 'available', coverage: raw.coverage as 'complete' | 'partial', pages_complete: raw.pages_complete,
    snapshot_version: raw.version, source_observed_at: raw.source_observed_at, synchronized_at: raw.synchronized_at,
    observation_id: raw.observation_id, receipt_run_id: raw.receipt_run_id, normalized_digest: raw.normalized_digest,
    accounts_count: raw.accounts.length, accounts };
}

/** Closed transport validation for the same UI/model snapshot, not a permission check. */
export function validateFinanceReviewEvidence(value: unknown, tenantId: string | null | undefined, now: number): FinanceReviewEvidence | null {
  try {
    if (!financeObject(value) || !closed(value, ['tenant_id', 'eligible_sources', 'sources']) || !financeUuid(tenantId)
      || value.tenant_id !== tenantId || !count(value.eligible_sources) || value.eligible_sources > 1000
      || !Array.isArray(value.sources) || value.sources.length > FINANCE_REVIEW_SOURCE_LIMIT
      || value.sources.length !== Math.min(value.eligible_sources, FINANCE_REVIEW_SOURCE_LIMIT)) return null;
    const sources: FinanceReviewSource[] = [];
    const bindings = new Set<string>();
    const bases = ['company_id', 'company_label', 'company_version', 'binding_id', 'binding_revision', 'provider', 'state'];
    for (const row of value.sources) {
      if (!financeObject(row) || !financeUuid(row.company_id) || !text(row.company_label) || !financeRevision(row.company_version)
        || !financeUuid(row.binding_id) || bindings.has(row.binding_id) || !financeRevision(row.binding_revision)
        || !['plaid', 'quickbooks'].includes(String(row.provider))) return null;
      bindings.add(row.binding_id);
      const base: FinanceReviewSourceBase = { company_id: row.company_id, company_label: row.company_label,
        company_version: row.company_version, binding_id: row.binding_id, binding_revision: row.binding_revision,
        provider: row.provider as 'plaid' | 'quickbooks' };
      if (row.state === 'unavailable') {
        if (!closed(row, [...bases, 'reason']) || row.reason !== 'source_snapshot_unavailable') return null;
        sources.push({ ...base, state: 'unavailable', reason: 'source_snapshot_unavailable' });
        continue;
      }
      if (row.state !== 'available' || !closed(row, [...bases, 'coverage', 'pages_complete', 'snapshot_version', 'source_observed_at',
        'synchronized_at', 'observation_id', 'receipt_run_id', 'normalized_digest', 'accounts_count', 'accounts'])
        || !count(row.accounts_count) || row.accounts_count > 500 || !Array.isArray(row.accounts)
        || row.accounts.length !== Math.min(row.accounts_count, FINANCE_REVIEW_ACCOUNT_LIMIT)) return null;
      const source = financeSourceObservation(base, { ...row, binding_id: base.binding_id, binding_revision: base.binding_revision,
        environment: 'production', temporal_basis: 'source_snapshot', institution_freshness_verified: false, calculated_totals: null,
        version: row.snapshot_version,
        accounts: row.accounts.map(a => {
          if (!financeObject(a) || !closed(a, ['native_id', 'label', 'product', 'currency', ...moneyKeys]) || !text(a.label)
            || moneyKeys.some(key => a[key] !== null && !decimal(a[key]))
            || a.product !== null && !text(a.product)
            || a.currency !== null && (typeof a.currency !== 'string' || !/^[A-Z]{3}$/.test(a.currency))) throw new Error('invalid source account');
          return { ...a, source_label: a.label };
        }) }, now);
      if (!source) return null;
      sources.push({ ...source, accounts_count: row.accounts_count });
    }
    return { tenant_id: tenantId, eligible_sources: value.eligible_sources, sources };
  } catch { return null; }
}
