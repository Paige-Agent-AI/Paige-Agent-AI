import type { EngagementEvidence } from "./operations-engagement-readiness";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = (value: unknown): value is string | null => value === null || typeof value === "string";

/** Accept only the selected server source. Signing never becomes execution or acceptance authority. */
export function normalizeEngagementRead(value: unknown, actorId: string, tenantId: string,
  agreementId: string): EngagementEvidence | null {
  if (!actorId || !tenantId || !agreementId || !record(value) || value.ok !== true
    || value.actor_id !== actorId || value.tenant_id !== tenantId || !record(value.evidence)) return null;
  const source = value.evidence;
  if (source.tenant_id !== tenantId || source.agreement_id !== agreementId
    || typeof source.contact_id !== "string" || !source.contact_id
    || typeof source.version !== "number" || !Number.isSafeInteger(source.version) || source.version < 1
    || typeof source.status !== "string" || !source.status
    || !optionalText(source.commercial_terms_id) || !optionalText(source.offer_id)
    || !optionalText(source.completed_at) || !optionalText(source.content_sha256) || !optionalText(source.sealed_sha256)
    || typeof source.sealed_copy_recorded !== "boolean"
    || source.handoff_authorized !== false || source.client_accepted !== false) return null;
  return { agreementId, tenantId, contactId: source.contact_id, commercialTermsId: source.commercial_terms_id,
    offerId: source.offer_id, version: source.version, status: source.status, completedAt: source.completed_at,
    contentSha256: source.content_sha256, sealedSha256: source.sealed_sha256,
    sealedCopyRecorded: source.sealed_copy_recorded };
}
