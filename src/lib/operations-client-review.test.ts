import { describe, expect, it } from 'vitest';
import { readClientDeliveryArtifact } from './operations-client-review';

describe('explicit client artifact readback', () => {
  const row = { actor_id: 'client-a', tenant_id: 'tenant-a', release_id: 'release-a', submission_id: 'submission-a',
    state: 'awaiting_client', revision_no: 1, artifact_digest: 'a'.repeat(64), title: 'Delivery brief', body: 'Review this exact version', updated_at: '2026-10-11T20:00:00Z' };
  const scope = { actorId: 'client-a', tenantId: 'tenant-a', releaseId: 'release-a' };
  it('reads the exact released content and strips internal fields', () => {
    const result = readClientDeliveryArtifact({ ...row, internal_note: 'private', provider: 'private', snapshot: { brief: 'private' } }, scope);
    expect(result?.body).toBe(row.body);
    expect(result).not.toHaveProperty('snapshot');
    expect(result).not.toHaveProperty('internal_note');
    expect(result).not.toHaveProperty('provider');
  });
  it.each(['actor_id', 'tenant_id', 'release_id'])('masks late foreign %s readback', key => {
    expect(readClientDeliveryArtifact({ ...row, [key]: 'foreign' }, scope)).toBeNull();
  });
  it.each(['approved', 'done', 'signed', 'paid', 'in_review'])('never treats %s as a released client artifact', state => {
    expect(readClientDeliveryArtifact({ ...row, state }, scope)).toBeNull();
  });
  it('refuses absent or malformed content rather than an acceptance placeholder', () => {
    expect(readClientDeliveryArtifact({ ...row, body: null }, scope)).toBeNull();
    expect(readClientDeliveryArtifact({ ...row, artifact_digest: 'changed' }, scope)).toBeNull();
  });
  it.each([['accepted'], { state: 'accepted' }])('refuses non-string decision values', state => {
    expect(readClientDeliveryArtifact({ ...row, state }, scope)).toBeNull();
  });
});
