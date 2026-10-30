import { sourceHash, type ExtractionRpc } from './knowledge-extraction.ts';

/** Canonical text identity, not proof of original-file extraction or approved facts. */
export type KnowledgeSourceReference = {
  contractVersion: 1;
  tenantId: string;
  documentId: string;
  revision: number;
  contentSha256: string;
};
type Range = { start: number; end: number };
type Request = {
  tenantId: string;
  documentId: string;
  excerpts: Range[];
  expected?: KnowledgeSourceReference;
};
type UnavailableReason = 'input_invalid' | 'scope_changed' | 'read_failed' | 'source_unavailable' | 'source_changed';
export type KnowledgeSourceEvidence = {
  status: 'available';
  reference: KnowledgeSourceReference;
  title: string;
  excerpts: (Range & { text: string })[];
  factConfirmation: 'not_asserted';
  originalFileEvidence: 'unavailable';
} | { status: 'unavailable'; reason: UnavailableReason };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const unavailable = (reason: UnavailableReason): KnowledgeSourceEvidence => ({ status: 'unavailable', reason });
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validReference(value: KnowledgeSourceReference, tenant: string, document: string): boolean {
  const r = object(value);
  return !!r && r.contractVersion === 1 && r.tenantId === tenant && r.documentId === document &&
    Number.isSafeInteger(r.revision) && Number(r.revision) > 0 && typeof r.contentSha256 === 'string' && HASH.test(r.contentSha256);
}
function splitsSurrogate(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1); const next = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

/**
 * Caller must be the existing authenticated JWT client, never service_role.
 * isCurrent captures a request incarnation (not just tenant equality), and must
 * remain false after cancellation/workspace departure, including A -> B -> A.
 * No authority is cached: call again before proposing/effecting use; native
 * writers still own atomic current-authority/admission checks at the effect.
 * Text is untrusted DATA. This helper never invokes a model, tool or writer.
 */
export async function readKnowledgeSourceEvidence(
  caller: ExtractionRpc, request: Request, isCurrent: () => boolean,
): Promise<KnowledgeSourceEvidence> {
  // Snapshot before the first await: caller edits cannot retarget a pending read.
  let tenantId: string, documentId: string, excerpts: Range[], expected: KnowledgeSourceReference | undefined;
  try {
    tenantId = request.tenantId; documentId = request.documentId;
    if (!UUID.test(tenantId) || !UUID.test(documentId) || !Array.isArray(request.excerpts) || request.excerpts.length > 20) return unavailable('input_invalid');
    excerpts = request.excerpts.map(r => ({ start: r.start, end: r.end }));
    if (excerpts.some(r => !Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 0 || r.end <= r.start) ||
      excerpts.reduce((n, r) => n + r.end - r.start, 0) > 12000) return unavailable('input_invalid');
    if (request.expected !== undefined) {
      if (!validReference(request.expected, tenantId, documentId)) return unavailable('input_invalid');
      expected = { ...request.expected };
    }
    if (!isCurrent()) return unavailable('scope_changed');
  } catch { return unavailable('input_invalid'); }
  try {
    const response = await caller.rpc('read_tenant_knowledge', {
      p_expected_tenant: tenantId, p_doc_id: documentId, p_limit: 1, p_offset: 0,
    });
    if (!isCurrent()) return unavailable('scope_changed');
    if (response.error) return unavailable('read_failed');
    const data = object(response.data);
    if (!data || data.tenant_id !== tenantId || !Array.isArray(data.documents) || data.documents.length !== 1) return unavailable('source_unavailable');
    const row = object(data.documents[0]);
    if (!row || row.id !== documentId || row.tenant_id !== tenantId || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
      typeof row.content !== 'string' || row.content.length === 0 || row.content.length > 480000 || row.content.includes('\0') ||
      typeof row.title !== 'string' || row.title.length > 300) return unavailable('source_unavailable');
    // Copy only safe scalar fields from authoritative readback. No raw source URL,
    // storage path, object metadata or pending/unreviewed extraction is forwarded.
    const content = row.content; const revision = Number(row.revision); const title = row.title;
    const contentSha256 = await sourceHash(new TextEncoder().encode(content));
    if (!isCurrent()) return unavailable('scope_changed');
    if (expected && (expected.revision !== revision || expected.contentSha256 !== contentSha256)) return unavailable('source_changed');
    if (excerpts.some(r => r.end > content.length || splitsSurrogate(content, r.start) || splitsSurrogate(content, r.end))) return unavailable('input_invalid');
    return {
      status: 'available', reference: { contractVersion: 1, tenantId, documentId, revision, contentSha256 }, title,
      excerpts: excerpts.map(r => ({ ...r, text: content.slice(r.start, r.end) })),
      factConfirmation: 'not_asserted', originalFileEvidence: 'unavailable',
    };
  } catch { return unavailable('read_failed'); }
}
