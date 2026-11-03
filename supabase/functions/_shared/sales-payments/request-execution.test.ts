import {describe,it,expect,vi} from 'vitest';
import {dispatchPreparedPayment,reconcilePayment,type PaymentExecutionPorts} from './request-execution.ts';
const request={id:'request-a',tenant_id:'tenant-a',invoice_id:'invoice-a',invoice_version:3,issued_snapshot_version:1,client_id:'client-a',commercial_package_id:null,amount_minor:50000,currency:'usd',purpose:'partial' as const,idempotency_key:'request-key'};
const operation={id:'operation-a',tenant_id:'tenant-a',request_id:'request-a',provider:'stripe' as const,merchant_id:'acct_A',merchant_version:1,environment:'test' as const,idempotency_key:'operation-key',provider_operation_id:null,state:'dispatching' as const,application_fee_minor:0 as const};
const claim={request,operation,claimToken:'internal-claim',dispatchStartedAt:'2026-10-05T12:00:00Z'};
const meta={paige_operation_id:'operation-a',paige_request_id:'request-a',tenant_id:'tenant-a',invoice_id:'invoice-a',client_id:'client-a'};
const session={id:'cs_test_A',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',amount_total:50000,currency:'usd',client_reference_id:'operation-a',metadata:meta,expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_test_A'};
function ports():PaymentExecutionPorts {
 return {stillCurrent:vi.fn().mockResolvedValue(true),claim:vi.fn().mockResolvedValue(claim),readInternal:vi.fn().mockResolvedValue(claim),persist:vi.fn().mockResolvedValue(undefined),readSafe:vi.fn().mockResolvedValue({outcome:'customer_action_required'}),publicOrigin:'https://paigeagent.ai',
 stripe:{environment:'test',createSession:vi.fn().mockResolvedValue(session),retrieveSession:vi.fn().mockResolvedValue(session),listSessions:vi.fn().mockResolvedValue({data:[session],has_more:false})}};
}
describe('persisted payment dispatch boundary',()=>{
 it('reads an original LIVE operation through its readback client while TEST remains the only dispatch client',async()=>{
  const p=ports(),original={...claim,operation:{...operation,environment:'live' as const,state:'outcome_unknown' as const,provider_operation_id:'cs_live_A'}};
  const live={...p.stripe,environment:'live' as const,createSession:vi.fn(async()=>{throw Error('READBACK_MUST_NOT_DISPATCH');}),retrieveSession:vi.fn().mockResolvedValue({...session,id:'cs_live_A',livemode:true,url:'https://checkout.stripe.com/c/pay/cs_live_A'})};
  const select=vi.fn(()=>live);Object.assign(p,{stripeForReadback:select});vi.mocked(p.readInternal).mockResolvedValue(original);
  await reconcilePayment(p);
  expect(select).toHaveBeenCalledExactlyOnceWith('live');expect(live.retrieveSession).toHaveBeenCalledOnce();
  expect(p.stripe.retrieveSession).not.toHaveBeenCalled();expect(p.stripe.createSession).not.toHaveBeenCalled();expect(live.createSession).not.toHaveBeenCalled();
  expect(p.persist).toHaveBeenCalledWith(original,expect.objectContaining({state:'customer_action_required'}));
 });
 it('never uses the original LIVE readback client to dispatch a newly claimed LIVE request under TEST configuration',async()=>{
  const p=ports(),live={...p.stripe,environment:'live' as const,createSession:vi.fn()};
  const select=vi.fn(()=>live);Object.assign(p,{stripeForReadback:select});
  vi.mocked(p.claim).mockResolvedValue({...claim,operation:{...operation,environment:'live'}});
  await dispatchPreparedPayment(p);
  expect(select).not.toHaveBeenCalled();expect(p.stripe.createSession).not.toHaveBeenCalled();expect(live.createSession).not.toHaveBeenCalled();
 });
 it('claims before dispatch and persists before reporting readback',async()=>{const p=ports();await dispatchPreparedPayment(p);expect(vi.mocked(p.claim).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(p.stripe.createSession).mock.invocationCallOrder[0]);expect(vi.mocked(p.persist).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(p.readSafe).mock.invocationCallOrder[0]);});
 it('refuses a mismatched recovery client before any provider access or persisted result',async()=>{
  const p=ports();p.stripeForReadback=()=>({...p.stripe,environment:'live'});
  expect(await reconcilePayment(p)).toMatchObject({outcome:'outcome_unknown'});
  expect(p.stripe.listSessions).not.toHaveBeenCalled();expect(p.persist).not.toHaveBeenCalled();
 });
 it('workspace change refuses without claim or provider call',async()=>{const p=ports();vi.mocked(p.stillCurrent).mockResolvedValue(false);expect(await dispatchPreparedPayment(p)).toMatchObject({code:'WORKSPACE_CHANGED'});expect(p.claim).not.toHaveBeenCalled();expect(p.stripe.createSession).not.toHaveBeenCalled();});
 it('workspace switch after claim refuses dispatch and preserves recovery evidence',async()=>{const p=ports();vi.mocked(p.stillCurrent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);expect(await dispatchPreparedPayment(p)).toMatchObject({code:'WORKSPACE_CHANGED'});expect(p.stripe.createSession).not.toHaveBeenCalled();expect(p.persist).toHaveBeenCalledWith(claim,expect.objectContaining({state:'outcome_unknown'}));});
 it('claim failure never dispatches',async()=>{const p=ports();vi.mocked(p.claim).mockRejectedValue(new Error('db'));expect(await dispatchPreparedPayment(p)).toMatchObject({outcome:'outcome_unknown'});expect(p.stripe.createSession).not.toHaveBeenCalled();});
 it('losing claim reconciles without another POST',async()=>{const p=ports();vi.mocked(p.claim).mockResolvedValue(null);await dispatchPreparedPayment(p);expect(p.stripe.createSession).not.toHaveBeenCalled();expect(p.stripe.retrieveSession).toHaveBeenCalledOnce();});
 it('provider timeout is persisted as unknown, never failed',async()=>{const p=ports();vi.mocked(p.stripe.createSession).mockRejectedValue(new Error('secret'));await dispatchPreparedPayment(p);expect(p.persist).toHaveBeenCalledWith(claim,{state:'outcome_unknown',code:'PROVIDER_READBACK_REQUIRED'});});
 it('receipt failure cannot report success',async()=>{const p=ports();vi.mocked(p.persist).mockRejectedValue(new Error('rollback'));expect(await dispatchPreparedPayment(p)).toMatchObject({ok:false,outcome:'outcome_unknown'});expect(p.readSafe).not.toHaveBeenCalled();});
 it('crash recovery lists/reads without dispatch',async()=>{const p=ports();await reconcilePayment(p);expect(p.stripe.listSessions).toHaveBeenCalledWith({limit:100,created:{gte:1791201540}},{stripeAccount:'acct_A'});expect(p.stripe.createSession).not.toHaveBeenCalled();});
 it('undispatched prepared state only returns canonical read',async()=>{const p=ports();vi.mocked(p.readInternal).mockResolvedValue({...claim,operation:{...operation,state:'prepared'}});await reconcilePayment(p);expect(p.stripe.listSessions).not.toHaveBeenCalled();expect(p.persist).not.toHaveBeenCalled();});
 it('invalid dispatch timestamp remains uncertain without querying provider',async()=>{const p=ports();vi.mocked(p.readInternal).mockResolvedValue({...claim,dispatchStartedAt:'invalid'});expect(await reconcilePayment(p)).toMatchObject({outcome:'outcome_unknown'});expect(p.stripe.listSessions).not.toHaveBeenCalled();});
});
