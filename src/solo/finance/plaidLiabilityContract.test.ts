import { describe, expect, it } from 'vitest';
import { parsePlaidLiabilities } from '../../../supabase/functions/_shared/finance/plaid-liability-contract.ts';
const account = (id: string, type = 'loan', subtype = 'commercial', currency: string | null = 'USD') => ({ account_id: id, name: 'Business financing', mask: '1234', type, subtype, balances: { current: 100, available: 900, limit: 1000, iso_currency_code: currency } });
const payload = () => ({ item: { item_id: 'item-a' }, accounts: [account('loan-a')], liabilities: { loan: [{ account_id: 'loan-a', principal_balance: 80, origination_principal_amount: 100, next_payment_amount: 12, next_payment_due_date: '2026-11-01', maturity_date: '2028-11-01', payment_frequency: 'monthly', interest_rate: { percentage: 5.25, type: 'fixed' } }] } });
const read = (value: unknown, ids = ['loan-a']) => parsePlaidLiabilities(value, 'item-a', new Set(ids));
describe('controlled Plaid liability contracts', () => {
  it('preserves loan principal, dates and rate without cash or credit inference', () => {
    expect(read(payload()).records[0]).toMatchObject({ principalBalance: '80', originalPrincipal: '100', outstandingBalance: '100', nextPayment: '12', maturityDate: '2028-11-01', creditLimit: null, availableCredit: null, interestRatePercentage: '5.25', principalPayment: null, interestPayment: null });
  });
  it('keeps multiple same-name and same-mask accounts distinct and currencies separate', () => {
    const p = payload(); p.accounts.push(account('loan-b', 'loan', 'commercial', 'EUR')); p.liabilities.loan.push({ ...p.liabilities.loan[0], account_id: 'loan-b' });
    expect(read(p, ['loan-a', 'loan-b']).records.map(r => [r.nativeId, r.currency])).toEqual([['loan-a', 'USD'], ['loan-b', 'EUR']]);
  });
  it('maps explicit LOC capacity without calling it cash or maturity', () => {
    const r = read({ item: { item_id: 'item-a' }, accounts: [account('loc', 'loan', 'commercial line of credit')], liabilities: { line_of_credit: [{ account_id: 'loc', principal_balance: 100, available_credit: 700, credit_limit: 1000, minimum_payment_amount: 0, draw_period_end_date: '2028-01-01' }] } }, ['loc']).records[0];
    expect(r).toMatchObject({ product: 'revolving_line', principalBalance: '100', availableCredit: '700', creditLimit: '1000', minimumPayment: '0', maturityDate: null, drawPeriodEndDate: '2028-01-01' });
  });
  it('keeps card balances distinct from principal and preserves multiple APRs', () => {
    const r = read({ item: { item_id: 'item-a' }, accounts: [account('card', 'credit', 'credit card')], liabilities: { credit: [{ account_id: 'card', minimum_payment_amount: 10, aprs: [{ apr_percentage: 10, apr_type: 'purchase_apr' }, { apr_percentage: 20, apr_type: 'cash_apr' }] }] } }, ['card']).records[0];
    expect(r.principalBalance).toBeNull(); expect(r.aprs?.map(a => a.percentage)).toEqual(['10', '20']); expect(r.interestRatePercentage).toBeNull();
  });
  it('keeps absent amounts and currency unknown', () => {
    const p = payload(); p.accounts[0] = account('loan-a', 'loan', 'commercial', null);
    const r = read({ ...p, liabilities: { loan: [{ account_id: 'loan-a' }] } }).records[0];
    expect(r).toMatchObject({ principalBalance: null, nextPayment: null, currency: null });
  });
  it('preserves exact decimal strings and zero', () => {
    const p = payload(); const r = read({ ...p, liabilities: { loan: [{ account_id: 'loan-a', principal_balance: '123456789012345678901234.123456', next_payment_amount: 0 }] } }).records[0];
    expect(r.principalBalance).toBe('123456789012345678901234.123456'); expect(r.nextPayment).toBe('0');
  });
  it('sanitizes invalid dates, negative scheduled payments and rates', () => {
    const p = payload(); const r = read({ ...p, liabilities: { loan: [{ account_id: 'loan-a', next_payment_due_date: '2026-02-30', next_payment_amount: -1, interest_rate: { percentage: -1, type: 'invented' } }] } }).records[0];
    expect(r).toMatchObject({ nextPaymentDueDate: null, nextPayment: null, interestRatePercentage: null, interestRateType: null });
  });
  it('does not expose raw account numbers, addresses or guarantors', () => {
    const p = payload(); const result = read({ ...p, liabilities: { loan: [{ ...p.liabilities.loan[0], account_number: 'SECRET', guarantor: 'SECRET', servicer_address: { street: 'SECRET' } }] } });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('rejects wrong item identity', () => expect(read({ ...payload(), item: { item_id: 'other' } }).coverage).toBe('unavailable'));
  it('discards unconsented accounts in item-wide responses before normalizing them', () => {
    const p = payload(); p.accounts.push({...account('other'),name:'PERSONAL_SECRET'}); p.liabilities.loan.push({...p.liabilities.loan[0],account_id:'other'});
    const result=read(p); expect(result.records.map(r=>r.nativeId)).toEqual(['loan-a']); expect(JSON.stringify(result)).not.toContain('PERSONAL_SECRET');
  });
  it('rejects repeated native accounts', () => { const p = payload(); p.accounts.push(p.accounts[0]); expect(read(p).coverage).toBe('unavailable'); });
  it('rejects repeated liabilities instead of double-counting them', () => { const p = payload(); p.liabilities.loan.push(p.liabilities.loan[0]); expect(read(p).coverage).toBe('unavailable'); });
  it('does not attribute foreign liabilities to the selected account', () => { const p = payload(); p.liabilities.loan[0].account_id = 'other'; expect(read(p)).toMatchObject({records:[],coverage:'partial',missingAccountIds:['loan-a']}); });
  it('rejects selected liability references missing from the exact account response', () => { const p=payload(); p.liabilities.loan.push({...p.liabilities.loan[0],account_id:'loan-b'}); expect(read(p,['loan-a','loan-b']).coverage).toBe('unavailable'); });
  it('does not inspect unsupported private fields on a foreign liability', () => {
    const p=payload(); const result=read({...p,accounts:[...p.accounts,{account_id:'foreign',name:'PERSONAL_SECRET',invalid:true}],liabilities:{loan:[...p.liabilities.loan,{account_id:'foreign',aprs:'PRIVATE_INVALID',account_number:'PERSONAL_SECRET'}]}});
    expect(result.records).toHaveLength(1); expect(JSON.stringify(result)).not.toContain('PERSONAL_SECRET');
  });
  it('rejects contradictory card/loan classification', () => { const p = payload(); p.accounts[0] = account('loan-a', 'credit', 'credit card'); expect(read(p).coverage).toBe('unavailable'); });
  it('does not label personal student-loan records commercial', () => { const p = payload(); p.accounts[0] = account('loan-a', 'loan', 'student'); expect(read(p).coverage).toBe('unavailable'); });
  it('does not treat absent liability coverage as zero debt', () => expect(read({ ...payload(), liabilities: {} })).toMatchObject({ records: [], coverage: 'partial', missingAccountIds: ['loan-a'] }));
  it('refuses provider and item errors', () => { expect(read({ ...payload(), error: {} }).coverage).toBe('unavailable'); expect(read({ ...payload(), item: { item_id: 'item-a', error: {} } }).coverage).toBe('unavailable'); });
  it('bounds malformed collections and refuses an empty authorized scope', () => { expect(read({ ...payload(), liabilities: { loan: {} } }).coverage).toBe('unavailable'); expect(read(payload(), []).coverage).toBe('unavailable'); });
  it('bounds APR collections', () => expect(read({ ...payload(), liabilities: { loan: [{ account_id: 'loan-a', aprs: Array(51).fill({}) }] } }).coverage).toBe('unavailable'));
  it('makes no company ownership, institution freshness, total or live coverage claim', () => {
    const r = read(payload()); expect(r.coverage).toBe('partial'); expect(r.institutionFreshnessVerified).toBe(false); expect(r.records[0]).toMatchObject({ companyOwnershipVerified: false, accountingClassificationVerified: false, institutionUpdatedAt: null });
  });
});
