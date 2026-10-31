import {readKnowledge, type KnowledgeRpcClient} from './knowledge-service';
import {inspectKnowledgeFile, KnowledgeFileTextError} from '../../supabase/functions/_shared/knowledge-file-text';
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
export interface KnowledgeDocumentSourceEvidence {
  schema_version: 1; format: 'pdf' | 'docx' | 'text'; source_sha256: string; text_sha256: string;
  extraction_version: string; coverage: 'complete' | 'partial'; extracted_content: string;
  segments: {kind: 'page' | 'paragraph' | 'text'; ordinal: number; start: number; end: number}[];
  limits: string[];
}
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
/** Typed second-read failures preserve existing consumers' refusal semantics. */
export class KnowledgePendingReadError extends ExtractionConsumerError {
  constructor(public readonly nativeCode?: string) {super('EXTRACTION_READ_UNAVAILABLE','The pending review could not be read.');}
}
export class KnowledgePendingProjectionError extends ExtractionConsumerError {
  constructor(code = 'EXTRACTION_RESPONSE_INVALID') {super(code,'The pending review could not be verified.');}
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
export interface KnowledgeUploadStorage {
  upload(path: string, bytes: Uint8Array, options: {contentType: string; upsert: false}): PromiseLike<{error: unknown}>;
  download(path: string): PromiseLike<{data: Blob | null; error: unknown}>;
}
export interface KnowledgeUploadSource {path: string; bytes: Uint8Array; mime: string}
export interface KnowledgeUploadSelectionRow {
  phase: 'prepared' | 'duplicate' | 'refused'; name: string; source: KnowledgeUploadSource | null;
  intentId: string | null; duplicateOf?: number; errorCode?: string;
}
/** Stable identity for finite browser selections. Reload/reselection preserves
 * the original non-overwriting Storage path and native intent, not a new ledger.
 * These hashes identify bytes only; native admission still derives all authority.
 * Identical files in this selection fold; existing-library dedup is not asserted.
 */
export async function prepareKnowledgeUploadSelection(suppliedScope: ExtractionScope, actor: string, files: readonly {name: string; mime: string; bytes: Uint8Array}[]): Promise<KnowledgeUploadSelectionRow[]> {
  const scope = capture(suppliedScope);
  if (!uuid(actor) || !Array.isArray(files) || files.length < 1 || files.length > 20
    || files.some(f => !f || !(f.bytes instanceof Uint8Array))
    || files.reduce((n,f) => n + f.bytes.byteLength,0) > 20 * 1024 * 1024) {
    throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID', 'Choose up to 20 files, at most 20 MB total.');
  }
  // Snapshot EVERY input before any digest can yield, including subclass views.
  const snapshots = files.map(f => ({name:f.name,mime:f.mime,bytes:new Uint8Array(f.bytes)}));
  const seen = new Map<string,number>(), rows: KnowledgeUploadSelectionRow[] = [];
  for (const file of snapshots) {
    assertScope(scope);
    try {
      if (!text(file.name, 300) || !file.name.trim()) throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID','Choose a named file.');
      const format = inspectKnowledgeFile(file), hash = await uploadDigest(file.bytes);
      assertScope(scope);
      const key = `${format}:${hash}`, duplicateOf = seen.get(key);
      if (duplicateOf !== undefined) {rows.push({phase:'duplicate',name:file.name,source:null,intentId:null,duplicateOf});continue;}
      const extension = format === 'text' ? 'txt' : format;
      const suppliedMime = (file.mime || '').split(';')[0].trim().toLowerCase();
      const mime = format === 'pdf' ? 'application/pdf' : format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : (!suppliedMime || suppliedMime === 'application/octet-stream') ? 'text/plain' : suppliedMime;
      // Title and normalized MIME are immutable native request inputs too.
      // Renaming or changing source type is a different request, not a replay.
      const identity = await uploadDigest(new TextEncoder().encode(JSON.stringify(['knowledge-file-upload-v1',scope.tenantId,actor,key,file.name.trim(),mime])));
      assertScope(scope);
      // UUID is an idempotency key, never a consent/security token. Native
      // fingerprint checks reject any changed-input collision rather than replay.
      const intentId = `${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
      rows.push({phase:'prepared',name:file.name,intentId,source:{path:`${scope.tenantId}/${actor}/${intentId}.${extension}`,bytes:file.bytes,mime}});
      seen.set(key, rows.length - 1);
    } catch (error) {
      assertScope(scope);
      if (!(error instanceof KnowledgeFileTextError) && !(error instanceof ExtractionConsumerError)) throw error;
      rows.push({phase:'refused',name:typeof file.name==='string'?file.name:'Unnamed file',source:null,intentId:null,
        errorCode:error instanceof KnowledgeFileTextError?error.code:'EXTRACTION_INPUT_INVALID'});
    }
  }
  return rows;
}
/** A correction is a different immutable native request from adding a source.
 * Re-selection can inspect the same non-overwriting object without adopting
 * another document/revision's intent. Native correction admission stays final.
 */
export async function prepareKnowledgeReplacementUpload(suppliedScope: ExtractionScope, actor: string,
  suppliedTarget: {tenantId: string; documentId: string; revision: number},
  file: {name: string; mime: string; bytes: Uint8Array}, title: string): Promise<KnowledgeUploadSelectionRow> {
  const scope=capture(suppliedScope), target={...suppliedTarget};
  if(target.tenantId!==scope.tenantId||!uuid(target.documentId)||!integer(target.revision)||!text(title,300)||!title.trim()) {
    throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID','Reopen the current document and choose a valid replacement title.');
  }
  const [row]=await prepareKnowledgeUploadSelection(scope,actor,[file]);
  assertScope(scope);
  if(row.phase!=='prepared'||!row.source||!row.intentId)return row;
  const identity=await uploadDigest(new TextEncoder().encode(JSON.stringify([
    'knowledge-file-replacement-v1',row.intentId,target.documentId,target.revision,title.trim(),
  ])));
  assertScope(scope);
  const intentId=`${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
  const extension=row.source.path.slice(row.source.path.lastIndexOf('.'));
  return {...row,intentId,source:{...row.source,path:`${scope.tenantId}/${actor}/${intentId}${extension}`}};
}
export type KnowledgeUploadResult = {phase: 'stored'; path: string; sha256: string; byteSize: number}
  | {phase: 'upload_unknown' | 'read_unavailable' | 'source_changed'; path: string};
function uploadSnapshot(scope: ExtractionScope, source: KnowledgeUploadSource): KnowledgeUploadSource {
  if (!source || !pathInTenant(source.path, scope.tenantId) || !/\.(pdf|docx|txt|md|markdown|csv|json)$/i.test(source.path)
    || !(source.bytes instanceof Uint8Array) || source.bytes.length < 1 || source.bytes.length > MAX_BYTES
    || typeof source.mime !== 'string' || source.mime.length > 255 || /[\r\n\0]/.test(source.mime)) {
    throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID', 'Choose a supported file up to 2 MB in this workspace.');
  }
  return {path: source.path, bytes: new Uint8Array(source.bytes), mime: source.mime};
}
async function uploadDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join('');
}
async function inspectUploadedSnapshot(storage: KnowledgeUploadStorage, scope: ExtractionScope, source: KnowledgeUploadSource): Promise<KnowledgeUploadResult> {
  let downloaded: Awaited<ReturnType<KnowledgeUploadStorage['download']>>;
  try { downloaded = await storage.download(source.path); }
  catch { assertScope(scope); return {phase: 'read_unavailable', path: source.path}; }
  assertScope(scope);
  if (!downloaded || downloaded.error || !downloaded.data) return {phase: 'read_unavailable', path: source.path};
  if (downloaded.data.size !== source.bytes.length) return {phase: 'source_changed', path: source.path};
  let actual: Uint8Array;
  try { actual = new Uint8Array(await downloaded.data.arrayBuffer()); }
  catch { assertScope(scope); return {phase: 'read_unavailable', path: source.path}; }
  assertScope(scope);
  const expectedHash = await uploadDigest(source.bytes), actualHash = await uploadDigest(actual);
  assertScope(scope);
  return actualHash === expectedHash ? {phase: 'stored', path: source.path, sha256: expectedHash, byteSize: source.bytes.length}
    : {phase: 'source_changed', path: source.path};
}
/** Finite browser transfer through the original JWT Storage client, not a job or
 * persistence ledger. The caller retains the SAME path/bytes before starting.
 * A lost acknowledgement offers inspection only; this function never retries.
 * Stored bytes are not extracted, indexed, approved facts or Memory.
 */
export async function uploadKnowledgeFileOnce(storage: KnowledgeUploadStorage, suppliedScope: ExtractionScope, suppliedSource: KnowledgeUploadSource): Promise<KnowledgeUploadResult> {
  const scope = capture(suppliedScope), source = uploadSnapshot(scope, suppliedSource);
  let result: Awaited<ReturnType<KnowledgeUploadStorage['upload']>>;
  try { result = await storage.upload(source.path, source.bytes, {contentType: source.mime || 'application/octet-stream', upsert: false}); }
  catch { assertScope(scope); return {phase: 'upload_unknown', path: source.path}; }
  assertScope(scope);
  if (!result || result.error) return {phase: 'upload_unknown', path: source.path};
  const inspected = await inspectUploadedSnapshot(storage, scope, source);
  assertScope(scope, true);
  return inspected;
}
/** Read-only recovery of that exact upload. Never interprets an inaccessible
 * object as absent, never overwrites it and never starts extraction implicitly.
 */
export async function inspectKnowledgeUploadedFile(storage: KnowledgeUploadStorage, suppliedScope: ExtractionScope, suppliedSource: KnowledgeUploadSource): Promise<KnowledgeUploadResult> {
  const scope = capture(suppliedScope), source = uploadSnapshot(scope, suppliedSource);
  const inspected = await inspectUploadedSnapshot(storage, scope, source);
  assertScope(scope);
  return inspected;
}
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
    || (b.kind === 'file' && (!pathInTenant(b.path, scope.tenantId) || !/\.(pdf|docx|txt|md|markdown|csv|json)$/i.test(b.path) || b.content !== undefined))) {
    throw new ExtractionConsumerError('EXTRACTION_INPUT_INVALID', 'Choose a PDF, DOCX or supported UTF-8 text file, or paste valid content in this workspace.');
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
export interface KnowledgePendingReviewSummary {
  documentId: string; revision: number; title: string; recordState: 'draft' | 'canonical';
  reviewAvailable: boolean; workId: string; status: ExtractionStatus;
}
export interface KnowledgeReviewTarget {
  id: string; tenant_id: string; revision: number; title: string; content: string;
  summary: string | null; category: string | null; tags: string[];
}
/** Restore the current native draft and its original staged metadata. Summary
 * rows alone cannot provide review text or authorize a save/publication.
 */
export async function readKnowledgePendingReviewTarget(client: ExtractionClient, suppliedScope: ExtractionScope, suppliedRow: KnowledgePendingReviewSummary): Promise<KnowledgeReviewTarget> {
  const scope = capture(suppliedScope), row = {...suppliedRow};
  if (!uuid(row.documentId) || !uuid(row.workId) || !integer(row.revision)) invalid();
  const review = await readKnowledgeExtractionForDocument(client, scope, row.documentId, row.revision);
  const target = await pendingReviewTarget(client,scope,row,review);
  assertScope(scope);
  return target;
}
/** Common original draft seam for internal Knowledge and the existing CURA
 * wrapper. Callers retain their own original scope/source-row/lifetime checks.
 * Reads only: no inventory fabrication, new submission, publication or sharing.
 */
export async function readKnowledgeDraftForDocument(client: ExtractionClient, suppliedScope: ExtractionScope, documentId: string, expectedRevision: number): Promise<KnowledgeReviewTarget> {
  const scope=capture(suppliedScope);
  const review=await readKnowledgeExtractionForDocument(client,scope,documentId,expectedRevision);
  if(review.record_state!=='draft'||!uuid(review.extraction_work_id))throw new KnowledgePendingProjectionError();
  const target = await pendingReviewTarget(client,scope,{documentId,revision:expectedRevision,workId:review.extraction_work_id},review);
  assertScope(scope);
  return target;
}
async function pendingReviewTarget(client: ExtractionClient, scope: ExtractionScope, row: Pick<KnowledgePendingReviewSummary,'documentId'|'revision'|'workId'>, review: ExtractionDocumentReview): Promise<KnowledgeReviewTarget> {
  function invalid():never{throw new KnowledgePendingProjectionError();}
  const metadataText=(value:unknown,max:number):value is string=>typeof value==='string'&&!value.includes('\0')&&Array.from(value).length<=max;
  let response:Awaited<ReturnType<ExtractionClient['rpc']>>;
  try{
    assertScope(scope);
    response=await client.rpc('read_tenant_knowledge_pending',{p_expected_tenant:scope.tenantId,p_doc_id:row.documentId});
    assertScope(scope);
  }catch(error){
    if(error instanceof ExtractionConsumerError&&error.code==='EXTRACTION_SCOPE_CHANGED')throw new KnowledgePendingProjectionError(error.code);
    assertScope(scope);throw error;
  }
  if(!response||response.error){
    const error=response?.error;
    throw new KnowledgePendingReadError(object(error)&&typeof error.code==='string'?error.code:undefined);
  }
  const d=response.data;
  if (!object(d) || d.contract_version !== 1 || d.tenant_id !== scope.tenantId || d.document_id !== row.documentId
    || d.revision !== row.revision || d.record_state !== review.record_state || !metadataText(d.title, 300)
    || d.extraction_work_id !== row.workId || review.extraction_work_id !== row.workId
    || d.review_available !== (review.pending_review !== null) || !object(d.work)
    || d.work.work_id !== row.workId || d.work.work_kind !== 'knowledge_extract' || d.work.capability_key !== 'knowledge.extract') invalid();
  const pending = d.pending_review, original = review.pending_review;
  if (original === null ? pending !== null : !object(pending) || pending.schema_version !== original.schema_version
    || pending.extracted_content !== original.extracted_content || pending.reviewed_content !== original.reviewed_content
    || pending.extraction_version !== original.extraction_version || pending.coverage !== original.coverage) invalid();
  const m = d.pending_review_metadata;
  const field = (v: unknown, limit: number) => v === null || metadataText(v,limit);
  if (m !== null && (!object(m) || Object.keys(m).length !== 4 || Object.keys(m).some(k => !['title','summary','category','tags'].includes(k))
    || !metadataText(m.title, 300) || !m.title.trim() || !field(m.summary, 2000) || !field(m.category, 100)
    || !Array.isArray(m.tags) || m.tags.length > 20 || m.tags.some(v => !metadataText(v, 60)))) invalid();
  let metadata = m as {title: string; summary: string | null; category: string | null; tags: string[]} | null;
  if (metadata === null && review.record_state === 'canonical') {
    // An unsaved replacement has no staged metadata. Preserve the current
    // canonical fields rather than turning missing staged values into clears.
    const documents = await readKnowledge(client as unknown as KnowledgeRpcClient, scope.tenantId, {documentId: row.documentId});
    assertScope(scope);
    if (documents.length !== 1 || documents[0].id !== row.documentId || documents[0].tenant_id !== scope.tenantId
      || documents[0].revision !== row.revision) invalid();
    const current = documents[0];
    if (!metadataText(current.title, 300) || !current.title.trim() || !field(current.summary, 2000) || !field(current.category, 100)
      || (current.tags !== null && (current.tags.length > 20 || current.tags.some(v => !metadataText(v, 60))))) invalid();
    metadata = {title: current.title, summary: current.summary, category: current.category, tags: [...(current.tags ?? [])]};
  }
  return {id: row.documentId, tenant_id: scope.tenantId, revision: row.revision, title: metadata?.title ?? d.title,
    content: original?.reviewed_content ?? original?.extracted_content ?? '', summary: metadata?.summary ?? null,
    category: metadata?.category ?? null, tags: [...(metadata?.tags ?? [])]};
}
/** Discover the SAME original pending documents after reload. This is a bounded
 * caller-JWT projection of native durable work, not a browser batch ledger.
 * It contains no source content, file URLs or inferred publication/fact status.
 */
export async function listKnowledgePendingReviews(client: ExtractionClient, suppliedScope: ExtractionScope, afterId: string | null = null) {
  const scope = capture(suppliedScope);
  if (afterId !== null && !uuid(afterId)) invalid();
  const d = await read(client, scope, 'list_tenant_knowledge_pending', { p_expected_tenant: scope.tenantId, p_after_id: afterId, p_limit: 20 });
  assertScope(scope);
  if (!object(d) || d.contract_version !== 1 || d.tenant_id !== scope.tenantId || !Array.isArray(d.items) || d.items.length > 20
    || !(d.next_cursor === null || uuid(d.next_cursor))) invalid();
  const items: KnowledgePendingReviewSummary[] = [];
  let previous = afterId?.toLowerCase() ?? '';
  for (const row of d.items) {
    if (!object(row) || row.contract_version !== 1 || row.tenant_id !== scope.tenantId || !uuid(row.document_id)
      || row.document_id.toLowerCase() <= previous || !integer(row.revision) || !text(row.title, 300)
      || (row.record_state !== 'draft' && row.record_state !== 'canonical') || typeof row.review_available !== 'boolean'
      || !uuid(row.extraction_work_id) || !object(row.work) || row.work.work_id !== row.extraction_work_id
      || row.work.capability_key !== 'knowledge.extract' || row.work.work_kind !== 'knowledge_extract'
      || typeof row.work.work_status !== 'string' || !statuses.includes(row.work.work_status)
      || (row.review_available && row.work.work_status !== 'succeeded')) invalid();
    previous = row.document_id.toLowerCase();
    items.push({documentId: row.document_id, revision: row.revision, title: row.title, recordState: row.record_state,
      reviewAvailable: row.review_available, workId: row.extraction_work_id, status: row.work.work_status as ExtractionStatus});
  }
  if (d.next_cursor !== null && (items.length !== 20 || d.next_cursor !== items[items.length - 1].documentId)) invalid();
  return {items, nextCursor: d.next_cursor as string | null};
}
/** Explicit opt-in to the original native reader. Legacy reads stay byte-compatible.
 * This proves a permitted extraction snapshot, never approved business facts, Memory,
 * agreement acceptance or current authority for a later action. Null is unavailable.
 */
export async function readKnowledgeDocumentSourceEvidence(client: ExtractionClient, suppliedScope: ExtractionScope, documentId: string, expectedRevision: number) {
  const scope = capture(suppliedScope);
  if (!uuid(documentId) || !integer(expectedRevision)) invalid();
  const d = await read(client, scope, 'read_tenant_knowledge_review', {
    p_expected_tenant: scope.tenantId, p_doc_id: documentId, p_include_source_evidence: true,
  });
  const review = reviewProjection(d, scope, documentId, expectedRevision, undefined, true);
  if (!object(d) || d.evidence_contract_version !== 1) invalid();
  const sourceEvidence = await sourceEvidenceProjection(d.source_evidence, review.source_binding);
  assertScope(scope);
  const extractionEvidence = await sourceEvidenceProjection(d.extraction_evidence, review.extraction_source_binding);
  assertScope(scope);
  if ((sourceEvidence && review.record_state !== 'canonical') || (extractionEvidence && (!review.pending_review
    || extractionEvidence.extracted_content !== review.pending_review.extracted_content
    || extractionEvidence.coverage !== review.pending_review.coverage
    || extractionEvidence.extraction_version !== review.pending_review.extraction_version))) invalid();
  return { review, sourceEvidence, extractionEvidence };
}
async function sourceEvidenceProjection(value: unknown, source: SourceBinding | null): Promise<KnowledgeDocumentSourceEvidence | null> {
  if (value === null) return null;
  const keys = ['schema_version','format','source_sha256','text_sha256','extraction_version','coverage','segments','limits','extracted_content'];
  if (!object(value) || !source || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))
    || value.schema_version !== 1 || typeof value.format !== 'string' || !['pdf','docx','text'].includes(value.format)
    || value.source_sha256 !== source.sha256 || typeof value.text_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.text_sha256)
    || !content(value.extracted_content) || typeof value.extraction_version !== 'string' || !/^[a-z0-9.-]{1,100}$/.test(value.extraction_version)
    || typeof value.coverage !== 'string' || !['complete','partial'].includes(value.coverage) || (value.format !== 'text' && value.coverage !== 'partial')
    || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 2000
    || !Array.isArray(value.limits) || value.limits.length > 20 || value.limits.some(v => typeof v !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(v))) invalid();
  const extracted = value.extracted_content;
  const boundary = (offset: number) => !(offset > 0 && offset < extracted.length
    && extracted.charCodeAt(offset - 1) >= 0xd800 && extracted.charCodeAt(offset - 1) <= 0xdbff
    && extracted.charCodeAt(offset) >= 0xdc00 && extracted.charCodeAt(offset) <= 0xdfff);
  let end = 0, ordinal = 0;
  const segments: KnowledgeDocumentSourceEvidence['segments'] = [];
  for (const s of value.segments) {
    if (!object(s) || Object.keys(s).length !== 4 || Object.keys(s).some(k => !['kind','ordinal','start','end'].includes(k))
      || s.kind !== (value.format === 'pdf' ? 'page' : value.format === 'docx' ? 'paragraph' : 'text')
      || !integer(s.ordinal) || s.ordinal <= ordinal || s.ordinal > 1000000 || !Number.isSafeInteger(s.start) || Number(s.start) < end
      || !integer(s.end) || s.end <= Number(s.start) || s.end > extracted.length || !boundary(Number(s.start)) || !boundary(s.end)) invalid();
    ordinal = s.ordinal; end = s.end;
    segments.push({ kind: s.kind as KnowledgeDocumentSourceEvidence['segments'][number]['kind'], ordinal, start: Number(s.start), end });
  }
  // Hash the exact typed-array view, preserving BOM and Unicode identity.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(extracted));
  const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join('');
  if (hash !== value.text_sha256) invalid();
  return { schema_version: 1, format: value.format as KnowledgeDocumentSourceEvidence['format'], source_sha256: source.sha256,
    text_sha256: hash, extraction_version: value.extraction_version, coverage: value.coverage as 'complete' | 'partial',
    extracted_content: extracted, segments, limits: [...value.limits] as string[] };
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
