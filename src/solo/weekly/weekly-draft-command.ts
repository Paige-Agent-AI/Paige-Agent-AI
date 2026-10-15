import { parseWeeklyControlIntent } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-intent";
import type { WeeklyBrowserScope } from "./weekly-owner-read";

export type WeeklyDraftIntent = { name: string; weekday: number; local_time: string; timezone: string };
export type WeeklyDraftState = {
  phase: "awaiting_approval" | "saved" | "saved_unreceipted" | "changed" | "expired" | "declined" | "unknown";
  confirmationId: string; requestId: string; readAt: string; summary: string; draft: WeeklyDraftIntent;
  expiresAt: string; token: string | null; automationId: string | null; revision: number | null;
  processState: string | null; receiptId: string | null;
};
export type WeeklyDraftRequest = { action: "prepare"; draft: WeeklyDraftIntent } | { action: "pending" }
  | { action: "status"; confirmation_id: string }
  | { action: "commit"; confirmation_id: string; approvedConfirmations: string[] }
  | { action: "decline"; confirmation_id: string; declinedConfirmations: string[] };
export type WeeklyDraftResult = { kind: "state"; state: WeeklyDraftState }
  | { kind: "pending"; requests: WeeklyDraftState[]; hasMore: boolean }
  | { kind: "invalid" | "held" }
  | { kind: "refused" | "unavailable" | "unconfirmed" };
