import {describe,it,expect,vi} from 'vitest';
import {salesStripeSecret,salesStripeReadbackSecret,salesStripeObservationsEnabled} from './stripe-configuration.ts';

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


describe('original-record GET-only credential recovery',()=>{
 const values={STRIPE_SECRET_KEY:'sk_live_SYNTHETIC_PRIMARY',SALES_STRIPE_SECRET_KEY:'sk_test_SYNTHETIC_SALES'};
 it('retains the configured TEST dispatch key while recovering only the original LIVE read key',()=>{
  const read=(name:string)=>(values as Record<string,string>)[name];
  expect(salesStripeSecret(read)).toBe(values.SALES_STRIPE_SECRET_KEY);
  expect(salesStripeReadbackSecret(read,'test')).toBe(values.SALES_STRIPE_SECRET_KEY);
  expect(salesStripeReadbackSecret(read,'live')).toBe(values.STRIPE_SECRET_KEY);
  expect(salesStripeSecret(read)).toBe(values.SALES_STRIPE_SECRET_KEY);
 });
 it.each(['','invalid','sk_malformed'])('never re-enables explicitly disabled/invalid Sales configuration %s',override=>{
  expect(salesStripeReadbackSecret(name=>name==='SALES_STRIPE_SECRET_KEY'?override:values.STRIPE_SECRET_KEY,'live')).toBe('');
 });
 it('refuses recovery when neither configured key matches the original environment',()=>{
  expect(salesStripeReadbackSecret(()=>values.SALES_STRIPE_SECRET_KEY,'live')).toBe('');
 });
 it('supports restricted configured TEST keys without reading platform credentials',()=>{
  const read=vi.fn(()=> 'rk_test_SYNTHETIC_RESTRICTED');
  expect(salesStripeReadbackSecret(read,'test')).toBe('rk_test_SYNTHETIC_RESTRICTED');
  expect(read).toHaveBeenCalledExactlyOnceWith('SALES_STRIPE_SECRET_KEY');
 });
});

describe('provider observation activation remains explicit',()=>{
 it.each([undefined,'','false','TRUE','1','true '])('keeps unapproved activation %s off',value=>{
  expect(salesStripeObservationsEnabled(()=>value)).toBe(false);
 });
 it('enables only the exact operator-configured true value',()=>{expect(salesStripeObservationsEnabled(()=> 'true')).toBe(true);});
});
