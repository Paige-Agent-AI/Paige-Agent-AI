import assert from 'node:assert/strict';
import {createInteractiveExecution,InteractiveSuperseded,interactiveEffect,interactiveReceiptContext} from '../supabase/functions/_shared/paige-turn/interactive.ts';
let latest='a', executor=null, released=0;
const store = (id) => ({state:async()=>({latest,executor}), acquire:async()=>{if(executor!==null)return false;executor=id;return true},release:async()=>{if(executor===id)executor=null;released++}});
const a=createInteractiveExecution('a',store('a'));
await a.acquire(); await a.check();
latest='b';
await assert.rejects(a.check(),InteractiveSuperseded);
const b=createInteractiveExecution('b',store('b'));
await assert.rejects(b.acquire(1),/RECONCILIATION_REQUIRED/);
assert.equal(executor,'a');
await a.release(); await a.release(); assert.equal(released,1);
await b.acquire(); assert.equal(executor,'b');
const reader=new ReadableStream({start(){}}).getReader();
const pending=b.read(reader); setTimeout(()=>latest='c',10);
await assert.rejects(pending,InteractiveSuperseded);
await b.release();
const originalInvocation='00000000-0000-4000-8000-000000000001';
for(const result of [{ok:true,runtime:'soft',receipt_recorded:true},
 {ok:false,outcome_unknown:true}, {ok:true,runtime:'langgraph',success:false,outcome_unknown:true}]){
 const effect=interactiveEffect('delegate_to_subagent',{...result,invocation_id:originalInvocation,secret:'private input'});
 assert.deepEqual(effect.record_refs,[{kind:'subagent_invocation',id:originalInvocation}]);
 if(result.outcome_unknown)assert.equal(effect.outcome,'outcome_unknown');
 const context=interactiveReceiptContext({interactive:{effects:[effect]}});
 assert.ok(context.includes(originalInvocation));assert.ok(!context.includes('private input'));
}
for(const tool of ['list_subagents','crm_create_task']){
 assert.equal(interactiveEffect(tool,{ok:true,invocation_id:originalInvocation}).record_refs,undefined);
 const context=interactiveReceiptContext({interactive:{effects:[{tool,outcome:'reported_success',record_refs:[{kind:'subagent_invocation',id:originalInvocation}]}]}});
 assert.ok(!context.includes(originalInvocation));
}
for(const invocation_id of [null,{},'invalid',` ${originalInvocation}`,{id:originalInvocation}]){
 assert.equal(interactiveEffect('delegate_to_subagent',{ok:false,outcome_unknown:true,invocation_id}).record_refs,undefined);
}
assert.deepEqual(interactiveEffect('crm_create_task',{success:true,task_id:originalInvocation,invocation_id:originalInvocation}).record_refs,[{kind:'task',id:originalInvocation}]);
const readDeclaration={action:{chatTool:'read_fixture',classification:'read',riskPolicyKey:'read_only',approvalAuthority:'none',executor:'edge.fixture',idempotency:'read only'},
 outcome:{kinds:['available','needs_input','refused','unavailable'],projector:'fixture'}};
assert.equal(interactiveEffect('read_fixture',{status:'available',message:'Read original record'},[readDeclaration]).outcome,'reported_success');
assert.equal(interactiveEffect('read_fixture',{status:'available',message:'Read original record',invocation_id:originalInvocation},[readDeclaration]).outcome,'outcome_unknown');
console.log('PASS: latest wins, no timeout theft, idempotent release, stalled model interruption');
console.log('PASS: original specialist identity survives known and unknown outcomes; wrong-tool and malformed references stay excluded');
