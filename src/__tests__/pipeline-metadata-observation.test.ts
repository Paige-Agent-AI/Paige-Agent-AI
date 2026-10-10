// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readPipelineNonApplicationOutcome, type PipelineObservationDependencies } from '../../supabase/functions/_shared/pipeline-metadata-observation';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = { threadId: id(1), intentId: id(2), effectId: id(3), tenantId: id(4), actorId: id(5) };
const evidence = {
  authoritative: true, effect: 'none', conflicting: false, kind: 'failed_not_applied',
  binding: { tenantId: binding.tenantId, actorId: binding.actorId, threadId: binding.threadId, intentId: binding.intentId, operationId: binding.effectId, scopeEpoch: id(6) },
};
function deps(evidenceValue: unknown = evidence): PipelineObservationDependencies {
  return { scopeHolds: vi.fn(async () => true), resolveObservation: vi.fn(async () => evidenceValue) };
}
describe('read-only non-application observation adapter', () => {
  it('classifies a lineage-matching record as a confirmed failure without applying anything', async () => {
    const d = deps();
    const result = await readPipelineNonApplicationOutcome(binding, d);
    expect(result).toEqual({ outcome: 'confirmed_failure', verified_readback: true });
    expect(d.resolveObservation).toHaveBeenCalledOnce();
  });
  it('passes a future refused_before_dispatch record through as its own outcome', async () => {
    const refused = structuredClone(evidence); refused.kind = 'refused_before_dispatch';
    expect((await readPipelineNonApplicationOutcome(binding, deps(refused))).outcome).toBe('refused_before_dispatch');
  });
  it('stays unknown when no record exists', async () => {
    expect((await readPipelineNonApplicationOutcome(binding, deps(null))).outcome).toBe('outcome_unknown');
  });
  it.each([0, 1])('fails closed when scope changes at check %s', async n => {
    const d = deps(); let checks = 0; d.scopeHolds = vi.fn(async () => checks++ !== n);
    expect((await readPipelineNonApplicationOutcome(binding, d)).outcome).toBe('outcome_unknown');
  });
  it('refuses evidence whose binding names another actor', async () => {
    const drifted = structuredClone(evidence); (drifted.binding as Record<string, unknown>).actorId = id(9);
    expect((await readPipelineNonApplicationOutcome(binding, deps(drifted))).outcome).toBe('outcome_unknown');
  });
  it.each([
    ['not authoritative', { authoritative: false }],
    ['an applied effect', { effect: 'applied' }],
    ['conflicting evidence', { conflicting: true }],
    ['an unnamed kind', { kind: 'maybe' }],
  ])('refuses %s', async (_label, patch) => {
    const bad = Object.assign(structuredClone(evidence), patch);
    expect((await readPipelineNonApplicationOutcome(binding, deps(bad))).outcome).toBe('outcome_unknown');
  });
  it.each([
    ['null evidence', null],
    ['array evidence', [evidence]],
    ['evidence without a binding', { authoritative: true, effect: 'none', conflicting: false, kind: 'failed_not_applied' }],
    ['binding without a scope epoch', () => { const e = structuredClone(evidence); delete (e.binding as Record<string, unknown>).scopeEpoch; return e; }],
    ['non-string scope epoch', () => { const e = structuredClone(evidence); (e.binding as Record<string, unknown>).scopeEpoch = 7; return e; }],
  ])('stays unknown on %s', async (_label, value) => {
    const bad = typeof value === 'function' ? (value as () => unknown)() : value;
    expect((await readPipelineNonApplicationOutcome(binding, deps(bad))).outcome).toBe('outcome_unknown');
  });
  it('rejects non-UUID binding fields before any read', async () => {
    const d = deps();
    expect((await readPipelineNonApplicationOutcome({ ...binding, tenantId: 'not-a-uuid' }, d)).outcome).toBe('outcome_unknown');
    expect(d.resolveObservation).not.toHaveBeenCalled();
  });
  it('contains reader failures as unknown', async () => {
    const d = deps(); d.resolveObservation = vi.fn(async () => { throw Error('PIPELINE_OBSERVATION_READ_UNAVAILABLE'); });
    expect((await readPipelineNonApplicationOutcome(binding, d)).outcome).toBe('outcome_unknown');
  });
  it('keeps the caller binding frozen across the awaited read', async () => {
    const d = deps(); const mutable = { ...binding };
    d.resolveObservation = async () => { mutable.tenantId = id(9); return structuredClone(evidence); };
    expect((await readPipelineNonApplicationOutcome(mutable, d)).outcome).toBe('confirmed_failure');
  });
});
