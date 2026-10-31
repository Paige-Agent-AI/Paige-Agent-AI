/** Selected Memory review only. The caller supplies the original authority resolver
 * and an incarnation guard which stays false after departure, including A→B→A.
 * No legacy RPC fallback, automatic retry, or new Memory persistence lives here.
 */
export interface MemoryReviewScope {
  actorId: string;
  tenantId: string;
  isCurrent(): boolean;
}
export interface MemoryReviewClient {
  getScope(): PromiseLike<{ actorId: string; tenantId: string }>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export class MemoryReviewError extends Error {
  constructor(public readonly code: string, public readonly mutationMayHavePersisted = false, public readonly intentId?: string) {
    super('The reviewed Memory result could not be verified.');
  }
}
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);
export interface ReviewedMemorySelection {
  intentId: string;
  memoryType: string;
  content: string;
  sourceReference: { contractVersion: 1; tenantId: string; documentId: string; revision: number; contentSha256: string };
  sourceQuote: string;
  sourceThreadId?: string;
  supersedes?: { memoryId: string; updatedAt: string };
}
export type ReviewedMemoryInspection = { status: 'absent_at_read' }
  | { status: 'retired'; memoryId: string; updatedAt: string }
  | { status: 'present'; memoryId: string; updatedAt: string; content: string; memoryType: string;
      sourceState: 'current' | 'changed' | 'unavailable'; eligibleForContext: boolean;
      sourceThreadId: string | null; review: Record<string, unknown> };
const timestamp = (v: unknown): v is string => typeof v === 'string' && v.length < 64 && Number.isFinite(Date.parse(v));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function sourceReference(v: unknown, tenant: string): boolean {
  return object(v) && Object.keys(v).length === 5 && v.contractVersion === 1 && v.tenantId === tenant
    && uuid(v.documentId) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && hash(v.contentSha256);
}
function sameObject(a: unknown, b: unknown): boolean {
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && sameObject(a[key], b[key]));
  return a === b;
}

/** Captures strings before the first await; no content is returned after a scope
 * departure. Scope resolution errors also fail closed, without disclosing rows.
 */
