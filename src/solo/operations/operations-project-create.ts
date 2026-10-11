import { supabase } from "@/integrations/supabase/client";
import type { PlanPriority } from "@/hooks/usePlanList";
import type { WorkCreationScope } from "./operations-work-create";

export type ProjectDraft = { kind: "project"; title: string; summary?: string; ownerId: string;
  scope: "individual" | "team"; horizon: string; startsOn: string; endsOn: string };
export type MilestoneDraft = { kind: "milestone"; title: string; summary?: string; ownerId: string;
  planId: string; priority: PlanPriority; dueAt?: string };
export type ProjectCreationResult = { kind: "verified"; id: string }
  | { kind: "refused"; message: string } | { kind: "uncertain"; id?: string; message: string };

/** Canonical writers; a bounded acknowledgement is followed by caller-RLS readback. */
export async function createOperationsProjectRecord(scope: WorkCreationScope, draft: ProjectDraft | MilestoneDraft): Promise<ProjectCreationResult> {
  let id: string | undefined;
  const uncertain = (): ProjectCreationResult => ({ kind: "uncertain", id,
    message: "The saved record couldn’t be confirmed. Inspect current work before creating it again." });
  try {
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== scope.actorId) return { kind: "refused", message: "Your account changed. Reopen this form in your current workspace." };
    const common = { p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId,
      p_title: draft.title.trim(), p_summary: draft.summary?.trim() || null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow scoped wrappers await generated schema types
    const { data, error } = await (supabase as any).rpc(draft.kind === "project" ? "plan_create_scoped" : "plan_add_milestone_scoped",
      draft.kind === "project" ? { ...common, p_owner_user_id: draft.ownerId, p_scope: draft.scope,
        p_horizon: draft.horizon, p_starts_on: draft.startsOn, p_ends_on: draft.endsOn }
        : { ...common, p_plan_id: draft.planId, p_assigned_to_user_id: draft.ownerId,
          p_priority: draft.priority, p_due_at: draft.dueAt || null });
    if (error) return ["42501", "22023", "23514"].includes(error.code)
      ? { kind: "refused", message: "This creation isn’t allowed. Review the owner, project and dates." } : uncertain();
    const candidate = draft.kind === "project" ? data?.plan_id : data?.item_id;
    if (data?.ok !== true || data.actor_id !== scope.actorId || data.tenant_id !== scope.tenantId || typeof candidate !== "string" || !candidate) return uncertain();
    id = candidate;
    const read = draft.kind === "project"
      ? await supabase.from("plans").select("id,tenant_id,created_by,title,summary,owner_user_id,scope,horizon,starts_on,ends_on,status").eq("id", id).eq("tenant_id", scope.tenantId).maybeSingle()
      : await supabase.from("plan_items").select("id,tenant_id,created_by,title,summary,assigned_to_user_id,plan_id,item_type,priority,due_at,status").eq("id", id).eq("tenant_id", scope.tenantId).maybeSingle();
    const after = await supabase.auth.getSession();
    const row = read.data;
    if (read.error || after.error || after.data.session?.user.id !== scope.actorId || !row
      || row.id !== id || row.tenant_id !== scope.tenantId || row.created_by !== scope.actorId
      || row.title !== draft.title.trim() || row.summary !== (draft.summary?.trim() || null)) return uncertain();
    if (draft.kind === "project") {
      if (!("owner_user_id" in row) || row.owner_user_id !== draft.ownerId || row.scope !== draft.scope
        || row.horizon !== draft.horizon || row.starts_on !== draft.startsOn || row.ends_on !== draft.endsOn
        || row.status !== "draft") return uncertain();
    } else if (!("assigned_to_user_id" in row) || row.assigned_to_user_id !== draft.ownerId
      || row.plan_id !== draft.planId || row.item_type !== "milestone" || row.priority !== draft.priority
      || row.status !== "open" || (draft.dueAt ? typeof row.due_at !== "string" || Date.parse(row.due_at) !== Date.parse(draft.dueAt) : row.due_at !== null)) return uncertain();
    return { kind: "verified", id };
  } catch { return uncertain(); }
}
