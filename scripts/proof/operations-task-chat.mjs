// Actual production Chat handler with recording backend/provider transport ports.
// No real provider/network/customer operation. This proves Task dispatch/receipt/reference
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
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Read attempt finished; use only confirmed facts.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
const fake = await import('../knowledge-scope/fake-supabase.mjs');
const queryShapes = [];
const proto = Object.getPrototypeOf(fake.createClient('', 'anon-key'));
const originalRpc = proto.rpc;
proto.rpc = function(name, parameters) {
  if (!['operations_crm_work_read', 'get_team_authority_readiness'].includes(name)) return originalRpc.call(this, name, parameters);
  const shape = { name, parameters, client: this._kind, operations: [] }; queryShapes.push(shape);
  const promise = originalRpc.call(this, name, parameters);
  const query = { select(value) { shape.operations.push(['select', value]); return query; },
    eq(key, value) { shape.operations.push(['eq', key, value]); return query; },
    limit(value) { shape.operations.push(['limit', value]); return query; },
    abortSignal(signal) { shape.signal = signal; return query; }, then: promise.then.bind(promise) };
  return query;
};
await import('../../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('../knowledge-scope/stub-serve.mjs');
const { PAIGE_SPINE_CAPABILITIES } = await import('../../supabase/functions/_shared/paige-spine/registry.ts');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4);
const receipts = [];
const executorState = { held: null };
const req = (extras = {}, intentId = intent) => new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
  method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  // The EXACT browser shape (PaigeAIChat.tsx): messages + threadId + requestIntentId +
  // interactive:{kind:"message"} â€” never a curl-shaped body that omits `interactive`.
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



