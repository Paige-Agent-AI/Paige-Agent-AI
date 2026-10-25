// Actual production Chat handler, loaded by scripts/knowledge-scope/register.mjs.
// Boundary ports record synthetic Supabase/provider traffic only; no network, signed
// JWT, native authority, native effect, future delivery or customer acceptance proof.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
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
    else for (const row of rows) { (state.appliedProposalUpdates??=[]).push(row.id); row.consumed_at = new Date().toISOString(); }
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
  confirmation_token: null, automation_id: ['saved','saved_unreceipted','changed'].includes(phase)?automationId:null,
  revision: phase==='changed'?2:['saved','saved_unreceipted'].includes(phase)?1:null,
  process_state: phase==='changed'?'paused':['saved','saved_unreceipted'].includes(phase)?'draft':null,
  receipt_id: ['saved','changed'].includes(phase)?receiptId:null, recurrence_authorized: false});
async function driveWeekly(options={}) {
  modelBodies=[]; modelRound=0; forbiddenNetwork=[];
  const args=options.otherTool?{title:'Neutral unrelated reminder',remind_at:'2030-01-02T10:00:00Z',target:'user',channel:'in_app'}:exactArgs(), tool=options.otherTool??'weekly_commitment_draft';
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
    resolve_tool_autonomy_many:a=>({data:a._tool_keys.map(tool_key=>({tool_key,mode:options.off?'off':'confirm'})),error:null}),
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
      if(options.expired)return{data:null,error:{code:'42501',message:'PRIVATE_EXPIRED_APPROVAL'}};
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
    read_weekly_commitment_chat_draft:()=>({data:{...nativeState(options.readPhase??(options.declined?'declined':'saved')),
      ...(options.foreignRead?{tenant_id:id(99)}:{})},error:null}),
  }});
  const response=await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{
    method:'POST',headers:{Authorization:'Bearer test-original-jwt','Content-Type':'application/json'},
    body:JSON.stringify({messages:[{role:'user',content:options.fresh?'Prepare only a private weekly responsibility draft for Monday at 09:00 America/New_York; do not enable or run it.':options.declined?'Not now for this stored weekly draft.':'Approved: save only this exact weekly definition as an unapproved draft.'}],
      threadId:thread,requestIntentId:intent,interactive:{kind:'message'},
      ...(options.fresh?{}:options.declined?{declinedConfirmations:[token]}:{approvedConfirmations:[options.legacyToken?fingerprint:token]})}),signal:controller.signal}));
  const wire=await response.text();
  const approvalOutcomes=wire.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{try { const frame=JSON.parse(line.slice(6));return frame.paige_approval_outcome?[frame.paige_approval_outcome]:[]; } catch { return []; }});
  const confirmations=wire.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{
    try { const frame=JSON.parse(line.slice(6));return frame.paige_confirm?[frame.paige_confirm]:[]; } catch { return []; }
  });
  assert.deepEqual(forbiddenNetwork,[],'No network/provider transport may escape the existing offline ports');
  const values=modelBodies.flatMap(b=>b.messages??[]).filter(m=>m.role==='user')
    .flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='tool_result')
    .flatMap(p=>{try{return[JSON.parse(p.content)];}catch{return[];}});
  const originalObservations=modelBodies.flatMap(b=>typeof b.system==='string'?b.system.split('\n'):[])
    .flatMap(line=>{try{const value=JSON.parse(line);return value.data_kind==='original_weekly_draft'?[value]:[];}catch{return[];}});
  return{rec,wire,values,originalObservations,settled,state,token,args,status:response.status,approvalOutcomes,confirmations,offered:modelBodies.filter(b=>b.stream).flatMap(b=>b.tools??[]),
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
function originalReferences(r) {
  const effect=r.settled.at(-1)?.bundle_ref?.interactive?.effects?.find(e=>e.tool==='weekly_commitment_draft');
  assert.equal(effect?.run_id,requestId,'Persist the original native request, never the receipt row as its run identity');
  assert.deepEqual(effect?.record_refs,[{kind:'automation',id:automationId}],'Later sessions need the same canonical definition reference');
  assert.ok(!JSON.stringify(effect).includes(proposal),'Do not persist the private approval selector as an outcome');
  assert.ok(!JSON.stringify(effect).includes(r.token),'Do not persist approval credentials as an outcome');
}
async function check(name,fn){try{await fn();resultRows.push({name,status:'PASS'});console.log('PASS '+name);}
catch(e){resultRows.push({name,status:'FAIL',error:e.message});console.log('FAIL '+name+': '+e.message);}}
await check('Exact stored approval reaches one original-JWT native claim and one commit, with no generic CAS',async()=>{
  const r=await driveWeekly();
  assert.equal(r.status,200,'The complete original Chat exchange must return normally');
  assert.equal(r.settled.at(-1)?.bundle_ref?.turn_state?.state,'FINAL','A completed original save must persist a final turn, not a recovery hold');
  assert.equal(r.settled.at(-1)?.bundle_ref?.paige_resume?.approval_outcome?.actions.find(a=>a.fingerprint===r.token)?.outcome,'ran','Later-session approval summary must agree with the emitted card');
  originalReferences(r);
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
  assert.equal(r.approvalOutcomes.at(-1)?.actions.find(a=>a.fingerprint===r.token)?.outcome,'ran','The real approval card must agree with the original verified native save');
});
await check('Decline uses original native refusal before generic consumption and never commits',async()=>{
  const r=await driveWeekly({declined:true});
  assert.equal(r.status,200,'A recorded decline cannot hide a later startup failure');
  assert.equal(r.calls('decline_weekly_commitment_chat_draft').length,1,'Original native Chat decline not reached');
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);noFallback(r);
});
await check('Lost commit acknowledgement reads only the original outcome and never writes twice',async()=>{
  const r=await driveWeekly({commitLost:true});
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);
  assert.equal(r.approvalOutcomes.at(-1)?.actions.find(a=>a.fingerprint===r.token)?.outcome,'ran','Recovered original save and card must agree');
  noFallback(r);
});
for(const phase of ['saved','changed','declined','unknown'])await check('Native observed '+phase+' never authorizes a fresh commit',async()=>{
  const r=await driveWeekly({observed:phase});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1);
  assert.equal(r.approvalOutcomes.at(-1)?.actions.find(a=>a.fingerprint===r.token)?.outcome,phase==='saved'?'ran':'unconfirmed','Original observed outcome uses the existing truthful card classifier');
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);noFallback(r);
  assert.ok(r.values.some(v=>v.original_outcome?.phase===phase),'Preserve the actual original phase, not an unavailable substitute');
  if(['saved','changed'].includes(phase))originalReferences(r);
  if(phase==='unknown')assert.equal(r.settled.at(-1)?.bundle_ref?.interactive?.effects?.find(e=>e.tool==='weekly_commitment_draft')?.outcome,'outcome_unknown');
});
await check('Lost save acknowledgement preserves the original changed record without treating its old draft as current',async()=>{
  const r=await driveWeekly({commitLost:true,readPhase:'changed'});
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);
  assert.ok(r.values.some(v=>v.original_outcome?.phase==='changed'&&v.original_outcome.definition_is_current==='historical'));
  originalReferences(r);
  noFallback(r);
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
  assert.equal(r.status,200);
  assert.equal(r.confirmations.length,1,'Use the ACTUAL existing paige_confirm surface frame');
  assert.equal(r.confirmations[0].tool,'weekly_commitment_draft');
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
  assert.ok(r.confirmations.some(v=>v.fingerprint===r.token));
});
await check('Model-supplied native request identity cannot prepare a different approval',async()=>{
  const r=await driveWeekly({fresh:true,modelTools:[{name:'weekly_commitment_draft',args:{...intentArgs,_request_id:id(99)}}]});
  assert.ok(r.offered.some(t=>t.name==='weekly_commitment_draft'),'Require the real original offered tool');
  assert.equal(r.rec.inserts.filter(c=>c.table==='paige_pending_confirmations'&&!c.update&&!c.upsert).length,0);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.confirmations.length,0);
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
for(const mode of ['off','foreignProposal','member','legacyToken','expired'])await check('Original '+mode+' refusal never saves, substitutes or reproposes',async()=>{
  const r=await driveWeekly({[mode]:true,modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  if(mode==='member')assert.ok(!r.offered.some(t=>t.name==='weekly_commitment_draft'));
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  noFallback(r);
  assert.equal(r.confirmations.length,0,'A refusal cannot create a replacement card');
});
await check('Re-emitted approved intent does not save twice or mint a replacement after the native success',async()=>{
  const r=await driveWeekly({modelTools:[{name:'weekly_commitment_draft',args:intentArgs},
    {name:'weekly_commitment_draft',args:{...intentArgs}}]});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,1);
  noFallback(r);
});
await check('Already-consumed original approval cannot commit or mint a replacement',async()=>{
  const r=await driveWeekly({consumed:true,observed:'saved',modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0,'Consumed original needs only its existing read transport');
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1,'Recover the original saved outcome, not a new preparation');
  assert.ok(r.values.some(v=>v.original_outcome?.phase==='saved'&&v.original_outcome?.definition_is_current==='saved_draft'),'Return the original receipt-verified state through its canonical privacy-preserving projection');
  assert.equal(r.calls('read_weekly_commitment_chat_draft')[0]?.args._confirmation_id,proposal);
  assert.equal(r.calls('read_weekly_commitment_chat_draft')[0]?.args._expected_thread_id,thread);
  originalReferences(r);
  noFallback(r);
});
for(const phase of ['saved','unknown'])await check('A late decline observes original '+phase+' without claiming a new refusal',async()=>{
  const r=await driveWeekly({consumed:true,declined:true,readPhase:phase});
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1,'Read the original outcome even when the approval was already consumed');
  assert.equal(r.calls('decline_weekly_commitment_chat_draft').length,0,'Do not repeat a native decision on a consumed original');
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.ok(r.originalObservations.some(o=>o.phase===phase),'The existing conversation must receive the actual original state');
  noFallback(r);
});
for(const phase of ['unknown','saved_unreceipted','declined','changed'])await check('Consumed original '+phase+' is inspected without another claim or save',async()=>{
  const r=await driveWeekly({consumed:true,readPhase:phase,modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);
  const result=r.values.find(v=>v.original_outcome?.phase===phase);
  assert.ok(result,'Retain the actual original state, not a fresh preparation or false no-save claim');
  if(phase==='changed') {
    assert.equal(result.original_outcome.definition_is_current,'historical');
    originalReferences(r);
  } else {
    assert.notEqual(result.success,true,'Unverified or declined original work cannot be reported successful');
    assert.equal(result.automation_id,undefined,'No fabricated verified resource/receipt');
    if(['unknown','saved_unreceipted'].includes(phase))assert.equal(r.settled.at(-1)?.bundle_ref?.interactive?.effects?.find(e=>e.tool==='weekly_commitment_draft')?.outcome,'outcome_unknown');
  }
  noFallback(r);
});
await check('Consumed original read still refuses a foreign business result without new work',async()=>{
  const r=await driveWeekly({consumed:true,foreignRead:true,modelTools:[{name:'weekly_commitment_draft',args:intentArgs}]});
  assert.equal(r.calls('read_weekly_commitment_chat_draft').length,1);
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.ok(!r.values.some(v=>v.original_outcome?.phase==='saved'||v.automation_id===automationId));
  noFallback(r);
});
await check('Missing schedule detail requests clarification without saving or preparing an approval',async()=>{
  const {timezone:missing,...incomplete}=intentArgs;void missing;
  const r=await driveWeekly({fresh:true,modelTools:[{name:'weekly_commitment_draft',args:incomplete}]});
  assert.ok(r.offered.some(t=>t.name==='weekly_commitment_draft'));
  assert.ok(r.values.some(v=>v.needs_input===true&&v.not_applied===true));
  assert.equal(r.confirmations.length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  noFallback(r);
});
await check('An unrelated original reminder decline retains its own durable cancellation',async()=>{
  const r=await driveWeekly({declined:true,otherTool:'plan_set_reminder'});
  assert.equal(r.status,200);
  assert.notEqual(r.state.proposals[0].consumed_at,null,'The weekly selector must distinguish another canonical proposal from an unavailable native weekly read');
  assert.deepEqual(r.state.appliedProposalUpdates,[proposal],'Only the exact unrelated original row is consumed once; expiry housekeeping may match zero rows');
  assert.ok(r.genericCAS().some(q=>q.filters.some(f=>f[0]==='neq'&&f[1]==='tool_name'&&f[2]==='weekly_commitment_draft')),'Generic cancellation still excludes native weekly proposals');
  assert.equal(r.calls('claim_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('commit_weekly_commitment_chat_draft').length,0);
  assert.equal(r.calls('decline_weekly_commitment_chat_draft').length,0);
  assert.equal(r.rec.functions.length,0);
});
const output={evidenceClass:'Development runtime proof: actual current handler, existing offline recording ports',
  sourceSHA256:createHash('sha256').update(readFileSync(path.join(root,'supabase/functions/paige-ai-chat/index.ts'))).digest('hex'),
  passed:resultRows.filter(r=>r.status==='PASS').length,failed:resultRows.filter(r=>r.status==='FAIL').length,cases:resultRows,
  boundary:'No native authentication/effects, provider traffic, customer success, release or acceptance is proven by this offline harness.'};
mkdirSync(path.join(root,'work'),{recursive:true});
writeFileSync(path.join(root,'work/weekly-draft-chat-result.json'),JSON.stringify(output,null,2)+'\n');
console.log('RESULT '+output.passed+' PASS / '+output.failed+' FAIL');
if(output.failed)process.exitCode=1;
