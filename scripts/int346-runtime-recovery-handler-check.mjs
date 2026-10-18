// Actual Chat handler + recording transport. No provider/network/customer effect.
import assert from 'node:assert/strict';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let hosted=true,held=true,modelCalls=0,emittedTool=null;
const bodies=[],receipts=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key',
 SB_EXECUTION_ID:hosted?id(80):'',DENO_DEPLOYMENT_ID:hosted?`abcdefghijklmnopqrst_${id(82)}_441`:''})[key]??''}};
globalThis.fetch=async(url,options)=>{
 if(!String(url).includes('api.anthropic.com'))return new Response('{}',{status:503});
 const body=JSON.parse(options.body);
 if(body.system?.startsWith('You label one message sent to PAIGE'))return Response.json({content:[{type:'text',text:JSON.stringify({intent:'answer',research:'none',difficulty:'routine',image:'none',needs_workspace_data:true,confidence:.9})}],usage:{input_tokens:1,output_tokens:1}});
 bodies.push(body);modelCalls++;
 const events=modelCalls===1&&emittedTool?[{type:'message_start',message:{usage:{input_tokens:1}}},
  {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-control',name:emittedTool}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{}'}},
  {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}},{type:'message_stop'}]:[
  {type:'message_start',message:{usage:{input_tokens:1}}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'I can read existing information; the earlier outcome is still unconfirmed.'}},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
 return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
};
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const actor=id(1),tenant=id(2),thread=id(3);let executor=null,latest=null,passed=0;
function scenario(){return fake.setScenario({authUser:{id:actor},tables:{profiles:[{active_tenant_id:tenant}],tenant_members:[{tenant_id:tenant}],
 tenants:[{id:tenant,account_type:'standalone',parent_tenant_id:null}],paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor,audience:'workspace'}],
 paige_chat_turns:filters=>filters.some(f=>f[0]==='contains')?[]:receipts},rpcs:{
 paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},
 resolve_tool_autonomy:{data:'auto',error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},resolve_tool_autonomy_many:{data:[],error:null},
 get_actor_access:{data:{tier:'tenant'},error:null},get_team_authority_readiness:{data:[{fact_key:'viewer_permission',value:'admin',status:'available',tenant_id:tenant}],error:null},
 get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},
 current_user_tenant_id:{data:tenant,error:null},
 is_tenant_admin_as:{data:true,error:null},agency_can_manage_child:{data:false,error:null},
 read_business_time_zone:{data:{state:'missing',zone:null,set_at:null,local_date:null,can_set:true},error:null},
 paige_chat_interactive_begin_v2:a=>{latest=a.p_intent;return{data:{status:'accepted',turn_id:id(5)},error:null};},
 paige_chat_interactive_runtime_context:()=>({data:{latest,executor,acquired:false,terminal:false,stopped:false,recovery_read_only:held},error:null}),
 paige_chat_interactive_acquire_bound:a=>{executor=a.p_intent;return{data:{latest,executor,acquired:true,terminal:false,stopped:false,recovery_read_only:held},error:null};},
 paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire'&&held)return{data:null,error:{code:'23514'}};
  if(a.p_operation==='acquire')executor=a.p_intent;if(a.p_operation==='release')executor=null;return{data:{latest,executor,acquired:executor===a.p_intent,terminal:receipts.length>0,stopped:false},error:null};},
 paige_chat_interactive_publication_context_v2:{data:true,error:null},
 paige_chat_interactive_settle:a=>{receipts.push({role:'assistant',content:a.p_content,bundle_ref:a.p_bundle_ref});return{data:id(9),error:null};},
 }});}
