import { UUID, object } from '../sales-collections/primitives.ts';
import { canonicalPresentationJson } from './preparation-json.ts';
import { sha256Hex } from './token.ts';

/** Internal native preparation data, not authority, approval or signing evidence.
 * The eventual domain boundary must resolve source and document from the original
 * authorized records/bytes, never trust client-supplied source or page geometry. */
export type AgreementPdfPage = {
  page: number; crop_x: number; crop_y: number; crop_width: number; crop_height: number;
  rotation: 0 | 90 | 180 | 270; width: number; height: number;
};
export type AgreementPdfDocument = { sha256: string; byte_length: number; pages: AgreementPdfPage[] };
export type AgreementField = {
  id: string; signer_id: string; kind: 'signature' | 'initials' | 'signed_date' | 'text' | 'checkbox';
  page: number; x: number; y: number; width: number; height: number; required: boolean; label: string;
};
export type AgreementFieldIssue =
  | { code: 'missing_signer' }
  | { code: 'missing_signature'; signer_id: string }
  | { code: 'overlapping_fields'; field_ids: [string, string] };
export type AgreementFieldPreparation = {
  manifest: {
    schema_version: 1;
    source: { tenant_id: string; agreement_id: string; client_id: string; version: number; updated_at: string };
    document: AgreementPdfDocument;
    signers: { id: string; identity_sha256: string; signer_role: 'counterparty' | 'tenant_signatory' | 'witness'; signing_order: number }[];
    fields: AgreementField[];
  };
  preparation_sha256: string; ready_for_review: boolean; issues: AgreementFieldIssue[];
};
const fail = (): never => { throw new TypeError('AGREEMENT_FIELD_PREPARATION_INVALID'); };
const closed = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(v, k))) return fail();
  return v;
};
const id = (v: unknown): string => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : fail();
const integer = (v: unknown, min: number, max: number): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const finite = (v: unknown, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && !Object.is(v, -0) ? v : fail();
const text = (v: unknown, max: number): string =>
  typeof v === 'string' && v.length <= max && v.trim().length > 0
    && ![...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ? v : fail();
const hash = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail();
const timestamp = (v: unknown): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    || !Number.isFinite(Date.parse(v))) return fail();
  // Preserve the original microsecond CAS token, not Date's millisecond roundtrip.
  const day = new Date(v.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== v.slice(0, 10)) return fail();
  return v;
};

export function readAgreementPdfDocument(value: unknown): AgreementPdfDocument {
  const d = closed(value, ['sha256', 'byte_length', 'pages']);
  if (!Array.isArray(d.pages) || d.pages.length < 1 || d.pages.length > 250) return fail();
  return { sha256: hash(d.sha256), byte_length: integer(d.byte_length, 5, 26214400), pages: Array.from(d.pages).map((value, index) => {
    const p = closed(value, ['page', 'crop_x', 'crop_y', 'crop_width', 'crop_height', 'rotation', 'width', 'height']);
    const page = integer(p.page, 1, 250), rotation = integer(p.rotation, 0, 270);
    if (page !== index + 1 || ![0, 90, 180, 270].includes(rotation)) return fail();
    const crop_width = finite(p.crop_width, 1, 14400), crop_height = finite(p.crop_height, 1, 14400);
    const width = finite(p.width, 1, 14400), height = finite(p.height, 1, 14400);
    if (width !== (rotation % 180 ? crop_height : crop_width) || height !== (rotation % 180 ? crop_width : crop_height)) return fail();
    return { page, crop_x: finite(p.crop_x, -14400, 14400), crop_y: finite(p.crop_y, -14400, 14400), crop_width, crop_height,
      rotation: rotation as AgreementPdfPage['rotation'], width, height };
  }) };
}

/** Coordinates are PDF points from the visible, rotated crop's TOP LEFT, at
 * scale 1. CSS pixels, browser zoom and percentage prototype values never enter
 * this contract. Future display and stamping must use this same page descriptor. */
