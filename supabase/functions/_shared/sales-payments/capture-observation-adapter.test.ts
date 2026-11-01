import {describe,it,expect,vi} from 'vitest';
import type {SalesPaymentAdmin} from './database-port.ts';
import type {ClaimedPayment} from './request-execution.ts';
vi.mock('./stripe-client.ts',()=>({salesStripeClient:vi.fn(()=>{throw Error('no provider calls at the native persistence boundary');})}));
import {persistCapturedPaymentObservation} from './invoice-payment-adapter.ts';
const operation='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',invoice='33333333-3333-4333-8333-333333333333';
const work='44444444-4444-4444-8444-444444444444',payment='55555555-5555-4555-8555-555555555555',observationId='66666666-6666-4666-8666-666666666666';
const claim:ClaimedPayment={request:{id:operation,tenant_id:tenant,invoice_id:invoice,invoice_version:3,issued_snapshot_version:1,client_id:invoice,commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'partial',idempotency_key:'original-operation'},
 operation:{id:operation,tenant_id:tenant,request_id:operation,provider:'stripe',merchant_id:'acct_original',merchant_version:1,environment:'test',idempotency_key:'original-operation',provider_operation_id:'cs_test_original',state:'outcome_unknown',application_fee_minor:0},claimToken:work,dispatchStartedAt:'2026-10-05T12:00:00Z'};
const lease={_expected_tenant_id:tenant,_work_id:work,_server_idempotency_key:'paige-work:'+work,_attempt_count:1};
const capture={state:'capture_observed' as const,provider_object_id:'cs_test_original',provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',amount_minor:50000,currency:'usd',provider_received_at:'2026-10-05T12:00:00Z'};
const snapshot={state:'observed' as const,provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',refunds:[],disputes:[]};
function fixture(patch:Record<string,unknown>={},error:null|{code:string}=null){
 const receipt={state:'reconciled',effect:'capture_and_provider_observation',operation_id:operation,work_id:work,work_status:'succeeded',allocation_payment_id:payment,replayed:false,
  observation:{state:'observed',effect:'provider_observation_only',provider_operation_id:operation,observation_id:observationId,observation_version:1,rail_recorded:true,source_hash:'a'.repeat(64),snapshot},...patch};
 const rpc=vi.fn(async()=>({data:receipt,error})),admin={rpc,from:()=>{throw Error('no record replacement');}} as SalesPaymentAdmin;
 return {rpc,run:()=>persistCapturedPaymentObservation(admin,claim,lease,capture,snapshot),receipt,admin};
}
describe('atomic original Work acknowledgment boundary',()=>{
 it('sends only the original lease, exact capture facts and complete adjustment snapshot to one native writer',async()=>{
  const f=fixture();await f.run();expect(f.rpc).toHaveBeenCalledExactlyOnceWith('complete_sales_capture_observation_work',{
   ...lease,_capture:{status:'verified',provider:'stripe',merchant_account_id:'acct_original',environment:'test',invoice_id:invoice,client_id:invoice,invoice_version:3,issued_snapshot_version:1,amount_minor:50000,currency:'usd',provider_object_id:'cs_test_original',provider_transaction_id:'ch_original',provider_settlement_id:'txn_original',provider_received_at:capture.provider_received_at,readback_reference:'initial-work-'+work},_snapshot:snapshot});
 });
 it('accepts native JSON object ordering without changing the original snapshot',async()=>{
  const f=fixture();f.receipt.observation.snapshot={disputes:[],refunds:[],provider_settlement_id:'txn_original',provider_transaction_id:'ch_original',state:'observed'};
  await expect(f.run()).resolves.toBeUndefined();
 });
 it('retains a real replay acknowledgment without another RPC or provider effect',async()=>{
  const f=fixture({replayed:true});await f.run();expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it.each([{state:'settled'},{work_id:invoice},{operation_id:invoice},{work_status:'claimed'},{allocation_payment_id:'invented'},{replayed:'true'}])('refuses missing or unrelated native acknowledgment %j',async patch=>{
  const f=fixture(patch);await expect(f.run()).rejects.toThrow('PAYMENT_OBSERVATION_READBACK_UNAVAILABLE');expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it.each([{rail_recorded:false},{observation_version:0},{source_hash:'invalid'},{snapshot:{...snapshot,provider_transaction_id:'ch_other'}},{snapshot:{...snapshot,refunds:[{amount_minor:1}]}}])('refuses incomplete or altered observation receipt %j',async patch=>{
  const f=fixture();Object.assign(f.receipt.observation,patch);await expect(f.run()).rejects.toThrow('PAYMENT_OBSERVATION_READBACK_UNAVAILABLE');
 });
 it('treats an unavailable acknowledgment as unknown without retrying the write',async()=>{
  const f=fixture({}, {code:'unavailable'});await expect(f.run()).rejects.toThrow('PAYMENT_OBSERVATION_READBACK_UNAVAILABLE');expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('refuses a changed tenant or charge before native persistence',async()=>{
  const f=fixture();await expect(persistCapturedPaymentObservation(f.admin,claim,{...lease,_expected_tenant_id:invoice},capture,snapshot)).rejects.toThrow('PAYMENT_OBSERVATION_SCOPE_CHANGED');
  await expect(persistCapturedPaymentObservation(f.admin,claim,lease,capture,{...snapshot,provider_transaction_id:'ch_other'})).rejects.toThrow('PAYMENT_OBSERVATION_SCOPE_CHANGED');expect(f.rpc).not.toHaveBeenCalled();
 });
});
