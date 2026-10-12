import { describe, expect, it } from 'vitest';
import { projectDurableContinuation } from '../../supabase/functions/_shared/durable-job/continuation';

export const fixture = () => ({
  work: { id: 'work', tenant_id: 'test-tenant-a', initiating_user_id: 'actor', thread_id: 'thread', intent_id: 'intent', scope_epoch: 'epoch', capability_key: 'documents.generate', work_kind: 'document', status: 'succeeded', settled_at: '2026-10-08T12:00:00Z', lease_until: null, terminal_outcome: { verified_readback: true }, error_code: null },
  binding: { workId: 'work', tenantId: 'test-tenant-a', actorId: 'actor', threadId: 'thread', intentId: 'intent', scopeEpoch: 'epoch', capabilityKey: 'documents.generate', workKind: 'document', originalObjective: 'Prepare the original document' },
  canonicalObjective: 'Prepare the original document',
  context: { authorized: true, budgetAllowed: true, capabilityAvailable: true, approvalPending: false, interrupted: false, superseded: false, alreadyContinued: false },
  now: '2026-10-08T13:00:00Z',
});
describe('read-only durable continuation foundation', () => {
  it('projects canonical verified success without dispatch authority or raw evidence', () => {
    const input = fixture(); const before = JSON.stringify(input);
    expect(projectDurableContinuation(input)).toEqual({ eligibleForContext: true, state: 'succeeded', reason: 'canonical_terminal', workId: 'work' });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(['id','tenant_id','initiating_user_id','thread_id','intent_id','scope_epoch','capability_key','work_kind'])('refuses changed %s binding', key => {
    const input = fixture(); (input.work as Record<string, unknown>)[key] = 'changed';
    expect(projectDurableContinuation(input).eligibleForContext).toBe(false);
  });
  it('pins the original objective and refuses absent canonical readback', () => {
    const input = fixture(); input.canonicalObjective = 'A substituted objective';
    expect(projectDurableContinuation(input).reason).toBe('binding_mismatch');
    expect(projectDurableContinuation({ ...fixture(), work: null }).reason).toBe('canonical_unavailable');
  });
  it.each(['authorized','budgetAllowed','capabilityAvailable'])('revalidates %s', key => {
    const input = fixture(); (input.context as Record<string, unknown>)[key] = false;
    expect(projectDurableContinuation(input).eligibleForContext).toBe(false);
  });
  it.each(['approvalPending','interrupted','superseded','alreadyContinued'])('denies %s context', key => {
    const input = fixture(); (input.context as Record<string, unknown>)[key] = true;
    expect(projectDurableContinuation(input).eligibleForContext).toBe(false);
  });
  it.each(['claimed','blocked','cancelled','expired','outcome_unknown','invented'])('never treats %s as completed work', status => {
    expect(projectDurableContinuation({ ...fixture(), work: { ...fixture().work, status } }).eligibleForContext).toBe(false);
  });
  it('denies success without verified terminal readback, settlement or valid time', () => {
    for (const work of [{ ...fixture().work, terminal_outcome: {} }, { ...fixture().work, settled_at: null }, { ...fixture().work, settled_at: 'bad' }, { ...fixture().work, settled_at: '2027-01-01T00:00:00Z' }]) expect(projectDurableContinuation({ ...fixture(), work }).eligibleForContext).toBe(false);
  });
  it('projects settled canonical failure as failure, never success', () => {
    expect(projectDurableContinuation({ ...fixture(), work: { ...fixture().work, status: 'failed', error_code: 'generation_failed', terminal_outcome: { safe_error: 'generation_failed' } } })).toMatchObject({ eligibleForContext: true, state: 'failed' });
  });
  it('refuses partial or malformed revalidation rather than relying on truthiness', () => {
    expect(projectDurableContinuation({ ...fixture(), context: {} } as never).eligibleForContext).toBe(false);
    expect(projectDurableContinuation({ ...fixture(), now: 'invalid' }).eligibleForContext).toBe(false);
  });
});
