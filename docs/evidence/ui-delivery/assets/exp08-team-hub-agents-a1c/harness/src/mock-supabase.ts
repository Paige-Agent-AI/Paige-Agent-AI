// Harness-only in-memory double for EXP08 Team Hub agents A1c (copied from the A1b harness; A1c changes:
// the turn-state read returns a reply being written to everyone who can see the conversation, the post
// door takes p_broadcast_mention and the message carries `broadcast`, and two scenarios: `writing`,
// another member's question MERIT is answering, and `chips`, a sent message with a person, an agent and
// @channel).
// Originally: the in-memory double for EXP08 Team Hub agents A1b. It answers the Team Hub doors in the
// A1a shapes (team_hub_list_conversations with agent DMs and agent_key, team_hub_list_messages with
// author_kind / agent_key / asked_in_message_id / agent_mentions, team_hub_post_message with
// p_agent_mention_keys, team_hub_open_agent_dm) and functions.invoke("paige-ai-chat") in the A1b
// HANDOFF's request and response shapes. It is NOT the database and NOT a model turn: every agent
// reply here is written in the approved personalities' voice by hand, and every name, figure and
// business is fictional (the approved prototype v3 sample cast).
const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "populated";
// Who is viewing: Morgan (owner) by default; `as=priya` views as the admin who asked PAIGE.
const viewer = params.get("as") === "priya" ? "u-priya" : "u-me";
const TENANT = "t-harness";
const today = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission, team_conversations: true });
const people = [person("u-me", "Morgan Reyes", "Founder", "owner"), person("u-priya", "Priya Nair", "Operations lead", "admin"),
  person("u-marcus", "Marcus Hale", "Client delivery"), person("u-sam", "Sam Lee", "Brand design")];
type Row = Record<string, unknown>;
const conv = (o: Row) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, agent_key: null, unread: 0, last_message_at: today(9, 40), ...o });
const agentDm = (agent: string, o: Row = {}) => conv({ id: `c-dm-${agent}`, kind: "agent_dm", name: null, visibility: "private", agent_key: agent, member_count: 1, member_ids: [viewer], ...o });
const msg = (o: Row) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], work_ref: null, files: [], author_kind: "user", agent_key: null, asked_in_message_id: null, agent_mentions: [], ...o });
const agentMsg = (agent: string, askedIn: string | null, asker: string, body: string, o: Row = {}) =>
  msg({ id: `a-${agent}-${askedIn ?? "dm"}`, author_user_id: asker, author_kind: "agent", agent_key: agent, asked_in_message_id: askedIn, body, ...o });
const FIXED = "That part is just for you, so I'm answering it in our DM.";

