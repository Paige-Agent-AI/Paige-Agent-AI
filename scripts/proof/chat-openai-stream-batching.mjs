/** Actual unchanged Chat -> Fabric -> OpenAI translator -> interactive lifecycle.
 * Uses the incumbent recording Supabase/serve loader; every provider packet is
 * synthetic and any unexpected network target fails. This is not native SQL,
 * hosted CPU-budget proof or authenticated customer acceptance.
 * Run: node --import ./scripts/client-memory-authz/register.mjs scripts/proof/chat-openai-stream-batching.mjs
 */
import { setScenario } from '../client-memory-authz/fake-supabase.mjs';
const USER='44444444-4444-4444-8444-444444444444';
const TENANT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THREAD='11111111-1111-4111-8111-111111111111';
const INTENT='22222222-2222-4222-8222-222222222222';
const NEXT='33333333-3333-4333-8333-333333333333';
const ENV={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
  OPENAI_API_KEY:'synthetic-offline-key',VOYAGE_API_KEY:'synthetic-embedding-key'};
globalThis.Deno={env:{get:key=>ENV[key],toObject:()=>({...ENV})}};
let fixture;
const enc=new TextEncoder();
globalThis.fetch=async(url,init)=>{
  const target=String(url);
  if(target.includes('voyageai.com'))return new Response(JSON.stringify({data:[{index:0,embedding:Array(1024).fill(0.01)}]}),{status:200});
  if(!target.startsWith('https://api.openai.com/v1/responses'))throw Error('UNEXPECTED_OFFLINE_TRANSPORT');
  const request=JSON.parse(String(init?.body??'{}'));
  fixture.modelCalls.push({stream:request.stream===true,model:request.model});
  if(request.stream!==true)return new Response(JSON.stringify({model:request.model,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({intent:'answer',research:'none',difficulty:'hard',image:'none',needs_workspace_data:true,confidence:0.99})}]}],usage:{input_tokens:1,output_tokens:1}}),{status:200});
  const round=++fixture.round;
  // ALL records in a round arrive in ONE upstream transport read. The translator
  // must not convert this topology into one native authority RPC pair per delta.
  const packet=[];
  const event=value=>packet.push(`data: ${JSON.stringify(value)}\n\n`);
  event({type:'response.created',response:{model:request.model}});
  if(round<3){
    const item={id:`neutral-item-${round}`,type:'function_call',call_id:`neutral-call-${round}`,name:round===1?'capability_status':'integrations_list',arguments:'{}'};
    event({type:'response.output_item.added',output_index:0,item:{...item,arguments:''}});
    event({type:'response.function_call_arguments.delta',item_id:item.id,delta:'{}'});
    event({type:'response.output_item.done',output_index:0,item});
    event({type:'response.completed',response:{status:'completed',model:request.model,output:[item],usage:{input_tokens:1,output_tokens:1}}});
  }else{
    for(let n=0;n<256;n++)event({type:'response.output_text.delta',delta:'Neutral guidance. '});
    event({type:'response.completed',response:{status:'completed',model:request.model,output:[],usage:{input_tokens:1,output_tokens:256}}});
    if(['scope_changed','actor_revoked','superseded'].includes(fixture.mode))fixture.revoked=true;
  }
  return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(packet.join('')));c.close();}}),{status:200,headers:{'content-type':'text/event-stream'}});
};
await import('../../supabase/functions/paige-ai-chat/index.ts');
const {capturedHandler}=await import('../client-memory-authz/stub-serve.mjs');
const handler=capturedHandler();
let passed=0,failed=0;
const check=(condition,name)=>{if(condition)passed++;else{failed++;console.log(`FAIL ${name}`);}};
const settleWithin=async(promise)=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OFFLINE_LIFETIME_DID_NOT_FINISH')),3000);})]);}
  finally{clearTimeout(timer);}
};
const summaries=[];
for(const mode of ['normal','lost_ack','receipt_unknown','foreign_thread','scope_changed','actor_revoked','superseded','consumer_cancel']){
  let releaseFinished;
  const finished=new Promise(accept=>{releaseFinished=accept;});
  fixture={mode,round:0,revoked:false,executor:null,latest:INTENT,terminal:false,modelCalls:[],settlements:[]};
  const activeTenant=()=>fixture.revoked&&mode==='scope_changed'?OTHER:TENANT;
  const rec=setScenario({authUser:{id:USER,email:'owner@example.test'},declaredActiveTenantId:TENANT,
    rpcs:{
      check_rate_limit:{data:true,error:null},is_platform_owner:{data:false,error:null},is_platform_operator:{data:false,error:null},
      get_paige_persona_context:()=>({data:[{tenant_id:activeTenant(),tenant_name:'Neutral workspace',playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null}),
      current_user_tenant_id:()=>({data:activeTenant(),error:null}),studio_role_ok:{data:true,error:null},get_actor_access:{data:{tier:'tenant'},error:null},resolve_tool_autonomy:{data:'confirm',error:null},
      paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},
      paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:'55555555-5555-4555-8555-555555555555'},error:null},
      paige_chat_interactive_executor_v2:args=>{
        if(fixture.revoked&&['scope_changed','actor_revoked'].includes(mode))return{data:null,error:{message:'native current authority unavailable'}};
        if(fixture.revoked&&mode==='superseded')fixture.latest=NEXT;
        if(args.p_operation==='acquire')fixture.executor=INTENT;
        if(args.p_operation==='release'){fixture.executor=null;releaseFinished();}
        return{data:{latest:fixture.latest,executor:fixture.executor,acquired:fixture.executor===INTENT,terminal:fixture.terminal,stopped:false},error:null};
      },
      paige_chat_interactive_settle:args=>{
        fixture.settlements.push(args);
        if(mode==='receipt_unknown'||fixture.revoked&&['scope_changed','actor_revoked'].includes(mode))return{data:null,error:{message:'unconfirmed fixture receipt'}};
        fixture.terminal=true;
        return mode==='lost_ack'?{data:null,error:{message:'lost acknowledgement'}}:{data:'66666666-6666-4666-8666-666666666666',error:null};
      },
      list_integration_surface:{data:[],error:null},
    },
    tables:{profiles:()=>[{user_id:USER,active_tenant_id:activeTenant()}],tenants:()=>[{id:TENANT,account_type:'standalone',parent_tenant_id:null}],tenant_members:()=>[{tenant_id:TENANT,user_id:USER,role:'owner',status:'active'}],client_memory:()=>[],
      // Honor the actual caller/id predicates. The recording fake deliberately
      // delegates filtering to fixtures; returning an invisible foreign row here
      // would bypass the very native/query boundary this negative exercises.
      paige_chat_threads:filters=>[{id:THREAD,caller_user_id:mode==='foreign_thread'?OTHER:USER,tenant_id:mode==='foreign_thread'?OTHER:TENANT,title:'Neutral read guidance',message_count:1}]
        .filter(row=>filters.every(([op,column,value])=>op!=='eq'||row[column]===value)),paige_chat_turns:()=>[]},
    serviceTables:{user_roles:()=>[],tenant_members:()=>[{tenant_id:TENANT,user_id:USER,role:'owner',status:'active'}],tenants:()=>[{id:TENANT,account_type:'standalone',parent_tenant_id:null}],client_memory:()=>[]},
  });
  const response=await handler(new Request('http://local/paige-ai-chat',{method:'POST',headers:{authorization:'Bearer synthetic-jwt','content-type':'application/json'},body:JSON.stringify({
    messages:[{role:'user',content:'Read only: explain current capabilities and connections. Do not create, change, send, approve or schedule anything.'}],threadId:THREAD,requestIntentId:INTENT,interactive:{kind:'message'},
  })}));
  let wire='',streamError=false;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  try{
    for(;;){const next=await reader.read();if(next.done)break;wire+=decoder.decode(next.value,{stream:true});
      if(mode==='consumer_cancel'){await reader.cancel();await settleWithin(finished);break;}}
    wire+=decoder.decode();
  }catch{streamError=true;}
  const stateReads=rec.rpc.filter(call=>call.name==='paige_chat_interactive_executor_v2'&&call.args?.p_operation==='state').length;
  const effects=rec.inserts.filter(row=>row.table!=='paige_llm_trace');
  const authorities=rec.rpc.filter(call=>call.name==='paige_chat_interactive_executor_v2'||call.name==='paige_chat_interactive_settle');
  check(effects.length===0&&rec.functions.length===0,`${mode}: no business write or sibling execution`);
  check(authorities.every(call=>call.args.p_actor===USER&&call.args.p_tenant===TENANT&&call.args.p_thread===THREAD&&call.args.p_intent===INTENT),`${mode}: original actor/tenant/thread/intent retained`);
  if(mode==='foreign_thread'){
    check(response.status>=400&&fixture.modelCalls.length===0&&fixture.settlements.length===0&&authorities.length===0,`${mode}: invisible foreign thread refuses before admission/model/settlement`);
  }else if(['normal','lost_ack'].includes(mode)){
    check(response.status===200&&fixture.modelCalls.length===4&&fixture.modelCalls.filter(call=>call.stream).length===3,`${mode}: actual classifier and two-tool-plus-answer loop`);
    check(stateReads>0&&stateReads<=80,`${mode}: packed provider records keep native state reads bounded`);
    check(fixture.settlements.length===1&&fixture.terminal&&fixture.executor===null&&!streamError&&wire.includes('[DONE]'),`${mode}: one canonical receipt/readback and release without replay`);
  }else if(mode==='receipt_unknown'){
    check(!fixture.terminal&&fixture.executor===INTENT&&streamError,`${mode}: unconfirmed receipt retains executor, no fabricated settlement`);
    check(fixture.modelCalls.length===4,`${mode}: no new model/round replay after receipt uncertainty`);
  }else if(mode==='scope_changed'||mode==='actor_revoked'){
    check(!fixture.terminal&&fixture.executor===INTENT&&!wire.includes('Neutral guidance.'),`${mode}: late authority refusal withholds answer and retains uncertainty`);
  }else if(mode==='superseded'){
    check(fixture.latest===NEXT&&fixture.terminal&&fixture.executor===null&&!wire.includes('Neutral guidance.'),`${mode}: original interrupted receipt does not publish stale answer or overwrite successor intent`);
    check(fixture.settlements.every(args=>args.p_bundle_ref?.turn_state?.state==='INTERRUPTED'),`${mode}: saved terminal remains interrupted`);
  }else if(mode==='consumer_cancel'){
    check(fixture.terminal&&fixture.executor===null&&fixture.settlements.length===1,`${mode}: actual disconnected consumer does not abandon canonical producer settlement`);
  }
  summaries.push({mode,status:response.status,stateReads,modelCalls:fixture.modelCalls.length,settlements:fixture.settlements.length,terminal:fixture.terminal,released:fixture.executor===null,streamError});
}
console.log(JSON.stringify(summaries,null,2));
console.log(`chat-openai-stream-batching: ${passed} passed, ${failed} failed`);
if(failed)process.exitCode=1;
