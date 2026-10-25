// Actual production Chat handler with recording backend/provider transport ports.
// No real provider/network/customer operation. This proves dispatch/receipt/reference
// integration, not native PostgREST authentication or customer/Live acceptance.
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key' })[key] ?? '' } };
let modelCalls = 0, readToolUse = null;
const modelBodies = [];
globalThis.fetch = async (url, options) => {
  if (!String(url).includes('api.anthropic.com')) return new Response('{}', { status: 503 });
  const body = JSON.parse(options.body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text', text: JSON.stringify({ intent: 'act', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .9 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  modelCalls++; modelBodies.push(body);
  const events = modelCalls === 1 ? [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-read', name: readToolUse.name } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(readToolUse.input) } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ] : [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Answered from the verified read.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
const fake = await import('../knowledge-scope/fake-supabase.mjs');
const queryShapes = [];
const proto = Object.getPrototypeOf(fake.createClient('', 'anon-key'));
const originalRpc = proto.rpc;
proto.rpc = function(name, parameters) {
  if (name !== 'list_team_bookings' && !['current_user_tenant_id', 'get_team_authority_readiness', 'is_tenant_member', 'is_tenant_admin'].includes(name)) return originalRpc.call(this, name, parameters);
  const shape = { name, parameters, client: this._kind, operations: [] }; queryShapes.push(shape);
  const promise = originalRpc.call(this, name, parameters);
  const query = { select(value) { shape.operations.push(['select', value]); return query; },
    eq(key, value) { shape.operations.push(['eq', key, value]); return query; },
    neq(key, value) { shape.operations.push(['neq', key, value]); return query; },
    gt(key, value) { shape.operations.push(['gt', key, value]); return query; },
    order(key, value) { shape.operations.push(['order', key, value]); return query; },
    limit(value) { shape.operations.push(['limit', value]); return query; },
    abortSignal(signal) { shape.signal = signal; return query; }, then: promise.then.bind(promise) };
  return query;
};
await import('../../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('../knowledge-scope/stub-serve.mjs');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4);
const receipts = [];
const executorState = { held: null };
const req = (extras = {}, intentId = intent) => new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
  method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  // The EXACT browser shape (PaigeAIChat.tsx): messages + threadId + requestIntentId +
  // interactive:{kind:"message"} — never a curl-shaped body that omits `interactive`.
  body: JSON.stringify({ messages: [{ role: 'user', content: 'What should I focus on this week?' }], threadId: thread, requestIntentId: intentId, interactive: { kind: 'message' }, ...extras }),
});
const scenario = (extra = {}) => fake.setScenario({
  authUser: { id: actor },
  tables: {
    profiles: [{ active_tenant_id: tenant }],
    tenant_members: [{ tenant_id: tenant }],
    paige_chat_threads: [{ id: thread, tenant_id: tenant, caller_user_id: actor }],
    paige_chat_turns: (filters) => (filters.some((f) => f[0] === 'contains') ? [] : receipts),
    ...(extra.tables ?? {}),
  },
  rpcs: {
    paige_chat_interactive_protocol: { data: { version: 2, active: false }, error: null },
    check_rate_limit: { data: true, error: null },
    resolve_tool_autonomy: { data: 'auto', error: null },
    resolve_tool_autonomy_detail: { data: { ceiling_allows_auto: true }, error: null },
    resolve_tool_autonomy_many: { data: [], error: null },
    get_actor_access: { data: { tier: 'tenant' }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    paige_chat_interactive_begin_v2: { data: { status: 'accepted', turn_id: id(5) }, error: null },
    paige_chat_interactive_executor_v2: (a) => {
      if (a.p_operation === 'acquire') executorState.held = a.p_intent;
      if (a.p_operation === 'release' && executorState.held === a.p_intent) executorState.held = null;
      return { data: { latest: a.p_intent, executor: executorState.held, acquired: executorState.held === a.p_intent, terminal: receipts.length > 0, stopped: false }, error: null };
    },
    paige_chat_interactive_settle: (a) => { receipts.push({ role: 'assistant', content: a.p_content, bundle_ref: a.p_bundle_ref }); return { data: id(8), error: null }; },
    ...(extra.rpcs ?? {}),
  },
});



const approvalId = id(20), occurrenceId = id(21), event = id(22), act = id(23), processId = id(24), taskId = id(25), runId = id(26), originalReceiptId = id(27);
const stamp = '2026-10-19T12:00:00Z', title = 'Original protected task';
const approval = () => ({ id: approvalId, tenant_id: tenant, source: 'paige_orchestration', category: 'owner.task', type: 'other', status: 'approved',
  updated_at: stamp, metadata: { source: 'paige_orchestration', capability_id: 'owner.task', event_id: event, act_id: act, act_execution_id: occurrenceId, automation_id: processId } });
const occurrence = () => ({ id: occurrenceId, tenant_id: tenant, event_id: event, act_id: act, automation_id: processId, adapter_kind: 'native', capability_key: 'owner.task',
  effective_lane: 'confirm', outcome: 'executed', correlation_ref: id(28), idempotency_key: id(28), decided_at: stamp, updated_at: stamp,
  detail: { approved_by: actor, approved_at: stamp, snapshot_args: { title }, owner_task_source: { v: 1 }, owner_task_approval: { id: approvalId } } });
const native = () => ({ state: 'found', actor_id: actor, result: { ok: true, action: 'task.create', outcome: 'succeeded', receipt_recorded: true, correlation_id: runId,
  readback: { id: taskId, title, description: null, assignee_user_id: actor, external_effect: false, notification_sent: false } } });
const originalReceipt = () => ({ id: originalReceiptId, tenant_id: tenant, actor_id: actor, source_kind: 'capability_run', source_id: runId,
  source_revision: 0, capability_key: 'crm_create_task', outcome: 'capability_succeeded', occurred_at: stamp,
  detail: { action: 'task.create', record_kind: 'task', record_id: taskId } });
const cases = [];
let requestSequence = 0;
const check = async (name, run) => { try { await run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); } };
async function execute({ role = 'owner', tier = 'tenant', args = { approval_id: approvalId }, allowed = true,
  shape = { id: tenant, account_type: 'standalone', parent_tenant_id: null }, missingReceipt = false,
  afterNative, afterReceipt, receiptOk = true, approvalRow = approval(), occurrenceRow = occurrence() } = {}) {
  receipts.length = 0; modelBodies.length = 0; queryShapes.length = 0; executorState.held = null;
  modelCalls = 0; readToolUse = { name: 'read_owner_task_act', input: args };
  let active = tenant;
  const rec = scenario({ tables: {
    profiles: () => [{ active_tenant_id: active }], tenants: shape ? [shape] : [],
    tenant_members: [{ tenant_id: tenant, user_id: actor, role, status: 'active' }],
    paige_approval_queue_v: [approvalRow], paige_act_executions: [occurrenceRow],
    paige_workspace_events: missingReceipt ? [] : [originalReceipt()],
  }, rpcs: {
    paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null },
    paige_chat_interactive_publication_context_v2: { data: true, error: null },
    get_actor_access: { data: { tier }, error: null },
    is_tenant_admin_as: { data: ['owner', 'admin'].includes(role), error: null },
    agency_can_manage_child: { data: false, error: null },
    get_team_authority_readiness: { data: [{ fact_key: 'viewer_permission', value: role, status: 'available', tenant_id: tenant }], error: null },
    current_user_tenant_id: () => ({ data: active, error: null }),
    can_read_owner_task_approval: { data: allowed, error: null },
    read_owner_task_act: () => { if (afterNative) active = afterNative; return { data: native(), error: null }; },
    record_capability_run: () => { if (afterReceipt) active = afterReceipt; return { data: receiptOk, error: receiptOk ? null : { message: 'fixture receipt unavailable' } }; },
  } });
  const response = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Read the original saved task outcome for approval ' + approvalId }] }, id(100 + requestSequence++)));
  const wire = await response.text();
  const results = modelBodies.flatMap(body => body.messages ?? []).filter(message => message.role === 'user')
    .flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'tool_result');
  let value = null;
  for (const part of results) { try { const parsed = JSON.parse(part.content); if (parsed?.status) value = parsed; } catch {} }
  assert.equal(rec.functions.length, 0, 'no domain/provider function invocation');
  assert.ok(!rec.rpc.some(c => /execute_owner_task|approve_act|reconcile_act|claim|commit_weekly|create_task/.test(c.name)), 'no execution or decision RPC');
  assert.ok(!rec.inserts.some(c => /crm_tasks|paige_act_executions|paige_pending_approvals/.test(c.table)), 'no task, ledger or approval write');
  return { rec, wire, value, offered: modelBodies[0]?.tools?.map(t => t.name) ?? [] };
}
await check('ordinary Chat owner reads original Task and Rail evidence with a separate inspection receipt', async () => {
  const r = await execute();
  assert.ok(r.offered.includes('read_owner_task_act'));
  assert.equal(r.value?.status, 'available'); assert.equal(r.value.read_receipt, 'recorded');
  assert.deepEqual(r.value.original.originalTask, { state: 'verified', taskId, receiptId: originalReceiptId, runId });
  assert.deepEqual(r.value.original.currentTask, { state: 'not_read' });
  assert.equal(r.rec.rpc.filter(c => c.name === 'read_owner_task_act').length, 1);
  assert.equal(r.rec.rpc.find(c => c.name === 'read_owner_task_act').client, 'service');
  const read = r.rec.rpc.filter(c => c.name === 'record_capability_run'); assert.equal(read.length, 1);
  assert.equal(read[0].args._capability_key, 'automations.owner_task_history');
});
await check('a currently authorized admin can inspect original evidence without substituting its receipt', async () => {
  const r = await execute({ role: 'admin' }); assert.equal(r.value?.status, 'available');
  assert.equal(r.value.original.originalTask.receiptId, originalReceiptId);
});
await check('recorded executed state without original receipt remains unconfirmed', async () => {
  const r = await execute({ missingReceipt: true }); assert.equal(r.value?.status, 'available');
  assert.deepEqual(r.value.original.originalTask, { state: 'unconfirmed' });
  assert.equal(r.value.original.recordedOutcome, 'executed'); assert.equal(r.value.read_receipt, 'recorded');
});
await check('a failed inspection receipt cannot replace original proof or claim a recorded read', async () => {
  const r = await execute({ receiptOk: false }); assert.equal(r.value?.status, 'available'); assert.equal(r.value.read_receipt, 'unverified');
});
for (const [name, options] of [
  ['missing original reference', { args: {} }], ['foreign tenant override', { args: { approval_id: approvalId, tenant_id: id(99) } }],
  ['foreign actor override', { args: { approval_id: approvalId, actor_id: id(99) } }], ['invalid original reference', { args: { approval_id: 'invalid' } }],
]) await check(name + ' refuses before original native data', async () => {
  const r = await execute(options); assert.equal(r.value?.status, 'needs_input');
  assert.ok(!r.rec.rpc.some(c => c.name === 'can_read_owner_task_approval' || c.name === 'read_owner_task_act'));
});
for (const [name, options] of [
  ['member', { role: 'member' }], ['Operator', { tier: 'operator' }], ['unclassified account', { shape: null }],
  ['Agency account', { shape: { id: tenant, account_type: 'agency', parent_tenant_id: null } }],
]) await check(name + ' receives no owner-history offer or private outcome', async () => {
  const r = await execute(options); assert.ok(!r.offered.includes('read_owner_task_act')); assert.notEqual(r.value?.status, 'available');
  assert.ok(!r.rec.rpc.some(c => c.name === 'read_owner_task_act'));
});
await check('native approval refusal discloses no original details or service read', async () => {
  const r = await execute({ allowed: false }); assert.equal(r.value?.status, 'refused');
  assert.ok(!r.rec.rpc.some(c => c.name === 'read_owner_task_act')); assert.ok(!JSON.stringify(r.value).includes(title));
});
for (const stage of ['afterNative', 'afterReceipt']) await check('workspace withdrawal ' + stage + ' suppresses original model egress', async () => {
  const r = await execute({ [stage]: id(99) }); assert.notEqual(r.value?.status, 'available');
  assert.equal(r.rec.rpc.filter(c => c.name === 'read_owner_task_act').length, 1);
  if (stage === 'afterReceipt') assert.equal(r.rec.rpc.filter(c => c.name === 'record_capability_run').length, 1);
  assert.ok(!JSON.stringify(modelBodies).includes(title)); assert.ok(!r.wire.includes(title));
});
await check('a subsequent distinct Chat request reads the same original operation without replay', async () => {
  const a = await execute(), b = await execute();
  assert.equal(a.value?.original.approvalId, b.value?.original.approvalId);
  assert.equal(b.value?.original.originalTask.receiptId, originalReceiptId);
  assert.equal(b.rec.rpc.filter(c => c.name === 'read_owner_task_act').length, 1);
});
console.log('RESULT ' + cases.filter(c => c.status === 'PASS').length + ' PASS / ' + cases.filter(c => c.status === 'FAIL').length + ' FAIL');
if (cases.some(c => c.status === 'FAIL')) process.exitCode = 1;
