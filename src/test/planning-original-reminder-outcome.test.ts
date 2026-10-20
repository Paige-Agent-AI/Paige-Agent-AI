import { describe, expect, it, vi } from 'vitest';
import { DURABLE_JOB_STATES } from '../../supabase/functions/_shared/durable-job/mod';
import { observeOriginalReminderOutcome, type OriginalReminderOutcome, type OriginalReminderOutcomeInput } from
  '../../supabase/functions/_shared/planning/original-reminder-outcome';

// Recording RPC ports exercise the real existing parsers/composition. They prove
// neither signed JWT/native approval authority nor Chat/J19/customer acceptance.
const id = (n: number) => `a2341000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { actorId: id(1), tenantId: id(2), threadId: id(3), clientId: null, proposalId: id(4) } as const;
const workId = id(5), itemId = id(6), receiptId = id(7);
const resolveName = 'resolve_paige_reminder_approval', historyName = 'execute_paige_approved_reminder';
const resolution = (state = 'succeeded') => ({ v: 1, proposal_id: binding.proposalId, work_id: workId, work_status: state });
const receipt = () => ({ v: 1, status: 'succeeded', receipt_version: 1, work_id: workId, proposal_id: binding.proposalId,
  historical: true, replayed: true,
  original_result: { ok: true, item_id: itemId, item_type: 'reminder', remind_at: '2030-01-02T10:00:00.123456Z',
    railRecorded: true, receipt_status: 'recorded', receipt_run_id: receiptId },
  original_readback: { item_id: itemId, item_type: 'reminder', title: 'Original service review', summary: null,
    tenant_id: binding.tenantId, created_by: binding.actorId, remind_at: '2030-01-02T10:00:00.123456+00:00',
    remind_target: 'user', remind_channel: 'in_app', assigned_to_user_id: binding.actorId,
    plan_id: null, contact_id: null, source_version: '2026-10-18T06:40:00.765432+00:00' } });
type Reply = { data: unknown; error: unknown };
type Call = { name: string; args: Record<string, unknown> };
function port(override?: (name: string, args: Record<string, unknown>) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const caller = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>): Promise<Reply> => {
      calls.push({ name, args: { ...args } });
      if (override) return override(name, args);
      if (name === resolveName) return { data: resolution(), error: null };
      if (name === historyName) return { data: receipt(), error: null };
      throw new Error('Forbidden RPC: ' + name);
    }),
    from: vi.fn(() => { throw new Error('No current record/proposal table read is allowed'); }),
  };
  return Object.assign(caller, { calls });
}
const input = (caller = port()): OriginalReminderOutcomeInput => ({ caller, binding: { ...binding }, current: () => true });
const common = { callMode: 'history_only', newEffectPossible: false, freshDispatchAllowed: false,
  retryAllowed: false, legacyFallbackEligible: false } as const;
function unverified(result: OriginalReminderOutcome) {
  expect(result).toMatchObject({ kind: 'unverified', outcome: 'unverified', ...common });
  for (const field of ['originalResult', 'originalReadback', 'readback', 'currentReadback', 'not_applied', 'success', 'ok', 'args', 'error'])
    expect(result).not.toHaveProperty(field);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE');
}
function noEffects(p: ReturnType<typeof port>) {
  expect(p.calls.every(c => c.name === resolveName || c.name === historyName)).toBe(true);
  expect(p.from).not.toHaveBeenCalled();
}

describe('original Reminder outcome observer', () => {
  it('resolves exactly once then reads the verified original receipt with BOTH runtime arguments NULL', async () => {
    const p = port(), result = await observeOriginalReminderOutcome(input(p));
    expect(result).toMatchObject({ kind: 'verified_original', workId, proposalId: binding.proposalId,
      receiptVersion: 1, historical: true, replayed: true, ...common });
    expect(p.calls).toEqual([
      { name: resolveName, args: { p_proposal_id: binding.proposalId, p_expected_tenant: binding.tenantId,
        p_expected_thread: binding.threadId, p_expected_client: null } },
      { name: historyName, args: { p_work_id: workId, p_expected_tenant: binding.tenantId,
        p_expected_thread: binding.threadId, p_expected_client: null, p_intent: null, p_runtime_request_nonce: null } },
    ]);
    if (result.kind !== 'verified_original') throw new Error('Verified original required');
    expect(result.originalResult).toEqual(receipt().original_result);
    expect(result.originalReadback).toEqual(receipt().original_readback);
    expect(Object.isFrozen(result.originalResult)).toBe(true);
    expect(Object.isFrozen(result.originalReadback)).toBe(true);
    for (const field of ['readback', 'currentReadback', 'success', 'ok', 'not_applied', 'runtime']) expect(result).not.toHaveProperty(field);
    noEffects(p);
  });

  it.each(DURABLE_JOB_STATES.filter(s => s !== 'succeeded'))('observes %s without attempting history, expiry normalization or dispatch', async state => {
    const p = port(() => ({ data: resolution(state), error: null }));
    unverified(await observeOriginalReminderOutcome(input(p)));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]); noEffects(p);
  });

  it.each(['actor', 'tenant', 'thread', 'membership'])('preserves native %s refusal without exposing a result or falling back', async kind => {
    const p = port(() => ({ data: null, error: { code: '42501', message: 'PRIVATE_NATIVE_' + kind } }));
    unverified(await observeOriginalReminderOutcome(input(p)));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]); noEffects(p);
  });

  it.each([
    { v: 2 }, { proposal_id: id(90) }, { work_id: 'not-a-uuid' }, { work_status: 'running' },
    { stored_args: { title: 'PRIVATE_NATIVE_ARGS' } },
  ])('rejects malformed or conflicting resolver proof %j', async extra => {
    const p = port(() => ({ data: { ...resolution(), ...extra }, error: null }));
    unverified(await observeOriginalReminderOutcome(input(p)));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]); noEffects(p);
  });

  it.each([
    ['not historical', (r: ReturnType<typeof receipt>) => { r.historical = false; }],
    ['not replayed', (r: ReturnType<typeof receipt>) => { r.replayed = false; }],
    ['wrong work', (r: ReturnType<typeof receipt>) => { r.work_id = id(90); }],
    ['wrong proposal', (r: ReturnType<typeof receipt>) => { r.proposal_id = id(90); }],
    ['foreign actor', (r: ReturnType<typeof receipt>) => { r.original_readback.created_by = id(90); }],
    ['foreign tenant', (r: ReturnType<typeof receipt>) => { r.original_readback.tenant_id = id(90); }],
    ['different record', (r: ReturnType<typeof receipt>) => { r.original_readback.item_id = id(90); }],
    ['missing receipt', (r: ReturnType<typeof receipt>) => { r.original_result.receipt_run_id = ''; }],
    ['missing Rail', (r: ReturnType<typeof receipt>) => { r.original_result.railRecorded = false; }],
    ['microsecond mismatch', (r: ReturnType<typeof receipt>) => { r.original_readback.remind_at = '2030-01-02T10:00:00.123457Z'; }],
  ])('does not turn SUCCEEDED status into proof: %s', async (_name, change) => {
    const r = receipt(); change(r);
    const p = port(name => ({ data: name === resolveName ? resolution() : r, error: null }));
    unverified(await observeOriginalReminderOutcome(input(p)));
    expect(p.calls.map(c => c.name)).toEqual([resolveName, historyName]); noEffects(p);
  });

  for (const stage of [resolveName, historyName]) {
    it.each(['throw', 'error', 'lost', 'malformed'] as const)('%s %s remains unverified without retry or replacement', async failure => {
      const p = port(name => {
        if (name !== stage) return { data: resolution(), error: null };
        if (failure === 'throw') throw new TypeError('PRIVATE_NATIVE lost acknowledgement');
        if (failure === 'error') return { data: null, error: { code: '55000', message: 'PRIVATE_NATIVE receipt refused' } };
        return { data: failure === 'lost' ? null : { status: 'succeeded', terminal_outcome: { verified_readback: true } }, error: null };
      });
      unverified(await observeOriginalReminderOutcome(input(p)));
      expect(p.calls.map(c => c.name)).toEqual(stage === resolveName ? [resolveName] : [resolveName, historyName]); noEffects(p);
    });
  }

  it.each(['proposalId', 'actorId', 'tenantId', 'threadId'] as const)('refuses malformed binding %s before any port', async field => {
    const p = port();
    unverified(await observeOriginalReminderOutcome({ ...input(p), binding: { ...binding, [field]: 'not-a-uuid' } }));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it.each([id(90), undefined, ''])('refuses a non-NULL focused client %j before any port', async clientId => {
    const p = port();
    unverified(await observeOriginalReminderOutcome({ ...input(p), binding: { ...binding, clientId } } as unknown as OriginalReminderOutcomeInput));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it.each(['runtime', 'intentId', 'requestNonce', 'freshDispatchAllowed', 'service', 'workId'])('rejects extra execution input %s, even undefined', async field => {
    const p = port();
    unverified(await observeOriginalReminderOutcome({ ...input(p), [field]: undefined } as OriginalReminderOutcomeInput));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it.each([null, { intentId: id(80), requestNonce: id(81) }])('refuses an explicit current runtime %j instead of interpreting it as history authority', async runtime => {
    const p = port();
    unverified(await observeOriginalReminderOutcome({ ...input(p), runtime } as OriginalReminderOutcomeInput));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it.each(['runtime', 'workId', 'args'])('rejects extra binding authority %s', async field => {
    const p = port();
    unverified(await observeOriginalReminderOutcome({ ...input(p), binding: { ...binding, [field]: {} } } as OriginalReminderOutcomeInput));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { caller: {}, binding, current: () => true }])('invalid input shape %j cannot call a port', async value => {
    unverified(await observeOriginalReminderOutcome(value as unknown as OriginalReminderOutcomeInput));
  });
  it('does not evaluate a binding accessor as stored identity', async () => {
    const p = port(), accessor = vi.fn(() => id(90));
    const value = { ...binding }; Object.defineProperty(value, 'proposalId', { get: accessor, enumerable: true });
    unverified(await observeOriginalReminderOutcome({ ...input(p), binding: value }));
    expect(accessor).not.toHaveBeenCalled(); expect(p.rpc).not.toHaveBeenCalled();
  });

  it('withdraws before any native read', async () => {
    const p = port(); unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => false }));
    expect(p.rpc).not.toHaveBeenCalled();
  });
  for (const stage of [resolveName, historyName]) {
    it('withdraws scope/abort during ' + stage + ' without exposing its acknowledgement', async () => {
      let active = true;
      const p = port(name => { if (name === stage) active = false; return { data: name === resolveName ? resolution() : receipt(), error: null }; });
      unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => active }));
      expect(p.calls.map(c => c.name)).toEqual(stage === resolveName ? [resolveName] : [resolveName, historyName]);
    });
  }
  it('latches an observed withdrawal even when the callback later returns true', async () => {
    let observed = false, calls = 0;
    const p = port(() => { observed = true; return { data: resolution(), error: null }; });
    unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => !observed || ++calls > 1 }));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]);
    expect(calls).toBe(1);
  });
  for (const stage of [resolveName, historyName]) {
    it('an actual abort during ' + stage + ' withdraws the observation', async () => {
      const abort = new AbortController();
      const p = port(name => { if (name === stage) abort.abort(); return { data: name === resolveName ? resolution() : receipt(), error: null }; });
      unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => !abort.signal.aborted }));
      expect(p.calls.map(c => c.name)).toEqual(stage === resolveName ? [resolveName] : [resolveName, historyName]);
    });
  }
  it('checks the captured withdrawal fence after the existing receipt adapter returns', async () => {
    let historyReturned = false, finalChecks = 0;
    const p = port(name => {
      if (name === historyName) historyReturned = true;
      return { data: name === resolveName ? resolution() : receipt(), error: null };
    });
    unverified(await observeOriginalReminderOutcome({ ...input(p),
      current: () => !historyReturned || ++finalChecks < 2 }));
    expect(finalChecks).toBe(2); noEffects(p);
  });
  it('uses the caller-supplied monotonic generation fence for actor/tenant ABA', async () => {
    const originalGeneration = 7; let generation = originalGeneration;
    const p = port(() => { generation += 2; return { data: resolution(), error: null }; });
    unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => generation === originalGeneration }));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]);
  });
  it('a throwing withdrawal callback cannot fall through to history', async () => {
    let reached = false;
    const p = port(() => { reached = true; return { data: resolution(), error: null }; });
    unverified(await observeOriginalReminderOutcome({ ...input(p), current: () => { if (reached) throw new Error('withdrawn'); return true; } }));
    expect(p.calls.map(c => c.name)).toEqual([resolveName]);
  });
  it('does not borrow a replacement binding, port or withdrawal callback after the first await', async () => {
    const replacement = port(); let active = true;
    const mutableBinding = { ...binding };
    const p = port(name => {
      if (name === resolveName) {
        mutableBinding.proposalId = id(90); mutableBinding.tenantId = id(91);
        request.binding = { ...binding, actorId: id(90) }; request.caller = replacement; request.current = () => false;
      }
      return { data: name === resolveName ? resolution() : receipt(), error: null };
    });
    const request = { caller: p, binding: mutableBinding, current: () => active };
    const result = await observeOriginalReminderOutcome(request);
    expect(result.kind).toBe('verified_original'); expect(replacement.rpc).not.toHaveBeenCalled();
    expect(p.calls[1]?.args).toMatchObject({ p_expected_tenant: binding.tenantId, p_expected_thread: binding.threadId, p_work_id: workId });
    active = false;
  });
  it('cannot replace a withdrawn original callback with a later always-current callback', async () => {
    let active = true;
    const p = port(() => { active = false; request.current = () => true; return { data: resolution(), error: null }; });
    const request = { caller: p, binding: { ...binding }, current: () => active };
    unverified(await observeOriginalReminderOutcome(request)); expect(p.calls.map(c => c.name)).toEqual([resolveName]);
  });
  it('captures the RPC method itself, preserving its original receiver', async () => {
    const p = port(); const original = p.rpc;
    p.rpc = vi.fn(async function (this: typeof p, name: string, args: Record<string, unknown>) {
      expect(this).toBe(p);
      if (name === resolveName) p.rpc = vi.fn(async () => { throw new Error('Later RPC method must not be borrowed'); });
      return original(name, args);
    });
    expect((await observeOriginalReminderOutcome(input(p))).kind).toBe('verified_original');
    expect(p.calls.map(c => c.name)).toEqual([resolveName, historyName]);
  });

  it('retains the original snapshot/version without reading a changed current Planning record', async () => {
    const currentRow = { remind_at: '2031-01-01T12:00:00Z', status: 'cancelled', updated_at: '2030-01-01T00:00:00Z' };
    const p = port(); const result = await observeOriginalReminderOutcome(input(p));
    if (result.kind !== 'verified_original') throw new Error('Original receipt required');
    expect(result.originalReadback.source_version).toBe(receipt().original_readback.source_version);
    expect(result.originalReadback.remind_at).not.toBe(currentRow.remind_at);
    expect(result).not.toHaveProperty('currentReadback'); noEffects(p);
  });
  it('repeated/concurrent observations retain one original identity and never call a writer', async () => {
    const p = port();
    const results: OriginalReminderOutcome[] = await Promise.all([observeOriginalReminderOutcome(input(p)), observeOriginalReminderOutcome(input(p))]);
    results.push(await observeOriginalReminderOutcome(input(p)));
    expect(results.every(r => r.kind === 'verified_original')).toBe(true);
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
    expect(p.calls.filter(c => c.name === resolveName)).toHaveLength(3);
    expect(p.calls.filter(c => c.name === historyName)).toHaveLength(3); noEffects(p);
  });
});
