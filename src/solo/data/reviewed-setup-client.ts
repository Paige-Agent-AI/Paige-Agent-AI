import { parseReviewedSetupSelection } from '../settings-setup-contract.ts';
import type { ReviewedSetupFact, ReviewedSetupFactField } from '../settings-setup-contract.ts';

/** Unmounted original Setup adapter. Scope is the existing host's resolver and
 * permanently negative incarnation fence, not a new permission resolver. */
export interface ReviewedSetupScope { actorId: string; tenantId: string; isCurrent(): boolean }
export interface ReviewedSetupPort {
  getScope(): PromiseLike<{ actorId: string; tenantId: string }>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export class ReviewedSetupError extends Error {
  readonly code: string;
  readonly mayHaveSaved: boolean;
  readonly requestId?: string;
  constructor(code: string, mayHaveSaved = false, requestId?: string) {
    super('The reviewed Setup result could not be verified.');
    this.code = code; this.mayHaveSaved = mayHaveSaved; this.requestId = requestId;
  }
}
export interface ReviewedSetupReceipt {
  schemaVersion: 1; receiptId: string; requestId: string; reviewId: string;
  actorId: string; tenantId: string; purpose: 'setup_business_facts';
  selectedFacts: ReviewedSetupFact[]; selectionHash: string;
  updatedAt: string; contextRevision: number;
}
export type ReviewedSetupInspection = { status: 'absent_at_read' }
  | { status: 'recorded'; receiptId: string; current: false; reason: 'setup_changed' | 'source_unavailable_or_changed' }
  | { status: 'recorded'; receiptId: string; current: true; receipt: ReviewedSetupReceipt };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
  return a === b;
}
const ordered = (facts: ReviewedSetupFact[]) => [...facts].sort((a, b) => (a.reference.documentId + a.field).localeCompare(b.reference.documentId + b.field));
function captureScope(scope: ReviewedSetupScope): ReviewedSetupScope {
  if (!uuid(scope.actorId) || !uuid(scope.tenantId)) throw new ReviewedSetupError('INPUT_INVALID');
  return { actorId: scope.actorId, tenantId: scope.tenantId, isCurrent: scope.isCurrent };
}
async function resolve(client: ReviewedSetupPort, scope: ReviewedSetupScope) {
  if (scope.isCurrent() !== true) throw new ReviewedSetupError('SCOPE_CHANGED');
  let current;
  try { current = await client.getScope(); } catch { throw new ReviewedSetupError('SCOPE_CHANGED'); }
  if (scope.isCurrent() !== true || current.actorId !== scope.actorId || current.tenantId !== scope.tenantId)
    throw new ReviewedSetupError('SCOPE_CHANGED');
}
function parseInspection(data: unknown, scope: ReviewedSetupScope, requestId: string): ReviewedSetupInspection {
  const invalid = (): never => { throw new ReviewedSetupError('READBACK_MISMATCH'); };
  if (!object(data)) return invalid();
  if (data.status === 'absent_at_read' && exact(data, ['status'])) return { status: 'absent_at_read' };
  if (data.status !== 'recorded' || !uuid(data.receiptId)) return invalid();
  if (data.current === false && exact(data, ['status', 'receiptId', 'current', 'reason'])
    && (data.reason === 'setup_changed' || data.reason === 'source_unavailable_or_changed'))
    return { status: 'recorded', receiptId: data.receiptId, current: false, reason: data.reason };
  const r = data.receipt;
  if (data.current !== true || !exact(data, ['status', 'receiptId', 'current', 'receipt']) || !object(r)
    || !exact(r, ['schemaVersion', 'receiptId', 'requestId', 'reviewId', 'actorId', 'tenantId', 'purpose', 'selectedFacts', 'selectionHash', 'updatedAt', 'contextRevision'])
    || r.receiptId !== data.receiptId || r.requestId !== requestId || r.actorId !== scope.actorId || r.tenantId !== scope.tenantId
    || r.purpose !== 'setup_business_facts' || typeof r.selectionHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.selectionHash)
    || typeof r.updatedAt !== 'string') return invalid();
  try {
    parseReviewedSetupSelection({ schemaVersion: r.schemaVersion, actorId: r.actorId, tenantId: r.tenantId,
      reviewId: r.reviewId, expectedUpdatedAt: r.updatedAt, expectedContextRevision: r.contextRevision, facts: r.selectedFacts });
  } catch { return invalid(); }
  return JSON.parse(JSON.stringify(data)) as ReviewedSetupInspection;
}
/** Same identity inspection also supports a later host reopening its ORIGINAL
 * stored request reference. Absence at read never automatically repeats a save. */
