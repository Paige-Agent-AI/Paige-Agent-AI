/** A read contract, never an amount calculator or caller assertion. The scoped native reader
 * establishes a total from the original terms and, for negotiated installments, their immutable
 * fixed-creation receipt. Older readers carry no such evidence and remain unverified.
 */
export type CollectionAmountBasis='total'|'per_cycle'|'per_installment'|'unverified';
export type CollectionTermKind='one_time'|'recurring'|'installment'|'deposit'|'custom_quote';
/** Exact native refusal vocabulary; never display arbitrary backend diagnostics as this message. */
export const FIXED_COLLECTION_TOTAL_REFUSAL='The original commercial amount is not a verified engagement total. Review its original terms before saving a finite collection schedule.';
export function readCollectionAmountBasis(value:Record<string,unknown>):CollectionAmountBasis {
 const kind=value.term_kind,basis=value.agreed_amount_basis;
 if(kind===undefined&&basis===undefined)return 'unverified';
 if(typeof kind!=='string'||typeof basis!=='string'
  ||!['one_time','recurring','installment','deposit','custom_quote'].includes(kind)
  ||!['total','per_cycle','per_installment','unverified'].includes(basis)
  ||basis==='total'&&kind!=='one_time'&&kind!=='installment'
  ||basis==='per_cycle'&&kind!=='recurring'
  ||basis==='per_installment'&&kind!=='installment')throw new TypeError('COLLECTION_AMOUNT_BASIS_UNVERIFIED');
 return basis as CollectionAmountBasis;
}
