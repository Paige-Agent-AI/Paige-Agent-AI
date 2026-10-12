import { inspectEngagementReadiness, type EngagementEvidence } from "./operations-engagement-readiness";

export type HandoffMilestone = Readonly<{ title: string; summary?: string; dueAt?: string | null;
  assignedToUserId: string; priority: "low" | "normal" | "high" | "urgent" }>;
export type HandoffDraft = Readonly<{ title: string; summary: string | null; ownerUserId: string;
  startsOn: string; endsOn: string; milestones: readonly HandoffMilestone[] }>;
export type HandoffScope = Readonly<{ actorId: string; tenantId: string; contactId: string;
  commercialTermsId: string; offerId: string; termsUpdatedAt: string; commercialStatus: string }>;
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const instant = (s: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(s);
  return !!match && day(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60
    && Number(match[4]) < 60 && (match[5] === "Z" || (Number(match[6]) < 24 && Number(match[7]) < 60))
    && Number.isFinite(Date.parse(s));
};
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;

/** Prepare a reviewed scope request. Server authorization and source validation are still required. */
export function prepareEngagementHandoff(scope: HandoffScope, evidence: EngagementEvidence | null,
  draft: HandoffDraft, requestId: string, eligiblePeople: readonly string[]) {
  const ready = inspectEngagementReadiness(evidence, scope);
  if (ready.state !== "ready_for_scope_review" || !ready.source || scope.commercialStatus !== "active"
    || ![scope.actorId, scope.tenantId, scope.contactId, scope.commercialTermsId, scope.offerId, ready.source.agreementId, requestId].every(uuid)
    || !instant(scope.termsUpdatedAt) || !day(draft.startsOn) || !day(draft.endsOn) || draft.endsOn < draft.startsOn
    || !draft.title.trim() || draft.title.trim().length > 500 || (draft.summary?.length ?? 0) > 10000
    || !uuid(draft.ownerUserId) || !eligiblePeople.includes(draft.ownerUserId)
    || draft.milestones.length < 1 || draft.milestones.length > 50) return null;
  const milestones = [];
  for (const step of draft.milestones) {
    if (!step.title.trim() || step.title.trim().length > 500 || (step.summary?.length ?? 0) > 10000
      || !uuid(step.assignedToUserId) || !eligiblePeople.includes(step.assignedToUserId)
      || !["low", "normal", "high", "urgent"].includes(step.priority)
      || (step.dueAt != null && !instant(step.dueAt))) return null;
    milestones.push({ title: step.title.trim(), summary: step.summary ?? null,
      due_at: step.dueAt ?? null, assigned_to_user_id: step.assignedToUserId, priority: step.priority });
  }
  return { p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
    p_agreement_id: ready.source.agreementId, p_expected_contact_id: scope.contactId,
    p_expected_terms_id: scope.commercialTermsId, p_expected_offer_id: scope.offerId, p_expected_version: ready.source.version,
    p_expected_content_sha256: ready.source.contentSha256, p_expected_sealed_sha256: ready.source.sealedSha256,
    p_expected_terms_updated_at: scope.termsUpdatedAt, p_request_id: requestId,
    p_title: draft.title.trim(), p_owner_user_id: draft.ownerUserId, p_starts_on: draft.startsOn,
    p_ends_on: draft.endsOn, p_milestones: milestones, p_summary: draft.summary };
}

/** An acknowledged write is not verified readback or client acceptance. */
export function normalizeHandoffAcknowledgement(value: unknown, actorId: string, tenantId: string, count: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.ok !== true || r.actor_id !== actorId || r.tenant_id !== tenantId || r.client_accepted !== false
    || typeof r.replayed !== "boolean" || typeof r.plan_id !== "string" || !uuid(r.plan_id)
    || !Array.isArray(r.milestone_ids) || r.milestone_ids.length !== count
    || r.milestone_ids.some(id => typeof id !== "string" || !uuid(id))
    || new Set(r.milestone_ids).size !== count) return null;
  return { planId: r.plan_id, milestoneIds: r.milestone_ids as string[], replayed: r.replayed,
    clientAccepted: false as const, readbackVerified: false as const };
}