export async function inspectReviewedPaigeMemory(
  client: MemoryReviewClient, scope: MemoryReviewScope, intentId: string,
): Promise<ReviewedMemoryInspection> {
  const captured = { actorId: scope.actorId, tenantId: scope.tenantId, isCurrent: scope.isCurrent };
  const result = await readReviewedMemory(client, captured, { intent_id: intentId });
  if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED');
  return result;
}
async function readReviewedMemory(
  client: MemoryReviewClient, scope: MemoryReviewScope, selector: { intent_id: string } | { memory_id: string },
): Promise<ReviewedMemoryInspection> {
  const captured = { actorId: scope.actorId.toLowerCase(), tenantId: scope.tenantId.toLowerCase(), isCurrent: scope.isCurrent };
  const selected = 'intent_id' in selector ? { intent_id: selector.intent_id.toLowerCase() } : { memory_id: selector.memory_id.toLowerCase() };
  if (!uuid(captured.actorId) || !uuid(captured.tenantId) || !uuid(Object.values(selected)[0])) throw new MemoryReviewError('INPUT_INVALID');
  const check = () => {
    if (captured.isCurrent() !== true) throw new MemoryReviewError('SCOPE_CHANGED');
  };
  const resolve = async () => {
    check();
    const current = await client.getScope();
    check();
    if (current.actorId.toLowerCase() !== captured.actorId || current.tenantId.toLowerCase() !== captured.tenantId) throw new MemoryReviewError('SCOPE_CHANGED');
  };
  await resolve();
  check();
  const response = await client.rpc('get_paige_memory', {
    p_memory_types: null, p_limit: 1, p_user_id: null, p_tenant_id: null,
    p_review: { schema_version: 1, expected_actor: captured.actorId, expected_tenant: captured.tenantId, ...selected },
  });
  await resolve();
  check();
  if (response.error) {
    const code = object(response.error) ? response.error.code : null;
    throw new MemoryReviewError(code === 'PGRST202' || code === '42883' ? 'UNAVAILABLE' : 'READ_FAILED');
  }
  const result = response.data;
  if (!object(result) || result.tenant_id !== captured.tenantId) throw new MemoryReviewError('READBACK_MISMATCH');
  if (result.status === 'absent' && result.eligible_for_context === false && !('memory' in result)) return { status: 'absent_at_read' };
  if (result.status === 'retired' && result.eligible_for_context === false && object(result.memory)
    && uuid(result.memory.id) && result.memory.content === null && result.memory.is_active === false
    && (!('memory_id' in selected) || result.memory.id === selected.memory_id)
    && object(result.memory.metadata) && result.memory.metadata.confirmation_state === 'retired'
    && typeof result.memory.updated_at === 'string' && Number.isFinite(Date.parse(result.memory.updated_at))) {
    return { status: 'retired', memoryId: result.memory.id, updatedAt: result.memory.updated_at };
  }
  const item = result.memory;
  if (result.status !== 'present' || !object(item) || !uuid(item.id) || item.is_active !== true
    || !timestamp(item.updated_at) || !timestamp(item.created_at) || typeof item.content !== 'string'
    || typeof item.memory_type !== 'string' || !(item.source_thread_id === null || uuid(item.source_thread_id))
    || !object(item.metadata)) throw new MemoryReviewError('READBACK_MISMATCH');
  const metadata = item.metadata;
  const review = metadata.reviewed_save;
  if (!object(review) || review.schema_version !== 1 || review.expected_actor !== captured.actorId
    || review.expected_tenant !== captured.tenantId || !uuid(review.intent_id)
    || ('intent_id' in selected ? review.intent_id !== selected.intent_id : item.id !== selected.memory_id)
    || !sourceReference(review.source_reference, captured.tenantId) || metadata.confirmation_state !== 'confirmed'
    || metadata.confirmed_by !== captured.actorId || !timestamp(metadata.confirmed_at)
    || metadata.audience !== 'owner_personal' || !hash(metadata.reviewed_request_sha256)
    || typeof result.source_state !== 'string' || !['current', 'changed', 'unavailable'].includes(result.source_state)
    || result.eligible_for_context !== (result.source_state === 'current')
    || (result.source_state === 'current' ? typeof review.source_quote !== 'string' || !review.source_quote.length : 'source_quote' in review)) {
    throw new MemoryReviewError('READBACK_MISMATCH');
  }
  return { status: 'present', memoryId: item.id, updatedAt: item.updated_at, content: item.content,
    memoryType: item.memory_type, sourceThreadId: item.source_thread_id === null ? null : String(item.source_thread_id),
    sourceState: result.source_state as 'current' | 'changed' | 'unavailable',
    eligibleForContext: result.eligible_for_context, review: structuredClone(review) };
}

/** Logical retirement through the original selected-version writer. This does
 * not assert physical cleanup or source deletion, and does not repeat effects.
 */
export async function forgetReviewedPaigeMemory(
  client: MemoryReviewClient, scope: MemoryReviewScope, target: { memoryId: string; updatedAt: string },
): Promise<{ status: 'retired'; memoryId: string; effect: 'retired_now' | 'already_retired'; replayed: false }> {
  const captured = { actorId: scope.actorId.toLowerCase(), tenantId: scope.tenantId.toLowerCase(), isCurrent: scope.isCurrent };
  const memoryId = target.memoryId.toLowerCase();
  const updatedAt = target.updatedAt; // Preserve server microseconds for CAS.
  if (!uuid(memoryId) || !timestamp(updatedAt) || !uuid(captured.actorId) || !uuid(captured.tenantId)) throw new MemoryReviewError('INPUT_INVALID');
  if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED');
  const current = await client.getScope();
  if (!captured.isCurrent() || current.actorId.toLowerCase() !== captured.actorId || current.tenantId.toLowerCase() !== captured.tenantId) throw new MemoryReviewError('SCOPE_CHANGED');
  try {
    const response = await client.rpc('forget_paige_memory', { p_id: memoryId, p_user_id: null, p_tenant_id: null,
      p_review: { schema_version: 1, expected_actor: captured.actorId, expected_tenant: captured.tenantId,
        memory_id: memoryId, expected_updated_at: updatedAt } });
    if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED', true);
    const result = response.data;
    if (response.error || !object(result) || result.status !== 'retired' || result.memory_id !== memoryId
      || result.verified_readback !== true || result.replayed !== false
      || typeof result.effect !== 'string' || !['retired_now', 'already_retired'].includes(result.effect)) throw new MemoryReviewError('FORGET_UNKNOWN', true);
    const readback = await readReviewedMemory(client, captured, { memory_id: memoryId });
    if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED', true);
    if (readback.status !== 'retired' || readback.memoryId !== memoryId) throw new MemoryReviewError('READBACK_MISMATCH', true);
    return { status: 'retired', memoryId, effect: result.effect as 'retired_now' | 'already_retired', replayed: false };
  } catch (error) {
    throw new MemoryReviewError(error instanceof MemoryReviewError ? error.code : 'FORGET_UNKNOWN', true);
  }
}

