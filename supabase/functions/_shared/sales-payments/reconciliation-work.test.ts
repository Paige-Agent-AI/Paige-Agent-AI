import {describe,it,expect,vi,beforeEach} from 'vitest';
import type {SalesPaymentAdmin} from './database-port.ts';
import type {StripeHostedClient} from './stripe-hosted.ts';
vi.mock('./invoice-payment-adapter.ts',()=>({persistProviderPaymentReadback:vi.fn()}));
vi.mock('./stripe-hosted.ts',()=>({readStripeHostedRequest:vi.fn()}));
import {persistProviderPaymentReadback} from './invoice-payment-adapter.ts';
import {readStripeHostedRequest} from './stripe-hosted.ts';
import {reconcileSalesPaymentWork} from './reconciliation-work.ts';
const id='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const command={action:'invoice.payment_request',invoice_id:id,expected_version:3,provider:'stripe',purpose:'partial',issued_snapshot_version:1,client_id:actor,amount_minor:50000,currency:'usd',merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test'};
const row={id,tenant_id:tenant,actor_user_id:actor,invoice_id:id,client_id:actor,invoice_version:3,issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_A',merchant_binding_version:1,environment:'test',amount_minor:50000,currency:'usd',purpose:'partial',command,idempotency_key:`sales-payment-${id}`,state:'outcome_unknown',provider_object_id:null,dispatch_claim_token:'44444444-4444-4444-8444-444444444444',dispatch_started_at:'2026-10-05T12:00:00Z'};
function fixture(state='outcome_unknown',badMerchant=false,leaseLost=false){
 const rpc=vi.fn(async(name:string)=>({data:name==='claim_sales_payment_reconciliation_work'?{claims:[{work_id:id,tenant_id:tenant,operation_id:id,server_idempotency_key:'work-key',attempt_count:1}]}:name==='read_sales_invoice_payment_dispatch'?{...row,state}:null,error:leaseLost&&name==='heartbeat_sales_payment_reconciliation_work'?{code:'lease_lost'}:null}));
 const query={eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:{stripe_account_id:badMerchant?'acct_other':'acct_A',binding_version:1,provider_environment:'test'},error:null}))};
 return {rpc,admin:{rpc,from:()=>({select:()=>query})} as SalesPaymentAdmin};
}
describe('durable payment recovery',()=>{
 beforeEach(()=>{vi.resetAllMocks();vi.mocked(readStripeHostedRequest).mockResolvedValue({state:'outcome_unknown'} as Awaited<ReturnType<typeof readStripeHostedRequest>>);});
 it('keeps ambiguous provider facts unknown and completes only a checking attempt',async()=>{const f=fixture();expect(await reconcileSalesPaymentWork(f.admin,{} as StripeHostedClient)).toEqual({claimed:1,completed:0,checking:1,unverified:0});expect(f.rpc).toHaveBeenCalledWith('complete_sales_payment_reconciliation_work',expect.objectContaining({_outcome:'unknown'}));expect(readStripeHostedRequest).toHaveBeenCalledTimes(1);expect(persistProviderPaymentReadback).toHaveBeenCalledTimes(1);});
 it('refuses a changed merchant without provider access or completion',async()=>{const f=fixture('outcome_unknown',true);expect((await reconcileSalesPaymentWork(f.admin,{} as StripeHostedClient)).unverified).toBe(1);expect(readStripeHostedRequest).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_payment_reconciliation_work')).toBe(false);});
 it('refuses a lost lease before provider readback',async()=>{const f=fixture('outcome_unknown',false,true);expect((await reconcileSalesPaymentWork(f.admin,{} as StripeHostedClient)).unverified).toBe(1);expect(readStripeHostedRequest).not.toHaveBeenCalled();});
 it('does not claim completion when canonical evidence persistence fails',async()=>{const f=fixture();vi.mocked(persistProviderPaymentReadback).mockRejectedValue(Error('receipt failed'));expect((await reconcileSalesPaymentWork(f.admin,{} as StripeHostedClient)).unverified).toBe(1);expect(f.rpc.mock.calls.some(([n])=>n==='complete_sales_payment_reconciliation_work')).toBe(false);});
 it('replays a terminal canonical state without another provider call',async()=>{const f=fixture('settled');expect((await reconcileSalesPaymentWork(f.admin,{} as StripeHostedClient)).completed).toBe(1);expect(readStripeHostedRequest).not.toHaveBeenCalled();expect(persistProviderPaymentReadback).not.toHaveBeenCalled();});
});
