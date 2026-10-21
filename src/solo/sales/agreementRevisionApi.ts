import { z } from 'zod';
import { callAgreementRpc, type AgreementApiResult } from './agreementPreparationApi';

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const positive = z.number().int().positive().safe();
const source = z.enum(['paige_draft', 'tenant_template', 'tenant_upload']);
const retained = {
  id: uuid, revision_no: positive, source_body_version: positive,
  source_updated_at: instant, title: z.string().min(1), body_source: source,
  retained_at: instant, retained_by: uuid.nullable(),
  snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const page = z.object({
  agreement_id: uuid, current_source_version: positive, current_updated_at: instant,
  revisions: z.array(z.object(retained).strict()).max(20),
  truncated: z.boolean(), next_before_revision_no: positive.nullable(),
}).strict();
const wording = z.object({
  ...retained, agreement_id: uuid, contact_id: uuid, offer_id: uuid.nullable(),
  commercial_terms_id: uuid.nullable(), source_version_id: uuid.nullable(),
  body_markdown: z.string().nullable(), has_source_document: z.boolean(),
}).strict().refine(value => value.body_source === 'tenant_upload'
  ? value.body_markdown === null && value.has_source_document
  : value.body_markdown !== null && value.body_markdown.trim().length > 0 && !value.has_source_document);
export type AgreementRevisionPage = z.infer<typeof page>;
export type AgreementRetainedWording = z.infer<typeof wording>;
const invalid = { ok: false, reason: 'refused', message: 'Open wording history from the original agreement and business.' } as const;
const unverified = { ok: false, reason: 'unconfirmed', message: 'The saved wording could not be verified. Read this agreement again before continuing.' } as const;
const sameId = (one: string, two: string) => one.toLowerCase() === two.toLowerCase();

export async function readAgreementRevisions(tenantId: string, agreementId: string, before?: number): Promise<AgreementApiResult<AgreementRevisionPage>> {
  if (!uuid.safeParse(tenantId).success || !uuid.safeParse(agreementId).success || (before !== undefined && !positive.safeParse(before).success)) return invalid;
  const result = await callAgreementRpc('read_paige_agreement_draft_revisions', {
    _expected_tenant_id: tenantId, _signing_id: agreementId, _limit: 20, _before_revision_no: before ?? null,
  }, page);
  if (result.ok === false) return result;
  const value = result.value, rows = value.revisions;
  if (!sameId(value.agreement_id, agreementId) ||
    new Set(rows.map(row => row.id.toLowerCase())).size !== rows.length ||
    rows.some((row, index) => (index > 0 && row.revision_no >= rows[index - 1].revision_no) || (before !== undefined && row.revision_no >= before)) ||
    (value.truncated ? rows.length === 0 || value.next_before_revision_no !== rows.at(-1)?.revision_no : value.next_before_revision_no !== null)) return unverified;
  return result;
}

export async function readAgreementRetainedWording(tenantId: string, agreementId: string, revisionId: string): Promise<AgreementApiResult<AgreementRetainedWording>> {
  if (![tenantId, agreementId, revisionId].every(id => uuid.safeParse(id).success)) return invalid;
  const result = await callAgreementRpc('read_paige_agreement_draft_revision', {
    _expected_tenant_id: tenantId, _signing_id: agreementId, _revision_id: revisionId,
  }, wording);
  if (result.ok === true && (!sameId(result.value.agreement_id, agreementId) || !sameId(result.value.id, revisionId))) return unverified;
  return result;
}
