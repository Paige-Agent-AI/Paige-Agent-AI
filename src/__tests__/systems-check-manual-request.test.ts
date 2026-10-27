// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function load(path: string, require: (name: string) => unknown) {
  const source = ts.transpileModule(readFileSync(resolve(path), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  expect(source.diagnostics).toEqual([]);
  const exports: Record<string, unknown> = {};
  new Function('exports', 'require', source.outputText)(exports, require);
  return exports;
}
const core = load('supabase/functions/_shared/systems-check-runner.ts', name => {
  if (name !== './prompt-forge.ts') throw new Error('Unexpected Core dependency'); return { forge: vi.fn(() => { throw new Error('No model effect allowed'); }) };
});
const states = load('supabase/functions/_shared/durable-job/mod.ts', () => { throw new Error('Unexpected state dependency'); });
const work = load('supabase/functions/_shared/systems-check-manual-work.ts', name => {
  if (name !== './systems-check-runner.ts') throw new Error('Unexpected consumer dependency'); return core;
});
const module = load('supabase/functions/_shared/systems-check-manual-request.ts', name => {
  if (name === './systems-check-runner.ts') return core;
  if (name === './systems-check-manual-work.ts') return work;
  if (name === './durable-job/mod.ts') return states;
  throw new Error('Unexpected request dependency: ' + name);
});
const prepare = module.prepareManualSystemsRequest as (ports: Record<string, unknown>) => Promise<Record<string, unknown>>;
const ACTOR = 'c5000000-0000-4000-8000-000000000001', TENANT = 'c5000000-0000-4000-8000-000000000002';
const INTENT = 'c5000000-0000-4000-8000-000000000003', WORK = 'c5000000-0000-4000-8000-000000000004';
const TIME = '2026-10-01T12:00:00Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const context = { actorId: ACTOR, tenantId: TENANT, intentId: INTENT, threadId: null as string | null };
  const creation: Record<string, unknown> = { work_id: WORK, work_status: 'claimed', work_version: 2, resumed_existing: false };
  const observed: Record<string, unknown> = { work_id: WORK, capability_key: 'systems.check', work_kind: 'systems_check', work_status: 'claimed', attempt_count: 1, max_attempts: 1,
    blocked_reason: null, error_code: null, safe_summary: 'Original prepared summary', created_at: TIME, updated_at: TIME, settled_at: null };
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
  const createReply = vi.fn().mockImplementation(() => Promise.resolve({ data: [creation], error: null }));
  const readReply = vi.fn().mockImplementation(() => Promise.resolve({ data: [observed], error: null }));
  const createAbort = vi.fn().mockImplementation(() => createReply());
  const readAbort = vi.fn().mockImplementation(() => readReply());
  const admin = { rpc: vi.fn().mockReturnValue({ abortSignal: createAbort }) };
  const caller = { auth: { getUser }, rpc: vi.fn().mockReturnValue({ abortSignal: readAbort }) };
  const request = new AbortController(), observation = new AbortController();
  const observationSignal = vi.fn(() => observation.signal), dispatch = vi.fn().mockResolvedValue({ status: 202 });
  return { context, creation, observed, getUser, createReply, readReply, admin, caller, request, observation, observationSignal, dispatch, createAbort, readAbort,
    ports: { context, admin, caller, requestSignal: request.signal, observationSignal, dispatch } };
}

