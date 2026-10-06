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
