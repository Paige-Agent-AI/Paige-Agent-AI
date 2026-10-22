// Actual original skill-runner + governed adapter + Model Fabric compatibility
// code, through the existing knowledge-scope SDK loader. All IO is synthetic;
// no credentials, provider spend, native permission or production acceptance.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { clearCeilingCacheForTests } from '../../supabase/functions/_shared/router-budget/mod.ts';
const id = n => `a2380000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor=id(1),tenant=id(2),contact=id(3),person=id(4),run=id(5),skill=id(6);
let active, handler, forbidden=[];
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',
 SUPABASE_SERVICE_ROLE_KEY:'service-role-key',ANTHROPIC_API_KEY:'test-key'})[key]??''},serve:fn=>{handler=fn;}};
globalThis.WebSocket=class{constructor(){forbidden.push('WebSocket');throw Error('GAME_PLAN_NETWORK_FORBIDDEN');}};
globalThis.fetch=async(url,init={})=>{
 if(new URL(String(url)).hostname!=='api.anthropic.com'){forbidden.push(String(url));throw Error('GAME_PLAN_NETWORK_FORBIDDEN');}
 active.models.push(JSON.parse(init.body));
 if(active.options.abortInModel)active.controller.abort();
 if(active.options.switchInModel)active.currentTenant=id(99);
 if(active.options.revokeInModel)active.access=false;
 if(active.options.relinkInModel)active.linked=id(99);
 if(active.options.providerThrow)throw Error('PRIVATE_PROVIDER_ERROR');
 if(active.options.providerHttp)return Response.json({error:{message:'PRIVATE_PROVIDER_ERROR'}},{status:503});
 if(active.options.providerJson)return new Response('broken json',{status:200});
 return Response.json({id:'synthetic-completion',model:'claude-test-model',content:active.options.empty?[]:
  [{type:'text',text:'Private draft: proposed next service milestone.'}],stop_reason:'end_turn',usage:{input_tokens:2,output_tokens:4}});
};
const fake=await import('../knowledge-scope/fake-supabase.mjs');
const probe=fake.createClient('','anon-key'),clientProto=Object.getPrototypeOf(probe);
const from=clientProto.from;
clientProto.from=function(table){const q=from.call(this,table);q._client=this._kind;return q;};
const qp=Object.getPrototypeOf(probe.from('unused')),record=qp._record;
qp._record=function(single){record.call(this,single);this._recorder.from.at(-1).client=this._client;};
const matches=(row,filters)=>filters.every(([op,key,value])=>{
 if(op==='eq')return row[key]===value;
 if(op==='contains')return Object.entries(value).every(([k,v])=>row[key]?.[k]===v);
 if(op==='gte')return row[key]>=value;
 if(['select','order','limit','abortSignal'].includes(op))return true;
 throw Error('Unmodeled game-plan query filter: '+op);
});
qp._rows=function(){
 const a=active,o=a.options;let rows=[];
 if(this._table==='profiles')rows=[{id:id(90),user_id:actor,active_tenant_id:tenant},{id:id(91),user_id:id(99),active_tenant_id:id(98)}];
 if(this._table==='paige_skills')rows=[{id:skill,slug:o.slug??'build_game_plan',status:o.inactive?'draft':'active',run_count:0,success_count:0,
  require_admin_confirm_first_n:o.confirmFirst?2:0,allowed_tools:['anthropic','client_memory'],risk_class:'draft',default_lane:'confirm',scoping:'platform'}];
 if(this._table==='clients'){
  a.clientReads++;
  rows=this._client==='jwt'&&!a.access?[]:[{id:o.foreignContact?id(99):contact,tenant_id:o.foreignBusiness?id(99):tenant,
   linked_user_id:o.unlinked?null:a.linked,first_name:'Test',last_name:'Customer',email:'PRIVATE_EMAIL',funding_goal:'PRIVATE_FINANCE',current_notes:'PRIVATE_NOTES'}];
 }
 if(this._table==='client_memory'){
  if(o.switchInMemory)a.currentTenant=id(99);
  if(o.abortInMemory)a.controller.abort();
  rows=[{id:id(7),client_id:contact,tenant_id:tenant,client_user_id:person,memory_type:'goal',content:'Confirmed historical service goal',
   created_at:'2026-01-01T00:00:00Z',is_active:true,metadata:{confirmation_state:'confirmed'}},
   {id:id(8),client_id:contact,tenant_id:id(99),client_user_id:person,content:'FOREIGN_BUSINESS',is_active:true,metadata:{confirmation_state:'confirmed'}},
   {id:id(9),client_id:contact,tenant_id:tenant,client_user_id:id(99),content:'FOREIGN_PERSON',is_active:true,metadata:{confirmation_state:'confirmed'}},
   {id:id(10),client_id:contact,tenant_id:tenant,client_user_id:person,content:'UNCONFIRMED',is_active:true,metadata:{confirmation_state:'proposed'}}];
 }
 if(this._table==='admin_app_settings')rows=[{key:`llm_budget_daily_usd__t_${tenant}`,value:10}];
 if(this._table==='paige_llm_trace'&&this._op==='select')rows=o.budgetBlocked?[{tenant_id:tenant,created_at:new Date().toISOString(),cost_estimate_usd:11}]:[];
 if(this._table==='paige_skill_runs'){
  const mutation=this._recorder.inserts.filter(x=>x.table===this._table).at(-1)?.row??{};
  if(this._op==='insert')a.run={id:run,...structuredClone(mutation)};
  if(this._op==='update'){
   if(o.saveThrow)throw Error('PRIVATE_SAVE_THROW');
   if(!o.saveError&&!o.saveZero)a.run={...a.run,...structuredClone(mutation)};
  }
  rows=o.saveZero&&this._op==='update'?[]:[a.run];
  if(o.wrongAck&&this._op==='update')rows=[{...a.run,id:id(99)}];
  if(o.missingOutputAck&&this._op==='update')rows=[{...a.run,outputs:{}}];
 }
 rows=rows.filter(row=>row&&matches(row,this._filters));
 const selection=this._filters.filter(f=>f[0]==='select').at(-1)?.[1];
 if(selection&&selection!=='*')rows=rows.map(row=>Object.fromEntries(selection.split(',').map(k=>[k.trim(),structuredClone(row[k.trim()])])));
 return rows.slice(0,this._limit??rows.length);
};
const result=q=>{
 const rows=q._rows();
 const error=q._table==='client_memory'&&active.options.memoryError?{code:'42501',message:'PRIVATE_MEMORY_DENIED'}:
  q._table==='paige_skill_runs'&&q._op==='update'&&active.options.saveError?{message:'PRIVATE_SAVE_ERROR'}:null;
 return{data:error?null:rows,error};
};
qp.maybeSingle=function(){this._record(true);const r=result(this);return Promise.resolve({...r,data:r.data?.[0]??null});};
qp.single=function(){return this.maybeSingle();};
qp.then=function(resolve,reject){this._record(false);return Promise.resolve().then(()=>result(this)).then(resolve,reject);};
await import('../../supabase/functions/skill-runner/index.ts');
assert.equal(typeof handler,'function','actual Deno handler captured');
async function drive(options={}){
 clearCeilingCacheForTests();forbidden=[];
 active={options,models:[],clientReads:0,controller:new AbortController(),currentTenant:tenant,linked:person,access:!options.rlsDenied,run:null};
 const state=active;
 const rec=fake.setScenario({authUser:options.unauthenticated?null:{id:actor},rpcs:{
  is_platform_owner:{data:false,error:null},is_tenant_admin_as:{data:!options.member,error:null},agency_can_manage_child:{data:false,error:null},
  current_user_tenant_id:()=>({data:state.currentTenant,error:null}),
  get_my_access:()=>{if(options.accessThrow)throw Error('PRIVATE_ACCESS_FAILURE');return{data:options.accessError?null:{tier:options.clientSeat?'client':'tenant',account_id:options.foreignAccess?id(99):state.currentTenant},error:options.accessError?{code:'42501'}:null};},
 }});
 const response=await handler(new Request('https://test.supabase.co/functions/v1/skill-runner',{method:'POST',signal:state.controller.signal,
  headers:{Authorization:`Bearer ${options.service?'service-role-key':'test-person-jwt'}`,'Content-Type':'application/json'},
  body:JSON.stringify({skill_slug:options.slug??'build_game_plan',contact_id:contact,tenant_id:id(99),invoker_user_id:id(99),
   inputs:{brief:'Propose a private service plan',...(options.slug==='research_to_concept_brief'?{topic:'Neutral service research'}:{})}})}));
 const body=await response.json();
 assert.deepEqual(forbidden,[],'no real external traffic');
 assert(!JSON.stringify(body).includes('PRIVATE_'),'private provider/database details withheld');
 assert(state.models.length<=1,'no automatic provider retry');
 assert.equal(rec.inserts.filter(x=>x.table==='client_memory').length,0,'draft never silently teaches Memory');
 return{body,status:response.status,state,rec};
}
const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e)});process.stderr.write(name+': '+e+'\n');}}
await check('original owner run records a private service draft with caller-RLS context and exact saved acknowledgement',async()=>{
 const r=await drive();assert.equal(r.body.status,'succeeded');assert.equal(r.body.outputs.game_plan,r.state.run.outputs.game_plan);
 assert.equal(r.state.run.invoker_user_id,actor);assert.equal(r.state.models.length,1);assert(r.state.clientReads>=3);
 const prompt=JSON.stringify(r.state.models);assert(prompt.includes('Confirmed historical service goal'));assert(prompt.includes('Propose a private service plan'));
 assert(!/PRIVATE_EMAIL|PRIVATE_FINANCE|PRIVATE_NOTES|FOREIGN_BUSINESS|FOREIGN_PERSON|UNCONFIRMED|ACCEL/.test(prompt));
 for(const q of r.rec.from.filter(q=>['clients','client_memory'].includes(q.table)))assert.equal(q.client,'jwt');
 const trace=r.rec.inserts.find(q=>q.table==='paige_llm_trace');assert.equal(trace.row.tenant_id,tenant);
 assert.equal(trace.row.input_excerpt,null);assert.equal(trace.row.output_excerpt,null);assert.equal(trace.row.error_message,null);
 assert(!JSON.stringify(trace).includes('Confirmed historical service goal'));
});
await check('unlinked CRM customer gets a private brief without invented login or Memory identity',async()=>{
 const r=await drive({unlinked:true});assert.equal(r.body.status,'succeeded');assert.equal(r.rec.from.filter(q=>q.table==='client_memory').length,0);
 assert(!JSON.stringify(r.state.models).includes('Confirmed historical service goal'));
});
await check('Memory denial is missing context, never a confirmed fact or fake zero-success write',async()=>{
 const r=await drive({memoryError:true});assert.equal(r.body.status,'succeeded');assert(!JSON.stringify(r.state.models).includes('Confirmed historical service goal'));
 assert.equal(r.state.run.steps_log.find(x=>x.step==='context').memory_available,false);
});
for(const [name,options]of [['foreign business',{foreignBusiness:true}],['foreign customer',{foreignContact:true}],['native RLS denial',{rlsDenied:true}],
 ['late workspace switch while reading Memory',{switchInMemory:true}],['abort before model dispatch',{abortInMemory:true}],
 ['existing budget ceiling',{budgetBlocked:true}],['unauthenticated actor',{unauthenticated:true}],['service principal',{service:true}],['inactive recipe',{inactive:true}],
 ['external client seat',{clientSeat:true}],['foreign native business access',{foreignAccess:true}],['unavailable native business authority',{accessError:true}],['thrown native authority read',{accessThrow:true}]])
 await check(name+' prevents model dispatch and never claims a saved draft',async()=>{const r=await drive(options);assert.equal(r.state.models.length,0);assert.notEqual(r.body.status,'succeeded');assert(!r.body.outputs?.game_plan);});
for(const [name,options]of [['provider transport failure',{providerThrow:true}],['provider HTTP failure',{providerHttp:true}],['malformed provider JSON',{providerJson:true}],
 ['empty provider answer',{empty:true}],['interruption during generation',{abortInModel:true}],['business changed during generation',{switchInModel:true}],
 ['actor loses CRM access during generation',{revokeInModel:true}],['relationship relinked during generation',{relinkInModel:true}]])
 await check(name+' records failure without saving generated content',async()=>{const r=await drive(options);assert.equal(r.body.status,'failed');assert.deepEqual(r.body.outputs,{});assert.equal(r.state.models.length,1);assert.equal(r.state.run.status,'failed');});
for(const [name,options]of [['lost acknowledgement',{saveThrow:true}],['resolved database error',{saveError:true}],['zero-row update',{saveZero:true}],
 ['wrong receipt identity',{wrongAck:true}],['missing output receipt',{missingOutputAck:true}]])
 await check(name+' returns only original run and unknown outcome without retry or success count',async()=>{const r=await drive(options);assert.equal(r.status,503);
  assert.equal(r.body.run_id,run);assert.equal(r.body.status,'outcome_unknown');assert.equal(r.body.outcome_unknown,true);assert(!r.body.outputs);
  assert.equal(r.rec.inserts.filter(q=>q.table==='paige_skills'&&q.update).length,0);assert.equal(r.state.models.length,1);});
await check('existing non-approving first-N member remains awaiting original confirmation',async()=>{const r=await drive({member:true,confirmFirst:true});assert.equal(r.body.status,'awaiting_confirm');assert.equal(r.state.models.length,0);});
await check('unrelated original research bespoke recipe still returns its existing brief',async()=>{const r=await drive({slug:'research_to_concept_brief'});assert.equal(r.body.status,'succeeded');assert(r.body.outputs.brief);assert.equal(r.state.clientReads,0);});
const failed=results.filter(x=>x.status==='FAIL');
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(out){mkdirSync(new URL('.',new URL(out,'file:///'+process.cwd().replaceAll('\\','/')+'/')),{recursive:true});writeFileSync(out,JSON.stringify({schema_version:1,scope:'actual original handler, synthetic SDK/provider ports only',results},null,2)+'\n');}
console.log(JSON.stringify({tests:results.length,passed:results.length-failed.length,failed:failed.length}));
if(failed.length)process.exitCode=1;
