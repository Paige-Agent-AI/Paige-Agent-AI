import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const uuid = z.string().uuid();
const date = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/).nullable();
const signatureState = z.enum(['draft', 'sent', 'viewed', 'partially_signed', 'completed', 'declined', 'voided', 'expired']);
const receiptFields = {
  signing_id: uuid, signature_state: signatureState, version: z.number().int().positive(),
  updated_at: date, creation_event_id: uuid,
};
const recoveredReceipt = z.object({ state: z.literal('recovered'), ...receiptFields }).strict();
const creationReceipt = z.union([
  z.object({ state: z.literal('created'), ...receiptFields }).strict(), recoveredReceipt,
]);
const reconciliation = z.union([recoveredReceipt, z.object({ state: z.literal('unconfirmed') }).strict()]);
const preparation = z.object({
  agreement: z.object({
    id: uuid, contact_id: uuid, offer_id: uuid.nullable(), commercial_terms_id: uuid.nullable(),
    title: z.string().min(1), body_source: z.enum(['paige_draft', 'tenant_template', 'tenant_upload']),
    source_version_id: uuid.nullable(), body_markdown: z.string().nullable(), has_source_document: z.boolean(),
    status: signatureState, version: z.number().int().positive(), updated_at: date, expires_at: date.nullable(), can_edit: z.boolean(),
    content_sha256: digest, sealed_sha256: digest,
  }).strict(),
  signers: z.array(z.object({
    id: uuid, full_name: z.string().min(1), email: z.string().min(1),
    signer_role: z.enum(['counterparty', 'tenant_signatory', 'witness']),
    signing_order: z.number().int().positive(), status: z.enum(['pending', 'viewed', 'signed', 'declined']),
    signed_at: date.nullable(), declined_at: date.nullable(),
  }).strict()),
}).strict();

export type AgreementPreparation = z.infer<typeof preparation>;
export type AgreementCreationReceipt = z.infer<typeof creationReceipt>;
export type AgreementCreationRecovery = z.infer<typeof reconciliation>;
export type AgreementApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'refused' | 'conflict' | 'unconfirmed'; message: string; refusal?: 'authority' | 'state' };
export type AgreementDraftInput = {
  tenantId: string; requestId: string; clientId: string; title: string; body: string | null;
  offerId?: string | null; commercialTermsId?: string | null;
  source?: 'paige_draft' | 'tenant_template' | 'tenant_upload';
  sourceVersionId?: string | null; documentPath?: string | null;
};
type RpcPort = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResponse> & { abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse> };
};
type RpcResponse = { data: unknown; error: { code?: string } | null };
// Generated database types lag additive native migrations. Keep one explicit
// boundary, strict closed readback, and no raw errors/legal body in logs or Rail.
const port = supabase as unknown as RpcPort;
async function call<Schema extends z.ZodTypeAny>(name: string, args: Record<string, unknown>, schema: Schema, explainRefusal = false, stateRefusalCodes: readonly string[] = []): Promise<AgreementApiResult<z.output<Schema>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const expired = Symbol('agreement response deadline');
  try {
    const request = port.rpc(name, args);
    const pending = typeof request.abortSignal === 'function' ? request.abortSignal(controller.signal) : request;
    const response = await Promise.race([Promise.resolve(pending), new Promise<typeof expired>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(expired); }, 20_000);
    })]);
    // Stopping the browser wait is never evidence that the server rolled back.
    if (response === expired) return { ok: false, reason: 'unconfirmed', message: 'The agreement result is taking longer than expected. Check the original request; it may still complete.' };
    const { data, error } = response;
    if (error?.code === '42501') return { ok: false, reason: 'refused', message: 'Your agreement access or business context changed. Return to Sales and check the selected business.', ...(explainRefusal ? { refusal: 'authority' as const } : {}) };
    if (error?.code === '40001') return { ok: false, reason: 'conflict', message: 'This request refers to different saved work. Recover the original draft before starting another.' };
    if (error?.code === '23514' || error?.code === '22023' || (error?.code && stateRefusalCodes.includes(error.code))) return { ok: false, reason: 'refused', message: 'Review the client, document and required details before continuing.', ...(explainRefusal ? { refusal: 'state' as const } : {}) };
    if (error) return { ok: false, reason: 'unconfirmed', message: 'The agreement result could not be confirmed. Check the original request before trying again.' };
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { ok: false, reason: 'unconfirmed', message: 'The agreement result could not be verified. Check the original request before trying again.' };
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, reason: 'unconfirmed', message: 'The connection ended before the agreement result was confirmed. Your original request can be checked again.' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function validScope(tenantId: string, id: string) {
  return uuid.safeParse(tenantId).success && uuid.safeParse(id).success;
}
// Reuse this bounded, sanitized native RPC boundary for agreement-history reads.
export { call as callAgreementRpc };
const invalid = { ok: false, reason: 'refused', message: 'Choose the original business and agreement before continuing.' } as const;

export async function readAgreementPreparation(tenantId: string, signingId: string): Promise<AgreementApiResult<AgreementPreparation>> {
  if (!validScope(tenantId, signingId)) return invalid;
  const result = await call('read_paige_agreement_preparation', { _expected_tenant_id: tenantId, _signing_id: signingId }, preparation);
  if (result.ok && result.value.agreement.id.toLowerCase() !== signingId.toLowerCase()) return { ok: false, reason: 'unconfirmed', message: 'The selected agreement could not be verified. Return to Sales and open its original record.' };
  return result;
}
export function recoverAgreementCreation(tenantId: string, requestId: string): Promise<AgreementApiResult<AgreementCreationRecovery>> {
  if (!validScope(tenantId, requestId)) return Promise.resolve(invalid);
  return call('recover_paige_agreement_draft_creation', { _expected_tenant_id: tenantId, _request_id: requestId }, reconciliation);
}
export function createAgreementDraft(input: AgreementDraftInput): Promise<AgreementApiResult<AgreementCreationReceipt>> {
  if (!validScope(input.tenantId, input.requestId) || !uuid.safeParse(input.clientId).success) return Promise.resolve(invalid);
  return call('create_paige_agreement_draft_once', {
    _expected_tenant_id: input.tenantId, _request_id: input.requestId, _contact_id: input.clientId,
    _title: input.title, _body_markdown: input.body, _offer_id: input.offerId ?? null,
    _commercial_terms_id: input.commercialTermsId ?? null, _body_source: input.source ?? 'paige_draft',
    _source_version_id: input.sourceVersionId ?? null, _document_path: input.documentPath ?? null,
  }, creationReceipt);
}
