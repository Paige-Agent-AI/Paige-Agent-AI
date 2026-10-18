import { describe, expect, it } from 'vitest';
import { confirmFingerprint } from '../../supabase/functions/_shared/confirm-fingerprint';
import { DURABLE_JOB_STATES } from '../../supabase/functions/_shared/durable-job/mod';
import { readOriginalReminderApprovalHistory } from '../../supabase/functions/_shared/paige-turn/interactive-reminder-history';

// Real reader -> real observer -> real native response parsers. These recording
// ports do not establish JWT/RLS/native effect authority, admission or customer QA.
const id = (n: number) => `a2342000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actorId: id(1), tenantId: id(2), threadId: id(3), intentId: id(4), turnId: id(5) };
const proposalId = id(6), nonce = id(7), workId = id(8), itemId = id(9), railId = id(10);
const resolveName = 'resolve_paige_reminder_approval', historyName = 'execute_paige_approved_reminder';
const args = { title: 'Review the original service handoff', remind_at: '2030-01-02T10:00:00.123456Z', summary: null };
const clone = <T,>(value: T): T => structuredClone(value);
type Reply = { data: unknown; error: unknown };
type Query = { port: 'caller' | 'service'; table: string; index: number; methods: Array<[string, ...unknown[]]> };
type Event = { kind: 'query'; query: Query } | { kind: 'rpc'; name: string; args: Record<string, unknown> };
type ReaderInput = Parameters<typeof readOriginalReminderApprovalHistory>[0];
const resolution = (status = 'succeeded') => ({ v: 1, proposal_id: proposalId, work_id: workId, work_status: status });
const history = () => ({ v: 1, status: 'succeeded', receipt_version: 1, work_id: workId, proposal_id: proposalId,
  historical: true, replayed: true,
  original_result: { ok: true, item_id: itemId, item_type: 'reminder', remind_at: args.remind_at,
    railRecorded: true, receipt_status: 'recorded', receipt_run_id: railId },
  original_readback: { item_id: itemId, item_type: 'reminder', title: args.title, summary: null,
    tenant_id: scope.tenantId, created_by: scope.actorId, remind_at: '2030-01-02T10:00:00.123456+00:00',
    remind_target: 'user', remind_channel: 'in_app', assigned_to_user_id: scope.actorId,
    plan_id: null, contact_id: null, source_version: '2026-10-18T00:01:00.765432+00:00' } });

async function fixture() {
  const intent = await confirmFingerprint('plan_set_reminder', args);
  const fingerprint = await confirmFingerprint('plan_set_reminder', {
    intent, tenant: scope.tenantId, thread: scope.threadId, client: null,
  });
  const token = `${fingerprint}:${nonce}`;
  const f = {
    thread: { id: scope.threadId, tenant_id: scope.tenantId, caller_user_id: scope.actorId,
      audience: 'workspace', is_archived: false, interactive_latest_intent: id(90),
      interactive_executor_intent: id(91), interactive_recovery_hold: id(92) },
    turn: { id: scope.turnId, thread_id: scope.threadId, role: 'assistant',
      created_at: '2026-10-18T00:00:00.123456Z', interactive_intent_id: scope.intentId,
      interactive_actor_id: scope.actorId, interactive_tenant_id: scope.tenantId,
      interactive_terminal_state: 'WAIT_APPROVAL', bundle_ref: {
        turn_state: { v: 1, state: 'WAIT_APPROVAL' },
        interactive: { request_intent_id: scope.intentId, effects: [{ tool: 'plan_set_reminder', outcome: 'approval_required' }] },
        paige_confirm: [{ tool: 'plan_set_reminder', summary: 'Original reminder proposal', fingerprint: token }],
      } },
    rows: [{ id: proposalId, user_id: scope.actorId, tenant_id: scope.tenantId, thread_id: scope.threadId,
      scoped_client_id: null, tool_name: 'plan_set_reminder', args: clone(args), fingerprint, issued_in_request: nonce,
      server_issued_at: '2026-10-18T00:00:00.100000Z', created_at: '2026-10-18T00:00:00.100000Z',
      expires_at: '2026-10-18T00:10:00Z', consumed_at: '2026-10-18T00:02:00Z' }],
    queries: [] as Query[], calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    events: [] as Event[], current: true, currentCalls: 0,
    onQuery: undefined as undefined | ((q: Query) => Reply | undefined | Promise<Reply | undefined>),
    onRpc: undefined as undefined | ((name: string, callArgs: Record<string, unknown>) => Reply | undefined | Promise<Reply | undefined>),
  };
  const builder = (port: Query['port'], table: string) => {
    const q: Query = { port, table, index: f.queries.filter(p => p.port === port && p.table === table).length + 1, methods: [] };
    f.queries.push(q);
    const run = async (): Promise<Reply> => {
      f.events.push({ kind: 'query', query: clone(q) });
      const override = await f.onQuery?.(q);
      if (override) return override;
      if (port === 'caller' && table === 'paige_chat_threads') return { data: clone(f.thread), error: null };
      if (port === 'caller' && table === 'paige_chat_turns') return { data: clone(f.turn), error: null };
      if (port === 'service' && table === 'paige_pending_confirmations') return { data: clone(f.rows), error: null };
      throw new Error(`Unexpected table/port: ${port}/${table}`);
    };
    const chain = {
      select(...a: unknown[]) { q.methods.push(['select', ...a]); return chain; },
      eq(...a: unknown[]) { q.methods.push(['eq', ...a]); return chain; },
      is(...a: unknown[]) { q.methods.push(['is', ...a]); return chain; },
      not(...a: unknown[]) { q.methods.push(['not', ...a]); return chain; },
      gt(...a: unknown[]) { q.methods.push(['gt', ...a]); return chain; },
      limit(...a: unknown[]) { q.methods.push(['limit', ...a]); return chain; },
      maybeSingle() { q.methods.push(['maybeSingle']); return run(); },
      then<TResult1 = Reply, TResult2 = never>(a?: ((r: Reply) => TResult1 | PromiseLike<TResult1>) | null,
        b?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return run().then(a, b); },
    };
    return chain;
  };
  const caller = {
    from: (table: string) => builder('caller', table),
    rpc: async (name: string, callArgs: Record<string, unknown> = {}): Promise<Reply> => {
      f.calls.push({ name, args: clone(callArgs) }); f.events.push({ kind: 'rpc', name, args: clone(callArgs) });
      const override = await f.onRpc?.(name, callArgs);
      if (override) return override;
      if (name === resolveName) return { data: resolution(), error: null };
      if (name === historyName) return { data: history(), error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const service = { from: (table: string) => builder('service', table),
    rpc: async (name: string) => { throw new Error(`No service RPC allowed: ${name}`); } };
  const input: ReaderInput = { ...scope, caller, service, current: () => { f.currentCalls += 1; return f.current; } };
  return Object.assign(f, { input, fingerprint, token });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const run = (f: Fixture) => readOriginalReminderApprovalHistory(f.input);
function noEffects(f: Fixture) {
  expect(f.calls.every(c => c.name === resolveName || c.name === historyName)).toBe(true);
  expect(f.calls.every(c => c.name !== historyName || c.args.p_intent === null && c.args.p_runtime_request_nonce === null)).toBe(true);
  expect(f.queries.every(q => q.port === 'caller' && ['paige_chat_threads', 'paige_chat_turns'].includes(q.table)
    || q.port === 'service' && q.table === 'paige_pending_confirmations')).toBe(true);
  expect(f.queries.every(q => q.methods.every(([name]) => ['select', 'eq', 'is', 'not', 'gt', 'limit', 'maybeSingle'].includes(name)))).toBe(true);
}
function unavailable(result: Awaited<ReturnType<typeof run>>, f: Fixture) {
  expect(result).toEqual({ v: 1, status: 'unavailable' }); noEffects(f);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE');
}
const change = (obj: unknown, key: string, value: unknown) => Object.assign(obj as object, { [key]: value });

describe('canonical original Reminder history reader with actual observer/adapters', () => {
  it('reads the unique consumed proposal, real scoped hash and strict original evidence without current-intent/effect authority', async () => {
    const f = await fixture(), before = clone({ thread: f.thread, turn: f.turn, rows: f.rows });
    const result = await run(f);
    expect(result).toEqual({ v: 1, status: 'verified_original', thread_id: scope.threadId, turn_id: scope.turnId,
      origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, replayed: true, new_effect_possible: false,
      confirmations_restored: false, results: [{ tool: 'plan_set_reminder', receipt_version: 1,
        original: { item_id: itemId, title: args.title, remind_at: history().original_readback.remind_at,
          source_version: history().original_readback.source_version, receipt_run_id: railId } }] });
    expect(JSON.stringify(result)).not.toContain(f.token);
    for (const field of ['confirmations', 'fingerprint', 'args', 'idempotency_key', 'currentReadback'])
      expect(result).not.toHaveProperty(field);
    expect(f.calls).toEqual([
      { name: resolveName, args: { p_proposal_id: proposalId, p_expected_tenant: scope.tenantId,
        p_expected_thread: scope.threadId, p_expected_client: null } },
      { name: historyName, args: { p_work_id: workId, p_expected_tenant: scope.tenantId,
        p_expected_thread: scope.threadId, p_expected_client: null, p_intent: null, p_runtime_request_nonce: null } },
    ]);
    expect(f.events.map(e => e.kind === 'query' ? `${e.query.port}:${e.query.table}` : e.name)).toEqual([
      'caller:paige_chat_threads', 'caller:paige_chat_turns', 'service:paige_pending_confirmations', resolveName, historyName,
      'caller:paige_chat_threads', 'caller:paige_chat_turns',
    ]);
    const query = f.queries.find(q => q.table === 'paige_pending_confirmations')!;
    expect(query.methods).toEqual(expect.arrayContaining([
      ['eq', 'user_id', scope.actorId], ['eq', 'tenant_id', scope.tenantId], ['eq', 'thread_id', scope.threadId],
      ['is', 'scoped_client_id', null], ['eq', 'tool_name', 'plan_set_reminder'], ['eq', 'fingerprint', f.fingerprint],
      ['eq', 'issued_in_request', nonce], ['not', 'server_issued_at', 'is', null], ['not', 'consumed_at', 'is', null], ['limit', 2],
    ]));
    expect({ thread: f.thread, turn: f.turn, rows: f.rows }).toEqual(before); noEffects(f);
  });

  it('repeated reads return original snapshots without reading current plan_items or creating another effect/receipt', async () => {
    const f = await fixture();
    const first = await run(f), second = await run(f);
    expect(first).toEqual(second); expect(first.status).toBe('verified_original');
    expect(f.calls.map(c => c.name)).toEqual([resolveName, historyName, resolveName, historyName]); noEffects(f);
    expect(JSON.stringify(first)).not.toContain('currentReadback');
  });

  it.each(['actorId', 'tenantId', 'threadId', 'intentId', 'turnId'] as const)('rejects malformed input %s before reads', async field => {
    const f = await fixture(); change(f.input, field, 'not-a-uuid'); unavailable(await run(f), f);
    expect(f.queries).toHaveLength(0); expect(f.calls).toHaveLength(0);
  });

  it.each(['caller_user_id', 'tenant_id', 'id', 'audience', 'is_archived'])(
    'refuses wrong/archived original thread %s', async field => {
      const f = await fixture(); change(f.thread, field, field === 'audience' ? 'customer_private' : field === 'is_archived' ? true : id(70));
      unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
    });

  it.each(['id', 'thread_id', 'role', 'interactive_intent_id', 'interactive_actor_id', 'interactive_tenant_id',
    'interactive_terminal_state', 'created_at'])( 'refuses wrong/malformed canonical turn %s', async field => {
    const f = await fixture(); change(f.turn, field, field === 'role' ? 'user' : field === 'interactive_terminal_state' ? 'FINAL'
      : field === 'created_at' ? 'invalid' : id(71)); unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
  });

  const malformedCards: Array<[string, (f: Fixture) => void]> = [
    ['missing bundle', f => change(f.turn, 'bundle_ref', null)],
    ['wrong WAIT version', f => change(f.turn.bundle_ref.turn_state, 'v', 2)],
    ['wrong bundle terminal', f => change(f.turn.bundle_ref.turn_state, 'state', 'FINAL')],
    ['wrong origin intent', f => change(f.turn.bundle_ref.interactive, 'request_intent_id', id(72))],
    ['missing effects', f => change(f.turn.bundle_ref.interactive, 'effects', null)],
    ['no matching approval effect', f => change(f.turn.bundle_ref.interactive, 'effects', [{ tool: 'plan_set_reminder', outcome: 'reported_success' }])],
    ['too many effects', f => change(f.turn.bundle_ref.interactive, 'effects', Array.from({ length: 21 }, () => ({ tool: 'plan_set_reminder', outcome: 'approval_required' })))],
    ['empty cards', f => { f.turn.bundle_ref.paige_confirm = []; }],
    ['too many cards', f => { f.turn.bundle_ref.paige_confirm = Array.from({ length: 11 }, () => clone(f.turn.bundle_ref.paige_confirm[0])); }],
    ['wrong tool only', f => { f.turn.bundle_ref.paige_confirm[0].tool = 'crm_create_task'; }],
    ['bare hash without issued nonce', f => { f.turn.bundle_ref.paige_confirm[0].fingerprint = f.fingerprint; }],
    ['malformed nonce', f => { f.turn.bundle_ref.paige_confirm[0].fingerprint = `${f.fingerprint}:wrong`; }],
    ['malformed hash', f => { f.turn.bundle_ref.paige_confirm[0].fingerprint = `not-a-hash:${nonce}`; }],
    ['duplicate original card', f => { f.turn.bundle_ref.paige_confirm.push(clone(f.turn.bundle_ref.paige_confirm[0])); }],
  ];
  it.each(malformedCards)('refuses %s without inferring a new approval', async (_label, alter) => {
    const f = await fixture(); alter(f); unavailable(await run(f), f);
  });

  it.each(['id', 'user_id', 'tenant_id', 'thread_id', 'scoped_client_id', 'tool_name', 'fingerprint', 'issued_in_request', 'args'])(
    'refuses mismatched original proposal %s', async field => {
      const f = await fixture(); change(f.rows[0], field, field === 'args' ? null : field === 'id' ? 'invalid'
        : field === 'tool_name' ? 'crm_create_task' : id(73));
      unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
    });

  it('passes a different valid selected proposal ID to native and refuses its mismatching canonical reply', async () => {
    const f = await fixture(); f.rows[0].id = id(73);
    unavailable(await run(f), f);
    expect(f.calls).toEqual([{ name: resolveName, args: { p_proposal_id: id(73), p_expected_tenant: scope.tenantId,
      p_expected_thread: scope.threadId, p_expected_client: null } }]);
  });

  it('rejects a plausible scoped token if the actual stored argument hash differs', async () => {
    const f = await fixture(); f.rows[0].args.title = 'Different original intent'; unavailable(await run(f), f);
    expect(f.calls).toHaveLength(0);
  });

  it.each(['empty', 'ambiguous', 'not_array'] as const)('refuses %s proposal lookup', async mode => {
    const f = await fixture(); f.onQuery = q => q.table === 'paige_pending_confirmations'
      ? { data: mode === 'empty' ? [] : mode === 'ambiguous' ? [f.rows[0], clone(f.rows[0])] : f.rows[0], error: null } : undefined;
    unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
  });

  it.each(['live', 'expired_unconsumed'] as const)('never observes %s as a used original effect', async state => {
    const f = await fixture();
    change(f.rows[0], 'consumed_at', null);
    f.rows[0].expires_at = state === 'live' ? '2099-01-01T00:00:00Z' : '2000-01-01T00:00:00Z';
    unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
  });

  it('verifies sealed consumption one microsecond before expiry without using the action-resume classifier', async () => {
    const f = await fixture();
    f.rows[0].expires_at = '2026-10-18T00:10:00.123456Z';
    f.rows[0].consumed_at = '2026-10-18T00:10:00.123455Z';
    expect(Date.parse(f.rows[0].consumed_at)).toBe(Date.parse(f.rows[0].expires_at));
    const result = await run(f);
    expect(result).toMatchObject({ status: 'verified_original', historical: true, replayed: true,
      new_effect_possible: false, confirmations_restored: false });
    expect(f.calls.map(c => c.name)).toEqual([resolveName, historyName]); noEffects(f);
  });

  it('verifies sealed original history long after the proposal expired on the current clock', async () => {
    const f = await fixture();
    f.turn.created_at = '2000-01-01T00:00:00.123456Z';
    f.rows[0].created_at = f.rows[0].server_issued_at = '1999-12-31T23:59:00Z';
    f.rows[0].consumed_at = '2000-01-01T00:02:00Z'; f.rows[0].expires_at = '2000-01-01T00:10:00Z';
    expect(Date.parse(f.rows[0].expires_at)).toBeLessThan(Date.now());
    expect(await run(f)).toMatchObject({ status: 'verified_original', historical: true,
      new_effect_possible: false, confirmations_restored: false });
    expect(f.calls.map(c => c.name)).toEqual([resolveName, historyName]); noEffects(f);
  });

  it('an expiry-sweep consumption without matching sealed work is refused by native resolution, never guessed from expiry', async () => {
    const f = await fixture(); f.rows[0].consumed_at = '2026-10-18T00:11:00Z';
    f.onRpc = name => name === resolveName ? { data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_NO_SEALED_WORK' } } : undefined;
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
  });

  it.each([null, undefined, '', 'invalid', 'infinity', '2026-10-18T00:02:00.1234567Z'])(
    'refuses non-finite or malformed consumption %s before native RPC', async consumed => {
      const f = await fixture(); change(f.rows[0], 'consumed_at', consumed);
      unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
    });

  it.each(['server_issued_at', 'created_at'] as const)('refuses future or invalid proposal %s including microsecond ordering', async field => {
    for (const value of ['2026-10-18T00:00:01Z', 'invalid', '2026-10-18T00:00:00.123457Z']) {
      const f = await fixture(); f.rows[0][field] = value;
      expect(await run(f), value).toEqual({ v: 1, status: 'unavailable' }); expect(f.calls, value).toHaveLength(0); noEffects(f);
    }
  });

  it.each(DURABLE_JOB_STATES.filter(s => s !== 'succeeded'))('observes %s without attempting history/adoption/normalization', async state => {
    const f = await fixture(); f.onRpc = name => name === resolveName ? { data: resolution(state), error: null } : undefined;
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
  });

  it.each(['missing', 'unknown_state', 'wrong_work_id', 'extra_authority'] as const)(
    'refuses malformed resolver proof %s before the history RPC', async problem => {
      const f = await fixture(); f.onRpc = name => {
        if (name !== resolveName) return undefined;
        const data: Record<string, unknown> = resolution();
        if (problem === 'unknown_state') data.work_status = 'ready';
        if (problem === 'wrong_work_id') data.work_id = 'invalid';
        if (problem === 'extra_authority') data.server_key = 'PRIVATE_NATIVE_KEY';
        return { data: problem === 'missing' ? null : data, error: null };
      };
      unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
    });

  it('a declined/consumed proposal with no native sealed work stays unavailable', async () => {
    const f = await fixture(); f.onRpc = () => ({ data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_NO_WORK' } });
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
  });

  const badProofs: Array<[string, (r: ReturnType<typeof history>) => void]> = [
    ['fresh flags', r => { r.historical = false; r.replayed = false; }],
    ['mixed flags', r => { r.replayed = false; }],
    ['wrong proposal', r => { r.proposal_id = id(74); }], ['wrong work', r => { r.work_id = id(74); }],
    ['wrong receipt version', r => { r.receipt_version = 2; }],
    ['missing Rail', r => { r.original_result.railRecorded = false; }],
    ['unrecorded receipt', r => { r.original_result.receipt_status = 'unknown'; }],
    ['different original record', r => { r.original_readback.item_id = id(75); }],
    ['wrong native actor', r => { r.original_readback.created_by = id(75); }],
    ['wrong native tenant', r => { r.original_readback.tenant_id = id(75); }],
    ['wrong date microseconds', r => { r.original_readback.remind_at = '2030-01-02T10:00:00.123457Z'; }],
    ['raw extra authority', r => { change(r, 'server_key', 'PRIVATE_NATIVE_KEY'); }],
  ];
  it.each(badProofs)('does not publish %s', async (_label, alter) => {
    const f = await fixture(); f.onRpc = name => { if (name !== historyName) return undefined;
      const r = history(); alter(r); return { data: r, error: null }; };
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName, historyName]);
  });

  it.each([resolveName, historyName])('lost acknowledgement/answered failure at %s never becomes a success or retry', async name => {
    for (const thrown of [false, true]) {
      const f = await fixture(); f.onRpc = n => { if (n !== name) return undefined;
        if (thrown) throw new TypeError('PRIVATE_NATIVE_FETCH');
        return { data: null, error: { code: '57014', message: 'PRIVATE_NATIVE_REFUSAL' } }; };
      unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual(name === resolveName ? [resolveName] : [resolveName, historyName]);
    }
  });

  it.each(['paige_chat_threads', 'paige_chat_turns', 'paige_pending_confirmations'])(
    'refuses a missing/error origin read in %s', async table => {
      for (const error of [null, { code: '42501', message: 'PRIVATE_NATIVE_RLS' }]) {
        const f = await fixture(); f.onQuery = q => q.table === table ? { data: null, error } : undefined;
        unavailable(await run(f), f); expect(f.calls).toHaveLength(0);
      }
    });

  it.each(['thread', 'turn'] as const)('rechecks changed original %s after native history', async changed => {
    const f = await fixture(); f.onQuery = q => {
      if (changed === 'thread' && q.table === 'paige_chat_threads' && q.index === 2)
        return { data: { ...f.thread, is_archived: true }, error: null };
      if (changed === 'turn' && q.table === 'paige_chat_turns' && q.index === 2)
        return { data: { ...f.turn, content: 'Changed canonical original' }, error: null };
      return undefined;
    };
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName, historyName]);
  });

  it('refuses stale/aborted entry before every read', async () => {
    const f = await fixture(); f.current = false; unavailable(await run(f), f);
    expect(f.queries).toHaveLength(0); expect(f.calls).toHaveLength(0);
  });

  it.each(['thread', 'turn', 'proposal', 'resolve', 'history', 'final_thread', 'final_turn'])(
    'withdraws publication at the %s boundary', async boundary => {
      const f = await fixture();
      f.onQuery = q => { if (boundary === 'thread' && q.table === 'paige_chat_threads' && q.index === 1
        || boundary === 'turn' && q.table === 'paige_chat_turns' && q.index === 1
        || boundary === 'proposal' && q.table === 'paige_pending_confirmations'
        || boundary === 'final_thread' && q.table === 'paige_chat_threads' && q.index === 2
        || boundary === 'final_turn' && q.table === 'paige_chat_turns' && q.index === 2) f.current = false; return undefined; };
      f.onRpc = name => { if (boundary === 'resolve' && name === resolveName || boundary === 'history' && name === historyName) f.current = false; return undefined; };
      unavailable(await run(f), f);
      if (['thread', 'turn', 'proposal'].includes(boundary)) expect(f.calls).toHaveLength(0);
      if (boundary === 'resolve') expect(f.calls.map(c => c.name)).toEqual([resolveName]);
    });

  it('a monotonic generation/abort port rejects A→B→A, without claiming to detect unobserved ABA', async () => {
    const f = await fixture(); let generation = 1; const captured = generation; const controller = new AbortController();
    f.input.current = () => generation === captured && !controller.signal.aborted;
    f.onRpc = name => { if (name === resolveName) { generation += 1; controller.abort(); generation += 1; } return undefined; };
    unavailable(await run(f), f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
  });

  it('an abort while the actual resolver promise is pending prevents history and publication', async () => {
    const f = await fixture(), controller = new AbortController();
    let release!: (reply: Reply) => void;
    let entered!: () => void;
    const atResolver = new Promise<void>(resolve => { entered = resolve; });
    f.input.current = () => !controller.signal.aborted;
    f.onRpc = name => name === resolveName ? new Promise<Reply>(resolve => { release = resolve; entered(); }) : undefined;
    const pending = run(f); await atResolver; controller.abort(); release({ data: resolution(), error: null });
    unavailable(await pending, f); expect(f.calls.map(c => c.name)).toEqual([resolveName]);
  });

  it('a thrown withdrawal callback is closed and never exposed', async () => {
    const f = await fixture(); f.input.current = () => { throw new Error('PRIVATE_NATIVE_SCOPE'); };
    unavailable(await run(f), f); expect(f.queries).toHaveLength(0);
  });
});
