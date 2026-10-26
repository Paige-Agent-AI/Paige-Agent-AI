// Harness double: fictional Northstar Studio (no real account data). Shapes follow
// supabase/migrations/20271115040008_exp08_team_lifecycle.sql. Writes are local and deterministic.
const q = new URLSearchParams(location.search);
const viewer = q.get("viewer") ?? "owner";
const T = "t-northstar";
const m = (user_id: string, full_name: string, email: string, permission: string, job_title: string, responsibilities: string, extra: Record<string, unknown> = {}) =>
  ({ membership_id: `m-${user_id}`, user_id, full_name, email, avatar_url: null, status: "active", permission, is_owner: permission === "owner", job_title, responsibilities, last_sign_in_at: "2026-10-26T09:00:00Z", ...extra });
let members = [
  m("u-morgan", "Morgan Hale", "morgan@northstar.example", "owner", "Founder", "Sets direction and approves what goes to clients."),
  m("u-dana", "Dana Reyes", "dana@northstar.example", "admin", "Operations Lead", "Runs onboarding and weekly delivery."),
  m("u-avery", "Avery Cole", "avery@northstar.example", "admin", "Client Success Manager", "Owns renewals and client check-ins.", { last_sign_in_at: "2026-10-25T09:00:00Z" }),
  m("u-sam", "Sam Lee", "sam@northstar.example", "member", "Designer", "Brand and launch assets for client kickoffs."),
  m("u-priya", "Priya Natarajan", "priya@northstar.example", "member", "Scheduling Coordinator", "Books client sessions and keeps calendars clean.", { last_sign_in_at: "2026-10-23T09:00:00Z" }),
  m("u-theo", "Theo Brandt", "theo@brandtcopy.example", "member", "Contract Copywriter", "Spot jobs: launch copy when booked.", { last_sign_in_at: "2026-10-19T09:00:00Z" }),
  m("u-lena", "Lena Ortiz", "lena@northstar.example", "member", "Research Assistant", "Market scans before client strategy sessions.", { status: "suspended" }),
];
if (q.get("s") === "firstuse") members = members.slice(0, 1);
const access: Record<string, boolean> = { "u-morgan": true, "u-dana": true, "u-avery": true, "u-sam": true, "u-priya": true, "u-theo": false, "u-lena": true };
const invitations = q.get("s") === "firstuse" ? [] : [{ id: "inv-1", email: "jules.park@northstar.example", permission: "member", created_at: "2026-10-24T12:00:00Z", expires_at: "2099-11-02T12:00:00Z", revoked_at: null, uses: 0, delivery: { status: "delivered", at: "2026-10-24T12:01:00Z", error: null, history: [{ status: "sent", at: "2026-10-24T12:00:30Z" }, { status: "delivered", at: "2026-10-24T12:01:00Z" }] } }];
const sam = {
  work: [{ id: "w1", title: "Kickoff cover options", status: "in_progress", due_at: "2026-10-28T17:00:00Z", updated_at: "2026-10-26T10:00:00Z", client_label: "Brightline Co." },
         { id: "w2", title: "Q4 kickoff deck review", status: "open", due_at: "2026-10-30T17:00:00Z", updated_at: "2026-10-26T10:00:00Z", client_label: null }],
  crm_tasks: [{ id: "t1", title: "Send the welcome packet", status: "pending", due_date: "2026-10-29", updated_at: "2026-10-26T10:00:00Z", client_label: "Brightline Co." }],
  clients: [{ id: "k1", label: "Brightline Co.", relation: "lead_owner", updated_at: "2026-10-25T10:00:00Z" }, { id: "k2", label: "Harbor & Pine", relation: "assigned", updated_at: "2026-10-25T10:00:00Z" }],
  deals: [{ id: "d1", title: "Harbor & Pine Q1 retainer", status: "open", value_cents: 480000, currency: "USD", expected_close_date: "2026-12-15", version: 4, client_label: "Harbor & Pine" }],
  approvals: [{ id: "a1", kind: "email", summary: "Follow-up email to Brightline Co. confirming the kickoff date and the deck review", status: "pending", created_at: "2026-10-25T10:00:00Z" }],
  mailboxes: [{ id: "mb1", channel: "email", provider: "google", mailbox_class: "personal", label: "Sam Lee", address: "sam@northstar.example" }],
};
const empty = { work: [], crm_tasks: [], clients: [], deals: [], approvals: [], mailboxes: [] };
const delay = (v: unknown, ms = 120) => new Promise((r) => setTimeout(() => r(v), ms));
function rpc(name: string, args: Record<string, unknown>) {
  if (q.get("s") === "loading" && name === "get_solo_team_workspace") return new Promise(() => {});
  if (q.get("s") === "error" && name === "get_solo_team_workspace") return delay({ data: null, error: { message: "TypeError: Failed to fetch" } });
  switch (name) {
    case "get_solo_team_workspace":
      return delay({ data: { tenant_id: T, tenant_name: "Northstar Studio", viewer_permission: viewer === "admin" ? "admin" : "owner", can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: viewer !== "admin", total_members: members.length, members, invitations }, error: null });
    case "team_hub_list_conversations":
      if (q.get("s") === "hub-off") return delay({ data: { ok: false, code: "conversations_off" }, error: null });
      return delay({ data: { ok: true, tenant_id: T, me: { user_id: "u-morgan" }, people: members.filter((x) => x.status === "active").map((x) => ({ user_id: x.user_id, display_name: x.full_name, title: x.job_title, permission: x.permission, team_conversations: access[x.user_id] })), conversations: [] }, error: null });
    case "team_member_holdings": {
      const id = args._member_user_id as string;
      if (q.get("review") === "loading") return new Promise(() => {});
      const lists = id === "u-sam" ? sam : empty;
      return delay({ data: { ok: true, member: { user_id: id, display_name: "x", role: "member", status: members.find((x) => x.user_id === id)?.status, team_hub_access: access[id] }, holdings: lists, counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, (v as unknown[]).length])) }, error: null }, 300);
    }
    case "set_solo_team_member_team_hub_access":
      access[args._member_user_id as string] = args._on as boolean;
      return delay({ data: { tenant_id: T, membership_id: "x", user_id: args._member_user_id, team_hub_access: args._on, changed: true, joined_channels: 3 }, error: null }, 500);
    case "suspend_solo_team_member": case "reinstate_solo_team_member": {
      const st = name.startsWith("suspend") ? "suspended" : "active";
      members = members.map((x) => (x.user_id === args._member_user_id ? { ...x, status: st } : x));
      return delay({ data: { tenant_id: T, membership_id: "x", user_id: args._member_user_id, status: st }, error: null }, 500);
    }
    case "plan_update_item_versioned":
      return delay({ data: { ok: true, item_id: args.p_item_id, tenant_id: T, actor_id: "u-morgan" }, error: null }, 600);
    default:
      return delay({ data: null, error: { message: `harness: ${name}` } });
  }
}
export const supabase = {
  rpc,
  auth: { getUser: async () => ({ data: { user: { id: "u-morgan" } } }), getSession: async () => ({ data: { session: { user: { id: "u-morgan" } } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }), then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) }), in: async () => ({ data: [], error: null }) }) }),
  functions: { invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    if (_fn === "crm-command") return body.approved_fingerprint ? { data: { ok: true, readback: { id: (body.command as Record<string, unknown>).contact_id ?? (body.command as Record<string, unknown>).deal_id ?? (body.command as Record<string, unknown>).task_id } }, error: null } : { data: { outcome: "approval_required", fingerprint: "0123456789abcdef", summary: "x" }, error: null };
    return { data: { ok: true, emailed: true, tenantId: T }, error: null };
  } },
  storage: { from: () => ({}) },
};
