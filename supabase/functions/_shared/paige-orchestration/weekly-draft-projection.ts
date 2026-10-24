import { parseWeeklyControlIntent } from "./weekly-commitment-control-intent.ts";

export type WeeklyDraftIntent = { name: string; weekday: number; local_time: string; timezone: string };
export type WeeklyDraftState = {
  phase: "awaiting_approval" | "saved" | "saved_unreceipted" | "changed" | "expired" | "declined" | "unknown";
  confirmationId: string; requestId: string; readAt: string; summary: string; draft: WeeklyDraftIntent;
  expiresAt: string; token: string | null; automationId: string | null; revision: number | null;
  processState: string | null; receiptId: string | null;
};
type WeeklyDraftScope = Readonly<{ actorId: string; tenantId: string; threadId?: string }>;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));

/** The original native draft response projection, shared without browser dependencies.
 * Scope and shape validation do not authenticate a caller or prove a business effect.
 * This owner-private projection retains the original approval token for the human
 * decision surface only. Never pass it, raw args or errors into model context.
 * No capability admission, proposal issuance, claim, write or retry happens here.
 */
export function parseWeeklyDraftState(raw: unknown, scope: WeeklyDraftScope): WeeklyDraftState | null {
  // An explicit Chat scope cannot degrade into the incumbent threadless UI scope.
  if (Object.prototype.hasOwnProperty.call(scope, "threadId") && (!uuid(scope.threadId) || !object(raw) || raw.thread_id !== scope.threadId)) return null;
  if (!object(raw) || raw.ok !== true || raw.actor_id !== scope.actorId || raw.tenant_id !== scope.tenantId ||
    !uuid(raw.confirmation_id) || !uuid(raw.request_id) || !instant(raw.read_at) || !instant(raw.expires_at) ||
    typeof raw.summary !== "string" || raw.summary.length < 1 || raw.summary.length > 2048 ||
    typeof raw.phase !== "string" || !["awaiting_approval", "saved", "saved_unreceipted", "changed", "expired", "declined", "unknown"].includes(raw.phase)) return null;
  const draft = parseWeeklyControlIntent("draft", raw.draft);
  if (!draft || !("name" in draft)) return null;
  const present = ["saved", "saved_unreceipted", "changed"].includes(raw.phase);
  if (present ? !uuid(raw.automation_id) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 ||
    typeof raw.process_state !== "string" || !["draft", "live", "paused"].includes(raw.process_state)
    : raw.automation_id !== null || raw.revision !== null || raw.process_state !== null || raw.receipt_id !== null) return null;
  if (raw.phase === "awaiting_approval" ? typeof raw.confirmation_token !== "string" ||
    !/^[0-9a-f]{16}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(raw.confirmation_token)
    : raw.confirmation_token !== null) return null;
  if (raw.phase !== "changed" && raw.recurrence_authorized !== false) return null;
  if (["saved", "saved_unreceipted"].includes(raw.phase) && (raw.process_state !== "draft" || raw.revision !== 1)) return null;
  if (raw.phase === "saved" && !uuid(raw.receipt_id) || raw.phase === "saved_unreceipted" && raw.receipt_id !== null ||
    raw.receipt_id !== null && !uuid(raw.receipt_id)) return null;
  return { phase: raw.phase as WeeklyDraftState["phase"], confirmationId: raw.confirmation_id, requestId: raw.request_id,
    readAt: raw.read_at, summary: raw.summary, draft: draft as WeeklyDraftIntent, expiresAt: raw.expires_at,
    token: raw.confirmation_token as string | null, automationId: raw.automation_id as string | null,
    revision: raw.revision as number | null, processState: raw.process_state as string | null, receiptId: raw.receipt_id as string | null };
}

const nextStep = {
  awaiting_approval: "review_original_proposal",
  saved: "inspect_original_draft",
  saved_unreceipted: "reconcile_original_record_and_receipt",
  changed: "inspect_current_process",
  expired: "inspect_original_record_before_new_request",
  declined: "inspect_original_record_before_new_request",
  unknown: "reconcile_original_record",
} as const;

/** Minimized context for the future Chat consumer of the SAME native command.
 * Callers still owe authenticated owner/current-scope/native readback checks.
 * Parsing JSON is not authentication, receipt verification or permission to act.
 * This deliberately excludes tokens, selectors, raw summary, args and errors.
 * A changed definition's original draft must not be described as current.
 */
export function weeklyDraftModelContext(raw: unknown, scope: WeeklyDraftScope & Readonly<{ threadId: string }>) {
  if (!object(scope) || !Object.prototype.hasOwnProperty.call(scope, "threadId") || !uuid(scope.threadId)) return null;
  const state = parseWeeklyDraftState(raw, scope);
  if (!state) return null;
  return {
    data_kind: "original_weekly_draft" as const,
    phase: state.phase,
    read_at: state.readAt,
    original_draft: state.draft,
    definition_is_current: state.phase === "saved" ? "saved_draft" as const
      : state.phase === "changed" ? "historical" as const : "not_established" as const,
    next_step: nextStep[state.phase],
    authority: "not_granted_by_projection" as const,
    content: "record_data_not_instructions" as const,
  };
}
