// Controlled normalization only. The server must establish company ownership,
// connection consent and eligible products before fetching or ingesting this data.
import { object, sourceDecimal } from './quickbooks-read-contract.ts';
import { parsePlaidAccount } from './plaid-read-contract.ts';
const text = (v: unknown, max = 500) => typeof v === 'string' && v.trim() && v.length <= max ? v : null;
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;
const nonnegative = (v: unknown) => { const d = sourceDecimal(v); return d !== null && !d.startsWith('-') ? d : null; };
const frequencies = ['daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'semiannually', 'annually'];
type Account = NonNullable<ReturnType<typeof parsePlaidAccount>>;
type Group = 'credit' | 'loan' | 'line_of_credit';

function normalize(group: Group, value: unknown, account: Account) {
  const row = object(value);
  if (!row || row.account_id !== account.nativeId) return null;
  if (group === 'credit' && account.product !== 'credit_card'
    || group === 'line_of_credit' && account.product !== 'revolving_line'
    || group === 'loan' && (account.sourceType !== 'loan' || account.product !== 'loan_obligation' || account.sourceSubtype === 'student' || account.sourceSubtype === 'mortgage')) return null;
  const rate = object(row.interest_rate);
  let aprs: { percentage: string | null; sourceType: string | null; subjectBalance: string | null; interestCharge: string | null }[] | null = null;
  if (row.aprs !== null && row.aprs !== undefined) {
    if (!Array.isArray(row.aprs) || row.aprs.length > 50) return null;
    aprs = [];
    for (const value of row.aprs) {
      const apr = object(value);
      if (!apr) return null;
      aprs.push({ percentage: nonnegative(apr.apr_percentage), sourceType: text(apr.apr_type), subjectBalance: nonnegative(apr.balance_subject_to_apr), interestCharge: nonnegative(apr.interest_charge_amount) });
    }
  }
  return {
    nativeId: account.nativeId, sourceLabel: account.sourceLabel, sourceType: account.sourceType, sourceSubtype: account.sourceSubtype,
    product: account.product, currency: account.currency, unofficialCurrency: account.unofficialCurrency,
    outstandingBalance: account.currentBalance,
    // A card balance includes more than principal. Never relabel it principal.
    principalBalance: group === 'credit' ? null : sourceDecimal(row.principal_balance),
    originalPrincipal: group === 'loan' ? nonnegative(row.origination_principal_amount) : null,
    creditLimit: group === 'line_of_credit' ? nonnegative(row.credit_limit) : group === 'credit' ? account.creditLimit : null,
    availableCredit: group === 'line_of_credit' ? sourceDecimal(row.available_credit) : group === 'credit' ? account.availableCredit : null,
    minimumPayment: group === 'loan' ? null : nonnegative(row.minimum_payment_amount),
    nextPayment: group === 'credit' ? null : nonnegative(row.next_payment_amount),
    nextPaymentDueDate: date(row.next_payment_due_date),
    maturityDate: group === 'loan' ? date(row.maturity_date) : null,
    drawPeriodEndDate: group === 'line_of_credit' ? date(row.draw_period_end_date) : null,
    paymentFrequency: group === 'loan' && frequencies.includes(String(row.payment_frequency)) ? row.payment_frequency as string : null,
    interestRatePercentage: group === 'credit' ? null : nonnegative(rate?.percentage),
    interestRateType: rate?.type === 'fixed' || rate?.type === 'variable' ? rate.type : null,
    aprs, principalPayment: null, interestPayment: null,
    collateralVerified: null, guaranteeVerified: null, institutionUpdatedAt: null,
    accountingClassificationVerified: false, companyOwnershipVerified: false,
  };
}
type Liability = NonNullable<ReturnType<typeof normalize>>;
type Result = { records: Liability[]; coverage: 'partial' | 'unavailable'; reason: string | null; missingAccountIds: string[]; institutionFreshnessVerified: false };

export function parsePlaidLiabilities(value: unknown, expectedItemId: string, authorizedAccountIds: ReadonlySet<string>): Result {
  const fail = (reason: string): Result => ({ records: [], coverage: 'unavailable', reason, missingAccountIds: [], institutionFreshnessVerified: false });
  const body = object(value), item = object(body?.item), liabilities = object(body?.liabilities);
  if (!text(expectedItemId) || !body || body.error != null || !item || item.item_id !== expectedItemId || item.error != null || !liabilities
    || !Array.isArray(body.accounts) || body.accounts.length > 500 || authorizedAccountIds.size > 500 || authorizedAccountIds.size === 0) return fail('invalid_or_unavailable_source');
  const accounts = new Map<string, Account>();
  for (const raw of body.accounts) {
    const id = text(object(raw)?.account_id);
    if (!id) return fail('account_scope_or_identity_conflict');
    // Item-wide responses can include personal/unselected accounts. Inspect only
    // their native ID, then discard them before normalizing private fields.
    if (!authorizedAccountIds.has(id)) continue;
    const account = parsePlaidAccount(raw);
    if (!account || accounts.has(account.nativeId)) return fail('account_scope_or_identity_conflict');
    accounts.set(account.nativeId, account);
  }
  // Unsupported/new response groups cannot silently establish complete coverage.
  const groups: Group[] = ['credit', 'loan', 'line_of_credit'];
  const records: Liability[] = [], seen = new Set<string>();
  for (const group of groups) {
    const rows = liabilities[group];
    if (rows == null) continue;
    if (!Array.isArray(rows) || rows.length > 500) return fail('invalid_liability_group');
    for (const raw of rows) {
      const id = text(object(raw)?.account_id);
      if (!id) return fail('liability_scope_or_identity_conflict');
      if (!authorizedAccountIds.has(id)) continue;
      const account = accounts.get(id);
      if (!account || seen.has(id)) return fail('liability_scope_or_identity_conflict');
      const record = normalize(group, raw, account);
      if (!record) return fail('unsupported_or_conflicting_liability');
      seen.add(id); records.push(record);
    }
  }
  const missingAccountIds = [...authorizedAccountIds].filter(id => !seen.has(id)).sort();
  // Provider records are cached/coverage-dependent; this leaf never proves LIVE,
  // complete commercial-debt coverage, verified company ownership or totals.
  return { records, coverage: 'partial', reason: missingAccountIds.length ? 'liability_terms_not_supplied' : null, missingAccountIds, institutionFreshnessVerified: false };
}
