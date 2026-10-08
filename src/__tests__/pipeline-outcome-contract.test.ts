import { describe, expect, it } from 'vitest';
import { classifyPipelineObservation } from '../../supabase/functions/_shared/pipeline-metadata-reconciliation';

const binding = { tenantId: 'tenant', actorId: 'actor', threadId: 'thread', intentId: 'intent', operationId: 'operation', scopeEpoch: 'epoch' };
const observation = (kind: string) => ({ binding: { ...binding }, kind, effect: 'none', authoritative: true });
describe('non-settling canonical Pipeline observations', () => {
  it('recognizes a canonical refusal before dispatch', () => {
    expect(classifyPipelineObservation(binding, observation('refused_before_dispatch')).outcome).toBe('refused_before_dispatch');
  });
  it('recognizes authoritative non-application', () => {
    expect(classifyPipelineObservation(binding, observation('failed_not_applied')).outcome).toBe('confirmed_failure');
  });
  it.each(['tenantId', 'actorId', 'threadId', 'intentId', 'operationId', 'scopeEpoch'])('rejects changed %s', key => {
    expect(classifyPipelineObservation(binding, { ...observation('failed_not_applied'), binding: { ...binding, [key]: 'other' } }).outcome).toBe('outcome_unknown');
  });
  it.each([null, {}, { ...observation('failed_not_applied'), authoritative: false }, { ...observation('failed_not_applied'), effect: 'unknown' }, observation('timeout'), observation('success'), { ...observation('failed_not_applied'), conflicting: true }])('keeps insufficient evidence unknown', value => {
    expect(classifyPipelineObservation(binding, value)).toEqual({ outcome: 'outcome_unknown', verified_readback: false });
  });
  it('is immutable and replay-stable, with no executor authority fields', () => {
    const input = observation('refused_before_dispatch'); const before = JSON.stringify(input);
    const result = classifyPipelineObservation(binding, input);
    expect(classifyPipelineObservation(binding, input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.keys(result).sort()).toEqual(['outcome', 'verified_readback']);
  });
});
