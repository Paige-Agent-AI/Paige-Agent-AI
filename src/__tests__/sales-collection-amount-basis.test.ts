import {describe,expect,it} from 'vitest';
import {readCollectionAmountBasis} from '../../supabase/functions/_shared/sales-collections/amount-basis';
import {previewRepaymentRead} from '../../supabase/functions/_shared/sales-collections/repayment-read';

const agreement='40000000-0000-4000-8000-000000000001';
const input={agreement_id:agreement,deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'};
const row={id:agreement,client_id:'30000000-0000-4000-8000-000000000001',offer_id:'50000000-0000-4000-8000-000000000001',status:'draft',version:0,terms_state:'absent',amount_cents:350000,currency:'usd',recorded_terms:null};
describe('fixed repayment requires canonical total semantics',()=>{
 it('keeps an older reader compatible without inventing a total',()=>{
  expect(readCollectionAmountBasis({})).toBe('unverified');
  expect(previewRepaymentRead(input,[row])).toMatchObject({state:'needs_input',fields:['verified_fixed_total_basis']});
 });
 it.each(['one_time','installment','deposit','custom_quote'])('uses a verified %s total with the original calculation',term_kind=>{
  expect(readCollectionAmountBasis({term_kind,agreed_amount_basis:'total'})).toBe('total');
  const result=previewRepaymentRead(input,[{...row,term_kind,agreed_amount_basis:'total'}]);
  expect(result).toMatchObject({state:'ready_for_review',total_cents:350000,installment_count:10,execution:'not_started'});
 });
 it.each([['recurring','per_cycle'],['installment','per_installment']])('never converts %s/%s into a finite debt',(term_kind,agreed_amount_basis)=>{
  expect(readCollectionAmountBasis({term_kind,agreed_amount_basis})).toBe(agreed_amount_basis);
  expect(previewRepaymentRead(input,[{...row,term_kind,agreed_amount_basis}])).toMatchObject({state:'refused',code:'FIXED_TOTAL_REQUIRED'});
 });
 it.each(['installment','deposit','custom_quote'])('asks for verified source semantics for ambiguous %s terms',term_kind=>{
  expect(previewRepaymentRead(input,[{...row,term_kind,agreed_amount_basis:'unverified'}])).toMatchObject({state:'needs_input',fields:['verified_fixed_total_basis']});
 });
 it.each([
  {term_kind:'recurring',agreed_amount_basis:'total'},
  {term_kind:'deposit',agreed_amount_basis:'per_cycle'},
  {term_kind:'one_time',agreed_amount_basis:'per_cycle'},
  {term_kind:'custom_quote',agreed_amount_basis:'per_installment'},
  {term_kind:'one_time'}, {agreed_amount_basis:'total'},
  {term_kind:'fabricated',agreed_amount_basis:'total'},
  {term_kind:'one_time',agreed_amount_basis:'guaranteed'},
  {term_kind:['one_time'],agreed_amount_basis:'unverified'},
  {term_kind:'one_time',agreed_amount_basis:['total']},
  {term_kind:null,agreed_amount_basis:'unverified'},
 ])('refuses contradictory or malformed semantics %j',value=>{
  expect(()=>readCollectionAmountBasis(value)).toThrow();
 });
 it('does not replace an existing recurring schedule even when original principal is fixed',()=>{
  expect(previewRepaymentRead(input,[{...row,term_kind:'one_time',agreed_amount_basis:'total',recorded_terms:{kind:'recurring'}}])).toMatchObject({state:'conflict',code:'RECORDED_SCHEDULE_DIFFERS'});
 });
});
