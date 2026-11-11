import assert from 'node:assert/strict';
import {setScenario} from '../knowledge-scope/fake-supabase.mjs';
import {capturedHandler} from '../knowledge-scope/stub-serve.mjs';
// Existing served-handler harness only. No network or persistence proof inferred.
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service'})[key]??''}};
globalThis.fetch=async()=>{throw Error('No network in this proof');};
await import('../../supabase/functions/crm-command/index.ts');
const handler=capturedHandler(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),mission=id(3),step=id(4);
const body={expected_tenant_id:tenant,inspect_mission_task:{mission_id:mission,step_id:step}};
let count=0;
async function run(payload=body,{scope=tenant,data={inspection:true,status:'not_created'},error=null,user={id:actor}}={}){
 const rec=setScenario({authUser:user,rpcs:{current_user_tenant_id:typeof scope==='function'?scope:{data:scope,error:null},read_crm_command_result:{data,error}}});
 const response=await handler(new Request('https://test.invalid/crm-command',{method:'POST',headers:{Authorization:'Bearer synthetic', 'Content-Type':'application/json'},body:JSON.stringify(payload)}));
 const result=await response.json();
 assert.equal(rec.inserts.length,0,'inspection never writes approvals, Tasks or receipts');
 assert.equal(rec.rpc.some(x=>x.name==='execute_crm_command'),false,'inspection never executes');
 count++;
 return {response,result,rec};
}
let r=await run();assert.equal(r.response.status,200);assert.deepEqual(r.result,{inspection:true,status:'not_created'});
assert.deepEqual(r.rec.rpc.filter(x=>x.client==='service').map(x=>[x.name,x.args]),[['read_crm_command_result',{_tenant_id:tenant,_actor_id:actor,_command:{action:'task.inspect_mission_result',mission_id:mission,step_id:step},_idempotency_key:`mission-inspect:${mission}:${step}`}]]);
const available={inspection:true,status:'available',task:{id:id(5),tenant_id:tenant,title:'Synthetic working task',description:'Reviewed work',status:'pending',assignee_user_id:actor,due_date:null,updated_at:'2026-11-03T12:00:00Z'},
 origin:{contractVersion:1,missionId:mission,missionRevision:2,briefVersion:1,intentSha256:'a'.repeat(64),stepId:step,sources:[{contractVersion:1,tenantId:tenant,documentId:id(7),revision:1,contentSha256:'b'.repeat(64)}]},receipt:{receipt_recorded:true,correlation_id:id(6),created_at:'2026-11-03T12:00:00Z'}};
r=await run(body,{data:available});assert.equal(r.response.status,200);assert.deepEqual(r.result,available);
for(const override of [{task:{...available.task,tenant_id:id(99)}},{origin:{...available.origin,stepId:id(99)}},{receipt:{...available.receipt,receipt_recorded:false}}]){
 r=await run(body,{data:{...available,...override}});assert.equal(r.response.status,503);assert.equal(JSON.stringify(r.result).includes('Synthetic working task'),false);
}
for(const data of [{inspection:true,status:'historical_unavailable'},{inspection:true,status:'ambiguous'}]){r=await run(body,{data});assert.deepEqual(r.result,data);}
for(const extra of [{tenant_id:tenant},{actor_id:actor},{command:{action:'task.create'}},{approved_fingerprint:'synthetic'}]){
 r=await run({...body,...extra});assert.equal(r.response.status,400);assert.equal(r.rec.rpc.length,0);
}
r=await run(body,{scope:id(99)});assert.equal(r.response.status,409);assert.equal(r.rec.rpc.some(x=>x.client==='service'),false);
let reads=0;r=await run(body,{scope:()=>({data:++reads===1?tenant:id(99),error:null})});assert.equal(r.response.status,409);assert.equal(r.result.code,'CRM_ACTIVE_ACCOUNT_CHANGED');
r=await run(body,{error:{message:'CRM_FORBIDDEN'}});assert.equal(r.response.status,403);assert.equal(r.result.code,'CRM_FORBIDDEN');
r=await run(body,{error:{message:'private unsupported source text'}});assert.equal(r.response.status,503);assert.equal(JSON.stringify(r.result).includes('private unsupported'),false);
r=await run(body,{data:{ok:true,outcome:'succeeded',readback:{id:id(5)}}});assert.equal(r.response.status,503);
r=await run(body,{user:null});assert.equal(r.response.status,401);assert.equal(r.rec.rpc.length,0);
const listBody={expected_tenant_id:tenant,inspect_mission_task:{mission_id:mission,offset:0}};
const row={stepId:step,...available};delete row.task.description;
const page=(records=[],offset=0)=>({listing:true,missionId:mission,offset,records,has_more:false,next_offset:null});
r=await run(listBody,{data:page([row])});assert.equal(r.response.status,200);assert.equal(r.result.records[0].task.id,available.task.id);assert.equal('description' in r.result.records[0].task,false);
assert.deepEqual(r.rec.rpc.filter(x=>x.client==='service').map(x=>x.args._command),[{action:'task.inspect_mission_result',mission_id:mission,offset:0}]);
const rows=Array.from({length:20},(_,i)=>{const stepId=id(100+i);return {...row,stepId,origin:{...row.origin,stepId}};});
r=await run(listBody,{data:{...page(rows),has_more:true,next_offset:20}});assert.equal(r.response.status,200);assert.equal(r.result.next_offset,20);
r=await run({...listBody,inspect_mission_task:{mission_id:mission,offset:20}},{data:page([],20)});assert.equal(r.response.status,200);assert.equal(r.result.records.length,0);
for(const invalid of [{...page(),missionId:id(99)},{...page(rows),has_more:true,next_offset:19},page([row,row]),page([{...row,task:{...row.task,tenant_id:id(99)}}]),page([{...row,origin:{...row.origin,missionId:id(99)}}])]){
 r=await run(listBody,{data:invalid});assert.equal(r.response.status,503);assert.equal(JSON.stringify(r.result).includes('Synthetic working task'),false);
}
for(const offset of [-1,0.5,2147483648,'0']){r=await run({...listBody,inspect_mission_task:{mission_id:mission,offset}});assert.equal(r.response.status,400);assert.equal(r.rec.rpc.length,0);}
r=await run({...listBody,inspect_mission_task:{mission_id:mission,offset:0,step_id:step}});assert.equal(r.response.status,400);assert.equal(r.rec.rpc.length,0);
r=await run(listBody,{error:{message:'CRM_FORBIDDEN'}});assert.equal(r.response.status,403);assert.equal(JSON.stringify(r.result).includes('Synthetic working task'),false);
reads=0;r=await run(listBody,{data:page([row]),scope:()=>({data:++reads===1?tenant:id(99),error:null})});assert.equal(r.response.status,409);assert.equal(JSON.stringify(r.result).includes('Synthetic working task'),false);
console.log(`PASS ${count} actual served Mission Task inspection controls; zero execution/approval writes`);
