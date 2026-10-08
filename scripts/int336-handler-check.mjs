import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key'})[k]??''}};
globalThis.fetch=async()=>new Response('{}',{status:503});
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);
const req=(extras={})=>new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Newest context'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'},...extras})});
const scenario=(status,extra={})=>fake.setScenario({authUser:{id:actor},tables:{paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],...extra.tables},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},paige_chat_interactive_begin_v2:{data:{status,turn_id:status==='accepted'?id(5):null},error:null},...extra.rpcs}});
for(const protocol of [{data:null,error:{code:'PGRST202'}},{data:{version:1,active:true},error:null},{data:{version:2,active:false},error:null},{data:null,error:null}]){
 const denied=scenario('accepted',{rpcs:{paige_chat_interactive_protocol:protocol}});
 const response=await capturedHandler()(req());
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'INTERACTIVE_PROTOCOL_NOT_READY',message_accepted:false});
 assert.equal(denied.rpc.some(x=>/interactive_(begin|executor|settle)|turn_append/.test(x.name)),false,'mixed version must refuse before acceptance, acquisition or persistence');
 assert.equal(denied.from.some(x=>x.table==='paige_chat_turns'),false);
}
for(const status of ['duplicate','superseded','stopped']){
const rec=scenario(status);const res=await capturedHandler()(req({interactive:{kind:status==='stopped'?'stop':'message',supersedesIntentId:id(6)}}));
const json=await res.json();assert.equal(json.code,'INTERACTIVE_'+status.toUpperCase());assert.equal(json.message_accepted,status==='duplicate');assert.equal(rec.rpc.some(x=>x.name==='paige_chat_interactive_executor_v2'),false);
assert.equal(rec.rpc.find(x=>x.name==='paige_chat_interactive_begin_v2').client,'jwt');
}
const rec=scenario('accepted',{tables:{paige_chat_turns:[{role:'user',content:'Newest context',bundle_ref:{interactive:{request_intent_id:intent}}}]},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_settle:{data:id(8),error:null},paige_chat_interactive_executor_v2:args=>({data:{latest:intent,executor:args.p_operation==='state'?null:intent,acquired:true},error:null})}});
const res=await capturedHandler()(req({clientId:id(7)})); await res.text();
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2'&&x.args.p_operation==='acquire').length,1);
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2'&&x.args.p_operation==='release').length,1);
assert.ok(rec.from.find(x=>x.table==='paige_chat_turns'));
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_turn_append'&&x.args.p_role==='user').length,0);
for(const proof of [null,{role:'assistant',bundle_ref:{interactive:{request_intent_id:intent},turn_state:{state:'INTERRUPTED'}}},{role:'system',bundle_ref:{interactive:{supersedes_intent_id:intent,stopped:true}}}]){
const statusRec=scenario('accepted',{tables:{paige_chat_turns:proof?[proof]:[]},rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_executor_v2:{data:{latest:null,executor:null,terminal:false,stopped:false},error:null}}});
const statusRes=await capturedHandler()(req({interactive:{kind:'status'}}));
assert.deepEqual(await statusRes.json(),{executor_active:false,settled:false});
assert.equal(statusRec.rpc.some(x=>x.name==='paige_chat_interactive_begin_v2'||x.name==='paige_chat_turn_append'),false);
assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor_v2').every(x=>x.args.p_operation==='state'),true);
}
for (const evidence of [{terminal:true,stopped:false},{terminal:false,stopped:true}]) {
 for (const executor of [null,intent]) {
 const statusRec=scenario('accepted',{rpcs:{paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},paige_chat_interactive_executor_v2:{data:{latest:null,executor,...evidence},error:null}}});
 const response=await capturedHandler()(req({interactive:{kind:'status'}}));
 assert.deepEqual(await response.json(),{executor_active:executor!==null,settled:executor===null});
 assert.equal(statusRec.from.some(c=>c.table==='paige_chat_turns'),false,'status must use canonical authority, not JSON');
 }
}
console.log('PASS real handler: stop/replay/status scope, canonical settlement, JWT begin, service executor, authoritative history, early-exit token release, no second user append');
