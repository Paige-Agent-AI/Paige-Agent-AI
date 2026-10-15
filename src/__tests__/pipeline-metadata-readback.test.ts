// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readPipelineMetadataOutcome, type PipelineReadbackDependencies } from '../../supabase/functions/_shared/pipeline-metadata-readback';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { threadId: id(1), intentId: id(2), effectId: id(3), tenantId: id(4), actorId: id(5) };
const request = { tenantId: binding.tenantId, actorId: binding.actorId, actorKind: 'human' as const,
  idempotencyKey: 'op', commandHash: 'a'.repeat(32), command: { type: 'update-pipeline', pipelineId: id(6), expectedVersion: 2, name: 'New', description: null } };
const receipt = { tenant_id: request.tenantId, actor_user_id: request.actorId, actor_kind: 'human', idempotency_key: 'op', command_hash: request.commandHash, result: { ok: true, outcome: 'updated', pipeline_id: id(6) } };
const catalogue = { items: [{ id: id(6), version: 3, name: 'New', description: null }] };
function deps(): PipelineReadbackDependencies { return { scopeHolds: vi.fn(async () => true), resolveOriginal: vi.fn(async () => request), readOperation: vi.fn(async () => receipt), getPipelineCatalogue: vi.fn(async () => catalogue) }; }
describe('read-only pipeline adapter', () => {
  it('rejects original command replacement during readback', async () => { const d = deps(); let count = 0; d.resolveOriginal = async () => (++count === 1 ? request : { ...request, commandHash: 'b'.repeat(32) }); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('requires literal true from scope checks', async () => { const d = deps(); d.scopeHolds = async () => 'true' as unknown as boolean; expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('reads an exact authorized effect without dispatching a write', async () => { const d = deps(); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('confirmed_success'); expect(d.readOperation).toHaveBeenCalledOnce(); });
  it.each([0, 1, 2])('fails closed when scope changes at check %s', async n => { const d = deps(); let checks = 0; d.scopeHolds = vi.fn(async () => checks++ !== n); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('requires original trusted authority', async () => { const d = deps(); d.resolveOriginal = async () => null; expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); expect(d.readOperation).not.toHaveBeenCalled(); });
  it('refuses foreign original actor', async () => { const d = deps(); d.resolveOriginal = async () => ({ ...request, actorId: id(9) }); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); expect(d.readOperation).not.toHaveBeenCalled(); });
  it.each(['resolveOriginal', 'readOperation', 'getPipelineCatalogue', 'scopeHolds'] as const)('contains %s failures', async key => { const d = deps(); d[key] = vi.fn(async () => { throw Error('unavailable'); }); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('does not manufacture success from a concurrent newer version', async () => { const d = deps(); d.getPipelineCatalogue = async () => ({ items: [{ ...catalogue.items[0], version: 4 }] }); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('refuses a concurrent mismatched operation receipt', async () => { const d = deps(); d.readOperation = async () => ({ ...receipt, idempotency_key: 'other' }); expect((await readPipelineMetadataOutcome(binding, d)).outcome).toBe('outcome_unknown'); });
  it('keeps original binding stable across awaited server reads', async () => { const d = deps(); const mutable = structuredClone(binding); d.readOperation = async () => { mutable.tenantId = id(9); return receipt; }; expect((await readPipelineMetadataOutcome(mutable, d)).outcome).toBe('confirmed_success'); expect(d.getPipelineCatalogue).toHaveBeenCalledWith(binding.tenantId); });
});
