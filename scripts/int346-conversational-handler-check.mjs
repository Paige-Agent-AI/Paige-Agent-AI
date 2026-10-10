/** INT-346 conversational degraded mode — the normal BROWSER payload contract.
 * The ordinary Solo typed message carries `interactive:{kind:"message"}` (PR #1805 client).
 * While the version-2 interactive rollout is staged but NOT active (DRAINING), the server
 * must still accept it as a NON-EFFECTFUL conversation turn: no executor claim, no tool
 * exposure, no dispatch, no approval consumption — with a server-issued terminal receipt.
 * This is the regression guard for the 2026-10-10 outage: an ordinary typed message may
 * never again be answered with 503 INTERACTIVE_PROTOCOL_NOT_READY while DRAINING. */
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
})[k] ?? '' } };
let modelCalls = 0;
let emitToolUse = false;
let danglingStream = false;
let offeredToolCount = null;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('api.anthropic.com')) return new Response('{}', { status: 503 });
  const body = JSON.parse(opts.body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) {
    return Response.json({ content: [{ type: 'text', text: JSON.stringify({ intent: 'answer', research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: false, confidence: .9 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  modelCalls++;
  if (modelCalls === 1) offeredToolCount = Array.isArray(body.tools) ? body.tools.length : 0;
  if (danglingStream) {
    // A provider connection that dies mid-answer: bytes arrived, the turn never finished.
    return new Response('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial answ"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (!emitToolUse || modelCalls > 1) {
    return new Response('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Answered in words."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }
  // Adversarial variant: the model names a governed tool it was never offered.
  const events = [{ type: 'message_start', message: { usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-0', name: 'plan_create' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ title: 'Ghost plan', horizon: 'week' }) } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
const fake = await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('./knowledge-scope/stub-serve.mjs');
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
      if (a.p_operation === 'acquire') executorState.held = intent;
      if (a.p_operation === 'release' && executorState.held === intent) executorState.held = null;
      return { data: { latest: intent, executor: executorState.held, acquired: executorState.held === intent, terminal: receipts.length > 0, stopped: false }, error: null };
    },
    paige_chat_interactive_settle: (a) => { receipts.push({ role: 'assistant', content: a.p_content, bundle_ref: a.p_bundle_ref }); return { data: id(8), error: null }; },
    ...(extra.rpcs ?? {}),
  },
});

// 1 — Mixed/broken protocol metadata still fails closed for every kind (unchanged).
for (const protocol of [{ data: null, error: { code: 'PGRST202' } }, { data: { version: 1, active: true }, error: null }, { data: null, error: null }]) {
  scenario({ rpcs: { paige_chat_interactive_protocol: protocol } });
  const response = await capturedHandler()(req());
  assert.equal(response.status, 503, 'broken rollout metadata must stay a hard 503');
  assert.deepEqual(await response.json(), { code: 'INTERACTIVE_PROTOCOL_NOT_READY', message_accepted: false });
}

// 2 — THE OUTAGE REPRODUCTION, INVERTED: DRAINING + the ordinary browser payload must be
//     ACCEPTED as a conversational turn (this assertion FAILED before the hotfix: 503).
let rec = scenario();
const response = await capturedHandler()(req());
assert.notEqual(response.status, 503, 'an ordinary typed message must never 503 while DRAINING');
const wire = await response.text();
assert.ok(wire.includes('Answered in words.'), `the turn must stream a real answer\n${wire.slice(0, 800)}`);
assert.ok(wire.includes('"paige_mode":"conversational"'), 'the stream must announce conversational mode');
const begin = rec.rpc.filter((c) => c.name === 'paige_chat_interactive_begin_v2');
assert.equal(begin.length, 1);
assert.equal(begin[0].args.p_effectful, false, 'degraded admission must be recorded as non-effectful');
assert.equal(begin[0].client, 'jwt');
assert.equal(rec.rpc.filter((c) => c.name === 'paige_chat_interactive_executor_v2' && c.args.p_operation === 'acquire').length, 0,
  'a conversational turn must never acquire executor authority');
assert.equal(executorState.held, null, 'executor authority was never held at any point');
assert.equal(offeredToolCount, 0, 'the model must be offered ZERO tools');
assert.equal(rec.rpc.filter((c) => /plan_create|pipeline_|crm_|deal_|comms_|task_|web_search|deep_research/.test(c.name)).length, 0,
  'no governed tool may execute on a conversational turn');
const settled = rec.rpc.filter((c) => c.name === 'paige_chat_interactive_settle');
assert.equal(settled.length, 1, 'exactly one server-issued terminal receipt');
assert.equal(settled[0].client, 'service');
assert.equal(settled[0].args.p_thread, thread);
assert.equal(settled[0].args.p_intent, intent);
assert.equal(settled[0].args.p_actor, actor);
assert.equal(settled[0].args.p_tenant, tenant);
assert.equal(settled[0].args.p_bundle_ref.turn_state.state, 'FINAL');
assert.equal(settled[0].args.p_bundle_ref.interactive.request_intent_id, intent);
// The settlement's closing release is the harmless no-op RPC (nothing was ever held):
// exactly one, releasing nothing — and it cannot raise, because the receipt precedes it.
assert.equal(rec.rpc.filter((c) => c.name === 'paige_chat_interactive_executor_v2' && c.args.p_operation === 'release').length, 1);
assert.equal(rec.from.some((c) => c.table === 'paige_pending_confirmations'), false, 'no approval store touch');

// 2b — Same-thread follow-up: after the first conversational turn settled, a SECOND typed
//     message on the SAME thread (a NEW intent, same actor/tenant) is admitted again and
//     settles again — each turn independently non-effectful, the second never touching the
//     first turn's intent or claiming executor authority.
receipts.length = 0; executorState.held = null; modelCalls = 0;
const followUpIntent = id(9);
rec = scenario({ rpcs: {
  paige_chat_interactive_begin_v2: { data: { status: 'accepted', turn_id: id(6) }, error: null },
  paige_chat_interactive_executor_v2: () => ({ data: { latest: followUpIntent, executor: executorState.held, acquired: false, terminal: receipts.length > 0, stopped: false }, error: null }),
} });
const followUp = await capturedHandler()(req({}, followUpIntent));
assert.notEqual(followUp.status, 503, 'a same-thread follow-up must never 503 while DRAINING');
const followUpWire = await followUp.text();
assert.ok(followUpWire.includes('Answered in words.'), 'the follow-up must stream a real answer');
assert.ok(followUpWire.includes('"paige_mode":"conversational"'), 'the follow-up announces conversational mode again');
const followUpBegin = rec.rpc.filter((c) => c.name === 'paige_chat_interactive_begin_v2');
assert.equal(followUpBegin.length, 1);
assert.equal(followUpBegin[0].args.p_effectful, false, 'the follow-up admission is non-effectful');
assert.equal(followUpBegin[0].args.p_intent, followUpIntent, 'the follow-up is admitted under its own intent');
const followUpSettles = rec.rpc.filter((c) => c.name === 'paige_chat_interactive_settle');
assert.equal(followUpSettles.length, 1, 'the follow-up settles exactly once');
assert.equal(followUpSettles[0].args.p_intent, followUpIntent);
assert.equal(followUpSettles[0].args.p_bundle_ref.turn_state.state, 'FINAL');
assert.equal(rec.rpc.filter((c) => c.name === 'paige_chat_interactive_executor_v2' && c.args.p_operation === 'acquire').length, 0,
  'the follow-up never acquires executor authority');
assert.equal(offeredToolCount, 0, 'the follow-up model round is also offered ZERO tools');

// 3 — Replay of the same intent is idempotent (no duplicate user turn, no second settle).
rec = scenario({ rpcs: { paige_chat_interactive_begin_v2: { data: { status: 'duplicate' }, error: null } } });
const replay = await capturedHandler()(req());
assert.equal(replay.status, 409);
const replayBody = await replay.json();
assert.equal(replayBody.code, 'INTERACTIVE_DUPLICATE');
assert.equal(replayBody.message_accepted, true);
assert.equal(rec.rpc.some((c) => c.name === 'paige_chat_interactive_settle'), false, 'a replayed intent must not settle twice');

// 4 — Adversarial model round: a tool_use the turn never offered is REFUSED at dispatch,
//     never executed, and the turn still ends with one FINAL receipt.
modelCalls = 0; emitToolUse = true; receipts.length = 0;
rec = scenario();
const hostile = await capturedHandler()(req());
const hostileWire = await hostile.text();
assert.ok(hostileWire.includes('Answered in words.'), 'the refusal round still answers in words');
assert.equal(rec.rpc.filter((c) => c.name === 'plan_create').length, 0, 'an unoffered tool call must never dispatch');
assert.equal(rec.rpc.filter((c) => c.name === 'paige_chat_interactive_settle').length, 1);
emitToolUse = false;

// 5 — Approvals cannot be consumed while staged: the decision request is refused truthfully
//     BEFORE acceptance, with nothing consumed and no message accepted.
receipts.length = 0;
rec = scenario();
const decision = await capturedHandler()(req({ approvedConfirmations: ['a'.repeat(16)] }));
assert.equal(decision.status, 409);
const decisionBody = await decision.json();
assert.equal(decisionBody.code, 'INTERACTIVE_EFFECTS_UNAVAILABLE');
assert.equal(decisionBody.message_accepted, false);
assert.equal(rec.rpc.some((c) => c.name === 'paige_chat_interactive_begin_v2'), false, 'refused before acceptance');
assert.equal(rec.from.some((c) => c.table === 'paige_pending_confirmations'), false, 'no approval read or write');
assert.equal(rec.rpc.some((c) => c.name === 'paige_chat_interactive_settle'), false);

// 6 — Tenant scope still binds the degraded turn: a foreign thread never reaches acceptance.
rec = scenario({ tables: { paige_chat_threads: [] } });
const foreign = await capturedHandler()(req());
assert.equal(foreign.status, 500);
assert.equal(rec.rpc.some((c) => c.name === 'paige_chat_interactive_begin_v2'), false);

// 7 — Stop and status remain available while DRAINING (the client's recovery contract).
rec = scenario({ rpcs: { paige_chat_interactive_begin_v2: { data: { status: 'stopped' }, error: null } } });
const stopped = await capturedHandler()(req({ interactive: { kind: 'stop', supersedesIntentId: intent } }));
assert.equal(stopped.status, 200);
assert.equal((await stopped.json()).code, 'INTERACTIVE_STOPPED');
rec = scenario();
const status = await capturedHandler()(req({ interactive: { kind: 'status' } }));
assert.equal(status.status, 200);
assert.equal(status.headers.get('cache-control'), 'no-store');

// 8 — Interruption: a provider stream that dies mid-answer settles INTERRUPTED with the
//     partial content — truthful, no duplicate execution, still one server-issued receipt.
modelCalls = 0; danglingStream = true; receipts.length = 0;
rec = scenario();
const broken = await capturedHandler()(req());
await broken.text();
const brokenSettles = rec.rpc.filter((c) => c.name === 'paige_chat_interactive_settle');
assert.equal(brokenSettles.length, 1, 'an interrupted conversational turn still settles once');
assert.equal(brokenSettles[0].args.p_bundle_ref.turn_state.state, 'INTERRUPTED');
assert.ok(String(brokenSettles[0].args.p_content).includes('Partial answ'), 'the partial answer is preserved truthfully');
danglingStream = false;

console.log('PASS conversational degraded mode: browser payload accepted while DRAINING (no 503), no tools offered or dispatched, no executor claim, one server-issued FINAL receipt, approvals refused before acceptance, replay idempotent, scope bound, interruption truthful, stop/status unchanged');
