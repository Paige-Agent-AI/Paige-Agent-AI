import { supabase } from "@/integrations/supabase/client";
import { getScopedUserId } from "@/lib/scopedUser";
import type { PlanItem } from "@/hooks/usePlanList";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline.ts";

export type WeeklyPlanningSource = { kind: "planning_item"; id: string } | { kind: "invalid" } | null;
export type WeeklyPlanningRead = { kind: "verified"; item: PlanItem } | { kind: "unavailable" };
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The URL carries an address only. It never supplies tenant, role or record data. */
export function parseWeeklyPlanningSource(search: string): WeeklyPlanningSource {
  const query = new URLSearchParams(search);
  if (query.has("planningItem")) {
    if (query.getAll("planningItem").length !== 1 || query.has("task") || query.has("weeklySource") || query.has("item")
      || !uuid(query.get("planningItem"))) return { kind: "invalid" };
    return { kind: "planning_item", id: query.get("planningItem")!.toLowerCase() };
  }
  if (!query.has("weeklySource") && !query.has("item")) return null;
  if (query.getAll("weeklySource").length !== 1 || query.getAll("item").length !== 1
    || query.get("weeklySource") !== "planning_item" || !uuid(query.get("item"))) return { kind: "invalid" };
  return { kind: "planning_item", id: query.get("item")!.toLowerCase() };
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const nullableUuid = (value: unknown) => value === null || uuid(value);
const nullableInstant = (value: unknown) => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));

/** Caller-RLS point read of the exact historical Planning source under current authority. */
export async function readWeeklyPlanningSource(scope: { actorId: string; tenantId: string; itemId: string },
  isCurrent: () => boolean): Promise<WeeklyPlanningRead> {
  const unavailable: WeeklyPlanningRead = { kind: "unavailable" };
  const origin = Object.freeze({ ...scope });
  let retired = false;
  const matches = () => {
    try { return !retired && getScopedUserId() === null && isCurrent(); }
    catch { return false; }
  };
  if (![origin.actorId, origin.tenantId, origin.itemId].every(uuid) || !matches()) return unavailable;
  const stage = createWeeklyDraftDeadline(8000, matches);
  const inspect = <T>(start: () => PromiseLike<T>) => stage(() => {
    const request = start();
    if (request instanceof Promise) void request.catch(() => {});
    // The SDK may return a lazy PostgREST query. Recheck the same elapsed
    // stage before subscription, including after synchronous construction.
    return stage(() => new Promise<T>((resolve, reject) => request.then(resolve, reject)));
  });
  try {
    const before = await inspect(() => supabase.auth.getSession());
    if (!matches() || before.error || before.data.session?.user.id !== origin.actorId) return unavailable;
    const tenantBefore = await inspect(() => supabase.rpc("current_user_tenant_id"));
    if (!matches() || tenantBefore.error || tenantBefore.data !== origin.tenantId) return unavailable;
    const memberBefore = await inspect(() => supabase.rpc("is_tenant_member", { _tenant: origin.tenantId }));
    if (!matches() || memberBefore.error || memberBefore.data !== true) return unavailable;
    const read = await inspect(() => supabase.from("plan_items")
      .select("id,tenant_id,plan_id,item_type,assigned_to_user_id,contact_id,title,summary,status,priority,due_at,remind_at,remind_target,reminded_at,created_by,linked_action_id,updated_at")
      .eq("tenant_id", origin.tenantId).eq("id", origin.itemId).maybeSingle());
    if (!matches() || read.error || !read.data) return unavailable;
    const tenantAfter = await inspect(() => supabase.rpc("current_user_tenant_id"));
    if (!matches() || tenantAfter.error || tenantAfter.data !== origin.tenantId) return unavailable;
    const memberAfter = await inspect(() => supabase.rpc("is_tenant_member", { _tenant: origin.tenantId }));
    if (!matches() || memberAfter.error || memberAfter.data !== true) return unavailable;
    const after = await inspect(() => supabase.auth.getSession());
    if (!matches() || after.error || after.data.session?.user.id !== origin.actorId) return unavailable;
    const row = read.data;
    if (row.id !== origin.itemId || row.tenant_id !== origin.tenantId
      || typeof row.title !== "string" || !nullableString(row.summary) || !nullableUuid(row.plan_id)
      || !nullableUuid(row.assigned_to_user_id) || !nullableUuid(row.created_by) || !nullableUuid(row.contact_id)
      || !nullableUuid(row.linked_action_id) || !nullableString(row.remind_target)
      || !["task", "milestone", "reminder"].includes(row.item_type)
      || !["open", "in_progress", "blocked", "done", "cancelled"].includes(row.status)
      || !["low", "normal", "high", "urgent"].includes(row.priority)
      || ![row.due_at, row.remind_at, row.reminded_at].every(nullableInstant)
      || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) return unavailable;
    // Do not normalize the row version: the existing writer compares its raw precision.
    return { kind: "verified", item: row as PlanItem };
  } catch { return unavailable; }
  finally { retired = true; }
}
