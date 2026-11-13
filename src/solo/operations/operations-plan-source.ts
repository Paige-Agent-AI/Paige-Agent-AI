import { supabase } from "@/integrations/supabase/client";
import { getScopedUserId } from "@/lib/scopedUser";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import { createWeeklyDraftDeadline } from "../../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export type OperationsPlanSource = Plan & { metadata?: unknown; created_at?: string; itemsPartial: boolean };
export function parseOperationsPlanFocus(search: string): { kind: "plan"; id: string } | { kind: "invalid" } | null {
  const q = new URLSearchParams(search);
  if (!q.has("planningPlan")) return null;
  if (q.getAll("planningPlan").length !== 1 || !uuid(q.get("planningPlan")) || ["task", "planningItem", "item", "weeklySource", "weeklyPlan"].some(key => q.has(key))) return { kind: "invalid" };
  return { kind: "plan", id: q.get("planningPlan")!.toLowerCase() };
}
/** Exact original caller-RLS Plan + visible items; address never grants access. */
export async function readOperationsPlanSource(scope: { actorId: string; tenantId: string; planId: string }, isCurrent: () => boolean): Promise<OperationsPlanSource | null> {
  const current = () => getScopedUserId() === null && isCurrent();
  const stage = createWeeklyDraftDeadline(8000, current);
  try {
    if (![scope.actorId, scope.tenantId, scope.planId].every(uuid) || !current()) return null;
    const session = await stage(() => supabase.auth.getSession()), tenant = await stage(() => supabase.rpc("current_user_tenant_id"));
    if (session.error || session.data.session?.user.id !== scope.actorId || tenant.error || tenant.data !== scope.tenantId) return null;
    const member = await stage(() => supabase.rpc("is_tenant_member", { _tenant: scope.tenantId }));
    if (member.error || member.data !== true) return null;
    const plan = await stage(() => supabase.from("plans").select("id,tenant_id,title,summary,horizon,scope,status,starts_on,ends_on,owner_user_id,created_by,updated_at,created_at,metadata").eq("id", scope.planId).eq("tenant_id", scope.tenantId).maybeSingle());
    if (plan.error || !plan.data || plan.data.id !== scope.planId || plan.data.tenant_id !== scope.tenantId) return null;
    const items = await stage(() => supabase.from("plan_items").select("id,tenant_id,plan_id,item_type,assigned_to_user_id,contact_id,title,summary,status,priority,due_at,remind_at,remind_target,reminded_at,created_by,linked_action_id,updated_at").eq("plan_id", scope.planId).eq("tenant_id", scope.tenantId).order("id").limit(201));
    const after = await stage(() => supabase.auth.getSession()), tenantAfter = await stage(() => supabase.rpc("current_user_tenant_id"));
    const memberAfter = await stage(() => supabase.rpc("is_tenant_member", { _tenant: scope.tenantId }));
    if (!current() || items.error || !items.data || items.data.some(item => item.tenant_id !== scope.tenantId || item.plan_id !== scope.planId)
      || after.error || after.data.session?.user.id !== scope.actorId || tenantAfter.error || tenantAfter.data !== scope.tenantId || memberAfter.error || memberAfter.data !== true) return null;
    return { ...plan.data, items: items.data.slice(0, 200) as PlanItem[], itemsPartial: items.data.length > 200 };
  } catch { return null; }
}
