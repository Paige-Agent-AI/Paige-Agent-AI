import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key'})[k]??''}};
globalThis.fetch=async()=>new Response('{}',{status:503});
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);
const req=(extras={})=>new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Newest context'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'},...extras})});
const scenario=(status,extra={})=>fake.setScenario({authUser:{id:actor},tables:{paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],...extra.tables},rpcs:{check_rate_limit:{data:true,error:null},paige_chat_interactive_begin:{data:{status,turn_id:status==='accepted'?id(5):null},error:null},...extra.rpcs}});
for(const status of ['duplicate','superseded','stopped']){
const rec=scenario(status);const res=await capturedHandler()(req({interactive:{kind:status==='stopped'?'stop':'message',supersedesIntentId:id(6)}}));
const json=await res.json();assert.equal(json.code,'INTERACTIVE_'+status.toUpperCase());assert.equal(json.message_accepted,status==='duplicate');assert.equal(rec.rpc.some(x=>x.name==='paige_chat_interactive_executor'),false);
assert.equal(rec.rpc.find(x=>x.name==='paige_chat_interactive_begin').client,'jwt');
}
const rec=scenario('accepted',{tables:{paige_chat_turns:[{role:'user',content:'Newest context',bundle_ref:{interactive:{request_intent_id:intent}}}]},rpcs:{paige_chat_interactive_executor:args=>({data:{latest:intent,executor:args.p_operation==='state'?null:intent,acquired:true},error:null})}});
const res=await capturedHandler()(req({clientId:id(7)})); await res.text();
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor'&&x.args.p_operation==='acquire').length,1);
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_interactive_executor'&&x.args.p_operation==='release').length,1);
assert.ok(rec.from.find(x=>x.table==='paige_chat_turns'));
assert.equal(rec.rpc.filter(x=>x.name==='paige_chat_turn_append'&&x.args.p_role==='user').length,0);
for(const proof of [null,{role:'assistant',bundle_ref:{interactive:{request_intent_id:intent},turn_state:{state:'INTERRUPTED'}}},{role:'system',bundle_ref:{interactive:{supersedes_intent_id:intent,stopped:true}}}]){
const statusRec=scenario('accepted',{tables:{paige_chat_turns:proof?[proof]:[]},rpcs:{paige_chat_interactive_executor:{data:{latest:null,executor:null},error:null}}});
const statusRes=await capturedHandler()(req({interactive:{kind:'status'}}));
assert.deepEqual(await statusRes.json(),{executor_active:false,settled:!!proof});
assert.equal(statusRec.rpc.some(x=>x.name==='paige_chat_interactive_begin'||x.name==='paige_chat_turn_append'),false);
assert.equal(statusRec.rpc.filter(x=>x.name==='paige_chat_interactive_executor').every(x=>x.args.p_operation==='state'),true);
}
console.log('PASS real handler: stop/replay/status scope, canonical settlement, JWT begin, service executor, authoritative history, early-exit token release, no second user append');
