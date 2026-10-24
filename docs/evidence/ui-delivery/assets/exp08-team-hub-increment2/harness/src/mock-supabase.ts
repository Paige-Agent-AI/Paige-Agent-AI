// Harness-only in-memory double shaped like the EXP08 increment-1 contract (amended A1–A7) plus the
// increment-2 work contract (team_hub_request_task, team_hub_list_work, work_ref on messages, and the
// caller-RLS read of plan_items by id). It is NOT the database and NOT Operations; it lets the real
// workspace render each documented answer. `t-hidden` is a link whose plan_items row the caller's
// RLS does not return, so its card and panel row render the "unreadable" state.
const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "populated";
const ME = "u-me";
const meRole = params.get("me") ?? "owner";
const noWork = scenario === "nowork" || scenario === "firstuse";
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission });
const people = [person(ME, "Morgan Hale", "Founder", meRole), person("u-dana", "Dana Reyes", "Client lead", "admin"),
  person("u-sam-d", "Sam Lee", "Designer"), person("u-sam-s", "Sam Lee", "Sales"), person("u-priya", "Priya Natarajan", "Operations"),
  person("u-leo", "Leo Martins", null)];
const conv = (o: Record<string, unknown>) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: ago(3), ...o });
const msg = (o: Record<string, unknown>) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], work_ref: null, ...o });
const TASK = "/PAIGE draft a task";
const T1 = "7f3c2a91-5b0e-4c1d-9a2f-1e6b8d4c0a11"; const T2 = "c41d9e07-2a6f-4b83-8e15-93a0f5b7d222"; const T3 = "0b8e5f34-d917-4a2c-b6e0-5c3f7a9e1333";
const HIDDEN = "e9a04c2d-7f18-4b6e-a3d5-2c8f1b0e9444";

