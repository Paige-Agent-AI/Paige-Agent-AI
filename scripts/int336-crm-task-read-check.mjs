/** Actual Chat -> actual CRM door, with no network or production records.
 * The table double honours the real selected columns and status/tenant filters.
 * The native SQL execution port is synthetic: its refusals test propagation,
 * not PostgreSQL authorization/locking. Native SQL proofs remain separate.
 */
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: key => ({
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
})[key] ?? '' } };
const fake = await import('./knowledge-scope/fake-supabase.mjs');
const { capturedHandler } = await import('./knowledge-scope/stub-serve.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const chatHandler = capturedHandler();
await import('../supabase/functions/crm-command/index.ts');
const crmHandler = capturedHandler();
assert.notEqual(chatHandler, crmHandler);

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4);
const updated = '2026-10-15T13:00:00.000Z', created = '2026-10-14T12:00:00.000Z';
const task = (n, status, scope = tenant) => ({
  id: id(n), tenant_id: scope, title: `Protected task ${n}`, status, due_date: null,
  track: null, user_id: actor, biz_id: null, deal_id: null, source_thread_id: null,
  updated_at: updated, created_at: created, private_metadata: 'must never be selected',
});
const tasks = [task(10, 'pending'), task(11, 'completed'), task(12, 'in_progress'),
  task(13, 'cancelled'), task(14, 'pending', id(20))];
let scenario, modelBodies, reads, nativeAnswers, nativeCalls;

function projectRows(rows, filters) {
  const selected = filters.find(filter => filter[0] === 'select')?.[1];
  assert.equal(typeof selected, 'string');
  assert.notEqual(selected, '*', 'read must retain a bounded column projection');
  return rows.filter(row => filters.every(([op, column, value]) =>
    op === 'eq' ? row[column] === value : op === 'neq' ? row[column] !== value : true))
    .map(row => Object.fromEntries(selected.split(',').map(column => [column.trim(), row[column.trim()]])));
}

function toolResponse(name, args) {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `tool-${modelBodies.length}`, name } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } });
}

globalThis.fetch = async (url, options) => {
  assert.ok(String(url).startsWith('https://api.anthropic.com/'), 'all non-model egress is refused');
  const body = JSON.parse(options.body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({
    content: [{ type: 'text', text: JSON.stringify({ intent: scenario.write ? 'act' : 'answer',
      research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .9 }) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  modelBodies.push(body);
  const results = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(part => part.type === 'tool_result').flatMap(part => {
      try { return [JSON.parse(part.content)]; } catch { return []; }
    });
  const read = results.find(result => Array.isArray(result.tasks));
  if (!read && !reads.length && !results.length) return toolResponse('crm_list_tasks', scenario.args ?? {});
  if (scenario.write && read?.tasks?.length && !nativeAnswers.length) {
    const row = read.tasks.find(value => value.id === id(10));
    if (row) {
      const version = row.updated_at ?? row.created_at;
      return toolResponse(scenario.write === 'update' ? 'crm_update_task' : 'crm_complete_task', {
        task_id: row.id,
        ...(version == null ? {} : { expected_updated_at: version }),
        ...(scenario.write === 'update' ? { patch: { title: 'Reviewed task correction' } } : {}),
      });
    }
  }
  return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The task read and native result are shown."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
};

async function run(config) {
  scenario = config; modelBodies = []; reads = []; nativeAnswers = []; nativeCalls = [];
  const receipts = [];
  let executor = null;
  const rows = tasks.map(row => ({ ...row }));
  if (config.legacy) rows[0].updated_at = null;
  if (config.missingVersion) { rows[0].updated_at = null; rows[0].created_at = null; }
  if (config.invalidVersion) rows[0].updated_at = 'not-a-timestamp';
  const rec = fake.setScenario({
    authUser: { id: actor },
    tables: {
      profiles: [{ active_tenant_id: tenant }],
      user_roles: [{ role: 'admin' }],
      tenant_members: [{ tenant_id: tenant, user_id: actor, role: config.member ? 'member' : 'owner', status: 'active' }],
      tenants: [{ id: tenant, account_number: 1001, account_type: 'standalone', parent_tenant_id: null }],
      tasks: filters => {
        // Only the canonical selected-workspace task read is exercised here.
        if (!filters.some(([op, column]) => op === 'eq' && column === 'tenant_id')) return [];
        const projected = projectRows(rows, filters);
        reads.push({ filters, rows: projected });
        return projected;
      },
      paige_chat_threads: [{ id: thread, tenant_id: tenant, caller_user_id: actor }],
      paige_chat_turns: filters => filters.some(filter => filter[0] === 'contains') ? [] : receipts,
    },
    functions: { 'crm-command': async options => {
      nativeCalls.push(options.body);
      const response = await crmHandler(new Request('https://test.supabase.co/functions/v1/crm-command', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify(options.body),
      }));
      const body = await response.json();
      nativeAnswers.push({ status: response.status, body });
      return response.ok ? { data: body, error: null }
        : { data: null, error: { name: 'FunctionsHttpError', context: { status: response.status, json: async () => body } } };
    } },
    rpcs: {
      current_user_tenant_id: { data: config.workspaceChanged ? id(20) : tenant, error: null },
      is_tenant_admin_as: { data: !config.deniedRead, error: null },
      is_platform_owner: { data: false, error: null },
      agency_can_manage_child: { data: false, error: null },
      paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null },
      check_rate_limit: { data: true, error: null },
      resolve_tool_autonomy: { data: 'auto', error: null },
      resolve_tool_autonomy_detail: { data: { ceiling_allows_auto: true }, error: null },
      resolve_tool_autonomy_many: { data: [], error: null },
      get_actor_access: { data: { tier: 'tenant' }, error: null },
      get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: null, playbook_config: null,
        playbook_slug: null, funding_enabled: false, brand: null }], error: null },
      paige_chat_interactive_begin_v2: { data: { status: 'accepted', turn_id: id(5) }, error: null },
      paige_chat_interactive_executor_v2: args => {
        if (args.p_operation === 'acquire') executor = intent;
        if (args.p_operation === 'release') executor = null;
        return { data: { latest: intent, executor, acquired: executor === intent, terminal: receipts.length > 0 }, error: null };
      },
      paige_chat_interactive_settle: args => {
        receipts.push({ role: 'assistant', content: args.p_content, bundle_ref: args.p_bundle_ref });
        return { data: id(6), error: null };
      },
      read_crm_command_result: { data: null, error: null },
      execute_crm_command: args => config.stale
        ? { data: null, error: { code: '40001', message: 'CRM_VERSION_CONFLICT' } }
        : { data: { ok: true, action: args._command.action, outcome: 'succeeded',
          readback: { id: id(10), title: 'Protected task 10', status: 'completed', updated_at: updated }, receipt_recorded: true }, error: null },
    },
  });
  const response = await chatHandler(new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: config.write ? 'Read my task and complete the exact current task.' : 'List my tasks.' }],
      threadId: thread, requestIntentId: intent, interactive: { kind: 'message' } }),
  }));
  const wire = await response.text();
  assert.equal(response.status, 200, wire.slice(0, 500));
  return { rec, wire, reads, nativeAnswers, nativeCalls, receipts };
}

