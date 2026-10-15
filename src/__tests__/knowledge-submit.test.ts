// @vitest-environment node
import {describe, it, expect, vi} from 'vitest';
import {submitKnowledgePublication} from '../lib/knowledge-service';
const created = {work_id:'work-a', document_id:'doc-a', status:'claimed', replayed:false, revision:3};
const client = (data: unknown, error: {message: string; code?: string} | null = null) =>
  ({rpc: vi.fn().mockResolvedValue({data, error})});
describe('canonical Knowledge publication submission', () => {
  it('binds scope, review identity, frozen revision and intent exactly', async () => {
    const c = client(created);
    expect(await submitKnowledgePublication(c, 'tenant-a', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64)))
      .toEqual(created);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith('submit_tenant_knowledge_publication', {
      p_expected_tenant:'tenant-a', p_doc_id:'doc-a', p_work_id:'extract-work-a',
      p_expected_revision:3, p_intent_id:'intent-a', p_review_hash:'a'.repeat(64)});
  });
  it('refuses missing scope without a request', async () => {
    const c = client(created);
    await expect(submitKnowledgePublication(c, '', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64)))
      .rejects.toThrow('Select a workspace');
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it('returns an exact replay as the same publication', async () => {
    const replay = {...created, replayed:true};
    delete (replay as Partial<typeof created>).revision;
    const c = client(replay);
    const result = await submitKnowledgePublication(c, 'tenant-a', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64));
    expect(result.replayed).toBe(true);
    expect(result.revision).toBeUndefined();
  });
  it.each([
    {document_id:'doc-b'}, {work_id:''}, {status:''}, {replayed:'true'},
    {...created, revision:4},
    {...created, status:'queued'},
  ])('rejects an unverified submission %j', async (override) => {
    await expect(submitKnowledgePublication(client({...created, ...override}), 'tenant-a', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64)))
      .rejects.toThrow('could not be verified');
  });
  it.each(['KNOWLEDGE_PUBLICATION_PENDING','KNOWLEDGE_REVIEW_NOT_READY','KNOWLEDGE_REVISION_CONFLICT','KNOWLEDGE_SCOPE_CHANGED'])(
    'preserves %s without minting another intent', async (code) => {
      const c = client(null, {code, message: code});
      await expect(submitKnowledgePublication(c, 'tenant-a', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64)))
        .rejects.toThrow(code);
      expect(c.rpc).toHaveBeenCalledTimes(1);
    });
  it('preserves an unknown transport outcome without retry', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network'));
    await expect(submitKnowledgePublication({rpc}, 'tenant-a', 'doc-a', 'extract-work-a', 3, 'intent-a', 'a'.repeat(64)))
      .rejects.toThrow('network');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
