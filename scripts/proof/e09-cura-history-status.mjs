// Runs the actual status handler with recording offline ports. No hosted JWT or provider proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const id=n=>'e0c40100-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4),turn=id(5),nonce=id(6),proposal=id(7),work=id(8),doc=id(9);
const args={purpose:'cura_customer_knowledge',title:'Neutral program FAQ',content:'Approved fixture information.',confirm:false};
let network=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[key]??''}};
globalThis.fetch=async()=>{network.push('fetch');throw Error('STATUS_PROOF_NETWORK_FORBIDDEN');};
globalThis.WebSocket=class{constructor(){network.push('WebSocket');throw Error('STATUS_PROOF_NETWORK_FORBIDDEN');}};
const fake=await import('../knowledge-scope/fake-supabase.mjs');
await import('../../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('../knowledge-scope/stub-serve.mjs');
const {confirmFingerprint}=await import('../../supabase/functions/_shared/confirm-fingerprint.ts');
const {CHAT_CONTROL_HEADER}=await import('../../supabase/functions/_shared/paige-turn/control-transport.ts');
const {stableRunId}=await import('../../supabase/functions/_shared/capability-record.ts');
const fingerprint=await confirmFingerprint('save_to_knowledge_base',{intent:await confirmFingerprint('save_to_knowledge_base',args),tenant,thread,client:null});
const token=fingerprint+':'+nonce;
const nativeIntent=await stableRunId(['cura.knowledge.prepare.v1',actor,tenant,thread,token,'cura_customer_knowledge']);
function table(rows){return filters=>{
 let found=structuredClone(rows);
 for(const [op,key,a,b] of filters){
  if(op==='eq')found=found.filter(row=>row[key]===a);
  if(op==='is')found=found.filter(row=>row[key]===a);
  if(op==='not'&&a==='is')found=found.filter(row=>row[key]!==b&&row[key]!==undefined);
  if(op==='limit')found=found.slice(0,key);
 }
 const select=filters.filter(f=>f[0]==='select').at(-1)?.[1];
 return found.map(row=>!select||select==='*'?row:Object.fromEntries(select.split(',').map(key=>[key,row[key]])));
};}
async function drive(options={}){
 network=[];const abort=new AbortController();let profileTenant=options.workspaceChanged?id(99):tenant;
 const threadRow={id:thread,tenant_id:tenant,caller_user_id:actor,audience:'workspace',is_archived:false,
  interactive_latest_intent:id(90),interactive_executor_intent:id(91),interactive_recovery_hold:id(92)};
 const original={id:turn,thread_id:thread,role:'assistant',created_at:'2026-10-21T12:00:01.000001Z',
  interactive_intent_id:intent,interactive_actor_id:options.foreignActor?id(99):actor,interactive_tenant_id:tenant,interactive_terminal_state:'WAIT_APPROVAL',
  bundle_ref:{turn_state:{v:1,state:'WAIT_APPROVAL'},interactive:{request_intent_id:intent,effects:[
   {tool:'save_to_knowledge_base',outcome:'approval_required'},{tool:'crm_add_note',outcome:'outcome_unknown'}]},
   paige_confirm:[{tool:'save_to_knowledge_base',fingerprint:token}]}};
 const row={id:proposal,user_id:actor,tenant_id:options.foreignProposal? id(99):tenant,thread_id:thread,scoped_client_id:null,
  tool_name:'save_to_knowledge_base',args:options.tampered?{...args,content:'Changed frozen text'}:args,fingerprint,issued_in_request:nonce,
  server_issued_at:'2026-10-21T12:00:00Z',created_at:'2026-10-21T12:00:00Z',consumed_at:options.unconsumed?null:'2026-10-21T12:00:02Z',expires_at:'2026-10-21T12:15:00Z'};
 const recorder=fake.setScenario({authUser:{id:actor,email:'owner@example.test'},tables:{
  paige_chat_threads:table([threadRow]),paige_chat_turns:table([original]),paige_pending_confirmations:table([row]),
  profiles:filters=>table([{id:id(100),user_id:actor,active_tenant_id:profileTenant},
   {id:actor,user_id:id(99),active_tenant_id:id(99)}])(filters),
 },rpcs:{
  paige_chat_interactive_protocol:{data:{version:2,active:options.inactive!==true},error:null},
  check_rate_limit:{data:true,error:null},current_user_tenant_id:{data:tenant,error:null},
  is_platform_owner:{data:false,error:null},is_tenant_member:{data:true,error:null},
  read_cura_knowledge_preparation:()=>{
   if(options.abortAfterNative)abort.abort();if(options.changedAfterNative)profileTenant=id(99);
   return options.denied?{data:null,error:{code:'42501',message:'private refusal'}}:{data:{contract_version:1,tenant_id:tenant,
    availability:'available',preparation_recorded:true,retry_authorized:false,work_id:work,work_status:options.state??'outcome_unknown',
    source_document_id:doc,current_document_revision:2,work_updated_at:'2026-10-21T12:00:03Z'},error:null};
  },
 }});
 const request={messages:[{role:'user',content:'Read pending approval status.'}],threadId:thread,requestIntentId:intent,
  interactive:{kind:'status',approvalTurnId:options.wrongTurn?id(99):turn},...(options.mutative?{approvedConfirmations:[token]}:{})};
 const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{
  method:'POST',headers:{Authorization:'Bearer synthetic-original-caller','Content-Type':'application/json',[CHAT_CONTROL_HEADER]:'status'},
  body:JSON.stringify(request),signal:abort.signal}));
 const body=await response.json();
 assert.equal(recorder.inserts.length,0);assert.equal(recorder.functions.length,0);assert.deepEqual(network,[]);
 const allowed=new Set(['check_rate_limit','paige_chat_interactive_protocol','current_user_tenant_id','is_platform_owner','is_tenant_member','read_cura_knowledge_preparation']);
 assert.deepEqual(recorder.rpc.filter(call=>!allowed.has(call.name)),[]);
 const reads=recorder.rpc.filter(call=>call.name==='read_cura_knowledge_preparation');
 for(const call of reads){assert.equal(call.client,'jwt');assert.deepEqual(call.args,{p_tenant_id:tenant,p_intent_id:nativeIntent,p_title:args.title,p_input:args.content});}
 assert.equal(threadRow.interactive_recovery_hold,id(92));assert.equal(threadRow.interactive_executor_intent,id(91));
 for(const query of recorder.from.filter(q=>q.table==='profiles'))assert.ok(query.filters.some(f=>f[0]==='eq'&&f[1]==='user_id'&&f[2]===actor),'profile scope uses canonical user_id, not unrelated profile id');
 assert.equal(body.approval_history,undefined);return {response,body,reads,recorder};
}
const cases=[];
async function check(name,run){try{await run();cases.push({name,status:'PASS'});console.log('PASS '+name);}
 catch(error){cases.push({name,status:'FAIL',reason:error.message});console.error('FAIL '+name+': '+error.message);}}
