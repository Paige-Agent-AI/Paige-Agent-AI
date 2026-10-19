/** Incumbent extraction contract frozen against backend 007cc088e234848c1d73e3dc495b0cda940676f2.
 * Additive publication recovery requires the reviewed native45000 association contract.
 * JWT clients only. These adapters neither poll nor retry, persist, publish or cancel work.
 * Callers must supply an incarnation guard (tenant equality alone cannot fence A -> B -> A).
 */
export interface ExtractionClient {
  functions: { invoke(name: string, options: { body: Record<string, unknown> }): PromiseLike<{ data: unknown; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface ExtractionScope { tenantId: string; isCurrent: () => boolean }
export type ExtractionInput = {
  intent_id: string; title: string; doc_id?: string; expected_revision?: number;
} & ({ kind: 'paste'; content: string; path?: never } | { kind: 'file'; path: string; content?: never });
export type ExtractionStatus = 'claimed' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'expired' | 'outcome_unknown';
export interface ExtractionReadReference { tenantId: string; documentId: string; workId: string; revision?: number }
export interface ExtractionReference extends ExtractionReadReference { intentId: string }
export interface ExtractionSubmission { reference: ExtractionReference; status: ExtractionStatus; replayed: boolean }
export interface SourceBinding {
  bucket: 'tenant-knowledge'; object_id: string; object_name: string; sha256: string;
  byte_size: number; mime_type: string; bound_at: string;
}
export type SourceCoverage = 'complete' | 'partial' | 'unknown';
export interface KnowledgePublicationAssociation {
  contract_version: 1; association: 'not_submitted' | 'matched' | 'unavailable';
  work_id: string | null; work_status: ExtractionStatus | null; generation_id: string | null;
  outcome: 'capability_succeeded' | 'capability_completed_unrecorded' | null;
}
export interface ExtractionReview {
  phase: 'awaiting_review' | 'review_unavailable';
  tenant_id: string; document_id: string; revision: number; record_state: 'canonical' | 'draft';
  source_coverage: SourceCoverage; source_binding: SourceBinding | null;
  extraction_work_id: string; extraction_source_binding: SourceBinding | null;
  pending_review: null | { schema_version: 1; extracted_content: string; reviewed_content: string | null; extraction_version: string; coverage: SourceCoverage };
  publication?: KnowledgePublicationAssociation;
}
export type ExtractionDocumentReview = Omit<ExtractionReview, 'extraction_work_id'> & { extraction_work_id: string | null };
/** Read-only source reference. It cannot submit or replay a publication intent. */
export interface KnowledgePublicationReadReference {
  tenantId: string; documentId: string; extractionWorkId?: string; revision: number; workId?: string;
}
export interface ExtractionWorkStatus {
  work_id: string; capability_key: 'knowledge.extract'; work_kind: 'knowledge_extract'; work_status: ExtractionStatus;
  attempt_count: number; max_attempts: number; blocked_reason: string | null; error_code: string | null;
  safe_summary: string | null; created_at: string; updated_at: string; settled_at: string | null;
}
export class ExtractionConsumerError extends Error {
  constructor(public readonly code: string, message: string, public readonly submissionUncertain = false) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses: readonly string[] = ['claimed', 'succeeded', 'failed', 'blocked', 'cancelled', 'expired', 'outcome_unknown'];
const coverages: readonly string[] = ['complete', 'partial', 'unknown'];
const MAX_BYTES = 2 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');
const nullableText = (v: unknown, max: number) => v === null || text(v, max);
const date = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
function invalid(uncertain = false): never { throw new ExtractionConsumerError('EXTRACTION_RESPONSE_INVALID', 'Extraction could not be verified.', uncertain); }
function assertScope(scope: ExtractionScope, uncertain = false) {
  if (!uuid(scope.tenantId) || typeof scope.isCurrent !== 'function' || scope.isCurrent() !== true) throw new ExtractionConsumerError('EXTRACTION_SCOPE_CHANGED', 'Select the original workspace and check the current extraction.', uncertain);
}
function capture(scope: ExtractionScope): ExtractionScope { const captured = { tenantId: scope.tenantId, isCurrent: scope.isCurrent }; assertScope(captured); return captured; }
function reference(scope: ExtractionScope, ref: ExtractionReadReference) {
  if (ref.tenantId !== scope.tenantId || ('intentId' in ref && !uuid(ref.intentId)) || !uuid(ref.documentId) || !uuid(ref.workId) || (ref.revision !== undefined && !integer(ref.revision))) invalid();
  return { ...ref };
}
function pathInTenant(value: unknown, tenant: string): value is string {
  return typeof value === 'string' && value.length >= 38 && value.length <= 1024 && value.startsWith(tenant + '/') && !/(^|\/)\.{1,2}(\/|$)|\\|%|\/\//.test(value);
}
function binding(value: unknown, tenant: string): SourceBinding | null {
  if (value === null) return null;
  if (!object(value) || value.bucket !== 'tenant-knowledge' || !uuid(value.object_id) || !pathInTenant(value.object_name, tenant)
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || !integer(value.byte_size) || value.byte_size > 26214400
    || !text(value.mime_type, 255) || !date(value.bound_at)) invalid();
  return { bucket: 'tenant-knowledge', object_id: value.object_id, object_name: value.object_name, sha256: value.sha256,
    byte_size: value.byte_size, mime_type: value.mime_type, bound_at: value.bound_at };
}
function content(value: unknown): value is string { return text(value, 480000) && new TextEncoder().encode(value).length <= MAX_BYTES; }
function publicationProjection(value: unknown, doc: Record<string, unknown>): KnowledgePublicationAssociation | undefined {
  // Rolling deployments may omit the additive field. Omission is not idle proof.
  if (value === undefined) return undefined;
  if (!object(value) || value.contract_version !== 1 || typeof value.association !== 'string'
    || !['not_submitted', 'matched', 'unavailable'].includes(value.association)) invalid();
  if (value.association !== 'matched') {
    if (value.work_id !== null || value.work_status !== null || value.generation_id !== null || value.outcome !== null) invalid();
    if (value.association === 'not_submitted' && !(object(doc.pending_review) && doc.pending_review.reviewed_content !== null)
      && !(doc.pending_review === null && doc.extraction_work_id === null && doc.record_state === 'canonical')) invalid();
  } else {
    if (!uuid(value.work_id) || typeof value.work_status !== 'string' || !statuses.includes(value.work_status)) invalid();
    if (doc.pending_review !== null) {
      if (!object(doc.pending_review) || doc.pending_review.reviewed_content === null || value.work_status === 'succeeded'
        || value.generation_id !== null || value.outcome !== null) invalid();
    } else if (value.work_status === 'succeeded') {
      if (doc.record_state !== 'canonical' || doc.extraction_work_id !== null || value.generation_id !== value.work_id
        || typeof value.outcome !== 'string' || !['capability_succeeded', 'capability_completed_unrecorded'].includes(value.outcome)) invalid();
    } else if (doc.record_state !== 'canonical' || doc.extraction_work_id !== null
      || ['failed', 'cancelled'].includes(value.work_status) || value.generation_id !== null || value.outcome !== null) invalid();
  }
  return { contract_version: 1, association: value.association as KnowledgePublicationAssociation['association'],
    work_id: value.work_id as string | null, work_status: value.work_status as ExtractionStatus | null,
    generation_id: value.generation_id as string | null, outcome: value.outcome as KnowledgePublicationAssociation['outcome'] };
}
async function read(client: ExtractionClient, scope: ExtractionScope, name: string, args: Record<string, unknown>) {
  assertScope(scope);
  let response: { data: unknown; error: unknown };
  try { response = await client.rpc(name, args); }
  catch { assertScope(scope); throw new ExtractionConsumerError('EXTRACTION_READ_UNAVAILABLE', 'Extraction could not be read.'); }
  assertScope(scope);
  if (!response || response.error) throw new ExtractionConsumerError('EXTRACTION_READ_UNAVAILABLE', 'Extraction could not be read.');
  return response.data;
}
/** One explicit intent only. A thrown/invalid acknowledgement may follow an accepted submission.
 * Reconciliation is a caller-initiated replay of the same input and intent, never a new automatic write.
 */
export async function submitKnowledgeExtraction(client: ExtractionClient, suppliedScope: ExtractionScope, input: ExtractionInput): Promise<ExtractionSubmission> {
  const scope = capture(suppliedScope);
  const b: Record<string, unknown> = { ...input, expected_tenant: scope.tenantId };
  if (!object(input) || Object.keys(input).some(k => !['intent_id', 'title', 'doc_id', 'expected_revision', 'kind', 'content', 'path'].includes(k))
    || !uuid(b.intent_id) || !text(b.title, 300) || !b.title.trim()
    || (b.doc_id === undefined) !== (b.expected_revision === undefined)
    || (b.doc_id !== undefined && (!uuid(b.doc_id) || !integer(b.expected_revision)))
    || (b.kind !== 'paste' && b.kind !== 'file')
    || (b.kind === 'paste' && (!content(b.content) || b.path !== undefined))
    || (b.kind === 'file' && (!pathInTenant(b.path, scope.tenantId) || !/\.(txt|md|markdown|csv|json)$/i.test(b.path) || b.content !== undefined))) {
    throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID', 'Choose supported UTF-8 text or paste valid content in this workspace.');
  }
  b.title = (b.title as string).trim();
  if (new TextEncoder().encode(JSON.stringify(b)).length > 2100000) throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID', 'The submission is too large.');
  assertScope(scope);
  let response: { data: unknown; error: unknown };
  try { response = await client.functions.invoke('kb-extract-submit', { body: b }); }
  catch { assertScope(scope, true); throw new ExtractionConsumerError('EXTRACTION_SUBMISSION_UNKNOWN', 'Submission could not be confirmed. Reconcile this same intent before starting another.', true); }
  assertScope(scope, true);
  if (!response || response.error) throw new ExtractionConsumerError('EXTRACTION_SUBMISSION_UNKNOWN', 'Submission could not be confirmed. Reconcile this same intent before starting another.', true);
  const d = response.data;
  if (object(d) && d.ok === false && d.error === 'submission_outcome_unknown') {
    if (d.intent_id !== b.intent_id || d.reconciliation !== 'replay_same_intent') invalid(true);
    throw new ExtractionConsumerError('EXTRACTION_SUBMISSION_UNKNOWN', 'Submission could not be confirmed. Reconcile this same intent before starting another.', true);
  }
  if (!object(d) || d.ok !== true || !uuid(d.work_id) || !uuid(d.document_id) || typeof d.replayed !== 'boolean'
    || !statuses.includes(String(d.status)) || (b.doc_id !== undefined && d.document_id !== b.doc_id)
    || (!d.replayed && (d.status !== 'claimed' || !integer(d.revision)))
    || (d.revision !== undefined && !integer(d.revision))
    || (!d.replayed && d.revision !== (b.expected_revision === undefined ? 1 : Number(b.expected_revision) + 1))) invalid(true);
  return { reference: { tenantId: scope.tenantId, intentId: b.intent_id as string, documentId: d.document_id, workId: d.work_id,
    ...(d.revision !== undefined ? { revision: d.revision as number } : {}) }, status: d.status as ExtractionStatus, replayed: d.replayed };
}
/** Plain text only. Presence of pending_review means awaiting review, never publication or indexing. */
function reviewProjection(d: unknown, scope: ExtractionScope, documentId: string, revision?: number, workId?: string, exactRevision = false): ExtractionDocumentReview {
  if (!object(d) || d.tenant_id !== scope.tenantId || d.document_id !== documentId
    || !(d.extraction_work_id === null || uuid(d.extraction_work_id)) || (workId !== undefined && d.extraction_work_id !== workId)
    || !integer(d.revision) || (revision !== undefined && (exactRevision ? d.revision !== revision : d.revision < revision))
    || !['draft', 'canonical'].includes(String(d.record_state)) || !coverages.includes(String(d.source_coverage))) invalid();
  const p = d.pending_review;
  if (p !== null && (d.extraction_work_id === null || !object(p) || p.schema_version !== 1 || !content(p.extracted_content)
    || (p.reviewed_content !== null && !content(p.reviewed_content)) || !text(p.extraction_version, 100) || !coverages.includes(String(p.coverage)))) invalid();
  const publication = publicationProjection(d.publication, d);
  return { phase: p === null ? 'review_unavailable' : 'awaiting_review', tenant_id: scope.tenantId, document_id: documentId, revision: d.revision,
    record_state: d.record_state as ExtractionReview['record_state'], source_coverage: d.source_coverage as SourceCoverage,
    source_binding: binding(d.source_binding, scope.tenantId), extraction_work_id: d.extraction_work_id as string | null,
    extraction_source_binding: binding(d.extraction_source_binding, scope.tenantId),
    pending_review: p === null ? null : { schema_version: 1, extracted_content: (p as Record<string, unknown>).extracted_content as string,
      reviewed_content: (p as Record<string, unknown>).reviewed_content as string | null, extraction_version: (p as Record<string, unknown>).extraction_version as string, coverage: (p as Record<string, unknown>).coverage as SourceCoverage },
    ...(publication ? { publication } : {}) };
}
/** Discover existing staged work from the canonical scoped document, never from a new intent.
 * The fresh selected revision must still match; malformed/unreadable data is never idle.
 */
export async function readKnowledgeExtractionForDocument(client: ExtractionClient, suppliedScope: ExtractionScope, documentId: string, expectedRevision: number): Promise<ExtractionDocumentReview> {
  const scope = capture(suppliedScope);
  if (!uuid(documentId) || !integer(expectedRevision)) invalid();
  const d = await read(client, scope, 'read_tenant_knowledge_review', { p_expected_tenant: scope.tenantId, p_doc_id: documentId });
  return reviewProjection(d, scope, documentId, expectedRevision, undefined, true);
}
/** Reconcile the original saved revision through its canonical native association. Generic
 * job success alone cannot establish this document's promoted generation or receipt outcome.
 */
export async function readKnowledgePublicationForDocument(client: ExtractionClient, suppliedScope: ExtractionScope, suppliedRef: KnowledgePublicationReadReference): Promise<ExtractionDocumentReview> {
  const scope = capture(suppliedScope); const ref = { ...suppliedRef };
  if (ref.tenantId !== scope.tenantId || !uuid(ref.documentId) || !integer(ref.revision)
    || (ref.extractionWorkId !== undefined && !uuid(ref.extractionWorkId)) || (ref.extractionWorkId === undefined && ref.workId === undefined)
    || (ref.workId !== undefined && !uuid(ref.workId))) invalid();
  const d = await read(client, scope, 'read_tenant_knowledge_review', { p_expected_tenant: scope.tenantId, p_doc_id: ref.documentId });
  const projected = reviewProjection(d, scope, ref.documentId);
  const p = projected.publication;
  if (ref.extractionWorkId === undefined) {
    // An already-canonical document has no extraction reference after promotion.
    // Keep its exact current revision/work; never invent the cleared extraction ID.
    if (projected.revision !== ref.revision || projected.pending_review !== null || projected.extraction_work_id !== null || p?.association !== 'matched') invalid();
  } else if (projected.pending_review !== null) {
    if (projected.revision !== ref.revision || projected.extraction_work_id !== ref.extractionWorkId
      || projected.pending_review.reviewed_content === null) invalid();
  } else {
    // Native publication proof survives later metadata revisions. Only the known
    // original terminal work/current generation can relax the next-revision bound;
    // a lost acknowledgement must not adopt an unrelated later publication.
    const samePublishedGeneration = ref.workId !== undefined && p?.association === 'matched'
      && p.work_id === ref.workId && p.work_status === 'succeeded' && p.generation_id === ref.workId;
    if (projected.revision <= ref.revision || p?.association !== 'matched'
      || (projected.revision !== ref.revision + 1 && !samePublishedGeneration)) invalid();
  }
  if (p?.association === 'matched' && ref.workId !== undefined && p.work_id !== ref.workId) invalid();
  return projected;
}
export async function readKnowledgeExtractionReview(client: ExtractionClient, suppliedScope: ExtractionScope, suppliedRef: ExtractionReadReference): Promise<ExtractionReview> {
  const scope = capture(suppliedScope); const ref = reference(scope, suppliedRef);
  const d = await read(client, scope, 'read_tenant_knowledge_review', { p_expected_tenant: scope.tenantId, p_doc_id: ref.documentId });
  const projected = reviewProjection(d, scope, ref.documentId, ref.revision, ref.workId);
  return { ...projected, extraction_work_id: ref.workId };
}
/** Status has no tenant/document fields. First verify its exact source/work association through
 * the scoped review RPC; then read the existing job. No new status store or receipt inference.
 */
export async function readKnowledgeExtractionStatus(client: ExtractionClient, suppliedScope: ExtractionScope, suppliedRef: ExtractionReadReference): Promise<ExtractionWorkStatus> {
  const scope = capture(suppliedScope); const ref = reference(scope, suppliedRef);
  await readKnowledgeExtractionReview(client, scope, ref);
  const rows = await read(client, scope, 'get_paige_durable_work', { _work_id: ref.workId });
  if (!Array.isArray(rows) || rows.length !== 1) invalid();
  const d = rows[0];
  if (!object(d) || d.work_id !== ref.workId || d.capability_key !== 'knowledge.extract' || d.work_kind !== 'knowledge_extract'
    || !statuses.includes(String(d.work_status)) || !integer(d.attempt_count) || !integer(d.max_attempts) || d.max_attempts > 25 || d.attempt_count > d.max_attempts
    || !nullableText(d.blocked_reason, 500) || (d.work_status === 'blocked') !== (d.blocked_reason !== null)
    || !nullableText(d.error_code, 100) || !nullableText(d.safe_summary, 2000) || !date(d.created_at) || !date(d.updated_at)
    || (d.settled_at !== null && !date(d.settled_at))) invalid();
  return { work_id: ref.workId, capability_key: 'knowledge.extract', work_kind: 'knowledge_extract', work_status: d.work_status as ExtractionStatus,
    attempt_count: d.attempt_count, max_attempts: d.max_attempts, blocked_reason: d.blocked_reason as string | null, error_code: d.error_code as string | null,
    safe_summary: d.safe_summary as string | null, created_at: d.created_at, updated_at: d.updated_at, settled_at: d.settled_at as string | null };
}
