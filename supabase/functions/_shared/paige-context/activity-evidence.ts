import { readRecordLinks, type ReadRecordLink } from "../paige-turn/record-links.ts";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const OUTCOMES = ["capability_succeeded", "capability_failed", "capability_refused", "capability_unreachable",
  "capability_outcome_unknown", "capability_completed_unrecorded", "run_completed", "run_failed", "run_refused",
  "run_awaiting_approval", "plan_drafted", "plan_updated", "plan_step_completed", "plan_blocked", "check_completed",
  "check_failed", "unclassified"] as const;
type RecordedOutcome = typeof OUTCOMES[number];
type TargetState = "active" | "paused" | "retired";
type TargetOperation = "target_create" | "target_revise" | "target_transition";

export type ActivityEvidence = {
  kind: "recorded_outcome";
  railReceiptId: string;
  recordedOutcome: RecordedOutcome;
  businessResult: null;
  recordLinks: [];
} | {
  kind: "verified_original_result";
  railReceiptId: string;
  recordedOutcome: "capability_succeeded";
  businessResult: { kind: "target_revision"; receiptId: string; targetId: string; revision: number;
    state: TargetState; operation: TargetOperation };
  recordLinks: ReadRecordLink[];
};
export type ActivityEvidenceRead = { state: "not_provided" } | { state: "invalid" }
  | { state: "ready"; evidence: ActivityEvidence };

/** Validate the SAME scoped Rail response, never fetch or infer a result.
 * Native/domain authority is still required. Parsing a fixture is not proof that work ran.
 * Legacy absence, invalid data and a genuine recorded-only outcome remain distinct.
 */
export function readActivityEvidence(raw: unknown, eventId: string): ActivityEvidenceRead {
  if (raw === null || raw === undefined) return { state: "not_provided" };
  const invalid = (): ActivityEvidenceRead => ({ state: "invalid" });
  if (!uuid(eventId) || !object(raw) || raw.version !== 1 || !uuid(raw.rail_receipt_id)
    || raw.rail_receipt_id.toLowerCase() !== eventId.toLowerCase()
    || !OUTCOMES.includes(raw.recorded_outcome as RecordedOutcome) || !Array.isArray(raw.record_links)) return invalid();
  const railReceiptId = raw.rail_receipt_id.toLowerCase();
  if (raw.kind === "recorded_outcome") {
    if (raw.business_result !== null || raw.record_links.length !== 0) return invalid();
    return { state: "ready", evidence: { kind: raw.kind, railReceiptId,
      recordedOutcome: raw.recorded_outcome as RecordedOutcome, businessResult: null, recordLinks: [] } };
  }
  if (raw.kind !== "verified_original_result" || raw.recorded_outcome !== "capability_succeeded"
    || !object(raw.business_result) || raw.record_links.length !== 1) return invalid();
  const r = raw.business_result, link = raw.record_links[0];
  if (r.kind !== "target_revision" || !uuid(r.receipt_id) || !uuid(r.target_id)
    || typeof r.revision !== "number" || !Number.isSafeInteger(r.revision) || r.revision < 1
    || typeof r.state !== "string" || !["active", "paused", "retired"].includes(r.state)
    || typeof r.operation !== "string" || !["target_create", "target_revise", "target_transition"].includes(r.operation)
    || !object(link) || link.destination !== "business_game_plan" || !uuid(link.record_id)
    || Object.prototype.hasOwnProperty.call(link, "record_kind")) return invalid();
  const recordLinks = readRecordLinks(raw.record_links);
  if (recordLinks.length !== 1 || !recordLinks[0].record_id) return invalid();
  return { state: "ready", evidence: { kind: raw.kind, railReceiptId, recordedOutcome: "capability_succeeded",
    businessResult: { kind: "target_revision", receiptId: r.receipt_id.toLowerCase(), targetId: r.target_id.toLowerCase(),
      revision: r.revision, state: r.state as TargetState, operation: r.operation as TargetOperation }, recordLinks } };
}
