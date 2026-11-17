import { supabase } from "@/integrations/supabase/client";
import { getScopedUserId } from "@/lib/scopedUser";
import type { WeeklyPlanReviewInput } from "../../../supabase/functions/_shared/planning/weekly-plan-review";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";

type Scope = { actorId: string; tenantId: string };
type NativeReply = { error: { code?: string } | null; data: { status?: unknown; request_id?: unknown; plan_id?: unknown; receipt_run_id?: unknown; work_id?: unknown; current_work?: unknown; review_zone?: unknown; confirmed_goal?: unknown; starts_on?: unknown; confirmed_capacity_minutes?: unknown } | null };
// The same client/JWT; this bounded forward-native API awaits generated types.
const nativeCaller = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<NativeReply> };
export type WeeklyPlanSaveRequest = { v: 1; starts_on: string; zone: string; goal: string;
  sources: { key: string; updated_at: string; minutes: number | null; dependencies: string[] }[];
  capacity_minutes: Record<string, number>; included: string[] };
export type WeeklyPlanCurrentWork = { key: string; state: "unavailable" } | { key: string; state: "available"; id: string; source: "crm" | "planning"; title: string; status: string; dueAt: string | null; changedSinceReview: boolean; originalMinutes: number; originalOwnerId: string; originalDependencies: string[] };
export type WeeklyPlanSaveResult = { kind: "verified"; planId: string; receiptId: string; requestId: string; workId: string; currentWork: WeeklyPlanCurrentWork[]; reviewZone: string; recovered: boolean; confirmedGoal: string; startsOn: string; confirmedCapacityMinutes: Record<string, number> }
  | { kind: "absent" } | { kind: "refused" | "uncertain"; message: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const key = (s: Scope) => `paige:operations-weekly-plan:${s.actorId}:${s.tenantId}`;
function currentWorkRows(value: unknown): WeeklyPlanCurrentWork[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) return null;
  const seen = new Set<string>(), out: WeeklyPlanCurrentWork[] = [];
  for (const raw of value) {
    const row = raw as Record<string, unknown>;
    if (!row || typeof row.key !== "string" || !/^(crm|planning):[0-9a-f-]{36}$/i.test(row.key) || seen.has(row.key)) return null;
    seen.add(row.key);
    if (row.state === "unavailable") { out.push({ key: row.key, state: "unavailable" }); continue; }
    if (row.state !== "available" || !uuid(row.id) || !["crm", "planning"].includes(String(row.source)) || row.key !== `${row.source}:${row.id}`
      || typeof row.title !== "string" || !["pending", "open", "in_progress", "blocked", "done", "completed", "cancelled"].includes(String(row.status))
      || (row.due_at !== null && (typeof row.due_at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(row.due_at) || !Number.isFinite(Date.parse(row.due_at)))) || typeof row.changed_since_review !== "boolean"
      || typeof row.original_minutes !== "number" || !Number.isSafeInteger(row.original_minutes) || row.original_minutes < 0 || row.original_minutes > 2147483647
      || !uuid(row.original_owner_id) || !Array.isArray(row.original_dependencies) || row.original_dependencies.length > 40
      || new Set(row.original_dependencies).size !== row.original_dependencies.length
      || row.original_dependencies.some(v => typeof v !== "string" || !/^(crm|planning):[0-9a-f-]{36}$/i.test(v))) return null;
    out.push({ key: row.key, state: "available", id: row.id, source: row.source as "crm" | "planning", title: row.title, status: String(row.status), dueAt: row.due_at as string | null, changedSinceReview: row.changed_since_review,
      originalMinutes: row.original_minutes as number, originalOwnerId: row.original_owner_id, originalDependencies: row.original_dependencies as string[] });
  }
  return out;
}

/** Only the scoped SAVE ATTEMPT identity is retained, never work text/approval. */
export function retainedWeeklyPlanAttempt(scope: Scope): string | null {
  const value = sessionStorage.getItem(key(scope));
  if (value === null) return null;
  if (!uuid(value)) throw new Error("The previous save identity could not be read. Inspect Projects before starting another plan.");
  return value;
}
export function releaseWeeklyPlanAttempt(scope: Scope, requestId: string): void {
  if (retainedWeeklyPlanAttempt(scope) === requestId) sessionStorage.removeItem(key(scope));
}

export function weeklyPlanSaveRequest(input: WeeklyPlanReviewInput, included: string[]): WeeklyPlanSaveRequest {
  const needed = new Set([...input.selected, ...Object.values(input.dependencies).flat()]);
  return { v: 1, starts_on: input.startsOn, zone: input.zone, goal: input.goal.trim(), capacity_minutes: { ...input.capacities }, included: [...included],
    sources: input.work.filter(row => needed.has(row.key)).map(row => ({ key: row.key, updated_at: row.updatedAt,
      minutes: Object.prototype.hasOwnProperty.call(input.estimates, row.key) ? input.estimates[row.key] : row.minutes,
      dependencies: [...(input.dependencies[row.key] ?? [])] })) };
}

