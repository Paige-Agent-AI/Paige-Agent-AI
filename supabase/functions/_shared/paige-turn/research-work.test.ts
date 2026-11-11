import { assertEquals } from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import { originalResearchPayload, originalResearchResumeRequest, readAcceptedResearchTurn, resumeOriginalResearch,
  type ResearchCaller, type ResearchWorkBinding } from './research-work.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding: ResearchWorkBinding = { threadId: id(1), intentId: id(2), workId: id(3), actorId: id(6), tenantId: id(7) };
const original = () => ({ id: id(8), role: 'assistant', content: 'The original research job was accepted.',
  interactive_actor_id: binding.actorId, interactive_tenant_id: binding.tenantId,
  interactive_intent_id: binding.intentId, interactive_terminal_state: 'WAIT_WORK', bundle_ref: {
    turn_state: { v: 1, state: 'WAIT_WORK' }, interactive: { request_intent_id: binding.intentId,
      effects: [{ tool: 'deep_research', outcome: 'durable_accepted', work_id: binding.workId }] } } });
function fixture() {
  const state = { actor: binding.actorId, tenant: binding.tenantId, active: true,
    row: original() as unknown, afterRead: () => {}, calls: [] as unknown[], filters: [] as unknown[] };
  const query = { eq: (key: string, value: string) => { state.filters.push([key, value]); return query; },
    maybeSingle: async () => { state.afterRead(); return { data: state.row, error: null }; } };
  const caller: ResearchCaller = {
    auth: { getUser: async () => ({ data: { user: { id: state.actor } }, error: null }) },
    rpc: async name => { state.calls.push(name); return { data: state.tenant, error: null }; },
    from: name => { state.calls.push(name); return { select: () => query }; },
  };
  return { state, caller, current: () => state.active };
}

Deno.test('Research payload pins the original raw objective and supported fields without widening sources', () => {
  assertEquals(originalResearchPayload({ question: '  Original question  ', domain: 'general', max_hops: 2 }),
    { version: 1, question: '  Original question  ', caller: 'chat', domain: 'general', max_hops: 2 });
  for (const change of [{ question: '  ' }, { max_hops: 0 }, { max_hops: 1.5 }, { domain: null },
    { allowed_domains: ['example.com'] }, { max_sources: 3 }, { freshness_days: 7 }, { question: 'a'.repeat(6001) }]) {
    assertEquals(originalResearchPayload({ question: 'Original question', ...change }), null);
  }
});

Deno.test('Research resume rejects mixed controls, new questions, identities and approval authority', () => {
  const raw = { threadId: binding.threadId, requestIntentId: binding.intentId, researchResume: { workId: binding.workId },
    interactive: { kind: 'message' }, messages: [{ role: 'user', content: 'Resume original research' }] };
  assertEquals(originalResearchResumeRequest(raw), true);
  for (const change of [{ interactive: undefined }, { interactive: { kind: 'status' } },
    { interactive: { kind: 'message', workId: binding.workId } }, { approvedConfirmations: ['approval'] },
    { surfaceContext: { kind: 'customer_portal' } }, { user_id: binding.actorId },
    { researchResume: { workId: binding.workId, question: 'Another question' } },
    { messages: [{ role: 'user', content: 'New research question' }] },
    { messages: [{ role: 'assistant', content: 'Resume original research' }] },
    { requestIntentId: 'invented' }]) assertEquals(originalResearchResumeRequest({ ...raw, ...change }), false);
});

Deno.test('Research receipt preservation returns the actual issued turn rather than another settlement', async () => {
  const f = fixture();
  assertEquals(await readAcceptedResearchTurn(binding, f.caller, f.current),
    { id: id(8), content: original().content, bundle: original().bundle_ref });
  assertEquals(f.state.filters, [['thread_id', binding.threadId], ['interactive_intent_id', binding.intentId],
    ['interactive_actor_id', binding.actorId], ['interactive_tenant_id', binding.tenantId], ['interactive_terminal_state', 'WAIT_WORK']]);
  assertEquals(f.state.calls.every(v => v === 'current_user_tenant_id' || v === 'paige_chat_turns'), true);
});

for (const [label, change] of Object.entries({ actor: { interactive_actor_id: id(9) },
  tenant: { interactive_tenant_id: id(9) }, intent: { interactive_intent_id: id(9) },
  user_turn: { role: 'user' }, final: { interactive_terminal_state: 'FINAL' },
  unprotected: { interactive_intent_id: null }, malformed: { bundle_ref: {} },
  forged_work: { bundle_ref: { ...original().bundle_ref, interactive: { request_intent_id: binding.intentId,
    effects: [{ tool: 'deep_research', outcome: 'durable_accepted', work_id: id(9) }] } } },
  duplicate: { bundle_ref: { ...original().bundle_ref, interactive: { request_intent_id: binding.intentId,
    effects: [...original().bundle_ref.interactive.effects, ...original().bundle_ref.interactive.effects] } } },
})) Deno.test(`Research original receipt refuses ${label}`, async () => {
  const f = fixture(); f.state.row = { ...original(), ...change };
  let invokes = 0;
  assertEquals(await resumeOriginalResearch(binding, { ...f, invoke: async () => { invokes++; return { ok: true }; } }), 'unavailable');
  assertEquals(invokes, 0);
});

for (const changed of ['actor', 'tenant', 'lifetime']) Deno.test(`Research refuses ${changed} changed during receipt read`, async () => {
  const f = fixture(); f.state.afterRead = () => {
    if (changed === 'actor') f.state.actor = id(9);
    else if (changed === 'tenant') f.state.tenant = id(9);
    else f.state.active = false;
  };
  let invokes = 0;
  assertEquals(await resumeOriginalResearch(binding, { ...f, invoke: async () => { invokes++; return { ok: true }; } }), 'unavailable');
  assertEquals(invokes, 0);
});

Deno.test('Research resume uses only the same original identity and resume_only, never a new question', async () => {
  const f = fixture(); const bodies: unknown[] = [];
  assertEquals(await resumeOriginalResearch(binding, { ...f, invoke: async body => { bodies.push(body); return { ok: true }; } }), 'inspect_original');
  assertEquals(bodies, [{ user_id: binding.actorId, expected_tenant_id: binding.tenantId, caller: 'chat', persist: true,
    durable_work: { work_id: binding.workId, thread_id: binding.threadId, intent_id: binding.intentId, resume_only: true } }]);
});

Deno.test('Research UNKNOWN resume response permits inspection only and never a second invoke', async () => {
  const f = fixture(); let invokes = 0;
  assertEquals(await resumeOriginalResearch(binding, { ...f, invoke: () => { invokes++; throw new Error('lost response'); } }), 'inspect_original');
  assertEquals(invokes, 1);
});

Deno.test('Research changed workspace after resume withholds its result without replay', async () => {
  const f = fixture(); let invokes = 0;
  assertEquals(await resumeOriginalResearch(binding, { ...f, invoke: async () => {
    invokes++; f.state.tenant = id(9); return { ok: true };
  } }), 'unavailable');
  assertEquals(invokes, 1);
});
