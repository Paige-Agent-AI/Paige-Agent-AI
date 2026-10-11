import { supabase } from "@/integrations/supabase/client";
import type { PlanPriority } from "@/hooks/usePlanList";

export type WorkCreation = {
  title: string; summary?: string; assigneeId: string; priority: PlanPriority;
  planId?: string; milestoneId?: string; dueAt?: string; contactId?: string;
};
export type WorkCreationScope = { actorId: string; tenantId: string };
export type WorkCreationResult =
  | { kind: "verified"; itemId: string }
  | { kind: "refused"; message: string }
  | { kind: "uncertain"; itemId?: string; message: string };

const sameInstant = (a: unknown, b?: string) => b
  ? typeof a === "string" && Date.parse(a) === Date.parse(b) : a === null;

/** A separate RLS read proves creation; an acknowledgement alone is insufficient. */
export async function createOperationsWork(scope: WorkCreationScope, draft: WorkCreation): Promise<WorkCreationResult> {
  const uncertain = (itemId?: string): WorkCreationResult => ({ kind: "uncertain", itemId,
    message: "The task’s saved state couldn’t be confirmed. Check current work before creating it again." });
  let itemId: string | undefined;
  try {
    const session = await supabase.auth.getSession();
    if (session.error || session.data.session?.user.id !== scope.actorId) return {
      kind: "refused", message: "Your account changed. Reopen task creation in your current workspace.",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scoped RPC awaits generated schema types
    const { data, error } = await (supabase as any).rpc("plan_assign_task_scoped", {
      p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
      p_title: draft.title.trim(), p_assigned_to_user_id: draft.assigneeId,
      p_priority: draft.priority, p_summary: draft.summary?.trim() || null,
      p_plan_id: draft.planId || null, p_milestone_id: draft.milestoneId || null,
      p_due_at: draft.dueAt || null, p_contact_id: draft.contactId || null,
    });
    if (error) return ["42501", "22023", "23514"].includes(error.code)
      ? { kind: "refused", message: "This task or assignment isn’t allowed. Review its person, project and milestone." }
      : uncertain();
    if (data?.ok !== true || data.actor_id !== scope.actorId || data.tenant_id !== scope.tenantId
      || typeof data.item_id !== "string" || !data.item_id) return uncertain();
    itemId = data.item_id;
    const read = await supabase.from("plan_items")
      .select("id,tenant_id,created_by,item_type,title,summary,assigned_to_user_id,plan_id,parent_item_id,priority,due_at,contact_id,status")
      .eq("id", itemId).eq("tenant_id", scope.tenantId).maybeSingle();
    const after = await supabase.auth.getSession();
    const row = read.data;
    if (read.error || after.error || after.data.session?.user.id !== scope.actorId || !row
      || row.id !== itemId || row.tenant_id !== scope.tenantId || row.created_by !== scope.actorId
      || row.item_type !== "task" || row.title !== draft.title.trim()
      || row.summary !== (draft.summary?.trim() || null) || row.assigned_to_user_id !== draft.assigneeId
      || row.plan_id !== (draft.planId || null) || row.parent_item_id !== (draft.milestoneId || null)
      || row.priority !== draft.priority || row.contact_id !== (draft.contactId || null)
      || row.status !== "open" || !sameInstant(row.due_at, draft.dueAt)) return uncertain(itemId);
    return { kind: "verified", itemId };
  } catch { return uncertain(itemId); }
}
