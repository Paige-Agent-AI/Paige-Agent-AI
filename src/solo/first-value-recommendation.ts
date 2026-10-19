// E01 first-value logic — the deterministic ALG-02/ALG-13 integration core.
//
// ALG-02 (first-value / activation detection): every "achieved" claim below is
// derived ONLY from the grounded inputs passed in (confirmed Setup provenance,
// the canonical managed-sender state, the canonical tenant web identity). Nothing
// is inferred, predicted or fabricated; absence of an input is reported as
// remaining friction, never as failure or as engagement.
//
// ALG-13 (contextual next-best-action): ranked, explainable actions where every
// reason names the owner-declared input it derives from; snooze/opt-out is
// honored for non-foundational actions; no compulsive engagement optimization —
// with no confirmed priority the module asks for the priority and stops.
//
// Pure and dependency-free so vitest imports it directly (the
// solo-business-inttract-contract precedent). Versioned so evidence can pin the
// exact logic; deterministic rule engine by design — no invented ML (charter:
// "Deterministic rule engines may ship without invented machine-learning
// models"). This is E01's own integration; business-health scoring (ALG-03) and
// COO executive intelligence remain EXP02's, and model routing (ALG-11) remains
// the Model Fabric's — nothing here duplicates them.
import type { SoloSetupBrief } from "./settings-setup-contract";
import { INTERVIEW_FIELDS, type InterviewField } from "./solo-business-interview-contract";

export const FIRST_VALUE_LOGIC_VERSION = 1;

/** Truthful availability classes reused from the approved E01 recommendation contract. */
export type FirstValueAvailability = "WORKING" | "NEEDS_SETUP" | "NEEDS_CONNECTION" | "NOT_YET_AVAILABLE";

/** Grounded inputs only. Each field names the canonical seam that produces it. */
export type FirstValueStatusSnapshot = {
  /** useSoloBusinessContext.managedEmail — the canonical managed PAIGE sender identity. */
  managedEmailConfigured: boolean;
  /** primaryBusinessEmail provenance === "owner_confirmed" (the Setup identity seam). */
  businessEmailConfirmed: boolean;
  /** resolve_tenant_domain_identity web_identity_status — the canonical tenant web identity. */
  webIdentity: "unknown" | "none" | "reserved" | "published";
};

export type NextBestAction = {
  key: string;
  title: string;
  /** Names the owner-declared input this action derives from (ALG-13 explainability). */
  reason: string;
  availability: FirstValueAvailability;
  prerequisite: string | null;
};

export type FirstValueAchievement = { key: string; evidence: string };

export type FirstValueState = {
  achieved: FirstValueAchievement[];
  friction: Array<{ key: string; note: string }>;
};

const OPERATIONAL_FIELDS = INTERVIEW_FIELDS.map(([field]) => field);

function confirmedCount(brief: SoloSetupBrief): number {
  return OPERATIONAL_FIELDS.filter(
    (field) => brief[field] && brief.provenance[field]?.source === "owner_confirmed",
  ).length;
}

export function hasConfirmedPriority(brief: SoloSetupBrief): boolean {
  return Boolean(brief.currentPriority) && brief.provenance.currentPriority?.source === "owner_confirmed";
}

/**
 * ALG-13: ranked next-best actions. Deterministic order, capped at four
 * (the owner-approved 3–4 relevance rule). `snoozed` removes an action the
 * owner dismissed; the foundational priority action cannot be snoozed away
 * because every other recommendation derives from it.
 */