export async function inspectReviewedSetup(client: ReviewedSetupPort, inputScope: ReviewedSetupScope, requestId: string): Promise<ReviewedSetupInspection> {
  const scope = captureScope(inputScope);
  if (!uuid(requestId)) throw new ReviewedSetupError('INPUT_INVALID');
  await resolve(client, scope);
  let response;
  try {
    response = await client.rpc('inspect_solo_reviewed_business_facts', {
      _expected_tenant_id: scope.tenantId, _expected_actor_id: scope.actorId, _request_id: requestId,
    });
  } catch {
    await resolve(client, scope);
    throw new ReviewedSetupError('INSPECTION_FAILED');
  }
  await resolve(client, scope);
  if (response.error) throw new ReviewedSetupError('INSPECTION_FAILED');
  const result = parseInspection(response.data, scope, requestId);
  if (scope.isCurrent() !== true) throw new ReviewedSetupError('SCOPE_CHANGED');
  return result;
}

/** Discover original server-staged identity after a complete page reload. The
 * proposal is not approval; an uncertain save is inspected using its staged
 * review UUID before any explicit retry. No private facts enter browser storage. */
export async function readReviewedSetup(client: ReviewedSetupPort, inputScope: ReviewedSetupScope) {
  const scope = captureScope(inputScope);
  await resolve(client, scope);
  const response = await client.rpc('read_solo_reviewed_business_facts', {
    _expected_tenant_id: scope.tenantId, _expected_actor_id: scope.actorId,
  });
  await resolve(client, scope);
  if (response.error) throw new ReviewedSetupError('INSPECTION_FAILED');
  const data = response.data;
  if (!object(data) || !exact(data, ['proposal', 'approval'])) throw new ReviewedSetupError('READBACK_MISMATCH');
  const proposal = data.proposal === null ? null : parseReviewedSetupSelection(data.proposal);
  if (proposal && (proposal.actorId !== scope.actorId || proposal.tenantId !== scope.tenantId))
    throw new ReviewedSetupError('READBACK_MISMATCH');
  let approval: ReviewedSetupInspection | null = null;
  if (data.approval !== null) {
    if (!object(data.approval) || !exact(data.approval, ['requestId', 'inspection']) || !uuid(data.approval.requestId))
      throw new ReviewedSetupError('READBACK_MISMATCH');
    approval = parseInspection(data.approval.inspection, scope, data.approval.requestId);
    if (approval.status !== 'recorded') throw new ReviewedSetupError('READBACK_MISMATCH');
  }
  if (scope.isCurrent() !== true) throw new ReviewedSetupError('SCOPE_CHANGED');
  return { proposal, approval };
}
/** Explicit actions only. This ephemeral single-review handle is no durable
 * approval ledger. The original native APIs resolve ALL authority and effects. */
