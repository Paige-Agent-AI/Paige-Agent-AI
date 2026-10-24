// Execute the actual production status entry with recording offline ports.
// This proves routing/no-effect behavior, not hosted JWT/RLS or customer acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const id=n=>`a2360000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4),turn=id(5),proposal=id(6),nonce=id(7),work=id(8),item=id(9),rail=id(10);
const stored={title:'Neutral earlier reminder',remind_at:'2030-01-02T10:00:00.123456Z',target:'user',channel:'in_app'};
let network=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[key]??''}};
globalThis.fetch=async()=>{network.push('fetch');throw Error('STATUS_PROOF_NETWORK_FORBIDDEN');};
globalThis.WebSocket=class{constructor(){network.push('WebSocket');throw Error('STATUS_PROOF_NETWORK_FORBIDDEN');}};
const fake=await import('../knowledge-scope/fake-supabase.mjs');
await import('../../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('../knowledge-scope/stub-serve.mjs');
const {confirmFingerprint}=await import('../../supabase/functions/_shared/confirm-fingerprint.ts');
const {CHAT_CONTROL_HEADER}=await import('../../supabase/functions/_shared/paige-turn/control-transport.ts');
const {DURABLE_JOB_STATES}=await import('../../supabase/functions/_shared/durable-job/mod.ts');
const fingerprint=await confirmFingerprint('plan_set_reminder',{intent:await confirmFingerprint('plan_set_reminder',stored),tenant,thread,client:null});
const original={item_id:item,item_type:'reminder',title:stored.title,summary:null,tenant_id:tenant,created_by:actor,
  remind_at:stored.remind_at,remind_target:'user',remind_channel:'in_app',assigned_to_user_id:actor,
  plan_id:null,contact_id:null,source_version:'2026-10-17T12:00:00.123456Z'};
const terminal=()=>({v:1,status:'succeeded',receipt_version:1,work_id:work,proposal_id:proposal,historical:true,replayed:true,
  original_result:{ok:true,item_id:item,item_type:'reminder',remind_at:stored.remind_at,railRecorded:true,receipt_status:'recorded',receipt_run_id:rail},
  original_readback:structuredClone(original)});
function table(rows){return filters=>{
  let found=structuredClone(rows);
  for(const [op,key,value] of filters){
    if(op==='eq')found=found.filter(row=>row[key]===value);
    if(op==='is')found=found.filter(row=>row[key]===value);
    if(op==='not'&&value==='is')found=found.filter(row=>row[key]!==null&&row[key]!==undefined);
    if(op==='limit')found=found.slice(0,key);
  }
  const select=filters.filter(f=>f[0]==='select').at(-1)?.[1];
  return found.map(row=>!select||select==='*'?row:Object.fromEntries(select.split(',').map(key=>[key,row[key]])));
};}
async function drive(options={}){
  network=[];const abort=new AbortController();
  const threadRow={id:thread,tenant_id:tenant,caller_user_id:actor,audience:'workspace',is_archived:false,
    interactive_latest_intent:id(90),interactive_executor_intent:id(91),interactive_recovery_hold:id(92)};
  const origin={id:turn,thread_id:thread,role:'assistant',created_at:'2026-10-17T12:00:00.123456Z',
    interactive_intent_id:intent,interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_terminal_state:'WAIT_APPROVAL',
    bundle_ref:{turn_state:{v:1,state:'WAIT_APPROVAL'},interactive:{request_intent_id:intent,
      effects:[{tool:'plan_set_reminder',outcome:'approval_required'}]},
    paige_confirm:[{tool:'plan_set_reminder',summary:'Neutral exact reminder',fingerprint:`${fingerprint}:${nonce}`}]}};
  const row={id:proposal,user_id:actor,tenant_id:tenant,thread_id:thread,scoped_client_id:null,tool_name:'plan_set_reminder',
    args:stored,fingerprint,issued_in_request:nonce,server_issued_at:'2026-10-17T11:59:00Z',created_at:'2026-10-17T11:59:00Z',
    consumed_at:'2026-10-17T12:00:00.123455Z',expires_at:'2026-10-17T12:00:00.123456Z'};
  if(options.foreignTenant)row.tenant_id=id(98);
  if(options.changedOrigin)origin.interactive_actor_id=id(98);
  const recorder=fake.setScenario({authUser:{id:actor,email:'owner@example.test'},tables:{
    paige_chat_threads:table([threadRow]),paige_chat_turns:table([origin]),paige_pending_confirmations:table([row]),
  },rpcs:{
    paige_chat_interactive_protocol:{data:{version:2,active:options.inactive!==true},error:null},
    check_rate_limit:{data:true,error:null},current_user_tenant_id:{data:tenant,error:null},
    resolve_paige_reminder_approval:()=>{
      if(options.abortAfterResolve)abort.abort();
      return options.denied?{data:null,error:{code:'42501',message:'private refusal'}}
        :{data:{v:1,proposal_id:proposal,work_id:work,work_status:options.state??'succeeded'},error:null};
    },
    execute_paige_approved_reminder:()=>options.malformed?{data:{...terminal(),historical:false},error:null}
      :{data:terminal(),error:null},
  }});
  const request={messages:[{role:'user',content:'Read pending approval status.'}],threadId:thread,requestIntentId:intent,
    interactive:{kind:'status',approvalTurnId:options.wrongTurn?id(98):turn},
    ...(options.mutative?{approvedConfirmations:[`${fingerprint}:${nonce}`]}:{})};
  const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{
    method:'POST',headers:{Authorization:'Bearer synthetic-original-caller','Content-Type':'application/json',[CHAT_CONTROL_HEADER]:'status'},
    body:JSON.stringify(request),signal:abort.signal}));
  const body=await response.json();
  // A status explanation is never a new record, proposal, receipt, claim, runtime
  // acquisition/settlement, provider/model call or legacy fallback.
  assert.equal(recorder.inserts.length,0);assert.equal(recorder.functions.length,0);assert.deepEqual(network,[]);
  const allowed=new Set(['check_rate_limit','paige_chat_interactive_protocol','current_user_tenant_id',
    'resolve_paige_reminder_approval','execute_paige_approved_reminder']);
  assert.deepEqual(recorder.rpc.filter(call=>!allowed.has(call.name)),[]);
  const histories=recorder.rpc.filter(call=>call.name==='execute_paige_approved_reminder');
  for(const call of histories){assert.equal(call.client,'jwt');assert.deepEqual(call.args,{
    p_work_id:work,p_expected_tenant:tenant,p_expected_thread:thread,p_expected_client:null,p_intent:null,p_runtime_request_nonce:null});}
  return{response,body,recorder,histories};
}
const cases=[];
async function check(name,run){try{await run();cases.push({name,status:'PASS'});console.log(`PASS ${name}`);}
  catch(error){cases.push({name,status:'FAIL',reason:error.message});console.error(`FAIL ${name}: ${error.message}`);}}