const taskId = id(20);
const task = () => ({ id: taskId, tenant_id: tenant, user_id: actor, title: 'Neutral exact late Task', description: 'Recorded neutral Task body', status: 'completed', due_date: null, updated_at: '2026-10-17T12:00:00Z', created_at: '2026-10-16T12:00:00Z', deal_id: null, biz_id: null, recorded_priority: null, estimated_minutes: null });
const envelope = (tasks = [task()]) => ({ ok: true, actor_id: actor, tenant_id: tenant, has_more: false, tasks });
const cases = [];
const redOnly = process.argv.includes('--red-only');
const check = async (name, run) => { try { await run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); } };
async function execute({ role = 'owner', args = { task_id: taskId }, result = { data: envelope(), error: null }, finalResult, afterRead, aba = false, teamFailureAt = 0, tier = 'tenant', classification = { id: tenant, account_type: 'standalone', parent_tenant_id: null }, afterClassification, afterRole, hang = false, receiptError = false, activeProtocol = false } = {}) {
  receipts.length = 0; modelBodies.length = 0; queryShapes.length = 0; executorState.held = null;
  modelCalls = 0; readToolUse = { name: 'crm_get_task', input: args };
  let active = tenant, classificationRow = classification, currentRole = role, reads = 0, teamReads = 0;
  const rec = scenario({ tables: { profiles: () => { const selected = active; if (aba && active !== tenant) active = tenant; return [{ active_tenant_id: selected }]; }, tenants: () => classificationRow ? [classificationRow] : [] }, rpcs: {
    ...(activeProtocol ? { paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null },
      paige_chat_interactive_publication_context_v2: { data: true, error: null } } : {}),
    get_actor_access: { data: { tier }, error: null },
    get_team_authority_readiness: () => ++teamReads === teamFailureAt ? { data: null, error: { code: '57014' } } : { data: [{ fact_key: 'viewer_permission', value: currentRole, status: 'available', tenant_id: tenant }], error: null },
    current_user_tenant_id: { data: tenant, error: null },
    operations_crm_work_read: () => {
      reads++; if (afterRead) active = afterRead;
      if (afterClassification) classificationRow = afterClassification;
      if (afterRole !== undefined) currentRole = afterRole;
      if (hang) return new Promise(() => {});
      return reads > 1 && finalResult ? finalResult : result;
    },
    record_capability_run: { data: receiptError ? null : id(90), error: receiptError ? { code: '57014' } : null },
  } });
  const response = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Read exact saved Task ' + taskId }] }, id(100 + cases.length)));
  const wire = await response.text();
  const tools = modelBodies.flatMap(body => body.messages ?? []).filter(message => message.role === 'user').flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'tool_result');
  let value = null;
  for (const part of tools) { try { const parsed = JSON.parse(part.content); if (parsed?.status) value = parsed; } catch {} }
  return { rec, wire, value, shapes: [...queryShapes], offered: modelBodies[0]?.tools?.map(t => t.name) ?? [] };
}
const noEffects = r => {
  assert.ok(!r.rec.rpc.some(c => /execute_crm|create.*task|plan_|send_|approve|dispatch_automation/.test(c.name)), 'no effect RPC');
  assert.equal(r.rec.functions.length, 0);
  // client-context has one incumbent own-user ten-row preview before dispatch.
  // Pin that exact old query instead of pretending the whole Chat turn has none.
  const contextTasks = r.rec.from.filter(c => c.table === 'tasks');
  assert.equal(contextTasks.length, 1, 'no additional raw tasks/service list fallback');
  assert.deepEqual(contextTasks[0].filters, [['select', 'title, status, track, due_date'], ['eq', 'user_id', actor], ['order', 'created_at', { ascending: false }], ['limit', 10]]);
  assert.equal(contextTasks[0].op, 'select');
};
await check('actual ordinary Chat reads exact late completed Task through original JWT and persists only Work surface reference', async () => {
  const r = await execute();
  assert.equal(r.value?.status, 'available'); assert.equal(r.value?.found, true); assert.deepEqual(r.value.task, task());
  assert.ok(r.offered.includes('crm_get_task')); const native = r.shapes.filter(c => c.name === 'operations_crm_work_read'); assert.equal(native.length, 2);
  for (const call of native) { assert.equal(call.client, 'jwt'); assert.deepEqual(call.parameters, { p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_task_id: taskId }); assert.ok(call.signal instanceof AbortSignal); }
  assert.ok(r.wire.includes('"destination":"operations_work","record_id":null'));
  assert.deepEqual(receipts.at(-1).bundle_ref.paige_record_links, [{ destination: 'operations_work', record_id: null }]);
  assert.ok(!JSON.stringify(r.value).includes('record_links')); assert.ok(!JSON.stringify(r.value).includes('/solo/'));
  assert.equal(r.rec.rpc.filter(c => c.name === 'record_capability_run').length, 1);
  assert.equal(r.rec.rpc.filter(c => c.name === 'get_team_authority_readiness').length, 3, 'initial native Team fact plus fresh pre/post checks');
  noEffects(r);
});
await check('actual member read keeps canonical own/assigned-client native authority without widening service tools', async () => {
  const r = await execute({ role: 'member' }); assert.equal(r.value?.status, 'available'); assert.ok(r.offered.includes('crm_get_task')); noEffects(r);
});
await check('actual exact not-visible projection is not global absence and carries no Task reference', async () => {
  const r = await execute({ result: { data: envelope([]), error: null } }); assert.equal(r.value?.status, 'available'); assert.equal(r.value?.found, false);
  assert.match(r.value.message, /visible to the current actor/); assert.match(r.value.message, /does not establish global absence/);
  assert.ok(!r.wire.includes('"destination":"operations_work"')); noEffects(r);
});
await check('actual invalid UUID is refused before native read and creates no reference or effect', async () => {
  const r = await execute({ args: { task_id: 'not-uuid' } }); assert.equal(r.value?.status, 'needs_input');
  assert.ok(!r.shapes.some(c => c.name === 'operations_crm_work_read')); assert.ok(!r.wire.includes('"destination":"operations_work"')); noEffects(r);
});
if (!redOnly) {
  for (const [label, options, expected] of [
    ['model tenant override', { args: { task_id: taskId, tenant_id: tenant } }, 'needs_input'],
    ['model actor override', { args: { task_id: taskId, actor_id: actor } }, 'needs_input'],
    ['model list filter', { args: { task_id: taskId, status: 'all' } }, 'needs_input'],
    ['native permission refusal', { result: { data: null, error: { code: '42501' } } }, 'refused'],
    ['native uncertainty', { result: { data: null, error: { code: '57014' } } }, 'unavailable'],
    ['duplicate canonical rows', { result: { data: envelope([task(), task()]), error: null } }, 'unavailable'],
    ['foreign canonical row', { result: { data: envelope([{ ...task(), tenant_id: id(99) }]), error: null } }, 'unavailable'],
    ['wrong native actor envelope', { result: { data: { ...envelope(), actor_id: id(99) }, error: null } }, 'unavailable'],
    ['first read loses row on final authority read', { finalResult: { data: envelope([]), error: null } }, 'available'],
    ['final native refusal after first returned row', { finalResult: { data: null, error: { code: '42501' } } }, 'refused'],
    ['post-read Team permission withdrawn', { afterRole: 'unknown' }, 'refused'],
    ['post-read Team permission changed', { afterRole: 'member' }, 'refused'],
    ['fresh Team authority unavailable', { teamFailureAt: 2 }, 'unavailable'],
    ['post-read account classification changed', { afterClassification: { id: tenant, account_type: 'agency', parent_tenant_id: null } }, 'refused'],
  ]) await check('actual Chat ' + label + ' cannot leak a Task, retry or dispatch a writer', async () => {
    const r = await execute(options); assert.equal(r.value?.status, expected); assert.ok(!r.value.task); assert.ok(!r.wire.includes('"destination":"operations_work"')); noEffects(r);
  });
  await check('actual active-profile change rejects the retired read before model egress and cannot recover by a later same-workspace read', async () => {
    const r = await execute({ afterRead: id(99) }); assert.ok(!JSON.stringify(modelBodies).includes('Neutral exact late Task'));
    assert.ok(!r.wire.includes('Neutral exact late Task')); assert.ok(!r.wire.includes('"destination":"operations_work"'));
    assert.equal(r.shapes.filter(c => c.name === 'operations_crm_work_read').length, 1); noEffects(r);
  });
  await check('actual A→B→A active-profile transition remains revoked for the retired read', async () => {
    const r = await execute({ afterRead: id(99), aba: true }); assert.ok(!JSON.stringify(modelBodies).includes('Neutral exact late Task'));
    assert.ok(!r.wire.includes('Neutral exact late Task')); assert.ok(!r.wire.includes('"destination":"operations_work"'));
    assert.equal(r.shapes.filter(c => c.name === 'operations_crm_work_read').length, 1); noEffects(r);
  });
  for (const [label, row] of [['missing', null], ['unknown', { id: tenant, account_type: null, parent_tenant_id: null }], ['agency', { id: tenant, account_type: 'agency', parent_tenant_id: null }], ['parented', { id: tenant, account_type: 'standalone', parent_tenant_id: id(99) }], ['foreign', { id: id(99), account_type: 'standalone', parent_tenant_id: null }]]) await check('actual Chat refuses ' + label + ' classification despite tenant-tier title', async () => {
    const r = await execute({ classification: row }); assert.ok(!r.offered.includes('crm_get_task')); assert.ok(!r.shapes.some(c => c.name === 'operations_crm_work_read')); assert.ok(!r.wire.includes('"destination":"operations_work"')); noEffects(r);
  });
  for (const role of ['coach', 'unknown', null, '', { title: 'Owner' }]) await check('unrecognized Team permission has no Task offer or lookup: ' + JSON.stringify(role), async () => {
    const r = await execute({ role }); assert.ok(!r.offered.includes('crm_get_task')); assert.ok(!r.shapes.some(c => c.name === 'operations_crm_work_read')); noEffects(r);
  });
  await check('actual native transport deadline settles unavailable with cancelled signal, no replay or reference', async () => {
    const r = await execute({ hang: true }); assert.equal(r.value?.status, 'unavailable');
    const reads = r.shapes.filter(c => c.name === 'operations_crm_work_read'); assert.equal(reads.length, 1); assert.equal(reads[0].signal.aborted, true);
    assert.ok(!r.wire.includes('"destination":"operations_work"')); noEffects(r);
  });
  await check('read receipt failure cannot imply Task execution or silently replay the read', async () => {
    const r = await execute({ receiptError: true }); assert.equal(r.value?.status, 'available');
    assert.equal(r.shapes.filter(c => c.name === 'operations_crm_work_read').length, 2);
    assert.equal(r.rec.rpc.filter(c => c.name === 'record_capability_run').length, 1); noEffects(r);
  });
  // Separate active-protocol fixtures; all incumbent degraded controls above remain unchanged.
  // Use the same actual server registry loaded by Chat, never a handwritten Task declaration.
  for (const [label, options, expectedStatus, expectedFound] of [
    ['available record', {}, 'available', true],
    ['visible-empty', { result: { data: envelope([]), error: null } }, 'available', false],
    ['needs input', { args: { task_id: 'not-uuid' } }, 'needs_input', undefined],
    ['native refusal', { result: { data: null, error: { code: '42501' } } }, 'refused', undefined],
    ['unavailable', { result: { data: null, error: { code: '57014' } } }, 'unavailable', undefined],
  ]) await check('active ordinary Chat persists exact Task read truth: ' + label, async () => {
    const declared = PAIGE_SPINE_CAPABILITIES.filter(capability => capability.action?.chatTool === 'crm_get_task');
    assert.equal(declared.length, 1);
    assert.equal(declared[0].key, 'crm_clients.task_read');
    assert.equal(declared[0].action.classification, 'read');
    assert.equal(declared[0].action.riskPolicyKey, 'read_only');
    assert.equal(declared[0].action.approvalAuthority, 'none');
    assert.deepEqual([...declared[0].outcome.kinds].sort(), ['available', 'needs_input', 'refused', 'unavailable']);
    const r = await execute({ ...options, activeProtocol: true });
    assert.equal(r.value?.status, expectedStatus, 'the existing Task reader supplies the closed status');
    assert.equal(r.value?.found, expectedFound);
    assert.deepEqual(receipts.at(-1)?.bundle_ref?.interactive?.effects,
      [{ tool: 'crm_get_task', outcome: expectedStatus === 'available' ? 'reported_success' : 'reported_failure' }],
      'the actual settled interactive receipt must reflect the lookup, without native record/effect identities');
    assert.ok(!r.wire.includes("couldn't confirm whether the change went through"));
    if (expectedFound === true) assert.deepEqual(receipts.at(-1).bundle_ref.paige_record_links, [{ destination: 'operations_work', record_id: null }]);
    else assert.ok(!r.wire.includes('"destination":"operations_work"'));
    noEffects(r);
  });
}
console.log('RESULT ' + cases.filter(c => c.status === 'PASS').length + ' PASS / ' + cases.filter(c => c.status === 'FAIL').length + ' FAIL');
if (cases.some(c => c.status === 'FAIL')) process.exitCode = 1;
