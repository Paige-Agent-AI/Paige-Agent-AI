// Actual Chat status handler, offline recording ports. Not hosted RLS or customer proof.
import assert from 'node:assert/strict';
const id = n => 'e5050000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor=id(1),tenant=id(2),thread=id(3),intent=id(4),turn=id(5),invocation=id(6),receipt=id(7);
const network=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[key]??''}};
globalThis.fetch=async()=>{network.push('fetch');throw Error('UNEXPECTED_NETWORK');};
globalThis.WebSocket=class{constructor(){network.push('WebSocket');throw Error('UNEXPECTED_NETWORK');}};
const fake=await import('../knowledge-scope/fake-supabase.mjs');
await import('../../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('../knowledge-scope/stub-serve.mjs');
const {CHAT_CONTROL_HEADER}=await import('../../supabase/functions/_shared/paige-turn/control-transport.ts');
function table(rows){return filters=>{
 let found=structuredClone(rows);
 for(const [op,key,value] of filters)if(op==='eq')found=found.filter(row=>row[key]===value);
 const columns=filters.filter(f=>f[0]==='select').at(-1)?.[1];
 return found.map(row=>!columns||columns==='*'?row:Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
};}
async function drive(options={}){
 network.length=0;const abort=new AbortController();let activeTenant=options.wrongWorkspace?id(99):tenant;
 const original={id:turn,thread_id:thread,role:'assistant',created_at:'2026-10-23T12:00:01.000001Z',
  interactive_intent_id:intent,interactive_actor_id:options.foreignActor?id(99):actor,
  interactive_tenant_id:tenant,interactive_terminal_state:'INTERRUPTED',
  bundle_ref:{turn_state:{v:1,state:'INTERRUPTED'},interactive:{request_intent_id:intent,effects:[
   {tool:'delegate_to_subagent',outcome:'outcome_unknown',record_refs:[{kind:'subagent_invocation',id:invocation}]}]}}};
 const originalThread={id:thread,tenant_id:tenant,caller_user_id:actor,audience:options.customer?'customer_private':'workspace',
  is_archived:false,interactive_latest_intent:id(90),interactive_executor_intent:id(91),interactive_recovery_hold:id(92)};
 let observations=0;
 const recorder=fake.setScenario({authUser:{id:actor,email:'owner@example.test'},tables:{
  paige_chat_threads:table([originalThread]),paige_chat_turns:table([original]),
  tenant_members:table([{user_id:actor,tenant_id:tenant,role:options.member?'member':'owner',status:'active'}]),
  user_roles:table(options.operator?[{user_id:actor,role:'super_admin'}]:[]),
 },rpcs:{
  paige_chat_interactive_protocol:{data:{version:2,active:!options.inactive},error:null},
  check_rate_limit:{data:true,error:null},current_user_tenant_id:()=>({data:activeTenant,error:null}),
  is_platform_owner:{data:false,error:null},is_tenant_member:{data:true,error:null},
  is_tenant_admin_as:{data:!options.member,error:null},agency_can_manage_child:{data:false,error:null},
 },functions:{'paige-orchestrator':()=>{
  observations++;if(options.abort)abort.abort();if(options.switchAfterRead)activeTenant=id(99);
  if(options.changeOriginal)original.interactive_actor_id=id(99);
  return {data:{ok:true,invocation:{id:options.wrongResult?id(99):invocation,specialist:'zion',
   recorded_status:options.pending?'pending':'succeeded',created_at:'2026-10-23T12:00:00Z',
   observed_at:'2026-10-23T12:02:00Z',receipt_state:options.pending?'missing':'verified',
   receipt_id:options.pending?null:receipt,receipt_at:options.pending?null:'2026-10-23T12:00:02Z',
   response_text:options.pending?null:'Original bounded response',response_truncated:false,completion_scope:'specialist_response_only',
   input:{private:'NEVER_PUBLISH'}}},error:options.inspectorError?{message:'private refusal'}:null};
 }}});
 const payload={messages:[{role:'user',content:'Status'}],threadId:thread,requestIntentId:intent,
  interactive:{kind:options.message?'message':'status',...(options.missingTurn?{}:{approvalTurnId:turn}),
   ...(options.noSelector?{}:{includeSpecialistHistory:options.falseSelector?false:true})},
  ...(options.mutative?{approvedConfirmations:['untrusted']}:{}),
  ...(options.customer?{surfaceContext:{kind:'customer_portal'}}:{})};
 const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{
  method:'POST',headers:{Authorization:'Bearer synthetic-original-caller','Content-Type':'application/json',[CHAT_CONTROL_HEADER]:'status'},
  body:JSON.stringify(payload),signal:abort.signal}));
 const body=await response.json();
 assert.deepEqual(network,[]);assert.equal(recorder.inserts.length,0);
 const permittedRpcs=new Set(['paige_chat_interactive_protocol','check_rate_limit','current_user_tenant_id',
  'is_platform_owner','is_tenant_member','is_tenant_admin_as','agency_can_manage_child']);
 assert.deepEqual(recorder.rpc.filter(r=>!permittedRpcs.has(r.name)),[],'status cannot acquire, settle, approve or dispatch');
 for(const call of recorder.functions){
  assert.equal(call.client,'jwt');assert.equal(call.name,'paige-orchestrator');
  assert.deepEqual(call.options.body,{action:'tool_search',tenant_id:tenant,invocation_id:invocation});
  assert.equal(call.options.headers.Authorization,'Bearer synthetic-original-caller');
 }
 assert.equal(originalThread.interactive_recovery_hold,id(92));assert.equal(originalThread.interactive_executor_intent,id(91));
 assert.equal(JSON.stringify(body).includes('NEVER_PUBLISH'),false);
 return {response,body,observations};
}
let passed=0,failed=0;
async function check(name,run){try{await run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}}
await check('original interrupted assignment returns its original receipt without settling or dispatching',async()=>{
 const r=await drive();assert.equal(r.response.status,200);assert.equal(r.response.headers.get('Cache-Control'),'no-store');
 assert.equal(r.body.specialist_history.status,'recorded_assignment');assert.equal(r.body.specialist_history.turn_id,turn);
 assert.equal(r.body.specialist_history.results[0].receipt_id,receipt);assert.equal(r.observations,1);
});
await check('repeat status observes the same original invocation only',async()=>{
 for(let i=0;i<2;i++){const r=await drive();assert.equal(r.observations,1);assert.equal(r.body.specialist_history.new_effect_possible,false);}
});
await check('pending remains pending with no receipt or completed response',async()=>{
 const r=await drive({pending:true});assert.equal(r.body.specialist_history.results[0].recorded_status,'pending');
 assert.equal(r.body.specialist_history.results[0].receipt_id,null);assert.equal(r.body.specialist_history.results[0].response_text,null);
});
for(const key of ['inactive','wrongWorkspace','member','foreignActor','abort','switchAfterRead','changeOriginal','wrongResult','inspectorError'])
 await check(key+' withholds result',async()=>{
  const r=await drive({[key]:true});assert.equal(r.response.status,200);assert.equal(r.body.specialist_history,undefined);
  assert.equal(r.observations,['inactive','wrongWorkspace','member','foreignActor'].includes(key)?0:1);
 });
await check('global Operator alone cannot replace an active owner/admin seat',async()=>{const r=await drive({operator:true,member:true});assert.equal(r.observations,0);assert.equal(r.body.specialist_history,undefined);});
await check('ordinary status adds no specialist observation',async()=>{const r=await drive({noSelector:true});assert.equal(r.response.status,200);assert.equal(r.observations,0);});
for(const key of ['falseSelector','missingTurn','message','mutative'])await check(key+' rejects before observation',async()=>{
 const r=await drive({[key]:true});assert.equal(r.response.status,400);assert.equal(r.observations,0);
});
console.log('RESULT '+passed+' PASS / '+failed+' FAIL / 0 SKIP');if(failed)process.exitCode=1;
