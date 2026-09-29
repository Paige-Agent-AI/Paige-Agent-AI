import { activeWorkspace, WORKSPACES } from "./tenant-context-stub";
type Member = { membership_id: string; user_id: string; full_name: string; email: string; avatar_url: null; status: string; permission: string; is_owner: boolean; job_title: string | null; responsibilities: string | null; last_sign_in_at: string | null };
type Invite = { id: string; email: string; permission: string; created_at: string; expires_at: string; revoked_at: string | null; uses: number; job_title?: string; responsibilities?: string };

const names = ["Antonio Martinez", "Maya Chen", "Jordan Ellis", "Priya Shah", "Theo Brooks", "Amina Lewis", "Noah Williams", "Sofia Ramirez"];
const members: Member[] = Array.from({ length: 34 }, (_, i) => ({
  membership_id: `membership-${i}`, user_id: `user-${i}`, full_name: i ? `${names[i % names.length]} ${i}` : "Antonio Martinez", email: i ? `person${i}@northstar.example` : "owner@northstar.example", avatar_url: null, status: "active", permission: i === 0 ? "owner" : i % 7 === 0 ? "admin" : "member", is_owner: i === 0, // One person has no title, so the roster's "not set" state renders (team-title-render.mjs).
  job_title: i === 0 ? "Founder" : i === 3 ? null : i % 7 === 0 ? "Operations Lead" : "Client Success Manager", responsibilities: i === 0 ? "Sets company direction and confirms governed actions." : "Owns client delivery, communicates handoffs, and keeps account work moving.", last_sign_in_at: i % 5 === 0 ? null : "2026-08-30T16:00:00Z",
}));
// The second workspace: fewer people, a title long enough to wrap, one untitled, one admin.
const harbor: Member[] = [
  ["Dana Reyes", "owner", "Founder and Lead Coach"],
  ["Luis Ortega", "admin", "Operations Lead"],
  ["Mei Tanaka", "member", "Senior Client Experience and Onboarding Coordinator for Corporate Wellness Programs and Partnerships"],
  ["Ari Cohen", "member", null],
  ["Grace Okafor", "member", "Front Desk"],
].map(([full_name, permission, job_title], i) => ({
  membership_id: `harbor-membership-${i}`, user_id: `harbor-user-${i}`, full_name: String(full_name), email: `${String(full_name).split(" ")[0].toLowerCase()}@harbor.example`, avatar_url: null, status: "active",
  permission: String(permission), is_owner: permission === "owner", job_title: (job_title as string | null), responsibilities: i === 0 ? "Leads the coaching programme." : null, last_sign_in_at: "2026-09-20T16:00:00Z",
}));
const rosterOf = () => (activeWorkspace() === "team-harness-tenant-2" ? harbor : members);
// Invitation dates are RELATIVE to now. They were fixed calendar dates, so the "pending" invitation
// and every invitation sent through this harness expired on 2026-09-07 and dropped into the closed
// "past invitations" list — which is why the drive's lifecycle check failed from that day on.
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const invites: Invite[] = [
  { id: "invite-pending", email: "alex@northstar.example", permission: "member", created_at: at(-1), expires_at: at(7), revoked_at: null, uses: 0 },
  { id: "invite-expired", email: "sam@northstar.example", permission: "admin", created_at: at(-30), expires_at: at(-23), revoked_at: null, uses: 0 },
];
// Invitations belong to a workspace, as the real read scopes them; the second one starts with none.
const harborInvites: Invite[] = [];
const invitesOf = () => (activeWorkspace() === "team-harness-tenant-2" ? harborInvites : invites);

