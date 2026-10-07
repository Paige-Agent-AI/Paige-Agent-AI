import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key'})[k]??''}};
const unknownTool=null; let successor=false, failCloseOnce=false;
let modelCalls=0;
globalThis.fetch=async(url,opts)=>{
 if(!String(url).includes('api.anthropic.com')) return new Response('{}',{status:503});
 const body=JSON.parse(opts.body);
 if(body.system?.startsWith('You label one message sent to PAIGE'))return Response.json({content:[{type:'text',text:JSON.stringify({intent:'answer',research:'none',difficulty:'routine',image:'none',needs_workspace_data:true,confidence:.9})}],usage:{input_tokens:1,output_tokens:1}});
 modelCalls++;
 if(modelCalls>1 && !successor)throw new Error('fixture gateway failure after unknown write'); if(modelCalls>1)return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Readback is required."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
 const events=[{type:'message_start',message:{usage:{input_tokens:1}}}];
 for(let i=0;i<1;i++)events.push({type:'content_block_start',index:i,content_block:{type:'tool_use',id:`tool-${i}`,name:'plan_create'}},{type:'content_block_delta',index:i,delta:{type:'input_json_delta',partial_json:JSON.stringify({title:`Plan ${i}`,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12'})}});
 events.push({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}},{type:'message_stop'});
 return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
};
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);let latest=intent,executor=null;const receipts=[];
const rec=fake.setScenario({authUser:{id:actor},tables:{profiles:[{active_tenant_id:tenant}],tenant_members:[{tenant_id:tenant}],paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],paige_chat_turns:filters=>unknownTool && filters.some(f=>f[0]==="contains")?[{bundle_ref:{interactive:{effects:[{tool:unknownTool,outcome:"outcome_unknown"}]}}}]:receipts},rpcs:{check_rate_limit:{data:true,error:null},resolve_tool_autonomy:{data:"auto",error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},resolve_tool_autonomy_many:{data:[{tool_key:"plan_create",mode:"auto",ceiling_allows_auto:true}],error:null},get_actor_access:{data:{tier:'tenant'},error:null},get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},paige_chat_interactive_begin:a=>{latest=a.p_intent;return {data:{status:'accepted',turn_id:id(5)},error:null};},paige_chat_interactive_executor:a=>{if(a.p_operation==='state' && failCloseOnce){failCloseOnce=false;return {data:null,error:{message:'fixture generic loop failure'}};}if(a.p_operation==='acquire')executor=a.p_intent;if(a.p_operation==='release')executor=null;return {data:{latest,executor,acquired:true},error:null};},plan_create:()=>{failCloseOnce=process.env.INT336_ERROR_KIND!=="gateway";return {data:{outcome:"outcome_unknown",plan_id:id(7)},error:null};},paige_chat_turn_append:a=>{receipts.push({role:a.p_role,content:a.p_content,bundle_ref:a.p_bundle_ref});return {data:id(8),error:null};}}});
const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Create two individual plans'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'}})}));
const wire=await response.text();
if(unknownTool){
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,unknownTool==='plan_list'?1:0,wire);
 if(unknownTool!=='plan_list')assert.ok(modelCalls>1,'write refusal must permit normal response');
 console.log('PASS actual handler unknown-effect consequential brake; harmless read receipts do not block writes');
 process.exit(0);
}
assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,1,wire);
assert.ok(process.env.INT336_ERROR_KIND==="gateway"?modelCalls>1:modelCalls===1);
assert.equal(receipts.length,1);
assert.equal(receipts[0].bundle_ref.turn_state.state,'INTERRUPTED');
assert.equal(receipts[0].bundle_ref.interactive.effects[0].outcome,'outcome_unknown'); assert.equal(receipts[0].bundle_ref.interactive.effects[0].record_refs[0].id,id(7));
assert.equal(executor,null,'settled receipt precedes token release');
successor=true; modelCalls=0; const before=rec.rpc.filter(c=>c.name==='plan_create').length; const next=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Create another plan'}],threadId:thread,requestIntentId:id(20),interactive:{kind:'message'}})})); await next.text(); assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,before,'persisted unknown write brakes successor'); console.log('PASS actual unknown write then loop failure preserves canonical uncertainty and brakes successor write');







