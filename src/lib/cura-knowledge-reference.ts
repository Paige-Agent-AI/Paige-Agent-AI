/** A source address is a reference, never actor, business or publishing authority. */
export type CuraKnowledgeReference = { documentId: string | null; invalid: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCuraKnowledgeReference(params: URLSearchParams): CuraKnowledgeReference | null {
  const views = params.getAll('view');
  if (!views.includes('knowledge')) return null;
  if (views.length !== 1) return { documentId: null, invalid: true };
  const sources = params.getAll('source');
  if (!sources.length) return { documentId: null, invalid: false };
  if (sources.length !== 1 || !UUID.test(sources[0])) return { documentId: null, invalid: true };
  return { documentId: sources[0].toLowerCase(), invalid: false };
}

export function curaKnowledgeReferenceKey(reference: CuraKnowledgeReference | null | undefined) {
  return reference ? reference.invalid ? 'invalid' : reference.documentId ?? 'all' : '';
}
