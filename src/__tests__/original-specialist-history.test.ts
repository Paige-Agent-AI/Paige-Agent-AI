// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readOriginalSpecialistHistory } from '../../supabase/functions/_shared/paige-turn/interactive-specialist-history';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actorId: id(1), tenantId: id(2), threadId: id(3), intentId: id(4), turnId: id(5) };
const stamp = '2026-10-23T12:00:00.000001Z';
function fixture() {
  let active = true, authorized = true;
  const thread = { id: scope.threadId, tenant_id: scope.tenantId, caller_user_id: scope.actorId, audience: 'workspace', is_archived: false };
  const turn = { id: scope.turnId, thread_id: scope.threadId, role: 'assistant', created_at: stamp,
    interactive_intent_id: scope.intentId, interactive_actor_id: scope.actorId, interactive_tenant_id: scope.tenantId,
    interactive_terminal_state: 'INTERRUPTED', bundle_ref: { turn_state: { v: 1, state: 'INTERRUPTED' },
      interactive: { request_intent_id: scope.intentId, effects: [{ tool: 'delegate_to_subagent', outcome: 'outcome_unknown',
        record_refs: [{ kind: 'subagent_invocation', id: id(6) }] }] } } };
  const invocation = { id: id(6), specialist: 'zion', recorded_status: 'succeeded', created_at: '2026-10-23T11:59:59.999999Z',
    observed_at: '2026-10-23T12:01:00Z', receipt_state: 'verified', receipt_id: id(7), receipt_at: '2026-10-23T12:00:30Z',
    response_text: 'Original bounded specialist response', response_truncated: false, completion_scope: 'specialist_response_only' };
  const queries: Array<{ table: string; select: string; filters: Array<[string, unknown]> }> = [];
  const caller = { from(table: string) {
    if (!['paige_chat_threads', 'paige_chat_turns'].includes(table)) throw Error('No other record reader');
    const query = { table, select: '', filters: [] as Array<[string, unknown]> }; queries.push(query);
    const builder = { select(value: string) { query.select = value; return builder; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      async maybeSingle() { return { data: structuredClone(table === 'paige_chat_threads' ? thread : turn), error: null }; } };
    return builder;
  } };
  const authorize = vi.fn(async () => authorized);
  const inspectOriginal = vi.fn(async (_invocationId: string): Promise<unknown> => ({ ok: true, matches: [], invocation: structuredClone(invocation), input: 'DO_NOT_PUBLISH' }));
  const input = { ...scope, caller, authorize, inspectOriginal, current: () => active };
  return { input, thread, turn, invocation, queries, authorize, inspectOriginal,
    withdraw: () => { active = false; }, revoke: () => { authorized = false; } };
}

describe('original specialist history through server-stamped turn authority', () => {
  it('reads the original assignment and receipt only; rechecks source without granting continuation', async () => {
    const f = fixture(), r = await readOriginalSpecialistHistory(f.input);
    expect(r).toMatchObject({ v: 1, status: 'recorded_assignment', thread_id: scope.threadId, turn_id: scope.turnId,
      origin_intent_id: scope.intentId, tenant_id: scope.tenantId, read_only: true, new_effect_possible: false,
      results: [{ ...f.invocation }], limited: false });
    expect(f.inspectOriginal).toHaveBeenCalledExactlyOnceWith(id(6));
    expect(f.queries.filter(q => q.table === 'paige_chat_threads')).toHaveLength(2);
    expect(f.queries.filter(q => q.table === 'paige_chat_turns')).toHaveLength(2);
    for (const q of f.queries.filter(q => q.table === 'paige_chat_turns')) {
      expect(q.filters).toEqual([['id', scope.turnId], ['thread_id', scope.threadId], ['interactive_intent_id', scope.intentId]]);
      expect(q.select).toContain('interactive_actor_id'); expect(q.select).not.toContain('content');
    }
    expect(JSON.stringify(r)).not.toContain('DO_NOT_PUBLISH');
  });
  it.each(['id', 'thread_id', 'interactive_intent_id', 'interactive_actor_id', 'interactive_tenant_id'] as const)('refuses a foreign native %s before inspecting', async key => {
    const f = fixture(); f.turn[key] = id(99);
    expect(await readOriginalSpecialistHistory(f.input)).toEqual({ v: 1, status: 'unavailable' }); expect(f.inspectOriginal).not.toHaveBeenCalled();
  });
  it.each(['tenant_id', 'caller_user_id'] as const)('refuses a foreign thread %s', async key => {
    const f = fixture(); f.thread[key] = id(99);
    expect(await readOriginalSpecialistHistory(f.input)).toHaveProperty('status', 'unavailable'); expect(f.inspectOriginal).not.toHaveBeenCalled();
  });
  it.each(['legacy', 'customer', 'archived', 'wrong_tool', 'malformed_reference', 'withheld', 'no_authority'] as const)('refuses %s origin evidence', async kind => {
    const f = fixture();
    if (kind === 'legacy') f.turn.interactive_actor_id = '';
    if (kind === 'customer') f.thread.audience = 'customer_private';
    if (kind === 'archived') f.thread.is_archived = true;
    if (kind === 'wrong_tool') f.turn.bundle_ref.interactive.effects[0].tool = 'list_subagents';
    if (kind === 'malformed_reference') f.turn.bundle_ref.interactive.effects[0].record_refs[0].id = 'not-an-identity';
    if (kind === 'withheld') f.turn.interactive_terminal_state = f.turn.bundle_ref.turn_state.state = 'WITHHELD';
    if (kind === 'no_authority') f.revoke();
    expect(await readOriginalSpecialistHistory(f.input)).toHaveProperty('status', 'unavailable'); expect(f.inspectOriginal).not.toHaveBeenCalled();
  });
  it.each(['wrong_id', 'future_origin', 'contradictory_receipt', 'unbounded_response', 'false_domain_claim'] as const)('refuses %s returned proof', async kind => {
    const f = fixture();
    if (kind === 'wrong_id') f.invocation.id = id(90);
    if (kind === 'future_origin') f.invocation.created_at = '2026-10-23T12:00:00.000002Z';
    if (kind === 'contradictory_receipt') f.invocation.recorded_status = 'pending';
    if (kind === 'unbounded_response') f.invocation.response_text = 'x'.repeat(8001);
    if (kind === 'false_domain_claim') f.invocation.completion_scope = 'business_action';
    expect(await readOriginalSpecialistHistory(f.input)).toHaveProperty('status', 'unavailable');
  });
  it.each(['pending', 'dispatched', 'unknown'])('retains %s without inferring completion or retry permission', async status => {
    const f = fixture(); Object.assign(f.invocation, { recorded_status: status, receipt_state: 'missing', receipt_id: null, receipt_at: null, response_text: null });
    expect(await readOriginalSpecialistHistory(f.input)).toMatchObject({ status: 'recorded_assignment', new_effect_possible: false,
      results: [{ recorded_status: status, receipt_state: 'missing', response_text: null }] });
  });
  it.each(['abort', 'revoke', 'changed_origin', 'lost_response'] as const)('does not publish after %s', async kind => {
    const f = fixture(), original = f.inspectOriginal.getMockImplementation()!;
    f.inspectOriginal.mockImplementation(async invocationId => {
      if (kind === 'lost_response') throw Error('unknown transport');
      const r = await original(invocationId);
      if (kind === 'abort') f.withdraw(); if (kind === 'revoke') f.revoke();
      if (kind === 'changed_origin') f.turn.bundle_ref.interactive.effects[0].record_refs[0].id = id(99);
      return r;
    });
    expect(await readOriginalSpecialistHistory(f.input)).toHaveProperty('status', 'unavailable');
  });
  it('deduplicates original references and bounds inspection to three', async () => {
    const f = fixture(); f.turn.bundle_ref.interactive.effects[0].record_refs = [6, 6, 8, 9, 10].map(n => ({ kind: 'subagent_invocation', id: id(n) }));
    f.inspectOriginal.mockImplementation(async originalId => ({ ok: true, invocation: { ...f.invocation, id: originalId } }));
    expect(await readOriginalSpecialistHistory(f.input)).toMatchObject({ status: 'recorded_assignment', limited: true });
    expect(f.inspectOriginal.mock.calls.map(a => a[0])).toEqual([id(6), id(8), id(9)]);
  });
});
