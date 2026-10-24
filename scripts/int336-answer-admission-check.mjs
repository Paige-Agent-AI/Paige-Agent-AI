import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The existing module loader runs the unchanged served Chat handler. Optional native
// mode substitutes ONLY transcript/admission RPCs with actual applied SQL functions in
// an empty disposable loopback int336_test* DB. No network/provider/business operation.
globalThis.Deno = { env: { get: key => ({
  SUPABASE_URL:'https://test.supabase.co', SUPABASE_ANON_KEY:'anon-key',
  SUPABASE_SERVICE_ROLE_KEY:'service-role-key', ANTHROPIC_API_KEY:'fixture-key',
})[key] ?? '' } };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const actor=id(1), tenant=id(2), oldIntent=id(4), intent=id(5), askId=id(6);
const nativeMode = process.argv.includes('--native-db') || process.argv.includes('--native-contract-only');
const root=path.resolve(import.meta.dirname,'..');
const resume = await import('../supabase/functions/_shared/paige-turn/resume.ts');
const {buildAskRecord,resolveAskLiveness,answerClaim,answerClaimBound,reopenAsk} = resume;
// Keep the test runnable against the immutable pre-repair source: its intended red
// assertion is the actual handler's 409 instead of continuation, not a missing export.
const answerTurnsAfterAdmission = resume.answerTurnsAfterAdmission ?? (turns => ({turns,ownAdmissionMarkerId:null}));
const ask=buildAskRecord({prompt:'Which pipeline should I use?',needs:'pipeline choice',objective:'Creating the approved opportunity',
  options:[{label:'Default pipeline',value:'PPL-FIX01'},{label:'Another pipeline',value:'PPL-FIX02'}]}, {askId,freeForm:true});
const waiting={v:1,state:'ASK_USER',mode:'clarify',rounds:1,tools:0,waiting_on:{kind:'choice'}};
const questionBundle={interactive:{request_intent_id:oldIntent},paige_ask:ask,turn_state:waiting};
let serial=100;
const quote = value => value === null || value === undefined ? 'null' : typeof value === 'boolean' ? String(value)
  : typeof value === 'object' ? "'" + JSON.stringify(value).replaceAll("'","''") + "'::jsonb"
    : "'" + String(value).replaceAll("'","''") + "'";