/** Same caller/native producer and receipt. A failed acknowledgement never retries. */
export async function saveWeeklyPlanReview(scope: Scope, request: WeeklyPlanSaveRequest | null, isCurrent: () => boolean, inspectRequestId?: string): Promise<WeeklyPlanSaveResult> {
  const uncertain = (): WeeklyPlanSaveResult => ({ kind: "uncertain", message: "The plan’s result is not confirmed. Check this same save before starting another plan." });
  const current = () => getScopedUserId() === null && isCurrent();
  const stage = createWeeklyDraftDeadline(8000, current);
  try {
    if (!uuid(scope.actorId) || !uuid(scope.tenantId) || !current()) return { kind: "refused", message: "Your workspace changed. Reopen Planning in your current account." };
    const session = await stage(() => supabase.auth.getSession());
    if (session.error || session.data.session?.user.id !== scope.actorId || !current()) return { kind: "refused", message: "Sign in to this workspace again before saving." };
    const tenant = await stage(() => supabase.rpc("current_user_tenant_id"));
    if (tenant.error || tenant.data !== scope.tenantId || !current()) return { kind: "refused", message: "Your workspace changed. Reopen Planning in your current account." };
    const authority = await stage(() => supabase.rpc("is_tenant_admin", { _tenant: scope.tenantId }));
    if (authority.error || authority.data !== true) return { kind: "refused", message: "This weekly review requires a current workspace owner or administrator." };
    if (inspectRequestId !== undefined && (request !== null || !uuid(inspectRequestId))) return { kind: "refused", message: "This original plan reference is unavailable." };
    let requestId = inspectRequestId ?? retainedWeeklyPlanAttempt(scope);
    if (!requestId && !request) return { kind: "absent" };
    if (!requestId) {
      requestId = crypto.randomUUID();
      try {
        sessionStorage.setItem(key(scope), requestId);
        if (retainedWeeklyPlanAttempt(scope) !== requestId) throw new Error("Recovery identity was not retained");
      } catch { return { kind: "refused", message: "Save recovery is unavailable in this browser. Nothing was submitted." }; }
    }
    if (!current()) return uncertain();
    const response = await stage(() => nativeCaller.rpc(request ? "save_weekly_plan_review_scoped" : "get_weekly_plan_review_result_scoped", {
      p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId, p_request_id: requestId, ...(request ? { p_review: request } : {}),
    }));
    if (!current()) return uncertain();
    if (response.error) return ["42501", "22023", "22007", "22008", "40001"].includes(response.error.code ?? "")
      ? { kind: "refused", message: !request ? "The original save cannot be verified under current permissions. This check submitted no new plan." : response.error.code === "40001" ? "The original work or business time zone changed. Refresh and review again; this save was refused."
        : "This plan could not be saved under the current permissions or review. Check the same save, then correct the review." } : uncertain();
    const data = response.data;
    if (data?.status === "not_found" && !request) return { kind: "absent" };
    if (data?.status !== "succeeded" || data.request_id !== requestId || !uuid(data.plan_id) || !uuid(data.receipt_run_id) || !uuid(data.work_id)) return uncertain();
    const planId = data.plan_id;
    const currentWork = currentWorkRows(data.current_work);
    const capacity = data.confirmed_capacity_minutes;
    if (!currentWork || typeof data.review_zone !== "string" || typeof data.confirmed_goal !== "string" || !data.confirmed_goal.trim() || data.confirmed_goal.length > 2000
      || typeof data.starts_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.starts_on) || !capacity || typeof capacity !== "object" || Array.isArray(capacity)
      || Object.keys(capacity).length < 1 || Object.keys(capacity).length > 40
      || Object.entries(capacity).some(([owner, value]) => !uuid(owner) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10080 || value % 15 !== 0)) return uncertain();
    try { new Intl.DateTimeFormat("en-US", { timeZone: data.review_zone }).format(); } catch { return uncertain(); }
    const read = await stage(() => supabase.from("plans").select("id,tenant_id,created_by,metadata").eq("id", planId).eq("tenant_id", scope.tenantId).maybeSingle());
    const after = await stage(() => supabase.auth.getSession());
    const tenantAfter = await stage(() => supabase.rpc("current_user_tenant_id"));
    const authorityAfter = await stage(() => supabase.rpc("is_tenant_admin", { _tenant: scope.tenantId }));
    const metadata = read.data?.metadata as { weekly_plan_review_v1?: { request_id?: unknown; receipt_run_id?: unknown } } | null;
    if (!current() || read.error || after.error || tenantAfter.error || tenantAfter.data !== scope.tenantId || after.data.session?.user.id !== scope.actorId || authorityAfter.error || authorityAfter.data !== true
      || read.data?.id !== data.plan_id || read.data.tenant_id !== scope.tenantId || read.data.created_by !== scope.actorId
      || metadata?.weekly_plan_review_v1?.request_id !== requestId || metadata.weekly_plan_review_v1.receipt_run_id !== data.receipt_run_id) return uncertain();
    return { kind: "verified", planId: data.plan_id, receiptId: data.receipt_run_id, workId: data.work_id, requestId, currentWork, reviewZone: data.review_zone, recovered: request === null,
      confirmedGoal: data.confirmed_goal, startsOn: data.starts_on, confirmedCapacityMinutes: capacity as Record<string, number> };
  } catch { return uncertain(); }
}
