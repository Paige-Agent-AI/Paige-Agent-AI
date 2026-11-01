import {expect,it} from 'vitest';
import {parseSalesInvoiceCommand} from '../../../supabase/functions/_shared/sales-invoice-command/contract';
const invoice='e0448000-0000-4000-8000-000000000001',payment='e0448000-0000-4000-8000-000000000002',observation='e0448000-0000-4000-8000-000000000003';
const intent=()=>({action:'invoice.record_provider_disposition',invoice_id:invoice,expected_version:8,provider_operation_id:payment,observation_id:observation,observation_version:2,expected_disposition_version:0,decision:'balance_due',reason:'Owner reviewed the original returned payment.'});
it.each(['balance_due','credit_returned_principal'])('preserves exact reviewed original evidence and explicit %s decision',decision=>{
 const value={...intent(),decision,...(decision==='credit_returned_principal'?{credit_minor:10000}:{})};expect(parseSalesInvoiceCommand(value)).toEqual(value);
});
it('normalizes original record UUIDs without changing the retained decision reason',()=>{
 const value={...intent(),invoice_id:invoice.toUpperCase(),provider_operation_id:payment.toUpperCase(),observation_id:observation.toUpperCase()};
 expect(parseSalesInvoiceCommand(value)).toEqual(intent());
});
it('accepts an explicitly versioned correction rather than replacing decision history',()=>{
 const value={...intent(),expected_disposition_version:3};expect(parseSalesInvoiceCommand(value)).toEqual(value);
});
it.each([undefined,0,-1,'10000',1.5,2147483648])('credit requires the owner’s exact bounded minor amount: %j',credit_minor=>{
 expect(()=>parseSalesInvoiceCommand({...intent(),decision:'credit_returned_principal',credit_minor})).toThrow('SALES_INVOICE_COMMAND_INVALID');
});
it.each([
 {expected_version:Number.MAX_SAFE_INTEGER},
 {provider_operation_id:null},{provider_operation_id:invoice+'x'},{observation_id:'not-original'},
 {observation_version:0},{observation_version:'2'},{observation_version:1.5},{observation_version:Number.MAX_SAFE_INTEGER},
 {expected_disposition_version:-1},{expected_disposition_version:'0'},{expected_disposition_version:Number.MAX_SAFE_INTEGER},
 {decision:'refund'},{decision:'paid'},{decision:'credit'},{decision:['balance_due']},
 {reason:''},{reason:'   '},{reason:null},{reason:'r'.repeat(501)},
 {amount_minor:100},{credit_minor:100},{provider_environment:'live'},{client_id:invoice},
 {actor_user_id:invoice},{governance:{approved:true}},{snapshot:{}},{approved_fingerprint:'0123456789abcdef'},
])('refuses invented amount, authority, source or malformed decision %j',patch=>{
 expect(()=>parseSalesInvoiceCommand({...intent(),...patch})).toThrow('SALES_INVOICE_COMMAND_INVALID');
});
it('keeps all original payment, publication and reversal discriminator behavior',()=>{
 expect(parseSalesInvoiceCommand({action:'invoice.publish',invoice_id:invoice,expected_version:8})).toEqual({action:'invoice.publish',invoice_id:invoice,expected_version:8});
 expect(parseSalesInvoiceCommand({action:'invoice.reverse_manual_payment',invoice_id:invoice,expected_version:8,payment_id:payment,reason:'Original full correction'})).toEqual({action:'invoice.reverse_manual_payment',invoice_id:invoice,expected_version:8,payment_id:payment,reason:'Original full correction'});
});
