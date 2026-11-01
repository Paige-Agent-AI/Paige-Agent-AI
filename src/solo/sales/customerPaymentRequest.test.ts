import {describe,it,expect} from 'vitest';
import {readCustomerPaymentRequest,customerPaymentRequestCopy} from './customerPaymentRequest';
const now=Date.parse('2026-10-05T00:00:00Z');
const fixture={remaining_cents:300000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:'2026-10-06T00:00:00Z'}};
describe('customer hosted request readback',()=>{
 it('offers only the provider-hosted current request',()=>expect(readCustomerPaymentRequest(fixture,now)?.url).toBe(fixture.payment_request.provider_url));
 it.each(['outcome_unknown','settled','provider_accepted','failed'])('never exposes checkout from %s',state=>expect(readCustomerPaymentRequest({...fixture,payment_request:{...fixture.payment_request,state}},now)?.url).toBeNull());
 it.each(['https://example.com/pay','https://checkout.stripe.com.evil.test/pay','https://user:secret@checkout.stripe.com/pay'])('refuses unsafe URL %s',provider_url=>expect(readCustomerPaymentRequest({...fixture,payment_request:{...fixture.payment_request,provider_url}},now)?.url).toBeNull());
 it('suppresses expired or over-balance requests',()=>{expect(readCustomerPaymentRequest(fixture,Date.parse('2026-10-07'))?.url).toBeNull();expect(readCustomerPaymentRequest({...fixture,remaining_cents:0},now)?.url).toBeNull();});
 it('does not equate acceptance with confirmation',()=>expect(customerPaymentRequestCopy('provider_accepted')).toBe('The provider accepted the request. Payment has not been confirmed yet'));
});


// Current public document readback reuses the original canonical decoder.
import * as paymentReads from './customerPaymentRequest';
const financialPacket=(changes:Record<string,unknown>={}):Record<string,unknown>&{financial_summary:Record<string,unknown>}=>({
 invoice_number:'INV-CURRENT',invoice_id:'test-invoice',invoice_version:2,currency:'usd',
 remaining_cents:210000,payment_evidence_version:2,financial_evidence_version:3,payment_request:null,
 financial_summary:{schema_version:3,invoice_id:'test-invoice',invoice_version:2,currency:'usd',standing:'recorded',
  outstanding_minor:210000,refund_payable_minor:15000,credit_minor:20000,manual_recorded_minor:50000,
  provider_confirmed_minor:85000,provider_net_minor:70000,test_provider_minor:30000,source_hash:'a'.repeat(64)},...changes});
describe('current public invoice financial readback',()=>{
 it('retains actual debt, refund payable and credit without inventing a request',()=>{
  const value=paymentReads.readCustomerInvoiceFinancialStatus(financialPacket(),now);
  expect(value?.summary.outstanding_minor).toBe(210000);expect(value?.summary.refund_payable_minor).toBe(15000);
  expect(value?.summary.credit_minor).toBe(20000);expect(value?.request).toBeNull();
 });
 it.each(['needs_review','allocation_required','unavailable'])('retains null money and no request for %s',standing=>{
  const packet=financialPacket();Object.assign(packet.financial_summary,{standing,outstanding_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,source_hash:null});
  packet.remaining_cents=null;
  expect(paymentReads.readCustomerInvoiceFinancialStatus(packet,now)?.summary.standing).toBe(standing);
 });
 it('keeps TEST evidence separate and validates a current hosted request',()=>{
  const packet=financialPacket({payment_request:{...fixture.payment_request,environment:'test'}});
  expect(paymentReads.readCustomerInvoiceFinancialStatus(packet,now)?.request?.url).toBe(fixture.payment_request.provider_url);
  expect(paymentReads.readCustomerInvoiceFinancialStatus(packet,now)?.environment).toBe('test');
 });
 it.each(['legacy','missing-version','missing-summary','mismatched-money','foreign-invoice','foreign-currency','unrecognized-key','missing-environment','held-with-link'])('refuses %s without a legacy/zero fallback',kind=>{
  const packet=financialPacket();
  if(kind==='legacy')Object.assign(packet,fixture);
  if(kind==='missing-version')delete packet.financial_evidence_version;
  if(kind==='missing-summary')delete packet.financial_summary;
  if(kind==='mismatched-money')packet.remaining_cents=1;
  if(kind==='foreign-invoice')packet.financial_summary.invoice_id='other';
  if(kind==='foreign-currency')packet.financial_summary.currency='eur';
  if(kind==='unrecognized-key')packet.internal_context={};
  if(kind==='missing-environment')packet.payment_request=fixture.payment_request;
  if(kind==='held-with-link'){Object.assign(packet.financial_summary,{standing:'unavailable',outstanding_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});packet.remaining_cents=null;packet.payment_request={...fixture.payment_request,environment:'live'};}
  expect(paymentReads.readCustomerInvoiceFinancialStatus(packet,now)).toBeNull();
 });
});