const firstUse = scenario === "firstuse";
const db = {
  people: firstUse ? [people[0]] : people,
  conversations: firstUse ? [] as Row[] : [
    conv({ id: "c-general", name: "general", last_message_at: today(8, 30) }),
    conv({ id: "c-launch", name: "launch" }),
    conv({ id: "c-delivery", name: "client-delivery", last_message_at: today(9, 10) }),
    conv({ id: "c-lead", name: "leadership", visibility: "private", member_count: 2, member_ids: ["u-me", "u-priya"], unread: 1 }),
    conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [viewer, "u-priya"], dm_user_id: "u-priya", last_message_at: today(8, 12) }),
    conv({ id: "c-dm-marcus", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [viewer, "u-marcus"], dm_user_id: "u-marcus", last_message_at: today(8, 5) }),
    ...(scenario === "agentdm" ? [agentDm("vera", { unread: 0 })] : [agentDm("vera", { unread: 1 })]),
  ],
  messages: {
    "c-general": [msg({ id: "g1", author_user_id: "u-priya", body: "Morning all. Workshop planning lives in #launch from today.", created_at: today(8, 30) })],
    "c-launch": [
      msg({ id: "l1", author_user_id: "u-priya", body: "@PAIGE who's doing what for launch?", agent_mentions: ["paige"], created_at: today(9, 4) }),
      agentMsg("paige", "l1", "u-priya", "Okay, two and a half weeks. Tight, but doable. @CURA already has the welcome emails. I'd put @NEXUS on the announcement and @ZION on the task plan. Want me to bring them in?", { created_at: today(9, 5) }),
      msg({ id: "l3", author_user_id: "u-marcus", body: "@NEXUS we need a hook for the workshop. The audience is agency owners.", agent_mentions: ["nexus"], created_at: today(9, 12) }),
      agentMsg("nexus", "l3", "u-marcus", "Ooh, agency owners. They're drowning in client chaos. Two hooks: “Run your agency, not your inbox” or “Your best people shouldn't be doing status updates.” I'd lead with the second. It names a pain they feel every week. Want a draft announcement?", { created_at: today(9, 13) }),
      msg({ id: "l5", author_user_id: "u-sam", body: "Love the second one. I'll mock up a banner.", created_at: today(9, 20) }),
      ...(scenario === "returning" ? [msg({ id: "l6", author_user_id: "u-me", body: "@MENTOR should the workshop be free or paid?", agent_mentions: ["mentor"], created_at: today(9, 31) })] : []),
      // Another member's private question: what Morgan (not the asker) sees while it runs and once it's done.
      ...(scenario === "others" ? [msg({ id: "l7", author_user_id: "u-sam", body: "@MERIT what did Harper & Co. pay us last quarter?", agent_mentions: ["merit"], created_at: today(9, 33) }),
        agentMsg("merit", "l7", "u-sam", FIXED, { created_at: today(9, 34) })] : []),
      // A1c: Priya asked MERIT, and MERIT is still writing: Morgan (not the asker) sees "MERIT is writing…".
      ...(scenario === "writing" ? [msg({ id: "l8", author_user_id: "u-priya", body: "@MERIT what should we charge for the workshop seats?", agent_mentions: ["merit"], created_at: today(9, 36) })] : []),
      // A1c: a sent message with a person chip, an agent chip and the @channel chip the server stored.
      ...(scenario === "chips" ? [msg({ id: "l9", author_user_id: "u-priya", body: "@channel the workshop moves to Nov 14. @Sam Lee owns the banner; @ZION can turn the run sheet into tasks.",
        mentions: ["u-sam"], agent_mentions: ["zion"], broadcast: "channel", created_at: today(9, 38) }),
        agentMsg("zion", "l9", "u-priya", "Done. Run sheet split into four tasks: venue walkthrough (Marcus, Oct 30), run sheet (Priya, Nov 7), slides (Sam, Nov 10), banner (Sam, Nov 12).", { created_at: today(9, 39) })] : []),
    ],
    "c-delivery": [
      msg({ id: "d1", author_user_id: "u-marcus", body: "Kickoff agenda for the Harper & Co. onboarding. Comments in the thread please.", created_at: today(9, 2), reply_count: 2, last_reply_at: today(9, 9) }),
      msg({ id: "d2", author_user_id: "u-priya", body: "Thanks Marcus. I'll check the intake questions before Thursday.", created_at: today(9, 10) }),
    ],
    "c-lead": [msg({ id: "x1", author_user_id: "u-priya", body: "Draft hiring plan is in Operations for Q1.", created_at: today(9, 40) })],
    "c-dm-priya": [msg({ id: "p1", author_user_id: "u-priya", body: "Can we move our 1:1 to 3pm?", created_at: today(8, 12) })],
    "c-dm-marcus": [msg({ id: "k1", author_user_id: "u-marcus", body: "Harper & Co. signed. Kickoff on the 29th.", created_at: today(8, 5) })],
    "c-dm-vera": scenario === "agentdm" ? [
      msg({ id: "v1", author_user_id: viewer, body: "How did last year's workshop do for us?", created_at: today(9, 31) }),
      agentMsg("vera", "v1", viewer, "Here's the picture for last year's workshop: 31 registered, 24 attended, and 6 became clients within 90 days. That's from Sales, deals tagged “Workshop 2025”, read at 9:31.\n\nNot included: anyone who bought after 90 days, and your own time. If this year converts at the same rate, 40 seats would mean about 10 new clients. That's a projection, not a promise.", { created_at: today(9, 32) }),
    ] : [],
  } as Record<string, Row[]>,
  replies: {
    d1: [
      msg({ id: "dr1", author_user_id: "u-sam", parent_message_id: "d1", body: "I'll bring the brand board.", created_at: today(9, 6) }),
      msg({ id: "dr2", author_user_id: "u-priya", parent_message_id: "d1", body: "Added. Thanks both.", created_at: today(9, 9) }),
    ],
  } as Record<string, Row[]>,
};

