import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {stageCuraKnowledge,observeCuraKnowledgePreparation,CURA_TEACH_PURPOSE} from '../../supabase/functions/_shared/cura-knowledge-teaching';

const id=(n:number)=>`a1b20300-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={actorId:id(1),tenantId:id(2),threadId:id(3),requestIntentId:id(4)};
const input={purpose:CURA_TEACH_PURPOSE,title:'Session FAQ',content:'The first session lasts thirty minutes.'};
let actor:string,tenant:string,publisher:boolean,mode:string;
let calls:{name:string;args:Record<string,unknown>}[];
let observations:Record<string,unknown>[];
let observedPacket:Record<string,unknown>;
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);actor=scope.actorId;tenant=scope.tenantId;publisher=true;mode='normal';calls=[];observations=[];observedPacket={contract_version:1,tenant_id:scope.tenantId,availability:'available',preparation_recorded:true,retry_authorized:false,work_id:id(5),work_status:'claimed',source_document_id:id(6),current_document_revision:1,work_updated_at:'2026-10-21T19:00:00Z'};});
afterEach(()=>vi.unstubAllGlobals());
async function submitFixture(name:string,args:Record<string,unknown>){
 if(!publisher)return{data:null,error:{code:'42501',message:'KNOWLEDGE_SCOPE_CHANGED'}};
  calls.push({name,args});
  if(mode==='throw')throw Error('private database detail');
  if(mode==='unknown')return{data:null,error:{code:'XX000',message:'private detail'}};
  if(mode==='drift')return{data:null,error:{code:'22023',message:'DURABLE_WORK_INTENT_REPLAY_MISMATCH'}};
  if(mode==='actor_switch')actor=id(9);
  if(mode==='business_switch')tenant=id(8);
  if(mode==='publisher_after_acceptance')publisher=false;
  if(mode==='malformed')return{data:{work_id:'bad',document_id:id(6)},error:null};
  return{data:{work_id:id(5),document_id:id(6),status:mode==='replay'?'succeeded':'claimed',replayed:mode==='replay',...(mode==='replay'?{}:{revision:1})},error:null};
}
function ports(){return{
 caller:{auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},
  readActiveTenant:async()=>({data:{active_tenant_id:tenant},error:null}),
  rpc:async(name:string,args?:Record<string,unknown>)=>{
   if(name==='submit_cura_knowledge_preparation')return submitFixture(name,args??{});
   if(name==='is_platform_owner')return{data:false,error:null};
   if(name==='is_tenant_member')return{data:true,error:null};
   if(name==='read_cura_knowledge_preparation'){
    observations.push(args??{});
    if(mode==='observer_throw')throw Error('private database detail');
    if(mode==='observer_error'||!publisher)return{data:null,error:{code:'42501',message:'private detail'}};
    if(mode==='observer_actor_switch')actor=id(9);
    if(mode==='observer_business_switch')tenant=id(8);
    return{data:observedPacket,error:null};
   }
   expect(name).toBe('read_client_portal_business_knowledge');
   // Exact original deployed inventory signature, not an invented expected-tenant argument.
   expect(args).toEqual({p_tenant_id:scope.tenantId,p_query:null,p_document_id:null,p_limit:1,p_offset:0});
   const allowed=publisher,snapshotTenant=tenant; if(mode==='publisher_downgrade')publisher=false; if(mode==='post_gate_business_switch'&&calls.length)tenant=id(8); if(mode==='post_gate_actor_switch'&&calls.length)actor=id(9); return allowed?{data:{tenant_id:snapshotTenant,audience:'business'},error:null}:{data:null,error:{code:'42501'}};
  }},
 admin:{rpc:async()=>{throw Error('The CURA caller must not use an admin submission port');}},
};}
it('uses caller-JWT admission and the original native paste submission and describes only private preparation',async()=>{
 const r=await stageCuraKnowledge(scope,input,ports());
 expect(r).toMatchObject({success:true,accepted:true,work_id:id(5),knowledge_doc_id:id(6),work_status:'claimed',document_revision:1,publication_changed:false,customer_visibility_changed:false});
 expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({name:'submit_cura_knowledge_preparation',args:{p_tenant_id:scope.tenantId,p_title:input.title,p_input:input.content}});
 expect(Object.keys(calls[0].args).sort()).toEqual(['p_input','p_intent_id','p_tenant_id','p_title']);expect(calls[0].args.p_intent_id).toMatch(/^[a-f0-9-]{36}$/);expect(r).not.toHaveProperty('embedded');expect(r).not.toHaveProperty('published');
});
it('keeps one native intent across changing content and refuses native payload drift without a second intent',async()=>{
 await stageCuraKnowledge(scope,input,ports());mode='drift';const r=await stageCuraKnowledge(scope,{...input,content:'Different approved text'},ports());
 expect(calls).toHaveLength(2);expect(calls[1].args.p_intent_id).toBe(calls[0].args.p_intent_id);expect(calls[1].args.p_input).not.toBe(calls[0].args.p_input);
 expect(r).toMatchObject({not_applied:true,success:false});expect(JSON.stringify(r)).not.toContain('REPLAY_MISMATCH');
});
it('pins an approved act across fresh transport intents',async()=>{
 await stageCuraKnowledge({...scope,approvedAct:'server-confirmation-token'},input,ports());
 await stageCuraKnowledge({...scope,requestIntentId:id(7),approvedAct:'server-confirmation-token'},input,ports());
 expect(calls[0].args.p_intent_id).toBe(calls[1].args.p_intent_id);
});
it('separates new owner intents and owned threads',async()=>{
 await stageCuraKnowledge(scope,input,ports());await stageCuraKnowledge({...scope,requestIntentId:id(7)},input,ports());await stageCuraKnowledge({...scope,threadId:id(8)},input,ports());
 expect(new Set(calls.map(c=>c.args.p_intent_id)).size).toBe(3);
});
it('returns existing accepted work without asserting current publication state',async()=>{
 mode='replay';const r=await stageCuraKnowledge(scope,input,ports());expect(r).toMatchObject({accepted:true,replayed:true,work_status:'succeeded',publication_changed:false});expect(r).not.toHaveProperty('published');expect(r).not.toHaveProperty('document_revision');
});
for(const modeValue of ['throw','unknown','malformed'])it(`holds ${modeValue} acknowledgement without automatic replay or database detail`,async()=>{
 mode=modeValue;const r=await stageCuraKnowledge(scope,input,ports());expect(r).toMatchObject({success:false,outcome_unknown:true});expect(calls).toHaveLength(1);expect(r).not.toHaveProperty('knowledge_doc_id');expect(JSON.stringify(r)).not.toContain('private detail');
});
for(const modeValue of ['actor_switch','business_switch'])it(`withholds private result after ${modeValue}`,async()=>{
 mode=modeValue;const r=await stageCuraKnowledge(scope,input,ports());expect(r).toMatchObject({outcome_unknown:true});expect(r).not.toHaveProperty('knowledge_doc_id');expect(r).not.toHaveProperty('work_id');expect(calls).toHaveLength(1);
});
it('refuses a different actual caller before reading or submitting',async()=>{
 actor=id(9);expect(await stageCuraKnowledge(scope,input,ports())).toMatchObject({not_applied:true});expect(calls).toHaveLength(0);
});
it('refuses absent publishing permission before any submission',async()=>{
 publisher=false;expect(await stageCuraKnowledge(scope,input,ports())).toMatchObject({not_applied:true});expect(calls).toHaveLength(0);
});
it('refuses a foreign current business before any submission',async()=>{
 tenant=id(9);expect(await stageCuraKnowledge(scope,input,ports())).toMatchObject({not_applied:true});expect(calls).toHaveLength(0);
});
for(const patch of [{actorId:id(9)},{tenant_id:id(9)},{purpose:'other'},{content:''},{title:''}])it(`refuses unsupported input ${Object.keys(patch)[0]} without native write`,async()=>{
 expect(await stageCuraKnowledge(scope,{...input,...patch},ports())).toMatchObject({not_applied:true});expect(calls).toHaveLength(0);
});
it('refuses missing verified request identity',async()=>{
 expect(await stageCuraKnowledge({...scope,requestIntentId:''},input,ports())).toMatchObject({not_applied:true});expect(calls).toHaveLength(0);
});

it('observes the same original native intent and frozen payload without another submission',async()=>{
 await stageCuraKnowledge(scope,input,ports());const r=await observeCuraKnowledgePreparation(scope,input,ports().caller);
 expect(r).toMatchObject({success:true,availability:'available',preparation_recorded:true,work_id:id(5),knowledge_doc_id:id(6),retry_authorized:false});
 expect(observations).toEqual([{p_tenant_id:scope.tenantId,p_intent_id:calls[0].args.p_intent_id,p_title:input.title,p_input:input.content}]);expect(calls).toHaveLength(1);
 expect(r).not.toHaveProperty('published');expect(r).not.toHaveProperty('customer_visibility_changed');
});
it('observes a stable approved act across fresh transport identities',async()=>{
 await observeCuraKnowledgePreparation({...scope,approvedAct:'original-approved-act'},input,ports().caller);
 await observeCuraKnowledgePreparation({...scope,requestIntentId:id(8),approvedAct:'original-approved-act'},input,ports().caller);
 expect(observations[0].p_intent_id).toBe(observations[1].p_intent_id);expect(calls).toHaveLength(0);
});
it('does not turn unavailable readback into proof of non-application or retry authority',async()=>{
 observedPacket={contract_version:1,tenant_id:scope.tenantId,availability:'unavailable',preparation_recorded:null,retry_authorized:false};
 const r=await observeCuraKnowledgePreparation(scope,input,ports().caller);expect(r).toEqual({success:false,ok:false,availability:'unavailable',preparation_recorded:null,retry_authorized:false});
 expect(r).not.toHaveProperty('not_applied');expect(r).not.toHaveProperty('work_id');expect(observations).toHaveLength(1);expect(calls).toHaveLength(0);
});
it('preserves uncertain original work without a completed/publication/hold-clear claim',async()=>{
 observedPacket.work_status='outcome_unknown';const r=await observeCuraKnowledgePreparation(scope,input,ports().caller);
 expect(r).toMatchObject({success:true,preparation_recorded:true,work_status:'outcome_unknown',retry_authorized:false});expect(r).not.toHaveProperty('recovery_hold_cleared');expect(calls).toHaveLength(0);
});
it('retains original recorded acceptance when the current source no longer exists',async()=>{
 observedPacket.source_document_id=null;observedPacket.current_document_revision=null;
 expect(await observeCuraKnowledgePreparation(scope,input,ports().caller)).toMatchObject({preparation_recorded:true,knowledge_doc_id:null,current_document_revision:null});expect(calls).toHaveLength(0);
});
for(const patch of [{tenant_id:id(9)},{work_id:'bad'},{retry_authorized:true},{raw_input:'private text'},{work_status:'published'},{work_status:['claimed']},{current_document_revision:0},{work_updated_at:'bad'},{source_document_id:null}])it('withholds malformed or widened native metadata '+Object.keys(patch)[0],async()=>{
 Object.assign(observedPacket,patch);const r=await observeCuraKnowledgePreparation(scope,input,ports().caller);expect(r).toMatchObject({success:false,availability:'unavailable',retry_authorized:false});expect(r).not.toHaveProperty('work_id');expect(JSON.stringify(r)).not.toContain('private text');expect(calls).toHaveLength(0);
});
for(const value of ['observer_throw','observer_error','observer_actor_switch','observer_business_switch'])it('withholds observation after '+value+' without effects or private details',async()=>{
 mode=value;const r=await observeCuraKnowledgePreparation(scope,input,ports().caller);expect(r).toMatchObject({availability:'unavailable',preparation_recorded:null,retry_authorized:false});expect(r).not.toHaveProperty('work_id');expect(JSON.stringify(r)).not.toContain('private detail');expect(observations).toHaveLength(1);expect(calls).toHaveLength(0);
});
it('enforces current publisher authority at the native read port',async()=>{publisher=false;expect(await observeCuraKnowledgePreparation(scope,input,ports().caller)).toMatchObject({availability:'unavailable'});expect(calls).toHaveLength(0);});
for(const patch of [{tenant_id:id(9)},{purpose:'other'},{content:''},{title:''}])it('rejects unsupported observation input '+Object.keys(patch)[0]+' before any read',async()=>{
 expect(await observeCuraKnowledgePreparation(scope,{...input,...patch},ports().caller)).toMatchObject({availability:'unavailable',preparation_recorded:null});expect(observations).toHaveLength(0);expect(calls).toHaveLength(0);
});

it('refuses a publisher downgrade committed between preflight and native submission',async()=>{
 mode='publisher_downgrade'; const r=await stageCuraKnowledge(scope,input,ports());
 expect(r).toMatchObject({success:false,not_applied:true}); expect(calls).toHaveLength(0);
});

it('withholds a recorded private result if publishing authority is lost after acceptance',async()=>{
 mode='publisher_after_acceptance';const r=await stageCuraKnowledge(scope,input,ports());
 expect(r).toMatchObject({success:false,outcome_unknown:true});expect(r).not.toHaveProperty('work_id');expect(r).not.toHaveProperty('not_applied');expect(calls).toHaveLength(1);
});

for(const value of ['post_gate_business_switch','post_gate_actor_switch'])it('withholds original private IDs after '+value,async()=>{
 mode=value;const r=await stageCuraKnowledge(scope,input,ports());expect(r).toMatchObject({success:false,outcome_unknown:true});expect(r).not.toHaveProperty('work_id');expect(r).not.toHaveProperty('not_applied');expect(calls).toHaveLength(1);
});
