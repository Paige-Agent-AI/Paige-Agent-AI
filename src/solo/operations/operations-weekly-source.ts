import { supabase } from "@/integrations/supabase/client";
import type { PlanItem } from "@/hooks/usePlanList";

export type WeeklyPlanningSource = { kind: "planning_item"; id: string } | { kind: "invalid" } | null;
export type WeeklyPlanningRead = { kind: "verified"; item: PlanItem } | { kind: "unavailable" };
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The URL carries an address only. It never supplies tenant, role or record data. */
export function parseWeeklyPlanningSource(search: string): WeeklyPlanningSource {
  const query = new URLSearchParams(search);
  if (!query.has("weeklySource") && !query.has("item")) return null;
  if (query.getAll("weeklySource").length !== 1 || query.getAll("item").length !== 1
    || query.get("weeklySource") !== "planning_item" || !uuid(query.get("item"))) return { kind: "invalid" };
  return { kind: "planning_item", id: query.get("item")!.toLowerCase() };
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const nullableUuid = (value: unknown) => value === null || uuid(value);
const nullableInstant = (value: unknown) => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));

/** Caller-RLS point read of existing personal Planning work, not a second list or resolver authority. */
export async function readWeeklyPlanningSource(scope: { actorId: string; tenantId: string; itemId: string },
  isCurrent: () => boolean): Promise<WeeklyPlanningRead> {
  const unavailable: WeeklyPlanningRead = { kind: "unavailable" };
  if (![scope.actorId, scope.tenantId, scope.itemId].every(uuid) || !isCurrent()) return unavailable;
  try {
    const before = await supabase.auth.getSession();
    if (!isCurrent() || before.error || before.data.session?.user.id !== scope.actorId) return unavailable;
    const tenantBefore = await supabase.rpc("current_user_tenant_id");
    if (!isCurrent() || tenantBefore.error || tenantBefore.data !== scope.tenantId) return unavailable;
    const memberBefore = await supabase.rpc("is_tenant_member", { _tenant: scope.tenantId });
    if (!isCurrent() || memberBefore.error || memberBefore.data !== true) return unavailable;
    const read = await supabase.from("plan_items")
      .select("id,tenant_id,plan_id,item_type,assigned_to_user_id,contact_id,title,summary,status,priority,due_at,remind_at,remind_target,reminded_at,created_by,linked_action_id,updated_at")
      .eq("tenant_id", scope.tenantId).eq("id", scope.itemId)
      .or(`created_by.eq.${scope.actorId},assigned_to_user_id.eq.${scope.actorId}`).maybeSingle();
    if (!isCurrent() || read.error || !read.data) return unavailable;
    const tenantAfter = await supabase.rpc("current_user_tenant_id");
    if (!isCurrent() || tenantAfter.error || tenantAfter.data !== scope.tenantId) return unavailable;
    const memberAfter = await supabase.rpc("is_tenant_member", { _tenant: scope.tenantId });
    if (!isCurrent() || memberAfter.error || memberAfter.data !== true) return unavailable;
    const after = await supabase.auth.getSession();
    if (!isCurrent() || after.error || after.data.session?.user.id !== scope.actorId) return unavailable;
    const row = read.data;
    if (row.id !== scope.itemId || row.tenant_id !== scope.tenantId
      || (row.created_by !== scope.actorId && row.assigned_to_user_id !== scope.actorId)
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
}
