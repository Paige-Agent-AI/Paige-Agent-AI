// Harness-only in-memory double shaped like the EXP08 increment-1 contract (amended A1–A7).
// It is NOT the database; it lets the real workspace render each documented answer.
const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "populated";
const ME = "u-me";
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission });
const people = [person(ME, "Morgan Hale", "Founder", "owner"), person("u-dana", "Dana Reyes", "Client lead", "admin"),
  person("u-sam-d", "Sam Lee", "Designer"), person("u-sam-s", "Sam Lee", "Sales"), person("u-priya", "Priya Natarajan", "Operations"),
  person("u-leo", "Leo Martins", null)];
const conv = (o: Record<string, unknown>) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: ago(3), ...o });
const msg = (o: Record<string, unknown>) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], ...o });

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
    ],
    "c-onboard": [
      msg({ id: "o1", author_user_id: "u-dana", body: "Welcome packet for the Brightline account is drafted. Priya, can you check the intake questions?", created_at: ago(60 * 27) }),
      msg({ id: "o2", author_user_id: "u-priya", body: "Checked. I added two questions about their reporting cadence.", created_at: ago(60 * 26) }),
      msg({ id: "o3", author_user_id: ME, body: "Thanks both. I'll send it Monday morning.", created_at: ago(60 * 25) }),
      msg({ id: "o4", author_user_id: "u-dana", body: "Their ops lead asked to move the kickoff call to 2pm. I said yes pending your OK.", created_at: ago(35) }),
      msg({ id: "o5", author_user_id: "u-leo", body: "Booked the 2pm slot and sent the updated invite.", created_at: ago(12) }),
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
  return { ok: false, code: "invalid" };
}

export const supabase = {
  rpc: async (name: string, p: Record<string, unknown>) => {
    if (scenario === "failed" && name === "team_hub_post_message") return { data: null, error: { message: "harness: network down" } };
    return { data: backend(name, p), error: null };
  },
};
