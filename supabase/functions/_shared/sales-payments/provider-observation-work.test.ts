import {beforeEach,expect,it,vi} from 'vitest';
import type {SalesPaymentAdmin} from './database-port.ts';
import type {StripeAdjustmentClient} from './stripe-hosted.ts';
const h=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('./stripe-hosted.ts',()=>({readStripePaymentAdjustments:h.read}));
import {reconcileSalesProviderObservationWork} from './provider-observation-work.ts';
const op='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const work='44444444-4444-4444-8444-444444444444',payment='55555555-5555-4555-8555-555555555555',observation='66666666-6666-4666-8666-666666666666';
const c={work_id:work,tenant_id:tenant,operation_id:op,event_id:'evt_adjustment',server_idempotency_key:`paige-work:${work}`,attempt_count:1};
const command={action:'invoice.payment_request',invoice_id:op,expected_version:3,provider:'stripe',purpose:'partial',issued_snapshot_version:1,
 client_id:actor,amount_minor:50000,currency:'usd',merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test'};
const capture={status:'verified',provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',amount_minor:50000,currency:'usd',readback_reference:'original_capture'};
const dispatch={id:op,tenant_id:tenant,actor_user_id:actor,invoice_id:op,client_id:actor,invoice_version:3,issued_snapshot_version:1,provider:'stripe',
 merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test',amount_minor:50000,currency:'usd',purpose:'partial',command,
 idempotency_key:`sales-payment-${op}`,state:'settled',provider_object_id:'cs_test_original',dispatch_claim_token:work,dispatch_started_at:'2026-10-05T12:00:00Z',
 provider_observation_version:0,provider_observation_operation_id:null,allocation_payment_id:payment,verified_readback:capture};
const context={work_id:work,event_id:c.event_id,dispatch,observation_version:0,observation_id:null,
 settlement:{id:payment,tenant_id:tenant,operation_id:op,provider:'stripe',merchant_id:'acct_A',environment:'test',state:'verified',
  amount_minor:50000,currency:'usd',provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',readback_reference:'original_capture'}};
const snapshot={state:'observed',provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',refunds:[],disputes:[]};
const complete={work_id:work,work_status:'succeeded',effect:'provider_observation_only',replayed:false,
 receipt:{verified_readback:true,effect:'provider_observation_only',provider_operation_id:op,observation_id:observation,observation_version:1,
  requested_observation_version:0,source_hash:'a'.repeat(64)}};
const stripe={environment:'test'} as StripeAdjustmentClient;
function fixture(claims:unknown[]=[c]){
 let reads=0;
 const config={before:structuredClone(context),after:structuredClone(context),completion:structuredClone(complete) as unknown,errorOnComplete:false,contextError:false};
 const rpc=vi.fn(async(name:string,_args:Record<string,unknown>)=>{
  if(name==='claim_sales_provider_observation_work')return{data:{claims},error:null};
  if(name==='read_sales_provider_observation_work_context')return{data:reads++===0?config.before:config.after,error:config.contextError?{code:'42501'}:null};
  if(name==='complete_sales_provider_observation_work'){
   if(config.errorOnComplete)throw Error('transport_ack_unknown');return{data:config.completion,error:null};
  }
  throw Error('Unexpected native call');
 });
 return{rpc,config,admin:{rpc,from:()=>{throw Error('No parallel reader');}} as SalesPaymentAdmin};
}
beforeEach(()=>{vi.clearAllMocks();h.read.mockResolvedValue(snapshot);});
it('observes current GET-only facts and retains the pre-read source version through canonical C4 completion',async()=>{
 const f=fixture();expect(await reconcileSalesProviderObservationWork(f.admin,stripe)).toEqual({claimed:1,observed:1,verificationPending:0,unverified:0});
 expect(h.read).toHaveBeenCalledWith(expect.objectContaining({id:op,tenant_id:tenant}),expect.objectContaining({state:'settled'}),context.settlement,stripe,expect.any(Number));
 expect(f.rpc).toHaveBeenLastCalledWith('complete_sales_provider_observation_work',expect.objectContaining({_work_id:work,_attempt_count:1,_expected_observation_version:0,_snapshot:snapshot}));
 expect(f.rpc.mock.calls.filter(([n])=>n==='read_sales_provider_observation_work_context')).toHaveLength(2);
});
it('keeps unknown provider evidence pending without manufacturing a source version',async()=>{
 const f=fixture();h.read.mockResolvedValue({state:'outcome_unknown',code:'PROVIDER_ADJUSTMENT_READBACK_REQUIRED'});
 f.config.completion={work_id:work,work_status:'blocked',blocked_reason:'provider_observation_unknown',replayed:false};
 expect(await reconcileSalesProviderObservationWork(f.admin,stripe)).toEqual({claimed:1,observed:0,verificationPending:1,unverified:0});
 expect(f.rpc).toHaveBeenLastCalledWith('complete_sales_provider_observation_work',expect.objectContaining({_expected_observation_version:null,_snapshot:null}));
});
it('records exhausted uncertainty as pending rather than financial success',async()=>{
 const f=fixture([{...c,attempt_count:25}]);h.read.mockResolvedValue({state:'outcome_unknown'});
 f.config.completion={work_id:work,work_status:'blocked',blocked_reason:'provider_observation_exhausted',replayed:false};
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).verificationPending).toBe(1);
});
it('does not retry completion after a lost acknowledgement',async()=>{
 const f=fixture();f.config.errorOnComplete=true;
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).unverified).toBe(1);
 expect(f.rpc.mock.calls.filter(([n])=>n==='complete_sales_provider_observation_work')).toHaveLength(1);expect(h.read).toHaveBeenCalledTimes(1);
});
it('refuses a source incarnation changed while the provider read was pending',async()=>{
 const f=fixture();f.config.after.observation_version=1;f.config.after.dispatch.provider_observation_version=1;
 Object.assign(f.config.after,{observation_id:observation});Object.assign(f.config.after.dispatch,{provider_observation_operation_id:observation});
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).unverified).toBe(1);
 expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_provider_observation_work')).toBe(false);
});
it('refuses changed original merchant scope after the provider read',async()=>{
 const f=fixture();f.config.after.dispatch.merchant_binding_version=2;
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).unverified).toBe(1);
 expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_provider_observation_work')).toBe(false);
});
it.each(['provider_transaction_id','provider_settlement_id','readback_reference'] as const)('refuses a settlement %s substituted away from the original capture',async key=>{
 const f=fixture();f.config.before.settlement[key]='different_source';
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).unverified).toBe(1);expect(h.read).not.toHaveBeenCalled();
});
it('requires current native lease authority before making a provider read',async()=>{
 const f=fixture();f.config.contextError=true;
 expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).unverified).toBe(1);expect(h.read).not.toHaveBeenCalled();
});
it.each([0,4,1.5,NaN])('refuses invalid batch size %s before native or provider access',async limit=>{
 const f=fixture();await expect(reconcileSalesProviderObservationWork(f.admin,stripe,limit)).rejects.toThrow('BATCH_INVALID');expect(f.rpc).not.toHaveBeenCalled();
});
it('refuses duplicate work identities before dispatching either copy',async()=>{
 const f=fixture([c,c]);await expect(reconcileSalesProviderObservationWork(f.admin,stripe)).rejects.toThrow('WORK_UNAVAILABLE');expect(h.read).not.toHaveBeenCalled();
});
it.each([{...c,attempt_count:26},{...c,event_id:'not-an-event'},{...c,tenant_id:'not-a-tenant'}])('refuses malformed native claim %#',async invalid=>{
 const f=fixture([invalid]);await expect(reconcileSalesProviderObservationWork(f.admin,stripe)).rejects.toThrow('WORK_UNAVAILABLE');expect(h.read).not.toHaveBeenCalled();
});
it.each([{...complete,effect:'payment_complete'},{...complete,work_id:op},{...complete,receipt:{...complete.receipt,verified_readback:false}},
 {...complete,receipt:{...complete.receipt,provider_operation_id:actor}},{...complete,receipt:{...complete.receipt,requested_observation_version:1}}])('requires the exact native observation receipt %#',async completion=>{
 const f=fixture();f.config.completion=completion;const result=await reconcileSalesProviderObservationWork(f.admin,stripe);
 expect(result.observed).toBe(0);expect(result.unverified).toBe(1);expect(result).not.toHaveProperty('paid');
});
it('accepts a retained native receipt on a same-work replay',async()=>{
 const f=fixture();f.config.completion={...complete,replayed:true};expect((await reconcileSalesProviderObservationWork(f.admin,stripe)).observed).toBe(1);
});