const reads=new Set(['read_business_metric','get_business_snapshot','read_client_engagement_status','read_business_time_zone','read_calendar_booking','crm_get_task']);
async function execute(tool=null,extras={},content='Explain the current business status'){
 emittedTool=tool;modelCalls=0;bodies.length=0;receipts.length=0;executor=null;latest=null;
 const rec=scenario();
 const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},
 body:JSON.stringify({messages:[{role:'user',content}],threadId:thread,requestIntentId:id(100+passed),interactive:{kind:'message'},...extras})}));
 const wire=await response.text();return{rec,response,wire};
}
async function check(name,fn){await fn();console.log(`ok ${++passed} - ${name}`);}
await check('new held claim uses server-bound acquire and offers only proven incumbent reads',async()=>{
 const r=await execute();assert.equal(r.response.status,200);assert.ok(bodies.length);
 for(const body of bodies)for(const tool of body.tools??[])assert.ok(reads.has(tool.name));
 const bound=r.rec.rpc.find(c=>c.name==='paige_chat_interactive_acquire_bound');assert.ok(bound);assert.equal(bound.args.p_execution_id,id(80));assert.match(bound.args.p_request_nonce,/^[0-9a-f-]{36}$/);
 assert.ok(!r.rec.rpc.some(c=>c.name==='paige_chat_interactive_recover_bound'),'customer Chat never invokes operator recovery');
});
await check('held continuation actually executes the existing original-JWT read without clearing native uncertainty',async()=>{
 const r=await execute('read_business_time_zone',{},'What is my business time zone?');
 assert.equal(r.rec.rpc.filter(c=>c.name==='read_business_time_zone').length,1);
 assert.ok(!r.rec.rpc.some(c=>c.name==='paige_chat_interactive_recover_bound'));
 assert.equal(held,true);assert.ok(receipts.at(-1).bundle_ref.interactive.effects.some(e=>e.tool==='read_business_time_zone'));
});
for(const tool of ['propose_action','pipeline_archive_preview','crm_create_task','send_email','knowledge_delete','document_generate','schedule_reminder','unclassified_tool'])
 await check('actual provider tool cannot escape read-only recovery: '+tool,async()=>{
  const r=await execute(tool);assert.ok(JSON.stringify(bodies).includes('INTERACTIVE_RECOVERY_READ_ONLY'));
  assert.ok(!r.rec.rpc.some(c=>/execute_crm_command|prepare_comms|claim_comms|approve|create_plan|book_meeting/.test(c.name)));
  assert.equal(r.rec.functions.length,0);
  assert.ok(!r.rec.inserts.some(x=>/pending_approval|pending_confirmation|knowledge_doc|internal_booking|client_memory|paige_owner_memory/.test(x.table)));
 });
await check('automatic preference memory is not written by a held read-only turn',async()=>{
 const r=await execute(null,{},'I prefer brief answers');assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.ok(!r.rec.inserts.some(x=>x.table==='client_memory'));
});
await check('pre-tool document request refuses before model/provider or storage work',async()=>{
 const r=await execute(null,{document:{kind:'pdf',mimeType:'application/pdf',fileName:'protected.pdf',base64:'JVBERi0='}});
 assert.equal(r.response.status,409);assert.ok(r.wire.includes('INTERACTIVE_RECOVERY_READ_ONLY'));assert.equal(bodies.length,0);assert.equal(r.rec.functions.length,0);
});
hosted=false;
await check('old unbound caller native hold refusal cannot dispatch a model or clear executor',async()=>{
 const r=await execute();assert.notEqual(r.response.status,200);assert.equal(bodies.length,0);
 assert.ok(!r.rec.rpc.some(c=>c.name==='paige_chat_interactive_settle'||c.name==='paige_chat_interactive_executor_v2'&&c.args.p_operation==='release'));
});
held=false;hosted=false;
await check('missing hosted identity preserves ordinary old caller acquisition without claiming recoverability',async()=>{
 const r=await execute();assert.equal(r.response.status,200);assert.ok(!r.rec.rpc.some(c=>c.name==='paige_chat_interactive_acquire_bound'));assert.ok(r.rec.rpc.some(c=>c.name==='paige_chat_interactive_executor_v2'&&c.args.p_operation==='acquire'));
});
console.log(`PASS ${passed} actual-handler cases / 0 failed; all provider/native ports recorded doubles`);
