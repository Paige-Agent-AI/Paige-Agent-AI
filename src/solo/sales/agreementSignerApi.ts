import { z } from 'zod';
import { callAgreementRpc, type AgreementApiResult, type AgreementPreparation } from './agreementPreparationApi';

const uuid = z.string().uuid();
const role = z.enum(['counterparty', 'tenant_signatory', 'witness']);
const receiptSchema = z.object({
  schema_version: z.literal(1), state: z.enum(['recorded', 'replayed', 'recovered']),
  agreement_id: uuid, client_id: uuid, signer_id: uuid,
  full_name: z.string().min(1).max(200), email: z.string().min(3).max(320), signer_role: role,
  signing_order: z.number().int().positive().max(2_147_483_647), status: z.literal('pending'),
  source_version: z.number().int().positive().max(2_147_483_647),
  source_updated_at: z.string().datetime({ offset: true }), event_id: uuid,
}).strict();
const recoverySchema = z.union([receiptSchema.extend({ state: z.literal('recovered') }), z.object({ state: z.literal('unconfirmed') }).strict()]);
const commandSchema = z.object({
  tenantId: uuid, agreementId: uuid, clientId: uuid, signerId: uuid,
  expectedVersion: z.number().int().positive().max(2_147_483_646),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  fullName: z.string().min(1).max(200), email: z.string().max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  role, order: z.number().int().positive().max(2_147_483_647).nullable(),
}).strict();
export type AgreementSignerReceipt = z.infer<typeof receiptSchema>;
export type AgreementSignerCommand = z.infer<typeof commandSchema>;
export type AgreementSignerDraft = { fullName: string; email: string; role: z.infer<typeof role>; order: string };
export const emptySignerDraft = (): AgreementSignerDraft => ({ fullName: '', email: '', role: 'counterparty', order: '' });
export const canPrepareAgreementSigners = (a: AgreementPreparation['agreement']) =>
  a.can_edit && a.status === 'draft' && !a.content_sha256 && !a.sealed_sha256;
// Match the existing native btrim contract; do not rewrite supplied identities.
const nativeTrim = (value: string) => value.replace(/^ +| +$/g, '');
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const invalid = { ok: false, reason: 'refused', refusal: 'state', message: 'Review the original agreement and signer details before continuing.' } as const;
const unverifiable = { ok: false, reason: 'unconfirmed', message: 'The original signer preparation could not be verified. Check the same request before trying again.' } as const;

export function prepareAgreementSignerCommand(tenantId: string, original: AgreementPreparation['agreement'], signerId: string, draft: AgreementSignerDraft): AgreementSignerCommand | null {
  if (!canPrepareAgreementSigners(original) || !draft.fullName.trim() || (draft.order !== '' && !/^[1-9][0-9]*$/.test(draft.order))) return null;
  const parsed = commandSchema.safeParse({ tenantId, agreementId: original.id, clientId: original.contact_id, signerId,
    expectedVersion: original.version, expectedUpdatedAt: original.updated_at,
    fullName: nativeTrim(draft.fullName), email: nativeTrim(draft.email).toLowerCase(), role: draft.role,
    order: draft.order === '' ? null : Number(draft.order) });
  return parsed.success ? Object.freeze(parsed.data) : null;
}
export async function saveAgreementSigner(command: AgreementSignerCommand): Promise<AgreementApiResult<AgreementSignerReceipt>> {
  if (!commandSchema.safeParse(command).success) return invalid;
  const result = await callAgreementRpc('prepare_agreement_signer', {
    _expected_tenant_id: command.tenantId, _signing_id: command.agreementId, _expected_contact_id: command.clientId,
    _expected_version: command.expectedVersion, _expected_updated_at: command.expectedUpdatedAt,
    _signer_id: command.signerId, _full_name: command.fullName, _email: command.email,
    _signer_role: command.role, _signing_order: command.order,
  }, receiptSchema, true, ['23505']);
  if (result.ok === false) return result;
  const r = result.value;
  if (!sameId(r.agreement_id, command.agreementId) || !sameId(r.client_id, command.clientId) || !sameId(r.signer_id, command.signerId)
    || r.full_name !== command.fullName || r.email !== command.email || r.signer_role !== command.role
    || (command.order !== null && r.signing_order !== command.order) || r.source_version !== command.expectedVersion + 1
    || r.state === 'recovered') return unverifiable;
  return result;
}
export async function recoverAgreementSigner(tenantId: string, agreementId: string, clientId: string, signerId: string): Promise<AgreementApiResult<z.infer<typeof recoverySchema>>> {
  if (![tenantId, agreementId, clientId, signerId].every(value => uuid.safeParse(value).success)) return invalid;
  const result = await callAgreementRpc('recover_agreement_signer_preparation', {
    _expected_tenant_id: tenantId, _signing_id: agreementId, _signer_id: signerId,
  }, recoverySchema, true);
  if (result.ok === true && result.value.state === 'recovered' && (!sameId(result.value.agreement_id, agreementId)
    || !sameId(result.value.client_id, clientId) || !sameId(result.value.signer_id, signerId))) return unverifiable;
  return result;
}
