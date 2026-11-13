import { normalizeFormFutureTags } from "./form-intake-tags.ts";
import { UUID } from "../comms-email/contract.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

type Row = Record<string, unknown>;
type NativeReply = { data: unknown; error: { code?: string; message?: string } | null };
export type SubmissionTagScope = {
  submissionId: string; tenantId: string; formId: string; contactId: string; automationId: string | null;
  claimAttempt: number; operatorId: string | null; futureTags: unknown; hasRecordedResult: boolean;
};
export type SubmissionTagRecord = {
  v: 1; submission_id: string; tenant_id: string; form_id: string; contact_id: string; automation_id: string | null;
  operator_user_id: string; outcome: "applied" | "no_change"; future_tags: string[]; config_digest: string;
  source_updated_at: string; saved_updated_at: string; audit_id: string | null;
};
export type SubmissionTagOutcome = { kind: "recorded"; result: SubmissionTagRecord; replayed: boolean }
  | { kind: "not_requested" } | { kind: "refused"; code: string } | { kind: "unknown" };
export type SubmissionTagCaller = {
  rpc(name: string, args: Row): PromiseLike<NativeReply>;
  from(table: "clients"): {
    select(columns: string): { eq(column: string, value: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<NativeReply> };
    } };
  };
};
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const same = (a: unknown, b: unknown) => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
function object(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  return Reflect.ownKeys(value).every(key => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable
    && "value" in Object.getOwnPropertyDescriptor(value, key)!) ? value as Row : null;
}
const keys = (value: Row, expected: readonly string[]) => Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
/** Preserve the original native timestamp string. Never Date-serialize a CAS token. */
function version(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2})(?::(\d{2}))?)$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, minute, second, , zoneH, zoneM] = match;
  const year = Number(y), month = Number(m), day = Number(d), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day > 0 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    && Number(h) <= 23 && Number(minute) <= 59 && Number(second) <= 59 && (zoneH === undefined || (Number(zoneH) <= 23 && Number(zoneM ?? "0") <= 59));
}
const RESULT_KEYS = ["v", "submission_id", "tenant_id", "form_id", "contact_id", "automation_id", "operator_user_id", "outcome", "future_tags", "config_digest", "source_updated_at", "saved_updated_at", "audit_id"];
function recorded(value: unknown, scope: SubmissionTagScope, fromState: boolean, expectedVersion?: string, expectedTags?: string[]): Extract<SubmissionTagOutcome, { kind: "recorded" }> | null {
  const envelope = object(value), result = envelope ? object(envelope.result) : null;
  if (!envelope || !keys(envelope, ["ok", "state", "replayed", "result"]) || envelope.ok !== true || envelope.state !== "recorded"
      || typeof envelope.replayed !== "boolean" || (fromState && envelope.replayed !== true) || !result || !keys(result, RESULT_KEYS) || result.v !== 1) return null;
  if (!same(result.submission_id, scope.submissionId) || !same(result.tenant_id, scope.tenantId) || !same(result.form_id, scope.formId)
      || !same(result.contact_id, scope.contactId) || !(scope.automationId === null ? result.automation_id === null : same(result.automation_id, scope.automationId))
      || !uuid(result.operator_user_id) || !version(result.source_updated_at) || !version(result.saved_updated_at)
      || typeof result.config_digest !== "string" || !/^[0-9a-f]{64}$/.test(result.config_digest)) return null;
  if (!Array.isArray(result.future_tags) || result.future_tags.length > 50) return null;
  const tags = normalizeFormFutureTags(result.future_tags);
  if (tags.ok === false || JSON.stringify(tags.tags) !== JSON.stringify(result.future_tags)) return null;
  if (!(result.outcome === "applied" && uuid(result.audit_id))
      && !(result.outcome === "no_change" && result.audit_id === null && result.source_updated_at === result.saved_updated_at)) return null;
  // A replay is historical native evidence. Current settings, tags or operator
  // are never substituted for its original source or audit.
  if (!envelope.replayed && (!same(result.operator_user_id, scope.operatorId) || result.source_updated_at !== expectedVersion
      || JSON.stringify(tags.tags) !== JSON.stringify(expectedTags))) return null;
  return { kind: "recorded", replayed: envelope.replayed, result: { ...result, future_tags: [...tags.tags] } as SubmissionTagRecord };
}
const REFUSALS = new Set(["not_allowed", "source_changed", "config_changed", "invalid"]);
function refusal(value: unknown): string | null {
  const row = object(value);
  return row && keys(row, ["ok", "code"]) && row.ok === false && typeof row.code === "string" && REFUSALS.has(row.code) ? row.code : null;
}

