import { uuid } from "./weekly-commitment-control-intent.ts";
import { createWeeklyDraftDeadline } from "./weekly-draft-deadline.ts";
import { parseWeeklyDraftState, weeklyDraftModelContext, weeklyDraftRecordReference } from "./weekly-draft-projection.ts";

type CallerDb = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

type WeeklyDraftChatReadOptions = Readonly<{
  confirmationId: string;
  scope: Readonly<{ actorId: string; tenantId: string; threadId: string }>;
  current: () => boolean;
  signal: AbortSignal;
}>;
type WeeklyDraftChatReadResult =
  | { status: "available"; context: NonNullable<ReturnType<typeof weeklyDraftModelContext>>;
      record: ReturnType<typeof weeklyDraftRecordReference> }
  | { status: "refused"; reason: "invalid_original_scope" | "original_scope_retired" | "native_scope_refused" }
  | { status: "unavailable"; reason: "original_draft_not_verified" };

/** Prepared readback for the SAME native draft, not a new conversational tool.
 * The future original Harness caller must supply its caller-JWT client, trusted
 * original selector/scope and current-context guard. This helper authenticates
 * nobody: SQL retains owner/thread authority and caller admission remains owed.
 * One bounded read only; tokens/selectors/summary/errors never reach the model.
 * No confirmation, claim, write, receipt, provider call or retry is issued here.
 */
export async function readWeeklyDraftChatStatus(callerJwtDb: CallerDb,
  options: WeeklyDraftChatReadOptions): Promise<WeeklyDraftChatReadResult> {
  const original = options?.scope;
  if (!original || typeof original !== "object" || Array.isArray(original)
    || !["actorId", "tenantId", "threadId"].every(key => Object.prototype.hasOwnProperty.call(original, key))
    || !uuid(original.actorId) || !uuid(original.tenantId) || !uuid(original.threadId)
    || !uuid(options.confirmationId) || typeof options.current !== "function"
    || !options.signal || typeof options.signal.aborted !== "boolean") {
    return { status: "refused", reason: "invalid_original_scope" };
  }
  const scope = Object.freeze({ actorId: original.actorId, tenantId: original.tenantId, threadId: original.threadId });
  const { confirmationId, current, signal } = options;
  const isCurrent = () => { try { return !signal.aborted && current() === true; } catch { return false; } };
  if (!isCurrent()) return { status: "refused", reason: "original_scope_retired" };
  const unavailable = { status: "unavailable", reason: "original_draft_not_verified" } as const;
  const stage = createWeeklyDraftDeadline(12_000, isCurrent);
  try {
    const result = await stage(() => callerJwtDb.rpc("read_weekly_commitment_chat_draft", {
      _confirmation_id: confirmationId, _expected_thread_id: scope.threadId,
    }));
    if (!isCurrent()) return { status: "refused", reason: "original_scope_retired" };
    if (result.error) return typeof result.error === "object" && "code" in result.error
      && result.error.code === "42501" ? { status: "refused", reason: "native_scope_refused" } : unavailable;
    const state = parseWeeklyDraftState(result.data, scope);
    if (!state || state.confirmationId !== confirmationId) return unavailable;
    const context = weeklyDraftModelContext(result.data, scope);
    return context ? { status: "available", context,
      record: weeklyDraftRecordReference(result.data, scope, confirmationId) } : unavailable;
  } catch {
    return isCurrent() ? unavailable : { status: "refused", reason: "original_scope_retired" };
  }
}
