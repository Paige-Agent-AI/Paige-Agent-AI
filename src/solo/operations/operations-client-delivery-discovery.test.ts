import { expect, it, vi } from 'vitest';
import { readClientReleasedDeliveries } from './operations-client-delivery-discovery';

const id = (n: number) => `ed510000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const scope = { actorId: id(1), tenantId: id(2) };
const row = { release_id: id(3), submission_id: id(4), state: 'awaiting_client',
  revision_no: 2, artifact_digest: 'a'.repeat(64), title: 'Released workshop outcome',
  updated_at: '2026-10-14T00:00:00.123456Z' };
const envelope = { actor_id: id(1), tenant_id: id(2), releases: [row], unavailable_count: 0, has_more: false };
const caller = (data: unknown = envelope, error: unknown = null) => ({
  getActor: vi.fn().mockResolvedValue(id(1)), getTenant: vi.fn().mockResolvedValue(id(2)),
  rpc: vi.fn().mockResolvedValue({ data, error }),
});

it('reads only released client-safe metadata through the actual actor/client workspace', async () => {
  const c = caller({ ...envelope, releases: [{ ...row, body: 'PRIVATE BODY', client_note: 'PRIVATE NOTE',
    task_title: 'PRIVATE INTERNAL WORK', client_name: 'PRIVATE NAME' }] });
  expect(await readClientReleasedDeliveries(c, scope, () => true)).toEqual({
    kind: 'ready', releases: [row], unavailableCount: 0, hasMore: false,
  });
  expect(c.rpc).toHaveBeenCalledWith('operations_delivery_client_reviews_scoped', {
    p_expected_actor_id: id(1), p_expected_tenant_id: id(2), p_limit: 40,
  });
});
it('keeps unreadable releases and bounded continuation distinct from an empty company', async () => {
  expect(await readClientReleasedDeliveries(caller({ ...envelope, releases: [], unavailable_count: 2,
    has_more: true }), scope, () => true)).toEqual({ kind: 'ready', releases: [], unavailableCount: 2, hasMore: true });
});
it('accepts only a genuinely scoped empty result', async () => {
  expect(await readClientReleasedDeliveries(caller({ ...envelope, releases: [] }), scope, () => true))
    .toEqual({ kind: 'ready', releases: [], unavailableCount: 0, hasMore: false });
});
it.each(['awaiting_client', 'client_revision_requested', 'accepted'])('preserves distinct %s source state', async state => {
  expect(await readClientReleasedDeliveries(caller({ ...envelope, releases: [{ ...row, state }] }), scope, () => true))
    .toMatchObject({ kind: 'ready', releases: [{ state }] });
});
it('foreign actual actor/client workspace refuses before any RPC', async () => {
  for (const field of ['getActor', 'getTenant'] as const) {
    const c = caller(); c[field].mockResolvedValue(id(9));
    expect(await readClientReleasedDeliveries(c, scope, () => true)).toEqual({ kind: 'refused' });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it('scope changes during or after the read conceal even scoped empty metadata', async () => {
  let current = true;
  const c = caller(); c.rpc.mockImplementation(async () => { current = false; return { data: envelope, error: null }; });
  expect(await readClientReleasedDeliveries(c, scope, () => current)).toEqual({ kind: 'scope_changed' });
  const changed = caller({ ...envelope, releases: [] });
  changed.getTenant.mockResolvedValueOnce(id(2)).mockResolvedValueOnce(id(9));
  expect(await readClientReleasedDeliveries(changed, scope, () => true)).toEqual({ kind: 'refused' });
});
it('malformed, foreign, duplicate and unsupported metadata fails closed', async () => {
  for (const data of [null, { ...envelope, actor_id: id(9) }, { ...envelope, tenant_id: id(9) },
    { ...envelope, releases: [row, row] }, { ...envelope, releases: [{ ...row, release_id: id(9) }, row] },
    { ...envelope, releases: [{ ...row, state: 'paid' }] }, { ...envelope, releases: [{ ...row, title: '' }] },
    { ...envelope, releases: [{ ...row, artifact_digest: 'MISSING' }] },
    { ...envelope, releases: [{ ...row, updated_at: 'yesterday' }] },
    { ...envelope, unavailable_count: 40 }, { ...envelope, has_more: 'false' }]) {
    expect(await readClientReleasedDeliveries(caller(data), scope, () => true)).toEqual({ kind: 'unavailable' });
  }
});
it('absent/refused transport never becomes a fabricated ready empty list', async () => {
  expect(await readClientReleasedDeliveries(caller(null, { code: '42501' }), scope, () => true)).toEqual({ kind: 'unavailable' });
  const c = caller(); c.rpc.mockRejectedValue(new Error('Offline'));
  expect(await readClientReleasedDeliveries(c, scope, () => true)).toEqual({ kind: 'unavailable' });
});
it('invalid scope or an already retired request never reads anything', async () => {
  const c = caller();
  expect(await readClientReleasedDeliveries(c, scope, () => false)).toEqual({ kind: 'scope_changed' });
  expect(await readClientReleasedDeliveries(c, { ...scope, actorId: '' }, () => true)).toEqual({ kind: 'unavailable' });
  expect(c.rpc).not.toHaveBeenCalled();
});
