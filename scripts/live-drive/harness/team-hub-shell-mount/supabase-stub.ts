/**
 * Data boundary for the Team Hub real-shell mount. MOCKS THE PROVIDER, NEVER THE CONTRACT: the shipped
 * SoloApp, TenantCommandCenterShell, SoloPaigeWorkspace, TeamHubWorkspace, TaskCard and TeamHubApproval are
 * all under measurement, and the Team Hub doors answer in the A1a/A2 shapes the shipped parsers accept (a
 * wrong shape shows as an error state, never as a pass). Ported from the A2a harness double
 * (docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2/harness/src/mock-supabase.ts), cut to one
 * #daily-management conversation and answered for whichever fictional workspace is active.
 *
 * Every other table read resolves to zero rows and every other RPC to null, so the rest of the shell renders
 * its real empty states. Nothing leaves the page. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE.
 *
 *   ?tr=read|failed|unreadable   the plan_items read behind the task card
 */
import { harnessActiveTenant } from "./tenant-context-stub";

type Row = Record<string, unknown>;
const params = new URLSearchParams(window.location.search);
const taskRead = params.get("tr") ?? "read";
const viewer = "u-me";
const TASK_ID = "e8000000-0000-4000-8000-0000000a0001";
const today = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission, team_conversations: true });
const people = [person("u-me", "Morgan Reyes", "Founder", "owner"), person("u-priya", "Priya Nair", "Operations lead", "admin"),
  person("u-jordan", "Jordan Lee", "Client onboarding")];
const conv = (o: Row) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, agent_key: null, unread: 0, last_message_at: today(9, 40), ...o });
const msg = (o: Row) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], work_ref: null, files: [], author_kind: "user", agent_key: null, asked_in_message_id: null, agent_mentions: [], ...o });
const TASK = "ZION wants to create a task in Operations: “Prepare the onboarding packet”, for Jordan Lee, due Fri, Oct 31.";

const conversations = [
  conv({ id: "c-general", name: "general", last_message_at: today(8, 30) }),
  conv({ id: "c-daily", name: "daily-management", last_message_at: today(10, 6) }),
  conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [viewer, "u-priya"], dm_user_id: "u-priya", last_message_at: today(8, 12) }),
];
const messages: Record<string, Row[]> = {
  "c-general": [msg({ id: "g1", author_user_id: "u-priya", body: "Morning all. Onboarding notes live in #daily-management from today.", created_at: today(8, 30) })],
  "c-daily": [
    msg({ id: "dm0", author_user_id: "u-priya", body: "Harper & Co. intake form came back this morning. Everything is filled in.", created_at: today(9, 41) }),
    msg({ id: "dm1", author_user_id: "u-me", body: "@ZION what's the next step for the Harper & Co. onboarding?", agent_mentions: ["zion"], created_at: today(9, 58) }),
    // An agent message carrying an approval. The Solo shell passes TeamHubWorkspace no onApprovalAct, so the
    // shipped card must refuse ("Approval not available here") and draw no Approve.
    msg({ id: "a-zion-dm1", author_user_id: "u-me", author_kind: "agent", agent_key: "zion", asked_in_message_id: "dm1",
      body: "Here it is as an Operations task. Nothing is created until Morgan approves it.", created_at: today(9, 59),
      approval: { state: "waiting", kind: "Operations task", asker_user_id: "u-me", decided_by_name: null, decided_at: null, actions: [{ summary: TASK, fingerprint: "fp-zion-task-1" }] } }),
    // A person's task message: the card whose "Open delivery work" link is under test.
    msg({ id: "dm4", author_user_id: "u-me", body: "/PAIGE draft a task", work_ref: { source: "planning", id: TASK_ID }, created_at: today(10, 6) }),
  ],
  "c-dm-priya": [msg({ id: "p1", author_user_id: "u-priya", body: "Can we move our 1:1 to 3pm?", created_at: today(8, 12) })],
};