// The member-safe turn-state read (team_hub_agent_turn_states), as its proof pins it: the asker reads
// every state of their own question; anyone else reads only the two private-part lines and who a reply
// suggested bringing in, without the line. Facts: PAIGE's reply to Priya suggested NEXUS and ZION (as
// in the prototype); `rs` sets the returning question's state, `ps` the other member's private part.
const facts: Record<string, Row> = {
  "l1:paige": { state: "replied", asker_name: "Priya Nair", bring_in: [{ agent: "nexus", context: "PAIGE suggested you take the workshop announcement." },
    { agent: "zion", context: "PAIGE suggested you take the launch task plan." }] },
  "l6:mentor": { state: params.get("rs") ?? "failed", asker_name: "Morgan Reyes" },
  "l7:merit": { state: params.get("ps") ?? "answering", private_part: true, asker_name: "Sam Lee" },
  "l8:merit": { state: "answering", asker_name: "Priya Nair" },
};
function turnStates(p: Row) {
  const c = db.conversations.find((item) => item.id === p.p_channel_id);
  if (!c) return { ok: false, code: "not_found" };
  if (params.get("states") === "down") return { ok: false, code: "invalid" };
  const all = [...(db.messages[String(c.id)] ?? []), ...Object.values(db.replies).flat()];
  const states: Row[] = [];
  for (const id of p.p_message_ids as string[]) {
    const q = all.find((item) => item.id === id && item.author_kind !== "agent");
    if (!q) continue;
    for (const key of c.kind === "agent_dm" ? [String(c.agent_key)] : (q.agent_mentions as string[])) {
      const answered = all.some((item) => item.author_kind === "agent" && item.agent_key === key && item.asked_in_message_id === id);
      const fact = { state: answered ? "replied" : "none", private_part: false, asker_name: "Teammate", ...facts[`${id}:${key}`] } as Row;
      const mine = q.author_user_id === viewer;
      const bring = Array.isArray(fact.bring_in) ? (mine ? fact.bring_in : (fact.bring_in as Row[]).map((item) => ({ agent: item.agent }))) : undefined;
      // A1c: a reply being written is returned to everyone who can see the conversation (state only).
      const approved = (fact.private_part === true && (fact.state === "answering" || fact.state === "replied_privately"))
        || (fact.private_part !== true && fact.state === "answering");
      if (!mine && !approved && !bring) continue;
      states.push({ message_id: id, agent_key: key, state: mine || approved ? fact.state : "replied", private_part: fact.private_part, asker_name: fact.asker_name, ...(bring ? { bring_in: bring } : {}) });
    }
  }
  return { ok: true, states };
}

let seq = 0;
const clock = { h: 10, m: 40 };
const nextAt = () => { clock.m += 1; if (clock.m > 59) { clock.m = 0; clock.h += 1; } return today(clock.h, clock.m); };
const log = (entry: unknown) => { ((window as unknown as { __thTurns?: unknown[] }).__thTurns ??= []).push(entry); };

function backend(name: string, p: Row) {
  if (name === "team_hub_list_conversations") return { ok: true, tenant_id: TENANT, me: { user_id: viewer }, people: db.people, conversations: db.conversations };
  if (name === "team_hub_mark_read") { const c = db.conversations.find((item) => item.id === p.p_channel_id); if (c) c.unread = 0; return { ok: true }; }
  if (name === "team_hub_list_messages") {
    const c = db.conversations.find((item) => item.id === p.p_channel_id);
    if (!c) return { ok: false, code: "not_found" };
    const summary = { id: c.id, kind: c.kind, name: c.name, visibility: c.visibility, joined: c.joined };
    if (p.p_thread_root) {
      const root = (db.messages[String(c.id)] ?? []).find((item) => item.id === p.p_thread_root);
      return root ? { ok: true, channel: summary, root, messages: [...(db.replies[String(root.id)] ?? [])].reverse(), has_more: false } : { ok: false, code: "not_found" };
    }
    return { ok: true, channel: summary, messages: [...(db.messages[String(c.id)] ?? [])].reverse(), has_more: false };
  }
  if (name === "team_hub_post_message") {
    const message = msg({ id: `s-${++seq}`, author_user_id: viewer, body: String(p.p_body).trim(), mentions: p.p_mention_ids ?? [],
      parent_message_id: p.p_parent_message_id ?? null, agent_mentions: p.p_agent_mention_keys ?? [], created_at: nextAt(),
      ...(p.p_broadcast_mention ? { broadcast: p.p_broadcast_mention } : {}) });
    log({ post: { body: message.body, broadcast: p.p_broadcast_mention ?? null, agents: p.p_agent_mention_keys ?? [] } });
    if (message.parent_message_id) {
      (db.replies[String(message.parent_message_id)] ??= []).push(message);
      const root = (db.messages[String(p.p_channel_id)] ?? []).find((item) => item.id === message.parent_message_id);
      if (root) { root.reply_count = Number(root.reply_count) + 1; root.last_reply_at = message.created_at; }
    } else (db.messages[String(p.p_channel_id)] ??= []).push(message);
    return { ok: true, duplicate: false, message };
  }
  if (name === "team_hub_open_agent_dm") {
    const key = String(p.p_agent_key);
    if (!db.conversations.some((item) => item.id === `c-dm-${key}`)) db.conversations.push(agentDm(key, { last_message_at: null }));
    db.messages[`c-dm-${key}`] ??= [];
    return { ok: true, channel_id: `c-dm-${key}` };
  }
  if (name === "team_hub_list_work") return { ok: true, items: [] };
  if (name === "team_hub_agent_turn_states") return turnStates(p);
  return { ok: false, code: "invalid" };
}

