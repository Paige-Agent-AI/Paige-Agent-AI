import { UUID } from '../sales-collections/primitives.ts';

/** A reference to existing commercial records, never an agreement acceptance or authority. */
export type CommercialTermsReference = { id: string; version: number };
export function parseCommercialTermsReference(value: unknown): CommercialTermsReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('INVALID_COMMERCIAL_TERMS_REFERENCE');
  const reference = value as Record<string, unknown>;
  if (Object.keys(reference).length !== 2 || Object.keys(reference).some(key => key !== 'id' && key !== 'version')
    || typeof reference.id !== 'string' || !UUID.test(reference.id)
    || !Number.isSafeInteger(reference.version) || Number(reference.version) < 0) throw new TypeError('INVALID_COMMERCIAL_TERMS_REFERENCE');
  return { id: reference.id, version: Number(reference.version) };
}
