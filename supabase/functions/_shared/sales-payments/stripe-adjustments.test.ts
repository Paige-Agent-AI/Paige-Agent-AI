import {describe,it,expect,vi} from 'vitest';
import {readStripePaymentAdjustments,type StripeAdjustmentClient} from './stripe-hosted.ts';
import type {PaymentRequest,ProviderOperation,VerifiedSettlement} from './payment-contract.ts';

const request:PaymentRequest={id:'request',tenant_id:'test-tenant-provider',invoice_id:'invoice',invoice_version:2,issued_snapshot_version:1,client_id:'client',commercial_package_id:null,amount_minor:80000,currency:'usd',purpose:'partial',idempotency_key:'payment-request'};
const operation:ProviderOperation={id:'operation',tenant_id:request.tenant_id,request_id:request.id,provider:'stripe',merchant_id:'acct_original',merchant_version:1,environment:'test',idempotency_key:request.idempotency_key,provider_operation_id:'cs_test_original',state:'settled',application_fee_minor:0};
const settlement:VerifiedSettlement={id:'original-settlement',tenant_id:request.tenant_id,operation_id:operation.id,provider:'stripe',merchant_id:operation.merchant_id,environment:'test',provider_transaction_id:'ch_original',provider_settlement_id:'txn_capture',amount_minor:request.amount_minor,currency:'usd',state:'verified',readback_reference:'original-provider-read'};
const metadata={paige_operation_id:operation.id,paige_request_id:request.id,tenant_id:request.tenant_id,invoice_id:request.invoice_id,client_id:request.client_id};
const balance=(id:string,source:string,amount:number,type='refund')=>({id,source,amount,type,currency:'usd',status:'available',created:1760000000});
const capture=()=>({id:'ch_original',object:'charge',livemode:false,status:'succeeded',paid:true,captured:true,amount:80000,amount_captured:80000,amount_refunded:10000,currency:'usd',refunded:false,disputed:false,created:1760000000,application_fee_amount:null,transfer:null,transfer_data:null,
  payment_intent:{id:'pi_original',livemode:false,status:'succeeded',amount:80000,amount_received:80000,currency:'usd',metadata},balance_transaction:balance('txn_capture','ch_original',80000,'charge')});