let sqlRun;
if(nativeMode){
 const url=process.env.INT336_DATABASE_URL;
 assert.ok(url,'INT336_DATABASE_URL required'); const parsed=new URL(url);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) && /^\/int336_test[a-z0-9_]*$/i.test(parsed.pathname),'empty disposable loopback int336_test* DB only');
 const psql=process.env.PSQL_BIN??'psql';
 const raw=sql=>spawnSync(psql,['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',url],{input:sql,encoding:'utf8',timeout:30000,windowsHide:true});
 sqlRun=sql=>{const result=raw(sql);assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 assert.equal(sqlRun("select to_regclass('public.paige_chat_threads') is null"),'t','native fixture DB must be empty');
 const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{env:process.env,encoding:'utf8',windowsHide:true});
 assert.equal(emitted.status,0,emitted.stderr);
 const baseline=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
 const migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
 sqlRun(baseline + migration('20270601000008_int346_server_issued_interactive_receipts.sql')
  + migration('20270602000301_int346_conversational_admission.sql')
  + migration('20271108110000_int346_database_executor_isolation.sql')
  + migration('20270596000000_chat_turn_answer_claim_unique.sql') + `
commit;
alter table public.paige_chat_turns add column seq bigserial, add column created_at timestamptz default clock_timestamp();
grant select,insert,update on public.paige_chat_turns to authenticated;
-- Synthetic fixture state, not activation/retirement evidence. Activation's independent
-- native gates stay covered by int346-isolation-db-check and are not altered here.
update public.paige_chat_interactive_rollout set active=true,edge_head=repeat('a',40),drain_evidence_sha256=repeat('b',64);
`);
 const parameters={
  paige_chat_interactive_begin_v2:['p_thread','p_intent','p_supersedes','p_content','p_bound_answer','p_stop','p_effectful'],
  paige_chat_interactive_executor_v2:['p_thread','p_actor','p_tenant','p_intent','p_operation'],
  paige_chat_interactive_settle:['p_thread','p_actor','p_tenant','p_intent','p_content','p_surfaces_used','p_model','p_bundle_ref','p_tool_calls'],
  paige_chat_turn_append:['p_thread_id','p_role','p_content','p_surfaces_used','p_load_id','p_model','p_tokens_used','p_latency_ms','p_bundle_ref','p_tool_calls'],
 };
 globalThis.nativeRpc=(name,args,{user=actor,workspace=tenant}={})=>{
  const fields=parameters[name];assert.ok(fields,'only existing native transcript/admission RPCs');
  const role=['paige_chat_interactive_executor_v2','paige_chat_interactive_settle'].includes(name)?'service_role':'authenticated';
  const values=fields.map(field=>field==='p_effectful'?(args[field]??true):args[field]);
  const sqlValues=values.map((value,index)=>fields[index]==='p_surfaces_used'&&Array.isArray(value)
   ? 'array['+value.map(quote).join(',')+']::text[]' : quote(value));
  const result=raw('set test.actor='+quote(user)+';set test.tenant='+quote(workspace)+';set role '+role+';select to_jsonb(public.'+name+'('+sqlValues.join(',')+'));');
  return result.status===0?{data:JSON.parse(result.stdout.trim()),error:null}:{data:null,error:{code:/23505/.test(result.stderr)?'23505':'42501',message:result.stderr}};
 };
}
function nativeThread(){
 const thread=id(serial++);sqlRun('insert into public.paige_chat_threads(id,caller_user_id,tenant_id)values('+[thread,actor,tenant].map(quote).join(',')+');');
 const rpc=(name,args)=>globalThis.nativeRpc(name,args);
 const begin=rpc('paige_chat_interactive_begin_v2',{p_thread:thread,p_intent:oldIntent,p_supersedes:null,p_content:'Create an opportunity.',p_bound_answer:false,p_stop:false});
 assert.ifError(begin.error);
 const acquire=rpc('paige_chat_interactive_executor_v2',{p_thread:thread,p_actor:actor,p_tenant:tenant,p_intent:oldIntent,p_operation:'acquire'});
 assert.equal(acquire.data.acquired,true);
 const question=rpc('paige_chat_interactive_settle',{p_thread:thread,p_actor:actor,p_tenant:tenant,p_intent:oldIntent,p_content:ask.question,p_bundle_ref:questionBundle});
 assert.ifError(question.error);
 assert.ifError(rpc('paige_chat_interactive_executor_v2',{p_thread:thread,p_actor:actor,p_tenant:tenant,p_intent:oldIntent,p_operation:'release'}).error);
 return {thread,askTurn:question.data,rpc,rows:()=>JSON.parse(sqlRun("select coalesce(jsonb_agg(t order by seq desc),'[]'::jsonb) from public.paige_chat_turns t where thread_id="+quote(thread)))};
}
let contractChecks=0;
if(nativeMode){
 const store=nativeThread();
 const admission=store.rpc('paige_chat_interactive_begin_v2',{p_thread:store.thread,p_intent:intent,p_supersedes:oldIntent,p_content:'Use the default pipeline.',p_bound_answer:true,p_stop:false});
 assert.ifError(admission.error);assert.equal(admission.data.status,'accepted');assert.equal(admission.data.turn_id,null);contractChecks++;
 const rows=store.rows(),marker=rows[0],question=rows[1];
 assert.equal(marker.role,'system');assert.equal(marker.content,'');assert.equal(marker.interactive_actor_id,actor);assert.equal(marker.interactive_tenant_id,tenant);
 assert.equal(marker.interactive_supersedes_id,oldIntent);assert.equal(marker.interactive_intent_id,null);assert.equal(marker.interactive_terminal_state,null);
 assert.deepEqual(marker.bundle_ref,{interactive:{supersedes_intent_id:oldIntent}});contractChecks++;
 assert.equal(question.id,store.askTurn);assert.equal(question.interactive_intent_id,oldIntent);assert.equal(question.interactive_terminal_state,'ASK_USER');contractChecks++;
 assert.deepEqual(resolveAskLiveness(rows,askId),{state:'stale',reason:'superseded'});contractChecks++;
 const authSql='set test.actor='+quote(actor)+';set test.tenant='+quote(tenant)+';set role authenticated;';
 const protectedUpdate=spawnSync(process.env.PSQL_BIN??'psql',['-X','-qAt','-v','ON_ERROR_STOP=1',process.env.INT336_DATABASE_URL],{input:authSql+'update public.paige_chat_turns set interactive_actor_id='+quote(id(80))+' where id='+quote(marker.id),encoding:'utf8',windowsHide:true});
 assert.notEqual(protectedUpdate.status,0);assert.match(protectedUpdate.stderr,/server-owned|immutable/);contractChecks++;
 for(const scope of [{user:id(81)},{workspace:id(82)}]){
  const rejected=globalThis.nativeRpc('paige_chat_interactive_begin_v2',{p_thread:store.thread,p_intent:id(serial++),p_supersedes:null,p_content:'Foreign answer',p_bound_answer:true,p_stop:false},scope);
  assert.ok(rejected.error);contractChecks++;
 }
 // The real partial unique index, through the real scoped append, remains authoritative.
 const claimArgs={p_thread_id:store.thread,p_role:'user',p_content:'Synthetic claimed choice',p_bundle_ref:{paige_resume:answerClaim(askId,store.askTurn,false)}};
 assert.ifError(store.rpc('paige_chat_turn_append',claimArgs).error);
 assert.equal(store.rpc('paige_chat_turn_append',claimArgs).error?.code,'23505');contractChecks++;
 const forged=store.rpc('paige_chat_turn_append',{p_thread_id:store.thread,p_role:'system',p_content:'',p_bundle_ref:{interactive:{supersedes_intent_id:oldIntent}}});
 assert.ifError(forged.error);
 const forgedRow=store.rows().find(row=>row.id===forged.data);
 assert.equal(forgedRow.interactive_actor_id,null);
 const scope={actorId:actor,tenantId:tenant,askId,admission:{intentId:intent,supersedesIntentId:oldIntent}};
 assert.equal(answerTurnsAfterAdmission([forgedRow,question],scope).ownAdmissionMarkerId,null);contractChecks++;
 const stopped=store.rpc('paige_chat_interactive_begin_v2',{p_thread:store.thread,p_intent:null,p_supersedes:oldIntent,p_content:'',p_bound_answer:false,p_stop:true});
 assert.ifError(stopped.error);
 const stop=store.rows()[0];assert.equal(stop.bundle_ref.interactive.stopped,true);
 assert.equal(answerTurnsAfterAdmission([stop,question],scope).ownAdmissionMarkerId,null);contractChecks++;
 const late=store.rpc('paige_chat_interactive_begin_v2',{p_thread:store.thread,p_intent:oldIntent,p_supersedes:null,p_content:'Delayed old instruction',p_bound_answer:false,p_stop:false});
 assert.ifError(late.error);assert.equal(late.data.status,'superseded');contractChecks++;
 console.log('PASS '+contractChecks+' native admission/marker/authority/unique-claim contracts using unchanged applied functions; synthetic rollout, not production activation proof');
 if(process.argv.includes('--native-contract-only'))process.exit(0);
}

