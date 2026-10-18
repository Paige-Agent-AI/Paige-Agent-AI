// Actual Chat handler + recording transport. No provider/network/customer effect.
import assert from 'node:assert/strict';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let hosted=true,held=true,protocolActive=true,lateHold=null,holdProjection='native',hasThread=true,threadReads=0,modelCalls=0,emittedTool=null,stopResult='stopped';
const bodies=[],receipts=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key',
 SB_EXECUTION_ID:hosted?id(80):'',DENO_DEPLOYMENT_ID:hosted?`abcdefghijklmnopqrst_${id(82)}_441`:''})[key]??''}};
globalThis.fetch=async(url,options)=>{
 if(!String(url).includes('api.anthropic.com'))return new Response('{}',{status:503});
 const body=JSON.parse(options.body);
 if(body.system?.startsWith('You label one message sent to PAIGE'))return Response.json({content:[{type:'text',text:JSON.stringify({intent:'answer',research:'none',difficulty:'routine',image:'none',needs_workspace_data:true,confidence:.9})}],usage:{input_tokens:1,output_tokens:1}});
 bodies.push(body);modelCalls++;
 if(lateHold==='provider'){held=true;executor=null;}
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
const actor=id(1),tenant=id(2),thread='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let executor=null,latest=null,passed=0,failed=0;
function scenario(){return fake.setScenario({authUser:{id:actor},tables:{profiles:()=>{if(lateHold==='profile'||lateHold==='summary-authority'&&threadReads>=2)held=true;return[{active_tenant_id:tenant}];},tenant_members:[{tenant_id:tenant}],
 tenants:[{id:tenant,account_type:'standalone',parent_tenant_id:null}],paige_chat_threads:filters=>{
  if(!hasThread)return[];
  const holdRead=filters.some(f=>f[0]==='select'&&f[1].includes('interactive_recovery_hold'));
  if(holdRead)threadReads++;
  if(holdRead&&lateHold==='second-read'&&threadReads>1)held=true;
  const row={id:thread,tenant_id:lateHold==='scope'&&threadReads>1?id(91):tenant,caller_user_id:actor,audience:'workspace',interactive_recovery_hold:held?id(90):null};
  if(holdProjection==='missing')delete row.interactive_recovery_hold;
  if(holdProjection==='undefined')row.interactive_recovery_hold=undefined;
  if(holdProjection==='array')row.interactive_recovery_hold=[id(90)];
  return[row];},
 paige_owner_memory:filters=>{if(lateHold==='preference'&&filters.some(f=>f[0]==='eq'&&f[1]==='memory_type'&&f[2]==='preference'))held=true;return[];},
 paige_chat_turns:filters=>filters.some(f=>f[0]==='contains')?[]:receipts},rpcs:{
 paige_chat_interactive_protocol:()=>({data:{version:2,active:protocolActive},error:null}),check_rate_limit:{data:true,error:null},
 resolve_tool_autonomy:{data:'auto',error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},resolve_tool_autonomy_many:{data:[],error:null},
 get_actor_access:{data:{tier:'tenant'},error:null},get_team_authority_readiness:{data:[{fact_key:'viewer_permission',value:'admin',status:'available',tenant_id:tenant}],error:null},
 get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},
 current_user_tenant_id:{data:tenant,error:null},
 is_tenant_admin_as:{data:true,error:null},agency_can_manage_child:{data:false,error:null},
 read_business_time_zone:{data:{state:'missing',zone:null,set_at:null,local_date:null,can_set:true},error:null},
 paige_chat_interactive_begin_v2:a=>{if(a.p_stop)return stopResult==='error'?{data:null,error:{code:'fixture'}}
  :{data:stopResult===null?null:{status:stopResult,turn_id:stopResult==='accepted'?id(5):null},error:null};
  latest=a.p_intent;return{data:{status:'accepted',turn_id:id(5)},error:null};},
 paige_chat_interactive_runtime_context:()=>({data:{latest,executor,acquired:false,terminal:false,stopped:false,recovery_read_only:held},error:null}),
 paige_chat_interactive_acquire_bound:a=>{executor=a.p_intent;return{data:{latest,executor,acquired:true,terminal:false,stopped:false,recovery_read_only:held},error:null};},
 paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire'&&held)return{data:null,error:{code:'23514'}};
  if(a.p_operation==='acquire')executor=a.p_intent;if(a.p_operation==='release')executor=null;return{data:{latest,executor,acquired:executor===a.p_intent,terminal:receipts.length>0,stopped:false},error:null};},
 paige_chat_interactive_publication_context_v2:{data:true,error:null},
 paige_chat_interactive_settle:a=>{receipts.push({role:'assistant',content:a.p_content,bundle_ref:a.p_bundle_ref});return{data:id(9),error:null};},
 }});}
