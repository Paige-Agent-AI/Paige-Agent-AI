import assert from 'node:assert/strict';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key'})[k]??''}};
const unknownTool=process.env.INT336_UNKNOWN_TOOL;
const recoveryMode=process.env.PLANNING_RECOVERY;
if(recoveryMode)assert.ok(['lost','gateway','missing-readback','refused'].includes(recoveryMode));
const knowledgeMode=process.env.KNOWLEDGE_INGEST_TEST;
if(knowledgeMode){assert.ok(['success','uncertain','refused','partial','unrecorded'].includes(knowledgeMode));assert.ok(!recoveryMode&&!unknownTool);}
const automationMode=process.env.AUTOMATION_DRAFT_TEST;
if(automationMode){assert.ok(['success','uncertain','refused'].includes(automationMode));assert.ok(!knowledgeMode&&!recoveryMode&&!unknownTool);}
const researchMode=process.env.RESEARCH_READBACK_TEST;
if(researchMode){assert.ok(['success','partial-library','unconfirmed'].includes(researchMode));assert.ok(!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const crmMode=process.env.CRM_ACK_TEST;
if(crmMode){assert.ok(['success','malformed','contradictory','refused'].includes(crmMode));assert.ok(!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const bookingMode=process.env.BOOKING_READBACK_TEST;
if(bookingMode){assert.ok(['success','missing-id','missing-row','foreign-row','transport','refused','no-approval','role-denied'].includes(bookingMode));assert.ok(!crmMode&&!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const crmScopeMode=process.env.CRM_SCOPE_TEST;
if(crmScopeMode){assert.ok(['normal-flip','pinned-flip','normal-same','pinned-same','null-scope','member-refused','native-no-tenant'].includes(crmScopeMode));assert.ok(!bookingMode&&!crmMode&&!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const crmPauseMode=process.env.CRM_APPROVAL_PAUSE_TEST;
if(crmPauseMode){assert.ok(['normal','kill','prior-success','following-unknown','protected-flip','settle-fails','commit-lost-ack','disconnect'].includes(crmPauseMode));assert.ok(!crmScopeMode&&!bookingMode&&!crmMode&&!researchMode&&!automationMode&&!knowledgeMode&&!recoveryMode&&!unknownTool);}
const pauseRows=[];
const crmScopePinned=crmScopeMode?.startsWith('pinned-');
const crmScopeModelBodies=[];
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
   :{ok:true,doc_id:'00000000-0000-4000-8000-000000000009',chunk_count:1,embedded:knowledgeMode!=='partial',
    ...(knowledgeMode==='unrecorded'?{tenant_id:tenant,verified:true,railRecorded:false,outcome:'capability_completed_unrecorded',run_id:'00000000-0000-4000-8000-000000000010'}:{})},
   {status:knowledgeMode==='uncertain'?400:knowledgeMode==='refused'?403:200});
 }
 if(!String(url).includes('api.anthropic.com')) return new Response('{}',{status:503});
 const body=JSON.parse(opts.body);
 if(body.system?.startsWith('You label one message sent to PAIGE'))return Response.json({content:[{type:'text',text:JSON.stringify({intent:crmPauseMode?'act':'answer',research:'none',difficulty:'routine',image:'none',needs_workspace_data:true,confidence:.9})}],usage:{input_tokens:1,output_tokens:1}});
 modelCalls++;
 if(crmPauseMode==='kill'&&modelCalls>1){
  console.error(JSON.stringify({boundary:'native proposal -> next provider',pending:pauseRows.length,canonicalTerminals:receipts.length,executorHeld:executor===intent}));
  // Deliberately terminate the actual handler process: a throw would run its catch/finally.
  // The parent command records this exit. This is not a hosted CPU-limit/native-SQL proof.
  process.exit(86);
 }
 if(crmScopeMode)crmScopeModelBodies.push(body);
 if(modelCalls>1||crmScopePinned)return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Readback is required."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
 const events=[{type:'message_start',message:{usage:{input_tokens:1}}}];
 for(let i=0;i<(crmPauseMode?(['prior-success','following-unknown'].includes(crmPauseMode)?2:1):crmScopeMode||bookingMode&&bookingMode!=='no-approval'?1:2);i++){
  const name=crmPauseMode?(crmPauseMode==='prior-success'&&i===0||crmPauseMode==='following-unknown'&&i===1?'plan_create':'crm_create_task'):i===0&&bookingMode==='no-approval'?'calendar_book_meeting':i===0&&(crmMode||crmScopeMode)?'crm_create_task':i===0&&researchMode?'deep_research':i===0&&automationMode?'automation_draft':i===0&&knowledgeMode?'save_to_knowledge_base':'plan_create';
  const args=name==='calendar_book_meeting'?bookingArgs
   :name==='crm_create_task'?(crmScopeMode||crmPauseMode?{patch:{title:'Protected CRM fixture'}}:{title:'Protected CRM fixture'}):name==='deep_research'?{question:'Fixture public question',expected_tenant_id:'ignored-model-scope'}
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
const chatHandler=capturedHandler();
let crmHandler;
if(crmScopeMode||crmPauseMode){await import('../supabase/functions/crm-command/index.ts');crmHandler=capturedHandler();assert.notEqual(crmHandler,chatHandler,'the fixture invokes the actual native CRM handler');}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4);let latest=intent,executor=null;const receipts=[];
// Booking is high-risk: exercise the incumbent stored-argument approval resume,
// never a fake model `confirm:true` or a policy clamp override.
const {confirmFingerprint}=await import('../supabase/functions/_shared/confirm-fingerprint.ts');
const {canonicalizeCrmCommand,crmApprovalSubject}=await import('../supabase/functions/_shared/crm-command/catalog.ts');
const crmScopeTenant=crmScopeMode==='null-scope'?null:tenant;
let crmActiveTenant=crmScopeTenant;
const crmScopeCommand=canonicalizeCrmCommand({action:'task.create',patch:{title:'Protected CRM fixture'}});
const crmScopeArgs={command:crmScopeCommand,idempotency_key:'scope-stored-key',approval_subject:await crmApprovalSubject('task.create',crmScopeCommand)};
const crmScopeFp=crmScopePinned?await confirmFingerprint('crm_create_task',crmScopeArgs):null;
const crmScopeRow={user_id:actor,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:'crm_create_task',args:crmScopeArgs,fingerprint:crmScopeFp,
 issued_in_request:id(16),server_issued_at:'2026-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',consumed_at:null};
const crmScopeTurns=crmScopePinned?[{id:id(17),role:'assistant',content:'Approve the fixture task.',bundle_ref:{paige_confirm:[{tool:'crm_create_task',fingerprint:crmScopeFp}],turn_state:{state:'WAIT_APPROVAL'}}}]:[];
const crmScopeAnswers=[];
// Honour the native door's real claim filters over this one stored approval; no alternate executor.
const crmScopeTable=filters=>{
 if(crmPauseMode){
  const op=rec.from.at(-1)?.op;
  if(op==='insert'){
   const inserted=rec.inserts.filter(r=>r.table==='paige_pending_confirmations'&&!r.update).at(-1)?.row;
   if(inserted&&!pauseRows.some(row=>row.fingerprint===inserted.fingerprint))pauseRows.push({id:id(30),expires_at:'2099-01-01T00:00:00Z',consumed_at:null,...inserted});
  }
  return pauseRows.filter(row=>filters.every(([op,col,value])=>op==='eq'?row[col]===value:op==='neq'?row[col]!=null&&row[col]!==value
   :op==='is'?value===null?row[col]==null:row[col]===value:op==='not'&&value==='is'?row[col]!=null
   :op==='gt'?row[col]>value:op==='lte'?row[col]<=value:op==='in'?value.includes(row[col]):true));
 }
 if(!crmScopePinned)return [];
 const hit=filters.every(([op,col,value])=>op==='eq'?crmScopeRow[col]===value:op==='neq'?crmScopeRow[col]!=null&&crmScopeRow[col]!==value
  :op==='is'?value===null?crmScopeRow[col]==null:crmScopeRow[col]===value:op==='not'&&value==='is'?crmScopeRow[col]!=null
  :op==='in'?value.includes(crmScopeRow[col]):op==='gt'?crmScopeRow[col]>value:op==='gte'?crmScopeRow[col]>=value:op==='lte'?crmScopeRow[col]<=value:true);
 if(!hit)return [];
 if(rec.from.at(-1)?.op==='update')Object.assign(crmScopeRow,rec.inserts.filter(r=>r.table==='paige_pending_confirmations'&&r.update).at(-1)?.row);
 return [project(crmScopeRow,filters)];
};
const bookingBare=bookingMode?await confirmFingerprint('calendar_book_meeting',{intent:await confirmFingerprint('calendar_book_meeting',bookingArgs),tenant,thread,client:null}):null;
const bookingFp=bookingBare+':'+id(9);
const bookingDoor={tool_name:'calendar_book_meeting',args:bookingArgs,fingerprint:bookingBare,issued_in_request:id(9),server_issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),consumed_at:null};
const bookingApproved=bookingMode&&bookingMode!=='no-approval';
const bookingTurns=bookingApproved?[{id:id(14),role:'user',content:'Book the exact fixture appointment'},
 {id:id(15),role:'assistant',content:'Approval is needed.',bundle_ref:{paige_confirm:[{tool:'calendar_book_meeting',fingerprint:bookingFp,...bookingArgs}],turn_state:{state:'WAIT_APPROVAL'}}}]:[];
const project=(row,filters)=>{const columns=filters.find(f=>f[0]==='select')?.[1];return columns&&columns!=='*'?Object.fromEntries(columns.split(',').map(k=>[k,row[k]])):row;};
const rec=fake.setScenario({authUser:{id:actor},tables:{
 profiles:()=>[{active_tenant_id:crmScopeMode||crmPauseMode?crmActiveTenant:tenant}],tenant_members:crmScopeMode||crmPauseMode?filters=>[tenant,id(18)].map(tenant_id=>({tenant_id,user_id:actor,role:crmScopeMode==='member-refused'?'member':'owner',status:'active'})).filter(row=>filters.every(([op,col,value])=>op!=='eq'||row[col]===value)):[{tenant_id:tenant,...(bookingMode?{role:bookingMode==='role-denied'?'member':'owner',status:'active'}:{})}],
 tenants:crmScopeMode||crmPauseMode?[{account_number:1001,account_type:'standalone',parent_tenant_id:null}]:[],
 paige_pending_confirmations:crmScopeMode||crmPauseMode?crmScopeTable:bookingApproved?[bookingDoor]:[],
 internal_bookings:bookingMode==='missing-row'?[]:[{id:id(12),tenant_id:bookingMode==='foreign-row'?id(13):tenant,host_user_id:actor,contact_id:null,
  title:'Fixture appointment',start_at:'2026-11-10T15:00:00+00:00',end_at:'2026-11-10T15:30:00+00:00',timezone:'UTC',status:'scheduled',notes:null,location:null,guest_name:null,guest_email:null}],
 plans:recoveryMode==='missing-readback'?[]:[{id:id(7),tenant_id:tenant,created_by:actor,owner_user_id:actor,
  title:'Plan 0',summary:null,horizon:'week',starts_on:'2026-10-06',ends_on:'2026-10-12',scope:'individual',
  campaign_ref:null,status:'active',updated_at:'2026-10-06T12:00:00Z'}],
 paige_chat_threads:[{id:thread,tenant_id:tenant,caller_user_id:actor}],
 paige_chat_turns:filters=>unknownTool && filters.some(f=>f[0]==="contains")?[{bundle_ref:{interactive:{effects:[{tool:unknownTool,outcome:"outcome_unknown"}]}}}]:filters.some(f=>f[0]==='contains')?receipts:[...bookingTurns,...crmScopeTurns,...receipts]
 ,paige_automation_triggers:[{key:'contact.created',is_live:true,dark_reason:null}],
 paige_automations:filters=>{
  const inserted=rec.inserts.find(r=>r.table==='paige_automations'&&!r.update)?.row;
  return inserted?[project({...inserted,id:id(10),updated_at:rec.inserts.some(r=>r.table==='paige_automation_acts')?'2026-10-15T16:00:01Z':'2026-10-15T16:00:00Z'},filters)]:[];
 },
 paige_automation_acts:filters=>automationMode==='uncertain'?[]:(rec.inserts.find(r=>r.table==='paige_automation_acts')?.row??[]).map(r=>project(r,filters)),
},functions:{'crm-command':async options=>{
 if(crmScopeMode||crmPauseMode){
  // Switch only AFTER Chat has finished every pre-dispatch check and handed off its request.
  if(crmScopeMode?.endsWith('-flip'))crmActiveTenant=id(18);
  if(crmScopeMode==='native-no-tenant')crmActiveTenant=null;
  const nativeReads=rec.from.length,nativeWrites=rec.inserts.length;
  const native=await crmHandler(new Request('https://test.supabase.co/functions/v1/crm-command',{method:'POST',headers:{'Content-Type':'application/json',...options.headers},body:JSON.stringify(options.body)}));
  const answer=await native.json();crmScopeAnswers.push({status:native.status,body:answer,membershipReads:rec.from.slice(nativeReads).filter(r=>r.table==='tenant_members').length,confirmationWrites:rec.inserts.slice(nativeWrites).filter(r=>r.table==='paige_pending_confirmations').length});
  if(crmPauseMode==='protected-flip')crmActiveTenant=id(18);
  return native.ok?{data:answer,error:null}:{data:null,error:{name:'FunctionsHttpError',context:{status:native.status,json:async()=>answer}}};
 }
 return crmMode==='contradictory'
 ?{data:null,error:{name:'FunctionsHttpError',context:{status:500,json:async()=>({ok:true,outcome:'executed'})}}}
 :{data:crmMode==='malformed'?{success:true,not_applied:true,refused_before_run:true}:crmMode==='refused'?{ok:false,code:'CRM_FORBIDDEN'}:{ok:true,outcome:'executed'},error:null};
}},rpcs:{
 current_user_tenant_id:()=>({data:crmScopeMode||crmPauseMode?crmActiveTenant:tenant,error:null}),
 read_crm_command_result:{data:null,error:null},
 execute_crm_command:{data:{ok:true,outcome:'succeeded',readback:{id:id(19)}},error:null},
 is_tenant_admin_as:{data:!!bookingMode&&bookingMode!=='role-denied',error:null},agency_can_manage_child:{data:false,error:null},
 create_internal_booking:()=>{
  if(bookingMode==='transport')throw new TypeError('Failed to fetch after booking commit');
  if(bookingMode==='refused')return {data:null,error:{code:'42501',message:'BOOKING_FORBIDDEN'}};
  return {data:bookingMode==='missing-id'?null:id(12),error:null};
 },
 paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},check_rate_limit:{data:true,error:null},
 resolve_tool_autonomy:a=>({data:crmScopePinned||crmPauseMode&&JSON.stringify(a).includes('crm_')?'confirm':'auto',error:null}),resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},
 resolve_tool_autonomy_many:{data:[{tool_key:"plan_create",mode:"auto",ceiling_allows_auto:true}],error:null},
 resolve_automation_autonomy:{data:{found:true,effective:'confirm',dark:[],state:'draft',granted:'confirm',would_run:false},error:null},
 get_workspace_research_run:()=>{const r=researchFixture();return {data:{id:r.run_id,question:r.question,domain:'general',caller:'chat',
  configured:true,stop_reason:'answered',coverage:r.coverage,findings:r.findings,sources:researchMode==='partial-library'?[]:r.sources},error:null};},
 get_actor_access:{data:{tier:'tenant'},error:null},
 get_paige_persona_context:()=>({data:[{tenant_id:crmScopeMode||crmPauseMode?crmActiveTenant:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null}),
 paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:id(5)},error:null},
 paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire')executor=intent;if(a.p_operation==='release'){if(crmPauseMode)assert.ok(receipts.length,'native release requires a canonical terminal');executor=null;}return {data:{latest,executor,acquired:true,terminal:receipts.length>0},error:null};},
 plan_create:()=>{
  if(recoveryMode==='lost'||crmPauseMode==='following-unknown')throw new TypeError('Failed to fetch after commit');
  if(recoveryMode==='gateway')return {data:null,error:{code:'',message:'gateway timed out'}};
  if(recoveryMode==='refused')return {data:null,error:{code:'42501',message:'PLAN_FORBIDDEN'}};
  if(!recoveryMode&&!automationMode&&!researchMode&&!crmMode&&!bookingMode&&!crmScopeMode&&!crmPauseMode)latest=id(6);
  return {data:{ok:true,plan_id:id(7)},error:null};
 },
 paige_chat_interactive_settle:a=>{if(crmPauseMode==='settle-fails')return {data:null,error:{code:'08006',message:'fixture settlement unavailable'}};receipts.push({role:"assistant",content:a.p_content,bundle_ref:a.p_bundle_ref});return crmPauseMode==='commit-lost-ack'?{data:null,error:{code:'08006',message:'fixture committed acknowledgement lost'}}:{data:id(8),error:null};}
}});
const response=await chatHandler(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:crmScopePinned?'Approve the exact stored task':bookingApproved?'Approve the exact stored appointment':'Create two individual plans'}],...(crmScopeMode==='null-scope'?{}:{threadId:thread,requestIntentId:intent,interactive:{kind:'message'}}),...(bookingApproved?{approvedConfirmations:[bookingFp]}:{}),...(crmScopePinned?{approvedConfirmations:[crmScopeFp]}:{}),...(crmScopeMode?{sessionDocumentContext:[{fileName:'scope-fixture.txt',summary:'Private originating-workspace fixture'}]}:{})})}));
let wire='';
if(crmPauseMode){
 if(crmPauseMode==='disconnect'){
  const reader=response.body.getReader();await reader.read();await reader.cancel();
  const deadline=Date.now()+2000;while(executor!==null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 }else try{for await(const chunk of response.body){const text=new TextDecoder().decode(chunk);wire+=text;if(crmPauseMode!=='following-unknown'&&text.includes('"paige_confirm"')){assert.equal(receipts[0]?.bundle_ref.turn_state.state,'WAIT_APPROVAL','canonical WAIT_APPROVAL must precede the first approval frame');assert.equal(executor,null,'canonical pause must release before publishing approval');}}}
 catch(error){if(crmPauseMode!=='settle-fails')throw error;}
 assert.equal(pauseRows.length,1,`one real native proposal: ${JSON.stringify({modelCalls,native:crmScopeAnswers,calls:rec.functions,wire})}`);assert.equal(pauseRows[0].consumed_at,null,'a proposal never consumes approval');
 assert.equal(rec.rpc.filter(c=>c.name==='execute_crm_command').length,0,'requesting approval executes no CRM command');
 if(crmPauseMode==='settle-fails'){assert.equal(receipts.length,0);assert.equal(executor,intent);assert.ok(!wire.includes('"paige_confirm"'),'no actionable card without durable settlement');}
 else if(crmPauseMode==='protected-flip'){assert.equal(receipts[0].bundle_ref.turn_state.state,'INTERRUPTED');assert.ok(!wire.includes('"paige_confirm"'),'scope change withholds the card');}
 else if(crmPauseMode==='following-unknown'){
  assert.equal(receipts[0].bundle_ref.turn_state.state,'INTERRUPTED','an uncertain write must not settle as an ordinary approval pause');
  assert.ok(receipts[0].bundle_ref.interactive.effects.some(e=>e.outcome==='outcome_unknown'));
  assert.equal(rec.rpc.filter(c=>c.name==='plan_create').length,1,'uncertain work is not repeated');
  assert.equal(receipts.length,1,'the uncertain effect has one canonical settlement');
  assert.equal(executor,null,'existing native lifetime closes only after that settlement');
 }
 else{
  assert.equal(modelCalls,1,'native proposal must pause before another provider continuation');assert.equal(receipts.length,1);assert.equal(executor,null);
  const saved=receipts[0].bundle_ref;assert.equal(saved.turn_state.state,'WAIT_APPROVAL');assert.equal(saved.paige_confirm.length,1);
  assert.equal(saved.paige_confirm[0].fingerprint,pauseRows[0].fingerprint);assert.deepEqual(saved.paige_confirm[0].command,pauseRows[0].args.command);assert.equal(saved.paige_confirm[0].idempotency_key,pauseRows[0].args.idempotency_key);
  assert.ok(saved.interactive.effects.some(e=>e.outcome==='approval_required'));
  if(crmPauseMode==='prior-success')assert.ok(saved.interactive.effects.some(e=>e.outcome==='reported_success'&&e.record_refs?.some(r=>r.id===id(7))),'pause retains completed native work references');
 }
 console.log(`PASS actual Chat -> actual CRM durable approval pause ${crmPauseMode}; native SQL port synthetic; no provider/production proof`);process.exit(0);
}else wire=await response.text();
if(crmScopeMode){
 const calls=rec.functions.filter(c=>c.name==='crm-command'),executions=rec.rpc.filter(c=>c.name==='execute_crm_command');
 if(crmScopeMode==='null-scope'){
  assert.ok(modelCalls>=1,'the actual Chat handler reaches the CRM tool decision without a turn workspace');
  assert.equal(calls.length,0,'no turn workspace must fail closed before native CRM invocation');
  assert.equal(executions.length,0);assert.equal(crmScopeAnswers.length,0);
  const refusal=crmScopeModelBodies.flatMap(b=>b.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[])
   .filter(part=>part.type==='tool_result').map(part=>JSON.parse(part.content)).find(part=>part.error==='tenant_not_resolved');
  assert.ok(refusal?.not_applied&&refusal.refused_before_run,'PAIGE receives a truthful pre-dispatch scope refusal');
 }else{
  assert.equal(calls.length,1,'Chat invokes the actual native door exactly once');
  const refused=!crmScopeMode.endsWith('-same');
  assert.equal(crmScopeAnswers[0].status,refused?(crmScopeMode.endsWith('-flip')?409:403):200,JSON.stringify(crmScopeAnswers));
  if(crmScopeMode.endsWith('-flip')){
   assert.equal(crmScopeAnswers[0].body.code,'CRM_ACTIVE_ACCOUNT_CHANGED');
   assert.equal(crmScopeAnswers[0].membershipReads,0,'native scope mismatch precedes its own membership query');
   assert.equal(crmScopeAnswers[0].confirmationWrites,0,'native mismatch never claims or mints an approval');
  }
  if(crmScopeMode==='member-refused')assert.equal(crmScopeAnswers[0].body.code,'access_denied');
  if(crmScopeMode==='native-no-tenant')assert.equal(crmScopeAnswers[0].body.code,'CRM_TENANT_REQUIRED');
  assert.equal(calls[0].options.body.expected_tenant_id,tenant,'both CRM branches carry the original server scope, never a fresh active pointer');
  assert.equal(calls[0].client,'jwt');assert.equal(calls[0].options.headers.Authorization,'Bearer test');
  assert.equal(executions.length,refused?0:1);
  if(executions.length){assert.equal(executions[0].client,'service');assert.equal(executions[0].args._tenant_id,tenant);assert.equal(executions[0].args._actor_id,actor);}
  if(crmScopePinned){
   assert.equal(calls[0].options.body.approved_fingerprint,crmScopeFp);
   assert.deepEqual(calls[0].options.body.command,crmScopeCommand);assert.equal(calls[0].options.body.idempotency_key,crmScopeArgs.idempotency_key);
   assert.equal(crmScopeRow.consumed_at!==null,!refused,'a scope refusal preserves the original approval; same-workspace execution claims once');
  }
 }
 console.log(`PASS actual Chat/native CRM ${crmScopeMode}: frozen scope, native refusal/authority, stored arguments and no wrong-workspace execution`);
 process.exit(0);
}
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
 if(knowledgeMode==='unrecorded'){
  assert.equal(effect.run_id,id(10),'native operation identity retained');
  const actionSteps=wire.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{try{return [JSON.parse(line.slice(6)).paige_step]}catch{return []}}).filter(step=>step?.kind==='action');
  assert.ok(actionSteps.some(step=>step.status==='done'),'verified saved Knowledge is not a failed business act');
  assert.equal(actionSteps.some(step=>step.status==='error'),false,'missing activity record must not imply failed save');
  const audit=rec.inserts.filter(row=>row.table==='paige_audit_log'&&row.row.action==='save_to_knowledge_base');
  assert.equal(audit.length,1,'existing separate audit remains');
  assert.equal(audit[0].row.payload.outcome,'completed_unrecorded','audit must not turn verified data completion into failure');
 }
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
