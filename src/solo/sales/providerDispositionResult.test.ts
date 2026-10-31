import {expect,it} from 'vitest';
import {parseSalesInvoiceCommand} from '../../../supabase/functions/_shared/sales-invoice-command/contract';
import {providerDispositionResultMatches,readProviderDispositionReview} from '../../../supabase/functions/_shared/sales-invoice-command/provider-disposition';

const invoice='e0448300-0000-4000-8000-000000000001',payment='e0448300-0000-4000-8000-000000000002';
const observation='e0448300-0000-4000-8000-000000000003',operation='e0448300-0000-4000-8000-000000000004';
const tenant='e0448300-0000-4000-8000-000000000005',receipt='e0448300-0000-4000-8000-000000000006';
const command=()=>parseSalesInvoiceCommand({action:'invoice.record_provider_disposition',invoice_id:invoice,expected_version:8,provider_operation_id:payment,observation_id:observation,observation_version:2,expected_disposition_version:1,decision:'credit_returned_principal',credit_minor:10000,reason:'Original reviewed credit'});
const review=()=>({review_version:1,financial_evidence_version:3,effect:'internal_financial_disposition_only',invoice_id:invoice,invoice_version:8,client_id:'e0448300-0000-4000-8000-000000000007',client_name:'Fixture client',currency:'usd',provider_operation_id:payment,observation_id:observation,observation_version:2,disposition_version:1,decision:'credit_returned_principal',captured_minor:50000,retained_minor:40000,returned_minor:10000,credit_before_minor:10000,credit_after_minor:10000,standing_before:'recorded',outstanding_before_minor:300000,outstanding_after_minor:300000,refund_payable_before_minor:0,refund_payable_after_minor:0,source_hash:'a'.repeat(64)});
const result=()=>({ok:true,outcome:'financial_decision_recorded',effect:'internal_financial_disposition_only',payment_moved:false,customer_notified:false,rail_recorded:true,receipt_id:receipt,operation:{id:operation,action:command().action},provider_disposition_review:review(),disposition_version:2,invoice_version:9,row:{id:invoice,tenant_id:tenant,version:9}});
const unchanged=()=>({...result(),outcome:'financial_decision_unchanged',disposition_version:1,invoice_version:8,row:{id:invoice,tenant_id:tenant,version:8}});

it('accepts the exact recorded internal decision and original-operation recovery',()=>{
 const approved=readProviderDispositionReview(review(),command())!;
 expect(providerDispositionResultMatches(result(),command(),operation,tenant,approved)).toBe(true);
 expect(providerDispositionResultMatches({...result(),replayed:true},command(),operation,tenant)).toBe(true);
});
it('accepts an unchanged decision only with the same versions and financial treatment',()=>{
 expect(providerDispositionResultMatches(unchanged(),command(),operation,tenant)).toBe(true);
});
it.each([
 {credit_before_minor:0}, {standing_before:'needs_review',outstanding_before_minor:null,refund_payable_before_minor:null},
 {outstanding_before_minor:310000}, {refund_payable_before_minor:10000},
])('refuses an unchanged label when native evidence says the financial treatment changed %j',patch=>{
 expect(providerDispositionResultMatches({...unchanged(),provider_disposition_review:{...review(),...patch}},command(),operation,tenant)).toBe(false);
});
it.each([
 {receipt_id:null},{receipt_id:'not-a-receipt'},{operation:{id:payment,action:command().action}},
 {operation:{id:operation,action:'invoice.publish'}},{row:{id:invoice,tenant_id:payment,version:9}},
 {row:{id:payment,tenant_id:tenant,version:9}},{row:{id:invoice,tenant_id:tenant,version:8}},
 {disposition_version:1},{provider_disposition_review:{...review(),observation_version:3}},
 {paid:true},{outcome:'settled'},{replayed:'true'},
])('refuses a different record, receipt or unsupported completion claim %j',patch=>{
 expect(providerDispositionResultMatches({...result(),...patch},command(),operation,tenant)).toBe(false);
});
it('refuses a result whose complete native consequence differs from the stored approval',()=>{
 const approved=readProviderDispositionReview(review(),command())!;
 expect(providerDispositionResultMatches({...result(),provider_disposition_review:{...review(),source_hash:'b'.repeat(64)}},command(),operation,tenant,approved)).toBe(false);
});
it('cannot call a first decision unchanged',()=>{
 expect(providerDispositionResultMatches({...unchanged(),provider_disposition_review:{...review(),disposition_version:0}}, {...command(),expected_disposition_version:0},operation,tenant)).toBe(false);
});
