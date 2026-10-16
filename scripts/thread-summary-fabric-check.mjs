import assert from 'node:assert/strict';
import {setScenario} from './client-memory-authz/fake-supabase.mjs';
import {capturedHandler} from './client-memory-authz/stub-serve.mjs';

// Incumbent handler/module-loader/SDK fixture. Real Fabric, adapters and budget;
// only transports and protected database ports are synthetic. No network/real key.
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',
 ANTHROPIC_API_KEY:'test-anthropic',OPENAI_API_KEY:'test-openai',OPENAI_CANARY_CLASSES:'operational'})[key]}};
await import('../supabase/functions/paige-ai-chat/index.ts');
const handler=capturedHandler(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),other=id(3),thread=id(4),intent=id(5);
let state;
const foldBody=body=>JSON.stringify(body).includes('Maintain a rolling memory');
const reply=(text,model='fixture-anthropic')=>Response.json({model,content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
const openReply=(text,model)=>Response.json({id:'fixture-response',model,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:1,output_tokens:1}});
globalThis.fetch=async(url,options)=>{
 const href=String(url);assert.match(href,/^https:\/\/api\.(?:anthropic|openai)\.com\//,'unexpected egress refused');
 const body=JSON.parse(options.body),provider=href.includes('openai')?'openai':'anthropic';
 if(foldBody(body)){
  state.folds.push({provider,body,signal:options.signal});
  if(state.options.afterProvider)state.current=other;
  if(state.options.afterProviderOwner)state.row.caller_user_id=id(99);
  if(state.options.failPrimary&&provider==='openai'){
   if(state.options.beforeFallback)state.current=other;
   return Response.json({error:{type:state.options.invalidPrimary?'invalid_request_error':'rate_limit_error',message:'synthetic'}},{status:state.options.invalidPrimary?400:429});
  }
  const text=state.options.empty?'':'Scoped rolling recollection';
  return provider==='openai'?openReply(text,body.model):reply(text,body.model);
 }
 if(!body.stream)return reply(JSON.stringify({intent:'converse',research:'none',difficulty:'trivial',image:'none',needs_workspace_data:false,confidence:.99}));
 state.mainBodies.push({provider,body,current:state.current,summaryReads:state.summaryReads});
 state.mainStreams++;
 return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ordinary reply."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
};
const matches=(row,filters)=>filters.every(([op,key,value])=>op==='eq'?row[key]===value:op==='is'?row[key]===value:true);
async function drive(options={}){
 const stamp='2026-10-15T12:00:00Z';
 state={options,current:tenant,folds:[],mainStreams:0,mainBodies:[],summaryReads:0,transcriptReads:0,summaryWrites:0,executor:null,
  row:{id:thread,caller_user_id:options.foreignActor?id(99):actor,tenant_id:options.foreignTenant?other:tenant,
   message_count:options.postOnly?14:15,summary:options.prior??null,summary_through_seq:0,last_compacted_at:null,title:'Fixture thread',studio_session_id:null},
  turns:Array.from({length:options.postOnly?14:15},(_,i)=>({role:i%2?'assistant':'user',content:`old scoped turn ${i+1}`,seq:i+1,created_at:stamp}))};
 const append=(role,content,bundle_ref)=>{state.turns.push({role,content,bundle_ref,seq:state.turns.length+1,created_at:new Date().toISOString()});state.row.message_count++;};
 const rec=setScenario({authUser:{id:actor},declaredActiveTenantId:tenant,
  tableErrors:{'paige_chat_threads:update':options.writeFail?{code:'42501',message:'synthetic write rejection'}:null},
  tables:{profiles:()=>[{user_id:actor,active_tenant_id:options.nullProfile?null:state.current}],user_roles:[],tenant_members:[{tenant_id:tenant,user_id:actor,role:'owner',status:'active'}],
   tenants:[{id:tenant,account_type:'standalone',account_number:101,parent_tenant_id:null}],
   paige_chat_threads:filters=>{
    const update=filters.find(([op])=>op==='update')?.[1];
    if(update){
     if(update.summary!==undefined&&options.casLost)state.row.summary_through_seq=8;
     if(!matches(state.row,filters))return [];
     Object.assign(state.row,update);if(update.summary!==undefined)state.summaryWrites++;
     return [{...state.row}];
    }
    const selection=filters.find(([op])=>op==='select')?.[1]??'';
    if(selection.startsWith('id, caller_user_id, tenant_id, message_count, summary')){
     state.summaryReads++;
     if(state.summaryReads===options.flipSummaryRead)state.current=other;
    }
    if(options.beforeTranscript&&selection.includes('message_count')&&selection.includes('summary'))state.current=other;
    // Inject a foreign/malformed SDK row deliberately; the real handler must reject
    // it even if a policy broadens. Positive cases obey real filter semantics.
    return options.foreignActor?[{...state.row}]:matches(state.row,filters)?[{...state.row}]:[];
   },
   paige_chat_turns:filters=>{
    if(filters.some(([op])=>op==='contains'))return [];
    const transcript=filters.some(([op,key])=>op==='gt'&&key==='seq');
    if(transcript){state.transcriptReads++;if(options.beforeProvider)state.current=other;}
    return state.turns.filter(row=>filters.every(([op,key,value])=>op==='gt'?row[key]>value:op==='eq'&&key==='role'?row[key]===value:true));
   }},
  serviceTables:{admin_app_settings:[{key:`llm_budget_daily_usd__t_${tenant}`,value:1}],
   paige_llm_trace:()=>{if(options.duringBudget)state.current=other;return options.budget?[{tenant_id:tenant,cost_estimate_usd:10,created_at:new Date().toISOString()}]:[];}},
  rpcs:{check_rate_limit:{data:true,error:null},is_platform_owner:{data:false,error:null},get_actor_access:{data:{tier:'tenant'},error:null},
   current_user_tenant_id:()=>({data:state.current,error:null}),
   get_paige_persona_context:()=>({data:[{tenant_id:options.nullProfile?tenant:state.current,funding_enabled:false}],error:null}),
   paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},
   paige_chat_interactive_begin_v2:()=>{append('user','Continue.');return {data:{status:'accepted',turn_id:id(7)},error:null};},
   paige_chat_interactive_executor_v2:args=>{
    if(args.p_operation==='acquire')state.executor=intent;if(args.p_operation==='release')state.executor=null;
    return {data:{latest:intent,executor:state.executor,acquired:true,terminal:state.turns.some(row=>row.bundle_ref?.turn_state)},error:null};},
   paige_chat_interactive_settle:args=>{append('assistant',args.p_content,args.p_bundle_ref);return {data:id(8),error:null};},
   resolve_tool_autonomy_many:{data:[],error:null},resolve_tool_autonomy:{data:'auto',error:null}}});
 const pending=[];globalThis.EdgeRuntime={waitUntil:promise=>pending.push(promise)};
 const response=await handler(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer fixture', 'Content-Type':'application/json'},
  body:JSON.stringify({messages:[{role:'user',content:'Continue.'}],threadId:thread,requestIntentId:intent,interactive:{kind:'message'}})}));
 const wire=await response.text();await Promise.all(pending);
 await new Promise(resolve=>setTimeout(resolve,0));
 return {...state,rec,wire,status:response.status};
}
let checks=0,failures=0;
async function check(label,options,verify){try{const result=await drive(options);verify(result);checks++;console.log(`PASS ${label}`);}catch(error){failures++;console.error(`FAIL ${label}: ${error.message}`);}}
await check('actual preflight fold uses OpenAI operational with 2048 cap and same prompt/trace',{},r=>{
 assert.equal(r.folds.length,1);assert.equal(r.folds[0].provider,'openai');assert.equal(r.folds[0].body.model,'gpt-6.1-sol');
 assert.equal(r.folds[0].body.max_output_tokens,2048);assert.ok(r.folds[0].signal instanceof AbortSignal);
 assert.equal(r.summaryWrites,1);assert.equal(r.row.summary_through_seq,4);assert.equal(r.status,200);
 assert.ok(JSON.stringify(r.folds[0].body).includes('the owner said'));assert.ok(JSON.stringify(r.folds[0].body).includes('never record a promise'));
 const trace=r.rec.inserts.find(row=>row.table==='paige_llm_trace'&&row.row.job_kind==='thread-summary-fold'&&row.row.provider==='openai');
 assert.equal(trace?.row.tenant_id,tenant);assert.equal(trace?.row.working_context_tenant_id,tenant);assert.equal(trace?.row.agent_id,'paige-ai-chat');
});
await check('proven primary failure falls back once to Anthropic with same cap',{failPrimary:true},r=>{
 assert.deepEqual(r.folds.map(call=>call.provider),['openai','anthropic']);assert.equal(r.folds[1].body.max_tokens,2048);assert.equal(r.summaryWrites,1);
});
await check('invalid primary request never falls back or claims compaction',{failPrimary:true,invalidPrimary:true},r=>{assert.deepEqual(r.folds.map(call=>call.provider),['openai']);assert.equal(r.summaryWrites,0);assert.ok(r.wire.includes('"state":"skipped"'));});
await check('reasoning hard budget blocks every fold provider',{budget:true},r=>{assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);assert.ok(r.rec.inserts.some(row=>row.table==='paige_llm_trace'&&row.row.job_kind==='thread-summary-fold'&&row.row.error_class==='budget_exceeded'));});
await check('scope change before transcript read refuses all transcript/model egress',{beforeTranscript:true},r=>{assert.equal(r.transcriptReads,0);assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('scope change after transcript read refuses provider egress',{beforeProvider:true},r=>{assert.ok(r.transcriptReads>0);assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('scope change during Fabric budget read refuses provider egress',{duringBudget:true},r=>{assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('scope change after primary failure refuses fallback egress',{failPrimary:true,beforeFallback:true},r=>{assert.deepEqual(r.folds.map(call=>call.provider),['openai']);assert.equal(r.summaryWrites,0);});
await check('scope change during provider refuses summary persistence',{afterProvider:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);});
await check('owner change during provider refuses summary persistence',{afterProviderOwner:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);});
await check('foreign actor row cannot feed the summary provider',{foreignActor:true},r=>{assert.equal(r.transcriptReads,0);assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('foreign tenant thread remains refused',{foreignTenant:true},r=>{assert.equal(r.transcriptReads,0);assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('null active profile cannot ride first-membership fallback',{nullProfile:true},r=>{assert.equal(r.folds.length,0);assert.equal(r.summaryWrites,0);});
await check('empty completion leaves watermark intact and reports skipped',{empty:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);assert.equal(r.row.summary_through_seq,0);assert.ok(r.wire.includes('"state":"skipped"'));});
await check('rejected write never emits compaction done',{writeFail:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);assert.ok(r.wire.includes('"state":"skipped"'));assert.ok(!r.wire.includes('"state":"done"'));});
await check('compare-and-swap loser leaves concurrent watermark intact',{casLost:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);assert.equal(r.row.summary_through_seq,8);assert.ok(r.wire.includes('"state":"skipped"'));});
await check('post-turn fold uses same Fabric/binding path',{postOnly:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.folds[0].provider,'openai');assert.equal(r.summaryWrites,1);});
await check('post-turn provider scope switch cannot persist',{postOnly:true,afterProvider:true},r=>{assert.equal(r.folds.length,1);assert.equal(r.summaryWrites,0);});
const privateSummaryMarker='PRIVATE-SUMMARY-MARKER';
await check('same-workspace recalled summary reaches ordinary provider',{postOnly:true,prior:privateSummaryMarker},r=>{
 assert.equal(r.mainStreams,1);assert.equal(r.mainBodies[0].current,tenant);assert.equal(r.mainBodies[0].summaryReads,6);
 assert.ok(JSON.stringify(r.mainBodies[0].body).includes(privateSummaryMarker));
});
await check('workspace change during earlier recall binding refuses ordinary provider',{postOnly:true,prior:privateSummaryMarker,flipSummaryRead:5},r=>{
 assert.equal(r.current,other);assert.equal(r.mainStreams,0);assert.equal(r.summaryWrites,0);
 assert.ok(!r.wire.includes(privateSummaryMarker));
});
await check('workspace change during final recalled-summary binding refuses ordinary provider',{postOnly:true,prior:privateSummaryMarker,flipSummaryRead:6},r=>{
 assert.equal(r.current,other);assert.equal(r.mainStreams,0);assert.equal(r.mainBodies.length,0);assert.equal(r.summaryWrites,0);
 assert.ok(!r.wire.includes(privateSummaryMarker));
});
console.log(`${checks} passed, ${failures} failed actual-handler summary Fabric checks; native SQL/provider acceptance remains unverified`);
process.exitCode=failures?1:0;
