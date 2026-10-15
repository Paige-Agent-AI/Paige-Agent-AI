/** Preparation only: consumes server-resolved Sales evidence; never authorizes a handoff. */
export type EngagementEvidence = Readonly<{
  tenantId: string; agreementId: string; contactId: string;
  commercialTermsId: string | null; offerId: string | null; version: number;
  status: string; completedAt: string | null;
  contentSha256: string | null; sealedSha256: string | null; sealedCopyRecorded: boolean;
}>;
type Scope = Readonly<{ tenantId: string; contactId: string; commercialTermsId: string; offerId: string | null }>;
type Result = {
  state: "unavailable" | "source_mismatch" | "signing_incomplete" | "sealed_evidence_unavailable" | "ready_for_scope_review";
  handoffAuthorized: false; clientAccepted: false;
  source?: Readonly<{ agreementId: string; contactId: string; commercialTermsId: string;
    offerId: string | null; version: number; contentSha256: string; sealedSha256: string }>;
};
const digest = (value: string | null): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export function inspectEngagementReadiness(evidence: EngagementEvidence | null, scope: Scope): Result {
  const refused = (state: Result["state"]): Result => ({ state, handoffAuthorized: false, clientAccepted: false });
  if (!evidence) return refused("unavailable");
  if (!scope.tenantId || !scope.contactId || !scope.commercialTermsId || !evidence.agreementId
    || evidence.tenantId !== scope.tenantId || evidence.contactId !== scope.contactId
    || evidence.commercialTermsId !== scope.commercialTermsId || evidence.offerId !== scope.offerId) return refused("source_mismatch");
  if (evidence.status !== "completed") return refused("signing_incomplete");
  if (!Number.isSafeInteger(evidence.version) || evidence.version < 1
    || !digest(evidence.contentSha256) || !digest(evidence.sealedSha256) || !evidence.sealedCopyRecorded
    || !evidence.completedAt || !Number.isFinite(Date.parse(evidence.completedAt))) return refused("sealed_evidence_unavailable");
  return { state: "ready_for_scope_review", handoffAuthorized: false, clientAccepted: false,
    source: { agreementId: evidence.agreementId, contactId: evidence.contactId,
      commercialTermsId: scope.commercialTermsId, offerId: evidence.offerId, version: evidence.version,
      contentSha256: evidence.contentSha256, sealedSha256: evidence.sealedSha256 } };
}