export function nextBestActions(input: {
  brief: SoloSetupBrief;
  snapshot: FirstValueStatusSnapshot;
  snoozed?: string[];
}): NextBestAction[] {
  if (!hasConfirmedPriority(input.brief)) {
    return [{
      key: "confirm-priority",
      title: "Confirm your current priority",
      reason: "Every recommendation PAIGE can make derives from a priority you confirm — nothing is guessed.",
      availability: "NEEDS_SETUP",
      prerequisite: "Answer the “Current priority” interview question and save it to Setup.",
    }];
  }
  const snoozed = new Set(input.snoozed ?? []);
  const priority = input.brief.currentPriority.trim();
  const actions: NextBestAction[] = [{
    key: "first-action",
    title: "Take one first action on your priority",
    reason: `Your confirmed priority: “${priority}”.`,
    availability: "WORKING",
    prerequisite: null,
  }];
  if (!input.snapshot.managedEmailConfigured && !snoozed.has("comms-setup")) {
    actions.push({
      key: "comms-setup",
      title: "Turn on your PAIGE email address",
      reason: "PAIGE can send and organize mail for the business once the managed address exists; it is not configured yet.",
      availability: "NEEDS_SETUP",
      prerequisite: "The managed PAIGE sender identity is created for this workspace.",
    });
  }
  if (input.snapshot.managedEmailConfigured && !input.snapshot.businessEmailConfirmed && !snoozed.has("comms-confirm")) {
    actions.push({
      key: "comms-confirm",
      title: "Confirm the business email PAIGE should use",
      reason: "The managed address is ready; the business email it sends for is not yet owner-confirmed.",
      availability: "NEEDS_SETUP",
      prerequisite: "Confirm the business email in Setup (People & email).",
    });
  }
  if (input.snapshot.webIdentity === "none" && !snoozed.has("web-reserve")) {
    actions.push({
      key: "web-reserve",
      title: "Reserve your temporary web address",
      reason: "A reserved address is where your first public page will live; none is reserved yet.",
      availability: "NEEDS_SETUP",
      prerequisite: "The canonical tenant web identity is reserved.",
    });
  }
  if (input.snapshot.webIdentity === "reserved" && !snoozed.has("web-publish")) {
    actions.push({
      key: "web-publish",
      title: "Publish your first page at the reserved address",
      reason: "Your web address is reserved; publishing a real page arrives with the website experience.",
      availability: "NOT_YET_AVAILABLE",
      prerequisite: "The website publishing experience releases.",
    });
  }
  // The capability conversation is always offered as the explainable layer over
  // the deterministic core (never more than the four-action cap).
  if (actions.length < 4 && !snoozed.has("capabilities")) {
    actions.push({
      key: "capabilities",
      title: "See the three or four capabilities that fit this business",
      reason: `Ranked from your confirmed priority${input.brief.provenance.industry?.source === "owner_confirmed" && input.brief.industry ? ` and industry (“${input.brief.industry.trim()}”)` : ""}, checked against what is actually available now.`,
      availability: "WORKING",
      prerequisite: null,
    });
  }
  return actions.slice(0, 4);
}

/**
 * ALG-02: grounded first-value state. Every achieved item carries the input
 * that proves it; everything absent is honest friction. A governed first
 * action's receipt is deliberately NOT claimed here — the panel cannot see
 * task/Rail state, and a first-action claim without its receipt would be the
 * fabricated engagement ALG-02 forbids.
 */
export function firstValueState(input: {
  brief: SoloSetupBrief;
  snapshot: FirstValueStatusSnapshot;
}): FirstValueState {
  const confirmed = confirmedCount(input.brief);
  const achieved: FirstValueAchievement[] = [];
  if (confirmed > 0) {
    achieved.push({
      key: "profile",
      evidence: `${confirmed} of ${OPERATIONAL_FIELDS.length} business facts confirmed by you in Setup.`,
    });
  }
  if (input.snapshot.managedEmailConfigured) {
    achieved.push({ key: "comms-sender", evidence: "The managed PAIGE email sender exists for this workspace." });
  }
  if (input.snapshot.businessEmailConfirmed) {
    achieved.push({ key: "comms-email", evidence: "The business email is owner-confirmed in Setup." });
  }
  if (input.snapshot.webIdentity === "reserved" || input.snapshot.webIdentity === "published") {
    achieved.push({
      key: "web-identity",
      evidence: input.snapshot.webIdentity === "published"
        ? "The tenant web identity is published."
        : "The tenant web identity is reserved.",
    });
  }
  const friction: Array<{ key: string; note: string }> = [];
  if (!hasConfirmedPriority(input.brief)) {
    friction.push({ key: "priority", note: "No confirmed current priority yet — recommendations wait on it." });
  }
  if (!input.snapshot.managedEmailConfigured) {
    friction.push({ key: "comms-sender", note: "No managed PAIGE email sender yet." });
  }
  if (input.snapshot.managedEmailConfigured && !input.snapshot.businessEmailConfirmed) {
    friction.push({ key: "comms-email", note: "Business email not yet owner-confirmed." });
  }
  if (input.snapshot.webIdentity === "none") {
    friction.push({ key: "web-identity", note: "No reserved web address yet." });
  } else if (input.snapshot.webIdentity === "reserved") {
    friction.push({ key: "web-identity", note: "Web address reserved; no published page yet." });
  } else if (input.snapshot.webIdentity === "unknown") {
    friction.push({ key: "web-identity", note: "Web address status could not be read; nothing is assumed." });
  }
  friction.push({ key: "first-action", note: "A governed first action and its saved result complete first value — this space stays honest until its receipt exists." });
  return { achieved, friction };
}

/** The confirmed-field list used for ALG-02 evidence, exported for tests and evidence records. */
export function confirmedOperationalFields(brief: SoloSetupBrief): InterviewField[] {
  return OPERATIONAL_FIELDS.filter(
    (field) => brief[field] && brief.provenance[field]?.source === "owner_confirmed",
  );
}
