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
  if (name !== 'list_team_bookings' && !['current_user_tenant_id', 'is_tenant_member', 'is_tenant_admin'].includes(name)) return originalRpc.call(this, name, parameters);
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


const bookingId = id(20);
const booking = () => ({ id: bookingId, tenant_id: tenant, calendar_id: id(21), host_user_id: actor, contact_id: null,
  title: 'Neutral saved meeting', start_at: '2026-10-17T16:00:00+00:00', end_at: '2026-10-17T16:30:00+00:00', timezone: 'UTC', status: 'scheduled', booking_kind: 'single', guest_name: null });
const cases = [];
const check = async (name, run) => { try { await run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); } };
async function execute({ role = 'owner', args = { booking_id: bookingId }, result = { data: [booking()], error: null }, afterRead, tenantResult = tenant, nativeMember = true, nativeAdmin = true, tier = 'tenant', classification = { id: tenant, account_type: 'standalone', parent_tenant_id: null }, afterClassification, activeProtocol = false } = {}) {
  receipts.length = 0; modelBodies.length = 0; queryShapes.length = 0; executorState.held = null;
  modelCalls = 0; readToolUse = { name: 'read_calendar_booking', input: args };
  let active = tenant; let classificationRow = classification;
  const rec = scenario({ tables: { profiles: () => [{ active_tenant_id: active }], tenants: () => classificationRow ? [classificationRow] : [] }, rpcs: {
    ...(activeProtocol ? { paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null },
      paige_chat_interactive_publication_context_v2: { data: true, error: null } } : {}),
    get_actor_access: { data: { tier }, error: null },
    get_team_authority_readiness: { data: [{ fact_key: 'viewer_permission', value: role, status: 'available', tenant_id: tenant }], error: null },
    current_user_tenant_id: { data: tenantResult, error: null },
    list_team_bookings: () => { if (afterRead) active = afterRead; if (afterClassification) classificationRow = afterClassification; return result; },
    is_tenant_member: { data: nativeMember, error: null }, is_tenant_admin: { data: nativeAdmin, error: null },
  } });
  const response = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Read saved booking ' + bookingId }] }, id(100 + cases.length)));
  const wire = await response.text();
  const tools = modelBodies.flatMap(body => body.messages ?? []).filter(message => message.role === 'user').flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'tool_result');
  let value = null;
  for (const part of tools) { try { const parsed = JSON.parse(part.content); if (parsed?.status) value = parsed; } catch {} }
  if (activeProtocol && ['available', 'needs_input', 'refused', 'unavailable'].includes(value?.status)) {
    assert.deepEqual(receipts.at(-1)?.bundle_ref?.interactive?.effects,
      [{ tool: 'read_calendar_booking', outcome: value.status === 'available' ? 'reported_success' : 'reported_failure' }],
      'the actual settled receipt must describe the read, including visible-empty and native refusal');
  }
  return { rec, wire, value, shapes: [...queryShapes], offered: modelBodies[0]?.tools?.map(t => t.name) ?? [] };
}
await check('actual ordinary Chat dispatch reads exactly one native booking and persists only the Calendar reference', async () => {
  const r = await execute();
  assert.equal(r.value?.status, 'available'); assert.equal(r.value?.found, true); assert.deepEqual(r.value.booking, booking());
  assert.ok(r.offered.includes('read_calendar_booking'));
  const native = r.shapes.filter(c => c.name === 'list_team_bookings'); assert.equal(native.length, 1); assert.equal(native[0].client, 'jwt');
  assert.deepEqual(native[0].parameters, { _from: '-infinity', _to: 'infinity', _host_ids: null, _tenant_id: tenant, _booking_id: bookingId });
  assert.deepEqual(native[0].operations.slice(1), [['eq','id',bookingId], ['limit',2]]); assert.ok(native[0].signal instanceof AbortSignal);
  assert.ok(r.wire.includes('"destination":"calendar","record_id":null'));
  assert.deepEqual(receipts.at(-1).bundle_ref.paige_record_links, [{ destination: 'calendar', record_id: null }]);
  assert.ok(!JSON.stringify(r.value).includes('record_links')); assert.ok(!JSON.stringify(r.value).includes('/solo/'));
  assert.equal(r.rec.rpc.filter(c => c.name === 'record_capability_run').length, 1);
  assert.equal(r.rec.rpc.filter(c => c.name === 'get_team_authority_readiness').length, 1);
  const classification = r.rec.from.filter(c => c.table === 'tenants' && c.filters.some(f => f[0] === 'select' && f[1] === 'id,account_type,parent_tenant_id')); assert.equal(classification.length, 3);
  assert.ok(classification.every(c => c.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === tenant) && c.filters.some(f => f[0] === 'select' && f[1] === 'id,account_type,parent_tenant_id')));

});
await check('actual member own-host read keeps native authority', async () => { const r = await execute({ role: 'member', nativeAdmin: false }); assert.equal(r.value?.status, 'available'); assert.ok(r.offered.includes('read_calendar_booking')); assert.ok(!r.shapes.some(c => c.name === 'is_tenant_admin')); });
await check('actual member other-host read stays native-visible-empty without a Calendar record claim', async () => { const r = await execute({ role: 'member', result: { data: [], error: null }, nativeAdmin: false }); assert.equal(r.value?.status, 'available'); assert.equal(r.value?.found, false); assert.ok(!r.wire.includes('"destination":"calendar"')); });
for (const [label, options, expected] of [
  ['invalid model UUID', { args: { booking_id: 'not-a-uuid' } }, 'needs_input'],
  ['model tenant override', { args: { booking_id: bookingId, tenant_id: tenant } }, 'needs_input'],
  ['server tenant changed', { tenantResult: id(99) }, 'refused'],
  ['active membership revoked', { nativeMember: false }, 'refused'],
  ['native refusal', { result: { data: null, error: { code: '42501' } } }, 'refused'],
  ['native uncertainty', { result: { data: null, error: { code: '57014' } } }, 'unavailable'],
  ['duplicate native result', { result: { data: [booking(), booking()], error: null } }, 'unavailable'],
  ['foreign native row', { result: { data: [{ ...booking(), tenant_id: id(99) }], error: null } }, 'unavailable'],
]) await check('actual Chat ' + label + ' cannot claim a booking or trigger a writer', async () => {
  const r = await execute(options); assert.equal(r.value?.status, expected); assert.ok(!r.value.booking); assert.ok(!r.wire.includes('"destination":"calendar"'));
  assert.ok(!r.rec.rpc.some(c => /create.*booking|execute_crm|issue_|send_|approve/.test(c.name))); assert.equal(r.rec.functions.length, 0);
});
await check('actual post-read active profile transition suppresses all booking details before model egress', async () => {
  const r = await execute({ afterRead: id(99) });
  assert.ok(!JSON.stringify(modelBodies).includes('Neutral saved meeting'));
  assert.ok(!r.wire.includes('Neutral saved meeting')); assert.ok(!r.wire.includes('"destination":"calendar"'));
  assert.equal(r.rec.rpc.filter(c => c.name === 'list_team_bookings').length, 1);
  assert.ok(r.rec.from.some(c => c.table === 'profiles' && c.filters.some(f => f[0] === 'eq' && f[1] === 'user_id' && f[2] === actor)));
});
for (const [label, classification] of [['missing', null], ['unknown', { id: tenant, account_type: null, parent_tenant_id: null }], ['agency', { id: tenant, account_type: 'agency', parent_tenant_id: null }], ['parented', { id: tenant, account_type: 'standalone', parent_tenant_id: id(99) }], ['foreign', { id: id(99), account_type: 'standalone', parent_tenant_id: null }]]) await check('actual Chat classification ' + label + ' is refused despite tenant actor tier', async () => {
  const r = await execute({ classification }); assert.equal(r.value?.status, 'refused'); assert.ok(!r.shapes.some(c => c.name === 'list_team_bookings')); assert.ok(!r.wire.includes('"destination":"calendar"'));
});
await check('actual Chat classification changing after read suppresses a valid row', async () => {
  const r = await execute({ afterClassification: { id: tenant, account_type: 'agency', parent_tenant_id: null } }); assert.equal(r.value?.status, 'refused'); assert.ok(!JSON.stringify(modelBodies).includes('Neutral saved meeting')); assert.ok(!r.wire.includes('"destination":"calendar"'));
});
for (const role of ['coach', 'unknown', null, '', { title: 'Owner' }]) await check('unrecognized or retired Team permission cannot offer or read: ' + JSON.stringify(role), async () => {
  const r = await execute({ role }); assert.ok(!r.offered.includes('read_calendar_booking')); assert.ok(!r.shapes.some(c => c.name === 'list_team_bookings'));
  assert.ok(!JSON.stringify(modelBodies).includes('Neutral saved meeting')); assert.ok(!r.wire.includes('"destination":"calendar"'));
});
for (const [label, options] of [
  ['available record', {}], ['visible-empty', { result: { data: [], error: null } }],
  ['needs input', { args: { booking_id: 'bad' } }], ['native refusal', { nativeMember: false }],
  ['unavailable', { result: { data: null, error: { code: 'XX000' } } }],
]) await check('active ordinary Chat persists closed-read truth: ' + label, async () => {
  const r = await execute({ ...options, activeProtocol: true });
  assert.ok(r.value?.status, 'the actual read result reaches the model');
  assert.ok(!r.wire.includes("couldn't confirm whether the change went through"));
  assert.equal(r.rec.functions.length, 0);
  assert.ok(!r.rec.rpc.some(c => /create.*booking|execute_crm|send_|approve/.test(c.name)));
});
console.log('RESULT ' + cases.filter(c => c.status === 'PASS').length + ' PASS / ' + cases.filter(c => c.status === 'FAIL').length + ' FAIL');
if (cases.some(c => c.status === 'FAIL')) process.exitCode = 1;
