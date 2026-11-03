import {describe,it,expect,vi,beforeEach} from 'vitest';
import type {SalesPaymentAdmin} from './database-port.ts';
import type {StripeHostedClient,StripeAdjustmentClient} from './stripe-hosted.ts';
vi.mock('./invoice-payment-adapter.ts',()=>({persistProviderPaymentReadback:vi.fn(),persistCapturedPaymentObservation:vi.fn()}));
vi.mock('./stripe-hosted.ts',()=>({readStripeHostedRequest:vi.fn(),readStripePaymentAdjustments:vi.fn()}));
import {persistProviderPaymentReadback,persistCapturedPaymentObservation} from './invoice-payment-adapter.ts';
import {readStripeHostedRequest,readStripePaymentAdjustments} from './stripe-hosted.ts';
import {reconcileSalesPaymentWork} from './reconciliation-work.ts';
const id='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const command={action:'invoice.payment_request',invoice_id:id,expected_version:3,provider:'stripe',purpose:'partial',issued_snapshot_version:1,client_id:actor,amount_minor:50000,currency:'usd',merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test'};
const row={id,tenant_id:tenant,actor_user_id:actor,invoice_id:id,client_id:actor,invoice_version:3,issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test',amount_minor:50000,currency:'usd',purpose:'partial',command,idempotency_key:`sales-payment-${id}`,state:'outcome_unknown',provider_object_id:null,dispatch_claim_token:'44444444-4444-4444-8444-444444444444',dispatch_started_at:'2026-10-05T12:00:00Z'};
const capture={state:'capture_observed' as const,provider_object_id:'cs_test_A',provider_transaction_id:'ch_A',provider_settlement_id:'txn_A',amount_minor:50000,currency:'usd',provider_received_at:'2026-10-05T12:00:00Z'};
const snapshot={state:'observed' as const,provider_transaction_id:'ch_A',provider_settlement_id:'txn_A',refunds:[],disputes:[]};
function fixture(){
 const rpc=vi.fn(async(name:string)=>({data:name==='claim_sales_payment_reconciliation_work'?{claims:[{work_id:id,tenant_id:tenant,operation_id:id,server_idempotency_key:'work-key',attempt_count:1}]}:name==='read_sales_invoice_payment_dispatch'?row:null,error:null as null|{code:string}}));
 const query={eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:{stripe_account_id:'acct_A',binding_version:1,provider_environment:'test'},error:null}))};
 const stripe={environment:'test',createSession:vi.fn(),retrieveSession:vi.fn(),listSessions:vi.fn(),retrieveCharge:vi.fn(),listRefunds:vi.fn(),listDisputes:vi.fn()} satisfies StripeHostedClient&StripeAdjustmentClient;
 return {rpc,stripe,admin:{rpc,from:()=>({select:()=>query})} as SalesPaymentAdmin};
}
const run=(f:ReturnType<typeof fixture>,enabled=true)=>Reflect.apply(reconcileSalesPaymentWork,undefined,[f.admin,f.stripe,3,enabled]);
describe('original payment worker with atomic capture and current adjustment evidence',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.mocked(readStripeHostedRequest).mockResolvedValue(capture);vi.mocked(readStripePaymentAdjustments).mockResolvedValue(snapshot);});
 it('commits both original facts with the current Work lease, without the standalone allocator',async()=>{
  const f=fixture();expect(await run(f)).toEqual({claimed:1,completed:1,checking:0,unverified:0});
  expect(readStripeHostedRequest).toHaveBeenCalledWith(expect.anything(),expect.anything(),f.stripe,null,expect.any(Number),expect.any(Number),{captureObservation:true});
  expect(readStripePaymentAdjustments).toHaveBeenCalledWith(expect.anything(),expect.anything(),capture,f.stripe,expect.any(Number),{captureObservation:true});
  expect(persistCapturedPaymentObservation).toHaveBeenCalledWith(f.admin,expect.anything(),{_expected_tenant_id:tenant,_work_id:id,_server_idempotency_key:'work-key',_attempt_count:1},capture,snapshot);
  expect(persistProviderPaymentReadback).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_payment_reconciliation_work')).toBe(false);
 });
 it('retains unknown rather than allocating a gross capture when adjustment readback is incomplete',async()=>{
  const f=fixture();vi.mocked(readStripePaymentAdjustments).mockResolvedValue({state:'outcome_unknown',code:'PROVIDER_ADJUSTMENT_READBACK_REQUIRED'});
  expect(await run(f)).toEqual({claimed:1,completed:0,checking:1,unverified:0});
  expect(persistCapturedPaymentObservation).not.toHaveBeenCalled();
  expect(persistProviderPaymentReadback).toHaveBeenCalledWith(f.admin,expect.anything(),{state:'outcome_unknown',provider_object_id:'cs_test_A'},expect.any(String));
  expect(f.rpc).toHaveBeenCalledWith('complete_sales_payment_reconciliation_work',expect.objectContaining({_outcome:'unknown'}));
 });
 it('does not retry a commit or fall back to an independent allocation after a lost atomic acknowledgment',async()=>{
  const f=fixture();vi.mocked(persistCapturedPaymentObservation).mockRejectedValue(Error('acknowledgment lost'));
  expect((await run(f)).unverified).toBe(1);expect(persistCapturedPaymentObservation).toHaveBeenCalledTimes(1);expect(persistProviderPaymentReadback).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_payment_reconciliation_work')).toBe(false);
 });
 it('rechecks the native lease after provider reads and refuses a lost attempt before any commit',async()=>{
  const f=fixture();let heartbeats=0;const actual=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async name=>name==='heartbeat_sales_payment_reconciliation_work'&&++heartbeats>1?{data:null,error:{code:'lease_lost'}}:actual(name));
  expect((await run(f)).unverified).toBe(1);expect(persistCapturedPaymentObservation).not.toHaveBeenCalled();expect(persistProviderPaymentReadback).not.toHaveBeenCalled();
 });
 it('preserves ordinary pending recovery without reading non-existent adjustments',async()=>{
  const f=fixture();vi.mocked(readStripeHostedRequest).mockResolvedValue({state:'outcome_unknown'});
  expect((await run(f)).checking).toBe(1);expect(readStripePaymentAdjustments).not.toHaveBeenCalled();expect(persistCapturedPaymentObservation).not.toHaveBeenCalled();
 });
 it('leaves the existing non-opted-in worker behavior unchanged',async()=>{
  const f=fixture();vi.mocked(readStripeHostedRequest).mockResolvedValue({state:'outcome_unknown'});
  expect((await run(f,false)).checking).toBe(1);expect(readStripePaymentAdjustments).not.toHaveBeenCalled();
  expect(vi.mocked(readStripeHostedRequest).mock.calls[0]).toHaveLength(5);
 });
});
