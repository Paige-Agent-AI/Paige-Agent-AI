// @vitest-environment node
import {describe, it, expect, vi} from 'vitest';
import {deleteKnowledge} from '../lib/knowledge-service';
const result = {tenant_id:'tenant-a', document_id:'doc-a', deleted_revision:3,
  document_absent:true, chunks_absent:true, run_id:'run-a', outcome:'capability_succeeded',
  source_cleanup:{status:'not_attempted', reason:'canonical_source_binding_unavailable'}};
const client = (data: unknown) => ({rpc:vi.fn().mockResolvedValue({data,error:null})});
describe('canonical Knowledge deletion', () => {
  it('binds identity and revision and preserves source cleanup boundary', async () => {
    const c=client(result);
    expect(await deleteKnowledge(c,'tenant-a','doc-a',3)).toEqual(result);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith('delete_tenant_knowledge', {
      p_expected_tenant:'tenant-a',p_doc_id:'doc-a',p_expected_revision:3});
  });
  it('refuses missing scope without a request', async () => {
    const c=client(result); await expect(deleteKnowledge(c,'','doc-a',3)).rejects.toThrow('Select a workspace');
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {tenant_id:'tenant-b'}, {document_id:'doc-b'}, {deleted_revision:4},
    {document_absent:false}, {chunks_absent:false}, {outcome:'already_deleted'}, {run_id:''},
    {source_cleanup:{status:'deleted',reason:'canonical_source_binding_unavailable'}},
  ])('rejects an unverified deletion %j', async (override) => {
    await expect(deleteKnowledge(client({...result,...override}),'tenant-a','doc-a',3)).rejects.toThrow();
  });
  it('accepts a bound canonical source retained by policy', async () => {
    const c=client({...result,source_cleanup:{status:'not_attempted',reason:'retained_by_policy'}});
    expect((await deleteKnowledge(c,'tenant-a','doc-a',3)).source_cleanup.reason).toBe('retained_by_policy');
  });
  it('returns completed-unrecorded without retrying', async () => {
    const c=client({...result,outcome:'capability_completed_unrecorded'});
    expect((await deleteKnowledge(c,'tenant-a','doc-a',3)).outcome).toBe('capability_completed_unrecorded');
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['KNOWLEDGE_NOT_FOUND','KNOWLEDGE_REVISION_CONFLICT'])('preserves %s without retry', async message => {
    const c={rpc:vi.fn().mockResolvedValue({data:null,error:{code:'P0002',message}})};
    await expect(deleteKnowledge(c,'tenant-a','doc-a',3)).rejects.toThrow(message);
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves unknown transport outcome without retry', async () => {
    const c={rpc:vi.fn().mockRejectedValue(new Error('lost acknowledgement'))};
    await expect(deleteKnowledge(c,'tenant-a','doc-a',3)).rejects.toThrow('lost acknowledgement');
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
});
