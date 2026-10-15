/** Governed review-save and publication-status client seams.
 * JWT clients only; scope is a request precondition enforced by PostgreSQL.
 * No automatic retry: a lost acknowledgement requires readback, never another write.
 */
export interface KnowledgeReviewClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string; code?: string} | null}>;
}
export class KnowledgeReviewServiceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export interface KnowledgeReviewMetadata { title: string; summary: string | null; category: string | null; tags: string[] }
export type KnowledgeReviewOutcome = {revision: number; outcome: 'capability_succeeded' | 'capability_completed_unrecorded'; runId: string};
export type PublicationWorkStatus =
  | {phase: 'resolved'; status: 'succeeded'}
  | {phase: 'resolved'; status: 'failed' | 'cancelled'; errorCode: string | null}
  | {phase: 'paused'; status: 'blocked'; reason: string | null}
  | {phase: 'reconcile'; status: 'outcome_unknown'; errorCode: string | null}
  | {phase: 'working'; status: 'claimed' | 'expired'};
type WorkRow = {work_id: unknown; capability_key: unknown; work_kind: unknown; work_status: unknown; blocked_reason: unknown; error_code: unknown};

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Saves the reviewed content and staged metadata for an extracted document.
 * The projection must echo the exact document, work and next revision — a response for
 * anything else is refused, never interpreted.
 */
export async function saveKnowledgeReview(
  client: KnowledgeReviewClient, tenant: string, documentId: string, workId: string,
  expectedRevision: number, content: string, metadata: KnowledgeReviewMetadata,
): Promise<KnowledgeReviewOutcome> {
  if (!tenant) throw new KnowledgeReviewServiceError('KNOWLEDGE_SCOPE_REQUIRED', 'Select a workspace first.');
  const {data, error} = await client.rpc('save_tenant_knowledge_review', {
    p_expected_tenant: tenant, p_doc_id: documentId, p_work_id: workId,
    p_expected_revision: expectedRevision, p_content: content, p_metadata: metadata,
  });
  if (error) throw new KnowledgeReviewServiceError(error.code ?? 'KNOWLEDGE_REQUEST_FAILED', error.message);
  if (!object(data) || data.tenant_id !== tenant || data.document_id !== documentId || data.work_id !== workId
    || data.verified_readback !== true
    || data.revision !== expectedRevision + 1 || !Number.isInteger(data.revision)
    || (data.outcome !== 'capability_succeeded' && data.outcome !== 'capability_completed_unrecorded')
    || typeof data.run_id !== 'string' || !data.run_id) {
    throw new KnowledgeReviewServiceError('KNOWLEDGE_RESPONSE_INVALID', 'The review save could not be verified.');
  }
  return {revision: data.revision as number, outcome: data.outcome, runId: data.run_id};
}

/** Reads one publication work item the caller can see, classified into exactly what the UI
 * may truthfully say next: working, resolved, paused for access, or needing reconciliation.
 */
export async function readKnowledgePublicationStatus(client: KnowledgeReviewClient, workId: string): Promise<PublicationWorkStatus> {
  const {data, error} = await client.rpc('get_paige_durable_work', {_work_id: workId});
  if (error) throw new KnowledgeReviewServiceError(error.code ?? 'KNOWLEDGE_REQUEST_FAILED', error.message);
  if (!Array.isArray(data) || data.length !== 1) throw new KnowledgeReviewServiceError('KNOWLEDGE_RESPONSE_INVALID', 'The publication status could not be read.');
  const row = data[0] as WorkRow;
  if (!object(row) || row.work_id !== workId || row.capability_key !== 'knowledge.publish' || row.work_kind !== 'knowledge_publish'
    || typeof row.work_status !== 'string') {
    throw new KnowledgeReviewServiceError('KNOWLEDGE_RESPONSE_INVALID', 'The publication status could not be read.');
  }
  const status = row.work_status;
  const errorCode = row.error_code === null || typeof row.error_code === 'string' ? row.error_code as string | null : null;
  const blockedReason = row.blocked_reason === null || typeof row.blocked_reason === 'string' ? row.blocked_reason as string | null : null;
  if (status === 'succeeded') return {phase: 'resolved', status: 'succeeded'};
  if (status === 'failed' || status === 'cancelled') return {phase: 'resolved', status, errorCode};
  if (status === 'blocked') return {phase: 'paused', status, reason: blockedReason};
  if (status === 'outcome_unknown') return {phase: 'reconcile', status, errorCode};
  if (status === 'claimed' || status === 'expired') return {phase: 'working', status};
  throw new KnowledgeReviewServiceError('KNOWLEDGE_RESPONSE_INVALID', 'The publication status could not be read.');
}

/** SHA-256 hex digest of the exact reviewed text — the publication intent's review hash.
 * Digests the TypedArray view, never its buffer: cross-realm ArrayBuffers make
 * crypto.subtle.digest throw otherwise.
 */
export async function sha256Hex(text: string): Promise<string> {
  const view = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