let modelCalls=0;
globalThis.fetch=async(url,options)=>{
 assert.ok(String(url).includes('api.anthropic.com'),'no external network is permitted');
 const body=JSON.parse(options.body);
 assert.ok(!body.system?.startsWith('You label one message sent to PAIGE'),'bound answers skip advisory classifier');
 modelCalls++;
 const events=[{type:'message_start',message:{usage:{input_tokens:1}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'I have your choice.'}},{type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
 return new Response(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
};
const fake=await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('./knowledge-scope/stub-serve.mjs');
const handler=capturedHandler();
async function drive(mode='native-marker',useNative=false){
 modelCalls=0;let latest=oldIntent,executor=null;
 const receipts=[],localTurns=[];
 const store=useNative?nativeThread():{thread:id(serial++),askTurn:id(serial++)};
 const append=(role,content,bundle,issued={})=>{const row={id:crypto.randomUUID(),thread_id:store.thread,seq:localTurns.length+1,role,content,bundle_ref:bundle,created_at:new Date().toISOString(),...issued};localTurns.push(row);return row.id;};
 if(!useNative){
  append('user','Create an opportunity.',{interactive:{request_intent_id:oldIntent}});
  localTurns.push({id:store.askTurn,thread_id:store.thread,seq:2,role:'assistant',content:ask.question,bundle_ref:questionBundle,
   interactive_intent_id:oldIntent,interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_terminal_state:'ASK_USER'});
  const asked=localTurns[1];
  if(mode==='unissued-question')for(const key of ['interactive_intent_id','interactive_actor_id','interactive_tenant_id','interactive_terminal_state'])delete asked[key];
  if(mode==='foreign-question-actor')asked.interactive_actor_id=id(92);
  if(mode==='foreign-question-tenant')asked.interactive_tenant_id=id(93);
 }
 const allTurns=()=>useNative?store.rows():[...localTurns].sort((a,b)=>b.seq-a.seq);
 const claimRows=()=>allTurns().filter(row=>row.role==='user'&&row.bundle_ref?.paige_resume?.kind==='answer');
 if(mode==='ordinary-before'||mode==='system-before')append(mode==='ordinary-before'?'user':'system','A separate intervening message',null);
 const scopedRows=filters=>{
  if(filters.some(filter=>filter[0]==='contains'))return [];
  const columns=filters.find(filter=>filter[0]==='select')?.[1],limit=filters.find(filter=>filter[0]==='limit')?.[1];
  return allTurns().slice(0,limit??Infinity).map(row=>columns&&columns!=='*'?Object.fromEntries(columns.split(',').map(column=>[column,row[column]])):row);
 };
 const rpcs={
  current_user_tenant_id:{data:tenant,error:null},check_rate_limit:{data:true,error:null},
  paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},
  get_actor_access:{data:{tier:'tenant'},error:null},get_paige_persona_context:{data:[{tenant_id:tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null},
  resolve_tool_autonomy:{data:'confirm',error:null},resolve_tool_autonomy_many:{data:[],error:null},match_paige_memory:{data:[],error:null},
  paige_chat_interactive_begin_v2:args=>{
   assert.equal(args.p_bound_answer,true);
   if(useNative)return store.rpc('paige_chat_interactive_begin_v2',args);
   if(mode!=='no-marker'){
    const issued=mode==='forged-marker'?{}:{interactive_actor_id:mode==='foreign-actor-marker'?id(85):actor,interactive_tenant_id:mode==='foreign-tenant-marker'?id(86):tenant,
     interactive_supersedes_id:mode==='wrong-supersedes-marker'?id(87):args.p_supersedes,interactive_intent_id:null,interactive_terminal_state:null};
    append('system','',{interactive:{supersedes_intent_id:args.p_supersedes,...(mode==='stop-marker'?{stopped:true}:{})}},issued);
   }
   latest=args.p_intent;return {data:{status:'accepted',turn_id:null},error:null};
  },
  paige_chat_interactive_executor_v2:args=>{
   if(useNative)return store.rpc('paige_chat_interactive_executor_v2',args);
   if(args.p_operation==='acquire')executor=args.p_intent;if(args.p_operation==='release')executor=null;
   return {data:{latest,executor,acquired:executor===args.p_intent,terminal:receipts.some(receipt=>receipt.p_intent===args.p_intent),stopped:false},error:null};
  },
  paige_chat_turn_append:args=>{
   if(useNative)return store.rpc('paige_chat_turn_append',args);
   if(args.p_role==='user'&&args.p_bundle_ref?.paige_resume?.kind==='answer'){
    if(mode==='ordinary-race'||mode==='system-race')append(mode==='ordinary-race'?'user':'system','A message reached the thread before the claim',null);
    if(claimRows().some(row=>row.bundle_ref.paige_resume.key===args.p_bundle_ref.paige_resume.key))return {data:null,error:{code:'23505',message:'duplicate answer'}};
   }
   return {data:append(args.p_role,args.p_content,args.p_bundle_ref),error:null};
  },
  paige_chat_interactive_settle:args=>{
   receipts.push(args);
   return useNative?store.rpc('paige_chat_interactive_settle',args):{data:append('assistant',args.p_content,args.p_bundle_ref,{interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_intent_id:args.p_intent,interactive_terminal_state:args.p_bundle_ref?.turn_state?.state}),error:null};
  },
 };
 const rec=fake.setScenario({authUser:{id:actor},tables:{profiles:[{active_tenant_id:tenant}],tenant_members:[{tenant_id:tenant,user_id:actor,role:'owner',status:'active'}],
  paige_chat_threads:[{id:store.thread,tenant_id:tenant,caller_user_id:actor}],paige_chat_turns:scopedRows},rpcs});
 const requestedAsk=mode==='wrong-ask'?id(89):askId;
 const request=(requestIntentId=intent,supersedesIntentId=oldIntent)=>handler(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},
  body:JSON.stringify({messages:[{role:'user',content:'Use the default pipeline PPL-FIX01.'}],threadId:store.thread,requestIntentId,
   interactive:{kind:'message',supersedesIntentId},resume:{kind:'answer',ask_id:requestedAsk}})}));
 const response=await request();
 const wire=await response.text();
 return {mode,status:response.status,wire,modelCalls,claims:claimRows(),receipts,turns:allTurns(),rec,store,request,claimRows};
}
let checks=0,helperChecks=0;
for(const [mode,useNative] of [['native-marker',nativeMode],...(!nativeMode?[['no-marker',false]]:[])]){
 const result=await drive(mode,useNative);
 assert.equal(result.status,200,'a genuine answer must pass its own native admission marker: '+result.wire);
 assert.equal(result.modelCalls,1);assert.equal(result.claims.length,1);
 assert.equal(result.receipts.length,1);assert.equal(result.receipts[0].p_bundle_ref.turn_state.state,'FINAL');
 const frames=result.wire.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{try{return [JSON.parse(line.slice(6))]}catch{return []}});
 assert.equal(frames.filter(frame=>frame.paige_turn?.event==='resumed').length,1);
 assert.ok(frames.some(frame=>frame.paige_turn?.event==='completed'&&frame.paige_turn.state==='FINAL'));
 assert.equal(result.rec.rpc.filter(call=>call.name==='execute_crm_command').length,0);checks++;
 const scope={actorId:actor,tenantId:tenant,askId};
 const normalized=answerTurnsAfterAdmission(result.turns,scope).turns;
 assert.deepEqual(resolveAskLiveness(normalized,askId),{state:'answered'});
 assert.ok(answerClaimBound(normalized,askId,result.claims[0].id));helperChecks++;
 const pending=result.turns.filter(row=>row.role!=='assistant'||row.id===result.store.askTurn);
 const open=answerTurnsAfterAdmission(pending,scope).turns;
 assert.equal(resolveAskLiveness(open,askId).state,'pending');helperChecks++;
 if(mode==='native-marker'){
  const current=structuredClone(pending.find(row=>row.role==='system'));
  current.id=id(99);current.interactive_supersedes_id=intent;current.bundle_ref={interactive:{supersedes_intent_id:intent}};
  const owned=answerTurnsAfterAdmission([current,...pending],{...scope,admission:{intentId:id(94),supersedesIntentId:intent}});
  assert.equal(owned.ownAdmissionMarkerId,current.id);
  assert.equal(resolveAskLiveness(owned.turns,askId).state,'pending');helperChecks++;
 }
 const again=reopenAsk(ask,id(95));
 const reopened=[{id:id(96),role:'assistant',bundle_ref:{paige_ask:again.record,turn_state:again.turnState}},...pending];
 assert.deepEqual(resolveAskLiveness(answerTurnsAfterAdmission(reopened,scope).turns,askId),{state:'reopened',ask:again.record});helperChecks++;
 if(mode==='native-marker')for(const role of ['user','system']){
  const barrier={id:id(role==='user'?97:98),role,content:'Intervening instruction',bundle_ref:null};
  const claimed=structuredClone(pending);claimed.splice(1,0,barrier);
  assert.deepEqual(resolveAskLiveness(answerTurnsAfterAdmission(claimed,scope).turns,askId),{state:'stale',reason:'superseded'});helperChecks++;
 }
 modelCalls=0;
 const repeated=await result.request(id(90),intent);
 const repeatedBody=await repeated.json();
 assert.equal(repeated.status,409);assert.equal(repeatedBody.code,'ASK_ALREADY_ANSWERED');
 assert.equal(modelCalls,0);assert.equal(result.claimRows().length,1);checks++;
}
if(!nativeMode)for(const mode of ['forged-marker','foreign-actor-marker','foreign-tenant-marker','wrong-supersedes-marker','stop-marker','wrong-ask','unissued-question','foreign-question-actor','foreign-question-tenant','ordinary-before','system-before','ordinary-race','system-race']){
 const result=await drive(mode);
 assert.equal(result.status,409,mode+': '+result.wire);assert.equal(result.modelCalls,0,mode);
 assert.equal(result.claims.length,mode.endsWith('-race')?1:0,mode);
 assert.equal(result.receipts[0]?.p_bundle_ref.turn_state.state,'INTERRUPTED');checks++;
}
console.log('PASS '+checks+' actual activated Chat answer-admission checks'+(nativeMode?' through native PostgreSQL admission/claim/settlement':' with protected module-boundary fixtures')+'; canonical/wire continuation, no model/effects on refusals');
console.log('PASS '+helperChecks+' native-marker history controls: answered, pending, reopened and intervening user/system barriers');
