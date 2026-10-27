// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function load(path: string, require: (name: string) => unknown) {
  const compiled = ts.transpileModule(readFileSync(resolve(path), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  expect(compiled.diagnostics).toEqual([]);
  const exports: Record<string, unknown> = {};
  new Function('exports', 'require', compiled.outputText)(exports, require);
  return exports;
}
const wait = load('supabase/functions/_shared/systems-check-wait.ts', () => { throw new Error('Unexpected wait dependency'); });
const states = load('supabase/functions/_shared/durable-job/mod.ts', () => { throw new Error('Unexpected state dependency'); });
const request = load('supabase/functions/_shared/systems-check-manual-request.ts', name => {
  if (name === './systems-check-wait.ts') return wait;
  if (name === './durable-job/mod.ts') return states;
  throw new Error('Unexpected request dependency: ' + name);
});
const module = load('supabase/functions/_shared/systems-check-manual-result.ts', name => {
  if (name === './durable-job/observation.ts') return load('supabase/functions/_shared/durable-job/observation.ts', () => { throw new Error('Unexpected observation dependency'); });
  if (name === './systems-check-wait.ts') return wait;
  if (name === './systems-check-manual-request.ts') return request;
  throw new Error('Unexpected result dependency: ' + name);
});
const read = module.readManualSystemsRun as (ports: Record<string, unknown>) => Promise<Record<string, unknown>>;
const ACTOR = 'c6000000-0000-4000-8000-000000000001', TENANT = 'c6000000-0000-4000-8000-000000000002';
const WORK = 'c6000000-0000-4000-8000-000000000003', OTHER = 'c6000000-0000-4000-8000-000000000004';
const START = '2026-10-01T12:00:01Z', COMPLETE = '2026-10-01T12:00:02Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const pin = { actorId: ACTOR, tenantId: TENANT, workId: WORK };
  const work: Record<string, unknown> = { work_id: WORK, capability_key: 'systems.check', work_kind: 'systems_check', work_status: 'succeeded', attempt_count: 1, max_attempts: 1,
    blocked_reason: null, error_code: null, safe_summary: 'Original source wording', created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:03Z', settled_at: '2026-10-01T12:00:03Z' };
  const run: Record<string, unknown> = { id: WORK, work_id: WORK, tenant_id: TENANT, scan_flavor: 'manual', selected_runner_keys: null,
    triggered_by: { scope: 'tenant', action_filing: 'none', private: 'never return' }, started_at: START, completed_at: COMPLETE,
    check_count: 5, pass_count: 2, fail_count: 1 };
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: ACTOR } }, error: null });
  const tenant = vi.fn().mockImplementation(() => Promise.resolve({ data: TENANT, error: null }));
  const workReply = vi.fn().mockImplementation(() => Promise.resolve({ data: [work], error: null }));
  const runReply = vi.fn().mockImplementation(() => Promise.resolve({ data: run, error: null }));
  const workAbort = vi.fn().mockImplementation(() => workReply());
  const query = { select: vi.fn(), eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: runReply };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query);
  const caller = { auth: { getUser }, rpc: vi.fn().mockImplementation((name: string) => {
    if (name === 'current_user_tenant_id') return tenant();
    if (name === 'get_paige_durable_work') return { abortSignal: workAbort };
    throw new Error('Unexpected RPC: ' + name);
  }), from: vi.fn().mockReturnValue(query) };
  const controller = new AbortController(), current = vi.fn(() => true);
  return { pin, work, run, getUser, tenant, workReply, runReply, query, caller, controller, current,
    ports: { ...pin, caller, signal: controller.signal, current } };
}