const db = {
  people: scenario === "firstuse" ? [people[0], people[1]] : people,
  conversations: scenario === "firstuse" ? [] : [
    conv({ id: "c-general", name: "general" }),
    conv({ id: "c-onboard", name: "client-onboarding", unread: 2 }),
    conv({ id: "c-design", name: "design-reviews", joined: false }),
    conv({ id: "c-lead", name: "leadership", visibility: "private", member_count: 3, member_ids: [ME, "u-dana", "u-priya"] }),
    conv({ id: "c-dm-dana", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-dana"], dm_user_id: "u-dana", unread: 1 }),
    conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-priya"], dm_user_id: "u-priya" }),
  ],
  messages: {
    "c-general": [
      msg({ id: "m1", author_user_id: "u-priya", body: "Morning all. The Q4 kickoff deck is in the shared drive; I moved the agenda to Thursday at 10.", created_at: ago(60 * 26) }),
      msg({ id: "m2", author_user_id: "u-dana", body: "Thanks Priya. @Sam Lee (Designer) can you take a pass on the cover slide before then?", mentions: ["u-sam-d"], created_at: ago(60 * 25), reply_count: 3, last_reply_at: ago(60 * 24) }),
      msg({ id: "m3", author_user_id: "u-sam-d", body: "On it. I'll post two options by end of day.", created_at: ago(42) }),
      msg({ id: "m4", author_user_id: ME, body: "Great. Let's keep decisions for the kickoff in this channel so everyone can find them.", created_at: ago(30) }),
      msg({ id: "m5", author_user_id: "u-leo", body: "Calendar invite is out for Thursday. Reply here if the time doesn't work.", created_at: ago(8) }),
      ...(noWork ? [] : [
        msg({ id: "m6", author_user_id: "u-dana", body: TASK, work_ref: { source: "planning", id: HIDDEN }, created_at: ago(6) }),
        msg({ id: "m7", author_user_id: ME, body: TASK, work_ref: { source: "planning", id: T1 }, created_at: ago(4) }),
      ]),
    ],
    "c-onboard": [
      msg({ id: "o1", author_user_id: "u-dana", body: "Welcome packet for the Brightline account is drafted. Priya, can you check the intake questions?", created_at: ago(60 * 27) }),
      msg({ id: "o2", author_user_id: "u-priya", body: "Checked. I added two questions about their reporting cadence.", created_at: ago(60 * 26) }),
      msg({ id: "o3", author_user_id: ME, body: "Thanks both. I'll send it Monday morning.", created_at: ago(60 * 25) }),
      msg({ id: "o4", author_user_id: "u-dana", body: "Their ops lead asked to move the kickoff call to 2pm. I said yes pending your OK.", created_at: ago(35) }),
      msg({ id: "o5", author_user_id: "u-leo", body: "Booked the 2pm slot and sent the updated invite.", created_at: ago(12) }),
      ...(noWork ? [] : [
        msg({ id: "o6", author_user_id: "u-dana", body: TASK, work_ref: { source: "planning", id: T2 }, created_at: ago(60 * 3) }),
        msg({ id: "o7", author_user_id: "u-priya", body: TASK, work_ref: { source: "planning", id: T3 }, created_at: ago(60 * 2) }),
      ]),
    ],
  } as Record<string, ReturnType<typeof msg>[]>,
  replies: {
    m2: [
      msg({ id: "r1", author_user_id: "u-sam-d", parent_message_id: "m2", body: "Yes, I'll have it by Wednesday noon.", created_at: ago(60 * 24 + 40) }),
      msg({ id: "r2", author_user_id: "u-dana", parent_message_id: "m2", body: "Perfect. Keep the client logo off the cover for now.", created_at: ago(60 * 24 + 20) }),
      msg({ id: "r3", author_user_id: "u-priya", parent_message_id: "m2", body: "Agreed. I'll add the final version to the deck.", created_at: ago(60 * 24) }),
    ],
  } as Record<string, ReturnType<typeof msg>[]>,
};

// What Operations holds, as the caller's RLS returns it. HIDDEN is deliberately absent.
const dueIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(23, 59, 0, 0); return d.toISOString(); };
const planItems: Record<string, Record<string, unknown>> = {
  [T1]: { id: T1, title: "Send the Brightline welcome packet", status: "in_progress", assigned_to_user_id: ME, due_at: dueIn(3), updated_at: ago(2) },
  [T2]: { id: T2, title: "Confirm Brightline kickoff agenda with their ops lead", status: "open", assigned_to_user_id: "u-priya", due_at: dueIn(1), updated_at: ago(60 * 3) },
  [T3]: { id: T3, title: "Add reporting-cadence questions to the intake form", status: "done", assigned_to_user_id: "u-priya", due_at: null, updated_at: ago(50) },
};
const workRefs = noWork ? [] : [
  { message_id: "m7", channel_id: "c-general", parent_message_id: null, source: "planning", work_id: T1, created_by: ME, created_at: ago(4) },
  { message_id: "m6", channel_id: "c-general", parent_message_id: null, source: "planning", work_id: HIDDEN, created_by: "u-dana", created_at: ago(6) },
  { message_id: "o7", channel_id: "c-onboard", parent_message_id: null, source: "planning", work_id: T3, created_by: "u-priya", created_at: ago(60 * 2) },
  { message_id: "o6", channel_id: "c-onboard", parent_message_id: null, source: "planning", work_id: T2, created_by: "u-dana", created_at: ago(60 * 3) },
];

let seq = 0;
function backend(name: string, p: Record<string, unknown>) {
  if (scenario === "unavailable") return { ok: false, code: "unavailable" };
  if (name === "team_hub_list_conversations") return { ok: true, tenant_id: "t-harness", me: { user_id: ME }, people: db.people, conversations: db.conversations };
  if (name === "team_hub_mark_read") { ((window as unknown as { __thMarks?: unknown[] }).__thMarks ??= []).push(p.p_through_message_id); return { ok: true }; }
  if (name === "team_hub_list_messages") {
    const c = db.conversations.find((item) => item.id === p.p_channel_id);
    if (!c) return { ok: false, code: "not_found" };
    const channel = { id: c.id, kind: c.kind, name: c.name, visibility: c.visibility, joined: c.joined };
    const newest = (rows: ReturnType<typeof msg>[]) => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (p.p_thread_root) {
      const root = (db.messages[c.id as string] ?? []).find((item) => item.id === p.p_thread_root);
      return root ? { ok: true, channel, root, messages: newest(db.replies[root.id as string] ?? []), has_more: false } : { ok: false, code: "not_found" };
    }
    return { ok: true, channel, messages: newest(db.messages[c.id as string] ?? []), has_more: c.id === "c-general" };
  }
  if (name === "team_hub_post_message") {
    seq += 1;
    return { ok: true, message: msg({ id: `p${seq}`, author_user_id: ME, body: String(p.p_body), created_at: new Date().toISOString(), mentions: p.p_mention_ids ?? [] }) };
  }
  if (name === "team_hub_list_work") return { ok: true, items: workRefs };
  if (name === "team_hub_request_task") {
    seq += 1;
    const id = `5a${String(seq).padStart(6, "0")}-0000-4000-8000-00000000${String(seq).padStart(4, "0")}`;
    planItems[id] = { id, title: String(p.p_title), status: "open", assigned_to_user_id: p.p_assignee ?? ME, due_at: p.p_due_at ?? null, updated_at: new Date().toISOString() };
    const message = msg({ id: `pt${seq}`, author_user_id: ME, body: TASK, work_ref: { source: "planning", id }, created_at: new Date().toISOString() });
    workRefs.unshift({ message_id: message.id as string, channel_id: String(p.p_channel_id), parent_message_id: null, source: "planning", work_id: id, created_by: ME, created_at: message.created_at as string });
    return { ok: true, message, duplicate: false };
  }
  return { ok: false, code: "invalid" };
}

// supabase.from("plan_items").select(cols).eq("tenant_id", t).in("id", ids): the caller-RLS read.
function planItemsQuery() {
  const filters: { tenant?: unknown } = {};
  const builder = {
    select: (_cols: string) => builder,
    eq: (column: string, value: unknown) => { if (column === "tenant_id") filters.tenant = value; return builder; },
    in: async (_column: string, ids: string[]) => {
      ((window as unknown as { __thReads?: unknown[] }).__thReads ??= []).push(ids);
      if (scenario === "readfail") return { data: null, error: { message: "harness: read failed" } };
      if (filters.tenant !== "t-harness") return { data: [], error: null };
      return { data: ids.map((id) => planItems[id]).filter(Boolean), error: null };
    },
  };
  return builder;
}

export const supabase = {
  from: (table: string) => {
    if (table !== "plan_items") throw new Error(`harness: unexpected table ${table}`);
    return planItemsQuery();
  },
  rpc: async (name: string, p: Record<string, unknown>) => {
    if (scenario === "failed" && name === "team_hub_post_message") return { data: null, error: { message: "harness: network down" } };
    return { data: backend(name, p), error: null };
  },
};
