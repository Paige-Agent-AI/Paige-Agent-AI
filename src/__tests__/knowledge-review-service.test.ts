// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {saveKnowledgeReview, readKnowledgePublicationStatus, sha256Hex, KnowledgeReviewServiceError} from '../lib/knowledge-review-service';

const saved = {tenant_id:'tenant-a', document_id:'doc-a', work_id:'work-a', verified_readback:true,
  revision:3, outcome:'capability_succeeded', run_id:'run-a', operation:'review_saved'};
const client = (data: unknown, error: {message: string; code?: string} | null = null) =>
  ({rpc: vi.fn().mockResolvedValue({data, error})});
const work = (status: string, extra: Record<string, unknown> = {}) => [{work_id:'pub-work', capability_key:'knowledge.publish',
  work_kind:'knowledge_publish', work_status:status, blocked_reason:null, error_code:null, ...extra}];

describe('governed review save', () => {
  it('binds scope, document, work and the exact next revision', async () => {
    const c = client(saved);
    expect(await saveKnowledgeReview(c, 'tenant-a', 'doc-a', 'work-a', 2, 'Reviewed text', {title:'Reviewed', summary:null, category:null, tags:[]})).toEqual({revision:3, outcome:'capability_succeeded', runId:'run-a'});
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith('save_tenant_knowledge_review', {
      p_expected_tenant:'tenant-a', p_doc_id:'doc-a', p_work_id:'work-a',
      p_expected_revision:2, p_content:'Reviewed text', p_metadata:{title:'Reviewed', summary:null, category:null, tags:[]}});
  });
  it('refuses missing scope without a request', async () => {
    const c = client(saved);
    await expect(saveKnowledgeReview(c, '', 'doc-a', 'work-a', 2, 'x', {title:'T', summary:null, category:null, tags:[]})).rejects.toThrow('Select a workspace');
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {tenant_id:'tenant-b'}, {document_id:'doc-b'}, {work_id:'work-b'}, {revision:4},
    {verified_readback:false}, {outcome:'already_saved'}, {run_id:''},
  ])('rejects an unverified save %j', async (override) => {
    await expect(saveKnowledgeReview(client({...saved, ...override}), 'tenant-a', 'doc-a', 'work-a', 2, 'x', {title:'T', summary:null, category:null, tags:[]})).rejects.toThrow('could not be verified');
  });
  it('preserves refusal codes without retry', async () => {
    const c = client(null, {code:'40001', message:'KNOWLEDGE_REVIEW_CONFLICT'});
    await expect(saveKnowledgeReview(c, 'tenant-a', 'doc-a', 'work-a', 2, 'x', {title:'T', summary:null, category:null, tags:[]})).rejects.toThrow('KNOWLEDGE_REVIEW_CONFLICT');
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it('carries an unrecorded receipt without hiding it', async () => {
    const result = await saveKnowledgeReview(client({...saved, outcome:'capability_completed_unrecorded'}), 'tenant-a', 'doc-a', 'work-a', 2, 'x', {title:'T', summary:null, category:null, tags:[]});
    expect(result.outcome).toBe('capability_completed_unrecorded');
  });
});

describe('publication status classification', () => {
  it.each([
    ['succeeded', {phase:'resolved', status:'succeeded'}],
    ['failed', {phase:'resolved', status:'failed', errorCode:'embedding_failed'}],
    ['blocked', {phase:'paused', status:'blocked', reason:null}],
    ['outcome_unknown', {phase:'reconcile', status:'outcome_unknown', errorCode:'completion_unknown'}],
    ['claimed', {phase:'working', status:'claimed'}],
    ['expired', {phase:'working', status:'expired'}],
  ])('classifies %s truthfully', async (status, expected) => {
    const extra = 'errorCode' in expected ? {error_code: expected.errorCode} : 'reason' in expected ? {} : {};
    expect(await readKnowledgePublicationStatus(client(work(status, extra)), 'pub-work')).toEqual(expected);
  });
  it('refuses a foreign work row', async () => {
    await expect(readKnowledgePublicationStatus(client([{...work('succeeded')[0], work_kind:'knowledge_extract'}]), 'pub-work')).rejects.toThrow(KnowledgeReviewServiceError);
    await expect(readKnowledgePublicationStatus(client([]), 'pub-work')).rejects.toThrow('could not be read');
    await expect(readKnowledgePublicationStatus(client(null, {message:'denied'}), 'pub-work')).rejects.toThrow('denied');
  });
});

describe('review hash', () => {
  it('digests the exact text', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((await sha256Hex('Reviewed publication text')).length).toBe(64);
  });
});
