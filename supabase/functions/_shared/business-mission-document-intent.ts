import type { KnowledgeSourceEvidence, KnowledgeSourceReference } from './knowledge-source-evidence.ts';

type Source = {
  reference: KnowledgeSourceReference;
  title: string;
  excerpts: Extract<KnowledgeSourceEvidence, { status: 'available' }>['excerpts'];
};
export type DocumentWorkStep = {
  id: string;
  title: string;
  description: string;
  responsible: { kind: 'unassigned' } | { kind: 'person'; userId: string } | { kind: 'specialist'; alias: string };
  dueOn: string | null;
  dependencies: string[];
  sourceIds: string[];
  basis: 'recommendation' | 'source_obligation';
  proposedTask: { action: 'task.create'; assigneeUserId: string | null };
};

/** Draft data in the ORIGINAL immutable Mission brief. Never runtime authority. */
export type DocumentWorkIntent = { contractVersion: 1; sources: Source[]; steps: DocumentWorkStep[] };
type Normalized = { ok: true; intent: DocumentWorkIntent | null } | { ok: false; code: 'MISSION_DOCUMENT_INTENT_INVALID' };
const invalid = (): Normalized => ({ ok: false, code: 'MISSION_DOCUMENT_INTENT_INVALID' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const uuid = (v: unknown): string | null => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0') ? v.trim() : null;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function identifiers(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const ids = v.map(uuid);
  return ids.some(x => !x) || new Set(ids).size !== ids.length ? null : ids as string[];
}
function date(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

/**
 * Structural admission only: no reads, tools, approval or permission inference.
 * The original native writer must independently lock/revalidate every source.
 * undefined is deliberately invalid; the caller preserves OMITTED separately.
 * null means an explicit clear, recorded as a NEW immutable brief version.
 */
export function normalizeDocumentWorkIntent(value: unknown, expectedTenantId: string): Normalized {
  const tenant = uuid(expectedTenantId);
  if (!tenant) return invalid();
  if (value === null) return { ok: true, intent: null };
  const input = object(value);
  if (!input || !keys(input, ['contractVersion', 'sources', 'steps']) || input.contractVersion !== 1 ||
    !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 20 ||
    !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 50) return invalid();
  const sources: Source[] = [];
  const sourceIds = new Set<string>();
  let quoteUnits = 0;
  for (const raw of input.sources) {
    const source = object(raw), ref = source && object(source.reference);
    // The permitted source title is evidence metadata, not an editable step.
    const title = source && typeof source.title === 'string' && text(source.title, 300) !== null ? source.title : null;
    const docId = ref && uuid(ref.documentId);
    if (!source || !keys(source, ['reference', 'title', 'excerpts']) || !ref ||
      !keys(ref, ['contractVersion', 'tenantId', 'documentId', 'revision', 'contentSha256']) ||
      ref.contractVersion !== 1 || uuid(ref.tenantId) !== tenant || !docId || sourceIds.has(docId) ||
      !positive(ref.revision) || ref.revision > 2147483647 || typeof ref.contentSha256 !== 'string' || !HASH.test(ref.contentSha256) || !title ||
      !Array.isArray(source.excerpts) || source.excerpts.length < 1 || source.excerpts.length > 20) return invalid();
    const excerpts: Source['excerpts'] = [];
    for (const rawExcerpt of source.excerpts) {
      const e = object(rawExcerpt);
      if (!e || !keys(e, ['start', 'end', 'text']) || !Number.isSafeInteger(e.start) || Number(e.start) < 0 ||
        !positive(e.end) || Number(e.end) <= Number(e.start) || Number(e.end) > 480000 ||
        typeof e.text !== 'string' || e.text.includes('\0') || e.text.length !== Number(e.end) - Number(e.start)) return invalid();
      quoteUnits += e.text.length;
      if (quoteUnits > 12000) return invalid();
      excerpts.push({ start: Number(e.start), end: Number(e.end), text: e.text });
    }
    sourceIds.add(docId);
    sources.push({ reference: { contractVersion: 1, tenantId: tenant, documentId: docId, revision: ref.revision,
      contentSha256: ref.contentSha256 }, title, excerpts });
  }
  const steps: DocumentWorkStep[] = [];
  const stepIds = new Set<string>();
  for (const raw of input.steps) {
    const step = object(raw), responsible = step && object(step.responsible), proposed = step && object(step.proposedTask);
    const id = step && uuid(step.id), title = step && text(step.title, 180), description = step && text(step.description, 4000);
    const dependencies = step && identifiers(step.dependencies, 49), citations = step && identifiers(step.sourceIds, 20);
    if (!step || !keys(step, ['id', 'title', 'description', 'responsible', 'dueOn', 'dependencies', 'sourceIds', 'basis', 'proposedTask']) ||
      !id || stepIds.has(id) || !title || !description || !responsible || !proposed || !dependencies || !citations ||
      !date(step.dueOn) || (step.basis !== 'recommendation' && step.basis !== 'source_obligation') ||
      (step.basis === 'source_obligation' && citations.length === 0) || citations.some(x => !sourceIds.has(x)) ||
      !keys(proposed, ['action', 'assigneeUserId']) || proposed.action !== 'task.create' ||
      (proposed.assigneeUserId !== null && !uuid(proposed.assigneeUserId))) return invalid();
    let who: DocumentWorkStep['responsible'];
    if (responsible.kind === 'unassigned' && keys(responsible, ['kind'])) who = { kind: 'unassigned' };
    else if (responsible.kind === 'person' && keys(responsible, ['kind', 'userId']) && uuid(responsible.userId)) {
      who = { kind: 'person', userId: uuid(responsible.userId)! };
    } else if (responsible.kind === 'specialist' && keys(responsible, ['kind', 'alias']) && text(responsible.alias, 80)) {
      who = { kind: 'specialist', alias: text(responsible.alias, 80)! };
    } else return invalid();
    const assigneeUserId = uuid(proposed.assigneeUserId);
    // A display alias cannot confer a person's assignment or delegation.
    if (assigneeUserId !== null && (who.kind !== 'person' || who.userId !== assigneeUserId)) return invalid();
    stepIds.add(id);
    steps.push({ id, title, description, responsible: who, dueOn: step.dueOn, dependencies, sourceIds: citations,
      basis: step.basis as DocumentWorkStep['basis'], proposedTask: { action: 'task.create', assigneeUserId } });
  }
  const byId = new Map(steps.map(s => [s.id, s]));
  const visiting = new Set<string>(), done = new Set<string>();
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    const step = byId.get(id);
    if (!step) return true;
    visiting.add(id);
    if (step.dependencies.some(cyclic)) return true;
    visiting.delete(id); done.add(id);
    return false;
  }
  if (steps.some(s => cyclic(s.id))) return invalid();
  return { ok: true, intent: { contractVersion: 1, sources, steps } };
}

