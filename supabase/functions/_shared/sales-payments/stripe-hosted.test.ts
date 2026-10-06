import {describe,it,expect,vi} from 'vitest';
import {createStripeHostedRequest,readStripeHostedRequest} from './stripe-hosted.ts';
import {bindProviderOperation} from './payment-contract.ts';
const request={id:'request-a',tenant_id:'test-tenant-a',invoice_id:'invoice-a',invoice_version:3,issued_snapshot_version:1,client_id:'client-a',commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'deposit' as const,idempotency_key:'request-key'};
const merchant={tenant_id:request.tenant_id,provider:'stripe' as const,merchant_id:'acct_testA',environment:'test' as const,version:1};
const op=bindProviderOperation(request,merchant,'op-a','stable-provider-key');
const meta={paige_operation_id:op.id,paige_request_id:request.id,tenant_id:request.tenant_id,invoice_id:request.invoice_id,client_id:request.client_id};
const session=()=>({id:'cs_test_a',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',amount_total:50000,currency:'usd',client_reference_id:op.id,metadata:meta,url:'https://checkout.stripe.com/c/pay/cs_test_a',payment_intent:null,expires_at:Math.floor(Date.now()/1000)+3600});
const settled=()=>({...session(),status:'complete',payment_status:'paid',payment_intent:{id:'pi_a',livemode:false,status:'succeeded',amount:50000,amount_received:50000,currency:'usd',metadata:meta,latest_charge:{id:'ch_a',created:1760000000,livemode:false,status:'succeeded',paid:true,captured:true,amount:50000,amount_captured:50000,amount_refunded:0,currency:'usd',refunded:false,disputed:false,application_fee_amount:null,transfer:null,transfer_data:null,payment_intent:'pi_a',balance_transaction:{id:'txn_a',source:'ch_a',amount:50000,currency:'usd',status:'available',type:'charge'}}}});
function client(value:unknown=session()) {return {environment:'test' as const,createSession:vi.fn().mockResolvedValue(value),retrieveSession:vi.fn().mockResolvedValue(value),listSessions:vi.fn().mockResolvedValue({data:[value],has_more:false})};}
const origin='https://paigeagent.ai';
describe('tenant direct hosted request adapter',()=>{
 it('uses exact tenant account, immutable idempotency and inline canonical minor amount with no fee/transfer',async()=>{
  const sdk=client();const result=await createStripeHostedRequest(request,op,sdk,origin);
  expect(result).toMatchObject({state:'customer_action_required',provider_object_id:'cs_test_a',hosted_url:session().url});
  const [params,options]=sdk.createSession.mock.calls[0];
  expect(options).toEqual({stripeAccount:merchant.merchant_id,idempotencyKey:op.idempotency_key});
  expect(params).toMatchObject({mode:'payment',client_reference_id:op.id,metadata:meta,line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:50000}}],payment_intent_data:{metadata:meta}});
  expect(JSON.stringify(params)).not.toMatch(/application_fee|transfer_data|destination|"price"\s*:|customer_email|card_number|cvv/i);
 });
 it('preserves provider expiry for the hosted request',async()=>expect(await createStripeHostedRequest(request,op,client(),origin)).toHaveProperty('expires_at',expect.any(String)));
 it('does not expose an expired or expiry-less hosted request',async()=>{for(const expires_at of [undefined,0,Math.floor(Date.now()/1000)-1])expect(await createStripeHostedRequest(request,op,client({...session(),expires_at}),origin)).toMatchObject({state:'outcome_unknown'});});
 it('refuses foreign tenant before SDK dispatch',async()=>{const sdk=client();await expect(createStripeHostedRequest(request,{...op,tenant_id:'test-tenant-b'},sdk,origin)).rejects.toThrow('PAYMENT_OPERATION_SCOPE_MISMATCH');expect(sdk.createSession).not.toHaveBeenCalled();});
 it('refuses environment mismatch before dispatch',async()=>{const sdk={...client(),environment:'live' as const};await expect(createStripeHostedRequest(request,op,sdk,origin)).rejects.toThrow('MERCHANT_ENVIRONMENT_MISMATCH');expect(sdk.createSession).not.toHaveBeenCalled();});
 it('timeout never becomes failure or success and exposes no raw error',async()=>{const sdk=client();sdk.createSession.mockRejectedValue(new Error('secret provider body'));expect(await createStripeHostedRequest(request,op,sdk,origin)).toEqual({state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});});
 it.each([{type:'StripeAuthenticationError',statusCode:401},{type:'StripePermissionError',statusCode:403},{type:'StripeInvalidRequestError',statusCode:400}])('records only definitive provider request refusal %j',async error=>{const sdk=client();sdk.createSession.mockRejectedValue({...error,message:'secret response'});expect(await createStripeHostedRequest(request,op,sdk,origin)).toEqual({state:'failed',code:'PAYMENT_REQUEST_REFUSED'});});
 it('idempotency conflict remains unknown and never exposes provider error',async()=>{const sdk=client();sdk.createSession.mockRejectedValue({type:'StripeInvalidRequestError',statusCode:400,code:'idempotency_key_in_use',message:'secret'});expect(await createStripeHostedRequest(request,op,sdk,origin)).toEqual({state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});});
 it('does not redispatch an already uncertain operation',async()=>{const sdk=client();expect(await createStripeHostedRequest(request,{...op,state:'outcome_unknown'},sdk,origin)).toMatchObject({state:'outcome_unknown'});expect(sdk.createSession).not.toHaveBeenCalled();});
 it('creation response alone never proves settlement',async()=>{expect(await createStripeHostedRequest(request,op,client(settled()),origin)).toMatchObject({state:'provider_accepted'});});
 it.each([{livemode:true},{amount_total:49999},{currency:'eur'},{metadata:{...meta,tenant_id:'test-tenant-b'}},{url:'https://evil.example/pay'}])('mismatched creation response remains unknown %j',async patch=>{expect(await createStripeHostedRequest(request,op,client({...session(),...patch}),origin)).toMatchObject({state:'outcome_unknown'});});
 it('redirect completion without underlying captured settlement cannot allocate',async()=>{expect(await readStripeHostedRequest(request,op,client({...session(),status:'complete',payment_status:'paid'}),'cs_test_a')).toMatchObject({state:'provider_accepted'});});
 it('reads exact account object and requires settlement identity',async()=>{const sdk=client(settled());expect(await readStripeHostedRequest(request,op,sdk,'cs_test_a')).toMatchObject({state:'settled',provider_transaction_id:'ch_a',provider_settlement_id:'txn_a',amount_minor:50000,currency:'usd'});expect(sdk.retrieveSession.mock.calls[0][2]).toEqual({stripeAccount:merchant.merchant_id});});
 it.each([
  {status:'processing'},{amount_received:49999},{currency:'eur'},{livemode:true},
  {latest_charge:{...settled().payment_intent.latest_charge,captured:false}},
  {latest_charge:{...settled().payment_intent.latest_charge,disputed:true}},
  {latest_charge:{...settled().payment_intent.latest_charge,amount_refunded:100}},
  {latest_charge:{...settled().payment_intent.latest_charge,application_fee_amount:100}},
  {latest_charge:{...settled().payment_intent.latest_charge,transfer:'tr_other'}},
  {latest_charge:{...settled().payment_intent.latest_charge,balance_transaction:{...settled().payment_intent.latest_charge.balance_transaction,status:'pending'}}},
 ])('never settles incomplete/conflicting provider evidence %j',async patch=>{const value={...settled(),payment_intent:{...settled().payment_intent,...patch}};expect((await readStripeHostedRequest(request,op,client(value),'cs_test_a')).state).not.toBe('settled');});
 it('recovers lost response by scoped readback only; no new payment dispatch',async()=>{const sdk=client();expect(await readStripeHostedRequest(request,{...op,state:'outcome_unknown'},sdk,null,1700000000)).toMatchObject({provider_object_id:'cs_test_a',state:'customer_action_required'});expect(sdk.createSession).not.toHaveBeenCalled();expect(sdk.listSessions.mock.calls[0][1]).toEqual({stripeAccount:merchant.merchant_id});});
 it('multiple matching recovery objects remain unknown',async()=>{const sdk=client();sdk.listSessions.mockResolvedValue({data:[session(),{...session(),id:'cs_test_b'}],has_more:false});expect(await readStripeHostedRequest(request,op,sdk,null,1700000000)).toMatchObject({state:'outcome_unknown'});expect(sdk.createSession).not.toHaveBeenCalled();});
 it('zero matching recovery objects does not prove provider refusal',async()=>{const sdk=client();sdk.listSessions.mockResolvedValue({data:[],has_more:false});expect(await readStripeHostedRequest(request,op,sdk,null,1700000000)).toMatchObject({state:'outcome_unknown'});});
 it('cannot swap a persisted provider identity',async()=>{const sdk=client();expect(await readStripeHostedRequest(request,{...op,provider_operation_id:'cs_test_persisted'},sdk,'cs_test_a')).toMatchObject({state:'outcome_unknown'});expect(sdk.retrieveSession).not.toHaveBeenCalled();});
});
