import {describe,it,expect} from 'vitest';
import {verifiedSettlementInput,observedCaptureInput} from './settlement-readback.ts';
import type {ClaimedPayment} from './request-execution.ts';
const claim:ClaimedPayment={request:{id:'operation-a',tenant_id:'tenant-a',invoice_id:'invoice-a',invoice_version:3,issued_snapshot_version:1,client_id:'client-a',commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'partial',idempotency_key:'operation-key'},operation:{id:'operation-a',tenant_id:'tenant-a',request_id:'operation-a',provider:'stripe',merchant_id:'acct_A',merchant_version:1,environment:'test',idempotency_key:'operation-key',provider_operation_id:'cs_test_A',state:'provider_accepted',application_fee_minor:0},claimToken:'claim',dispatchStartedAt:'2026-10-05T12:00:00Z'};
const result={state:'settled' as const,provider_object_id:'cs_test_A',provider_transaction_id:'ch_A',provider_settlement_id:'txn_A',amount_minor:50000,currency:'usd',provider_received_at:'2026-10-05T12:00:00Z'};
describe('verified settlement boundary',()=>{
 it('binds fresh settlement to the immutable canonical operation',()=>expect(verifiedSettlementInput(claim,result,'evt_A')).toEqual({status:'verified',provider:'stripe',merchant_account_id:'acct_A',environment:'test',invoice_id:'invoice-a',client_id:'client-a',invoice_version:3,issued_snapshot_version:1,amount_minor:50000,currency:'usd',provider_object_id:'cs_test_A',provider_transaction_id:'ch_A',provider_settlement_id:'txn_A',provider_received_at:'2026-10-05T12:00:00Z',readback_reference:'evt_A'}));
 it.each([{state:'provider_accepted'},{state:'outcome_unknown'},{amount_minor:49999},{currency:'eur'},{provider_object_id:'cs_test_B'},{provider_transaction_id:undefined},{provider_settlement_id:undefined},{provider_received_at:'invalid'}])('refuses unverified or conflicting readback %j',patch=>expect(()=>verifiedSettlementInput(claim,{...result,...patch} as typeof result,'evt_A')).toThrow('VERIFIED_SETTLEMENT_REQUIRED'));
 it('refuses unsafe readback references rather than storing provider bodies',()=>expect(()=>verifiedSettlementInput(claim,result,'{secret:response}')).toThrow());
});

describe('captured-only facts for atomic initial observation',()=>{
 const captured={...result,state:'capture_observed' as const};
 it('constructs the same immutable historical capture fields without claiming current net settlement',()=>{
  expect(observedCaptureInput(claim,captured,'initial-work-source')).toEqual(verifiedSettlementInput(claim,result,'initial-work-source'));
  expect(()=>verifiedSettlementInput(claim,Reflect.apply(Object.assign,undefined,[{},captured]),'initial-work-source')).toThrow('VERIFIED_SETTLEMENT_REQUIRED');
 });
 it.each([{amount_minor:49999},{currency:'eur'},{provider_object_id:'cs_test_B'},{provider_received_at:'invalid'}])('refuses conflicting capture facts %j',patch=>{
  expect(()=>observedCaptureInput(claim,{...captured,...patch},'initial-work-source')).toThrow('VERIFIED_SETTLEMENT_REQUIRED');
 });
});
