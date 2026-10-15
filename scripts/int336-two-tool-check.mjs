import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key'})[k]??''}};
const unknownTool=process.env.INT336_UNKNOWN_TOOL;
const recoveryMode=process.env.PLANNING_RECOVERY;
if(recoveryMode)assert.ok(['lost','gateway','missing-readback','refused'].includes(recoveryMode));
const knowledgeMode=process.env.KNOWLEDGE_INGEST_TEST;
if(knowledgeMode){assert.ok(['success','uncertain','refused','partial'].includes(knowledgeMode));assert.ok(!recoveryMode&&!unknownTool);}
const automationMode=process.env.AUTOMATION_DRAFT_TEST;
if(automationMode){assert.ok(['success','uncertain','refused'].includes(automationMode));assert.ok(!knowledgeMode&&!recoveryMode&&!unknownTool);}
const researchMode=process.env.RESEARCH_READBACK_TEST;
if(researchMode){assert.ok(['success','partial-library','unconfirmed'].includes(researchMode));assert.ok(!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const crmMode=process.env.CRM_ACK_TEST;
if(crmMode){assert.ok(['success','malformed','contradictory','refused'].includes(crmMode));assert.ok(!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const bookingMode=process.env.BOOKING_READBACK_TEST;
if(bookingMode){assert.ok(['success','missing-id','missing-row','foreign-row','transport','refused','no-approval','role-denied'].includes(bookingMode));assert.ok(!crmMode&&!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const bookingArgs={title:'Fixture appointment',start_at:'2026-11-10T15:00:00Z',end_at:'2026-11-10T15:30:00Z',timezone:'UTC'};
const researchRequests=[];
const researchFixture=()=>({run_id:id(11),question:'Fixture public question',findings:[{text:'Fixture cited finding',citations:[1],confidence:'high'}],
 sources:[{index:1,url:'https://example.com/source',title:'Fixture source',snippet:'Source text',reliability_score:.9,tier:'T1',reliability:'high',excluded:false,published_at:null,fetched_at:'2026-10-15T16:00:00Z'}],
 coverage:{configured:true,stop_reason:'answered',hops_used:1,searches:1,reads:1,note:''}});
const draftArgs={name:'Fixture process',trigger_key:'contact.created',steps:[{action_kind:'crm.advance_journey_stage',config:{stage:'review'}}]};
const ingestRequests=[];
let modelCalls=0;
globalThis.fetch=async(url,opts)=>{
 if(String(url)==='https://test.supabase.co/functions/v1/paige-deep-research'){
  researchRequests.push(JSON.parse(opts.body));
  return Response.json(researchMode==='unconfirmed'?{error:'fixture private provider failure'}:researchFixture(),{status:researchMode==='unconfirmed'?503:200});
 }
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
 for(let i=0;i<(bookingMode&&bookingMode!=='no-approval'?1:2);i++){
  const name=i===0&&bookingMode==='no-approval'?'calendar_book_meeting':i===0&&crmMode?'crm_create_task':i===0&&researchMode?'deep_research':i===0&&automationMode?'automation_draft':i===0&&knowledgeMode?'save_to_knowledge_base':'plan_create';
  const args=name==='calendar_book_meeting'?bookingArgs
   :name==='crm_create_task'?{title:'Protected CRM fixture'}:name==='deep_research'?{question:'Fixture public question',expected_tenant_id:'ignored-model-scope'}
   :name==='automation_draft'?{...draftArgs,...(automationMode==='refused'?{steps:Array.from({length:21},()=>draftArgs.steps[0])}:{})}
   :name==='save_to_knowledge_base'?{title:'Fixture reference',content:'Private fixture content'}
   :{title:`Plan ${knowledgeMode||automationMode||researchMode||crmMode||bookingMode?0:i}`,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12'};
  events.push({type:'content_block_start',index:i,content_block:{type:'tool_use',id:`tool-${i}`,name}},{type:'content_block_delta',index:i,delta:{type:'input_json_delta',partial_json:JSON.stringify(args)}});
 }
 events.push({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}},{type:'message_stop'});
 return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
};
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);let latest=intent,executor=null;const receipts=[];
// Booking is high-risk: exercise the incumbent stored-argument approval resume,
// never a fake model `confirm:true` or a policy clamp override.
const {confirmFingerprint}=await import('../supabase/functions/_shared/confirm-fingerprint.ts');
const bookingBare=bookingMode?await confirmFingerprint('calendar_book_meeting',{intent:await confirmFingerprint('calendar_book_meeting',bookingArgs),tenant,thread,client:null}):null;
const bookingFp=bookingBare+':'+id(9);
const bookingDoor={tool_name:'calendar_book_meeting',args:bookingArgs,fingerprint:bookingBare,issued_in_request:id(9),server_issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),consumed_at:null};
const bookingApproved=bookingMode&&bookingMode!=='no-approval';
const bookingTurns=bookingApproved?[{id:id(14),role:'user',content:'Book the exact fixture appointment'},
 {id:id(15),role:'assistant',content:'Approval is needed.',bundle_ref:{paige_confirm:[{tool:'calendar_book_meeting',fingerprint:bookingFp,...bookingArgs}],turn_state:{state:'WAIT_APPROVAL'}}}]:[];
const project=(row,filters)=>{const columns=filters.find(f=>f[0]==='select')?.[1];return columns?Object.fromEntries(columns.split(',').map(k=>[k,row[k]])):row;};
const rec=fake.setScenario({authUser:{id:actor},tables:{
 profiles:[{active_tenant_id:tenant}],tenant_members:[{tenant_id:tenant,...(bookingMode?{role:bookingMode==='role-denied'?'member':'owner',status:'active'}:{})}],
 paige_pending_confirmations:bookingApproved?[bookingDoor]:[],
 internal_bookings:bookingMode==='missing-row'?[]:[{id:id(12),tenant_id:bookingMode==='foreign-row'?id(13):tenant,host_user_id:actor,contact_id:null,
  title:'Fixture appointment',start_at:'2026-11-10T15:00:00+00:00',end_at:'2026-11-10T15:30:00+00:00',timezone:'UTC',status:'scheduled',notes:null,location:null,guest_name:null,guest_email:null}],
 plans:recoveryMode==='missing-readback'?[]:[{id:id(7),tenant_id:tenant,created_by:actor,owner_user_id:actor,
  title:'Plan 0',summary:null,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12',scope:'individual',
  campaign_ref:null,status:'active',updated_at:'2026-10-06T12:00:00Z'}],
 paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],
 paige_chat_turns:filters=>unknownTool && filters.some(f=>f[0]==="contains")?[{bundle_ref:{interactive:{effects:[{tool:unknownTool,outcome:"outcome_unknown"}]}}}]:filters.some(f=>f[0]==='contains')?receipts:[...bookingTurns,...receipts]
 ,paige_automation_triggers:[{key:'contact.created',is_live:true,dark_reason:null}],
 paige_automations:filters=>{
  const inserted=rec.inserts.find(r=>r.table==='paige_automations'&&!r.update)?.row;
  return inserted?[project({...inserted,id:id(10),updated_at:rec.inserts.some(r=>r.table==='paige_automation_acts')?'2026-10-15T16:00:01Z':'2026-10-15T16:00:00Z'},filters)]:[];
 },
 paige_automation_acts:filters=>automationMode==='uncertain'?[]:(rec.inserts.find(r=>r.table==='paige_automation_acts')?.row??[]).map(r=>project(r,filters)),
},functions:{'crm-command':()=>crmMode==='contradictory'
 ?{data:null,error:{name:'FunctionsHttpError',context:{status:500,json:async()=>({ok:true,outcome:'executed'})}}}
 :{data:crmMode==='malformed'?{success:true,not_applied:true,refused_before_run:true}:crmMode==='refused'?{ok:false,code:'CRM_FORBIDDEN'}:{ok:true,outcome:'executed'},error:null}},rpcs:{
 current_user_tenant_id:{data:tenant,error:null},
 is_tenant_admin_as:{data:!!bookingMode&&bookingMode!=='role-denied',error:null},agency_can_manage_child:{data:false,error:null},
 create_internal_booking:()=>{
  if(bookingMode==='transport')throw new TypeError('Failed to fetch after booking commit');
  if(bookingMode==='refused')return {data:null,error:{code:'42501',message:'BOOKING_FORBIDDEN'}};
  return {data:bookingMode==='missing-id'?null:id(12),error:null};
 },
 paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},
 resolve_tool_autonomy:{data:"auto",error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},
 resolve_tool_autonomy_many:{data:[{tool_key:"plan_create",mode:"auto",ceiling_allows_auto:true}],error:null},
 resolve_automation_autonomy:{data:{found:true,effective:'confirm',dark:[],state:'draft',granted:'confirm',would_run:false},error:null},
 get_workspace_research_run:()=>{const r=researchFixture();return {data:{id:r.run_id,question:r.question,domain:'general',caller:'chat',
  configured:true,stop_reason:'answered',coverage:r.coverage,findings:r.findings,sources:researchMode==='partial-library'?[]:r.sources},error:null};},
 get_actor_access:{data:{tier:'tenant'},error:null},
 get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},
 paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:id(5)},error:null},
 paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire')executor=intent;if(a.p_operation==='release')executor=null;return {data:{latest,executor,acquired:true,terminal:receipts.length>0},error:null};},
 plan_create:()=>{
  if(recoveryMode==='lost')throw new TypeError('Failed to fetch after commit');
  if(recoveryMode==='gateway')return {data:null,error:{code:'',message:'gateway timed out'}};
  if(recoveryMode==='refused')return {data:null,error:{code:'42501',message:'PLAN_FORBIDDEN'}};
  if(!recoveryMode&&!automationMode&&!researchMode&&!crmMode&&!bookingMode)latest=id(6);
  return {data:{ok:true,plan_id:id(7)},error:null};
 },
 paige_chat_interactive_settle:a=>{receipts.push({role:"assistant",content:a.p_content,bundle_ref:a.p_bundle_ref});return {data:id(8),error:null};}
}});
const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:bookingApproved?'Approve the exact stored appointment':'Create two individual plans'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'},...(bookingApproved?{approvedConfirmations:[bookingFp]}:{})})}));
const wire=await response.text();
if(bookingMode){
 const calls=rec.rpc.filter(c=>c.name==='create_internal_booking');
 if(['no-approval','role-denied'].includes(bookingMode)){
  assert.equal(calls.length,0,'missing approval or owner authority never reaches the native booking');
  assert.equal(rec.from.filter(c=>c.table==='internal_bookings').length,0);
  assert.equal(rec.rpc.filter(c=>c.name==='record_capability_run'&&c.args._capability_key==='calendar_book_meeting').length,0,'no execution receipt for an unattempted booking');
  assert.equal(receipts.length,1,'one canonical terminal settlement');
  if(bookingMode==='no-approval')assert.ok(receipts[0].bundle_ref.paige_confirm?.some(c=>c.tool==='calendar_book_meeting'),'native confirmation is requested');
  else assert.ok(receipts[0].bundle_ref.paige_resume?.outcomes.some(o=>o.tool==='calendar_book_meeting'&&o.outcome==='not_run'),'stored approval cannot override workspace authority; durable closed verdict is not_run');
  console.log(`PASS actual handler booking ${bookingMode}: native execution held by the existing approval/role policy`);process.exit(0);
 }
 assert.equal(calls.length,1,'one native booking call, no blind retry');assert.equal(calls[0].client,'jwt');
 assert.equal(calls[0].args._tenant_id,tenant);assert.equal(calls[0].args._title,'Fixture appointment');
 const reads=rec.from.filter(c=>c.table==='internal_bookings');
 const readAttempted=['success','missing-row','foreign-row'].includes(bookingMode);
 assert.equal(reads.length,readAttempted?1:0);
 if(readAttempted){assert.ok(reads[0].filters.some(f=>f[0]==='eq'&&f[1]==='id'&&f[2]===id(12)));assert.ok(reads[0].filters.some(f=>f[0]==='eq'&&f[1]==='tenant_id'&&f[2]===tenant));}
 const unknown=!['success','refused'].includes(bookingMode);
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,unknown?0:1,wire);
 assert.equal(receipts.length,1,'one canonical durable terminal receipt');
 const effect=receipts[0].bundle_ref.interactive.effects.find(e=>e.tool==='calendar_book_meeting');
 assert.ok(effect,'attempted booking is retained');
 // The incumbent CRM recorder conservatively classifies any post-dispatch
 // native throw as unknown, including an answered SQL refusal. Preserve it.
 assert.equal(effect.outcome,bookingMode==='success'?'reported_success':'outcome_unknown');
 assert.equal((effect.record_refs??[]).some(r=>r.kind==='booking'&&r.id===id(12)),bookingMode==='success','only a verified native record becomes a durable booking reference');
 const run=rec.rpc.find(c=>c.name==='record_capability_run'&&c.args._capability_key==='calendar_book_meeting');
 assert.ok(run,'existing capability recorder is invoked');assert.equal(run.client,'service');assert.equal(run.args._tenant_id,tenant);assert.equal(run.args._actor_id,actor);
 assert.equal(run.args._outcome,bookingMode==='success'?'capability_succeeded':'capability_outcome_unknown','incumbent conservative recorder classification remains');
 if(unknown){assert.equal(receipts[0].bundle_ref.interactive.effects.length,1);assert.equal(rec.inserts.filter(c=>c.table==='paige_audit_log'&&c.row.action==='plan_create').length,0,'held successor has no write attribution');}
 console.log(`PASS actual handler booking ${bookingMode}: caller-JWT native call once, scoped verified reference, canonical settlement and capability recorder, correct successor hold`);
 process.exit(0);
}
if(crmMode){
 const calls=rec.functions.filter(c=>c.name==='crm-command');
 assert.equal(calls.length,1,'the original native CRM operation is invoked once, never retried');
 assert.equal(calls[0].client,'jwt');assert.equal(calls[0].options.headers.Authorization,'Bearer test');
 assert.equal(calls[0].options.body.command.action,'task.create');
 const unknown=['malformed','contradictory'].includes(crmMode);
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,unknown?0:1,wire);
 assert.equal(receipts.length,1,'one canonical durable terminal receipt');
 const effect=receipts[0].bundle_ref.interactive.effects.find(e=>e.tool==='crm_create_task');
 assert.ok(effect,'the original attempted native action remains represented');
 assert.equal(effect.outcome,unknown?'outcome_unknown':crmMode==='refused'?'reported_failure':'reported_success');
 if(unknown){
  assert.equal(receipts[0].bundle_ref.interactive.effects.length,1,'blocked successor is not an executed effect');
  assert.equal(rec.inserts.filter(c=>c.table==='paige_audit_log'&&c.row.action==='plan_create').length,0,'blocked successor has no execution attribution');
 }
 console.log(`PASS actual handler CRM acknowledgement ${crmMode}: caller-JWT native door once, truthful effect, canonical settlement and correct successor brake`);
 process.exit(0);
}
if(researchMode){
 assert.equal(researchRequests.length,1,'one incumbent invocation; no blind research retry');
 assert.equal(researchRequests[0].user_id,actor);assert.equal(researchRequests[0].expected_tenant_id,tenant);assert.equal(researchRequests[0].persist,true);
 assert.equal(receipts.length,1,'one canonical terminal receipt');
 const bundle=receipts[0].bundle_ref,effect=bundle.interactive.effects.find(e=>e.tool==='deep_research');
 assert.equal(effect.outcome,researchMode==='unconfirmed'?'outcome_unknown':'reported_success');
 if(researchMode!=='unconfirmed'){
  assert.equal((effect.record_refs??[]).some(r=>r.kind==='research_run'&&r.id===id(11)),researchMode==='success','durable record identity requires complete native readback');
  assert.equal(bundle.paige_research[0].saved,researchMode==='success','library availability needs matching run and sources');
  assert.equal(bundle.paige_research[0].run_id,id(11));assert.ok(!('sources' in bundle.paige_research[0]),'durable reference only');
 }
 assert.ok(!wire.includes('fixture private provider failure'));
 console.log(`PASS actual handler Research ${researchMode}: server workspace/actor, native invocation, complete library verdict, canonical scoped run reference, bounded failure`);
 process.exit(0);
}
if(automationMode){
 const drafts=rec.inserts.filter(r=>r.table==='paige_automations'&&!r.update),acts=rec.inserts.filter(r=>r.table==='paige_automation_acts');
 assert.equal(drafts.length,automationMode==='refused'?0:1,'one native draft insert; never retry by name');
 assert.equal(acts.length,automationMode==='refused'?0:1,'one exact native acts insert');
 if(drafts.length){assert.equal(drafts[0].row.tenant_id,tenant);assert.equal(drafts[0].row.created_by,actor);assert.equal(drafts[0].row.granted_lane,'confirm');assert.equal(drafts[0].row.state,'draft');}
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,automationMode==='uncertain'?0:1,wire);
 assert.equal(receipts.length,1,'one durable canonical terminal receipt');
 const effect=receipts[0].bundle_ref.interactive.effects.find(e=>e.tool==='automation_draft');
 assert.equal(effect.outcome,automationMode==='uncertain'?'outcome_unknown':automationMode==='refused'?'reported_failure':'reported_success');
 if(automationMode!=='refused')assert.ok(effect.record_refs.some(r=>r.kind==='automation'&&r.id===id(10)));
 assert.ok(!rec.inserts.some(r=>r.table==='paige_act_executions'),'draft configuration is not an execution');
 console.log(`PASS actual handler automation draft ${automationMode}: native actor/workspace/configuration, canonical record receipt, correct successor hold; no execution`);
 process.exit(0);
}
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
 if(knowledgeMode==='uncertain'){
  assert.equal(receipts[0].bundle_ref.interactive.effects.length,1,'blocked successor is not an executed effect');
  assert.equal(rec.inserts.filter(c=>c.table==='paige_audit_log'&&c.row.action==='plan_create').length,0,'blocked successor has no write attribution');
 }
 console.log(`PASS actual handler Knowledge ${knowledgeMode}: caller/workspace/private binding, native truth, durable document reference and correct successor brake`);
 process.exit(0);
}
if(recoveryMode){
 assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,recoveryMode==='refused'?2:1,wire);
 assert.equal(receipts.length,1,'one canonical terminal receipt');
 assert.equal(receipts[0].bundle_ref.interactive.effects[0].outcome,recoveryMode==='refused'?'reported_failure':'outcome_unknown');
 assert.equal(modelCalls,2,'normal explanation remains possible after refusal/uncertainty');
 if(recoveryMode!=='refused'){
  assert.equal(receipts[0].bundle_ref.interactive.effects.length,1,'blocked successor is not an execution effect');
  assert.equal(receipts[0].bundle_ref.interactive.effects[0].outcome,'outcome_unknown');
  const audit=rec.inserts.filter(c=>c.table==='paige_audit_log'&&c.row.action==='plan_create');
  assert.equal(audit.length,1,'never attribute a blocked successor as an attempted write');
  assert.equal(audit[0].row.payload.outcome,'outcome_unknown');
 }
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