/** One bounded original operation. Native locks/current authority own effects;
 *  an uncertain response permits only the SAME source's read-only inspection. */
export async function applySubmissionFutureTags(scope: SubmissionTagScope, deps: { caller: SubmissionTagCaller; current?: () => boolean; signal?: AbortSignal; timeoutMs?: number }): Promise<SubmissionTagOutcome> {
  scope = Object.freeze({ ...scope });
  let withdrawn = false;
  const current = () => { try { if (deps.signal?.aborted || deps.current?.() === false) withdrawn = true; } catch { withdrawn = true; } return !withdrawn; };
  const call = (name: string, args: Row) => createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, current)(() => deps.caller.rpc(name, args));
  if (![scope.submissionId, scope.tenantId, scope.formId, scope.contactId].every(uuid) || (scope.automationId !== null && !uuid(scope.automationId)) || !current()) return { kind: "refused", code: "invalid" };
  const inspect = async (): Promise<SubmissionTagOutcome> => {
    if (!current()) return { kind: "unknown" };
    try {
      const response = await call("growth_submission_contact_tags_state", { p_submission_id: scope.submissionId, p_contact_id: scope.contactId, p_automation_id: scope.automationId });
      if (response.error || !current()) return { kind: "unknown" };
      return recorded(response.data, scope, true) ?? (refusal(response.data) ? { kind: "refused", code: refusal(response.data)! } : { kind: "unknown" });
    } catch { return { kind: "unknown" }; }
  };
  if (scope.hasRecordedResult) return inspect();
  const tags = normalizeFormFutureTags(scope.futureTags);
  if (tags.ok === false) return { kind: "refused", code: "invalid" };
  if (!tags.tags.length) return { kind: "not_requested" };
  if (!uuid(scope.operatorId) || !Number.isSafeInteger(scope.claimAttempt) || scope.claimAttempt < 1 || !current()) return { kind: "refused", code: "not_allowed" };
  let expectedVersion: string;
  try {
    const response = await createWeeklyDraftDeadline(deps.timeoutMs ?? 5000, current)(() => deps.caller.from("clients").select("id,updated_at").eq("id", scope.contactId).eq("tenant_id", scope.tenantId).maybeSingle());
    const contact = object(response.data);
    if (response.error || !contact || !same(contact.id, scope.contactId) || !version(contact.updated_at) || !current()) return { kind: "refused", code: "source_changed" };
    expectedVersion = contact.updated_at;
  } catch { return { kind: "refused", code: "source_changed" }; }
  if (!current()) return { kind: "refused", code: "not_allowed" };
  try {
    const response = await call("growth_apply_submission_contact_tags", {
      p_submission_id: scope.submissionId, p_claim_attempt: scope.claimAttempt, p_automation_id: scope.automationId, p_contact_id: scope.contactId,
      p_actor_user_id: scope.operatorId, p_expected_updated_at: expectedVersion, p_expected_future_tags: tags.tags,
    });
    if (!current()) return { kind: "unknown" };
    if (response.error) {
      if (response.error.code === "40001") return { kind: "refused", code: "stale" };
      if (response.error.code === "42501") return { kind: "refused", code: "not_allowed" };
      if (response.error.code === "22023") return { kind: "refused", code: "invalid" };
      return inspect();
    }
    const result = recorded(response.data, scope, false, expectedVersion, tags.tags);
    if (result) return result;
    const code = refusal(response.data);
    return code ? { kind: "refused", code } : inspect();
  } catch { return inspect(); }
}
