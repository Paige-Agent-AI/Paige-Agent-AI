import { expect, it, vi } from 'vitest';
import { readLinkedPortalClient, readPortalReleasedWork } from './client-delivery-portal';

const id = (n: number) => `ec040000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), clientId = id(2), tenantId = id(3);
const linked = { id: clientId, tenant_id: tenantId };
const scope = { actorId: actor, clientId, tenantId };
const release = { release_id: id(4), submission_id: id(5), state: 'awaiting_client',
  revision_no: 2, artifact_digest: 'a'.repeat(64), title: 'Released service outcome',
  updated_at: '2026-10-14T00:00:00.123456Z' };
const envelope = { actor_id: actor, tenant_id: tenantId, releases: [release], unavailable_count: 0, has_more: false };
const fixture = (rows: unknown = [linked]) => {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const is = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ is });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: actor } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: envelope, error: null });
  return { auth: { getUser }, from, rpc, select, eq, is, limit };
};
const current = () => true;

it('reads the existing actual-user linkage with a bounded nonmerged self query', async () => {
  const c = fixture();
  expect(await readLinkedPortalClient(c, actor, current)).toEqual({ kind: 'ready', scope });
  expect(c.from).toHaveBeenCalledWith('clients');
  expect(c.select).toHaveBeenCalledWith('id,tenant_id');
  expect(c.eq).toHaveBeenCalledWith('linked_user_id', actor);
  expect(c.is).toHaveBeenCalledWith('merged_into_contact_id', null);
  expect(c.limit).toHaveBeenCalledWith(2);
  expect(c.rpc).not.toHaveBeenCalled();
});
it('does not choose the first linkage or turn ambiguity into an empty portal', async () => {
  expect(await readLinkedPortalClient(fixture([]), actor, current)).toEqual({ kind: 'unlinked' });
  expect(await readLinkedPortalClient(fixture([linked, { id: id(8), tenant_id: id(9) }]), actor, current))
    .toEqual({ kind: 'ambiguous' });
});
it.each([null, {}, 'rows', [{ id: 'bad', tenant_id: tenantId }], [{ id: clientId, tenant_id: null }]])(
  'does not fabricate linkage from malformed data %j', async rows => {
    expect(await readLinkedPortalClient(fixture(rows), actor, current)).toEqual({ kind: 'unavailable' });
  },
);
it('keeps RLS/network failure separate from a genuinely unlinked customer', async () => {
  const c = fixture([]); c.limit.mockResolvedValue({ data: [], error: { code: '42501' } });
  expect(await readLinkedPortalClient(c, actor, current)).toEqual({ kind: 'unavailable' });
});
it('rejects a view-as or different actor before querying linkage', async () => {
  const c = fixture(); c.auth.getUser.mockResolvedValue({ data: { user: { id: id(9) } }, error: null });
  expect(await readLinkedPortalClient(c, actor, current)).toEqual({ kind: 'refused' });
  expect(c.from).not.toHaveBeenCalled(); expect(c.rpc).not.toHaveBeenCalled();
});
it('rejects missing authentication and errors before querying', async () => {
  for (const auth of [{ data: { user: null }, error: null }, { data: { user: { id: actor } }, error: {} }]) {
    const c = fixture(); c.auth.getUser.mockResolvedValue(auth);
    expect(await readLinkedPortalClient(c, actor, current)).toEqual({ kind: 'refused' });
    expect(c.from).not.toHaveBeenCalled();
  }
});
it('does not start an invalid or superseded read', async () => {
  const c = fixture();
  expect(await readLinkedPortalClient(c, 'not-an-actor', current)).toEqual({ kind: 'unavailable' });
  expect(await readLinkedPortalClient(c, actor, () => false)).toEqual({ kind: 'scope_changed' });
  expect(c.auth.getUser).not.toHaveBeenCalled(); expect(c.from).not.toHaveBeenCalled();
});
it('withdraws a linkage result when actual auth changes after its read', async () => {
  const c = fixture(); c.auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null })
    .mockResolvedValue({ data: { user: { id: id(9) } }, error: null });
  expect(await readLinkedPortalClient(c, actor, current)).toEqual({ kind: 'refused' });
});
it('uses the supplied epoch fence to reject A-B-A late linkage', async () => {
  const c = fixture(); let epoch = 1;
  c.limit.mockImplementation(async () => { epoch += 2; return { data: [linked], error: null }; });
  expect(await readLinkedPortalClient(c, actor, () => epoch === 1)).toEqual({ kind: 'scope_changed' });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('returns only the existing Operations projection, with no new writer or private metadata', async () => {
  const c = fixture(); c.rpc.mockResolvedValue({ data: { ...envelope,
    releases: [{ ...release, body: 'PRIVATE', client_note: 'PRIVATE' }], extra: 'PRIVATE' }, error: null });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'ready', scope,
    releases: [release], unavailableCount: 0, hasMore: false });
  expect(c.rpc.mock.calls.map(call => call[0])).toEqual(['operations_delivery_client_reviews_scoped']);
  expect(c.rpc).toHaveBeenCalledWith('operations_delivery_client_reviews_scoped', {
    p_expected_actor_id: actor, p_expected_tenant_id: tenantId, p_limit: 40,
  });
});
it('never asks Operations to read when linkage is missing or ambiguous', async () => {
  for (const rows of [[], [linked, linked]]) {
    const c = fixture(rows); await readPortalReleasedWork(c, actor, current);
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it('reproves exact client identity before Operations, even with the same tenant', async () => {
  const c = fixture(); c.limit.mockResolvedValueOnce({ data: [linked], error: null })
    .mockResolvedValue({ data: [{ ...linked, id: id(8) }], error: null });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'refused' });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('withdraws discovery when the link changes while its RPC is pending', async () => {
  const c = fixture(); c.rpc.mockImplementation(async () => {
    c.limit.mockResolvedValue({ data: [{ ...linked, tenant_id: id(9) }], error: null });
    return { data: envelope, error: null };
  });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'refused' });
});
it('withdraws A-B-A discovery through the original epoch fence', async () => {
  const c = fixture(); let epoch = 1;
  c.rpc.mockImplementation(async () => { epoch += 2; return { data: envelope, error: null }; });
  expect(await readPortalReleasedWork(c, actor, () => epoch === 1)).toEqual({ kind: 'scope_changed' });
});
it('does not turn the domain refusal or a foreign projection into empty work', async () => {
  const c = fixture(); c.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'unavailable' });
  c.rpc.mockResolvedValue({ data: { ...envelope, tenant_id: id(9) }, error: null });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'unavailable' });
});
it('preserves capped and unavailable discovery instead of claiming a complete empty list', async () => {
  const c = fixture(); c.rpc.mockResolvedValue({ data: { ...envelope, releases: [],
    unavailable_count: 2, has_more: true }, error: null });
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'ready', scope,
    releases: [], unavailableCount: 2, hasMore: true });
});
it('has no privileged or unscoped fallback after unexpected auth transport errors', async () => {
  const c = fixture(); c.auth.getUser.mockRejectedValue(new Error('offline'));
  expect(await readPortalReleasedWork(c, actor, current)).toEqual({ kind: 'unavailable' });
  expect(c.from).not.toHaveBeenCalled(); expect(c.rpc).not.toHaveBeenCalled();
});