type Caller = {
  auth: { getSession(): PromiseLike<{ data: { session: { user: { id: string } } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  functions: { invoke(name: string, options: { body: WeeklyDraftRequest; headers: Record<string, string>; timeout: number }): PromiseLike<{ data: unknown; error: unknown }> };
};
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
/** Closed projection: no raw authority, token, args or database error reaches model prose.
 * Token is retained only for the incumbent human confirmation card's HTTP response.
 */
export function parseWeeklyDraftState(raw: unknown, scope: Pick<WeeklyBrowserScope, "actorId" | "tenantId">): WeeklyDraftState | null {
  if (!object(raw) || raw.ok !== true || raw.actor_id !== scope.actorId || raw.tenant_id !== scope.tenantId ||
    !uuid(raw.confirmation_id) || !uuid(raw.request_id) || !instant(raw.read_at) || !instant(raw.expires_at) ||
    typeof raw.summary !== "string" || raw.summary.length < 1 || raw.summary.length > 2048 ||
    !["awaiting_approval", "saved", "saved_unreceipted", "changed", "expired", "declined", "unknown"].includes(String(raw.phase))) return null;
  const draft = parseWeeklyControlIntent("draft", raw.draft);
  if (!draft || !("name" in draft)) return null;
  const present = ["saved", "saved_unreceipted", "changed"].includes(String(raw.phase));
  if (present ? !uuid(raw.automation_id) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 ||
    !["draft", "live", "paused"].includes(String(raw.process_state))
    : raw.automation_id !== null || raw.revision !== null || raw.process_state !== null || raw.receipt_id !== null) return null;
  if (raw.phase === "awaiting_approval" ? typeof raw.confirmation_token !== "string" ||
    !/^[0-9a-f]{16}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(raw.confirmation_token)
    : raw.confirmation_token !== null) return null;
  if (raw.phase !== "changed" && raw.recurrence_authorized !== false) return null;
  if (["saved", "saved_unreceipted"].includes(String(raw.phase)) && (raw.process_state !== "draft" || raw.revision !== 1)) return null;
  if (raw.phase === "saved" && !uuid(raw.receipt_id) || raw.phase === "saved_unreceipted" && raw.receipt_id !== null ||
    raw.receipt_id !== null && !uuid(raw.receipt_id)) return null;
  return { phase: raw.phase as WeeklyDraftState["phase"], confirmationId: raw.confirmation_id, requestId: raw.request_id,
    readAt: raw.read_at, summary: raw.summary, draft: draft as WeeklyDraftIntent, expiresAt: raw.expires_at,
    token: raw.confirmation_token as string | null, automationId: raw.automation_id as string | null,
    revision: raw.revision as number | null, processState: raw.process_state as string | null, receiptId: raw.receipt_id as string | null };
}

/** Exactly one invocation. Uncertain writes are recovered by status/pending READS;
 * there is no automatic retry, new request identity or local authority/persistence.
 */
export async function requestWeeklyDraft(scope: WeeklyBrowserScope, caller: Caller, current: () => WeeklyBrowserScope | null,
  request: WeeklyDraftRequest): Promise<WeeklyDraftResult> {
  const matches = () => { const now = current(); return !scope.actAsClientId && !now?.actAsClientId &&
    now?.actorId === scope.actorId && now.tenantId === scope.tenantId && now.epoch === scope.epoch; };
  const uncertain = request.action === "commit" || request.action === "decline";
  const unavailable: WeeklyDraftResult = { kind: uncertain ? "unconfirmed" : "unavailable" };
  try {
    if (!matches()) return { kind: "refused" };
    const session = await caller.auth.getSession();
    if (session.error || session.data.session?.user.id !== scope.actorId || !matches()) return { kind: "refused" };
    const tenant = await caller.rpc("current_user_tenant_id");
    const owner = await caller.rpc("weekly_commitment_owner", { _tenant: scope.tenantId, _actor: scope.actorId });
    if (tenant.error || owner.error) return unavailable;
    if (tenant.data !== scope.tenantId || owner.data !== true || !matches()) return { kind: "refused" };
    const result = await caller.functions.invoke("weekly-commitment-command", { body: request, headers: { "x-paige-expected-tenant": scope.tenantId }, timeout: 15000 });
    const after = await caller.auth.getSession();
    if (after.error || after.data.session?.user.id !== scope.actorId || !matches()) return { kind: "refused" };
    const now = await caller.rpc("current_user_tenant_id");
    const stillOwner = await caller.rpc("weekly_commitment_owner", { _tenant: scope.tenantId, _actor: scope.actorId });
    if (!matches() || now.data !== scope.tenantId || stillOwner.data !== true) return { kind: "refused" };
    if (result.error) {
      // Only fixed domain codes, never provider/database error text, become product feedback.
      if (request.action === "prepare" && object(result.error) && result.error.context instanceof Response) {
        try {
          const error: unknown = await result.error.context.clone().json();
          if (object(error) && error.ok === false && ["INVALID_DRAFT", "INVALID_SCHEDULE"].includes(String(error.code))) return { kind: "invalid" };
          if (object(error) && error.ok === false && error.code === "DRAFT_AUTHORITY_HELD") return { kind: "held" };
        } catch { /* A malformed error remains unavailable. */ }
      }
      return unavailable;
    }
    if (now.error || stillOwner.error) return unavailable;
    if (request.action === "pending") {
      if (!object(result.data) || result.data.ok !== true || result.data.limit !== 10 || typeof result.data.has_more !== "boolean" ||
        !Array.isArray(result.data.requests) || result.data.requests.length > 10) return unavailable;
      const states = result.data.requests.map(v => parseWeeklyDraftState(v, scope));
      if (states.some(v => v === null) || new Set(states.map(v => v?.confirmationId)).size !== states.length) return unavailable;
      return { kind: "pending", requests: states as WeeklyDraftState[], hasMore: result.data.has_more };
    }
    const state = parseWeeklyDraftState(result.data, scope);
    if (!state || "confirmation_id" in request && state.confirmationId !== request.confirmation_id) return unavailable;
    if (request.action === "prepare" && Object.keys(request.draft).some(k => request.draft[k as keyof WeeklyDraftIntent] !== state.draft[k as keyof WeeklyDraftIntent])) return unavailable;
    return { kind: "state", state };
  } catch { return matches() ? unavailable : { kind: "refused" }; }
}
