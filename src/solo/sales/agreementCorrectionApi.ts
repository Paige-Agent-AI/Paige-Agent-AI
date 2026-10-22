import { z } from 'zod';
import { callAgreementRpc, type AgreementApiResult, type AgreementPreparation } from './agreementPreparationApi';

type Original = AgreementPreparation['agreement'];
export type AgreementCorrectionCommand = Readonly<{
  tenantId: string; agreementId: string; clientId: string; offerId: string | null;
  commercialTermsId: string | null; source: 'paige_draft' | 'tenant_template';
  sourceVersionId: string | null; expectedUpdatedAt: string; expectedVersion: number;
  title: string; body: string;
}>;
const uuid = z.string().uuid(), date = z.string().datetime({ offset: true });
const commandSchema = z.object({ tenantId: uuid, agreementId: uuid, clientId: uuid,
  offerId: uuid.nullable(), commercialTermsId: uuid.nullable(), source: z.enum(['paige_draft','tenant_template']),
  sourceVersionId: uuid.nullable(), expectedUpdatedAt: date, expectedVersion: z.number().int().positive(),
  title: z.string().refine(value => Boolean(value.trim())), body: z.string().refine(value => Boolean(value.trim())),
}).strict().refine(value => value.source === 'tenant_template' ? value.sourceVersionId !== null : value.sourceVersionId === null);
const sameId = (left: string | null, right: string | null) => left?.toLowerCase() === right?.toLowerCase();
/** Original SAVE uses PostgreSQL btrim(text), which removes U+0020 only.
 * Preserve legal source line breaks/tabs; JS trim would misverify its receipt. */
export function nativeAgreementText(value: string) {
  let start=0,end=value.length;
  while(start<end && value[start]===' ') start++;
  while(end>start && value[end-1]===' ') end--;
  return value.slice(start,end);
}

/** Capture one reviewed original. A later read NEVER refreshes this command. */
export function prepareAgreementCorrection(tenantId: string, original: Original, title: string, body: string): AgreementCorrectionCommand | null {
  if (!uuid.safeParse(tenantId).success || !uuid.safeParse(original.id).success || !uuid.safeParse(original.contact_id).success
    || !date.safeParse(original.updated_at).success || !original.can_edit || original.status !== 'draft'
    || original.content_sha256 !== null || original.sealed_sha256 !== null || original.has_source_document
    || original.body_source === 'tenant_upload' || original.body_markdown === null || !title.trim() || !body.trim()
    || (nativeAgreementText(title) === original.title && nativeAgreementText(body) === original.body_markdown)) return null;
  const command = { tenantId, agreementId: original.id, clientId: original.contact_id,
    offerId: original.offer_id, commercialTermsId: original.commercial_terms_id,
    source: original.body_source, sourceVersionId: original.source_version_id,
    expectedUpdatedAt: original.updated_at, expectedVersion: original.version + (nativeAgreementText(body) === original.body_markdown ? 0 : 1),
    title, body };
  return commandSchema.safeParse(command).success ? Object.freeze(command) : null;
}

// SAVE is an incumbent full-row writer. Project only its closed acknowledgment
// fields before validation; private artifact/request fields never leave this seam.
const fields = { id: uuid, tenant_id: uuid, contact_id: uuid, offer_id: uuid.nullable(), commercial_terms_id: uuid.nullable(),
  title: z.string(), body_markdown: z.string(), body_source: z.enum(['paige_draft', 'tenant_template']), source_version_id: uuid.nullable(),
  status: z.literal('draft'), version: z.number().int().positive(), updated_at: date };
const saved = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(fields).map(key => [key, row[key]]));
}, z.object(fields).strict());

export async function saveAgreementCorrection(command: AgreementCorrectionCommand): Promise<AgreementApiResult<{ agreementId: string; version: number; updatedAt: string }>> {
  if (!commandSchema.safeParse(command).success) return { ok:false, reason:'refused', refusal:'state', message:'Reopen the original editable agreement before preparing this correction.' };
  const result = await callAgreementRpc('save_paige_agreement', {
    _expected_tenant_id: command.tenantId, _agreement_id: command.agreementId, _contact_id: command.clientId,
    _title: command.title, _body_markdown: command.body, _offer_id: command.offerId,
    _commercial_terms_id: command.commercialTermsId, _body_source: command.source,
    _source_version_id: command.sourceVersionId, _document_path: null, _expected_updated_at: command.expectedUpdatedAt,
  }, saved, true);
  if (result.ok === false) return result;
  const row = result.value;
  if (!sameId(row.id, command.agreementId) || !sameId(row.tenant_id, command.tenantId) || !sameId(row.contact_id, command.clientId)
    || !sameId(row.offer_id, command.offerId) || !sameId(row.commercial_terms_id, command.commercialTermsId)
    || !sameId(row.source_version_id, command.sourceVersionId) || row.body_source !== command.source
    || row.title !== nativeAgreementText(command.title) || row.body_markdown !== nativeAgreementText(command.body)
    || row.version !== command.expectedVersion || row.updated_at === command.expectedUpdatedAt) {
    return { ok: false, reason: 'unconfirmed', message: 'The correction acknowledgment could not be verified. Inspect the same agreement before deciding what to do next.' };
  }
  return { ok: true, value: { agreementId: row.id, version: row.version, updatedAt: row.updated_at } };
}
