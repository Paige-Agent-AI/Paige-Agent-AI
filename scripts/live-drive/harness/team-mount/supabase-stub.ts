type Member = { membership_id: string; user_id: string; full_name: string; email: string; avatar_url: null; status: string; permission: string; is_owner: boolean; job_title: string | null; responsibilities: string | null; last_sign_in_at: string | null };
type Invite = { id: string; email: string; permission: string; created_at: string; expires_at: string; revoked_at: string | null; uses: number; job_title?: string; responsibilities?: string };

const names = ["Antonio Martinez", "Maya Chen", "Jordan Ellis", "Priya Shah", "Theo Brooks", "Amina Lewis", "Noah Williams", "Sofia Ramirez"];
const members: Member[] = Array.from({ length: 34 }, (_, i) => ({
  membership_id: `membership-${i}`, user_id: `user-${i}`, full_name: i ? `${names[i % names.length]} ${i}` : "Antonio Martinez", email: i ? `person${i}@northstar.example` : "owner@northstar.example", avatar_url: null, status: "active", permission: i === 0 ? "owner" : i % 7 === 0 ? "admin" : "member", is_owner: i === 0, // One person has no title, so the roster's "not set" state renders (team-title-render.mjs).
  job_title: i === 0 ? "Founder" : i === 3 ? null : i % 7 === 0 ? "Operations Lead" : "Client Success Manager", responsibilities: i === 0 ? "Sets company direction and confirms governed actions." : "Owns client delivery, communicates handoffs, and keeps account work moving.", last_sign_in_at: i % 5 === 0 ? null : "2026-08-30T16:00:00Z",
}));
const invites: Invite[] = [
  { id: "invite-pending", email: "alex@northstar.example", permission: "member", created_at: "2026-08-30T00:00:00Z", expires_at: "2026-09-07T00:00:00Z", revoked_at: null, uses: 0 },
  { id: "invite-expired", email: "sam@northstar.example", permission: "admin", created_at: "2026-08-01T00:00:00Z", expires_at: "2026-08-08T00:00:00Z", revoked_at: null, uses: 0 },
];

const mode = () => new URLSearchParams(window.location.search).get("state") || "dense";
const rpc = async (name: string, args: Record<string, unknown> = {}) => {
  if (name === "get_solo_team_workspace") {
    if (mode() === "denied") return { data: null, error: { message: "access denied" } };
    let rows = mode() === "first" ? members.slice(0, 1) : [...members];
    const search = String(args._search || "").toLowerCase(); const permission = String(args._permission || "all");
    if (search) rows = rows.filter((m) => [m.full_name, m.email, m.job_title, m.responsibilities].some((v) => v?.toLowerCase().includes(search)));
    if (permission !== "all") rows = rows.filter((m) => (m.is_owner ? "owner" : m.permission) === permission);
    const total = rows.length; const offset = Number(args._offset || 0); const limit = Number(args._limit || 25);
    return { data: { tenant_id: "team-harness-tenant", tenant_name: "Northstar Studio", viewer_permission: "owner", can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: total, members: rows.slice(offset, offset + limit), invitations: mode() === "first" ? [] : invites }, error: null };
  }
  if (name === "set_solo_team_member_work_profile") {
    const row = members.find((m) => m.user_id === args._member_user_id); if (row) { row.job_title = String(args._job_title || "") || null; row.responsibilities = String(args._responsibilities || "") || null; }
    return { data: { ok: true }, error: null };
  }
  if (name === "set_solo_team_member_permission") {
    const row = members.find((m) => m.user_id === args._member_user_id); if (row) row.permission = String(args._new_permission);
    return { data: { ok: true }, error: null };
  }
  if (name === "remove_solo_team_member") {
    // Mirrors the server's own guards so the harness cannot show a state the database would refuse.
    // `?remove=refuse-owner|refuse-nonowner|already-gone|network|wrong-tenant` drives each branch.
    const forced = new URLSearchParams(window.location.search).get("remove");
    if (forced === "refuse-nonowner") return { data: null, error: { message: "only the workspace owner may remove someone from this workspace" } };
    if (forced === "already-gone") return { data: null, error: { message: "that person is not on this workspace's team" } };
    if (forced === "network") return { data: null, error: { message: "TypeError: Failed to fetch" } };
    if (forced === "wrong-tenant") return { data: { tenant_id: "some-other-tenant", membership_id: "x", removed_user_id: String(args._member_user_id) }, error: null };
    const index = members.findIndex((m) => m.user_id === args._member_user_id);
    if (index < 0) return { data: null, error: { message: "that person is not on this workspace's team" } };
    if (members[index].is_owner || members[index].permission === "owner") return { data: null, error: { message: "an owner cannot be removed from this workspace here" } };
    if (args._expected_tenant_id !== "team-harness-tenant") return { data: null, error: { message: "your active workspace changed before this could run; nothing was removed" } };
    const [gone] = members.splice(index, 1);
    return { data: { tenant_id: "team-harness-tenant", membership_id: gone.membership_id, removed_user_id: gone.user_id }, error: null };
  }
  return { data: null, error: { message: `Unsupported harness RPC ${name}` } };
};
const invoke = async (_name: string, options: { body?: Record<string, unknown> }) => {
  const body = options.body || {};
  if (body.action === "create") invites.unshift({ id: `invite-${invites.length}`, email: String(body.email), permission: String(body.permission), created_at: new Date().toISOString(), expires_at: "2026-09-07T00:00:00Z", revoked_at: null, uses: 0 });
  if (body.action === "revoke") { const row = invites.find((i) => i.id === body.inviteId); if (row) row.revoked_at = new Date().toISOString(); }
  return { data: { ok: true, emailed: true }, error: null };
};
export const supabase = { rpc, functions: { invoke } };
