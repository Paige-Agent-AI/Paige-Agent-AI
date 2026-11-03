import {beforeEach,describe,it,expect,vi} from 'vitest';
import {verifySalesStripeIngress,routeSalesStripeIngress} from './stripe-ingress.ts';
const ports=vi.hoisted(()=>({verify:vi.fn(),route:vi.fn(),adjust:vi.fn()}));
vi.mock('../stripe-webhook-signature.ts',()=>({verifyStripeWebhook:ports.verify}));
vi.mock('./stripe-event-adapter.ts',()=>({routeVerifiedSalesStripeEvent:ports.route,registerVerifiedSalesStripeAdjustmentEvent:ports.adjust}));
const other={handled:false,status:200,code:'OTHER_DOMAIN'};
beforeEach(()=>{ports.verify.mockReset();ports.route.mockReset();ports.adjust.mockReset();ports.route.mockResolvedValue(other);ports.adjust.mockResolvedValue(other);});
describe('original canonical Stripe signature boundary',()=>{
 it('keeps existing primary/V2 precedence and makes no extra verification after success',async()=>{
  const event={id:'evt_platform'};ports.verify.mockResolvedValueOnce({event,account:'v2'});
  expect(await verifySalesStripeIngress('body','signature',{}, {},'primary','v2','sales',{})).toEqual({event,account:'v2'});
  expect(ports.verify).toHaveBeenCalledTimes(1);
 });
 it('uses the SAME verifier for an explicitly configured Sales-only secret after original verification refuses',async()=>{
  const event={id:'evt_sales'};ports.verify.mockResolvedValueOnce(null).mockResolvedValueOnce({event,account:'legacy'});
  expect(await verifySalesStripeIngress('body','signature',{}, {},'primary','v2','sales',{})).toEqual({event,account:'sales'});
  expect(ports.verify.mock.calls[1][4]).toBe('sales');expect(ports.verify.mock.calls[1][5]).toBe('');
 });
 it('does not introduce a fallback when the separate Sales signing secret is absent',async()=>{
  ports.verify.mockResolvedValue(null);expect(await verifySalesStripeIngress('body','signature',{}, {},'primary','v2','',{})).toBeNull();
  expect(ports.verify).toHaveBeenCalledTimes(1);
 });
 it('refuses when both original and configured Sales signature checks fail',async()=>{
  ports.verify.mockResolvedValue(null);expect(await verifySalesStripeIngress('body','signature',{}, {},'primary','v2','sales',{})).toBeNull();
 });
});
describe('existing Sales adjustment and payment routes',()=>{
 const event={id:'evt_refund',account:'acct_fixture',livemode:false,type:'charge.refunded'};
 const admin={} as never;
 it('selects read-only recovery by the verified event environment instead of the TEST dispatch default',async()=>{
  const live={...event,livemode:true},select=vi.fn(()=> 'synthetic-original-live');
  await routeSalesStripeIngress(admin,live,'legacy','synthetic-test',false,select);
  expect(select).toHaveBeenCalledExactlyOnceWith('live');expect(ports.route).toHaveBeenCalledWith(admin,live,'legacy','synthetic-original-live');
 });
 it('does not select a recovery credential from a malformed event mode',async()=>{
  const malformed={...event,livemode:'true'},select=vi.fn();
  await routeSalesStripeIngress(admin,malformed,'legacy','synthetic-test',false,select);
  expect(select).not.toHaveBeenCalled();expect(ports.route).toHaveBeenCalledWith(admin,malformed,'legacy','synthetic-test');
 });
 it('leaves the deployed route unchanged while observation activation is disabled',async()=>{
  expect(await routeSalesStripeIngress(admin,event,'legacy','synthetic',false)).toEqual(other);
  expect(ports.adjust).not.toHaveBeenCalled();expect(ports.route).toHaveBeenCalledWith(admin,event,'legacy','synthetic');
 });
 it('retains native adjustment registration before generic payment routing without a provider write',async()=>{
  const receipt={handled:true,status:200,code:'PROVIDER_OBSERVATION_REGISTERED'};ports.adjust.mockResolvedValueOnce(receipt);
  expect(await routeSalesStripeIngress(admin,event,'legacy','synthetic',true)).toEqual(receipt);
  expect(ports.adjust).toHaveBeenCalledWith(admin,event,'legacy','test');expect(ports.route).not.toHaveBeenCalled();
 });
 it('propagates verification-pending refusal instead of acknowledging an unrecorded adjustment',async()=>{
  const pending={handled:true,status:503,code:'PROVIDER_OBSERVATION_READBACK_REQUIRED'};ports.adjust.mockResolvedValueOnce(pending);
  expect(await routeSalesStripeIngress(admin,event,'legacy','synthetic',true)).toEqual(pending);
  expect(ports.route).not.toHaveBeenCalled();
 });
 it('derives only the signed event environment for native signal admission, never a financial amount',async()=>{
  ports.adjust.mockResolvedValueOnce({handled:true,status:200,code:'PROVIDER_OBSERVATION_REGISTERED'});
  await routeSalesStripeIngress(admin,{...event,livemode:true},'legacy','synthetic',true);
  expect(ports.adjust.mock.calls[0][3]).toBe('live');
 });
 it.each([{...event,account:undefined},{...event,livemode:'false'}])('preserves non-Connect or malformed platform routing without registering work',async value=>{
  expect(await routeSalesStripeIngress(admin,value,'legacy','synthetic',true)).toEqual(other);
  expect(ports.adjust).not.toHaveBeenCalled();
 });
 it('does not admit another platform namespace into the original merchant writer',async()=>{
  await routeSalesStripeIngress(admin,event,'v2','synthetic',true);expect(ports.adjust).not.toHaveBeenCalled();
  expect(ports.route).toHaveBeenCalledWith(admin,event,'v2','synthetic');
 });
 it('retains original payment routing when native lookup identifies another domain',async()=>{
  expect(await routeSalesStripeIngress(admin,event,'legacy','synthetic',true)).toEqual(other);
  expect(ports.adjust).toHaveBeenCalledTimes(1);expect(ports.route).toHaveBeenCalledTimes(1);
 });
});