export function prepareReviewedSetup(client: ReviewedSetupPort, inputScope: ReviewedSetupScope, input: unknown) {
  const scope = captureScope(inputScope), selection = parseReviewedSetupSelection(input);
  if (selection.actorId !== scope.actorId || selection.tenantId !== scope.tenantId) throw new ReviewedSetupError('SCOPE_CHANGED');
  selection.facts = ordered(selection.facts);
  let busy = false, staged = false, needsInspection = false, completed = false;
  let pending: { requestId: string; fields: ReviewedSetupFactField[] } | null = null;
  const args = { _expected_tenant_id: scope.tenantId, _expected_actor_id: scope.actorId,
    _review_id: selection.reviewId, _expected_updated_at: selection.expectedUpdatedAt,
    _expected_context_revision: selection.expectedContextRevision };
  const begin = () => { if (busy) throw new ReviewedSetupError('BUSY'); busy = true; };
  const verifySelected = (result: ReviewedSetupInspection) => {
    if (result.status === 'recorded' && result.current) {
      const facts = selection.facts.filter(f => pending?.fields.includes(f.field));
      if (result.receipt.reviewId !== selection.reviewId || result.receipt.contextRevision !== selection.expectedContextRevision + 1
        || !same(ordered(result.receipt.selectedFacts), facts)) throw new ReviewedSetupError('READBACK_MISMATCH');
    }
  };
  return {
    async stage(): Promise<void> {
      begin();
      try {
        if (pending) throw new ReviewedSetupError('INSPECT_OR_FINISH_EXISTING_REQUEST');
        await resolve(client, scope);
        const response = await client.rpc('stage_solo_reviewed_business_facts', { ...args, _facts: JSON.parse(JSON.stringify(selection.facts)) });
        await resolve(client, scope);
        if (response.error || !same(response.data, selection)) throw new ReviewedSetupError('STAGE_UNVERIFIED');
        staged = true;
      } catch (error) {
        await resolve(client, scope);
        throw error instanceof ReviewedSetupError ? error : new ReviewedSetupError('STAGE_UNVERIFIED');
      } finally { busy = false; }
    },
    async approve(requestId: string, selectedFields: readonly ReviewedSetupFactField[]): Promise<ReviewedSetupInspection> {
      begin(); let dispatched = false;
      try {
        const fields = [...selectedFields].sort();
        if (!uuid(requestId) || fields.length < 1 || new Set(fields).size !== fields.length
          || fields.some(f => !selection.facts.some(fact => fact.field === f))) throw new ReviewedSetupError('INPUT_INVALID');
        if (!staged || completed) throw new ReviewedSetupError('REVIEW_REQUIRED');
        if (needsInspection) throw new ReviewedSetupError('INSPECTION_REQUIRED', true, pending?.requestId);
        if (pending && (pending.requestId !== requestId || !same(pending.fields, fields))) throw new ReviewedSetupError('REQUEST_CHANGED');
        await resolve(client, scope);
        pending = { requestId, fields };
        dispatched = true; needsInspection = true;
        const response = await client.rpc('save_solo_reviewed_business_facts', {
          ...args, _request_id: requestId, _selected_fields: [...fields], _purpose: 'setup_business_facts',
        });
        await resolve(client, scope);
        if (response.error) throw new ReviewedSetupError('SAVE_UNVERIFIED', true, requestId);
        const saved = parseInspection(response.data, scope, requestId);
        if (saved.status !== 'recorded') throw new ReviewedSetupError('READBACK_MISMATCH');
        verifySelected(saved);
        const readback = await inspectReviewedSetup(client, scope, requestId);
        if (readback.status !== 'recorded' || readback.receiptId !== saved.receiptId) throw new ReviewedSetupError('READBACK_MISMATCH');
        verifySelected(readback); completed = true; needsInspection = false;
        if (scope.isCurrent() !== true) throw new ReviewedSetupError('SCOPE_CHANGED');
        return readback;
      } catch (error) {
        if (dispatched) throw new ReviewedSetupError(error instanceof ReviewedSetupError ? error.code : 'SAVE_UNVERIFIED', true, pending?.requestId);
        throw error;
      } finally { busy = false; }
    },
    async reconcile(): Promise<ReviewedSetupInspection> {
      begin();
      try {
        if (!pending) throw new ReviewedSetupError('NO_REQUEST');
        const result = await inspectReviewedSetup(client, scope, pending.requestId);
        verifySelected(result);
        completed = result.status === 'recorded'; needsInspection = false;
        if (scope.isCurrent() !== true) throw new ReviewedSetupError('SCOPE_CHANGED');
        return result;
      } finally { busy = false; }
    },
  };
}