// The agent turn. `window.__thTurn` picks what the double answers: "reply" (default), "never" (the
// asker sees the writing row), "no_reply", "private" (a public part, then the DM turn), "private-hold"
// (the DM turn never answers) and "private-fail".
const REPLIES: Record<string, string> = {
  cura: "A good first week is short and personal: a welcome note on day one, one small win by day three, and a check-in call on day five. Want me to draft the welcome note?",
  mentor: "One thing first: free gets you a crowd, paid gets you commitment. Which do you want more of from this one?",
  zion: "Three things. Venue walkthrough, Marcus, by Oct 30. Run sheet, Priya, by Nov 7. Slides, Sam, by Nov 10.",
};
const never = <T,>() => new Promise<T>(() => undefined);
async function agentTurn(body: Row) {
  const t = body.teamHubAgentTurn as Row;
  log(t);
  const mode = (window as unknown as { __thTurn?: string }).__thTurn ?? "reply";
  const agent = String(t.agent);
  const source = String(t.sourceMessageId);
  const conversation = String(t.conversationId);
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (mode === "never") return never();
  if (t.privateFollowUp) {
    if (mode === "private-hold") return never();
    if (mode === "private-fail") return { ok: false, outcome: "no_reply", agent };
    const dm = `c-dm-${agent}`;
    if (!db.conversations.some((item) => item.id === dm)) db.conversations.push(agentDm(agent));
    const answer = agentMsg(agent, null, viewer, "Here's the full picture for last year's workshop: 31 registered, 24 attended, and 6 became clients within 90 days. That's from Sales, read just now. Not included: anyone who bought after 90 days.", { id: `a-${agent}-dm-${++seq}`, created_at: nextAt() });
    (db.messages[dm] ??= []).push(answer);
    const c = db.conversations.find((item) => item.id === dm); if (c) { c.unread = Number(c.unread ?? 0) + 1; c.last_message_at = answer.created_at; }
    return { ok: true, outcome: "posted", agent, intent: "dm", message: answer, conversation_id: dm, duplicate: false };
  }
  if (mode === "no_reply") return { ok: false, outcome: "no_reply", agent };
  const parent = (t.threadRootId as string | null) ?? null;
  const isDm = conversation.startsWith("c-dm-");
  const text = mode.startsWith("private") ? `For the room: I'd judge a workshop on clients won within 90 days, not on sign-ups.\n\n${FIXED}` : REPLIES[agent] ?? "On it.";
  const answer = agentMsg(agent, source, viewer, text, { id: `a-${agent}-${source}`, parent_message_id: parent, created_at: nextAt() });
  if (parent) {
    (db.replies[parent] ??= []).push(answer);
    // The server counts a thread's replies; the double keeps its root in step.
    const root = (db.messages[conversation] ?? []).find((item) => item.id === parent);
    if (root) { root.reply_count = Number(root.reply_count) + 1; root.last_reply_at = answer.created_at; }
  } else (db.messages[conversation] ??= []).push(answer);
  return { ok: true, outcome: "posted", agent, intent: isDm ? "dm" : "reply", message: answer, conversation_id: conversation, duplicate: false,
    ...(mode.startsWith("private") ? { private_followup: { conversationId: conversation, sourceMessageId: source, threadRootId: parent, agent, privateFollowUp: true, dm_conversation_id: null } } : {}) };
}

export const supabase = {
  rpc: async (name: string, p: Row) => ({ data: backend(name, p), error: null }),
  from: () => ({ select() { return this; }, eq() { return this; }, in() { return Promise.resolve({ data: [], error: null }); } }),
  functions: { invoke: async (name: string, options: { body: Row }) => name === "paige-ai-chat" ? { data: await agentTurn(options.body), error: null } : { data: null, error: { message: "not in this harness" } } },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no files here" } }) }) },
  auth: { getSession: async () => ({ data: { session: null } }) },
};
