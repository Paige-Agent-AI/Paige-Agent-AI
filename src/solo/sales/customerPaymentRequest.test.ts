import {describe,it,expect} from 'vitest';
import {readCustomerPaymentRequest,customerPaymentRequestCopy,formatPaymentMinor} from './customerPaymentRequest';
const now=Date.parse('2026-10-05T00:00:00Z');
const fixture={remaining_cents:300000,payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'live',provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:'2026-10-06T00:00:00Z'}};

it('formats canonical integer text exactly without rounding a large recorded balance',()=>{
 expect(formatPaymentMinor('9007199254740993123456','usd').replace(/[^0-9]/g,'')).toBe('9007199254740993123456');
 expect(formatPaymentMinor('350000','usd')).toBe(formatPaymentMinor(350000,'usd'));
 expect(formatPaymentMinor('-1250','usd')).toBe(formatPaymentMinor(-1250,'usd'));
 expect(formatPaymentMinor('123456','jpy')).toBe(formatPaymentMinor(123456,'jpy'));
 expect(formatPaymentMinor('123456','kwd')).toBe(formatPaymentMinor(123456,'kwd'));
 expect(formatPaymentMinor('1.5','usd')).toBe('Unavailable');
});
describe('customer hosted request readback',()=>{
 it('offers only the provider-hosted current request',()=>expect(readCustomerPaymentRequest(fixture,now)?.url).toBe(fixture.payment_request.provider_url));
 it.each(['outcome_unknown','settled','provider_accepted','failed'])('never exposes checkout from %s',state=>expect(readCustomerPaymentRequest({...fixture,payment_request:{...fixture.payment_request,state}},now)?.url).toBeNull());
 it.each(['https://example.com/pay','https://checkout.stripe.com.evil.test/pay','https://user:secret@checkout.stripe.com/pay'])('refuses unsafe URL %s',provider_url=>expect(readCustomerPaymentRequest({...fixture,payment_request:{...fixture.payment_request,provider_url}},now)?.url).toBeNull());
 it('suppresses expired or over-balance requests',()=>{expect(readCustomerPaymentRequest(fixture,Date.parse('2026-10-07'))?.url).toBeNull();expect(readCustomerPaymentRequest({...fixture,remaining_cents:0},now)?.url).toBeNull();});
 it('does not equate acceptance with confirmation',()=>expect(customerPaymentRequestCopy('provider_accepted')).toBe('The provider accepted the request. Payment has not been confirmed yet'));
 it('keeps test and unspecified settlement distinct from live payment confirmation',()=>{
  expect(customerPaymentRequestCopy('settled','test')).toBe('Test payment confirmed · no live payment');
  expect(customerPaymentRequestCopy('settled','live')).toBe('Payment confirmed');
  expect(customerPaymentRequestCopy('settled')).toBe('Payment recorded · provider environment unverified');
  expect(readCustomerPaymentRequest({...fixture,payment_request:{...fixture.payment_request,environment:'test'}},now)?.environment).toBe('test');
  const unclassified={...fixture,payment_request:{...fixture.payment_request,environment:undefined}};
  expect(readCustomerPaymentRequest(unclassified,now)?.environment).toBe('unverified');
  expect(readCustomerPaymentRequest(unclassified,now)?.url).toBeNull();
 });
});