const mode = () => new URLSearchParams(window.location.search).get("state") || "dense";
const rpc = async (name: string, args: Record<string, unknown> = {}) => {
  if (name === "get_solo_team_workspace") {
    if (mode() === "denied") return { data: null, error: { message: "access denied" } };
    let rows = mode() === "first" ? rosterOf().slice(0, 1) : [...rosterOf()];
    const search = String(args._search || "").toLowerCase(); const permission = String(args._permission || "all");
    if (search) rows = rows.filter((m) => [m.full_name, m.email, m.job_title, m.responsibilities].some((v) => v?.toLowerCase().includes(search)));
    if (permission !== "all") rows = rows.filter((m) => (m.is_owner ? "owner" : m.permission) === permission);
    const total = rows.length; const offset = Number(args._offset || 0); const limit = Number(args._limit || 25);
    return { data: { tenant_id: activeWorkspace(), tenant_name: WORKSPACES[activeWorkspace()], viewer_permission: viewerPermission(), can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true, total_members: total, members: rows.slice(offset, offset + limit), invitations: mode() === "first" ? [] : invitesOf() }, error: null };
  }
  if (name === "set_solo_team_member_work_profile") {
    const row = rosterOf().find((m) => m.user_id === args._member_user_id); if (row) { row.job_title = String(args._job_title || "") || null; row.responsibilities = String(args._responsibilities || "") || null; }
    return { data: { ok: true }, error: null };
  }
  if (name === "set_solo_team_member_permission") {
    const row = rosterOf().find((m) => m.user_id === args._member_user_id); if (row) row.permission = String(args._new_permission);
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
  if (name === "set_user_contact_methods") {
    // Mirrors the server's authority rule: an admin may not rewrite the owner's addresses.
    const target = String(args.p_user_id);
    if (viewerPermission() === "admin" && target === "user-0") return { data: null, error: { message: "USER_CONTACT_METHODS_OWNER_ONLY" } };
    const list = (args.p_methods as Array<{ kind: string; value: string; label: string | null; is_primary: boolean }>) ?? [];
    const bad = list.find((m) => m.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.value));
    if (bad) return { data: null, error: { message: `CONTACT_METHOD_INVALID_EMAIL: ${bad.value}` } };
    const pos: Record<string, number> = {};
    contactMethods[target] = list.map((m, i) => ({ id: `${target}-cm-${i}-${Date.now()}`, user_id: target, kind: m.kind, value: m.value, label: m.label, is_primary: m.is_primary, position: (pos[m.kind] = (pos[m.kind] ?? -1) + 1) }));
    return { data: contactMethods[target], error: null };
  }
  return { data: null, error: { message: `Unsupported harness RPC ${name}` } };
};
const invoke = async (_name: string, options: { body?: Record<string, unknown> }) => {
  const body = options.body || {};
  if (body.action === "create") invitesOf().unshift({ id: `invite-${invites.length}`, email: String(body.email), permission: String(body.permission), created_at: new Date().toISOString(), expires_at: at(7), revoked_at: null, uses: 0 });
  if (body.action === "revoke") { const row = invitesOf().find((i) => i.id === body.inviteId); if (row) row.revoked_at = new Date().toISOString(); }
  return { data: { ok: true, emailed: true }, error: null };
};
// Contact methods (Lane A). `?as=admin` signs the viewer in as an admin (user-7) instead of the
// owner (user-0), so the drive can show an admin opening the owner's row. Design fixtures.
const viewerPermission = () => (new URLSearchParams(window.location.search).get("as") === "admin" ? "admin" : "owner");
const viewerId = () => (viewerPermission() === "admin" ? "user-7" : "user-0");
type MethodRow = { id: string; user_id: string; kind: string; value: string; label: string | null; is_primary: boolean; position: number };
const contactMethods: Record<string, MethodRow[]> = {
  "user-0": [
    { id: "o-e1", user_id: "user-0", kind: "email", value: "antonio@northstar.example", label: "Work", is_primary: true, position: 0 },
    { id: "o-e2", user_id: "user-0", kind: "email", value: "owner@northstar.example", label: "Sign-in", is_primary: false, position: 1 },
    { id: "o-p1", user_id: "user-0", kind: "phone", value: "+1 (404) 555-0188", label: "Mobile", is_primary: true, position: 0 },
  ],
  "user-7": [
    { id: "a-e1", user_id: "user-7", kind: "email", value: "person7@northstar.example", label: "Work", is_primary: true, position: 0 },
  ],
};
const auth = { getUser: async () => ({ data: { user: { id: viewerId() } } }) };
const from = (table: string) => ({ select: () => ({ eq: async (_column: string, value: string) =>
  table === "user_contact_methods" ? { data: contactMethods[value] ?? [], error: null } : { data: null, error: { message: `Unsupported harness table ${table}` } } }) });
export const supabase = { rpc, functions: { invoke }, auth, from };
