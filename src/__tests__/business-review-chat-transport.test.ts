// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readBusinessSnapshotTransport } from '../../supabase/functions/_shared/paige-context/business-review-chat.ts';

const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = '44444444-4444-4444-8444-444444444444';
const ctx = { who: { actorId: actor, tenantId: tenant, role: 'owner', accountShape: 'solo' as const }, timezone: 'America/New_York' };
const envelope = () => ({ version: 1, actor_id: actor, tenant_id: tenant, timezone: ctx.timezone,
  result: { status: 'available', message: 'Read only.', projection: 'Synthetic source evidence; unavailable is not zero.',
    record_links: [{ destination: 'finance', record_id: null, url: 'https://untrusted.example' }] } });
function fixture(data: unknown = envelope(), scopes = [tenant, tenant]) {
  const invoke = vi.fn().mockResolvedValue({ data, error: null });
  const rpc = vi.fn(async (name: string) => {
    if (name !== 'current_user_tenant_id') throw Error('No local composition or issuer fallback is permitted');
    return { data: scopes.shift(), error: null };
  });
  return { caller: { rpc, functions: { invoke } }, invoke, rpc };
}

describe('Chat uses the existing authenticated review transport', () => {
  it('invokes once with original scope/period/zone and returns only canonical evidence/record references', async () => {
    const f = fixture();
    const r = await readBusinessSnapshotTransport(ctx, { caller: f.caller }, { period: 'last_7_days', focus: ['sales'] });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledWith('paige-business-review?chat=1&finance_sources=1', expect.objectContaining({
      body: { period: 'last_7_days', focus: ['sales'], timezone: ctx.timezone },
      headers: { 'x-paige-review-scope': tenant }, signal: expect.any(AbortSignal),
    }));
    expect(r.status).toBe('available');
    expect(r.projection).toContain('unavailable is not zero');
    expect(r.record_links).toEqual([{ destination: 'finance', record_id: null }]);
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(['current_user_tenant_id', 'current_user_tenant_id']);
  });
  it('invalid input never starts a remote or metric read', async () => {
    const f = fixture();
    expect((await readBusinessSnapshotTransport(ctx, { caller: f.caller }, { arbitrary: true })).status).toBe('needs_input');
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([[null, tenant], ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenant]])('refuses missing/foreign initial scope', async (a, b) => {
    const f = fixture(envelope(), [a, b] as string[]);
    expect((await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {})).status).toBe('refused');
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('discards a completed remote result after workspace switch', async () => {
    const f = fixture(envelope(), [tenant, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    const r = await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {});
    expect(r.status).toBe('refused'); expect(r.projection).toBeUndefined(); expect(r.record_links).toBeUndefined();
  });
  it.each(['actor_id', 'tenant_id', 'timezone', 'version'] as const)('rejects mismatched %s without retry or fallback', async key => {
    const data = { ...envelope(), [key]: 'wrong' }; const f = fixture(data);
    const r = await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {});
    expect(r.status).toBe('unavailable'); expect(r.projection).toBeUndefined(); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { ...envelope(), result: { status: 'available', message: 'read', projection: 'x'.repeat(12_001) } },
    { ...envelope(), result: { status: 'completed', message: 'read' } },
    { ...envelope(), result: { status: ['available'], message: 'read' } },
    { ...envelope(), result: { status: ['refused'], message: 'read' } }])('rejects malformed/oversized/non-read response', async data => {
    const f = fixture(data);
    expect((await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {})).status).toBe('unavailable');
    expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['refused', 'unavailable', 'needs_input'])('preserves %s without figures or record links', async status => {
    const f = fixture({ ...envelope(), result: { ...envelope().result, status } });
    const r = await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {});
    expect(r).toEqual({ status, message: 'Read only.' });
  });
  it.each(['error', 'throw'])('transport %s never replays the read or exposes diagnostics', async mode => {
    const f = fixture();
    if (mode === 'throw') f.invoke.mockRejectedValue(Error('private failure'));
    else f.invoke.mockResolvedValue({ data: envelope(), error: { message: 'private failure' } });
    const r = await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {});
    expect(r.status).toBe('unavailable'); expect(JSON.stringify(r)).not.toContain('private');
    expect(f.invoke).toHaveBeenCalledTimes(1); expect(r.projection).toBeUndefined();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('one elapsed Business Review read budget', () => {
  it.each(['preflight', 'invoke', 'readback'] as const)('settles a hung %s and never resumes later stages after expiry', async stage => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture();
    const scope = deferred<{ data: string; error: null }>();
    const remote = deferred<{ data: unknown; error: null }>();
    if (stage === 'preflight') f.rpc.mockImplementationOnce(() => scope.promise);
    else if (stage === 'readback') f.rpc.mockResolvedValueOnce({ data: tenant, error: null }).mockImplementationOnce(() => scope.promise);
    else f.invoke.mockImplementationOnce(() => remote.promise);
    let result: Awaited<ReturnType<typeof readBusinessSnapshotTransport>> | undefined;
    const work = readBusinessSnapshotTransport(ctx, { caller: f.caller }, {}).then(value => { result = value; });
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(result?.status).toBe('unavailable');
      expect(result?.projection).toBeUndefined();
      expect(result?.record_links).toBeUndefined();
      scope.resolve({ data: tenant, error: null });
      remote.resolve({ data: envelope(), error: null });
      await work;
      expect(result?.status).toBe('unavailable');
      expect(f.invoke).toHaveBeenCalledTimes(stage === 'preflight' ? 0 : 1);
      expect(f.rpc).toHaveBeenCalledTimes(stage === 'readback' ? 2 : 1);
      if (stage !== 'preflight') expect(f.invoke.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      scope.resolve({ data: tenant, error: null });
      remote.resolve({ data: envelope(), error: null });
      await work;
      vi.useRealTimers();
    }
  });

  it('shares the same fifteen seconds across scope, transport and final scope', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = fixture();
    const before = deferred<{ data: string; error: null }>();
    const after = deferred<{ data: string; error: null }>();
    const remote = deferred<{ data: unknown; error: null }>();
    f.rpc.mockImplementationOnce(() => before.promise).mockImplementationOnce(() => after.promise);
    f.invoke.mockImplementationOnce(() => remote.promise);
    let result: Awaited<ReturnType<typeof readBusinessSnapshotTransport>> | undefined;
    const work = readBusinessSnapshotTransport(ctx, { caller: f.caller }, {}).then(value => { result = value; });
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      before.resolve({ data: tenant, error: null });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(f.invoke).toHaveBeenCalledTimes(1);
      remote.resolve({ data: envelope(), error: null });
      await vi.advanceTimersByTimeAsync(999);
      expect(f.rpc).toHaveBeenCalledTimes(2);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result?.status).toBe('unavailable');
      after.resolve({ data: tenant, error: null });
      await work;
      expect(result?.projection).toBeUndefined();
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      before.resolve({ data: tenant, error: null });
      remote.resolve({ data: envelope(), error: null });
      after.resolve({ data: tenant, error: null });
      await work;
      vi.useRealTimers();
    }
  });

  it('still publishes verified evidence when all three delayed stages finish within budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const f = fixture();
      f.rpc.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: tenant, error: null }), 6_000)));
      f.invoke.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: envelope(), error: null }), 2_000)));
      const work = readBusinessSnapshotTransport(ctx, { caller: f.caller }, {});
      await vi.advanceTimersByTimeAsync(14_000);
      expect(await work).toMatchObject({ status: 'available', projection: envelope().result.projection,
        record_links: [{ destination: 'finance', record_id: null }] });
      expect(vi.getTimerCount()).toBe(0);
      expect(f.invoke.mock.calls[0][1].signal.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('cleans up the budget after a prompt successful scoped read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const f = fixture();
      expect((await readBusinessSnapshotTransport(ctx, { caller: f.caller }, {})).status).toBe('available');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(f.rpc).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
