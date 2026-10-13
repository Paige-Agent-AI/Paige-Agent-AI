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
let routeIntent = 'answer';
let modelStopReason = 'end_turn';
let modelReply = 'Answered in words.';
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('api.anthropic.com')) return new Response('{}', { status: 503 });
  const body = JSON.parse(opts.body);
  if (body.system?.startsWith('You label one message sent to PAIGE')) {
    return Response.json({ content: [{ type: 'text', text: JSON.stringify({ intent: routeIntent, research: 'none', difficulty: 'routine', image: 'none', needs_workspace_data: routeIntent === 'act', confidence: .9 }) }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  modelCalls++;
  if (modelCalls === 1) offeredToolCount = Array.isArray(body.tools) ? body.tools.length : 0;
  if (danglingStream) {
    // A provider connection that dies mid-answer: bytes arrived, the turn never finished.
    return new Response('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial answ"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (!emitToolUse || modelCalls > 1) {
    return new Response('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Answered in words."}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'.replace('"stop_reason":"end_turn"', `"stop_reason":${JSON.stringify(modelStopReason)}`).replace('"text":"Answered in words."', `"text":${JSON.stringify(modelReply)}`), { headers: { 'Content-Type': 'text/event-stream' } });
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
      if (a.p_operation === 'acquire') executorState.held = a.p_intent;
      if (a.p_operation === 'release' && executorState.held === a.p_intent) executorState.held = null;
      return { data: { latest: a.p_intent, executor: executorState.held, acquired: executorState.held === a.p_intent, terminal: receipts.length > 0, stopped: false }, error: null };
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

// #2102 — exact ordinary customer failure: imperative task request, DRAINING,
// route fresh/act/operational, repeated prose with no admitted action tool.
// Before correction the real handler continued three times and authored LIMIT_REACHED.
receipts.length = 0; modelCalls = 0; routeIntent = 'act';
rec = scenario();
const taskRequest = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Create a task to follow up on that.' }] }, id(20)));
const taskWire = await taskRequest.text();
console.log('E2 task refusal terminal:', rec.rpc.find(c => c.name === 'paige_chat_interactive_settle')?.args.p_bundle_ref.turn_state.state);
assert.ok(taskWire.includes('Actions are unavailable in this conversation'), 'known unavailable actions must get the deterministic refusal');
assert.ok(taskWire.includes('No business action was run.'), 'refusal must state the no-effect outcome');
assert.ok(!taskWire.includes('LIMIT_REACHED'), 'known action unavailability is not continuation exhaustion');
assert.equal(modelCalls, 1, 'do not continue asking a read-only turn to carry out an unavailable act');
const taskSettles = rec.rpc.filter(c => c.name === 'paige_chat_interactive_settle');
assert.equal(taskSettles.length, 1);
assert.equal(taskSettles[0].args.p_bundle_ref.turn_state.state, 'FINAL');
assert.ok(taskSettles[0].args.p_content.includes('Actions are unavailable in this conversation'), 'persisted answer must match the refusal on the wire');
assert.equal(rec.rpc.filter(c => c.name === 'paige_chat_interactive_executor_v2' && c.args.p_operation === 'acquire').length, 0);
assert.equal(rec.rpc.filter(c => /plan_create|task_create|propose_action/.test(c.name)).length, 0);
// A hallucinated unoffered action call remains blocked and must not weaken refusal.
receipts.length = 0; modelCalls = 0; emitToolUse = true;
rec = scenario();
const unadmittedTask = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Create a task to follow up on that.' }] }, id(22)));
assert.ok((await unadmittedTask.text()).includes('Actions are unavailable in this conversation'), 'an unadmitted action call must also end with the truthful refusal');
assert.equal(rec.rpc.filter(c => c.name === 'plan_create').length, 0);
emitToolUse = false;
// A genuinely interrupted action response must stay interrupted, never be relabelled FINAL.
receipts.length = 0; modelCalls = 0; danglingStream = true;
rec = scenario();
const interruptedTask = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Create a task to follow up on that.' }] }, id(28)));
assert.ok(!(await interruptedTask.text()).includes('Actions are unavailable in this conversation'), 'do not replace an interrupted provider answer with a finished refusal');
assert.equal(rec.rpc.find(c => c.name === 'paige_chat_interactive_settle').args.p_bundle_ref.turn_state.state, 'INTERRUPTED');
danglingStream = false;
routeIntent = 'answer';

// Native max_tokens/refusal/unknown stops also map to stop in the existing
// Anthropic converter. None is evidence of normal completion; preserve that
// actual provider output and existing terminal semantics, never policy-rewrite it.
for (const stopReason of ['max_tokens', 'refusal', 'pause_turn', null]) {
  receipts.length = 0; modelCalls = 0; routeIntent = 'act'; modelStopReason = stopReason;
  rec = scenario();
  const limited = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Create a task to follow up on that.' }] }, id(30)));
  const limitedWire = await limited.text();
  assert.ok(!limitedWire.includes('Actions are unavailable in this conversation'), `${stopReason}: do not replace the actual provider termination`);
  assert.ok(limitedWire.includes('Answered in words.'), `${stopReason}: preserve actual provider text`);
  assert.equal(rec.rpc.find(c => c.name === 'paige_chat_interactive_settle').args.p_bundle_ref.turn_state.state,
    stopReason === 'max_tokens' ? 'LIMIT_REACHED' : stopReason === 'refusal' ? 'REFUSED' : 'INTERRUPTED', `${stopReason}: truthful non-success terminal`);
  assert.equal(rec.rpc.filter(c => c.name === 'plan_create').length, 0);
}
routeIntent = 'answer'; modelStopReason = 'end_turn';

// Advisory misclassification may never let a false business-completion claim out.
receipts.length = 0; modelCalls = 0; modelReply = 'Done. I’ve created the task.';
rec = scenario();
const falseDone = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Create a task to follow up on that.' }] }, id(31)));
const falseDoneWire = await falseDone.text();
assert.ok(!falseDoneWire.includes('I’ve created the task.'), 'a read-only turn cannot claim task creation even if the classifier says answer');
assert.ok(falseDoneWire.includes('Actions are unavailable in this conversation'));
assert.equal(modelCalls, 1);
assert.equal(rec.rpc.find(c => c.name === 'paige_chat_interactive_settle').args.p_bundle_ref.turn_state.state, 'FINAL');
receipts.length = 0; modelCalls = 0;
rec = scenario();
const politeAct = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Please create a task to follow up on that.' }] }, id(34)));
const politeActWire = await politeAct.text();
assert.ok(!politeActWire.includes('I’ve created the task.'), 'courtesy prefix must not defeat the no-effects task refusal');
assert.ok(politeActWire.includes('Actions are unavailable in this conversation'));
receipts.length = 0; modelCalls = 0; modelReply = 'Here is a draft you can copy: Thanks for meeting.';
rec = scenario();
const actualDraft = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Draft a follow-up message in words.' }] }, id(32)));
assert.ok((await actualDraft.text()).includes(modelReply), 'supported draft text is retained, not replaced by an act refusal');
receipts.length = 0; modelCalls = 0; modelReply = 'Here is a draft you can copy: I’ve created the report. Would you like any changes?';
rec = scenario();
const quotedDraft = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Draft a follow-up message in words.' }] }, id(33)));
assert.ok((await quotedDraft.text()).includes(modelReply), 'quoted actions in a supported draft must not erase the draft');
assert.equal(modelCalls, 1);
receipts.length = 0; modelCalls = 0;
rec = scenario();
const politeDraft = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Please draft a follow-up message in words.' }] }, id(35)));
assert.ok((await politeDraft.text()).includes(modelReply), 'courtesy prefix must preserve supported draft prose');
receipts.length = 0; modelCalls = 0; modelReply = 'Done. I’ve created the task.';
rec = scenario();
const unknownKind = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Could you take care of that?' }] }, id(36)));
assert.ok((await unknownKind.text()).includes('Nothing was sent, saved or changed in this reply.'), 'unknown request kind must retain the canonical no-action truth backstop');
modelReply = 'Answered in words.';

// Pure drafting remains an answer: the advisory action route, not a broad word
// such as "draft", distinguishes the blocked act from supported conversational prose.
receipts.length = 0; modelCalls = 0;
rec = scenario();
const prose = await capturedHandler()(req({ messages: [{ role: 'user', content: 'Draft a follow-up message in words.' }] }, id(21)));
assert.ok((await prose.text()).includes('Answered in words.'), 'non-effectful drafting remains available');

// Model the production SQL's begin append and the legacy append separately.
// No transcript de-duplication by text: two different intents may say the same words.
receipts.length = 0; modelCalls = 0;
const userRows = [], begunIntents = new Set();
rec = scenario({ rpcs: {
  paige_chat_interactive_begin_v2: a => {
    if (begunIntents.has(a.p_intent)) return { data: { status: 'duplicate' }, error: null };
    begunIntents.add(a.p_intent);
    if (!a.p_bound_answer) userRows.push({ content: a.p_content, intent: a.p_intent });
    return { data: { status: 'accepted', turn_id: id(23) }, error: null };
  },
  paige_chat_turn_append: a => {
    if (a.p_role === 'user') userRows.push({ content: a.p_content, intent: null });
    return { data: id(24), error: null };
  },
  paige_chat_interactive_executor_v2: () => ({ data: { latest: [...begunIntents].at(-1), executor: null, acquired: false, terminal: false, stopped: false }, error: null }),
} });
for (const n of [25, 26]) {
  const ordinary = await capturedHandler()(req({}, id(n)));
  await ordinary.text();
}
assert.equal(userRows.length, 2, 'two admitted intents must record exactly two user rows, not four');
assert.ok(userRows.every(r => r.intent !== null), 'canonical admission, not a second legacy append, owns conversational user persistence');
const duplicate = await capturedHandler()(req({}, id(26)));
assert.equal(duplicate.status, 409);
assert.equal(userRows.length, 2, 'replay must not append a user row');
danglingStream = true;
const cut = await capturedHandler()(req({}, id(27)));
await cut.text();
assert.equal(userRows.length, 3, 'interruption preserves only the one admitted user row');
assert.equal(rec.rpc.filter(c => c.name === 'paige_chat_turn_append' && c.args.p_role === 'user').length, 0);
danglingStream = false;

console.log('PASS conversational degraded mode: browser payload accepted while DRAINING (no 503), no tools offered or dispatched, no executor claim, one server-issued FINAL receipt, approvals refused before acceptance, replay idempotent, scope bound, interruption truthful, stop/status unchanged');