const failures = [];
async function check(name, config, verify) {
  try { const result = await run(config); verify(result); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
const ids = result => result.reads.at(-1)?.rows.map(row => row.id).sort();
const columns = result => result.reads.at(-1)?.filters.find(filter => filter[0] === 'select')?.[1].split(',').map(value => value.trim());

await check('native task versions are selected without private metadata or foreign records', {}, result => {
  assert.ok(columns(result).includes('updated_at'), 'updated_at must come from the actual selected columns');
  assert.ok(columns(result).includes('created_at'), 'created_at fallback must come from the actual selected columns');
  assert.ok(!columns(result).includes('private_metadata'));
  assert.ok(!ids(result).includes(id(14)), 'foreign-tenant tasks are excluded by the real query filter');
});
await check('default read preserves open-task behaviour', {}, result => assert.deepEqual(ids(result), [id(10), id(12), id(13)]));
await check('explicit all includes completed tasks', { args: { status: 'all' } }, result => assert.deepEqual(ids(result), [id(10), id(11), id(12), id(13)]));
for (const [status, n] of [['pending', 10], ['completed', 11], ['in_progress', 12], ['cancelled', 13]]) {
  await check(`explicit ${status} remains exact`, { args: { status } }, result => assert.deepEqual(ids(result), [id(n)]));
}
for (const write of ['complete', 'update']) await check(`current read -> exact native ${write} command`, { write }, result => {
  assert.equal(result.nativeCalls.length, 1, 'one native door invocation');
  assert.equal(result.nativeCalls[0].command.expected_updated_at, updated);
  assert.equal(result.nativeCalls[0].command.task_id, id(10));
  assert.equal(result.nativeCalls[0].expected_tenant_id, tenant);
  assert.equal(result.nativeAnswers[0].status, 200);
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 1);
  assert.equal(result.receipts.length, 1);
});
await check('legacy task uses its actual created_at fallback', { write: 'complete', legacy: true }, result => {
  assert.equal(result.nativeCalls[0]?.command.expected_updated_at, created);
  assert.equal(result.nativeAnswers[0]?.status, 200);
});
await check('missing native version is refused before execution', { write: 'complete', missingVersion: true }, result => {
  assert.equal(result.nativeAnswers[0]?.status, 400);
  assert.equal(result.nativeAnswers[0]?.body.code, 'CRM_COMMAND_INVALID');
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 0);
});
await check('stale native SQL refusal is preserved without retry', { write: 'complete', stale: true }, result => {
  assert.equal(result.nativeCalls[0]?.command.expected_updated_at, updated);
  assert.equal(result.nativeAnswers[0]?.status, 409);
  assert.equal(result.nativeAnswers[0]?.body.code, 'CRM_VERSION_CONFLICT');
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 1);
  assert.equal(result.nativeCalls.length, 1);
});
await check('invalid native version is refused before execution', { write: 'complete', invalidVersion: true }, result => {
  assert.equal(result.nativeAnswers[0]?.status, 400);
  assert.equal(result.nativeAnswers[0]?.body.code, 'CRM_COMMAND_INVALID');
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 0);
});
await check('native role refusal grants no writer access', { write: 'complete', member: true }, result => {
  assert.equal(result.nativeAnswers[0]?.status, 403);
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 0);
});
await check('a changed workspace refuses the read before any task query or command', { write: 'complete', workspaceChanged: true }, result => {
  assert.equal(result.reads.length, 0);
  assert.equal(result.nativeCalls.length, 0);
  assert.equal(result.rec.rpc.filter(call => call.name === 'execute_crm_command').length, 0);
});

if (failures.length) { console.error(JSON.stringify({ failures }, null, 2)); process.exitCode = 1; }
else console.log('PASS 15 actual-handler task read/command cases; native SQL port remains synthetic, no production or provider proof');