await check('held nonlatest original card resolves sealed history without acquiring or clearing the retained executor',async()=>{
  const r=await drive();assert.equal(r.response.status,200);assert.equal(r.response.headers.get('Cache-Control'),'no-store');
  assert.equal(r.body.approval_recovery.status,'unavailable');assert.equal(r.body.approval_history.status,'verified_original');
  assert.equal(r.body.approval_history.origin_intent_id,intent);assert.equal(r.body.approval_history.results[0].original.item_id,item);
  assert.equal(r.body.approval_history.results[0].original.receipt_run_id,rail);assert.equal(r.histories.length,1);
  assert.equal(r.body.approval_history.confirmations_restored,false);assert.equal(r.body.approval_history.new_effect_possible,false);
  assert.equal(JSON.stringify(r.body.approval_history).includes(fingerprint),false);
});
for(const state of DURABLE_JOB_STATES.filter(state=>state!=='succeeded'))await check(`native ${state} never dispatches or manufactures original success`,async()=>{
  const r=await drive({state});assert.equal(r.body.approval_history,undefined);assert.equal(r.histories.length,0);
});
for(const [name,options] of [['inactive protocol',{inactive:true}],['foreign proposal tenant',{foreignTenant:true}],
  ['wrong original turn',{wrongTurn:true}],['foreign original actor',{changedOrigin:true}],['native authority denial',{denied:true}],
  ['malformed original receipt',{malformed:true}],['request aborted after resolver',{abortAfterResolve:true}]])
  await check(`${name} withholds the historical result`,async()=>{const r=await drive(options);assert.equal(r.body.approval_history,undefined);
    if(!options.malformed)assert.equal(r.histories.length,0);});
await check('strict status transport rejects an attached approval before history or action execution',async()=>{
  const r=await drive({mutative:true});assert.equal(r.response.status,400);assert.equal(r.body.approval_history,undefined);
  assert.equal(r.recorder.rpc.some(call=>/reminder/.test(call.name)),false);
});
await check('repeated explicit status reads remain observations rather than repeated effects',async()=>{
  for(let i=0;i<2;i++){const r=await drive();assert.equal(r.body.approval_history.status,'verified_original');assert.equal(r.histories.length,1);}
});
const summary={evidenceClass:'actual production handler with recording offline ports; not hosted authority/customer proof',
  sourceSHA256:createHash('sha256').update(readFileSync('supabase/functions/paige-ai-chat/index.ts')).digest('hex'),
  passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,skipped:0,cases};
const destination=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
if(destination){mkdirSync(path.dirname(path.resolve(destination)),{recursive:true});writeFileSync(destination,JSON.stringify(summary,null,2)+'\n');}
console.log(`RESULT ${summary.passed} PASS / ${summary.failed} FAIL / 0 SKIP`);if(summary.failed)process.exitCode=1;
