// Actual production Chat handler, loaded by scripts/knowledge-scope/register.mjs.
// Boundary ports record synthetic Supabase/provider traffic only; no network, signed
// JWT, native authority, native effect, future delivery or customer acceptance proof.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = n => `a2350000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4), proposal = id(5), issued = id(6);
const item = id(7), audit = id(8), work = id(9), client = id(10), execution = id(11);
const deployment = `abcdefghijklmnopqrst_${id(12)}_447`;
const stored = { title: 'Neutral Welcome FAQ', content: 'Approved business FAQ. Sessions are arranged with the team.', purpose: 'cura_customer_knowledge' };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
let active, modelBodies = [], modelRound = 0, forbiddenNetwork = [];
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
  SB_EXECUTION_ID: active?.unbound ? '' : execution, DENO_DEPLOYMENT_ID: active?.unbound ? '' : deployment })[key] ?? '' } };
globalThis.fetch = async (url, options = {}) => {
  if (new URL(String(url)).hostname !== 'api.anthropic.com') {
    forbiddenNetwork.push(String(url)); throw Error('CURA_PROOF_NETWORK_FORBIDDEN');
  }
  const body = JSON.parse(options.body); modelBodies.push(body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text',
    text: JSON.stringify({ intent: 'act', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .99 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  if (!body.stream) return Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } });
  modelRound++;
  const uses = modelRound === 1 ? active.modelTools : [];
  const events = [{ type: 'message_start', message: { usage: { input_tokens: 1 } } },
    ...uses.flatMap((use, index) => [{ type: 'content_block_start', index,
      content_block: { type: 'tool_use', id: `cura-model-${index}`, name: use.name } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(use.args) } }]),
    ...(!uses.length ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Use only the verified tool result; scheduling is not delivery.' } }] : []),
    { type: 'message_delta', delta: { stop_reason: uses.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
globalThis.WebSocket = class { constructor() { forbiddenNetwork.push('WebSocket'); throw Error('CURA_PROOF_NETWORK_FORBIDDEN'); } };
const fake = await import('../knowledge-scope/fake-supabase.mjs');
const probe = fake.createClient('', 'anon-key');
const clientProto = Object.getPrototypeOf(probe), originalRpc = clientProto.rpc;
clientProto.rpc = function (name, args) {
  active?.timeline.push({ kind: 'rpc', name, client: this._kind, args: structuredClone(args ?? {}) });
  return originalRpc.call(this, name, args);
};
// Only the database transport is modeled. Honor actual selection/projection/CAS
// predicates so missing fields and foreign/expired rows cannot become fake passes.
const queryProto = Object.getPrototypeOf(probe.from('unused'));
const originalRows = queryProto._rows;
const matches = (row, filters) => filters.every(([op, key, value, other]) => {
  const actual = row[key];
  if (op === 'eq') return actual === value;
  if (op === 'neq') return actual != null && value != null && actual !== value;
  if (op === 'is') return actual === value;
  if (op === 'in') return value.includes(actual);
  if (op === 'not' && value === 'is') return actual !== other;
  if (op === 'gt') return actual != null && actual > value;
  if (op === 'lte') return actual != null && actual <= value;
  if (['select', 'order', 'limit', 'abortSignal'].includes(op)) return true;
  throw Error(`Unmodeled pending-proposal filter: ${op}`);
});
queryProto._rows = function () {
  if (this._table === 'profiles' || this._table === 'paige_chat_threads') return originalRows.call(this).filter(row => matches(row, this._filters));
  if (this._table !== 'paige_pending_confirmations') return originalRows.call(this);
  const state = active;
  state.timeline.push({ kind: 'query', table: this._table, op: this._op, filters: structuredClone(this._filters) });
  if (this._op === 'insert') return [];
  let rows = state.proposals.filter(row => matches(row, this._filters));
  if (this._op === 'update') {
    if (state.claimLose) rows = [];
    else for (const row of rows) row.consumed_at = new Date().toISOString();
  }
  if (this._limit != null) rows = rows.slice(0, this._limit);
  const selection = this._filters.filter(f => f[0] === 'select').at(-1)?.[1];
  return rows.map(row => !selection || selection === '*' ? structuredClone(row)
    : Object.fromEntries(selection.split(',').map(key => [key.trim(), structuredClone(row[key.trim()])])));
};
await import('../../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('../knowledge-scope/stub-serve.mjs');
const { confirmFingerprint } = await import('../../supabase/functions/_shared/confirm-fingerprint.ts');

const results=[];const redOnly=process.argv.includes('--red-only');
const successResult=()=>({work_id:work,document_id:item,status:'claimed',revision:1,replayed:false});
function values(){return modelBodies.flatMap(b=>b.messages??[]).filter(m=>m.role==='user').flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='tool_result').flatMap(p=>{try{return[JSON.parse(p.content)]}catch{return[]}});}
async function drive(options={}){
 modelBodies=[];modelRound=0;forbiddenNetwork=[];
 const original=structuredClone(options.args??stored),currentIntent=options.intent??intent;
 const fingerprint=await confirmFingerprint('save_to_knowledge_base',{intent:await confirmFingerprint('save_to_knowledge_base',original),tenant,thread,client:null});
 const token=`${fingerprint}:${issued}`,controller=new AbortController(),receipts=[];
 active={timeline:[],tenant,held:null,hold:null,stopped:false,claimLose:options.claimLose,unbound:false,
  modelTools:options.modelTools??(options.auto||options.unapproved||options.threadless?[{name:'save_to_knowledge_base',args:options.modelArgs??original}]:[]),
  proposals:[{id:proposal,user_id:actor,tenant_id:tenant,thread_id:thread,scoped_client_id:null,tool_name:'save_to_knowledge_base',fingerprint,issued_in_request:issued,server_issued_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),consumed_at:null,args:original,summary:'Prepare the exact private CURA source.'}]};
 if(options.foreignProposal)active.proposals[0].tenant_id=id(99);
 if(options.unapproved)active.proposals=[];
 const state=active;
 const runtime=a=>({latest:a.p_intent,executor:state.held,acquired:state.held===a.p_intent,terminal:false,stopped:state.stopped,recovery_read_only:false});
 const rec=fake.setScenario({authUser:{id:actor},tables:{
  profiles:()=>[{id:id(91),user_id:actor,active_tenant_id:state.tenant},{id:id(92),user_id:id(99),active_tenant_id:id(98)}],
  tenant_members:[{tenant_id:tenant,user_id:actor,status:'active',role:'owner'}],tenants:[{id:tenant,account_type:'standalone',parent_tenant_id:null,status:'active'}],
  paige_chat_threads:()=>[{id:thread,tenant_id:tenant,caller_user_id:actor,audience:'workspace',interactive_recovery_hold:state.hold,is_archived:false}],
  paige_chat_turns:filters=>filters.some(f=>f[0]==='contains')?[]:receipts,
 },rpcs:{
  paige_chat_interactive_protocol:{data:{version:2,active:!options.inactive},error:null},check_rate_limit:{data:true,error:null},
  current_user_tenant_id:()=>({data:state.tenant,error:null}),is_platform_owner:{data:false,error:null},is_tenant_member:{data:true,error:null},
  get_actor_access:{data:{tier:'tenant'},error:null},get_team_authority_readiness:{data:[{fact_key:'viewer_permission',value:'owner',status:'available',tenant_id:tenant}],error:null},
  resolve_tool_autonomy:{data:options.auto?'auto':'confirm',error:null},resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},resolve_tool_autonomy_many:{data:[],error:null},
  get_paige_persona_context:()=>({data:[{tenant_id:state.tenant,tenant_name:null,playbook_config:null,playbook_slug:null,funding_enabled:false,brand:null}],error:null}),
  paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:id(15)},error:null},
  paige_chat_interactive_acquire_bound:a=>{state.held=a.p_intent;return{data:runtime(a),error:null}},
  paige_chat_interactive_runtime_context:a=>({data:runtime(a),error:null}),
  paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire')state.held=a.p_intent;if(a.p_operation==='release')state.held=null;return{data:runtime(a),error:null}},
  paige_chat_interactive_publication_context_v2:{data:true,error:null},
  paige_chat_interactive_settle:a=>{receipts.push({role:'assistant',content:a.p_content,bundle_ref:a.p_bundle_ref});return{data:id(16),error:null}},record_capability_run:{data:id(17),error:null},
  read_client_portal_business_knowledge:()=>({data:options.publisherDenied?null:{tenant_id:state.tenant,audience:'business'},error:options.publisherDenied?{code:'42501',message:'PRIVATE_PUBLISHER_DENIED'}:null}),
  submit_cura_knowledge_preparation:()=>{if(options.switchAfter)state.tenant=id(99);if(options.abortAfter)controller.abort();if(options.throwAck)throw Error('PRIVATE_LOST_ACK');return options.nativeReply??{data:successResult(),error:null}},
 }});
 const requestBody={messages:[{role:'user',content:'Prepare this approved FAQ for CURA review.'}],...(!options.threadless?{threadId:thread,requestIntentId:currentIntent,interactive:{kind:'message'}}:{}),...(!options.auto&&!options.unapproved?{approvedConfirmations:[token]}:{})};
 const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer test-original-jwt','Content-Type':'application/json'},body:JSON.stringify(requestBody),signal:controller.signal}));
 const wire=await response.text();assert.deepEqual(forbiddenNetwork,[],'no real network is allowed');
 return{rec,wire,values:values(),receipts,responseStatus:response.status,original,token,scope:state,calls:name=>rec.rpc.filter(x=>x.name===name)};
}
async function check(name,fn){if(redOnly&&!name.startsWith('exact approved'))return;try{await fn();results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:String(error)});process.stderr.write(name+': '+error+'\n')}}
const accepted=r=>r.values.find(v=>v.accepted===true);
const noLegacy=r=>{assert.equal(r.calls('submit_knowledge_extraction').length,0);assert.equal(r.rec.functions.filter(c=>c.name==='kb-ingest-doc').length,0);assert.equal(r.rec.inserts.filter(c=>['knowledge_docs','knowledge_chunks','client_portal_knowledge_shares'].includes(c.table)).length,0)};
await check('exact approved preparation uses original caller native wrapper and original frozen content',async()=>{const r=await drive();assert(accepted(r),JSON.stringify(r.values));assert.equal(r.calls('submit_cura_knowledge_preparation').length,1);const call=r.calls('submit_cura_knowledge_preparation')[0];assert.equal(call.client,'jwt');assert.equal(call.args.p_tenant_id,tenant);assert.equal(call.args.p_title,stored.title);assert.equal(call.args.p_input,stored.content);assert.equal(accepted(r).publication_changed,false);assert.equal(accepted(r).customer_visibility_changed,false);assert.equal(accepted(r).knowledge_doc_id,item);noLegacy(r);assert(r.rec.from.some(q=>q.table==='profiles'&&q.filters.some(f=>f[0]==='eq'&&f[1]==='user_id'&&f[2]===actor)));assert(r.wire.includes('portal_knowledge'));});
await check('same original approved act keeps native intent across fresh request intents',async()=>{const a=await drive(),b=await drive({intent:id(45),nativeReply:{data:{...successResult(),replayed:true},error:null}});assert.equal(a.calls('submit_cura_knowledge_preparation')[0].args.p_intent_id,b.calls('submit_cura_knowledge_preparation')[0].args.p_intent_id);assert.equal(accepted(b).replayed,true)});
await check('standing authorized autonomy uses verified request intent without inventing an approval',async()=>{const r=await drive({auto:true});assert(accepted(r),JSON.stringify(r.values));assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&c.update).length,0);noLegacy(r)});
for(const [name,options]of [['publisher denied',{publisherDenied:true}],['foreign original proposal',{foreignProposal:true}],['claim lost',{claimLose:true}],['malformed purpose',{auto:true,args:{...stored,purpose:'publish_customer_knowledge'}}],['unbound request',{auto:true,threadless:true}],['inactive protocol',{inactive:true}]])await check('refuses '+name+' without native submission',async()=>{const r=await drive(options);assert.equal(r.calls('submit_cura_knowledge_preparation').length,0);assert.equal(!!accepted(r),false);noLegacy(r)});
await check('unapproved preparation records only the original confirmation',async()=>{const r=await drive({unapproved:true});assert.equal(r.calls('submit_cura_knowledge_preparation').length,0);assert(r.wire.includes('paige_confirm'),JSON.stringify({values:r.values,wire:r.wire,receipts:r.receipts}));const saved=r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update);assert.equal(saved.length,1);assert.deepEqual(saved[0].row.args,stored);assert(saved[0].row.summary.includes('does not publish or share'));noLegacy(r)});
for(const [name,options]of [['lost acknowledgment',{throwAck:true}],['malformed native reply',{nativeReply:{data:{ok:true},error:null}}],['late workspace switch',{switchAfter:true}],['late abort',{abortAfter:true}]])await check(name+' never retries or claims publication',async()=>{const r=await drive(options);assert.equal(r.calls('submit_cura_knowledge_preparation').length,1);assert.equal(!!accepted(r),false);assert(!r.wire.includes('PRIVATE_'));assert(!r.values.some(v=>v.customer_visibility_changed===true||v.publication_changed===true));noLegacy(r)});
await check('an uncertain preparation holds a later mutation in the same batch',async()=>{const r=await drive({auto:true,throwAck:true,modelTools:[{name:'save_to_knowledge_base',args:stored},{name:'plan_set_reminder',args:{title:'Later fixture reminder',remind_at:'2030-01-02T10:00:00Z'}}]});assert.equal(r.calls('submit_cura_knowledge_preparation').length,1);assert.equal(r.calls('plan_set_reminder').length,0);assert.equal(r.calls('adopt_paige_reminder_approval').length,0);assert(r.values.some(v=>v.outcome_unknown===true));noLegacy(r)});
const summary={evidenceClass:'actual production handler with existing recording offline boundary ports',nativeOrAuthenticatedProof:false,results,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,sourceSHA256:createHash('sha256').update(readFileSync(path.join(root,'supabase/functions/paige-ai-chat/index.ts'))).digest('hex')};
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(out){mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(summary,null,2))}process.stdout.write(JSON.stringify(summary,null,2)+'\n');if(summary.fail)process.exitCode=1;