const reads=new Set(['read_business_metric','get_business_snapshot','read_client_engagement_status','read_business_time_zone','read_calendar_booking','crm_get_task']);
async function execute(tool=null,extras={},content='Explain the current business status'){
 emittedTool=tool;modelCalls=0;bodies.length=0;receipts.length=0;executor=null;latest=null;threadReads=0;
 const rec=scenario();
 const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},
 body:JSON.stringify({messages:[{role:'user',content}],threadId:thread,requestIntentId:id(100+passed),interactive:{kind:'message'},...extras})}));
 const wire=await response.text();return{rec,response,wire};
}
async function check(name,fn){try{await fn();console.log(`ok ${++passed} - ${name}`);}catch(e){failed++;console.error(`not ok - ${name}: ${e.message}`);}}
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
 const r=await execute(null,{},'Please be brief.');assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.ok(!r.rec.inserts.some(x=>x.table==='client_memory'));
});
await check('pre-tool document request refuses before model/provider or storage work',async()=>{
 const r=await execute(null,{document:{kind:'pdf',mimeType:'application/pdf',fileName:'protected.pdf',base64:'JVBERi0='}});
 assert.equal(r.response.status,409);assert.ok(r.wire.includes('INTERACTIVE_RECOVERY_READ_ONLY'));assert.equal(bodies.length,0);assert.equal(r.rec.functions.length,0);
});
for(const [name,extra]of[['Approve',{approvedConfirmations:['0123456789abcdef']}],['Not now',{declinedConfirmations:['0123456789abcdef']}]])
 await check('held interactive '+name+' preserves canonical early-exit terminal and release',async()=>{
  const r=await execute(null,extra,'Please be brief.');assert.equal(r.response.status,409);assert.equal(bodies.length,0);
  assert.ok(r.rec.rpc.some(c=>c.name==='paige_chat_interactive_settle'&&c.args.p_bundle_ref.turn_state.state==='INTERRUPTED'));
  assert.ok(r.rec.rpc.some(c=>c.name==='paige_chat_interactive_executor_v2'&&c.args.p_operation==='release'));
  assert.equal(executor,null);assert.equal(held,true);assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));
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
hosted=true;held=true;
for(const [name,extra]of[
 ['legacy omission',{interactive:undefined}],
 ['legacy missing intent',{interactive:undefined,requestIntentId:undefined}],
 ['legacy document',{interactive:undefined,document:{kind:'pdf',mimeType:'application/pdf',fileName:'neutral.pdf',base64:'JVBERi0='}}],
 ['legacy summary',{interactive:undefined,generateSessionSummary:true,sessionMessages:[{role:'user',content:'neutral'}]}],
 ['legacy Approve',{interactive:undefined,approvedConfirmations:['0123456789abcdef']}],
 ['legacy Not now',{interactive:undefined,declinedConfirmations:['0123456789abcdef']}],
])await check('held '+name+' cannot bypass native thread hold',async()=>{
 const r=await execute(null,extra,'Please be brief.');assert.notEqual(r.response.status,200);assert.equal(bodies.length,0);
 assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'||/execute_crm|prepare_comms|approve|decline/.test(c.name)));
 assert.equal(r.rec.functions.length,0);assert.ok(!r.rec.inserts.some(x=>/memory|pending_confirmation|knowledge_doc/.test(x.table)));
 assert.equal(executor,null);assert.equal(held,true);
});
protocolActive=false;
await check('held inactive-protocol entry refuses before actual preference memory and provider',async()=>{
 const r=await execute(null,{},'Please be brief.');assert.notEqual(r.response.status,200);assert.equal(bodies.length,0);
 assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.equal(held,true);
});
protocolActive=true;held=false;
await check('unheld legacy actual preference trigger retains ordinary behavior',async()=>{
 const r=await execute(null,{interactive:undefined},'Please be brief.');assert.equal(r.response.status,200);
 assert.ok(r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.equal(held,false);
});
lateHold='preference';held=false;
await check('hold arriving during awaited preference dedupe prevents subsequent direct write',async()=>{
 const r=await execute(null,{interactive:undefined},'Please be brief.');assert.ok(held);assert.equal(bodies.length,0);
 assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.equal(r.rec.functions.length,0);
});
lateHold='provider';held=false;
await check('hold arriving after a legacy provider response prevents its tool mutation',async()=>{
 const r=await execute('crm_create_task',{interactive:undefined});assert.ok(held);
 assert.ok(!r.rec.rpc.some(c=>/execute_crm|prepare_comms|approve/.test(c.name)));assert.equal(r.rec.functions.length,0);
});
lateHold=null;
for(const shape of ['missing','undefined','array'])await check('native '+shape+' hold projection fails closed rather than unheld',async()=>{
 held=false;holdProjection=shape;const r=await execute(null,{interactive:undefined},'Please be brief.');
 assert.equal(r.response.status,409);assert.equal(bodies.length,0);assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));
});
holdProjection='native';hasThread=false;
await check('unowned or unavailable native thread cannot acquire hold permission',async()=>{
 const r=await execute(null,{interactive:undefined});assert.equal(r.response.status,409);assert.equal(bodies.length,0);assert.equal(r.rec.functions.length,0);
});
hasThread=true;held=true;
await check('held legacy UUID case alias remains the same native held thread',async()=>{
 const r=await execute(null,{interactive:undefined,threadId:thread.toUpperCase()},'Please be brief.');
 assert.equal(r.response.status,409);assert.ok(r.wire.includes('INTERACTIVE_RECOVERY_READ_ONLY'));assert.equal(bodies.length,0);
});
await check('native-bound held read continuation accepts the UUID case alias',async()=>{
 const r=await execute(null,{threadId:thread.toUpperCase()});assert.equal(r.response.status,200);assert.ok(bodies.length);
 assert.ok(r.rec.rpc.some(c=>c.name==='paige_chat_interactive_acquire_bound'));
});
await check('caller supplied hold flags cannot erase native hold',async()=>{
 const r=await execute(null,{interactive:undefined,interactive_recovery_hold:null,recovery_read_only:false});assert.equal(r.response.status,409);assert.equal(bodies.length,0);
});
held=false;lateHold='scope';
await check('changed native thread tenant after entry refuses before a direct write',async()=>{
 const r=await execute(null,{interactive:undefined},'Please be brief.');assert.equal(bodies.length,0);assert.ok(threadReads>1);assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));
});
held=false;lateHold='second-read';
await check('late native hold before legacy document processing prevents provider and writer ports',async()=>{
 const r=await execute(null,{interactive:undefined,document:{kind:'pdf',mimeType:'application/pdf',fileName:'neutral.pdf',base64:'JVBERi0='}});
 assert.ok(held);assert.equal(bodies.length,0);assert.equal(r.rec.functions.length,0);assert.ok(!r.rec.inserts.some(x=>x.table==='credit_report_uploads'));
});
held=false;lateHold='profile';
await check('late native hold before legacy summary provider prevents memory writes',async()=>{
 const r=await execute(null,{interactive:undefined,generateSessionSummary:true,sessionMessages:[{role:'user',content:'neutral'}],
  sessionMemoryScope:{v:1,actor_id:actor,tenant_id:tenant,client_id:null}});
 assert.ok(held);assert.equal(bodies.length,0);assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.equal(r.rec.functions.length,0);
});
held=false;lateHold='summary-authority';
await check('hold arriving during summary authority awaits is rechecked before provider dispatch',async()=>{
 const r=await execute(null,{interactive:undefined,generateSessionSummary:true,sessionMessages:[{role:'user',content:'neutral'}],
  sessionMemoryScope:{v:1,actor_id:actor,tenant_id:tenant,client_id:null}});
 assert.ok(held);assert.equal(bodies.length,0);assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'));assert.equal(r.rec.functions.length,0);
});
lateHold=null;held=true;
for(const active of [true,false])for(const kind of ['status','stop'])await check('held '+kind+' stays a dedicated native control with protocol '+active,async()=>{
 protocolActive=active;const r=await execute('crm_create_task',{interactive:{kind},approvedConfirmations:['0123456789abcdef'],
  document:{kind:'pdf',mimeType:'application/pdf',fileName:'neutral.pdf',base64:'JVBERi0='}},'Please be brief.');
 assert.equal(r.response.status,200);assert.equal(bodies.length,0);assert.equal(threadReads,0);
 assert.ok(!r.rec.rpc.some(c=>c.name==='record_paige_memory'||c.name==='paige_chat_interactive_acquire_bound'
  ||c.name==='paige_chat_interactive_settle'||c.name==='paige_chat_interactive_recover_bound'
  ||c.name==='paige_chat_interactive_executor_v2'&&c.args.p_operation!=='state'));
 assert.equal(r.rec.functions.length,0);assert.equal(r.rec.inserts.length,0);assert.equal(held,true);assert.equal(executor,null);
 if(kind==='stop')assert.equal(r.rec.rpc.find(c=>c.name==='paige_chat_interactive_begin_v2').args.p_stop,true);
 else assert.ok(!r.rec.rpc.some(c=>c.name==='paige_chat_interactive_begin_v2'));
});
protocolActive=true;
for(const state of ['accepted',null,'error'])await check('malformed or uncertain native Stop '+state+' cannot fall through to work',async()=>{
 stopResult=state;const r=await execute('crm_create_task',{interactive:{kind:'stop'}},'Please be brief.');
 assert.equal(r.response.status,409);assert.ok(r.wire.includes('INTERACTIVE_ACCEPTANCE_UNKNOWN'));assert.equal(bodies.length,0);
 assert.ok(!r.rec.rpc.some(c=>/acquire_bound|record_paige_memory|interactive_settle/.test(c.name)));
 assert.equal(r.rec.functions.length,0);assert.equal(r.rec.inserts.length,0);assert.equal(held,true);
});
stopResult='stopped';
await check('stored-row fixtures default only genuinely omitted native columns',async()=>{
 const row={id:thread,tenant_id:tenant,caller_user_id:actor};fake.setScenario({tables:{paige_chat_threads:[row]}});
 const {data}=await fake.createClient('https://test.supabase.co','anon-key').from('paige_chat_threads').select('*').maybeSingle();
 assert.equal(data.audience,'workspace');assert.equal(data.interactive_recovery_hold,null);
 assert.ok(!Object.hasOwn(row,'audience'));assert.ok(!Object.hasOwn(row,'interactive_recovery_hold'));
});
for(const value of [undefined,[],false])await check('stored-row fixture preserves explicit invalid native columns '+typeof value,async()=>{
 fake.setScenario({tables:{paige_chat_threads:[{id:thread,audience:value,interactive_recovery_hold:value}]}});
 const {data}=await fake.createClient('https://test.supabase.co','anon-key').from('paige_chat_threads').select('*').maybeSingle();
 assert.equal(data.audience,value);assert.equal(data.interactive_recovery_hold,value);
});
await check('fixture defaults never replace response projections, private audience, missing or unrelated rows',async()=>{
 const client=fake.createClient('https://test.supabase.co','anon-key');
 fake.setScenario({tables:{paige_chat_threads:()=>[{id:thread}]}});
 let {data}=await client.from('paige_chat_threads').select('*').maybeSingle();assert.ok(!Object.hasOwn(data,'audience'));assert.ok(!Object.hasOwn(data,'interactive_recovery_hold'));
 fake.setScenario({tables:{paige_chat_threads:[{id:thread,tenant_id:id(99),audience:'customer_private'}]}});
 ({data}=await client.from('paige_chat_threads').select('*').maybeSingle());assert.equal(data.audience,'customer_private');assert.equal(data.tenant_id,id(99));
 fake.setScenario({tables:{paige_chat_threads:[],other:[{id:thread}]}});
 ({data}=await client.from('paige_chat_threads').select('*').maybeSingle());assert.equal(data,null);
 ({data}=await client.from('other').select('*').maybeSingle());assert.deepEqual(data,{id:thread});
});
console.log(`${failed?'FAIL':'PASS'} ${passed} actual-handler cases / ${failed} failed; all provider/native ports recorded doubles`);
if(failed)process.exitCode=1;
