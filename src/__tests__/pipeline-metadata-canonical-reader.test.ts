// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPipelineCanonicalReaders } from '../../supabase/functions/_shared/pipeline-metadata-canonical-reader';
import { readPipelineMetadataOutcome } from '../../supabase/functions/_shared/pipeline-metadata-readback';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { actorId: id(1), tenantId: id(2), threadId: id(3), intentId: id(4), effectId: id(5) };
function setup(actor = binding.actorId, tenant = binding.tenantId) {
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor } }, error: null })) }, rpc: vi.fn(async (name: string) => ({ data: name === 'current_user_tenant_id' ? tenant : { items: [] }, error: null })) };
  const service = { from: vi.fn(() => { throw Error('must not read an unbound operation'); }) };
  const revalidateScope = vi.fn(async () => true);
  return { caller, service, revalidateScope, readers: createPipelineCanonicalReaders({ caller, service, revalidateScope }) };
}
it('keeps recovery unavailable when protected resolver returns no original', async () => { const s = setup(); expect((await readPipelineMetadataOutcome(binding, s.readers)).outcome).toBe('outcome_unknown'); expect(s.service.from).not.toHaveBeenCalled(); });
const original = { tenantId: binding.tenantId, actorId: binding.actorId, actorKind: 'human', idempotencyKey: 'exact', commandHash: 'a'.repeat(32), command: { type: 'update-pipeline', pipelineId: id(6), expectedVersion: 2, name: 'New' } };
it('uses caller-bound protected original RPC with exact references', async () => { const s = setup(); s.caller.rpc.mockResolvedValue({ data: original, error: null }); expect(await s.readers.resolveOriginal(binding)).toEqual(original); expect(s.caller.rpc).toHaveBeenCalledExactlyOnceWith('read_pipeline_metadata_original', { _thread: binding.threadId, _intent: binding.intentId, _effect: binding.effectId }); });
it.each([null, {}, { ...original, actorId: id(9) }, { ...original, tenantId: id(9) }, { ...original, commandHash: 'bad' }, { ...original, actorKind: 'paige' }])('refuses malformed/foreign original %j', async data => { const s = setup(); s.caller.rpc.mockResolvedValue({ data, error: null }); expect(await s.readers.resolveOriginal(binding)).toBeNull(); });
it('contains original RPC failure', async () => { const s = setup(); s.caller.rpc.mockRejectedValue(Error('outage')); expect(await s.readers.resolveOriginal(binding)).toBeNull(); });
it('requires strict true scope revalidation', async () => { const s = setup(); s.revalidateScope.mockResolvedValue('yes' as unknown as boolean); expect(await s.readers.scopeHolds(binding)).toBe(false); });
it.each([[id(9), binding.tenantId], [binding.actorId, id(9)]])('rejects foreign actor/workspace', async (actor, tenant) => { const s = setup(actor, tenant); expect(await s.readers.scopeHolds(binding)).toBe(false); expect(s.revalidateScope).not.toHaveBeenCalled(); });
it('uses caller-authorized canonical catalogue RPC', async () => { const s = setup(); expect(await s.readers.getPipelineCatalogue(binding.tenantId)).toEqual({ items: [] }); expect(s.caller.rpc).toHaveBeenCalledWith('get_pipeline_catalogue', { _tenant_id: binding.tenantId, _search: null }); });
it('fails closed on caller auth errors', async () => { const s = setup(); s.caller.auth.getUser.mockRejectedValue(Error('transport')); expect(await s.readers.scopeHolds(binding)).toBe(false); });
it('filters canonical operation by tenant/key/actor/kind', async () => {
  const eq = vi.fn(); const select = vi.fn();
  const query = { select, eq, maybeSingle: vi.fn(async () => ({ data: { result: 'receipt' }, error: null })), then: Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null })) };
  eq.mockReturnValue(query); select.mockReturnValue(query);
  const s = setup(); const readers = createPipelineCanonicalReaders({ caller: s.caller, service: { from: () => query }, revalidateScope: s.revalidateScope });
  expect(await readers.readOperation({ tenantId: binding.tenantId, actorId: binding.actorId, actorKind: 'human', idempotencyKey: 'exact', commandHash: 'a'.repeat(32), command: {} })).toEqual({ result: 'receipt' });
  expect(eq.mock.calls).toEqual([['tenant_id', binding.tenantId], ['idempotency_key', 'exact'], ['actor_user_id', binding.actorId], ['actor_kind', 'human']]);
});
