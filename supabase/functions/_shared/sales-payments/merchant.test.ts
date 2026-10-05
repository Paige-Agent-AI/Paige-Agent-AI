import { describe, expect, it } from 'vitest';
import { merchantReadiness, readStripeMerchant } from './merchant.ts';
const binding = { tenant_id:'test-tenant-a', provider:'stripe' as const, merchant_id:'acct_testA', environment:'test' as const, version:1 };
const observed = { tenant_id:binding.tenant_id, provider:binding.provider, binding_version:binding.version, merchant_id:'acct_testA', environment:'test' as const, observed_at:'2026-10-04T12:00:00.000Z', charges_enabled:true, payouts_enabled:true, details_submitted:true, payment_permission:true, email_confirmed:true, partner_authorized:true, disabled_reason:null };
const now=Date.parse('2026-10-04T12:01:00Z');
describe('server merchant readiness',()=>{
 it('requires account readback even for a bound merchant',()=>expect(merchantReadiness(binding,null,now).eligible).toBe(false));
 it('accepts current matching readback without claiming execution',()=>expect(merchantReadiness(binding,observed,now)).toEqual({eligible:true,state:'ready',reason:'MERCHANT_READY',provider_execution_verified:false}));
 it.each([{tenant_id:'other'},{provider:'paypal'},{binding_version:2},{merchant_id:'acct_other'},{environment:'live'},{observed_at:'2026-10-04T11:00:00Z'},{observed_at:'2026-10-04T13:00:00Z'},{observed_at:'invalid'},{charges_enabled:false},{payment_permission:false},{disabled_reason:'restricted'}])('fails closed for %j',patch=>expect(merchantReadiness(binding,{...observed,...patch} as typeof observed,now).eligible).toBe(false));
 it('does not require payout completion to receive a payment',()=>expect(merchantReadiness(binding,{...observed,payouts_enabled:false},now).eligible).toBe(true));
 it('keeps PayPal equally gated by seller and partner authority',()=>{
  const paypal={...binding,provider:'paypal' as const,merchant_id:'merchant-test'};
  const facts={...observed,provider:paypal.provider,merchant_id:paypal.merchant_id};
  expect(merchantReadiness(paypal,facts,now).eligible).toBe(true);
  for(const patch of [{partner_authorized:false},{email_confirmed:false},{payment_permission:false}])expect(merchantReadiness(paypal,{...facts,...patch},now).eligible).toBe(false);
 });
 it('refuses invalid clocks instead of accidentally accepting stale readiness',()=>expect(merchantReadiness(binding,observed,NaN).eligible).toBe(false));
});
describe('Stripe binding readback',()=>{
 it('retrieves the saved account rather than caller-provided merchant',async()=>{
  const calls:string[]=[];
  const facts=await readStripeMerchant(binding,{environment:'test',retrieveAccount:async id=>{calls.push(id);return {id,metadata:{tenant_id:binding.tenant_id},charges_enabled:true,payouts_enabled:true,details_submitted:true,capabilities:{card_payments:'active'},requirements:{disabled_reason:null}};}},()=>now);
  expect(calls).toEqual(['acct_testA']); expect(facts.merchant_id).toBe(binding.merchant_id);
 });
 it('rejects a different account returned by the provider',async()=>expect(readStripeMerchant(binding,{environment:'test',retrieveAccount:async()=>({id:'acct_other'})},()=>now)).rejects.toThrow('MERCHANT_MISMATCH'));
 it('refuses deleted provider accounts',async()=>expect(readStripeMerchant(binding,{environment:'test',retrieveAccount:async()=>({id:binding.merchant_id,deleted:true})},()=>now)).rejects.toThrow('MERCHANT_UNAVAILABLE'));
 it('refuses missing or foreign tenant provenance from a legacy writable binding',async()=>{
  for(const metadata of [undefined,{tenant_id:'test-tenant-other'}])await expect(readStripeMerchant(binding,{environment:'test',retrieveAccount:async()=>({id:binding.merchant_id,metadata})},()=>now)).rejects.toThrow('MERCHANT_TENANT_MISMATCH');
 });
 it('does not turn a readback timeout into disconnected or successful',async()=>expect(readStripeMerchant(binding,{environment:'test',retrieveAccount:async()=>{throw new Error('timeout');}},()=>now)).rejects.toThrow('timeout'));
});
