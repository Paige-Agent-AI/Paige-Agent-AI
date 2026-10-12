// Controlled provider normalization. No credentials, network, writes or authority grants.
// The caller must resolve company/account consent before invoking an ingestion adapter.
import { object, sourceDecimal } from './quickbooks-read-contract.ts';
const text = (value: unknown, max = 500): string | null => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null;
const currency = (value: unknown): string | null => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
const date = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
export function parsePlaidAccount(value: unknown) {
  const row = object(value);
  if (!row) return null;
  const nativeId = text(row.account_id), sourceLabel = text(row.name);
  if (!nativeId || !sourceLabel) return null;
  const type = text(row.type), subtype = text(row.subtype), balances = object(row.balances);
  const product = type === 'depository' ? 'deposit' : type === 'credit' && subtype === 'credit card' ? 'credit_card'
    : (type === 'credit' || type === 'loan') && ['line of credit', 'commercial line of credit'].includes(subtype ?? '') ? 'revolving_line'
    : type === 'loan' ? 'loan_obligation' : 'unclassified';
  return {
    nativeId, sourceLabel, officialLabel: text(row.official_name), mask: text(row.mask, 16), sourceType: type, sourceSubtype: subtype, product,
    currency: currency(balances?.iso_currency_code), unofficialCurrency: text(balances?.unofficial_currency_code, 32),
    currentBalance: sourceDecimal(balances?.current),
    availableCash: product === 'deposit' ? sourceDecimal(balances?.available) : null,
    // The documented credit-type capacity/limit contract is not extended to loan
    // accounts merely because their subtype identifies a commercial credit line.
    availableCredit: type === 'credit' && ['credit_card', 'revolving_line'].includes(product) ? sourceDecimal(balances?.available) : null,
    creditLimit: type === 'credit' && ['credit_card', 'revolving_line'].includes(product) ? sourceDecimal(balances?.limit) : null,
    // Cached account responses do not prove institution freshness or liability terms.
    institutionUpdatedAt: null, interestRate: null, minimumPayment: null, maturity: null,
  };
}
export function parsePlaidTransaction(value: unknown) {
  const row = object(value);
  if (!row) return null;
  const nativeId = text(row.transaction_id), accountId = text(row.account_id), sourceLabel = text(row.name), postedDate = date(row.date);
  if (!nativeId || !accountId || !sourceLabel || !postedDate || typeof row.pending !== 'boolean') return null;
  return {
    nativeId, accountId, sourceLabel, originalDescription: text(row.original_description), merchantLabel: text(row.merchant_name),
    amount: sourceDecimal(row.amount), currency: currency(row.iso_currency_code), unofficialCurrency: text(row.unofficial_currency_code, 32),
    date: postedDate, pending: row.pending, pendingTransactionId: text(row.pending_transaction_id),
    // Plaid signs: positive outflow, negative inflow. This is not an accounting classification.
    amountConvention: 'positive_outflow' as const,
  };
}
type Transaction = NonNullable<ReturnType<typeof parsePlaidTransaction>>;
type Removed = { nativeId: string; accountId: string };
type SyncResult = { pagesComplete: boolean; historyComplete: boolean; nextCursor: string | null; added: Transaction[]; modified: Transaction[]; removed: Removed[]; reason: string | null; pagesRead: number; restarts: number };
// Item-wide cursor only. No account-filtered cursor may be substituted. On any incomplete
// traversal, discard staged mutations and return the original cursor; persistence is atomic later.
export async function readPlaidTransactionPages(
  originalCursor: string | null, authorizedNativeAccounts: ReadonlySet<string>,
  fetchPage: (cursor: string | null) => Promise<unknown>, options: { pageCap?: number; restartCap?: number } = {},
): Promise<SyncResult> {
  const pageCap = options.pageCap ?? 100, restartCap = options.restartCap ?? 2;
  const failed = (reason: string, pagesRead: number, restarts: number): SyncResult => ({ pagesComplete: false, historyComplete: false, nextCursor: originalCursor, added: [], modified: [], removed: [], reason, pagesRead, restarts });
  if (!Number.isSafeInteger(pageCap) || pageCap < 1 || pageCap > 100 || !Number.isSafeInteger(restartCap) || restartCap < 0 || restartCap > 3 || (originalCursor !== null && !text(originalCursor, 256)) || originalCursor === 'now' || !authorizedNativeAccounts.size || authorizedNativeAccounts.size > 1000 || [...authorizedNativeAccounts].some(id => !text(id))) return failed('invalid_source_scope', 0, 0);
  // Snapshot the caller's selection before the first await. Membership/company
  // revocation still requires the canonical ingestion envelope's readback fence.
  const scopedAccounts = new Set(authorizedNativeAccounts);
  let pagesRead = 0;
  for (let restarts = 0; restarts <= restartCap; restarts++) {
    let cursor = originalCursor, restart = false;
    const cursors = new Set<string>(), identities = new Set<string>();
    const added: Transaction[] = [], modified: Transaction[] = [], removed: Removed[] = [];
    for (let page = 0; page < pageCap; page++) {
      let response: unknown;
      try { response = await fetchPage(cursor); } catch { return failed('source_read_failed', pagesRead, restarts); }
      pagesRead++;
      const row = object(response);
      if (row?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') { restart = true; break; }
      if (!row || row.error_code || !Array.isArray(row.added) || !Array.isArray(row.modified) || !Array.isArray(row.removed) || row.added.length + row.modified.length + row.removed.length > 500 || typeof row.has_more !== 'boolean') return failed('invalid_source_page', pagesRead, restarts);
      const next = text(row.next_cursor, 256);
      if (!next || (row.has_more && (next === cursor || cursors.has(next)))) return failed('invalid_source_cursor', pagesRead, restarts);
      cursors.add(next);
      for (const [values, target] of [[row.added, added], [row.modified, modified]] as const) {
        for (const value of values) {
          const parsed = parsePlaidTransaction(value);
          if (!parsed) return failed('invalid_transaction', pagesRead, restarts);
          if (identities.has(parsed.nativeId)) return failed('conflicting_transaction', pagesRead, restarts);
          identities.add(parsed.nativeId);
          // Never relabel a foreign/unconsented account as the selected local account.
          if (scopedAccounts.has(parsed.accountId)) target.push(parsed);
        }
      }
      for (const value of row.removed) {
        const removedRow = object(value), nativeId = text(removedRow?.transaction_id), accountId = text(removedRow?.account_id);
        if (!nativeId || !accountId || identities.has(nativeId)) return failed('invalid_removed_transaction', pagesRead, restarts);
        identities.add(nativeId);
        if (scopedAccounts.has(accountId)) removed.push({ nativeId, accountId });
      }
      cursor = next;
      if (!row.has_more) {
        if (!['INITIAL_UPDATE_COMPLETE', 'HISTORICAL_UPDATE_COMPLETE'].includes(String(row.transactions_update_status))) return failed('source_history_not_ready', pagesRead, restarts);
        return { pagesComplete: true, historyComplete: row.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE', nextCursor: cursor, added, modified, removed, reason: null, pagesRead, restarts };
      }
    }
    if (!restart) return failed('source_page_limit', pagesRead, restarts);
    if (restarts === restartCap) return failed('source_changed_during_pagination', pagesRead, restarts);
  }
  return failed('source_changed_during_pagination', pagesRead, restartCap);
}