function turnStates(p: Row) {
  const all = messages[String(p.p_channel_id)] ?? [];
  const states: Row[] = [];
  for (const id of (p.p_message_ids as string[]) ?? []) {
    const q = all.find((item) => item.id === id && item.author_kind !== "agent");
    if (!q) continue;
    for (const key of q.agent_mentions as string[]) {
      const answered = all.some((item) => item.author_kind === "agent" && item.agent_key === key && item.asked_in_message_id === id);
      states.push({ message_id: id, agent_key: key, state: answered ? "replied" : "none", private_part: false, asker_name: "Morgan Reyes" });
    }
  }
  return { ok: true, states };
}

const harness = { calls: [] as string[] };
(window as unknown as { __harnessCalls: typeof harness }).__harnessCalls = harness;

function teamHub(name: string, p: Row) {
  const tenant = harnessActiveTenant().id;
  if (p.p_expected_tenant !== tenant) return { ok: false, code: "scope_changed" };
  if (name === "team_hub_list_conversations") return { ok: true, tenant_id: tenant, me: { user_id: viewer }, people, conversations };
  if (name === "team_hub_mark_read") return { ok: true };
  if (name === "team_hub_list_messages") {
    const c = conversations.find((item) => item.id === p.p_channel_id);
    if (!c) return { ok: false, code: "not_found" };
    if (p.p_thread_root) return { ok: false, code: "not_found" };
    return { ok: true, channel: { id: c.id, kind: c.kind, name: c.name, visibility: c.visibility, joined: c.joined }, messages: [...(messages[String(c.id)] ?? [])].reverse(), has_more: false };
  }
  if (name === "team_hub_list_work") return { ok: true, items: [] };
  if (name === "team_hub_agent_turn_states") return turnStates(p);
  // Writes are refused: this harness proves geometry and navigation, not a post.
  return { ok: false, code: "invalid" };
}

const planItems = () => taskRead === "failed" ? { data: null, error: { message: "harness: the read failed" } }
  : taskRead === "unreadable" ? { data: [], error: null }
  : { data: [{ id: TASK_ID, title: "Prepare the onboarding packet", status: "open", assigned_to_user_id: "u-jordan", due_at: "2026-10-31T17:00:00.000Z", updated_at: today(10, 6) }], error: null };

function chain(table: string) {
  const settle = () => table === "plan_items" ? planItems() : { data: [], error: null, count: 0 };
  const one = () => { const r = settle(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; };
  const self: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(settle()).catch(rej),
    maybeSingle: () => Promise.resolve(one()),
    single: () => Promise.resolve(one()),
  };
  // Every other builder link (select, eq, in, order, limit, gte, or, ...) narrows nothing here and returns the chain.
  const proxy: Record<string, unknown> = new Proxy(self, { get: (target, key: string) => key in target ? target[key] : () => proxy });
  self.abortSignal = () => proxy;
  return proxy;
}

export const supabase = {
  from: (table: string) => { harness.calls.push(`from:${table}`); return chain(table); },
  rpc: (name: string, args: Row = {}) => {
    harness.calls.push(`rpc:${name}`);
    if (name.startsWith("team_hub_")) return Promise.resolve({ data: teamHub(name, args), error: null });
    if (name === "current_user_tenant_id") return Promise.resolve({ data: harnessActiveTenant().id, error: null });
    if (name === "has_tenant_role") return Promise.resolve({ data: args._role === "owner" || args.role === "owner", error: null });
    return Promise.resolve({ data: null, error: null });
  },
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: viewer } }, error: null }),
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  channel: () => {
    const ch: Record<string, unknown> = {};
    ch.on = () => ch;
    ch.subscribe = (cb?: (status: string) => void) => { cb?.("SUBSCRIBED"); return ch; };
    ch.unsubscribe = () => Promise.resolve("ok");
    ch.send = () => Promise.resolve("ok");
    return ch;
  },
  removeChannel: () => Promise.resolve("ok"),
  getChannels: () => [],
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no files in this harness" } }), upload: async () => ({ data: null, error: { message: "no files in this harness" } }) }) },
  functions: { invoke: async () => ({ data: null, error: { message: "Harness: nothing leaves this page" } }) },
};
export default { supabase };