for(const state of ['outcome_unknown','succeeded','cancelled'])await check('original '+state+' preparation remains a read-only fact, not another effect or settled turn',async()=>{
 const r=await drive({state}),h=r.body.cura_preparation_history;
 assert.equal(r.response.status,200);assert.equal(r.response.headers.get('Cache-Control'),'no-store');assert.equal(r.body.approval_recovery.status,'unavailable');
 assert.equal(h.status,'recorded_preparation');assert.equal(h.origin_intent_id,intent);assert.equal(h.preparations[0].work_id,work);
 assert.equal(h.preparations[0].work_status,state);assert.equal(h.settles_interrupted_turn,false);assert.equal(h.retry_authorized,false);
 assert.equal(h.confirmations_restored,false);assert.equal(h.new_effect_possible,false);assert.equal(r.reads.length,1);
 assert.equal(JSON.stringify(h).includes(args.content),false);assert.equal(JSON.stringify(h).includes(token),false);assert.equal(JSON.stringify(h).includes(args.title),false);
});
for(const [name,options] of [['inactive protocol',{inactive:true}],['foreign proposal business',{foreignProposal:true}],['wrong original turn',{wrongTurn:true}],
 ['foreign original actor',{foreignActor:true}],['tampered frozen source',{tampered:true}],['unconsumed confirmation',{unconsumed:true}],
 ['changed selected business',{workspaceChanged:true}],['native publisher refusal',{denied:true}],['abort after native read',{abortAfterNative:true}],
 ['late selected-business change',{changedAfterNative:true}]])await check(name+' withholds private preparation',async()=>{
 const r=await drive(options);assert.equal(r.body.cura_preparation_history,undefined);
});
await check('mutative payload is rejected before preparation observation',async()=>{const r=await drive({mutative:true});assert.equal(r.response.status,400);assert.equal(r.reads.length,0);});
await check('repeated explicit status uses the same original native intent and never submits',async()=>{
 for(let i=0;i<2;i++){const r=await drive();assert.equal(r.body.cura_preparation_history.status,'recorded_preparation');assert.equal(r.reads.length,1);}
});
const summary={evidenceClass:'actual production handler with recording offline ports, not hosted identity/provider/customer proof',sourceSHA256:createHash('sha256').update(readFileSync('supabase/functions/paige-ai-chat/index.ts')).digest('hex'),passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,skipped:0,cases};
const destination=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);if(destination){mkdirSync(path.dirname(path.resolve(destination)),{recursive:true});writeFileSync(destination,JSON.stringify(summary,null,2)+'\n');}
console.log('RESULT '+summary.passed+' PASS / '+summary.failed+' FAIL / 0 SKIP');if(summary.failed)process.exitCode=1;
