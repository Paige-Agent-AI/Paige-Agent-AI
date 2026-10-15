import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key'})[k]??''}};
const unknownTool=process.env.INT336_UNKNOWN_TOOL;
const recoveryMode=process.env.PLANNING_RECOVERY;
if(recoveryMode)assert.ok(['lost','gateway','missing-readback','refused'].includes(recoveryMode));
const knowledgeMode=process.env.KNOWLEDGE_INGEST_TEST;
if(knowledgeMode){assert.ok(['success','uncertain','refused','partial'].includes(knowledgeMode));assert.ok(!recoveryMode&&!unknownTool);}
const ingestRequests=[];
let modelCalls=0;
globalThis.fetch=async(url,opts)=>{
 if(String(url)==='https://test.supabase.co/functions/v1/kb-ingest-doc'){
  ingestRequests.push({body:JSON.parse(opts.body),authorization:opts.headers.Authorization});
  return Response.json(knowledgeMode==='uncertain'?{ok:false,doc_id:'00000000-0000-4000-8000-000000000009',error:'persistence_unverified',chunk_count:0,embedded:false}
   :knowledgeMode==='refused'?{ok:false,ingestion_started:false}
   :{ok:true,doc_id:'00000000-0000-4000-8000-000000000009',chunk_count:1,embedded:knowledgeMode!=='partial'},
   {status:knowledgeMode==='uncertain'?400:knowledgeMode==='refused'?403:200});
 }
 if(!String(url).includes('api.anthropic.com')) return new Response('{}',{status:503});
 const body=JSON.parse(opts.body);
 if(body.system?.startsWith('You label one message sent to PAIGE'))return Response.json({content:[{type:'text',text:JSON.stringify({intent:'answer',research:'none',difficulty:'routine',image:'none',needs_workspace_data:true,confidence:.9})}],usage:{input_tokens:1,output_tokens:1}});
 modelCalls++;
 if(modelCalls>1)return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Readback is required."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
 const events=[{type:'message_start',message:{usage:{input_tokens:1}}}];
 for(let i=0;i<2;i++)events.push({type:'content_block_start',index:i,content_block:{type:'tool_use',id:`tool-${i}`,name:knowledgeMode&&i===0?'save_to_knowledge_base':'plan_create'}},{type:'content_block_delta',index:i,delta:{type:'input_json_delta',partial_json:JSON.stringify(knowledgeMode&&i===0?{title:'Fixture reference',content:'Private fixture content'}:{title:`Plan ${knowledgeMode?0:i}`,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12'})}});
 events.push({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}},{type:'message_stop'});
 return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
};
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);let latest=intent,executor=null;const receipts=[];
const rec=fake.setScenario({authUser:{id:actor},tables:{
 profiles:[{active_tenant_id:tenant}],tenant_members:[{tenant_id:tenant}],
 plans:recoveryMode==='missing-readback'?[]:[{id:id(7),tenant_id:tenant,created_by:actor,owner_user_id:actor,
  title:'Plan 0',summary:null,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12',scope:'individual',
  campaign_ref:null,status:'active',updated_at:'2026-10-06T12:00:00Z'}],
 paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],
 paige_chat_turns:filters=>unknownTool && filters.some(f=>f[0]==="contains")?[{bundle_ref:{interactive:{effects:[{tool:unknownTool,outcome:"outcome_unknown"}]}}}]:receipts
},rpcs:{
 current_user_tenant_id:{data:tenant,error:null},
 paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},
 resolve_tool_autonomy:{data:"auto",error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},
 resolve_tool_autonomy_many:{data:[{tool_key:"plan_create",mode:"auto",ceiling_allows_auto:true}],error:null},
 get_actor_access:{data:{tier:'tenant'},error:null},
 get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},
 paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:id(5)},error:null},
 paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire')executor=intent;if(a.p_operation==='release')executor=null;return {data:{latest,executor,acquired:true,terminal:receipts.length>0},error:null};},
 plan_create:()=>{
  if(recoveryMode==='lost')throw new TypeError('Failed to fetch after commit');
  if(recoveryMode==='gateway')return {data:null,error:{code:'',message:'gateway timed out'}};
  if(recoveryMode==='refused')return {data:null,error:{code:'42501',message:'PLAN_FORBIDDEN'}};
  if(!recoveryMode)latest=id(6);
  return {data:{ok:true,plan_id:id(7)},error:null};
 },
 paige_chat_interactive_settle:a=>{receipts.push({role:"assistant",content:a.p_content,bundle_ref:a.p_bundle_ref});return {data:id(8),error:null};}
}});
const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Create two individual plans'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'}})}));
const wire=await response.text();
if(knowledgeMode){
 assert.equal(ingestRequests.length,1,'no blind ingestion retry');
 assert.equal(ingestRequests[0].authorization,'Bearer test','ordinary caller JWT forwarded');
 assert.equal(ingestRequests[0].body.tenant_id,tenant,'server workspace equality precondition');
 assert.equal(ingestRequests[0].body.share_to_network,false,'private ingestion');
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,knowledgeMode==='uncertain'?0:1,wire);
 assert.equal(receipts.length,1);
 const effect=receipts[0].bundle_ref.interactive.effects.find(e=>e.tool==='save_to_knowledge_base');
 assert.equal(effect.outcome,knowledgeMode==='uncertain'?'outcome_unknown':knowledgeMode==='refused'?'reported_failure':'reported_success');
 if(knowledgeMode!=='refused')assert.ok(effect.record_refs.some(r=>r.kind==='knowledge_document'&&r.id===id(9)));
 console.log(`PASS actual handler Knowledge ${knowledgeMode}: caller/workspace/private binding, native truth, durable document reference and correct successor brake`);
 process.exit(0);
}
if(recoveryMode){
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,recoveryMode==='refused'?2:1,wire);
 assert.equal(receipts.length,1,'one canonical terminal receipt');
 assert.equal(receipts[0].bundle_ref.interactive.effects[0].outcome,recoveryMode==='refused'?'reported_failure':'outcome_unknown');
 assert.equal(modelCalls,2,'normal explanation remains possible after refusal/uncertainty');
 if(recoveryMode!=='refused')assert.ok(receipts[0].bundle_ref.interactive.effects.every(e=>e.outcome!=='reported_success'));
 console.log(`PASS actual handler Planning ${recoveryMode}: original write once, subsequent writes held only for uncertainty, truthful durable effect`);
 process.exit(0);
}
if(unknownTool){
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,unknownTool==='plan_list'?1:0,wire);
 if(unknownTool!=='plan_list')assert.ok(modelCalls>1,'write refusal must permit normal response');
 console.log('PASS actual handler unknown-effect consequential brake; harmless read receipts do not block writes');
 process.exit(0);
}
assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,1,wire);
assert.equal(modelCalls,1,'superseded generation must not dispatch continuation');
assert.equal(receipts.length,1);
assert.equal(receipts[0].bundle_ref.turn_state.state,'INTERRUPTED');
assert.equal(receipts[0].bundle_ref.interactive.effects[0].record_refs[0].id,id(7));
assert.equal(executor,null,'settled receipt precedes token release');
console.log('PASS actual handler two-tool batch: first native write truth preserved, second not dispatched, no next model, interrupted canonical receipt precedes release');

const issued=rec.rpc.find(c=>c.name==='paige_chat_interactive_settle');
assert.ok(issued);assert.equal(issued.client,'service');assert.equal(issued.args.p_actor,actor);assert.equal(issued.args.p_tenant,tenant);assert.equal(issued.args.p_thread,thread);assert.equal(issued.args.p_intent,intent);
