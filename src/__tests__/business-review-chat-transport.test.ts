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
