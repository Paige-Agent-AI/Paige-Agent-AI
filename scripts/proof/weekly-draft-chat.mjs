// Actual production Chat handler, loaded by scripts/knowledge-scope/register.mjs.
// Boundary ports record synthetic Supabase/provider traffic only; no network, signed
// JWT, native authority, native effect, future delivery or customer acceptance proof.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = n => `a2350000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4), proposal = id(5), issued = id(6);
const execution = id(11);
const deployment = `abcdefghijklmnopqrst_${id(12)}_447`;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
let active, modelBodies = [], modelRound = 0, forbiddenNetwork = [];
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
  SB_EXECUTION_ID: active?.unbound ? '' : execution, DENO_DEPLOYMENT_ID: active?.unbound ? '' : deployment })[key] ?? '' } };
globalThis.fetch = async (url, options = {}) => {
  if (new URL(String(url)).hostname !== 'api.anthropic.com') {
    forbiddenNetwork.push(String(url)); throw Error('WEEKLY_DRAFT_PROOF_NETWORK_FORBIDDEN');
  }
  const body = JSON.parse(options.body); modelBodies.push(body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text',
    text: JSON.stringify({ intent: 'act', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .99 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  if (!body.stream) return Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } });
  modelRound++;
  const uses = modelRound === 1 ? active.modelTools : [];
  const events = [{ type: 'message_start', message: { usage: { input_tokens: 1 } } },
    ...uses.flatMap((use, index) => [{ type: 'content_block_start', index,
      content_block: { type: 'tool_use', id: `weekly-model-${index}`, name: use.name } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(use.args) } }]),
    ...(!uses.length ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Use only the verified tool result; scheduling is not delivery.' } }] : []),
    { type: 'message_delta', delta: { stop_reason: uses.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
globalThis.WebSocket = class { constructor() { forbiddenNetwork.push('WebSocket'); throw Error('WEEKLY_DRAFT_PROOF_NETWORK_FORBIDDEN'); } };
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
  if (this._table !== 'paige_pending_confirmations') return originalRows.call(this);
  const state = active;
  state.timeline.push({ kind: 'query', table: this._table, op: this._op, filters: structuredClone(this._filters) });
  if (this._op === 'insert') {
    const insert = this._recorder.inserts.filter(c => c.table === this._table && !c.update && !c.upsert).at(-1);
    if (!insert) throw Error('Missing recorded original proposal insert');
    state.inserted ??= new WeakSet();
    if (!state.inserted.has(insert.row)) {
      state.inserted.add(insert.row);
      state.proposals.push({ ...structuredClone(insert.row), id: id(30 + state.proposals.length),
        consumed_at: null, expires_at: new Date(Date.now() + 600000).toISOString() });
    }
    return [{ expires_at: state.proposals.at(-1).expires_at }];
  }
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


const resultRows = [], requestId = id(21), automationId = id(22), receiptId = id(23);
const clone = value => structuredClone(value);
const exactArgs = () => ({_request_id: requestId, _name: 'Neutral weekly responsibility', _weekday: 1,
  _local_time: '09:00', _timezone: 'America/New_York'});
const nativeState = phase => ({ok: true, actor_id: actor, tenant_id: tenant, thread_id: thread,
  confirmation_id: proposal, request_id: requestId, phase, read_at: new Date().toISOString(),
  expires_at: new Date(Date.now()+600000).toISOString(), summary: 'Neutral exact draft only',
  draft: {name: 'Neutral weekly responsibility', weekday: 1, local_time: '09:00', timezone: 'America/New_York'},
  confirmation_token: null, automation_id: phase==='saved'?automationId:null, revision: phase==='saved'?1:null,
  process_state: phase==='saved'?'draft':null, receipt_id: phase==='saved'?receiptId:null, recurrence_authorized: false});
async function driveWeekly(options={}) {
  modelBodies=[]; modelRound=0; forbiddenNetwork=[];
  const args=exactArgs(), tool='weekly_commitment_draft';
  const fingerprint=await confirmFingerprint(tool,{intent:await confirmFingerprint(tool,args),tenant,thread,client:null});
  const token=fingerprint+':'+issued, settled=[], controller=new AbortController();
  active={timeline:[], tenant, held:null, stopped:false, runtimeRefused:false, hold:null, unbound:false,
    proposals:[{id:proposal,user_id:actor,tenant_id:tenant,thread_id:thread,scoped_client_id:null,tool_name:tool,
      fingerprint,issued_in_request:issued,server_issued_at:new Date(Date.now()-60000).toISOString(),
      expires_at:new Date(Date.now()+(options.expired?-10000:600000)).toISOString(),
      consumed_at:options.consumed?new Date().toISOString():null,args,summary:'Neutral exact draft only'}],
    modelTools:options.modelTools??[]};
  const state=active;
  if(options.fresh&&!options.pendingResume)state.proposals=[];
  if(options.foreignProposal)state.proposals[0].tenant_id=id(99);
  const runtime=a=>({latest:state.runtimeRefused?id(98):a.p_intent,executor:state.held,
    acquired:state.held===a.p_intent,terminal:false,stopped:state.stopped,recovery_read_only:false});
  const rec=fake.setScenario({authUser:{id:actor},tables:{
    profiles:()=>[{active_tenant_id:state.tenant}],
    tenant_members:[{tenant_id:tenant,user_id:actor,status:'active',role:options.member?'member':'owner'}],
    tenants:[{id:tenant,account_type:'standalone',parent_tenant_id:null,status:'active'}],
    paige_chat_threads:()=>[{id:thread,tenant_id:state.tenant,caller_user_id:actor,audience:'workspace',
      interactive_recovery_hold:state.hold,is_archived:false}],
    paige_chat_turns:filters=>filters.some(f=>f[0]==='contains')?[]:settled,
  },rpcs:{
    paige_chat_interactive_protocol:{data:{version:2,active:true},error:null},
    check_rate_limit:{data:true,error:null},
    current_user_tenant_id:()=>({data:state.tenant,error:null}),
    is_platform_owner:{data:false,error:null},get_actor_access:{data:{tier:'tenant'},error:null},
    get_team_authority_readiness:{data:[{fact_key:'viewer_permission',value:options.member?'member':'owner',status:'available',tenant_id:tenant}],error:null},
    weekly_commitment_owner:()=>({data:!options.member&&state.tenant===tenant,error:null}),
    resolve_tool_autonomy:{data:options.off?'off':'confirm',error:null},
    resolve_tool_autonomy_detail:{data:{ceiling_allows_auto:true},error:null},
    resolve_tool_autonomy_many:{data:[],error:null},
    get_paige_persona_context:()=>({data:[{tenant_id:state.tenant,tenant_name:null,playbook_config:null,playbook_slug:null,
      funding_enabled:false,brand:null}],error:null}),
    paige_chat_interactive_begin_v2:{data:{status:'accepted',turn_id:id(15)},error:null},
    paige_chat_interactive_acquire_bound:a=>{state.held=a.p_intent;return{data:runtime(a),error:null};},
    paige_chat_interactive_runtime_context:a=>({data:runtime(a),error:null}),
    paige_chat_interactive_executor_v2:a=>{if(a.p_operation==='acquire')state.held=a.p_intent;
      if(a.p_operation==='release')state.held=null;return{data:runtime(a),error:null};},
    paige_chat_interactive_publication_context_v2:{data:true,error:null},
    paige_chat_interactive_settle:a=>{settled.push({role:'assistant',content:a.p_content,bundle_ref:a.p_bundle_ref});return{data:id(16),error:null};},
    record_capability_run:{data:id(17),error:null},
    claim_weekly_commitment_chat_draft:()=>{
      if(options.claimLost)throw Error('PRIVATE_CLAIM_LOST_ACK');
      if(options.afterClaim==='scope')state.tenant=id(99);
      if(options.afterClaim==='stop')state.stopped=true;
      if(options.afterClaim==='abort')controller.abort();
      state.proposals[0].consumed_at=new Date().toISOString();
      return{data:options.observed?{claimed:false,state:nativeState(options.observed),thread_id:thread}:
        {claimed:true,confirmation_id:proposal,actor_id:actor,tenant_id:tenant,args:clone(args),thread_id:thread},error:null};
    },
    commit_weekly_commitment_chat_draft:()=>{
      if(options.commitLost)throw Error('PRIVATE_COMMIT_LOST_ACK');
      return{data:{...nativeState('saved'),...(options.foreignResult?{tenant_id:id(99)}:{})},error:null};
    },
    decline_weekly_commitment_chat_draft:()=>{
      if(options.declineLost)throw Error('PRIVATE_DECLINE_LOST_ACK');
      return{data:nativeState(options.saveWon?'saved':'declined'),error:null};
    },
    read_weekly_commitment_chat_draft:()=>({data:nativeState(options.readPhase??(options.declined?'declined':'saved')),error:null}),
  }});
  const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{
    method:'POST',headers:{Authorization:'Bearer test-original-jwt','Content-Type':'application/json'},
    body:JSON.stringify({messages:[{role:'user',content:options.fresh?'Prepare only a private weekly responsibility draft for Monday at 09:00 America/New_York; do not enable or run it.':options.declined?'Not now for this stored weekly draft.':'Approved: save only this exact weekly definition as an unapproved draft.'}],
      threadId:thread,requestIntentId:intent,interactive:{kind:'message'},
      ...(options.fresh?{}:options.declined?{declinedConfirmations:[token]}:{approvedConfirmations:[token]})}),signal:controller.signal}));
  const wire=await response.text();
  assert.deepEqual(forbiddenNetwork,[],'No network/provider transport may escape the existing offline ports');
  const values=modelBodies.flatMap(b=>b.messages??[]).filter(m=>m.role==='user')
    .flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='tool_result')
    .flatMap(p=>{try{return[JSON.parse(p.content)];}catch{return[];}});
  return{rec,wire,values,settled,state,token,args,offered:modelBodies.filter(b=>b.stream).flatMap(b=>b.tools??[]),
    calls:name=>rec.rpc.filter(c=>c.name===name),
    genericCAS:()=>state.timeline.filter(c=>c.kind==='query'&&c.op==='update')};
}
function noFallback(r){
  assert.equal(r.genericCAS().length,0,'Native selection must precede and exclude generic proposal consumption');
  assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update).length,0,'No replacement proposal on an approval/recovery turn');
  assert.equal(r.rec.functions.length,0,'No substitute Edge executor or provider path');
  assert.equal(r.calls('commit_weekly_commitment_draft').length,0,'Never use the owner-UI writer from Chat');
  assert.equal(r.calls('dispatch_automation').length,0,'Saving a draft never runs it');
  assert.ok(!r.wire.includes('PRIVATE_'),'Do not expose private native errors');
}
async function check(name,fn){try{await fn();resultRows.push({name,status:'PASS'});console.log('PASS '+name);}
catch(e){resultRows.push({name,status:'FAIL',error:e.message});console.log('FAIL '+name+': '+e.message);}}
await check('Exact stored approval reaches one original-JWT native claim and one commit, with no generic CAS',async()=>{
  const r=await driveWeekly();
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1,'Original native Chat claim not reached');
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1,'Original native Chat commit not reached');
  noFallback(r);
  const claim=r.calls('claim_weekly_commitment_chat_draft')[0],commit=r.calls('commit_weekly_commitment_chat_draft')[0];
  assert.equal(claim.client,'jwt');assert.equal(commit.client,'jwt');
  assert.deepEqual(commit.args._expected_args,r.args,'Use exact stored native args, never model reconstruction');
  assert.equal(claim.args._confirmation_id,proposal);assert.equal(commit.args._confirmation_id,proposal);
  const bound=r.calls('paige_chat_interactive_acquire_bound')[0];
  assert.equal(claim.args._intent_id,intent);assert.equal(claim.args._runtime_request_nonce,bound.args.p_request_nonce);
  assert.equal(commit.args._intent_id,intent);assert.equal(commit.args._runtime_request_nonce,bound.args.p_request_nonce);
  assert.notEqual(commit.args._request_nonce,issued);
  assert.ok(r.values.some(v=>JSON.stringify(v).includes(receiptId)),'Original receipt must reach verified result projection');
});
await check('Decline uses original native refusal before generic consumption and never commits',async()=>{
  const r=await driveWeekly({declined:true});
  assert.equal(r.calls('decline_weekly_commitment_chat_draft').length,1,'Original native Chat decline not reached');
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);noFallback(r);
});
await check('Lost commit acknowledgement reads only the original outcome and never writes twice',async()=>{
  const r=await driveWeekly({commitLost:true});
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);
  noFallback(r);
});
for(const phase of ['saved','changed','declined','unknown'])await check('Native observed '+phase+' never authorizes a fresh commit',async()=>{
  const r=await driveWeekly({observed:phase});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);noFallback(r);
});
await check('Lost native claim never becomes generic CAS, fresh commit or replacement proposal',async()=>{
  const r=await driveWeekly({claimLost:true});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);noFallback(r);
});
await check('Lost decline reads its original refusal without a second mutation',async()=>{
  const r=await driveWeekly({declined:true,declineLost:true});
  assert.equal(r.calls('decline_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);noFallback(r);
});
const intentArgs = { name: 'Neutral weekly responsibility', weekday: 1, local_time: '09:00', timezone: 'America/New_York' };
await check('Fresh request prepares exactly five native stored args with a server-issued UUID, without saving or enabling',async()=>{
  const r=await driveWeekly({fresh:true,modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  const declared=r.offered.find(t=>t.name==='weekly_commitment_draft');
  assert.ok(declared,'The original domain tool must actually be offered, not merely registered');
  assert.deepEqual(Object.keys(declared.input_schema.properties).sort(),Object.keys(intentArgs).sort());
  const inserted=r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update&&!c.upsert);
  assert.equal(inserted.length,1,'Exactly one original pending proposal');
  const saved=inserted[0].row;
  assert.deepEqual(Object.keys(saved.args).sort(),Object.keys(exactArgs()).sort());
  assert.ok(uuid(saved.args._request_id),'Original server request identity is required');
  assert.notEqual(saved.args._request_id,requestId,'Never reuse an unrelated seeded request identity');
  assert.deepEqual({...saved.args,_request_id:requestId},exactArgs());
  assert.equal(saved.tenant_id,tenant);assert.equal(saved.user_id,actor);assert.equal(saved.thread_id,thread);
  assert.equal(saved.scoped_client_id,null);assert.ok(uuid(saved.issued_in_request));
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('dispatch_automation').length,0);
  assert.ok(r.values.some(v=>v.needs_confirm===true),'Original surface approval must be required');
});
await check('Duplicate same-round preparation reuses the original exact proposal/request identity',async()=>{
  const r=await driveWeekly({fresh:true,modelTools:[{name:'weekly_commitment_draft',args:intentArgs},
    {name:'weekly_commitment_draft',args:{...intentArgs}}]});
  assert.ok(r.offered.some(t=>t.name==='weekly_commitment_draft'),'Require the real offered positive path');
  assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update&&!c.upsert).length,1);
  assert.equal(r.state.proposals.length,1,'A duplicate model emission cannot mint a second request UUID/card');
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
});
await check('Returning exact draft request reuses the original pending proposal and server request UUID',async()=>{
  const r=await driveWeekly({fresh:true,pendingResume:true,modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  assert.ok(r.offered.some(t=>t.name==='weekly_commitment_draft'),'Require the real original offered tool');
  assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update&&!c.upsert).length,0);
  assert.equal(r.state.proposals.length,1);
  assert.equal(r.state.proposals[0].args._request_id,requestId,'Keep exact original server identity across requests');
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.ok(r.values.some(v=>v.needs_confirm===true&&v.confirm_fingerprint===r.token));
});
await check('Model-supplied native request identity cannot prepare a different approval',async()=>{
  const r=await driveWeekly({fresh:true,modelTools:[{name:'weekly_commitment_draft',args:{...intentArgs,_request_id:id(99)}}]});
  assert.ok(r.offered.some(t=>t.name==='weekly_commitment_draft'),'Require the real original offered tool');
  assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update&&!c.upsert).length,0);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.ok(!r.values.some(v=>v.needs_confirm===true));
});
for(const afterClaim of ['scope','stop','abort'])await check('Original '+afterClaim+' retirement after claim never commits or falls through',async()=>{
  const r=await driveWeekly({afterClaim});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1,'Reach native claim before testing retirement');
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);noFallback(r);
});
await check('Foreign native result cannot be represented as a verified saved draft',async()=>{
  const r=await driveWeekly({foreignResult:true});
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1,'Require the original positive dispatch first');
  assert.ok(!r.values.some(v=>JSON.stringify(v).includes(receiptId)),'Never expose foreign receipt as verified success');
  noFallback(r);
});
const output={evidenceClass:'PRIVATE RED preparation: actual current handler, existing offline recording ports',
  sourceSHA256:createHash('sha256').update(readFileSync(path.join(root,'supabase/functions/paige-ai-chat/index.ts'))).digest('hex'),
  passed:resultRows.filter(r=>r.status==='PASS').length,failed:resultRows.filter(r=>r.status==='FAIL').length,cases:resultRows,
  boundary:'No native authentication/effects, provider traffic, customer success, release or acceptance is proven by this offline harness.'};
writeFileSync(path.join(root,'work/weekly-draft-chat-result.json'),JSON.stringify(output,null,2)+'\n');
console.log('RESULT '+output.passed+' PASS / '+output.failed+' FAIL');
if(output.failed)process.exitCode=1;