/** Exactly one explicitly reviewed save; transport uncertainty requires inspection
 * of this SAME intent. A returned ID alone never proves confirmed persistence.
 */
export async function saveReviewedPaigeMemory(client: MemoryReviewClient, scope: MemoryReviewScope, selection: ReviewedMemorySelection) {
  const captured = { actorId: scope.actorId.toLowerCase(), tenantId: scope.tenantId.toLowerCase(), isCurrent: scope.isCurrent };
  const input = structuredClone(selection);
  if (!uuid(input.intentId) || !uuid(captured.actorId) || !uuid(captured.tenantId)
    || Object.keys(input).some(k => !['intentId', 'memoryType', 'content', 'sourceReference', 'sourceQuote', 'sourceThreadId', 'supersedes'].includes(k))
    || typeof input.memoryType !== 'string' || !input.memoryType.length
    || typeof input.content !== 'string' || !input.content.trim().length || [...input.content].length > 4000
    || typeof input.sourceQuote !== 'string' || !input.sourceQuote.length || [...input.sourceQuote].length > 2000
    || !sourceReference(input.sourceReference, captured.tenantId)
    || (input.sourceThreadId !== undefined && !uuid(input.sourceThreadId))
    || (input.supersedes !== undefined && (!uuid(input.supersedes.memoryId) || !timestamp(input.supersedes.updatedAt)
      || Object.keys(input.supersedes).length !== 2))) throw new MemoryReviewError('INPUT_INVALID');
  input.intentId = input.intentId.toLowerCase();
  input.sourceReference.documentId = input.sourceReference.documentId.toLowerCase();
  if (input.sourceThreadId) input.sourceThreadId = input.sourceThreadId.toLowerCase();
  if (input.supersedes) input.supersedes.memoryId = input.supersedes.memoryId.toLowerCase();
  const review = { schema_version: 1, expected_actor: captured.actorId, expected_tenant: captured.tenantId,
    intent_id: input.intentId, source_reference: input.sourceReference, source_quote: input.sourceQuote,
    ...(input.supersedes ? { supersedes: { memory_id: input.supersedes.memoryId, updated_at: input.supersedes.updatedAt } } : {}) };
  if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED');
  const current = await client.getScope();
  if (!captured.isCurrent() || current.actorId.toLowerCase() !== captured.actorId || current.tenantId.toLowerCase() !== captured.tenantId) throw new MemoryReviewError('SCOPE_CHANGED');
  let attempted = false;
  try {
    attempted = true;
    const response = await client.rpc('record_paige_memory', {
      p_memory_type: input.memoryType, p_content: input.content, p_source_thread_id: input.sourceThreadId ?? null,
      p_metadata: {}, p_supersede_prior: !!input.supersedes, p_confirmation_state: 'confirmed',
      p_user_id: null, p_tenant_id: null, p_review: review,
    });
    if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED', true, input.intentId);
    if (response.error || !uuid(response.data)) throw new MemoryReviewError('SAVE_UNKNOWN', true, input.intentId);
    const saved = await inspectReviewedPaigeMemory(client, captured, input.intentId);
    if (!captured.isCurrent()) throw new MemoryReviewError('SCOPE_CHANGED', true, input.intentId);
    const expectedReview: Record<string, unknown> = structuredClone(review);
    if (saved.status === 'present' && saved.sourceState !== 'current') delete expectedReview.source_quote;
    if (saved.status !== 'present' || saved.memoryId !== response.data || saved.content !== input.content
      || saved.memoryType !== input.memoryType || saved.sourceThreadId !== (input.sourceThreadId ?? null)
      || !sameObject(saved.review, expectedReview)) throw new MemoryReviewError('READBACK_MISMATCH', true, input.intentId);
    return saved;
  } catch (error) {
    if (error instanceof MemoryReviewError) throw new MemoryReviewError(error.code, attempted || error.mutationMayHavePersisted, input.intentId);
    throw new MemoryReviewError('SAVE_UNKNOWN', attempted, input.intentId);
  }
}