export async function prepareAgreementFields(sourceValue: unknown, documentValue: unknown, fieldsValue: unknown): Promise<AgreementFieldPreparation> {
  try { [sourceValue, documentValue, fieldsValue] = structuredClone([sourceValue, documentValue, fieldsValue]); } catch { return fail(); }
  const s = closed(sourceValue, ['tenant_id', 'agreement_id', 'client_id', 'version', 'updated_at', 'status', 'signers']);
  if (s.status !== 'draft' || !Array.isArray(s.signers) || s.signers.length > 100) return fail();
  const source = { tenant_id: id(s.tenant_id), agreement_id: id(s.agreement_id), client_id: id(s.client_id),
    version: integer(s.version, 1, Number.MAX_SAFE_INTEGER), updated_at: timestamp(s.updated_at) };
  const document = readAgreementPdfDocument(documentValue);
  const seenSigners = new Set<string>();
  const signers: AgreementFieldPreparation['manifest']['signers'] = [];
  for (const value of s.signers) {
    const signer = closed(value, ['id', 'full_name', 'email', 'signer_role', 'signing_order', 'status']);
    const signerId = id(signer.id);
    if (seenSigners.has(signerId) || signer.status !== 'pending'
      || !['counterparty', 'tenant_signatory', 'witness'].includes(String(signer.signer_role))) return fail();
    seenSigners.add(signerId);
    const full_name = text(signer.full_name, 300), email = text(signer.email, 320);
    const signer_role = signer.signer_role as 'counterparty' | 'tenant_signatory' | 'witness';
    const signing_order = integer(signer.signing_order, 1, 2147483647);
    signers.push({ id: signerId, identity_sha256: await sha256Hex(canonicalPresentationJson({ id: signerId, full_name, email, signer_role, signing_order })), signer_role, signing_order });
  }
  // Equal order is legitimate parallel signing. Do not invent a new sequence.
  signers.sort((a, b) => a.signing_order - b.signing_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!Array.isArray(fieldsValue) || fieldsValue.length > 500) return fail();
  const seenFields = new Set<string>();
  const fields: AgreementField[] = Array.from(fieldsValue).map(value => {
    const f = closed(value, ['id', 'signer_id', 'kind', 'page', 'x', 'y', 'width', 'height', 'required', 'label']);
    const fieldId = id(f.id), signer_id = id(f.signer_id);
    if (seenFields.has(fieldId) || !seenSigners.has(signer_id) || !['signature', 'initials', 'signed_date', 'text', 'checkbox'].includes(String(f.kind))
      || typeof f.required !== 'boolean' || f.kind === 'signature' && !f.required) return fail();
    seenFields.add(fieldId);
    const page = integer(f.page, 1, document.pages.length), p = document.pages[page - 1];
    const x = finite(f.x, 0, p.width), y = finite(f.y, 0, p.height);
    const width = finite(f.width, 1, p.width), height = finite(f.height, 1, p.height);
    if (x + width > p.width || y + height > p.height) return fail();
    return { id: fieldId, signer_id, kind: f.kind as AgreementField['kind'], page, x, y, width, height, required: f.required, label: text(f.label, 160) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const issues: AgreementFieldIssue[] = [];
  if (!signers.length) issues.push({ code: 'missing_signer' });
  for (const signer of signers) if (!fields.some(f => f.signer_id === signer.id && f.kind === 'signature' && f.required)) issues.push({ code: 'missing_signature', signer_id: signer.id });
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    const a = fields[i], b = fields[j];
    if (a.page === b.page && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
      issues.push({ code: 'overlapping_fields', field_ids: [a.id, b.id] });
  }
  const manifest = { schema_version: 1 as const, source, document, signers, fields };
  // Return the reviewed snapshot, not mutable aliases paired with an old digest.
  for (const page of document.pages) Object.freeze(page);
  Object.freeze(document.pages); Object.freeze(document); Object.freeze(source);
  for (const signer of signers) Object.freeze(signer);
  for (const field of fields) Object.freeze(field);
  Object.freeze(signers); Object.freeze(fields); Object.freeze(manifest);
  for (const issue of issues) { if (issue.code === 'overlapping_fields') Object.freeze(issue.field_ids); Object.freeze(issue); }
  Object.freeze(issues);
  return Object.freeze({ manifest, preparation_sha256: await sha256Hex(canonicalPresentationJson(manifest)), ready_for_review: issues.length === 0, issues });
}
