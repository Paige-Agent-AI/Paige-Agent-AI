import { describe, expect, it } from 'vitest';
import { classifyTrajectory, correlateTrajectory, type TrajectoryIdentity, type TrajectoryEvidence } from '../../supabase/functions/_shared/trajectory/contract';

const scope: TrajectoryIdentity = { version: 1, workId: 'test-work-1', tenantId: 'test-tenant-1', actorId: 'test-actor-1', threadId: 'test-thread-1', intentId: 'test-intent-1', capabilityKey: 'document_generate', category: 'document_authoring' };
const evidence = (kind: TrajectoryEvidence['kind'], id: string = kind): TrajectoryEvidence => ({ kind, id, workId: scope.workId, tenantId: scope.tenantId, actorId: scope.actorId, threadId: scope.threadId, at: '2026-10-10T00:00:00Z', source: 'canonical', attempt: 1, outcome: kind === 'receipt' ? 'capability_succeeded' : undefined });
describe('INT-280 AI-1 task evidence contract', () => {
  it('requires a supported receipt and readback for a terminal condition', () => {
    expect(classifyTrajectory('succeeded', [evidence('receipt')], 'artifact', 1)).toBe('terminal_unverified');
    expect(classifyTrajectory('succeeded', [evidence('readback')], 'artifact', 1)).toBe('terminal_unverified');
    expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback')], 'artifact', 1)).toBe('artifact_verified');
    expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback')], 'read_only', 1)).toBe('read_verified');
  });
  it('never upgrades model success, provider acceptance or assistant prose to task success', () => {
    const narration = { ...evidence('model'), outcome: 'ok', content: 'Task completed' };
    expect(classifyTrajectory('succeeded', [narration], 'artifact', 1)).toBe('terminal_unverified');
    expect(classifyTrajectory('claimed', [narration, evidence('dispatch')], 'artifact', 1)).toBe('in_progress');
  });
  it.each([['failed','failed'], ['cancelled','cancelled'], ['blocked','blocked'], ['expired','reconciliation_required'], ['outcome_unknown','reconciliation_required']])('preserves %s', (state, expected) => {
    expect(classifyTrajectory(state, [evidence('receipt'), evidence('readback')], 'artifact', 1)).toBe(expected);
  });
  it('does not invent a verified business operation for an unsupported domain', () => {
    expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback')], 'unavailable', 1)).toBe('terminal_unverified');
  });
  it('fails closed on contradictory receipts or unresolved execution', () => {
    expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback'), { ...evidence('receipt', 'failed-receipt'), outcome: 'capability_failed' }], 'artifact', 1)).toBe('conflicting');
    expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback'), { ...evidence('execution'), outcome: 'ambiguous' }], 'artifact', 1)).toBe('terminal_unverified');
  });
  it('refuses stale, unversioned or missing current-attempt evidence', () => {
    const old = [evidence('receipt'), evidence('readback')];
    expect(classifyTrajectory('succeeded', old, 'artifact', 2)).toBe('terminal_unverified');
    expect(classifyTrajectory('succeeded', old, 'artifact', null)).toBe('terminal_unverified');
    expect(classifyTrajectory('succeeded', old.map(e => ({ ...e, attempt: undefined })), 'artifact', 1)).toBe('terminal_unverified');
    expect(classifyTrajectory('succeeded', [...old, ...old.map(e => ({ ...e, attempt: 2 }))], 'artifact', 2)).toBe('artifact_verified');
  });
  it('treats every contradictory current receipt as conflicting, including unreachable and future states', () => {
    for (const outcome of ['capability_unreachable', 'capability_completed_unrecorded', 'unknown_future_state']) {
      expect(classifyTrajectory('succeeded', [evidence('receipt'), evidence('readback'), { ...evidence('receipt', 'contradiction'), outcome }], 'artifact', 1)).toBe('conflicting');
    }
  });
  it('rejects cross-tenant, actor, work and thread links even in the same conversation', () => {
    for (const field of ['tenantId', 'actorId', 'workId', 'threadId'] as const) {
      const result = correlateTrajectory(scope, [evidence('origin'), { ...evidence('receipt'), [field]: 'unrelated' }]);
      expect(result.events).toHaveLength(1); expect(result.rejected).toBe(1);
    }
  });
  it('retains explicit multi-turn and resumed attempt references without timestamp joins', () => {
    const items = [evidence('origin'), evidence('turn', 'turn-2'), { ...evidence('continuation'), attempt: 2 }, evidence('receipt'), evidence('readback')];
    const result = correlateTrajectory(scope, items);
    expect(result.events).toHaveLength(5); expect(result.rejected).toBe(0);
    expect(correlateTrajectory({ ...scope, workId: 'concurrent-work' }, items).events).toEqual([]);
  });
  it('keeps absent legacy links unknown and drops narration and private payload fields', () => {
    const result = correlateTrajectory(scope, [{ ...evidence('model'), source: 'unknown' }, { ...evidence('origin'), content: 'private', args: { secret: 'private' } } as TrajectoryEvidence]);
    expect(result.rejected).toBe(1); expect(result.events[0]).not.toHaveProperty('content'); expect(result.events[0]).not.toHaveProperty('args');
  });
});
