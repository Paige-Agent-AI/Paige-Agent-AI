// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readDurableObservation} from '../../supabase/functions/_shared/durable-job/observation';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ref={threadId:id(1),intentId:id(2),workId:id(3)};
const base={...ref,workIntentId:id(6),actorId:id(4),tenantId:id(5),state:'succeeded',version:2,
  artifactVerified:false,artifactRef:null,recoveryState:'observed',observationKind:'systems_check',receiptVerified:true,receiptRef:id(7)};
function caller(first:Record<string,unknown>=base,last:Record<string,unknown>=first){
  let reads=0;
  return {auth:{getUser:vi.fn(async()=>({data:{user:{id:id(4)}},error:null}))},
    rpc:vi.fn(async(name:string)=>({data:name==='current_user_tenant_id'?id(5):reads++?last:first,error:null}))};
}
it('returns only verified original manual receipt identity, never artifact or raw execution data',async()=>{
  const c=caller({...base,request_payload:{private:'never return'},eligibleForExecution:true});
  const result=await readDurableObservation(ref,c);
  expect(result).toMatchObject({observationKind:'systems_check',state:'succeeded',receiptVerified:true,receiptRef:id(7),artifactVerified:false,artifactRef:null});
  expect(result).not.toHaveProperty('request_payload');expect(result).not.toHaveProperty('eligibleForExecution');
});
it.each(['claimed','blocked','failed','cancelled','expired','outcome_unknown'])('keeps %s distinct from verified completion',async state=>{
  const r={...base,state,receiptVerified:false,receiptRef:null,recoveryState:['expired','outcome_unknown'].includes(state)?'reconciliation_required':'observed'};
  expect(await readDurableObservation(ref,caller(r))).toMatchObject({state,receiptVerified:false,receiptRef:null,cancelled:state==='cancelled'});
});
it('retains terminal-unverified when the original completion receipt is missing',async()=>{
  const r={...base,receiptVerified:false,receiptRef:null,recoveryState:'terminal_unverified'};
  expect(await readDurableObservation(ref,caller(r))).toMatchObject({state:'succeeded',recoveryState:'terminal_unverified',receiptVerified:false});
});
it.each([
  {artifactVerified:true,artifactRef:id(8)}, {artifactRef:id(8)}, {receiptVerified:'true'},
  {receiptRef:'not-a-uuid'}, {receiptRef:null}, {state:'claimed'},
  {receiptVerified:false,receiptRef:id(7)}, {observationKind:'invented'},
])('rejects inconsistent manual proof %j',async change=>{
  expect(await readDurableObservation(ref,caller({...base,...change}))).toBeNull();
});
it.each([{receiptRef:id(8)},{receiptVerified:false,receiptRef:null},{observationKind:undefined}])('withdraws a concurrently changed original receipt %j',async change=>{
  expect(await readDurableObservation(ref,caller(base,{...base,...change}))).toBeNull();
});
it('preserves the exact legacy closed projection and does not reinterpret forged receipt fields',async()=>{
  const legacy={...base,observationKind:undefined};
  const result=await readDurableObservation(ref,caller(legacy));
  expect(result).not.toHaveProperty('observationKind');expect(result).not.toHaveProperty('receiptVerified');expect(result).not.toHaveProperty('receiptRef');
  expect(result?.artifactVerified).toBe(false);
});
