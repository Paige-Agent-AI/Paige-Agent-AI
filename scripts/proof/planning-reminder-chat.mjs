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
const stored = { title: '  Neutral exact approved reminder  ', remind_at: '2030-01-02T10:00:00.123456Z',
  target: 'user', channel: 'in_app', summary: 'Neutral approved detail' };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
let active, modelBodies = [], modelRound = 0, forbiddenNetwork = [];
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
  SB_EXECUTION_ID: active?.unbound ? '' : execution, DENO_DEPLOYMENT_ID: active?.unbound ? '' : deployment })[key] ?? '' } };
globalThis.fetch = async (url, options = {}) => {
  if (new URL(String(url)).hostname !== 'api.anthropic.com') {
    forbiddenNetwork.push(String(url)); throw Error('REMINDER_PROOF_NETWORK_FORBIDDEN');
  }
  const body = JSON.parse(options.body); modelBodies.push(body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text',
    text: JSON.stringify({ intent: 'act', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .99 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  if (!body.stream) return Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } });
  modelRound++;
  const uses = modelRound === 1 ? active.modelTools : [];
  const events = [{ type: 'message_start', message: { usage: { input_tokens: 1 } } },
    ...uses.flatMap((use, index) => [{ type: 'content_block_start', index,
      content_block: { type: 'tool_use', id: `reminder-model-${index}`, name: use.name } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(use.args) } }]),
    ...(!uses.length ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Use only the verified tool result; scheduling is not delivery.' } }] : []),
    { type: 'message_delta', delta: { stop_reason: uses.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
globalThis.WebSocket = class { constructor() { forbiddenNetwork.push('WebSocket'); throw Error('REMINDER_PROOF_NETWORK_FORBIDDEN'); } };
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
const { DURABLE_JOB_STATES } = await import('../../supabase/functions/_shared/durable-job/mod.ts');
const { REMINDER_UNSUPPORTED_CLASSES } = await import('../../supabase/functions/_shared/planning/approved-reminder.ts');
const results = [];
const redOnly = process.argv.includes('--red-only');
const destination = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
const clone = value => structuredClone(value);
const nativeResult = () => ({ ok: true, item_id: item, item_type: 'reminder', remind_at: stored.remind_at,
  railRecorded: true, receipt_status: 'recorded', receipt_run_id: audit });
const readback = (args = stored, tid = tenant) => ({ item_id: item, item_type: 'reminder', title: args.title.trim(),
  summary: args.summary ?? null, tenant_id: tid, created_by: actor, remind_at: args.remind_at,
  remind_target: args.target ?? 'user', remind_channel: args.channel === 'email' ? 'email' : 'in_app',
  assigned_to_user_id: args.target === 'team' ? null : args.target_user_id ?? actor, plan_id: args.plan_id ?? null,
  contact_id: args.contact_id ?? null, source_version: '2026-10-18T07:00:00.123456Z' });
const terminal = historical => ({ v: 1, status: 'succeeded', receipt_version: 1, work_id: work, proposal_id: proposal,
  historical, replayed: historical, original_result: nativeResult(), original_readback: readback() });
function toolResults() {
  return modelBodies.flatMap(b => b.messages ?? []).filter(m => m.role === 'user')
    .flatMap(m => Array.isArray(m.content) ? m.content : []).filter(p => p.type === 'tool_result')
    .flatMap(p => { try { return [JSON.parse(p.content)]; } catch { return []; } });
}
async function drive(options = {}) {
  modelBodies = []; modelRound = 0; forbiddenNetwork = [];
  const tid = options.tenantless ? null : tenant, th = options.threadless ? null : thread;
  const focus = options.focus ? client : null;
  const tool = options.tool ?? 'plan_set_reminder', args = clone(options.args ?? stored);
  const fingerprint = await confirmFingerprint(tool, { intent: await confirmFingerprint(tool, args), tenant: tid, thread: th, client: focus });
  const token = `${fingerprint}:${issued}`, receipts = [], controller = new AbortController();
  active = { timeline: [], proposals: [{ id: proposal, user_id: actor, tenant_id: tid, thread_id: th, scoped_client_id: focus,
    tool_name: tool, fingerprint, issued_in_request: issued, server_issued_at: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 600000).toISOString(), consumed_at: null, args, summary: 'Neutral exact reminder approval' }],
  tenant: tid, held: null, stopped: false, runtimeRefused: false, hold: null, unbound: options.unbound || options.threadless || options.tenantless,
  claimLose: options.claimLose, modelTools: options.modelTools ?? (options.auto || options.threadless ? [{ name: tool, args }] : []) };
  if (options.wrongScope) active.proposals[0].tenant_id = id(99);
  if (options.expired) active.proposals[0].expires_at = new Date(Date.now() - 10000).toISOString();
  const state = active;
  const protocol = { version: 2, active: true };
  const runtimeState = a => ({ latest: state.runtimeRefused ? id(98) : a.p_intent, executor: state.held,
    acquired: state.held === a.p_intent, terminal: false, stopped: state.stopped, recovery_read_only: false });
  const recorder = fake.setScenario({ authUser: { id: actor }, tables: {
    profiles: () => [{ active_tenant_id: state.tenant }], tenant_members: options.nonmember ? [] : [{ tenant_id: tid, user_id: actor, status: 'active', role: 'owner' }],
    tenants: tid ? [{ id: tid, account_type: 'standalone', parent_tenant_id: null, status: 'active' }] : [],
    clients: focus ? [{ id: focus, tenant_id: tid, account_number: 'TEST-CLIENT', linked_user_id: null }] : [],
    paige_chat_threads: () => [{ id: thread, tenant_id: tid, caller_user_id: actor, audience: 'workspace', interactive_recovery_hold: state.hold, is_archived: false }],
    paige_chat_turns: filters => filters.some(f => f[0] === 'contains') ? [] : receipts,
    plan_items: () => [{ id: item, tenant_id: tid, status: 'open', updated_at: '2026-10-18T07:00:00.123456Z',
      ...Object.fromEntries(Object.entries(readback(args, tid)).filter(([key]) => !['item_id', 'source_version'].includes(key))) }],
  }, rpcs: {
    paige_chat_interactive_protocol: { data: protocol, error: null }, check_rate_limit: { data: true, error: null },
    current_user_tenant_id: () => ({ data: state.tenant, error: null }), is_platform_owner: { data: false, error: null },
    get_actor_access: { data: { tier: 'tenant' }, error: null },
    get_team_authority_readiness: { data: [{ fact_key: 'viewer_permission', value: 'owner', status: 'available', tenant_id: tid }], error: null },
    resolve_tool_autonomy: { data: options.auto ? 'auto' : 'confirm', error: null },
    resolve_tool_autonomy_detail: { data: { ceiling_allows_auto: true }, error: null }, resolve_tool_autonomy_many: { data: [], error: null },
    get_paige_persona_context: () => ({ data: [{ tenant_id: state.tenant, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null }),
    paige_chat_interactive_begin_v2: { data: { status: 'accepted', turn_id: id(15) }, error: null },
    paige_chat_interactive_acquire_bound: a => { state.held = a.p_intent; return { data: runtimeState(a), error: null }; },
    paige_chat_interactive_runtime_context: a => ({ data: runtimeState(a), error: null }),
    paige_chat_interactive_executor_v2: a => { if (a.p_operation === 'acquire') state.held = a.p_intent;
      if (a.p_operation === 'release') state.held = null; return { data: runtimeState(a), error: null }; },
    paige_chat_interactive_publication_context_v2: { data: true, error: null },
    paige_chat_interactive_settle: a => { receipts.push({ role: 'assistant', content: a.p_content, bundle_ref: a.p_bundle_ref }); return { data: id(16), error: null }; },
    record_capability_run: { data: id(17), error: null },
    adopt_paige_reminder_approval: a => {
      if (options.afterAdopt === 'scope') state.tenant = id(99);
      if (options.afterAdopt === 'stop') state.stopped = true;
      if (options.afterAdopt === 'hold') state.hold = id(97);
      if (options.afterAdopt === 'runtime') state.runtimeRefused = true;
      if (options.afterAdopt === 'abort') controller.abort('Neutral request withdrawal');
      if (options.adoptThrow) throw Error('PRIVATE_ADOPTION_LOST_ACK');
      if (Object.hasOwn(options, 'adoptReply')) return clone(options.adoptReply);
      // The native ordinary-unbound exclusion still proves the actual current
      // intent. A missing binding is not permission to omit that identity.
      if (options.unsupported === 'unbound_runtime_compatibility'
        && (a.p_intent !== intent || a.p_runtime_request_nonce !== null))
        return { data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_UNBOUND_INTENT_REFUSAL' } };
      if (options.unsupported) return { data: { v: 1, status: 'unsupported', proposal_id: proposal, unsupported_reason: options.unsupported }, error: null };
      state.proposals[0].consumed_at = new Date().toISOString();
      return { data: { v: 1, status: options.existing ? 'existing' : 'adopted', proposal_id: proposal, work_id: work,
        work_status: options.existing ?? 'claimed', stored_args: clone(args) }, error: null };
    },
    execute_paige_approved_reminder: () => {
      if (options.executeThrow) throw Error('PRIVATE_EXECUTION_LOST_ACK');
      if (Object.hasOwn(options, 'executeReply')) return clone(options.executeReply);
      if (options.afterAdopt) return { data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_CHECKPOINT_REFUSAL' } };
      return { data: terminal(options.historical === true), error: null };
    },
    plan_set_reminder: { data: nativeResult(), error: null }, plan_list: { data: [], error: null },
  } });
  const requestBody = { messages: [{ role: 'user', content: options.declined ? 'Not now for this exact reminder.' : options.auto ? 'Save this reminder.' : 'Approved — run this exact reminder.' }],
    ...(th ? { threadId: th, requestIntentId: intent, interactive: { kind: 'message' } } : {}), ...(focus ? { clientId: focus } : {}),
    ...(!options.auto && !options.declined ? { approvedConfirmations: [token] } : {}), ...(options.declined ? { declinedConfirmations: [token] } : {}) };
  const response = await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
    method: 'POST', headers: { Authorization: 'Bearer test-original-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody), signal: controller.signal }));
  const wire = await response.text(), values = toolResults();
  assert.deepEqual(forbiddenNetwork, [], 'every real network transport must remain blocked');
  return { rec: recorder, timeline: state.timeline, wire, values, receipts, responseStatus: response.status, token, fingerprint, args, requestBody,
    calls: name => recorder.rpc.filter(call => call.name === name), state };
}
const claims = r => r.timeline.filter(c => c.kind === 'query' && c.table === 'paige_pending_confirmations' && c.op === 'update');
const proposals = r => r.rec.inserts.filter(c => c.table === 'paige_pending_confirmations' && !c.update);
const success = r => r.values.some(value => value.success === true);
const noLegacy = r => { assert.equal(r.calls('plan_set_reminder').length, 0, 'no direct9arg fallback'); assert.equal(claims(r).length, 0, 'no separate browser/general CAS'); assert.equal(proposals(r).length, 0, 'never repropose after native adoption result'); };
const noRetryTruth = r => { noLegacy(r); assert.equal(success(r), false, 'no new success inferred');
  assert(!r.values.some(v => v.not_applied === true), 'unknown prior native outcome cannot be not_applied');
  assert(!JSON.stringify(r.values).includes('PRIVATE_'), 'native/private error details never enter model results');
  assert(!r.wire.includes('PRIVATE_'), 'native/private error details never enter browser frames');
  assert(!r.receipts.flatMap(row => row.bundle_ref?.interactive?.effects ?? []).some(effect =>
    effect.tool === 'plan_set_reminder' && effect.outcome === 'reported_success'), 'unverified execution cannot settle as success'); };
const explicitUnavailable = r => assert.ok(r.values.some(v => v.success === false),
  'an attempted operation needs an explicit unavailable tool result, not a silent500 or empty model context');
async function check(name, fn) { try { const detail = await fn(); results.push({ name, status: 'PASS', ...detail }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); } }
function recorded(r) { return { rpc: r.rec.rpc, pendingQueries: r.timeline.filter(c => c.kind === 'query'), tools: r.values,
  frames: r.wire, settled: r.receipts.map(row => row.bundle_ref), request: r.requestBody }; }

if (redOnly) await check('RED reachability control: exact fresh approved browser turn reaches incumbent CAS and9arg writer', async () => {
  const r = await drive(); assert.equal(r.calls('plan_set_reminder').length, 1); assert.ok(claims(r).length > 0); assert.equal(success(r), true);
  assert.equal(r.calls('adopt_paige_reminder_approval').length, 0); return { recording: recorded(r) };
});
await check('fresh approved reminder spends exact canonical proposal through service adopter and original-JWT executor', async () => {
  const r = await drive(); assert.equal(r.calls('adopt_paige_reminder_approval').length, 1, 'one native adopter required');
  assert.equal(r.calls('execute_paige_approved_reminder').length, 1, 'one native executor required'); noLegacy(r); assert.equal(success(r), true);
  const adoption = r.calls('adopt_paige_reminder_approval')[0], effect = r.calls('execute_paige_approved_reminder')[0];
  assert.equal(adoption.client, 'service'); assert.equal(effect.client, 'jwt');
  assert.deepEqual(Object.keys(adoption.args).sort(), ['p_proposal_id','p_actor','p_tenant','p_thread','p_client','p_fingerprint','p_issued_nonce','p_request_nonce','p_intent','p_runtime_request_nonce'].sort());
  assert.equal(adoption.args.p_proposal_id, proposal); assert.equal(adoption.args.p_fingerprint, r.fingerprint);
  assert.equal(adoption.args.p_actor, actor); assert.equal(adoption.args.p_tenant, tenant); assert.equal(adoption.args.p_thread, thread); assert.equal(adoption.args.p_client, null);
  const bound = r.calls('paige_chat_interactive_acquire_bound')[0]; assert.ok(bound, 'real bound v2 handler admission');
  assert.equal(adoption.args.p_issued_nonce, issued); assert.ok(uuid(adoption.args.p_request_nonce)); assert.notEqual(adoption.args.p_request_nonce, issued);
  assert.equal(adoption.args.p_intent, intent); assert.equal(adoption.args.p_runtime_request_nonce, bound.args.p_request_nonce);
  assert.equal(bound.args.p_execution_id, execution); assert.equal(bound.args.p_deployment_id, deployment);
  assert.notEqual(adoption.args.p_request_nonce, bound.args.p_request_nonce, 'confirmation and runtime nonces have different server origins');
  assert.deepEqual(effect.args, { p_work_id: work, p_expected_tenant: tenant, p_expected_thread: thread, p_expected_client: null,
    p_intent: intent, p_runtime_request_nonce: bound.args.p_request_nonce });
  assert.ok(r.timeline.findIndex(c => c.name === 'adopt_paige_reminder_approval') < r.timeline.findIndex(c => c.name === 'execute_paige_approved_reminder'));
  assert.ok(r.values.some(v => v.success === true && v.verified_readback === true && v.plan_item_id === item));
  const settled = r.receipts.at(-1)?.bundle_ref;
  assert.equal(settled?.turn_state?.state, 'FINAL', 'actual handler settles the approved answer');
  assert.deepEqual(settled.interactive.effects, [{ tool: 'plan_set_reminder', outcome: 'reported_success', record_refs: [{ kind: 'plan_item', id: item }] }]);
  assert.deepEqual(settled.paige_resume.approval_outcome.actions, [{ fingerprint: r.token, outcome: 'ran' }]);
  return { recording: recorded(r) };
});
if (!redOnly) {
  for (const state of DURABLE_JOB_STATES) await check('existing ' + state + ' is observation only and never fresh execution/CAS/reproposal', async () => {
    const r = await drive({ existing: state }); assert.equal(r.calls('adopt_paige_reminder_approval').length, 1); assert.equal(r.calls('execute_paige_approved_reminder').length, 0); noLegacy(r); assert.equal(success(r), false); explicitUnavailable(r); return { recording: recorded(r) };
  });
  for (const reason of REMINDER_UNSUPPORTED_CLASSES) await check('only explicit native ' + reason + ' may enter unchanged compatibility gate', async () => {
    const options = { unsupported: reason, ...(reason === 'tenantless_native_compatibility' ? { tenantless: true } : {}),
      ...(reason === 'threadless_native_compatibility' ? { threadless: true } : {}), ...(reason === 'client_focus_compatibility' ? { focus: true } : {}),
      ...(reason === 'unbound_runtime_compatibility' ? { unbound: true } : {}), ...(reason === 'nonmember_native_compatibility' ? { nonmember: true } : {}) };
    const r = await drive(options); assert.equal(r.calls('adopt_paige_reminder_approval').length, 1); assert.equal(r.calls('execute_paige_approved_reminder').length, 0);
    assert.ok(claims(r).length > 0, 'incumbent scoped CAS remains required');
    assert.equal(r.calls('plan_set_reminder').length, options.tenantless ? 0 : 1, 'same incumbent Planning scope gate');
    if (options.threadless || options.tenantless || options.unbound) {
      assert.equal(r.calls('adopt_paige_reminder_approval')[0].args.p_intent, options.threadless ? null : intent, 'actual current intent is preserved independently of the binding');
      assert.equal(r.calls('adopt_paige_reminder_approval')[0].args.p_runtime_request_nonce, null, 'no fabricated runtime');
    }
    return { recording: recorded(r) };
  });
  for (const options of [{ wrongScope: true }, { expired: true }, { declined: true }]) await check('wrong/expired/declined scope never reaches new or legacy writer ' + JSON.stringify(options), async () => {
    const r = await drive(options); assert.equal(r.calls('adopt_paige_reminder_approval').length, 0); assert.equal(r.calls('execute_paige_approved_reminder').length, 0); assert.equal(r.calls('plan_set_reminder').length, 0); assert.equal(success(r), false); return { recording: recorded(r) };
  });
  for (const options of [{ adoptThrow: true }, { adoptReply: { data: null, error: null } },
    { adoptReply: { data: null, error: { code: '42501', message: 'PRIVATE_ADOPTION_REFUSAL' } } },
    { adoptReply: { data: { v: 1, status: 'unsupported', proposal_id: proposal, unsupported_reason: 'scope_denied' }, error: null } }]) await check('lost/malformed/error adoption never falls through or reproposes ' + JSON.stringify(Object.keys(options)), async () => {
    const r = await drive(options); assert.equal(r.calls('adopt_paige_reminder_approval').length, 1); assert.equal(r.calls('execute_paige_approved_reminder').length, 0); noRetryTruth(r); explicitUnavailable(r); return { recording: recorded(r) };
  });
  for (const kind of ['scope', 'stop', 'hold', 'off', 'runtime', 'abort']) await check('post-adoption ' + kind + ' checkpoint refuses fresh effect without legacy fallback', async () => {
    const r = await drive({ afterAdopt: kind }); assert.equal(r.calls('adopt_paige_reminder_approval').length, 1); assert.ok(r.calls('execute_paige_approved_reminder').length <= 1); noRetryTruth(r); return { recording: recorded(r) };
  });
  for (const options of [{ executeThrow: true }, { executeReply: { data: null, error: null } },
    { executeReply: { data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_REFUSAL' } } }, { historical: true }]) await check('execution uncertainty/regular-mode history is not fresh success ' + JSON.stringify(Object.keys(options)), async () => {
    const r = await drive(options); assert.equal(r.calls('execute_paige_approved_reminder').length, 1); noRetryTruth(r); explicitUnavailable(r); return { recording: recorded(r) };
  });
  await check('model duplicate calls cannot borrow the native approval owning-call pin', async () => {
    const r = await drive({ modelTools: [{ name: 'plan_set_reminder', args: clone(stored) }, { name: 'plan_set_reminder', args: clone(stored) }] });
    assert.equal(r.calls('adopt_paige_reminder_approval').length, 1); assert.equal(r.calls('execute_paige_approved_reminder').length, 1); noLegacy(r); return { recording: recorded(r) };
  });
  await check('AUTO reminder preserves its existing direct9arg path without adopting a manual approval', async () => {
    const r = await drive({ auto: true }); assert.equal(r.calls('adopt_paige_reminder_approval').length, 0); assert.equal(r.calls('execute_paige_approved_reminder').length, 0);
    assert.equal(r.calls('plan_set_reminder').length, 1); assert.equal(success(r), true); return { recording: recorded(r) };
  });
  await check('ordinary Planning read does not enter the reminder adopter', async () => {
    const r = await drive({ auto: true, tool: 'plan_list', args: {}, modelTools: [{ name: 'plan_list', args: {} }] });
    assert.equal(r.calls('adopt_paige_reminder_approval').length, 0); assert.equal(r.calls('execute_paige_approved_reminder').length, 0); assert.equal(r.calls('plan_list').length, 1); return { recording: recorded(r) };
  });
}
const summary = { evidenceClass: 'actual production handler with recording offline transport ports', scope: 'Fresh exact approved reminder only; no used-token/J19 continuation acceptance',
  sourceSHA256: createHash('sha256').update(readFileSync(path.join(root, 'supabase/functions/paige-ai-chat/index.ts'))).digest('hex'),
  passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, skipped: 0, redOnly, cases: results };
if (destination) { mkdirSync(path.dirname(path.resolve(destination)), { recursive: true }); writeFileSync(destination, JSON.stringify(summary, null, 2) + '\n'); }
console.log(`RESULT ${summary.passed} PASS / ${summary.failed} FAIL / 0 SKIP`);
if (summary.failed) process.exitCode = 1;
