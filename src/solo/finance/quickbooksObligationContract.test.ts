import { describe, expect, it } from 'vitest';
import { parseQuickBooksBill, parseQuickBooksPurchase } from '../../../supabase/functions/_shared/finance/quickbooks-obligation-contract';

describe('controlled accounting obligations without payment effects', () => {
  const bill = { Id: 'bill-1', DocNumber: 'Supplier / 001', VendorRef: { value: 'vendor-1', name: 'Fournisseur' }, CurrencyRef: { value: 'EUR' }, TotalAmt: '120.00', Balance: '40.00', TxnDate: '2026-10-01', DueDate: '2026-10-31' };
  it('preserves native references, source labels and recorded outstanding amounts', () => {
    expect(parseQuickBooksBill(bill)).toMatchObject({ nativeId: 'bill-1', documentNumber: bill.DocNumber, vendor: { nativeId: 'vendor-1', sourceLabel: 'Fournisseur' }, currency: 'EUR', recordedTotal: '120.00', recordedOutstanding: '40.00', accountingStatus: 'recorded_outstanding', issues: [], bankSettlementVerified: false, paymentExecutionSupported: false });
  });
  it('never turns an explicit zero balance into verified bank payment', () => {
    expect(parseQuickBooksBill({ ...bill, Balance: '0.00' })).toMatchObject({ recordedOutstanding: '0.00', accountingStatus: 'recorded_zero_balance', bankSettlementVerified: false });
  });
  it('retains absent amounts, vendor, currency and dates as unknown', () => {
    expect(parseQuickBooksBill({ Id: 'b' })).toMatchObject({ recordedOutstanding: null, recordedTotal: null, currency: null, vendor: null, dueDate: null, accountingStatus: 'unknown' });
  });
  it.each([undefined, null, '', -1, '1e3', '1.1234567', Infinity])('does not infer balance from invalid value %j', value => {
    expect(parseQuickBooksBill({ ...bill, Balance: value })).toMatchObject({ recordedOutstanding: null, accountingStatus: 'unknown' });
  });
  it('refuses conflicting outstanding values with exact large-decimal comparison', () => {
    expect(parseQuickBooksBill({ ...bill, TotalAmt: '9007199254740993.000001', Balance: '9007199254740993.000002' })).toMatchObject({ recordedOutstanding: null, accountingStatus: 'unknown', issues: ['balance_exceeds_total'] });
  });
  it('keeps native identities distinct despite identical vendor and document labels', () => {
    expect(parseQuickBooksBill({ ...bill, Id: 'bill-2' })?.nativeId).toBe('bill-2');
  });
  it.each(['2026-02-30', 'tomorrow', null])('does not fabricate due dates %j', value => expect(parseQuickBooksBill({ ...bill, DueDate: value })?.dueDate).toBeNull());
  it.each([null, [], {}, { Id: 1 }])('rejects absent native identity %j', value => expect(parseQuickBooksBill(value)).toBeNull());
  it('does not declare a purchase recognized expense, bank payment or cash outflow', () => {
    expect(parseQuickBooksPurchase({ Id: 'p1', EntityRef: { value: 'v1', name: 'Source vendor' }, AccountRef: { value: 'card1', name: 'Company card' }, TotalAmt: '55.25', PaymentType: 'CreditCard', Credit: true })).toMatchObject({ paymentType: 'CreditCard', isCredit: true, recordedTotal: '55.25', recognizedExpense: null, bankSettlementVerified: false, currency: null });
  });
  it('preserves unknown purchase type and missing credit flag', () => {
    expect(parseQuickBooksPurchase({ Id: 'p2', PaymentType: 'LOC' })).toMatchObject({ paymentType: null, isCredit: null, recordedTotal: null });
  });
});
