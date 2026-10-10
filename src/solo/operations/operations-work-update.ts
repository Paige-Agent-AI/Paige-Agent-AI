import { supabase } from "@/integrations/supabase/client";
import type { PlanItemStatus } from "@/hooks/usePlanList";

export type WorkUpdate = { status?: PlanItemStatus; dueAt?: string; assigneeId?: string };
export type WorkUpdateScope = { actorId: string; tenantId: string; itemId: string };
export type WorkUpdateResult =
  | { kind: "acknowledged" }
  | { kind: "refused"; message: string }
  | { kind: "uncertain"; message: string };

/** Preconditions only; the scoped RPC delegates all mutation authority to canonical Planning. */
export async function submitOperationsWorkUpdate(scope: WorkUpdateScope, update: WorkUpdate): Promise<WorkUpdateResult> {
  const uncertain: WorkUpdateResult = { kind: "uncertain", message: "The result couldn’t be confirmed. Refresh the work before trying again." };
  try {
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || session.session?.user.id !== scope.actorId) return {
      kind: "refused", message: "Your account changed. Reopen the work in your current workspace.",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new scoped RPC awaits generated schema types
    const { data, error } = await (supabase as any).rpc("plan_update_item_scoped", {
      p_item_id: scope.itemId, p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
      ...(update.status ? { p_status: update.status } : {}),
      ...(update.dueAt ? { p_due_at: update.dueAt } : {}),
      ...(update.assigneeId ? { p_assigned_to_user_id: update.assigneeId } : {}),
    });
    if (error) {
      if (["42501", "22023", "P0002"].includes(error.code)) return {
        kind: "refused", message: "This change isn’t allowed for the current account, workspace or work. Refresh to review it.",
      };
      // A timeout or interrupted response does not prove that the transaction failed.
      return uncertain;
    }
    if (data?.ok !== true || data.item_id !== scope.itemId || data.tenant_id !== scope.tenantId || data.actor_id !== scope.actorId) return uncertain;
    return { kind: "acknowledged" };
  } catch { return uncertain; }
}
