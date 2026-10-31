// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { forgetReviewedPaigeMemory, inspectReviewedPaigeMemory, saveReviewedPaigeMemory } from '../lib/paige-memory-review-service';

const actorId = '10000000-0000-4000-8000-000000000001';
const tenantId = '20000000-0000-4000-8000-000000000001';
const intentId = '30000000-0000-4000-8000-000000000001';
const selection = () => ({ intentId, memoryType: 'decision', content: 'Approved preference', sourceQuote: 'synthetic quote',
  sourceReference: { contractVersion: 1 as const, tenantId, documentId: actorId, revision: 1, contentSha256: 'a'.repeat(64) } });
function stored(sourceState = 'current') {
  const input = selection();
  return { status: 'present', tenant_id: tenantId, source_state: sourceState, eligible_for_context: sourceState === 'current',
    memory: { id: actorId, updated_at: '2026-10-31T01:00:00.123456Z', created_at: '2026-10-31T01:00:00Z', is_active: true,
      content: input.content, memory_type: input.memoryType, source_thread_id: null,
      metadata: { audience: 'owner_personal', confirmation_state: 'confirmed', confirmed_by: actorId,
        confirmed_at: '2026-10-31T01:00:00Z', reviewed_request_sha256: 'b'.repeat(64),
        reviewed_save: { schema_version: 1, expected_actor: actorId, expected_tenant: tenantId, intent_id: intentId,
          source_reference: input.sourceReference, ...(sourceState === 'current' ? { source_quote: input.sourceQuote } : {}) } } } };
}
const scope = () => ({ actorId, tenantId, isCurrent: () => true });
const client = (data: unknown, error: unknown = null) => ({
  getScope: vi.fn(async () => ({ actorId, tenantId })),
  rpc: vi.fn(async () => ({ data, error })),
});
describe('original reviewed Memory inspection', () => {
  it.each(['PGRST202', '42883'])('reports unavailable save contract %s without claiming an uncertain write', async code => {
    const port = client(null, { code });
    await expect(saveReviewedPaigeMemory(port, scope(), selection())).rejects.toMatchObject({
      code: 'UNAVAILABLE', mutationMayHavePersisted: false, intentId,
    });
    expect(port.rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps the captured guard when the caller replaces its scope object guard', async () => {
    let active = true;
    let checks = 0;
    const guarded = { ...scope(), isCurrent: () => {
      if (++checks === 6) queueMicrotask(() => { active = false; guarded.isCurrent = () => true; });
      return active;
    } };
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    await expect(inspectReviewedPaigeMemory(port, guarded, intentId)).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
  });
  it('canonicalizes document and optional thread IDs before the selected save', async () => {
    const canonical = 'abcdef00-0000-4000-8000-000000000001';
    const input = { ...selection(), sourceThreadId: canonical.toUpperCase() };
    input.sourceReference.documentId = canonical.toUpperCase();
    const row = stored();
    Object.assign(row.memory, { source_thread_id: canonical });
    row.memory.metadata.reviewed_save.source_reference.documentId = canonical;
    const port = client(row);
    port.rpc.mockImplementationOnce(async () => ({ data: actorId, error: null }));
    await saveReviewedPaigeMemory(port, scope(), input);
    expect(port.rpc).toHaveBeenNthCalledWith(1, 'record_paige_memory', expect.objectContaining({
      p_source_thread_id: canonical, p_review: expect.objectContaining({ source_reference: expect.objectContaining({ documentId: canonical }) }),
    }));
  });
  it('rejects an array masquerading as a source status', async () => {
    const row = stored('changed');
    Object.assign(row, { source_state: ['changed'] });
    await expect(inspectReviewedPaigeMemory(client(row), scope(), intentId)).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
  it('rejects an array masquerading as a removal effect', async () => {
    const port = client({ status: 'retired', memory_id: actorId, verified_readback: true, replayed: false, effect: ['retired_now'] });
    await expect(forgetReviewedPaigeMemory(port, scope(), { memoryId: actorId, updatedAt: '2026-10-31T01:00:00Z' }))
      .rejects.toMatchObject({ code: 'FORGET_UNKNOWN' });
  });
  it('normalizes a UUID with letters before native lookup', async () => {
    const mixedIntent = 'ABCDEF00-0000-4000-8000-000000000001';
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    await inspectReviewedPaigeMemory(port, scope(), mixedIntent);
    expect(port.rpc).toHaveBeenCalledWith('get_paige_memory', expect.objectContaining({ p_review: expect.objectContaining({ intent_id: mixedIntent.toLowerCase() }) }));
  });
  it('checks the continuation after final scope resolution', async () => {
    let active = true;
    let reads = 0;
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    const guarded = { ...scope(), isCurrent: () => active };
    port.getScope.mockImplementation(async () => {
      if (++reads === 2) queueMicrotask(() => queueMicrotask(() => { active = false; }));
      return { actorId, tenantId };
    });
    await expect(inspectReviewedPaigeMemory(port, guarded, intentId)).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
  });
  it.each(['retired_now', 'already_retired'])('verifies logical removal and preserves native effect %s', async effect => {
    const row = { status: 'retired', tenant_id: tenantId, eligible_for_context: false,
      memory: { id: actorId, updated_at: '2026-10-31T01:00:00.123456Z', content: null, is_active: false,
        metadata: { confirmation_state: 'retired' } } };
    const port = client(row);
    port.rpc.mockImplementationOnce(async () => ({ data: { status: 'retired', memory_id: actorId,
      verified_readback: true, replayed: false, effect }, error: null }));
    await expect(forgetReviewedPaigeMemory(port, scope(), { memoryId: actorId, updatedAt: '2026-10-31T01:00:00.123456Z' }))
      .resolves.toEqual({ status: 'retired', memoryId: actorId, effect, replayed: false });
    expect(port.rpc).toHaveBeenNthCalledWith(1, 'forget_paige_memory', expect.objectContaining({ p_review: expect.objectContaining({ expected_updated_at: '2026-10-31T01:00:00.123456Z' }) }));
    expect(port.rpc).toHaveBeenNthCalledWith(2, 'get_paige_memory', expect.objectContaining({ p_review: expect.objectContaining({ memory_id: actorId }) }));
  });
  it('does not call absence proof of successful removal', async () => {
    const port = client({ status: 'absent', memory_id: actorId, verified_readback: true, replayed: false });
    await expect(forgetReviewedPaigeMemory(port, scope(), { memoryId: actorId, updatedAt: '2026-10-31T01:00:00Z' }))
      .rejects.toMatchObject({ code: 'FORGET_UNKNOWN', mutationMayHavePersisted: true });
    expect(port.rpc).toHaveBeenCalledTimes(1);
  });
  it('verifies a selected save against the authoritative original row', async () => {
    const port = client(stored());
    port.rpc.mockImplementationOnce(async () => ({ data: actorId, error: null }));
    await expect(saveReviewedPaigeMemory(port, scope(), selection())).resolves.toMatchObject({
      status: 'present', memoryId: actorId, eligibleForContext: true, updatedAt: '2026-10-31T01:00:00.123456Z',
    });
    expect(port.rpc).toHaveBeenCalledTimes(2);
  });
  it('keeps stale persistence separate from permission to use it as current context', async () => {
    const port = client(stored('changed'));
    await expect(inspectReviewedPaigeMemory(port, scope(), intentId)).resolves.toMatchObject({ sourceState: 'changed', eligibleForContext: false });
  });
  it('refuses a proposed row even when its source is current', async () => {
    const row = stored();
    row.memory.metadata.confirmation_state = 'proposed';
    await expect(inspectReviewedPaigeMemory(client(row), scope(), intentId)).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
  it('refuses a quote leaked after source access is unavailable', async () => {
    const row = stored('unavailable');
    Object.assign(row.memory.metadata.reviewed_save, { source_quote: 'synthetic quote' });
    await expect(inspectReviewedPaigeMemory(client(row), scope(), intentId)).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
  it('snapshots the selected content before scope resolution awaits', async () => {
    const input = selection();
    const port = client(stored());
    port.getScope.mockImplementationOnce(async () => { input.content = 'Changed after click'; return { actorId, tenantId }; });
    port.rpc.mockImplementationOnce(async () => ({ data: actorId, error: null }));
    await saveReviewedPaigeMemory(port, scope(), input);
    expect(port.rpc).toHaveBeenNthCalledWith(1, 'record_paige_memory', expect.objectContaining({ p_content: 'Approved preference' }));
  });
  it('reports absence only at this read and never writes or falls back', async () => {
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    await expect(inspectReviewedPaigeMemory(port, scope(), intentId)).resolves.toEqual({ status: 'absent_at_read' });
    expect(port.rpc).toHaveBeenCalledExactlyOnceWith('get_paige_memory', {
      p_memory_types: null, p_limit: 1, p_user_id: null, p_tenant_id: null,
      p_review: { schema_version: 1, expected_actor: actorId, expected_tenant: tenantId, intent_id: intentId },
    });
  });
  it('withholds a late response after workspace departure and return', async () => {
    let current = true;
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    port.rpc.mockImplementationOnce(async () => {
      current = false; // Original incarnation remains retired after A→B→A.
      return { data: { status: 'absent', tenant_id: tenantId, eligible_for_context: false }, error: null };
    });
    await expect(inspectReviewedPaigeMemory(port, { ...scope(), isCurrent: () => current }, intentId)).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
  });
  it('does not use the old read API when the reviewed overload is unavailable', async () => {
    const port = client(null, { code: 'PGRST202' });
    await expect(inspectReviewedPaigeMemory(port, scope(), intentId)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(port.rpc).toHaveBeenCalledTimes(1);
  });
  it('refuses other-tenant content', async () => {
    const port = client({ status: 'absent', tenant_id: actorId, eligible_for_context: false });
    await expect(inspectReviewedPaigeMemory(port, scope(), intentId)).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
  it('does not mistake a save UUID for confirmed storage', async () => {
    const port = client({ status: 'absent', tenant_id: tenantId, eligible_for_context: false });
    port.rpc.mockImplementationOnce(async () => ({ data: actorId, error: null }));
    await expect(saveReviewedPaigeMemory(port, scope(), {
      intentId, memoryType: 'decision', content: 'Approved preference', sourceQuote: 'synthetic quote',
      sourceReference: { contractVersion: 1, tenantId, documentId: actorId, revision: 1, contentSha256: 'a'.repeat(64) },
    })).rejects.toMatchObject({ code: 'READBACK_MISMATCH', mutationMayHavePersisted: true, intentId });
    expect(port.rpc.mock.calls.map(call => call[0])).toEqual(['record_paige_memory', 'get_paige_memory']);
  });
  it('keeps the original intent and never repeats an uncertain save', async () => {
    const port = client(null);
    port.rpc.mockRejectedValueOnce(new Error('connection lost'));
    await expect(saveReviewedPaigeMemory(port, scope(), {
      intentId, memoryType: 'decision', content: 'Approved preference', sourceQuote: 'synthetic quote',
      sourceReference: { contractVersion: 1, tenantId, documentId: actorId, revision: 1, contentSha256: 'a'.repeat(64) },
    })).rejects.toMatchObject({ code: 'SAVE_UNKNOWN', mutationMayHavePersisted: true, intentId });
    expect(port.rpc).toHaveBeenCalledTimes(1);
  });
});
