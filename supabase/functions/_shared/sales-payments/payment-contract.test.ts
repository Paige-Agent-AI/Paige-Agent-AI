import { describe, it, expect } from 'vitest';
import { validatePaymentRequest, bindProviderOperation, validateSettlementAllocation } from './payment-contract.ts';
const request={id:'request-1',tenant_id:'test-tenant-a',invoice_id:'invoice-1',invoice_version:3,issued_snapshot_version:1,client_id:'client-1',commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'deposit' as const,idempotency_key:'request-key'};
const invoice={tenant_id:request.tenant_id,id:request.invoice_id,client_id:request.client_id,lifecycle_version:3,issued_snapshot_version:1,status:'issued',currency:'usd',outstanding_minor:350000};
const merchant={tenant_id:request.tenant_id,provider:'stripe' as const,merchant_id:'acct_testA',environment:'test' as const,version:1};
describe('canonical request binding',()=>{
 it('binds a deposit to canonical invoice without calculating a second ledger',()=>expect(validatePaymentRequest(request,invoice)).toBe(null));
 it.each([{tenant_id:'test-tenant-other'},{id:'invoice-other'},{client_id:'client-other'},{lifecycle_version:4},{status:'draft'},{currency:'eur'},{outstanding_minor:10000}])('refuses changed canonical context %j',patch=>expect(validatePaymentRequest(request,{...invoice,...patch})).not.toBe(null));
 it.each([0,-1,0.1,NaN,Number.MAX_SAFE_INTEGER+1])('rejects invalid minor amount %s',amount=>expect(validatePaymentRequest({...request,amount_minor:amount},invoice)).not.toBe(null));
 it('captures account and environment in each operation and charges no application fee',()=>{
  expect(bindProviderOperation(request,merchant,'op-1','provider-key')).toMatchObject({tenant_id:request.tenant_id,merchant_id:merchant.merchant_id,merchant_version:1,environment:'test',request_id:request.id,provider:'stripe',state:'prepared',application_fee_minor:0});
 });
 it('cannot bind another tenant merchant',()=>expect(()=>bindProviderOperation(request,{...merchant,tenant_id:'other'},'op-1','key')).toThrow('MERCHANT_TENANT_MISMATCH'));
});
describe('settlement/allocation boundaries',()=>{
 const operation={...bindProviderOperation(request,merchant,'op-1','key'),provider_operation_id:'pi_test',state:'provider_accepted' as const};
 const settlement={id:'settlement-1',tenant_id:request.tenant_id,provider:'stripe' as const,merchant_id:merchant.merchant_id,environment:'test' as const,operation_id:operation.id,provider_transaction_id:'ch_test',provider_settlement_id:'txn_test',amount_minor:50000,currency:'usd',state:'verified' as const,readback_reference:'readback-1'};
 const allocation={id:'allocation-1',tenant_id:request.tenant_id,settlement_id:settlement.id,invoice_id:request.invoice_id,amount_minor:50000,currency:'usd'};
 it('permits only verified matching settlement evidence',()=>expect(validateSettlementAllocation(allocation,settlement,operation,request)).toBe(null));
 it.each([{state:'pending'},{state:'outcome_unknown'},{tenant_id:'other'},{merchant_id:'acct_other'},{environment:'live'},{operation_id:'other'},{currency:'eur'},{readback_reference:''},{provider_settlement_id:''},{amount_minor:49999}])('refuses %j',patch=>expect(validateSettlementAllocation(allocation,{...settlement,...patch} as typeof settlement,operation,request)).not.toBe(null));
 it('does not treat Checkout completion or provider acceptance as settlement',()=>expect(validateSettlementAllocation(allocation,{...settlement,state:'pending'},operation,request)).not.toBe(null));
 it('does not overallocate a verified transaction',()=>expect(validateSettlementAllocation({...allocation,amount_minor:50001},settlement,operation,request)).not.toBe(null));
 it('does not strand part of a settlement behind an exactly-once allocation identity',()=>expect(validateSettlementAllocation({...allocation,amount_minor:49999},settlement,operation,request)).not.toBe(null));
 it('requires exact request amount, including a request for a partial invoice balance',()=>expect(validateSettlementAllocation({...allocation,amount_minor:49999},{...settlement,amount_minor:49999},operation,request)).not.toBe(null));
});
