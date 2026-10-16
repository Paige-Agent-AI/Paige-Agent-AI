import { object, sourceDecimal } from './quickbooks-read-contract.ts';

// Normalized accounting-source facts only: no company authority, ledger write,
// expense recognition, bank settlement or supplier payment is established here.
const text = (v: unknown): string | null => typeof v === 'string' && v.trim().length > 0 && v.length <= 500 ? v : null;
const date = (v: unknown): string | null => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;
const amount = (v: unknown): string | null => { const n = sourceDecimal(v); return n !== null && !n.startsWith('-') ? n : null; };
const scaled = (v: string) => { const [whole, fraction = ''] = v.split('.'); return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0')); };
const reference = (v: unknown) => { const r = object(v); const id = text(r?.value); return id ? { nativeId: id, sourceLabel: text(r?.name) } : null; };
const currency = (v: unknown): string | null => typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null;

export function parseQuickBooksBill(value: unknown) {
  const row = object(value), nativeId = text(row?.Id);
  if (!row || !nativeId) return null;
  const total = amount(row.TotalAmt), balance = amount(row.Balance);
  const conflict = total !== null && balance !== null && scaled(balance) > scaled(total);
  const vendor = reference(row.VendorRef), dueDate = date(row.DueDate), transactionDate = date(row.TxnDate);
  return {
    nativeId, documentNumber: text(row.DocNumber), vendor,
    currency: currency(object(row.CurrencyRef)?.value), transactionDate, dueDate,
    recordedTotal: total, recordedOutstanding: conflict ? null : balance,
    accountingStatus: conflict || balance === null ? 'unknown' as const : scaled(balance) === 0n ? 'recorded_zero_balance' as const : 'recorded_outstanding' as const,
    issues: [...(total === null ? ['total_unknown'] : []), ...(balance === null ? ['balance_unknown'] : []), ...(conflict ? ['balance_exceeds_total'] : []),
      ...(vendor === null ? ['vendor_unknown'] : []), ...(dueDate === null ? ['due_date_unknown'] : []), ...(transactionDate === null ? ['transaction_date_unknown'] : [])],
    bankSettlementVerified: false as const, paymentExecutionSupported: false as const,
  };
}

export function parseQuickBooksPurchase(value: unknown) {
  const row = object(value), nativeId = text(row?.Id);
  if (!row || !nativeId) return null;
  return {
    nativeId, documentNumber: text(row.DocNumber), entity: reference(row.EntityRef), paymentAccount: reference(row.AccountRef),
    currency: currency(object(row.CurrencyRef)?.value), transactionDate: date(row.TxnDate), recordedTotal: amount(row.TotalAmt),
    paymentType: ['Cash', 'Check', 'CreditCard'].includes(String(row.PaymentType)) ? row.PaymentType as 'Cash' | 'Check' | 'CreditCard' : null,
    isCredit: typeof row.Credit === 'boolean' ? row.Credit : null,
    recognizedExpense: null, bankSettlementVerified: false as const,
  };
}
