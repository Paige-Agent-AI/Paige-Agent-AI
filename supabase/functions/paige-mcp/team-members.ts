// `list_team_members` for an MCP connection (EXP08 stage 0, owner ruling 2026-10-26).
//
// The tool used to read the GLOBAL `user_roles` table with the service role and return every
// person on the platform with their role, name and suspension flag — to any connection holding
// `admin.read`, a scope a workspace owner/admin connection is granted automatically. A team is a
// workspace's: this lists the `tenant_members` seats of the ONE workspace the connection resolves
// to (actorTenantId — server-derived, never a tool argument), and nothing else.
//
// `role` filters on the workspace seat role. Anything that is not a seat role returns no rows
// rather than an enum-cast error, and says so.

export const SEAT_ROLES = ["owner", "admin", "member"] as const;
/** Seats that still belong to the team; archived/removed seats are history, not the team. */
export const TEAM_SEAT_STATUSES = ["active", "suspended"] as const;

export interface TeamMemberItem {
  user_id: string;
  role: string;
  status: string;
  job_title: string | null;
  full_name: string | null;
  suspended: boolean;
  joined_at: string | null;
}

export type TeamListResult =
  | { ok: true; tenant_id: string; items: TeamMemberItem[]; note?: string }
  | { ok: false; error: string };

// deno-lint-ignore no-explicit-any
export async function listWorkspaceTeam(admin: any, tenantId: string | null, args: { role?: string; limit?: number }): Promise<TeamListResult> {
  if (!tenantId) return { ok: false, error: "tenant_not_resolved" };
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
  const role = typeof args.role === "string" ? args.role.trim().toLowerCase() : "";
  if (role && !(SEAT_ROLES as readonly string[]).includes(role)) {
    return { ok: true, tenant_id: tenantId, items: [], note: `role must be one of: ${SEAT_ROLES.join(", ")}` };
  }
  let q = admin
    .from("tenant_members")
    .select("user_id, role, status, job_title, joined_at")
    .eq("tenant_id", tenantId)
    .in("status", [...TEAM_SEAT_STATUSES])
    .order("joined_at", { ascending: true })
    .limit(limit);
  if (role) q = q.eq("role", role);
  const { data: seats, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (seats ?? []) as Array<{ user_id: string; role: string; status: string; job_title: string | null; joined_at: string | null }>;
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const byId = new Map<string, { full_name: string | null; suspended_at: string | null }>();
  if (ids.length) {
    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("user_id, full_name, suspended_at")
      .in("user_id", ids);
    if (pErr) return { ok: false, error: pErr.message };
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null; suspended_at: string | null }>) {
      byId.set(p.user_id, p);
    }
  }
  return {
    ok: true,
    tenant_id: tenantId,
    items: rows.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      status: r.status,
      job_title: r.job_title ?? null,
      full_name: byId.get(r.user_id)?.full_name ?? null,
      suspended: r.status === "suspended" || !!byId.get(r.user_id)?.suspended_at,
      joined_at: r.joined_at ?? null,
    })),
  };
}
