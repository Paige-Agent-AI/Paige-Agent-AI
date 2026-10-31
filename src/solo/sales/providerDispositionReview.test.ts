import {expect,it} from 'vitest';
import {readProviderDispositionReview} from '../../../supabase/functions/_shared/sales-invoice-command/provider-disposition';
const invoice='e0448100-0000-4000-8000-000000000001',payment='e0448100-0000-4000-8000-000000000002',observation='e0448100-0000-4000-8000-000000000003';
const command=()=>({action:'invoice.record_provider_disposition' as const,invoice_id:invoice,expected_version:8,provider_operation_id:payment,observation_id:observation,observation_version:2,expected_disposition_version:0,decision:'balance_due',reason:'Exact original payment review'});
const facts=()=>({review_version:1,financial_evidence_version:3,effect:'internal_financial_disposition_only',invoice_id:invoice,invoice_version:8,client_id:'e0448100-0000-4000-8000-000000000004',client_name:'Fixture client',currency:'usd',provider_operation_id:payment,observation_id:observation,observation_version:2,disposition_version:0,decision:'balance_due',captured_minor:50000,retained_minor:40000,returned_minor:10000,credit_before_minor:0,credit_after_minor:0,standing_before:'needs_review',outstanding_before_minor:null,outstanding_after_minor:310000,refund_payable_before_minor:null,refund_payable_after_minor:0,source_hash:'a'.repeat(64)});
it('retains the exact native original identity and consequence, with unknown prior standing explicit',()=>{expect(readProviderDispositionReview(facts(),command())).toEqual(facts());});
it('accepts known original standing without inventing an unknown prior balance',()=>{const f={...facts(),standing_before:'recorded',outstanding_before_minor:300000,refund_payable_before_minor:0};expect(readProviderDispositionReview(f,command())).toEqual(f);});
it('binds the exact owner-requested credit and resulting refund liability separately from cash returned',()=>{
 const c={...command(),decision:'credit_returned_principal',credit_minor:10000};const f={...facts(),decision:c.decision,retained_minor:50000,returned_minor:0,credit_after_minor:10000,outstanding_after_minor:0,refund_payable_after_minor:10000};expect(readProviderDispositionReview(f,c)).toEqual(f);
});
it('preserves native unpaid installments and a separate refund liability without inventing an offset',()=>{
 const f={...facts(),refund_payable_after_minor:10000};expect(readProviderDispositionReview(f,command())).toEqual(f);
});
it.each([
 {review_version:2},{financial_evidence_version:2},{effect:'refund_completed'},{invoice_id:payment},{invoice_version:9},
 {provider_operation_id:invoice},{observation_id:payment},{observation_version:3},{disposition_version:1},{decision:'credit_returned_principal'},
 {client_id:'unknown'},{client_name:''},{client_name:' '.repeat(3)},{currency:'USD'},{source_hash:'not-source'},
 {captured_minor:50000.5},{retained_minor:-1},{retained_minor:60000},{returned_minor:9999},{credit_before_minor:50001},{credit_after_minor:10000},
 {standing_before:'guessed'},{outstanding_before_minor:0},{refund_payable_before_minor:0},{outstanding_after_minor:'310000'},
 {outstanding_after_minor:-1},{refund_payable_after_minor:-1},{merchant_account_id:'unapproved-extension'},{snapshot:{}},{provider_called:true},
])('refuses mismatched, coerced, invented or unversioned native review %j',patch=>{expect(readProviderDispositionReview({...facts(),...patch},command())).toBeNull();});
it('refuses a credit preview differing from the exact credit amount',()=>{expect(readProviderDispositionReview({...facts(),decision:'credit_returned_principal',credit_after_minor:9999},{...command(),decision:'credit_returned_principal',credit_minor:10000})).toBeNull();});
it('returns a separate immutable native fact projection',()=>{const original=facts(),parsed=readProviderDispositionReview(original,command());expect(parsed).not.toBe(original);expect(Object.isFrozen(parsed)).toBe(true);original.client_name='Changed';expect(parsed?.client_name).toBe('Fixture client');});
