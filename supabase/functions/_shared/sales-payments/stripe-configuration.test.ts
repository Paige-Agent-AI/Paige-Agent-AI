import {describe,it,expect} from 'vitest';
import {salesStripeSecret,salesStripeObservationsEnabled} from './stripe-configuration.ts';

describe('original Sales credential namespace',()=>{
 const environment=(values:Record<string,string|undefined>)=>(name:string)=>values[name];
 it('preserves the deployed primary credential when no Sales override is configured',()=>{
  expect(salesStripeSecret(environment({STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_PRIMARY'}))).toBe('sk_live_SYNTHETIC_PRIMARY');
 });
 it('uses the separately configured Sales TEST credential without reading or changing platform LIVE billing',()=>{
  const reads:string[]=[];const values:Record<string,string>={STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_PRIMARY',SALES_STRIPE_SECRET_KEY:'sk_test_SYNTHETIC_SALES'};
  expect(salesStripeSecret(name=>{reads.push(name);return values[name]})).toBe('sk_test_SYNTHETIC_SALES');
  expect(reads).toEqual(['SALES_STRIPE_SECRET_KEY']);expect(values.STRIPE_SECRET_KEY).toBe('sk_live_SYNTHETIC_PRIMARY');
 });
 it('does not fall through to LIVE when Sales is explicitly disabled with an empty value',()=>{
  expect(salesStripeSecret(environment({STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_PRIMARY',SALES_STRIPE_SECRET_KEY:''}))).toBe('');
 });
 it('keeps a separately configured LIVE Sales namespace independent of platform billing',()=>{
  expect(salesStripeSecret(environment({STRIPE_SECRET_KEY:'sk_test_SYNTHETIC_PRIMARY',SALES_STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_SALES'}))).toBe('sk_live_SYNTHETIC_SALES');
 });
 it('is unavailable without either authorized configured credential',()=>{expect(salesStripeSecret(environment({}))).toBe('');});
});


describe('provider observation activation remains explicit',()=>{
 it.each([undefined,'','false','TRUE','1','true '])('keeps unapproved activation %s off',value=>{
  expect(salesStripeObservationsEnabled(()=>value)).toBe(false);
 });
 it('enables only the exact operator-configured true value',()=>{expect(salesStripeObservationsEnabled(()=> 'true')).toBe(true);});
});