describe('Original manual Systems run result, caller-scoped and read only', () => {
  it('reads the exact native-associated run and returns only its source result', async () => {
    const f = fixture(), result = await read(f.ports);
    expect(result).toEqual({ readback: 'available', run: { id: WORK, workId: WORK, startedAt: START, completedAt: COMPLETE, checkCount: 5, passCount: 2, failCount: 1 }, receipt: 'not_projected' });
    expect(f.caller.from).toHaveBeenCalledExactlyOnceWith('paige_systems_check_run');
    expect(f.query.eq.mock.calls).toEqual([['id', WORK], ['work_id', WORK], ['tenant_id', TENANT]]);
    expect(f.query.abortSignal).toHaveBeenCalledWith(f.controller.signal);
    expect(f.caller.rpc.mock.calls.map(call => call[0])).toEqual(['current_user_tenant_id', 'get_paige_durable_work', 'current_user_tenant_id', 'get_paige_durable_work']);
    expect(f.workReply).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/private|triggered_by|safe_summary|tenant_id|latest|receipt_id/);
  });
  it.each(['claimed', 'blocked', 'failed', 'cancelled', 'expired', 'outcome_unknown'])('does not infer a run from native %s', async state => {
    const f = fixture(); f.work.work_status = state;
    expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' }); expect(f.caller.from).not.toHaveBeenCalled();
  });
  it.each([
    { id: OTHER }, { work_id: OTHER }, { tenant_id: OTHER }, { scan_flavor: 'onboarding' }, { selected_runner_keys: [] },
    { triggered_by: null }, { triggered_by: { scope: 'operator', action_filing: 'none' } }, { triggered_by: { scope: 'tenant', action_filing: 'full' } },
    { started_at: null }, { completed_at: null }, { completed_at: 'invalid' }, { started_at: '2026-10-01T12:00:04Z' },
    { started_at: '2026-10-01T11:59:59Z' }, { completed_at: '2026-10-01T12:00:04Z' },
    { check_count: -1 }, { check_count: 2 }, { pass_count: 1.5 }, { fail_count: '1' }, { fail_count: 2147483648 },
  ])('refuses an unverified original run association or result %j', async patch => {
    const f = fixture(); Object.assign(f.run, patch); expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' });
  });
  it.each(['actorId', 'tenantId', 'workId'])('rejects malformed %s before reading', async key => {
    const f = fixture(); f.ports[key as keyof typeof f.pin] = 'invalid';
    expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' }); expect(f.getUser).not.toHaveBeenCalled();
  });
  it('refuses a stale host scope before any read', async () => {
    const f = fixture(); f.current.mockReturnValue(false); expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' }); expect(f.getUser).not.toHaveBeenCalled();
  });
  it.each(['auth', 'tenant', 'native', 'record'])('does not treat refused %s access as an empty or completed result', async stage => {
    const f = fixture(); const refusal = { data: null, error: { message: 'private denial' } };
    if (stage === 'auth') f.getUser.mockResolvedValue({ data: { user: null }, error: refusal.error });
    if (stage === 'tenant') f.tenant.mockResolvedValue(refusal);
    if (stage === 'native') f.workReply.mockResolvedValue(refusal);
    if (stage === 'record') f.runReply.mockResolvedValue(refusal);
    expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' });
  });
  it.each(['actor', 'tenant', 'host'])('voids a read when %s changes before return', async change => {
    const f = fixture();
    if (change === 'actor') f.getUser.mockResolvedValueOnce({ data: { user: { id: ACTOR } }, error: null }).mockResolvedValueOnce({ data: { user: { id: OTHER } }, error: null });
    if (change === 'tenant') f.tenant.mockResolvedValueOnce({ data: TENANT, error: null }).mockResolvedValueOnce({ data: OTHER, error: null });
    if (change === 'host') f.runReply.mockImplementation(async () => { f.current.mockReturnValue(false); return { data: f.run, error: null }; });
    expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' });
  });
  it.each(['revoked', 'changed'])('rechecks native authority and refuses a %s original Work before return', async change => {
    const f = fixture(); f.workReply.mockResolvedValueOnce({ data: [{ ...f.work }], error: null })
      .mockResolvedValueOnce(change === 'revoked' ? { data: null, error: { message: 'private denial' } }
        : { data: [{ ...f.work, work_status: 'outcome_unknown' }], error: null });
    expect(await read(f.ports)).toEqual({ readback: 'unconfirmed' });
  });
  it('pins the validated run result before later caller-context reads', async () => {
    const f = fixture(); f.getUser.mockImplementationOnce(async () => ({ data: { user: { id: ACTOR } }, error: null }))
      .mockImplementationOnce(async () => { f.run.check_count = 999; f.run.completed_at = 'later mutation'; return { data: { user: { id: ACTOR } }, error: null }; });
    expect(await read(f.ports)).toMatchObject({ readback: 'available', run: { checkCount: 5, completedAt: COMPLETE } });
  });
  it('does not use a late run response or retry after interruption', async () => {
    const f = fixture(); let finish!: () => void;
    f.runReply.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ data: f.run, error: null }); }));
    const pending = read(f.ports); await tick(); f.controller.abort(); expect(await pending).toEqual({ readback: 'unconfirmed' });
    finish(); await tick(); expect(f.runReply).toHaveBeenCalledTimes(1); expect(f.caller.from).toHaveBeenCalledTimes(1);
  });
});
