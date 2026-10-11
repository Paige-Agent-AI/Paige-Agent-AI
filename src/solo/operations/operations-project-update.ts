import { supabase } from "@/integrations/supabase/client";
export type ProjectUpdate = { status: string; ownerId: string; startsOn: string; endsOn: string };
export type ProjectUpdateResult = { kind: "acknowledged" } | { kind: "refused" | "uncertain"; message: string };
export async function submitOperationsProjectUpdate(scope: { actorId: string; tenantId: string; planId: string; expectedUpdatedAt?: string }, update: ProjectUpdate): Promise<ProjectUpdateResult> {
  if (!scope.expectedUpdatedAt) return { kind: "refused", message: "This project’s current version is unavailable. Refresh before editing." };
  try {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== scope.actorId) return { kind: "refused", message: "Your account changed. Reopen the project in your current workspace." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- additive Planning seam awaits generated schema
    const { data, error } = await (supabase as any).rpc("plan_update_project_scoped", {
      p_plan_id: scope.planId, p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
      p_expected_updated_at: scope.expectedUpdatedAt, p_status: update.status, p_owner_user_id: update.ownerId,
      p_starts_on: update.startsOn, p_ends_on: update.endsOn,
    });
    const after = await supabase.auth.getSession();
    if (after.error || after.data.session?.user.id !== scope.actorId) return { kind: "uncertain", message: "Your account changed while saving. Inspect the project in its original workspace." };
    if (error) {
      if (error.code === "40001") return { kind: "refused", message: "Someone changed this project. Refresh and review before saving again." };
      if (error.code === "23514") return { kind: "refused", message: "Finish or resolve the remaining work before completing or archiving this project." };
      if (["42501", "22023"].includes(error.code)) return { kind: "refused", message: "This project change isn’t allowed. Review its owner, status and dates." };
      return { kind: "uncertain", message: "The save result is unknown. Refresh current projects before making another change." };
    }
    if (data?.ok !== true || data.plan_id !== scope.planId || data.actor_id !== scope.actorId || data.tenant_id !== scope.tenantId) return { kind: "uncertain", message: "The save result wasn’t verified. Refresh current projects before making another change." };
    return { kind: "acknowledged" };
  } catch { return { kind: "uncertain", message: "The save result is unknown. Refresh current projects before making another change." }; }
}
