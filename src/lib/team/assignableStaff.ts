// The people a contact, deal or reassignment can be handed to, in the caller's own workspace.
//
// One home for every assignee picker. It reads get_tenant_assignable_members(), which derives the
// workspace on the server (tenant_members joined to current_user_tenant_id(), never a parameter)
// and returns only user_id, name and app roles. Only admins and super admins are offered: the
// retired title role grants nothing, and a job title never decides who may own work.
import { supabase } from "@/integrations/supabase/client";

export type AssignableStaff = { user_id: string; name: string };

type RosterRow = { user_id: string; full_name: string | null; roles: string[] | null };

// The generated client types do not list this RPC yet, so it is called through a narrow shape.
type RosterRpc = {
  rpc(fn: "get_tenant_assignable_members"): PromiseLike<{
    data: RosterRow[] | null;
    error: { message: string } | null;
  }>;
};

const ASSIGNABLE_ROLES = new Set(["admin", "super_admin"]);

export function toAssignableStaff(rows: RosterRow[] | null | undefined): AssignableStaff[] {
  return (rows ?? [])
    .filter((row) => (row.roles ?? []).some((role) => ASSIGNABLE_ROLES.has(role)))
    .map((row) => ({ user_id: row.user_id, name: row.full_name || "Unnamed member" }));
}

export async function loadAssignableStaff(): Promise<AssignableStaff[]> {
  const { data, error } = await (supabase as unknown as RosterRpc).rpc("get_tenant_assignable_members");
  if (error) {
    console.warn("Assignable staff could not be loaded:", error.message);
    return [];
  }
  return toAssignableStaff(data);
}