const refund=(patch:Record<string,unknown>={})=>({id:'re_original',object:'refund',charge:'ch_original',payment_intent:'pi_original',amount:10000,currency:'usd',created:1760000001,status:'succeeded',balance_transaction:balance('txn_refund','re_original',-10000),failure_balance_transaction:null,source_transfer_reversal:null,transfer_reversal:null,...patch});
function ports(charge:unknown=capture(),refunds:unknown[]=[refund()],disputes:unknown[]=[]){
 const client={environment:'test',retrieveCharge:vi.fn(async()=>charge),listRefunds:vi.fn(async()=>({object:'list',data:refunds,has_more:false})),listDisputes:vi.fn(async()=>({object:'list',data:disputes,has_more:false}))} satisfies StripeAdjustmentClient;
 return client;
}
const read=(client:StripeAdjustmentClient,op=operation,original=settlement)=>readStripePaymentAdjustments(request,op,original,client);
describe('source-bound post-settlement Stripe observations, without a financial writer',()=>{
 it('reads the exact original merchant and charge and retains refund facts without changing original settlement',async()=>{
  const client=ports(),before=JSON.stringify({request,operation,settlement});const result=await read(client);
  expect(result).toMatchObject({state:'observed',provider_transaction_id:'ch_original',provider_settlement_id:'txn_capture',refunds:[{id:'re_original',amount_minor:10000,currency:'usd',status:'succeeded',balance_transaction:{id:'txn_refund',amount_minor:-10000}}],disputes:[]});
  expect(client.retrieveCharge).toHaveBeenCalledWith('ch_original',{expand:['payment_intent','balance_transaction']},{stripeAccount:'acct_original'});
  expect(client.listRefunds).toHaveBeenCalledWith(expect.objectContaining({charge:'ch_original',limit:100}),{stripeAccount:'acct_original'});
  expect(client.listDisputes).toHaveBeenCalledWith(expect.objectContaining({charge:'ch_original',limit:100}),{stripeAccount:'acct_original'});
  expect(JSON.stringify({request,operation,settlement})).toBe(before);
  expect(result).not.toHaveProperty('remaining_cents');expect(result).not.toHaveProperty('invoice_status');
 });
 it.each([{merchant_id:'acct_other'},{environment:'live'},{provider:'paypal'},{operation_id:'other'},{provider_transaction_id:'ch_other'},{provider_settlement_id:'txn_other'},{amount_minor:79999},{currency:'eur'},{state:'pending'}])('refuses changed original settlement %j before trusting provider facts',async patch=>{
  expect(await read(ports(),operation,{...settlement,...patch} as VerifiedSettlement)).toMatchObject({state:'outcome_unknown'});
 });
 it.each([{state:'prepared'},{state:'dispatching'},{state:'failed'},{merchant_id:'acct_other'},{environment:'live'}])('does not admit an unverified or differently bound operation %j',async patch=>{
  const client=ports();expect(await read(client,{...operation,...patch} as ProviderOperation)).toMatchObject({state:'outcome_unknown'});expect(client.listRefunds).not.toHaveBeenCalled();
 });
 it.each([{livemode:true},{id:'ch_other'},{amount:79999},{currency:'eur'},{paid:false},{captured:false},{application_fee_amount:10},{transfer:'tr_other'},
  {payment_intent:{...capture().payment_intent,metadata:{...metadata,invoice_id:'other'}}},
  {balance_transaction:balance('txn_other','ch_original',80000,'charge')}])('holds mismatched fresh capture %j',async patch=>{
  const client=ports({...capture(),...patch});expect(await read(client)).toMatchObject({state:'outcome_unknown'});expect(client.listRefunds).not.toHaveBeenCalled();
 });
 it.each([{charge:'ch_other'},{payment_intent:'pi_other'},{currency:'eur'},{amount:80001},{status:'invented'},
  {balance_transaction:balance('txn_refund','re_other',-10000)},{balance_transaction:balance('txn_refund','re_original',10000)},
  {failure_balance_transaction:balance('txn_failure','re_original',10000,'refund_failure')}])('never treats malformed refund evidence as a completed repayment %j',async patch=>{
  expect(await read(ports(capture(),[refund(patch)]))).toMatchObject({state:'outcome_unknown'});
 });
 it.each(['pending','requires_action','failed','canceled'])('retains %s without describing it as successful refund',async status=>{
  const charge={...capture(),amount_refunded:['failed','canceled'].includes(status)?0:10000};
  const result=await read(ports(charge,[refund({status,balance_transaction:null})]));expect(result).toMatchObject({state:'observed',refunds:[{status,balance_transaction:null}]});
 });
 it('requires complete pagination instead of trusting the Charge object default ten refunds',async()=>{
  const client=ports({...capture(),amount_refunded:101}),first=Array.from({length:100},(_,i)=>refund({id:`re_page${i}`,amount:1,balance_transaction:balance(`txn_page${i}`,`re_page${i}`,-1)}));
  client.listRefunds.mockResolvedValueOnce({object:'list',data:first,has_more:true}).mockResolvedValueOnce({object:'list',data:[refund({id:'re_tail',amount:1,balance_transaction:balance('txn_tail','re_tail',-1)})],has_more:false});
  const result=await read(client);expect(result.state).toBe('observed');if(result.state==='observed')expect(result.refunds).toHaveLength(101);
  expect(client.listRefunds).toHaveBeenLastCalledWith(expect.objectContaining({starting_after:'re_page99',charge:'ch_original'}),{stripeAccount:'acct_original'});
 });
 it('holds duplicate provider objects instead of counting them twice',async()=>expect(await read(ports(capture(),[refund(),refund()]))).toMatchObject({state:'outcome_unknown'}));
 it('holds truncated or nonadvancing pages and provider failures',async()=>{
  const client=ports();client.listRefunds.mockResolvedValue({object:'list',data:[refund()],has_more:true});expect(await read(client)).toMatchObject({state:'outcome_unknown'});
  const broken=ports();broken.retrieveCharge.mockRejectedValue(Error('private provider detail'));expect(await read(broken)).toEqual({state:'outcome_unknown',code:'PROVIDER_ADJUSTMENT_READBACK_REQUIRED'});
 });
 it('retains actual dispute debit and reinstatement separately from a won status',async()=>{
  const dispute={id:'du_original',object:'dispute',charge:'ch_original',payment_intent:'pi_original',livemode:false,amount:20000,currency:'usd',created:1760000001,status:'won',balance_transactions:[balance('txn_debit','du_original',-20000,'adjustment'),balance('txn_credit','du_original',20000,'adjustment')]};
  const result=await read(ports({...capture(),disputed:true},[refund()],[dispute]));expect(result).toMatchObject({state:'observed',disputes:[{id:'du_original',status:'won',balance_transactions:[{id:'txn_debit',amount_minor:-20000},{id:'txn_credit',amount_minor:20000}]}]});
  const noCredit=await read(ports({...capture(),disputed:true},[refund()],[{...dispute,balance_transactions:[dispute.balance_transactions[0]]}]));expect(noCredit).toMatchObject({state:'observed',disputes:[{status:'won',balance_transactions:[{amount_minor:-20000}]}]});expect(noCredit).not.toHaveProperty('reinstated');
 });
 it('retains a failed refund debit and its actual compensating credit without reporting a successful refund',async()=>{
  const result=await read(ports({...capture(),amount_refunded:0},[refund({status:'failed',failure_balance_transaction:balance('txn_failure','re_original',10000,'refund_failure')})]));
  expect(result).toMatchObject({state:'observed',refunds:[{status:'failed',balance_transaction:{amount_minor:-10000},failure_balance_transaction:{amount_minor:10000}}]});
 });
 it('retains original provider chronology while excluding private provider content',async()=>{
  const result=await read(ports(capture(),[refund({metadata:{private_note:'private-client-note'},receipt_number:'private-receipt-number'})]));
  expect(result).toMatchObject({state:'observed',refunds:[{created_at:new Date(1760000001*1000).toISOString(),balance_transaction:{created_at:new Date(1760000000*1000).toISOString()}}]});
  expect(JSON.stringify(result)).not.toContain('private-client-note');expect(JSON.stringify(result)).not.toContain('private-receipt-number');
  if(result.state==='observed')expect(Object.keys(result.refunds[0]).sort()).toEqual(['amount_minor','balance_transaction','created_at','currency','failure_balance_transaction','id','status']);
 });
 it('holds an inconsistent provider aggregate instead of guessing which refunds count',async()=>{
  expect(await read(ports({...capture(),amount_refunded:9999}))).toMatchObject({state:'outcome_unknown'});
  expect(await read(ports(capture(),[]))).toMatchObject({state:'outcome_unknown'});
 });
 it('holds a changed provider observation across its bounded multi-page read',async()=>{
  const client=ports();client.retrieveCharge.mockResolvedValueOnce(capture()).mockResolvedValueOnce({...capture(),amount_refunded:20000});
  expect(await read(client)).toMatchObject({state:'outcome_unknown'});
 });
 it('rechecks original invoice metadata on the final source fence',async()=>{
  const client=ports();client.retrieveCharge.mockResolvedValueOnce(capture()).mockResolvedValueOnce({...capture(),payment_intent:{...capture().payment_intent,metadata:{...metadata,invoice_id:'changed-original'}}});
  expect(await read(client)).toMatchObject({state:'outcome_unknown'});
 });
 it('does not invoke any provider port after its read deadline',async()=>{
  const client=ports();expect(await readStripePaymentAdjustments(request,operation,settlement,client,Date.now()-1)).toMatchObject({state:'outcome_unknown'});expect(client.retrieveCharge).not.toHaveBeenCalled();
 });
 it.each([{charge:'ch_other'},{payment_intent:'pi_other'},{livemode:true},{currency:'eur'},{amount:80001},{status:'invented'},
  {balance_transactions:[balance('txn_wrong','du_other',-20000,'adjustment')]},
  {balance_transactions:[balance('txn_same','du_original',-20000,'adjustment'),balance('txn_same','du_original',20000,'adjustment')]}])('refuses mismatched dispute facts %j',async patch=>{
  const dispute={id:'du_original',object:'dispute',charge:'ch_original',payment_intent:'pi_original',livemode:false,amount:20000,currency:'usd',created:1760000001,status:'under_review',balance_transactions:[balance('txn_debit','du_original',-20000,'adjustment')],...patch};
  expect(await read(ports({...capture(),disputed:true},[refund()],[dispute]))).toMatchObject({state:'outcome_unknown'});
 });
});
