/** PRE-1 shared integration proof. No provider, live database, or admission activation.
 * Run: node --import ./scripts/knowledge-scope/register.mjs scripts/agreements/chat-draft-shared-integration.test.mjs
 * Add --require-domain-contract only on a checkout composed with Sales' reviewed helper.
 * The dispatch is extracted from the actual TypeScript AST and evaluated, never reimplemented.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { transform } from 'esbuild';

globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  ANTHROPIC_API_KEY: 'test-key' })[key] ?? '' } };
const repoFile = path => new URL(`../../${path}`, import.meta.url);
const source = await readFile(repoFile('supabase/functions/paige-ai-chat/index.ts'), 'utf8');
const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let branch;
let admittedReadTools;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText(parsed) === 'tc.function.name === "agreement_draft"') {
    assert.equal(branch, undefined, 'one canonical agreement_draft dispatch branch');
    branch = node.thenStatement;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'CONVERSATIONAL_ADMITTED_READ_TOOLS') {
    const names = [];
    function strings(child) { if (ts.isStringLiteral(child)) names.push(child.text); ts.forEachChild(child, strings); }
    strings(node.initializer);
    admittedReadTools = names;
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(branch, 'canonical dispatch branch exists');
assert.deepEqual(admittedReadTools, ['read_business_metric', 'get_business_snapshot',
  'read_client_engagement_status', 'read_business_time_zone', 'read_calendar_booking'], 'the closed read set includes only the reviewed Calendar successor; PRE-1 adds no action');
let branchSource = branch.getText(parsed);
// Deliberate in-memory defect controls: no production source is rewritten during falsification.
const mutation = process.argv.find(arg => arg.startsWith('--mutate='))?.slice('--mutate='.length);
const mutants = {
  'drop-version': ['expectedUpdatedAt: args.expectedUpdatedAt,', ''],
  'normalize-version': ['expectedUpdatedAt: args.expectedUpdatedAt,', 'expectedUpdatedAt: new Date(args.expectedUpdatedAt).toISOString(),'],
  'hide-uncertainty': ['outcome_unknown: true', 'outcome_unknown: false'],
  'false-rail-failure': ['case "no_readback": return "capability_outcome_unknown";', 'case "no_readback": return "capability_failed";'],
  'false-no-write': ['The agreement draft did not report back.', 'Nothing was written. Try again.'],
  'drop-no-write-proof': ['not_applied: true', 'not_applied: false'],
  'false-unavailable-proof': ['"empty_body", "refused", "already_sent", "conflict"].includes(r.reason)',
    '"empty_body", "refused", "already_sent", "conflict", "unavailable"].includes(r.reason)'],
  'false-unknown-proof': ['"empty_body", "refused", "already_sent", "conflict"].includes(r.reason)',
    '"empty_body", "refused", "already_sent", "conflict", "no_readback"].includes(r.reason)'],
};
if (mutation) {
  assert.ok(mutants[mutation], 'known deliberate mutation');
  const [before, after] = mutants[mutation];
  assert.ok(branchSource.includes(before), 'mutation targets an actual source token');
  branchSource = branchSource.replace(before, after);
}
const evaluated = await transform(`async function dispatch(tc, personaCtx, supabaseClient, supabase,
  user, draftAgreement, recordCapabilityRun, toolResults) ${branchSource}`, { loader: 'ts', format: 'cjs', target: 'node20' });
const dispatch = new Function(`${evaluated.code}; return dispatch;`)();
const { AGREEMENT_TOOLS, AGREEMENT_DRAFT_CAPABILITY } = await import('../../supabase/functions/_shared/paige-spine/domains/agreement.ts');
const { confirmFingerprint } = await import('../../supabase/functions/_shared/confirm-fingerprint.ts');
const { interactiveEffect } = await import('../../supabase/functions/_shared/paige-turn/interactive.ts');
const { recordCapabilityRun } = await import('../../supabase/functions/_shared/capability-record.ts');
const { sayWhatTheCardSays, classifySpentApproval } = await import('../../supabase/functions/_shared/approval-outcome.ts');

let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`); }
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), contact = id(4), agreement = id(5);
const originalToken = '2026-10-14T10:11:12.123456-04:00';
const draftArgs = { contactId: contact, title: 'Service agreement', bodyMarkdown: 'Draft service terms' };
const revision = { ...draftArgs, agreementId: agreement, expectedUpdatedAt: originalToken };
const tool = AGREEMENT_TOOLS.find(entry => entry.function.name === 'agreement_draft').function;
await check('model and defined input add optional exact version; create contract stays compatible', () => {
  for (const schema of [tool.parameters, AGREEMENT_DRAFT_CAPABILITY.input]) {
    assert.equal(schema.properties.expectedUpdatedAt.type, 'string');
    assert.deepEqual([...schema.required], ['contactId', 'title', 'bodyMarkdown']);
  }
  assert.equal(tool.parameters.properties.expectedUpdatedAt.format, 'date-time');
  assert.equal(AGREEMENT_DRAFT_CAPABILITY.input.properties.expectedUpdatedAt.format, undefined,
    'defined input stays within the existing provider-safe kit subset');
  assert.match(tool.description, /agreement_list.*agreement_status|agreement_status.*agreement_list/);
  assert.match(tool.description, /updatedAt/);
  assert.match(tool.description, /required.*revis|revis.*required/i);
  assert.match(tool.description, /never.*refresh|do not.*refresh/i);
});

async function drive(args, result) {
  const calls = [], records = [], outputs = [];
  const caller = { kind: 'ordinary-jwt' }, admin = { kind: 'service', rpc: async (name, payload) => {
    records.push({ name, ...payload }); return { data: true, error: null };
  } };
  const frozen = JSON.stringify(args);
  await dispatch({ id: 'draft-call', function: { name: 'agreement_draft', arguments: frozen } },
    { tenant_id: tenant }, caller, admin, { id: actor }, async input => {
      calls.push(input);
      return typeof result === 'function' ? result(input) : result;
    }, recordCapabilityRun, outputs);
  assert.equal(JSON.stringify(args), frozen, 'approved args are unchanged');
  assert.equal(calls.length, 1, 'exactly one domain invocation, no retry');
  assert.equal(calls[0].caller, caller, 'domain receives ordinary caller client');
  assert.equal(calls[0].expectedTenantId, tenant, 'server-resolved tenant equality brake');
  assert.equal(outputs.length, 1);
  return { call: calls[0], record: records[0], result: JSON.parse(outputs[0].content) };
}
const saved = { success: true, agreementId: agreement, title: draftArgs.title, status: 'draft', created: false };
await check('revision dispatch preserves microseconds and offset verbatim; create needs no timestamp', async () => {
  const revised = await drive(revision, saved);
  assert.equal(revised.call.expectedUpdatedAt, originalToken);
  assert.deepEqual(revised.result, saved);
  assert.equal(revised.record._outcome, 'capability_succeeded');
  const created = await drive(draftArgs, { ...saved, created: true });
  assert.equal(created.call.expectedUpdatedAt, undefined);
  assert.equal(created.call.agreementId, undefined);
});
await check('canonical fingerprint binds original version and rejects changed or omitted version', async () => {
  const fingerprint = await confirmFingerprint('agreement_draft', revision);
  assert.equal(await confirmFingerprint('agreement_draft', { ...revision, confirm: true }), fingerprint);
  assert.notEqual(await confirmFingerprint('agreement_draft', { ...revision, expectedUpdatedAt: '2026-10-14T10:11:13.123456-04:00' }), fingerprint);
  assert.notEqual(await confirmFingerprint('agreement_draft', { ...revision, expectedUpdatedAt: undefined }), fingerprint);
  assert.notEqual(await confirmFingerprint('agreement_draft', { ...revision, expectedUpdatedAt: '2026-10-14T14:11:12.123Z' }), fingerprint,
    'even a normalized equivalent instant is a different approved argument');
});
let unknownResult;
await check('missing readback records uncertainty and feeds actual interactiveEffect', async () => {
  const reply = await drive(revision, { success: false, reason: 'no_readback', message: 'The save was not confirmed.' });
  assert.equal(reply.result.reason, 'no_readback', 'helper reason union is retained');
  assert.equal(reply.result.outcome_unknown, true);
  assert.equal(reply.record._outcome, 'capability_outcome_unknown');
  assert.equal(interactiveEffect('agreement_draft', reply.result).outcome, 'outcome_unknown');
  unknownResult = reply.result;
});
await check('known refusals remain failures without uncertainty; unavailable remains failed', async () => {
  for (const reason of ['refused', 'conflict', 'already_sent', 'no_workspace', 'empty_title', 'empty_body', 'bad_agreement_id', 'bad_contact_id', 'unavailable']) {
    const reply = await drive(revision, { success: false, reason, message: 'Domain refusal.' });
    assert.notEqual(reply.result.outcome_unknown, true, reason);
    assert.equal(interactiveEffect('agreement_draft', reply.result).outcome, 'reported_failure', reason);
    assert.equal(reply.record._outcome, reason === 'unavailable' ? 'capability_failed' : 'capability_refused', reason);
  }
});
await check('spent approval preserves known no-write refusal and retains unknown-write brake', async () => {
  for (const reason of ['no_workspace', 'bad_contact_id', 'bad_agreement_id', 'empty_title', 'empty_body', 'refused', 'already_sent', 'conflict']) {
    const reply = await drive(revision, { success: false, reason, message: 'Nothing was written.' });
    const approvedContent = sayWhatTheCardSays(JSON.stringify(reply.result));
    assert.equal(classifySpentApproval(approvedContent).outcome, 'not_run', reason);
    const approvedResult = JSON.parse(approvedContent);
    assert.equal(approvedResult.reason, reason, 'domain reason is preserved after approval');
    assert.equal(approvedResult.not_applied, true, reason);
    assert.notEqual(approvedResult.outcome_unknown, true, reason);
    assert.equal(interactiveEffect('agreement_draft', approvedResult).outcome, 'reported_failure', reason);
    assert.equal(reply.record._outcome, 'capability_refused', reason);
  }
  for (const result of [{ success: false, reason: 'no_readback', message: 'The save was not confirmed.' },
    { success: false, reason: 'unavailable', message: 'No reliable no-write proof.' },
    () => { throw new Error('fixture postwrite transport loss'); }]) {
    const reply = await drive(revision, result);
    assert.notEqual(reply.result.not_applied, true, 'unknown or unproven outcome never claims no effect');
    const approvedContent = sayWhatTheCardSays(JSON.stringify(reply.result));
    assert.equal(classifySpentApproval(approvedContent).outcome, 'unconfirmed');
    assert.equal(interactiveEffect('agreement_draft', JSON.parse(approvedContent)).outcome, 'outcome_unknown');
  }
});
await check('postdispatch throw is unknown with one canonical Rail record and no no-write claim', async () => {
  const reply = await drive(revision, () => { throw new Error('fixture postwrite transport loss'); });
  assert.equal(reply.result.outcome_unknown, true);
  assert.equal(reply.record._outcome, 'capability_outcome_unknown');
  assert.equal(interactiveEffect('agreement_draft', reply.result).outcome, 'outcome_unknown');
  assert.doesNotMatch(JSON.stringify(reply.result), /nothing was written|nothing changed|try again/i);
  assert.match(JSON.stringify(reply.result), /read|check/i);
});

// Feed the real translated result's persisted effect into the actual handler. Only module ports are
// doubled by the existing repository loader; the production admission/executor/brake is unchanged.
await check('actual handler brakes a successor agreement write after persisted uncertainty', async () => {
  const effects = [interactiveEffect('agreement_draft', unknownResult)];
  const fake = await import('../knowledge-scope/fake-supabase.mjs');
  await import('../../supabase/functions/paige-ai-chat/index.ts');
  const { capturedHandler } = await import('../knowledge-scope/stub-serve.mjs');
  let modelCalls = 0, latest = id(6), executor = null;
  const modelMessages = [];
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).includes('api.anthropic.com'), 'all network is refused except local model-port double');
    const body = JSON.parse(opts.body);
    if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text', text: JSON.stringify({ intent: 'answer', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .9 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
    modelCalls++; modelMessages.push(body.messages);
    assert.ok(modelCalls <= 2, 'bounded fake conversation');
    const events = modelCalls === 1
      ? [{ type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'successor-write', name: 'agreement_draft' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(revision) } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]
      : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Readback is required.' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } }];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const scenario = { authUser: { id: actor }, tables: {
    profiles: [{ active_tenant_id: tenant }], tenant_members: [{ tenant_id: tenant }],
    paige_chat_threads: [{ id: thread, tenant_id: tenant, caller_user_id: actor }],
    paige_chat_turns: [{ role: 'assistant', content: 'Unconfirmed draft.', bundle_ref: { interactive: { effects } } }],
  }, rpcs: {
    paige_chat_interactive_protocol: { data: { version: 2, active: true }, error: null },
    check_rate_limit: { data: true, error: null }, resolve_tool_autonomy: { data: 'auto', error: null },
    resolve_tool_autonomy_detail: { data: { ceiling_allows_auto: true }, error: null },
    resolve_tool_autonomy_many: { data: [{ tool_key: 'agreement_draft', mode: 'auto', ceiling_allows_auto: true }], error: null },
    get_actor_access: { data: { tier: 'tenant' }, error: null },
    get_paige_persona_context: { data: [{ tenant_id: tenant, tenant_name: null, playbook_config: null, playbook_slug: null, funding_enabled: false, brand: null }], error: null },
    paige_chat_interactive_begin_v2: args => { latest = args.p_intent; return { data: { status: 'accepted', turn_id: id(7) }, error: null }; },
    paige_chat_interactive_executor_v2: args => {
      if (args.p_operation === 'acquire') executor = args.p_intent;
      if (args.p_operation === 'release') executor = null;
      return { data: { latest, executor, acquired: true, terminal: true }, error: null };
    },
    paige_chat_interactive_settle: { data: id(8), error: null },
  } };
  const rec = fake.setScenario(scenario);
  const response = await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Revise the agreement' }], threadId: thread,
      requestIntentId: id(6), interactive: { kind: 'message' } }),
  }));
  const wire = await response.text();
  assert.equal(response.status, 200, wire);
  assert.equal(rec.rpc.filter(call => call.name === 'save_paige_agreement').length, 0, 'prior uncertainty prevents a second write');
  assert.equal(modelCalls, 2, wire);
  assert.match(JSON.stringify(modelMessages[1]), /prior_effect_reconciliation_required/, 'actual handler returned its canonical brake');

  // Reuse the existing scoped-card native-resume fixture contract. The stored original args run
  // after a real claim; both the card and durable interactive receipt must report known refusal.
  const issuedRequest = id(30), approvedIntent = id(31), receipts = [];
  const bareFingerprint = await confirmFingerprint('agreement_draft', {
    intent: await confirmFingerprint('agreement_draft', revision), tenant, thread, client: null,
  });
  const approvedToken = `${bareFingerprint}:${issuedRequest}`;
  const card = { tool: 'agreement_draft', fingerprint: approvedToken };
  const proposal = { tool_name: 'agreement_draft', args: revision, fingerprint: bareFingerprint,
    issued_in_request: issuedRequest, server_issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(), consumed_at: null };
  modelMessages.length = 0;
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).includes('api.anthropic.com'), 'local model-port double only');
    const body = JSON.parse(opts.body);
    if (body.system?.startsWith('You label one message sent to PAIGE')) return Response.json({ content: [{ type: 'text',
      text: JSON.stringify({ intent: 'answer', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: true, confidence: .9 }) }] });
    modelMessages.push(body.messages);
    return new Response('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The draft changed; read its current version before proposing again."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n');
  };
  const approvedRec = fake.setScenario({ ...scenario, tables: { ...scenario.tables,
    tenant_members: [{ tenant_id: tenant, role: 'owner', status: 'active' }],
    paige_pending_confirmations: [proposal],
    paige_agreements: [{ id: agreement, tenant_id: tenant, contact_id: contact, status: 'draft',
      updated_at: '2026-10-14T10:11:13.123456-04:00', body_source: 'markdown' }],
    paige_chat_turns: filters => filters.some(filter => filter[0] === 'contains') ? receipts : [
      { id: id(32), role: 'user', content: 'Revise the agreement' },
      { id: id(33), role: 'assistant', content: 'Approval is needed.', bundle_ref: { paige_confirm: [card], turn_state: { state: 'WAIT_APPROVAL' } } }, ...receipts],
  }, rpcs: { ...scenario.rpcs,
    current_user_tenant_id: { data: tenant, error: null }, is_tenant_admin_as: { data: true, error: null },
    agency_can_manage_child: { data: false, error: null },
    save_paige_agreement: { data: null, error: { code: '40001', message: 'stale version' } },
    record_capability_run: { data: true, error: null },
    paige_chat_interactive_settle: args => { receipts.push({ role: 'assistant', content: args.p_content,
      bundle_ref: args.p_bundle_ref }); return { data: id(34), error: null }; },
  } });
  const approvedResponse = await capturedHandler()(new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Approve the exact agreement revision' }], threadId: thread,
      requestIntentId: approvedIntent, interactive: { kind: 'message' }, approvedConfirmations: [approvedToken] }),
  }));
  const approvedWire = await approvedResponse.text();
  assert.equal(approvedResponse.status, 200, approvedWire);
  assert.ok(approvedRec.inserts.some(entry => entry.table === 'paige_pending_confirmations' && entry.update && entry.row.consumed_at),
    'actual canonical confirmation claim was spent');
  const frames = approvedWire.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const approvalOutcome = frames.find(frame => frame.paige_approval_outcome)?.paige_approval_outcome;
  assert.equal(approvalOutcome?.actions?.[0]?.outcome, 'not_run', approvedWire);
  assert.equal(receipts.at(-1)?.bundle_ref?.interactive?.effects?.[0]?.outcome, 'reported_failure', approvedWire);
  assert.ok(approvedRec.rpc.some(call => call.name === 'record_capability_run' && call.args._outcome === 'capability_refused'), approvedWire);
  assert.match(JSON.stringify(modelMessages), /not_applied/, 'model received the same known-no-write result');
  console.log('PASS actual approved handler claim: conflict stays not_run on card and reported_failure in durable receipt');
});

if (process.argv.includes('--require-domain-contract')) {
  await check('composed Sales helper refuses revision missing version before any I/O', async () => {
    const { draftAgreement } = await import('../../supabase/functions/_shared/agreements/chat-write.ts');
    let reads = 0, writes = 0;
    const result = await draftAgreement({ caller: { rpc: async () => { writes++; return { data: null, error: null }; },
      from: () => { reads++; throw new Error('missing version must stop before a read'); } }, expectedTenantId: tenant,
      ...draftArgs, agreementId: agreement });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'conflict', 'Sales known missing-version refusal, not an I/O failure');
    assert.equal(reads, 0, 'Sales dependency must reject absent version before any caller read');
    assert.equal(writes, 0, 'Sales dependency must reject absent version before any RPC');
  });
} else {
  console.log('UNVERIFIED Sales #2140 composed helper contract: run --require-domain-contract on the reviewed composition; shared proof does not substitute for it.');
}
console.log(`PASS ${checks} PRE-1 shared integration checks; local structural ports, no authenticated or production claim.`);
