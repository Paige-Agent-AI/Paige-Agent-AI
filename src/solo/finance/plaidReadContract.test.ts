import { describe, expect, it, vi } from 'vitest';
import { parsePlaidAccount, parsePlaidTransaction, readPlaidTransactionPages } from '../../../supabase/functions/_shared/finance/plaid-read-contract';
const txn = (id: string, account = 'test-account-1') => ({ transaction_id: id, account_id: account, name: 'Original vendor / dépôt', date: '2026-10-09', amount: -15.25, iso_currency_code: 'EUR', pending: false });
const page = (cursor: string, more = false, added: unknown[] = [], modified: unknown[] = [], removed: unknown[] = []) => ({ next_cursor: cursor, has_more: more, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', added, modified, removed });
const accounts = new Set(['test-account-1', 'test-account-2']);
describe('controlled Plaid reads — no provider traffic or authority grants', () => {
  it('preserves multiple equal-label/mask accounts by exact native identity', () => {
    const row = { account_id: 'test-account-1', name: 'Réserve', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 0, available: null, iso_currency_code: 'EUR' } };
    expect(parsePlaidAccount(row)).toMatchObject({ nativeId: 'test-account-1', sourceLabel: 'Réserve', currentBalance: '0', availableCash: null, availableCredit: null, currency: 'EUR' });
    expect(parsePlaidAccount({ ...row, account_id: 'test-account-2' })?.nativeId).toBe('test-account-2');
  });
  it('does not classify a credit card as LOC or its capacity as cash', () => {
    expect(parsePlaidAccount({ account_id: 'test-card', name: 'Business LOC', type: 'credit', subtype: 'credit card', balances: { current: 500, available: 100, limit: 700 } })).toMatchObject({ product: 'credit_card', availableCash: null, availableCredit: '100', creditLimit: '700', currency: null });
    expect(parsePlaidAccount({ account_id: 'test-loc', name: 'Card', type: 'credit', subtype: 'line of credit' })?.product).toBe('revolving_line');
  });
  it('does not infer loan terms, principal or company ownership from a balance', () => {
    expect(parsePlaidAccount({ account_id: 'test-loan', name: 'Equipment', type: 'loan', balances: { current: 500 } })).toMatchObject({ product: 'loan_obligation', availableCash: null, availableCredit: null, interestRate: null, minimumPayment: null, maturity: null, institutionUpdatedAt: null });
  });
  it.each(['line of credit', 'commercial line of credit'])('retains explicit loan credit-line subtype %s without inventing capacity', subtype => {
    expect(parsePlaidAccount({ account_id: 'commercial-line', name: 'Operating facility', type: 'loan', subtype, balances: { current: 500, available: 100, limit: 600 } })).toMatchObject({ product: 'revolving_line', currentBalance: '500', availableCash: null, availableCredit: null, creditLimit: null, interestRate: null });
  });
  it('does not classify an ordinary commercial loan as a revolving line', () => {
    expect(parsePlaidAccount({ account_id: 'commercial-term', name: 'Line of credit', type: 'loan', subtype: 'commercial' })?.product).toBe('loan_obligation');
  });
  it('keeps unknown amounts/currency unknown and preserves the Plaid sign convention', () => {
    expect(parsePlaidTransaction({ ...txn('test-tx'), amount: null, iso_currency_code: null })).toMatchObject({ amount: null, currency: null, amountConvention: 'positive_outflow' });
    expect(parsePlaidTransaction(txn('test-tx'))?.amount).toBe('-15.25');
    expect(parsePlaidTransaction({ ...txn('test-tx'), date: '2026-02-30' })).toBeNull();
  });
  it('stages all pages, routes accounts exactly, and includes modifications/removals', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page('test-next-1', true, [txn('test-add-1'), txn('test-foreign', 'test-foreign-account')])).mockResolvedValueOnce(page('test-next-2', false, [txn('test-add-2', 'test-account-2')], [txn('test-mod')], [{ transaction_id: 'test-remove', account_id: 'test-account-2' }]));
    const result = await readPlaidTransactionPages('test-original', accounts, fetch);
    expect(result).toMatchObject({ pagesComplete: true, historyComplete: true, nextCursor: 'test-next-2', added: [{ nativeId: 'test-add-1', accountId: 'test-account-1' }, { nativeId: 'test-add-2', accountId: 'test-account-2' }], modified: [{ nativeId: 'test-mod' }], removed: [{ nativeId: 'test-remove', accountId: 'test-account-2' }] });
    expect(fetch.mock.calls).toEqual([['test-original'], ['test-next-1']]);
  });
  it('does not expand the account scope when the caller mutates its selection during pagination', async () => {
    const selected = new Set(['test-account-1']);
    const fetch = vi.fn().mockImplementationOnce(async () => {
      selected.add('test-foreign-account');
      return page('test-next', false, [txn('test-owned'), txn('test-foreign', 'test-foreign-account')]);
    });
    const result = await readPlaidTransactionPages(null, selected, fetch);
    expect(result.pagesComplete).toBe(true);
    expect(result.added.map(record => record.nativeId)).toEqual(['test-owned']);
  });
  it('restarts from original cursor and discards prior pages after provider mutation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page('test-first', true, [txn('test-old')])).mockResolvedValueOnce({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }).mockResolvedValueOnce(page('test-new', false, [txn('test-current')]));
    expect(await readPlaidTransactionPages('test-original', accounts, fetch)).toMatchObject({ pagesComplete: true, restarts: 1, added: [{ nativeId: 'test-current' }] });
    expect(fetch.mock.calls).toEqual([['test-original'], ['test-first'], ['test-original']]);
  });
  it.each([
    { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'secret provider error' },
    { ...page('test-first'), has_more: 'false' },
    { ...page('test-first'), added: [txn('test-duplicate'), txn('test-duplicate')] },
    { ...page('test-first'), removed: [{ transaction_id: 'test-remove' }] },
    { ...page('test-first'), next_cursor: null },
    { ...page('test-first'), transactions_update_status: 'NOT_READY' },
  ])('refuses malformed/revoked/incomplete source without committing staged records %j', async response => {
    const fetch = vi.fn().mockResolvedValueOnce(page('test-first', true, [txn('test-staged')])).mockResolvedValueOnce(response);
    expect(await readPlaidTransactionPages('test-original', accounts, fetch)).toMatchObject({ pagesComplete: false, nextCursor: 'test-original', added: [], modified: [], removed: [] });
  });
  it('does not call empty/invalid scope, cursor fast-forward or unlimited pages', async () => {
    const fetch = vi.fn();
    for (const [cursor, scope, options] of [[null, new Set<string>(), {}], ['now', accounts, {}], [null, accounts, { pageCap: 101 }]] as const) expect((await readPlaidTransactionPages(cursor, scope, fetch, options)).pagesComplete).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('limits pagination/restarts and hides provider errors', async () => {
    expect(await readPlaidTransactionPages(null, accounts, async () => page('test-next', true), { pageCap: 1 })).toMatchObject({ reason: 'source_page_limit', nextCursor: null, added: [] });
    expect(await readPlaidTransactionPages(null, accounts, async () => ({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }), { restartCap: 0 })).toMatchObject({ reason: 'source_changed_during_pagination' });
    expect(await readPlaidTransactionPages(null, accounts, async () => { throw new Error('token/provider detail'); })).toMatchObject({ reason: 'source_read_failed' });
  });
  it('distinguishes completed initial pages from incomplete historical coverage', async () => {
    expect(await readPlaidTransactionPages(null, accounts, async () => ({ ...page('test-next'), transactions_update_status: 'INITIAL_UPDATE_COMPLETE' }))).toMatchObject({ pagesComplete: true, historyComplete: false });
  });
});
