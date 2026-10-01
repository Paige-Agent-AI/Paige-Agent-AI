/** Canonical Knowledge RPC client. Inject the authenticated caller client, never a service key.
 * Scope is a request precondition; PostgreSQL derives actor/active tenant and enforces authority.
 * No automatic retry: lost acknowledgement requires readback, not another write.
 */
export interface KnowledgeDocument {
  id: string;
  tenant_id: string;
  revision: number;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  source: string;
  source_url: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  share_to_network: boolean;
  network_review_status: 'none' | 'pending' | 'approved' | 'rejected';
  content?: string;
}
export type KnowledgeMetadataPatch = Partial<Pick<KnowledgeDocument, 'title' | 'summary' | 'category'>> & {tags?: string[]};
export interface KnowledgeRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string; code?: string} | null}>;
}
export class KnowledgeServiceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function document(value: unknown, tenant: string): KnowledgeDocument {
  if (!object(value) || value.tenant_id !== tenant || typeof value.id !== 'string' || typeof value.title !== 'string'
    || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || !['summary','category','source_url'].every(key => value[key] === null || typeof value[key] === 'string')
    || !['source','created_at','updated_at'].every(key => typeof value[key] === 'string')
    || !(value.tags === null || (Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')))
    || !Number.isInteger(value.chunk_count) || Number(value.chunk_count) < 0
    || typeof value.share_to_network !== 'boolean'
    || typeof value.network_review_status !== 'string' || !['none','pending','approved','rejected'].includes(value.network_review_status)
    || (value.content !== undefined && typeof value.content !== 'string')) {
    throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID', 'Knowledge response did not match the requested workspace.');
  }
  return value as unknown as KnowledgeDocument;
}
async function call(client: KnowledgeRpcClient, name: string, args: Record<string, unknown>, tenant: string) {
  if (!tenant) throw new KnowledgeServiceError('KNOWLEDGE_SCOPE_REQUIRED', 'Select a workspace first.');
  const {data,error} = await client.rpc(name,args);
  if (error) throw new KnowledgeServiceError(error.code ?? 'KNOWLEDGE_REQUEST_FAILED',error.message);
  if (!object(data) || data.tenant_id !== tenant) throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID','Knowledge response did not match the requested workspace.');
  return data;
}
export async function readKnowledge(client: KnowledgeRpcClient, tenant: string, options: {documentId?: string; limit?: number; offset?: number} = {}) {
  const data = await call(client,'read_tenant_knowledge',{
    p_expected_tenant: tenant,p_doc_id: options.documentId ?? null,p_limit: options.limit ?? 50,p_offset: options.offset ?? 0,
  },tenant);
  if (!Array.isArray(data.documents)) throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID','Knowledge documents were unavailable.');
  return data.documents.map(row => document(row,tenant));
}
export async function updateKnowledgeMetadata(client: KnowledgeRpcClient, tenant: string, id: string, revision: number, patch: KnowledgeMetadataPatch) {
  const data = await call(client,'update_tenant_knowledge_metadata',{
    p_expected_tenant:tenant,p_doc_id:id,p_expected_revision:revision,p_patch:patch,
  },tenant);
  if (data.outcome !== 'capability_succeeded' && data.outcome !== 'capability_completed_unrecorded') {
    throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID','The update outcome could not be verified.');
  }
  const saved = document(data.document,tenant);
  if (saved.id !== id || saved.revision !== revision+1 || typeof data.run_id !== 'string') {
    throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID','The saved revision could not be verified.');
  }
  return {document:saved,outcome:data.outcome,runId:data.run_id};
}

export interface KnowledgeDeleteResult {
  tenant_id: string;
  document_id: string;
  deleted_revision: number;
  document_absent: true;
  chunks_absent: true;
  source_cleanup: {status: 'not_attempted'; reason: 'canonical_source_binding_unavailable'};
  outcome: 'capability_succeeded' | 'capability_completed_unrecorded';
  run_id: string;
}

/** Deletes only canonical records. A lost acknowledgement requires scoped readback.
 * Missing rows on a later call are not evidence that this attempt performed the deletion.
 */
export async function deleteKnowledge(
  client: KnowledgeRpcClient, tenant: string, id: string, expectedRevision: number,
): Promise<KnowledgeDeleteResult> {
  const data = await call(client, 'delete_tenant_knowledge', {
    p_expected_tenant: tenant, p_doc_id: id, p_expected_revision: expectedRevision,
  }, tenant);
  if (data.document_id !== id || data.deleted_revision !== expectedRevision
    || !Number.isInteger(data.deleted_revision) || expectedRevision < 1
    || data.document_absent !== true || data.chunks_absent !== true
    || (data.outcome !== 'capability_succeeded' && data.outcome !== 'capability_completed_unrecorded')
    || typeof data.run_id !== 'string' || !data.run_id.trim()
    || !object(data.source_cleanup) || data.source_cleanup.status !== 'not_attempted'
    || data.source_cleanup.reason !== 'canonical_source_binding_unavailable') {
    throw new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID', 'The deletion could not be verified.');
  }
  return data as unknown as KnowledgeDeleteResult;
}
