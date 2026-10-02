// The publication half of the native Knowledge worker seam: drives ONE knowledge-publish
// work item from claim to atomic promotion through the service-only SQL RPCs landed in
// 20270533000000. Mirrors knowledge-extraction.ts: the SQL owns authority, fencing, and
// truth; this module only sequences start → embed (shared Voyage gateway) → stage →
// complete and settles failure honestly. No new queue, no provider narration as truth.
import { embed } from './kb-ingest-core.ts';

export type PublicationRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message?: string; code?: string} | null}> };
export class PublicationError extends Error { constructor(public code: string) { super(code); } }

interface PublicationStart {
  status: string; work_id: string; server_key: string; attempt: number; revision: number;
  model: string; dimensions: number;
  chunks: Array<{ index: number; text: string; sha256: string }>;
}

async function rpc(client: PublicationRpc, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message ?? 'rpc_failed');
  return result.data;
}

/**
 * Drive one publication work item. Provider egress happens ONLY between start and stage,
 * for the exact server-returned chunks; a provider failure before any staging settles
 * 'failed' deterministically (nothing was committed), while a lost completion
 * acknowledgement is reconciled by recover_knowledge_publication — never a blind
 * re-embed. Identical stage batches are idempotent, so a retry of the same attempt
 * after a partial batch is safe; a NEW attempt fences the old one at the SQL layer.
 */
export async function runKnowledgePublication(admin: PublicationRpc, workId: string, embedder: (text: string) => Promise<number[]> = embed): Promise<Record<string, unknown>> {
  const started = await rpc(admin, 'start_knowledge_publication', { _work_id: workId }) as PublicationStart;
  if (started?.status === 'blocked') return { ok: false, status: 'blocked', work_id: workId };
  if (started?.status !== 'claimed' || typeof started.server_key !== 'string' || !Number.isInteger(started.attempt)
    || !Number.isInteger(started.revision) || !Array.isArray(started.chunks) || started.chunks.length === 0) {
    throw new PublicationError('input_invalid');
  }
  let completionDispatched = false;
  try {
    const batch = [];
    for (const chunk of started.chunks) {
      if (typeof chunk?.text !== 'string' || typeof chunk.sha256 !== 'string') throw new PublicationError('input_invalid');
      const embedding = await embedder(chunk.text);
      batch.push({ index: chunk.index, sha256: chunk.sha256, embedding });
    }
    const staged = await rpc(admin, 'stage_knowledge_publication', {
      _work_id: workId, _server_key: started.server_key, _attempt: started.attempt,
      _revision: started.revision, _chunks: batch,
    }) as Record<string, unknown>;
    if (Number(staged?.total_expected) !== batch.length) throw new PublicationError('stage_incomplete');
    completionDispatched = true;
    const completed = await rpc(admin, 'complete_knowledge_publication', {
      _work_id: workId, _server_key: started.server_key, _attempt: started.attempt, _revision: started.revision,
    }) as Record<string, unknown>;
    if (completed?.verified_readback !== true || completed?.phase !== 'published'
      || !['capability_succeeded', 'capability_completed_unrecorded'].includes(String(completed?.outcome))) {
      throw new Error('completion_readback_missing');
    }
    return { ok: true, status: 'succeeded', ...completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const deterministic = error instanceof PublicationError
      || /KNOWLEDGE_(STAGE_INVALID|STAGE_INCOMPLETE|REVIEW_CONFLICT|REVISION_CONFLICT|SCOPE_CHANGED)/.test(message)
      || message === 'invalid_embedding' || /^embed \d+/.test(message);
    const code = error instanceof PublicationError ? error.code
      : message.includes('STAGE_INVALID') ? 'stage_invalid'
      : message.includes('STAGE_INCOMPLETE') ? 'stage_incomplete'
      : message.includes('REVIEW_CONFLICT') ? 'revision_changed'
      : message.includes('SCOPE_CHANGED') ? 'authority_changed'
      : message === 'invalid_embedding' || /^embed \d+/.test(message) ? 'embedding_failed'
      : message === 'stage_incomplete' ? 'stage_incomplete' : 'input_invalid';
    // A completion whose acknowledgement was lost is reconciled by recover, never re-driven
    // from here — the same no-duplicate-dispatch contract as extraction.
    const unknown = completionDispatched && !deterministic;
    try {
      await rpc(admin, 'settle_knowledge_publication_failure', {
        _work_id: workId, _server_key: started.server_key, _attempt: started.attempt,
        _code: unknown ? 'completion_unknown' : code, _unknown: unknown,
      });
    } catch {
      return { ok: false, status: 'outcome_unknown', work_id: workId };
    }
    return { ok: false, status: unknown ? 'outcome_unknown' : 'failed', error_code: code, work_id: workId };
  }
}
