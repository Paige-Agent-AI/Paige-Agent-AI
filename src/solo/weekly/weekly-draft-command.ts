import { parseWeeklyDraftState, type WeeklyDraftIntent, type WeeklyDraftState } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-projection";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";
import type { WeeklyBrowserScope } from "./weekly-owner-read";

export { parseWeeklyDraftState };
export type { WeeklyDraftIntent, WeeklyDraftState };
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

/** Exactly one invocation. Uncertain writes are recovered by status/pending READS;
 * there is no automatic retry, new request identity or local authority/persistence.
 */
export async function requestWeeklyDraft(scope: WeeklyBrowserScope, caller: Caller, current: () => WeeklyBrowserScope | null,
  request: WeeklyDraftRequest): Promise<WeeklyDraftResult> {
  const matches = () => { const now = current(); return !scope.actAsClientId && !now?.actAsClientId &&
    now?.actorId === scope.actorId && now.tenantId === scope.tenantId && now.epoch === scope.epoch; };
  const uncertain = request.action === "commit" || request.action === "decline";
  const unavailable: WeeklyDraftResult = { kind: uncertain ? "unconfirmed" : "unavailable" };
  const stage = createWeeklyDraftDeadline(15_000, matches);
  try {
    if (!matches()) return { kind: "refused" };
    const session = await stage(() => caller.auth.getSession());
    if (session.error || session.data.session?.user.id !== scope.actorId || !matches()) return { kind: "refused" };
    const tenant = await stage(() => caller.rpc("current_user_tenant_id"));
    const owner = await stage(() => caller.rpc("weekly_commitment_owner", { _tenant: scope.tenantId, _actor: scope.actorId }));
    if (tenant.error || owner.error) return unavailable;
    if (tenant.data !== scope.tenantId || owner.data !== true || !matches()) return { kind: "refused" };
    const result = await stage(() => caller.functions.invoke("weekly-commitment-command", { body: request, headers: { "x-paige-expected-tenant": scope.tenantId }, timeout: 15000 }));
    const after = await stage(() => caller.auth.getSession());
    if (after.error || after.data.session?.user.id !== scope.actorId || !matches()) return { kind: "refused" };
    const now = await stage(() => caller.rpc("current_user_tenant_id"));
    const stillOwner = await stage(() => caller.rpc("weekly_commitment_owner", { _tenant: scope.tenantId, _actor: scope.actorId }));
    if (!matches() || now.data !== scope.tenantId || stillOwner.data !== true) return { kind: "refused" };
    if (result.error) {
      // Only fixed domain codes, never provider/database error text, become product feedback.
      if (request.action === "prepare" && object(result.error) && result.error.context instanceof Response) {
        try {
          const errorResponse = result.error.context;
          const error: unknown = await stage(() => errorResponse.clone().json());
          if (object(error) && error.ok === false && typeof error.code === "string" && ["INVALID_DRAFT", "INVALID_SCHEDULE"].includes(error.code)) return { kind: "invalid" };
          if (object(error) && error.ok === false && error.code === "DRAFT_AUTHORITY_HELD") return { kind: "held" };
        } catch { /* A malformed error remains unavailable. */ }
      }
      return matches() ? unavailable : { kind: "refused" };
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
