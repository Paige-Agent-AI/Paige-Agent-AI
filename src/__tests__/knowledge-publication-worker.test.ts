import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The worker module imports the shared embed gateway; replace it wholesale so no network
// egress is possible and each test controls the provider deterministically.
vi.mock('../../supabase/functions/_shared/kb-ingest-core.ts', () => ({
  embed: vi.fn(),
}));
const corePath = '../../supabase/functions/_shared/kb-ingest-core.ts';
const { embed } = await import(/* @vite-ignore */ corePath);
// Computed dynamic import keeps the Deno/remote-import graph (voyage.ts et al.) out of the
// browser TS project — the established pattern from the extraction-worker test.
const workerPath = '../../supabase/functions/_shared/knowledge-publication-worker.ts';
const { runKnowledgePublication } = await import(/* @vite-ignore */ workerPath);

const WORK = '70000000-0000-0000-0000-000000000031';
const KEY = 'server-key-1';
const CHUNKS = [
  { index: 0, text: 'Reviewed '.repeat(40), sha256: 'a'.repeat(64) },
  { index: 1, text: 'Publication '.repeat(40), sha256: 'b'.repeat(64) },
];
const START = { status: 'claimed', work_id: WORK, server_key: KEY, attempt: 1, revision: 3, model: 'voyage-3', dimensions: 1024, chunks: CHUNKS };
const VECTOR = Array.from({ length: 1024 }, (_, i) => ((i % 7) + 1) / 8);

type Call = { name: string; args: Record<string, unknown> };
function port(script: (name: string, args: Record<string, unknown>) => unknown, log: Call[]) {
  return { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    log.push({ name, args });
    const data = script(name, args);
    return data instanceof Error ? { data: null, error: { message: data.message, code: 'XX000' } } : { data, error: null };
  }) };
}

beforeEach(() => { vi.mocked(embed).mockReset().mockResolvedValue(VECTOR); });
afterEach(() => vi.clearAllMocks());

describe('native Knowledge publication worker', () => {
  it('drives start → per-chunk embed → stage → complete in order with exact args', async () => {
    const log: Call[] = [];
    const admin = port((name, args) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return { staged: 2, total_expected: 2 };
      if (name === 'complete_knowledge_publication') return { verified_readback: true, phase: 'published', outcome: 'capability_succeeded', document_id: 'd', revision: 3 };
      return null;
    }, log);
    const result = await runKnowledgePublication(admin, WORK);
    expect(result).toMatchObject({ ok: true, status: 'succeeded', phase: 'published' });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed).toHaveBeenCalledWith(CHUNKS[0].text);
    expect(log.map((c) => c.name)).toEqual(['start_knowledge_publication', 'stage_knowledge_publication', 'complete_knowledge_publication']);
    expect(log[1].args).toMatchObject({ _work_id: WORK, _server_key: KEY, _attempt: 1, _revision: 3 });
    expect((log[1].args._chunks as Array<{ index: number; sha256: string; embedding: number[] }>).map((c) => [c.index, c.sha256])).toEqual([[0, 'a'.repeat(64)], [1, 'b'.repeat(64)]]);
    expect(log[2].args).toMatchObject({ _work_id: WORK, _server_key: KEY, _attempt: 1, _revision: 3 });
  });

  it('blocked work never embeds', async () => {
    const log: Call[] = [];
    const admin = port((name) => name === 'start_knowledge_publication' ? { status: 'blocked', work_id: WORK } : null, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'blocked' });
    expect(embed).not.toHaveBeenCalled();
    expect(log).toHaveLength(1);
  });

  it('malformed start refuses before any egress', async () => {
    const log: Call[] = [];
    const admin = port(() => ({ status: 'claimed' }), log);
    await expect(runKnowledgePublication(admin, WORK)).rejects.toThrow('input_invalid');
    expect(embed).not.toHaveBeenCalled();
  });

  it('provider failure before staging settles failed with embedding_failed, no completion call', async () => {
    vi.mocked(embed).mockRejectedValue(new Error('embed 503: upstream'));
    const log: Call[] = [];
    const admin = port((name) => name === 'start_knowledge_publication' ? { ...START } : { settled: true }, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'failed', error_code: 'embedding_failed' });
    expect(log.some((c) => c.name === 'stage_knowledge_publication')).toBe(false);
    expect(log.some((c) => c.name === 'complete_knowledge_publication')).toBe(false);
    expect(log[log.length - 1]).toMatchObject({ name: 'settle_knowledge_publication_failure', args: { _code: 'embedding_failed', _unknown: false } });
  });

  it('invalid embedding vector settles failed deterministically', async () => {
    // Vector validation is the shared gateway's job; the worker only sees its throw.
    vi.mocked(embed).mockRejectedValue(new Error('invalid_embedding'));
    const log: Call[] = [];
    const admin = port((name) => name === 'start_knowledge_publication' ? { ...START } : { settled: true }, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'failed', error_code: 'embedding_failed' });
  });

  it('stage count mismatch settles stage_incomplete without completion', async () => {
    const log: Call[] = [];
    const admin = port((name) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return { staged: 2, total_expected: 5 };
      return null;
    }, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'failed', error_code: 'stage_incomplete' });
    expect(log.some((c) => c.name === 'complete_knowledge_publication')).toBe(false);
  });

  it('SQL refusal at stage is deterministic, not unknown', async () => {
    const log: Call[] = [];
    const admin = port((name) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return new Error('KNOWLEDGE_STAGE_INVALID');
      return null;
    }, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'failed', error_code: 'stage_invalid' });
    expect(log[log.length - 1].args).toMatchObject({ _code: 'stage_invalid', _unknown: false });
  });

  it('lost completion acknowledgement is outcome_unknown with completion_unknown, no blind retry', async () => {
    const log: Call[] = [];
    const admin = port((name) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return { staged: 2, total_expected: 2 };
      if (name === 'complete_knowledge_publication') return new Error('connection lost');
      return null;
    }, log);
    const result = await runKnowledgePublication(admin, WORK);
    expect(result).toMatchObject({ ok: false, status: 'outcome_unknown' });
    expect(log.filter((c) => c.name === 'start_knowledge_publication')).toHaveLength(1);
    expect(log[log.length - 1].name).toBe('settle_knowledge_publication_failure');
    expect(log[log.length - 1].args).toMatchObject({ _code: 'completion_unknown', _unknown: true });
  });

  it('settle transport loss surfaces outcome_unknown rather than inventing a verdict', async () => {
    const log: Call[] = [];
    const admin = port((name) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return new Error('KNOWLEDGE_REVIEW_CONFLICT');
      return null;
    }, log);
    expect(await runKnowledgePublication(admin, WORK)).toMatchObject({ ok: false, status: 'failed', error_code: 'revision_changed' });
  });

  it('unverifiable completion readback never claims success', async () => {
    const log: Call[] = [];
    const admin = port((name) => {
      if (name === 'start_knowledge_publication') return { ...START };
      if (name === 'stage_knowledge_publication') return { staged: 2, total_expected: 2 };
      if (name === 'complete_knowledge_publication') return { phase: 'published' };
      return null;
    }, log);
    const result = await runKnowledgePublication(admin, WORK);
    expect(result).toMatchObject({ status: 'outcome_unknown' });
    expect(log[log.length - 1].args).toMatchObject({ _code: 'completion_unknown', _unknown: true });
  });
});