describe('Original Systems request preparation and canonical Work observation, unregistered', () => {
  it('prepares once using verified original identity, dispatches once, then reads original RLS status', async () => {
    const f = fixture(), result = await prepare(f.ports);
    expect(f.admin.rpc).toHaveBeenCalledExactlyOnceWith('_create_manual_systems_check_work', { p_actor: ACTOR, p_tenant: TENANT, p_intent: INTENT, p_thread: null });
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith(WORK, f.request.signal);
    expect(f.caller.rpc).toHaveBeenCalledExactlyOnceWith('get_paige_durable_work', { _work_id: WORK });
    expect(f.createAbort).toHaveBeenCalledWith(f.request.signal); expect(f.readAbort).toHaveBeenCalledWith(f.observation.signal);
    expect(result).toEqual({ readback: 'available', resumedExisting: false, dispatchAcknowledged: true,
      work: { id: WORK, status: 'claimed', createdAt: TIME, updatedAt: TIME, settledAt: null, safeSummary: 'Original prepared summary' } });
    // Claimed/prepared +202 is not a run, success, receipt or private key.
    expect(JSON.stringify(result)).not.toMatch(/server_idempotency_key|runId|safe_summary/);
  });
  it.each(['claimed', 'succeeded', 'expired', 'outcome_unknown', 'failed', 'cancelled', 'blocked'])(
    'resumes %s by reading the original Work WITHOUT replay', async status => {
      const f = fixture(); Object.assign(f.creation, { resumed_existing: true, work_status: status });
      Object.assign(f.observed, { work_status: status, settled_at: status === 'succeeded' ? TIME : null });
      expect(await prepare(f.ports)).toMatchObject({ readback: 'available', resumedExisting: true, dispatchAcknowledged: false, work: { status } });
      expect(f.dispatch).not.toHaveBeenCalled(); expect(f.admin.rpc).toHaveBeenCalledTimes(1); expect(f.caller.rpc).toHaveBeenCalledTimes(1);
    });
  it('uses original native success even when transport acknowledgement was lost, never a retry', async () => {
    const f = fixture(); Object.assign(f.observed, { work_status: 'succeeded', settled_at: TIME }); f.dispatch.mockRejectedValue(new Error('Private network detail'));
    expect(await prepare(f.ports)).toMatchObject({ readback: 'available', dispatchAcknowledged: false, work: { status: 'succeeded', settledAt: TIME } });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { work_id: WORK, work_status: 'queued', work_version: 2, resumed_existing: false }, { work_id: WORK, work_status: 'succeeded', work_version: 2, resumed_existing: false },
    { work_id: WORK, work_status: 'claimed', work_version: 0, resumed_existing: false }, { work_id: WORK, work_status: 'claimed', work_version: 2, resumed_existing: 'false' }])(
    'refuses malformed native preparation %j without dispatch/read', async row => {
      const f = fixture(); f.createReply.mockResolvedValue({ data: [row], error: null });
      expect(await prepare(f.ports)).toEqual({ readback: 'unconfirmed' }); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.caller.rpc).not.toHaveBeenCalled();
    });
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: TENANT } }, error: null }, { data: { user: { id: ACTOR } }, error: { message: 'private' } }])(
    'cannot prepare under an unverified/mismatched caller %j', async reply => {
      const f = fixture(); f.getUser.mockResolvedValue(reply); expect(await prepare(f.ports)).toEqual({ readback: 'unconfirmed' });
      expect(f.admin.rpc).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.caller.rpc).not.toHaveBeenCalled();
    });
  it('pins original context before a later host/workspace mutation', async () => {
    const f = fixture(); let finish!: () => void;
    f.getUser.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ data: { user: { id: ACTOR } }, error: null }); }));
    const pending = prepare(f.ports); await tick(); Object.assign(f.context, { tenantId: WORK, intentId: WORK, threadId: WORK }); finish(); await pending;
    expect(f.admin.rpc).toHaveBeenCalledWith('_create_manual_systems_check_work', { p_actor: ACTOR, p_tenant: TENANT, p_intent: INTENT, p_thread: null });
  });
  it('never starts preparation after a late identity response', async () => {
    const f = fixture(); let finish!: () => void;
    f.getUser.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ data: { user: { id: ACTOR } }, error: null }); }));
    const pending = prepare(f.ports); await tick(); f.request.abort(); expect(await pending).toEqual({ readback: 'unconfirmed' }); finish(); await tick();
    expect(f.admin.rpc).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('never dispatches after an unacknowledged preparation or claims no Work was created', async () => {
    const f = fixture(); let finish!: () => void;
    f.createReply.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ data: [f.creation], error: null }); }));
    const pending = prepare(f.ports); await tick(); f.request.abort(); expect(await pending).toEqual({ readback: 'unconfirmed' }); finish(); await tick();
    expect(f.dispatch).not.toHaveBeenCalled(); expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it('stops waiting for a lost dispatch but uses one fresh bounded original status read', async () => {
    const f = fixture(); let finish!: () => void;
    f.dispatch.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ status: 202 }); }));
    const pending = prepare(f.ports); await tick(); f.request.abort();
    expect(await pending).toMatchObject({ readback: 'available', dispatchAcknowledged: false, work: { id: WORK, status: 'claimed' } });
    finish(); await tick(); expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.observationSignal).toHaveBeenCalledTimes(1);
  });
  it.each(['same', 'aborted'])('refuses %s observation scope without a status read', async kind => {
    const f = fixture(); f.observation.abort();
    const observationSignal = () => kind === 'same' ? f.request.signal : f.observation.signal;
    expect(await prepare({ ...f.ports, observationSignal })).toEqual({ readback: 'unconfirmed', workId: WORK }); expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: [], error: null }, { data: null, error: { code: '42501' } }])('retains denied/unavailable original RLS read %j', async reply => {
    const f = fixture(); f.readReply.mockResolvedValue(reply);
    expect(await prepare(f.ports)).toEqual({ readback: 'unconfirmed', workId: WORK }); expect(f.caller.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ work_id: INTENT }, { capability_key: 'other.check' }, { work_kind: 'other' }, { attempt_count: 2 }, { work_status: 'queued' },
    { work_status: 'succeeded', settled_at: null }, { created_at: 'invalid' }, { updated_at: null }, { safe_summary: 'x'.repeat(1_201) }, { unexpected: true }])(
    'does not present contradictory/unconfirmed Work fields %j', async changes => {
      const f = fixture(); Object.assign(f.observed, changes);
      expect(await prepare(f.ports)).toEqual({ readback: 'unconfirmed', workId: WORK });
    });
  it('cannot turn an unending observation into a known terminal state', async () => {
    const f = fixture(); f.readReply.mockImplementation(() => new Promise(() => {}));
    const pending = prepare(f.ports); await tick(); f.observation.abort();
    expect(await pending).toEqual({ readback: 'unconfirmed', workId: WORK }); expect(f.caller.rpc).toHaveBeenCalledTimes(1);
  });
});
