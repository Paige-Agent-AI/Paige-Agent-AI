import {describe,it,expect} from 'vitest';
import {parsePaymentObligationReference,parsePaymentObligationEvidence} from './accepted-obligation.ts';

// References identify original accepted records. They are never money or signing authority.
const reference={commercial_terms_id:'11111111-1111-4111-8111-111111111111',
 signing_id:'22222222-2222-4222-8222-222222222222',signing_version:2,terms_version:1,sequence:1};
const evidence={reference,source_digest:'a'.repeat(64),due_date:'2026-11-15',scheduled_minor:50000,remaining_minor:50000};

describe('original accepted-obligation payment references',()=>{
 it('retains the exact accepted versions and sequence without generating a schedule',()=>{
  expect(parsePaymentObligationReference(reference)).toEqual(reference);
  expect(parsePaymentObligationEvidence(evidence)).toEqual(evidence);
 });
 it('keeps an unpaid 500 deposit and a later 300 installment as separate original references',()=>{
  const later={...evidence,reference:{...reference,sequence:2},due_date:'2026-12-15',scheduled_minor:30000,remaining_minor:30000};
  expect(parsePaymentObligationEvidence(later)).toEqual(later);
  expect(parsePaymentObligationEvidence(evidence).reference.sequence).toBe(1);
 });
 it('preserves partial, fully allocated and zero-version source evidence rather than calling it a charge',()=>{
  expect(parsePaymentObligationEvidence({...evidence,remaining_minor:12500}).remaining_minor).toBe(12500);
  expect(parsePaymentObligationEvidence({...evidence,remaining_minor:0}).remaining_minor).toBe(0);
  expect(parsePaymentObligationReference({...reference,terms_version:0}).terms_version).toBe(0);
 });
 it.each([null,[],{}, {...reference,commercial_terms_id:'foreign'}, {...reference,signing_id:'foreign'},
  {...reference,signing_version:0},{...reference,terms_version:-1},{...reference,sequence:0},
  {...reference,sequence:241},{...reference,sequence:1.5},{...reference,terms_version:Number.MAX_SAFE_INTEGER+1},
  {...reference,tenant_id:'33333333-3333-4333-8333-333333333333'},
  {...reference,approved:true},{...reference,amount_minor:50000},{...reference,source_digest:'a'.repeat(64)}
 ])('refuses malformed references or caller-supplied financial/authority fields %j',value=>{
  expect(()=>parsePaymentObligationReference(value)).toThrow('PAYMENT_OBLIGATION_INVALID');
 });
 it.each([{source_digest:'a'.repeat(63)},{source_digest:'A'.repeat(64)},{due_date:'2026-02-30'},
  {due_date:'2026-11-15T00:00:00Z'},{scheduled_minor:0},{scheduled_minor:0.5},
  {scheduled_minor:2147483648},{remaining_minor:-1},{remaining_minor:50001},{remaining_minor:NaN},
  {approved:true},{provider_verified:true},{paid:true},{signed:true},{currency:'usd'}
 ])('refuses inconsistent source facts without manufacturing a trusted payment %j',patch=>{
  expect(()=>parsePaymentObligationEvidence({...evidence,...patch})).toThrow('PAYMENT_OBLIGATION_INVALID');
 });
 it('does not retain mutable references supplied by its caller',()=>{
  const input={...evidence,reference:{...reference}};
  const parsed=parsePaymentObligationEvidence(input);
  input.reference.sequence=2;
  expect(parsed.reference.sequence).toBe(1);
 });
});
