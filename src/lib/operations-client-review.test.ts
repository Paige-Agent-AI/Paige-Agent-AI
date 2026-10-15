import { describe, expect, it, vi } from 'vitest';
import { decideClientDelivery, readClientDeliveryArtifact, type ClientDeliveryCaller } from './operations-client-review';

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
  it.each([{ decision_by: row.actor_id }, { decision_at: row.updated_at }, { client_note: 'Undecided note' }])('never invents a decision for an awaiting release %j', changed => {
    expect(readClientDeliveryArtifact({ ...row, ...changed }, scope)).toBeNull();
  });
  it('retains compatibility with an awaiting legacy projection only', () => {
    expect(readClientDeliveryArtifact(row, scope)).toMatchObject({ decisionBy: null, decisionAt: null, clientNote: null });
    expect(readClientDeliveryArtifact({ ...row, state: 'accepted' }, scope)).toBeNull();
  });
});

describe('canonical client decision and independent readback', () => {
  const row = { actor_id: 'client-a', tenant_id: 'tenant-a', release_id: 'release-a', submission_id: 'submission-a',
    state: 'awaiting_client', revision_no: 1, artifact_digest: 'a'.repeat(64), title: 'Brief', body: 'Exact submitted version', updated_at: '2026-10-11T20:00:00Z' };
  const original = readClientDeliveryArtifact(row, { actorId: 'client-a', tenantId: 'tenant-a', releaseId: 'release-a' })!;
  const accepted = { ...row, state: 'accepted', updated_at: '2026-10-11T21:00:00Z',
    decision_by: row.actor_id, decision_at: '2026-10-11T21:00:00.123456Z', client_note: null };
  const port = (...responses: Array<{ data: unknown; error: unknown }>) => {
    const rpc = vi.fn(); responses.forEach(response => rpc.mockResolvedValueOnce(response));
    return { caller: { rpc } as ClientDeliveryCaller, rpc };
  };
  it('requires independent durable readback of the exact client version', async () => {
    const { caller, rpc } = port({ data: { ...accepted, client_note: 'Meets the promise' }, error: null }, { data: { ...accepted, client_note: 'Meets the promise' }, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', 'Meets the promise', () => true)).kind).toBe('verified');
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['operations_delivery_client_decide_scoped', 'operations_delivery_client_read_scoped']);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_actor_id: 'client-a', p_expected_tenant_id: 'tenant-a', p_expected_updated_at: original.updatedAt });
  });
  it('never reports the attempt as verified when readback fails', async () => {
    const { caller, rpc } = port({ data: accepted, error: null }, { data: null, error: { code: '42501' } });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([{ tenant_id: 'foreign' }, { submission_id: 'different' }, { revision_no: 2 }, { artifact_digest: 'b'.repeat(64) }, { body: 'Changed version' }])('refuses changed source or identity readback %j', async changed => {
    const { caller } = port({ data: accepted, error: null }, { data: { ...accepted, ...changed }, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
  });
  it('masks a response after workspace or actor changes', async () => {
    let current = true;
    const rpc = vi.fn(async () => { current = false; return { data: accepted, error: null }; });
    expect((await decideClientDelivery({ rpc }, original, 'accepted', null, () => current)).kind).toBe('scope_changed');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('does not execute an invalid undocumented revision request', async () => {
    const { caller, rpc } = port();
    expect((await decideClientDelivery(caller, original, 'client_revision_requested', ' ', () => true)).kind).toBe('invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('never retries an unknown execution outcome', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('Unknown transport result'));
    expect((await decideClientDelivery({ rpc }, original, 'accepted', null, () => true)).kind).toBe('unverified');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves a real stale or authorization refusal', async () => {
    const { caller } = port({ data: null, error: { code: '40001' } });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('refused');
  });
  it('does not reinterpret a malformed code as definite refusal', async () => {
    const { caller } = port({ data: null, error: { code: ['42501'] } });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
  });
  it.each([
    { client_note: 'A different decision note' },
    { client_note: null },
    { decision_by: 'a-different-client' },
    { decision_at: null },
    { decision_at: 'not-a-timestamp' },
  ])('does not verify a mismatched recorded decision %j', async changed => {
    const decision = { ...accepted, client_note: 'Meets the promise', decision_by: row.actor_id,
      decision_at: '2026-10-11T21:00:00.123456Z' };
    const { caller } = port({ data: decision, error: null }, { data: { ...decision, ...changed }, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', 'Meets the promise', () => true)).kind).toBe('unverified');
  });
  it('preserves the exact recorded client note and sub-millisecond decision time', async () => {
    const decision = { ...accepted, client_note: 'Meets the promise', decision_by: row.actor_id,
      decision_at: '2026-10-11T21:00:00.123456Z' };
    const { caller, rpc } = port({ data: decision, error: null }, { data: decision, error: null });
    const result = await decideClientDelivery(caller, original, 'accepted', '  Meets the promise  ', () => true);
    expect(result).toMatchObject({ kind: 'verified', artifact: {
      clientNote: 'Meets the promise', decisionBy: row.actor_id, decisionAt: decision.decision_at,
    } });
    expect(rpc.mock.calls[0][1]).toHaveProperty('p_note', 'Meets the promise');
  });
  it('refuses acknowledgement/readback decision-time drift without replay', async () => {
    const decision = { ...accepted, client_note: null, decision_by: row.actor_id,
      decision_at: '2026-10-11T21:00:00.123456Z' };
    const { caller, rpc } = port({ data: decision, error: null }, { data: {
      ...decision, decision_at: '2026-10-11T21:00:00.123457Z',
    }, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('refuses acknowledgement/readback raw-version drift without replay', async () => {
    const decision = { ...accepted, client_note: null, decision_by: row.actor_id,
      decision_at: '2026-10-11T21:00:00.123456Z', updated_at: '2026-10-11T21:00:00.123456Z' };
    const { caller, rpc } = port({ data: decision, error: null }, { data: {
      ...decision, updated_at: '2026-10-11T21:00:00.123457Z',
    }, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('never equates an omitted note with a recorded null note', async () => {
    const { client_note: _omitted, ...missingNote } = accepted;
    const { caller, rpc } = port({ data: missingNote, error: null });
    expect((await decideClientDelivery(caller, original, 'accepted', null, () => true)).kind).toBe('unverified');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
