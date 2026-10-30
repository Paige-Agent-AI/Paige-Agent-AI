// Harness-only in-memory double for EXP08 Team Hub agents A2b (copied from the A2 harness and rewired).
//
// WHAT CHANGED FROM A2: no message carries a hand-written `approval` any more. A card reaches the screen
// ONLY through the real A2b wiring in useTeamHub.ts / team-hub-agents.ts:
//   - rpc("team_hub_card_states", { p_expected_tenant, p_channel_id, p_message_ids }) answers
//     { ok: true, cards: [{ message_id, card: { state, kind, actions: [{ summary, fingerprint?, note? }],
//       asker_user_id, decided_by_name, decided_at, expires_at }, outcome_message_id, record }] }
//     in the shape 20271121140008 builds it (fingerprint only to the asker and only while waiting; a
//     note only on done / failed), which parseCardStates reads;
//   - functions.invoke("paige-ai-chat", { body: { teamHubCardAct: { conversationId, messageId, act,
//     fingerprint } } }) answers { ok, outcome, card: <the state row above>, outcome_message } as
//     card-act.ts's runTeamHubCardAct returns it, which parseCardAct reads.
// Every request the screen sends is recorded on window.__thCardActs / window.__thCardReads.
//
// It is NOT the database, NOT the door, and NOT a model turn. The decide / run / settle are the
// server's (card-act.ts and supabase/tests/exp08_team_hub_a2b_cards.sql) and are not exercised here.
// The strings the SERVER writes are copied verbatim from the source: the card summaries from
// card-tools.ts CardProvenance.summary and growth-publish-command/contract.ts previewSummary; the done /
// failed notes and the outcome lines from card-act.ts doneNote, DONE_NOTE, FAILED_REASON and
// OUTCOME_LINE; the redirect line from card-tools.ts REDIRECT_LINE. The agents' own replies (the model's
// words) are hand-written here in the approved personalities' voice. Every name, business and address is
// fictional (Harbor & Pine Studio; Morgan Reyes, Priya Shah, Sam Rivera, Marcus Hale).
//
// Scenarios (`s=`): b2-handover, b2-cancel, b2-publish (waiting cards in the asker's agent DM);
// b2-handover-done, b2-handover-failed, b2-publish-done, b2-publish-done-noaddr (the same cards as the
// server reads them back after the act, e.g. after a reload); b2-redirect (an act asked in a channel:
// the Suggest and the server's redirect line); b2-paige-handover (PAIGE, the union, preparing the same
// hand-over in the asker's DM with her). `as=priya` views as a teammate who did not ask.
// `act=` picks what the card act answers: done (default), hold (never answers: the card stays Running),
// failed, declined (Not now always answers declined), not_yours, already_decided, done-noaddr,
// could_not_start (the chat answered without starting the act: nothing was decided).
const params = new URLSearchParams(location.search);
const scenario = params.get("s") ?? "b2-handover";
const actMode = params.get("act") ?? "done";
const viewer = params.get("as") === "priya" ? "u-priya" : "u-me";
const TENANT = params.get("t") === "b" ? "t-harness-b" : "t-harness";
const today = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission, team_conversations: true });
const people = [person("u-me", "Morgan Reyes", "Founder", "owner"), person("u-priya", "Priya Shah", "Operations lead", "admin"),
  person("u-sam", "Sam Rivera", "Client reporting"), person("u-marcus", "Marcus Hale", "Client delivery")];
type Row = Record<string, unknown>;
const conv = (o: Row) => ({ kind: "channel", visibility: "team", joined: true, member_count: null, member_ids: null, dm_user_id: null, agent_key: null, unread: 0, last_message_at: today(9, 40), ...o });
// An agent DM belongs to its one person. Morgan's (the asker's) are `c-dm-<agent>`; a teammate's own is
// `c-dm-<agent>-<user>`, opened through team_hub_open_agent_dm, and never shows Morgan's messages or cards.
const dmId = (agent: string, owner: string) => owner === "u-me" ? `c-dm-${agent}` : `c-dm-${agent}-${owner.slice(2)}`;
const agentDm = (agent: string, o: Row = {}, owner = "u-me") => conv({ id: dmId(agent, owner), kind: "agent_dm", name: null, visibility: "private", agent_key: agent, member_count: 1, member_ids: [owner], ...o });
const msg = (o: Row) => ({ parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], work_ref: null, files: [], author_kind: "user", agent_key: null, asked_in_message_id: null, agent_mentions: [], ...o });
const agentMsg = (id: string, agent: string, askedIn: string | null, asker: string, body: string, o: Row = {}) =>
  msg({ id, author_user_id: asker, author_kind: "agent", agent_key: agent, asked_in_message_id: askedIn, body, ...o });

// ── The server's own strings (copied, never paraphrased) ─────────────────────────────────────────
// card-tools.ts CardProvenance.summary: `Hand ${named} over to ${who}.` / `Cancel ${named}.`
const HANDOVER_SUMMARY = "Hand “Weekly client report” over to Sam Rivera.";
const CANCEL_SUMMARY = "Cancel “Venue walkthrough checklist”.";
// growth-publish-command/contract.ts previewSummary (page, publish, with an address); the page card
// takes the door's own summary (CardProvenance.summary returns null for a page).
const PAGE_ADDRESS = "/p/harbor-pine-studio/spring-open-house";
const PUBLISH_SUMMARY = `Publish the page "Spring Open House" at ${PAGE_ADDRESS}. Anyone with the link can open it. The forms on it go live too.`;
// card-act.ts doneNote / DONE_NOTE / FAILED_REASON / OUTCOME_LINE.
const DONE_NOTES: Record<string, string> = {
  task_handover: "“Weekly client report” is handed over to Sam Rivera.",
  task_cancel: "“Venue walkthrough checklist” is cancelled.",
  page_publish: `The page is live at ${PAGE_ADDRESS}.`,
};
const PAGE_DONE_NO_ADDRESS = "The page is published. Its address didn't come back, so open it from your pages to check.";
const FAILED_CHANGED = "the task changed after I read it";
const doneLine = (note: string) => `Done. ${note}`;
const failedLine = (reason: string) => `That didn't run: ${reason}. Nothing was changed.`;
// card-tools.ts REDIRECT_LINE (the server appends it; the model never writes it).
const REDIRECT_LINE = "I can do that with you in our DM.";

// ── Conversations and messages ─────────────────────────────────────────────────────────────────
const db = {
  people,
  conversations: [
    conv({ id: "c-general", name: "general", last_message_at: today(8, 30) }),
    conv({ id: "c-daily", name: "daily-management", last_message_at: today(10, 1) }),
    conv({ id: "c-delivery", name: "client-delivery", last_message_at: today(9, 10) }),
    // Morgan and Priya's DM, seen from either side: it names the other person, never the viewer.
    conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: ["u-me", "u-priya"], dm_user_id: viewer === "u-me" ? "u-priya" : "u-me", last_message_at: today(8, 12) }),
    agentDm("zion", { last_message_at: today(10, 2) }),
    agentDm("nexus", { last_message_at: today(9, 48) }),
    agentDm("vera", { last_message_at: today(9, 20) }),
    ...(scenario.startsWith("b2-paige") ? [agentDm("paige", { last_message_at: today(10, 2) })] : []),
  ] as Row[],
  messages: {
    "c-general": [msg({ id: "g1", author_user_id: "u-priya", body: "Morning all. The Spring Open House page is in review in the Studio today.", created_at: today(8, 30) })],
    "c-delivery": [msg({ id: "d1", author_user_id: "u-marcus", body: "Harbor & Pine's client calls move to Thursdays from next week.", created_at: today(9, 10) })],
    "c-daily": [
      msg({ id: "dl1", author_user_id: "u-priya", body: "Sam's starting on client reporting from Monday. I'll pair with him on Thursday's call.", created_at: today(9, 52) }),
      ...(scenario === "b2-redirect" ? [
        msg({ id: "dl2", author_user_id: "u-me", body: "@ZION hand the weekly client report over to Sam, he's taking it from Monday.", agent_mentions: ["zion"], created_at: today(10, 0) }),
        agentMsg("a-zion-dl2", "zion", "dl2", "u-me",
          `Sam has the lightest week and already joins the Thursday client calls, so the weekly client report is a good one to hand him first.\n\n${REDIRECT_LINE}`, { created_at: today(10, 1) }),
      ] : []),
    ],
    "c-dm-priya": [msg({ id: "p1", author_user_id: "u-priya", body: "Can we move our 1:1 to 3pm?", created_at: today(8, 12) })],
    "c-dm-zion": [] as Row[],
    "c-dm-nexus": [] as Row[],
    "c-dm-vera": [msg({ id: "v1", author_user_id: "u-me", body: "How many people booked from the last open house?", created_at: today(9, 19) }),
      agentMsg("a-vera-v1", "vera", "v1", "u-me", "Eighteen booked a consult within a month of the last open house. That's from Sales, read at 9:20.", { created_at: today(9, 20) })],
  } as Record<string, Row[]>,
  replies: {} as Record<string, Row[]>,
};

// The server's card link rows (team_hub_message_cards joined with the proposal), by message id.
type CardRow = { channel: string; message: string; kind: "task_handover" | "task_cancel" | "page_publish"; agent: string;
  asker: string; summary: string; fingerprint: string; expires_at: string; state: string; decided_by_name: string | null;
  decided_at: string | null; note: string | null; outcome_message_id: string | null; record: Row | null; noAddress?: boolean;
  /** The server answered not_yours to this session: its read gives this session no binding either. */
  unboundFor?: string };
const cards: Record<string, CardRow> = {};
const TASK_REPORT = "0b7c2e14-5a9d-4f36-8e21-3c4d5e6f7a81";
const TASK_WALKTHROUGH = "6e1f0a2b-3c4d-4e5f-9a8b-7c6d5e4f3a29";

function seedDm(agent: "zion" | "nexus" | "paige", ask: string, reply: string, kind: CardRow["kind"], summary: string, fp: string) {
  const ch = `c-dm-${agent}`;
  const askId = `${agent}-ask`;
  const replyId = `${agent}-card`;
  db.messages[ch] = [
    msg({ id: askId, author_user_id: "u-me", body: ask, created_at: today(10, 1) }),
    agentMsg(replyId, agent, askId, "u-me", reply, { created_at: today(10, 2) }),
  ];
  cards[replyId] = { channel: ch, message: replyId, kind, agent, asker: "u-me", summary, fingerprint: fp, expires_at: today(10, 12),
    state: "waiting", decided_by_name: null, decided_at: null, note: null, outcome_message_id: null, record: null };
}
if (scenario.startsWith("b2-handover")) seedDm("zion", "Sam's taking the weekly client report from Monday. Can you hand it over to him?",
  "Here's the hand-over: the weekly client report goes to Sam once you approve it. Nothing changes before that.", "task_handover", HANDOVER_SUMMARY, "3f9a1c07d2b84e65");
if (scenario.startsWith("b2-cancel")) seedDm("zion", "We moved the open house walkthrough online, so the venue walkthrough checklist isn't needed. Cancel it?",
  "Here's the cancel for the venue walkthrough checklist. It stays open until you approve it.", "task_cancel", CANCEL_SUMMARY, "9d04e7b3a1c25f86");
// PAIGE holds the union of her team's acts: the same hand-over door, the same summary, on her own DM.
if (scenario.startsWith("b2-paige-handover")) seedDm("paige", "Sam's taking the weekly client report from Monday. Hand it over to him?",
  "Sam already joins the Thursday client calls, so he's the right owner for it. The hand-over is on a card, and nothing changes until you approve.", "task_handover", HANDOVER_SUMMARY, "7a1d4c90e2b35f68");
if (scenario.startsWith("b2-publish")) seedDm("nexus", "The Spring Open House page is signed off. Can you put it live?",
  "Ooh, it's ready. The publish is on a card: the Spring Open House page goes live the moment you approve.", "page_publish", PUBLISH_SUMMARY, "c52e8f1d0a7b3946");

// ── The clock the server stamps decisions and outcome messages with ─────────────────────────────
let seq = 0;
const clock = { h: 10, m: 3 };
const nextAt = () => { clock.m += 1; if (clock.m > 59) { clock.m = 0; clock.h += 1; } return today(clock.h, clock.m); };
const record = (key: string, entry: unknown) => { const w = window as unknown as Record<string, unknown[]>; (w[key] ??= []).push(entry); };

/** What card-act.ts does after the door answers, reduced to its visible facts: settle, then post in the card's thread. */
function settle(row: CardRow, state: "done" | "failed" | "declined") {
  row.state = state;
  row.decided_by_name = "Morgan Reyes";
  row.decided_at = nextAt();
  if (state === "declined") return null;
  row.note = state === "done" ? (row.kind === "page_publish" && row.noAddress ? PAGE_DONE_NO_ADDRESS : DONE_NOTES[row.kind]) : FAILED_CHANGED;
  if (state === "done" && row.kind !== "page_publish") row.record = { destination: "operations_work", record_id: row.kind === "task_handover" ? TASK_REPORT : TASK_WALKTHROUGH };
  const outcome = agentMsg(`out-${row.message}-${++seq}`, row.agent, null, row.asker, state === "done" ? doneLine(row.note) : failedLine(row.note),
    { parent_message_id: row.message, created_at: nextAt() });
  (db.replies[row.message] ??= []).push(outcome);
  const parent = (db.messages[row.channel] ?? []).find((item) => item.id === row.message);
  if (parent) { parent.reply_count = Number(parent.reply_count) + 1; parent.last_reply_at = outcome.created_at; }
  row.outcome_message_id = String(outcome.id);
  return outcome;
}
if (scenario === "b2-handover-done") settle(cards["zion-card"], "done");
if (scenario === "b2-handover-failed") settle(cards["zion-card"], "failed");
if (scenario === "b2-publish-done") settle(cards["nexus-card"], "done");
if (scenario === "b2-publish-done-noaddr") { cards["nexus-card"].noAddress = true; settle(cards["nexus-card"], "done"); }

/** One card in the shape team_hub_card_states returns it, as THIS viewer reads it. */
function stateRow(row: CardRow): Row {
  const action: Row = { summary: row.summary };
  if (row.asker === viewer && row.state === "waiting" && row.unboundFor !== viewer) action.fingerprint = row.fingerprint;
  if ((row.state === "done" || row.state === "failed") && row.note) action.note = row.note;
  return { message_id: row.message, card: { state: row.state, kind: row.kind, actions: [action], asker_user_id: row.asker,
    decided_by_name: row.decided_by_name, decided_at: row.decided_at, expires_at: row.expires_at },
    outcome_message_id: row.outcome_message_id, record: row.record };
}

function cardStates(p: Row) {
  record("__thCardReads", { p_expected_tenant: p.p_expected_tenant, p_channel_id: p.p_channel_id, p_message_ids: p.p_message_ids });
  const c = db.conversations.find((item) => item.id === p.p_channel_id);
  if (!c || (Array.isArray(c.member_ids) && !(c.member_ids as string[]).includes(viewer))) return { ok: false, code: "not_found" };
  const ids = p.p_message_ids as string[];
  if (!Array.isArray(ids) || ids.length > 100) return { ok: false, code: "invalid" };
  return { ok: true, cards: ids.map((id) => cards[id]).filter((row) => row && row.channel === c.id).map(stateRow) };
}

// ── The other Team Hub doors (as in A2, trimmed to what these scenarios use) ─────────────────────
function turnStates(p: Row) {
  const c = db.conversations.find((item) => item.id === p.p_channel_id);
  if (!c) return { ok: false, code: "not_found" };
  const all = [...(db.messages[String(c.id)] ?? []), ...Object.values(db.replies).flat()];
  const states: Row[] = [];
  for (const id of p.p_message_ids as string[]) {
    const q = all.find((item) => item.id === id && item.author_kind !== "agent");
    if (!q || q.author_user_id !== viewer) continue;
    for (const key of c.kind === "agent_dm" ? [String(c.agent_key)] : (q.agent_mentions as string[])) {
      const answered = all.some((item) => item.author_kind === "agent" && item.agent_key === key && item.asked_in_message_id === id);
      states.push({ message_id: id, agent_key: key, state: answered ? "replied" : "none", private_part: false, asker_name: "Morgan Reyes" });
    }
  }
  return { ok: true, states };
}

function backend(name: string, p: Row) {
  if (name === "team_hub_list_conversations") return { ok: true, tenant_id: TENANT, me: { user_id: viewer }, people: db.people,
    // An agent DM is private to its one member: a teammate never lists the asker's.
    conversations: db.conversations.filter((c) => !Array.isArray(c.member_ids) || (c.member_ids as string[]).includes(viewer)) };
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
      parent_message_id: p.p_parent_message_id ?? null, agent_mentions: p.p_agent_mention_keys ?? [], created_at: nextAt() });
    (db.messages[String(p.p_channel_id)] ??= []).push(message);
    return { ok: true, duplicate: false, message };
  }
  if (name === "team_hub_open_agent_dm") {
    record("__thOpenedDm", p.p_agent_key);
    const key = String(p.p_agent_key);
    const id = dmId(key, viewer);
    if (!db.conversations.some((item) => item.id === id)) db.conversations.push(agentDm(key, { last_message_at: null }, viewer));
    db.messages[id] ??= [];
    return { ok: true, channel_id: id };
  }
  if (name === "team_hub_list_work") return { ok: true, items: [] };
  if (name === "team_hub_agent_turn_states") return turnStates(p);
  if (name === "team_hub_card_states") return cardStates(p);
  return { ok: false, code: "invalid" };
}

// ── The card act: runTeamHubCardAct's answer, by `act=` ─────────────────────────────────────────
const never = <T,>() => new Promise<T>(() => undefined);
async function cardAct(body: Row) {
  record("__thCardActs", body);
  const t = body.teamHubCardAct as Row;
  await new Promise((resolve) => setTimeout(resolve, 350));
  const row = cards[String(t.messageId)];
  const out = (ok: boolean, outcome: string, outcome_message: Row | null = null) => ({ ok, outcome, card: row ? stateRow(row) : null, outcome_message });
  if (!row || row.channel !== t.conversationId) return { ok: false, outcome: "not_visible", card: null, outcome_message: null };
  if (t.act === "decline") { if (row.state !== "waiting") return out(false, "already_decided"); settle(row, "declined"); return out(true, "declined"); }
  if (actMode === "hold") return never();
  // The server refuses the decision (no state change, no card in the answer).
  if (actMode === "not_yours") { row.unboundFor = viewer; return { ok: false, outcome: "not_yours", card: null, outcome_message: null }; }
  // The chat answered without starting the act (as runTeamHubCardAct does before deciding): nothing changed.
  if (actMode === "could_not_start") return { ok: false, outcome: "could_not_start", card: null, outcome_message: null };
  // Decided in another tab first: the card as it now stands, and nothing new is posted by this request.
  if (actMode === "already_decided") { if (row.state === "waiting") settle(row, "done"); return out(false, "already_decided"); }
  if (row.state !== "waiting" || t.fingerprint !== row.fingerprint) return out(false, "already_decided");
  if (actMode === "failed") { const m = settle(row, "failed"); return out(false, "failed", m); }
  if (actMode === "done-noaddr") row.noAddress = true;
  const m = settle(row, "done");
  return out(true, "done", m);
}

export const supabase = {
  rpc: async (name: string, p: Row) => ({ data: backend(name, p), error: null }),
  from: () => ({ select() { return this; }, eq() { return this; }, in() { return Promise.resolve({ data: [], error: null }); } }),
  functions: { invoke: async (name: string, options: { body: Row }) => {
    if (name !== "paige-ai-chat") return { data: null, error: { message: "not in this harness" } };
    if ("teamHubCardAct" in options.body) return { data: await cardAct(options.body), error: null };
    // No A2b scenario starts an agent turn; one would answer "no reply" here.
    record("__thTurns", options.body);
    return { data: { ok: false, outcome: "no_reply", agent: (options.body.teamHubAgentTurn as Row | undefined)?.agent ?? null }, error: null };
  } },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no files here" } }) }) },
  auth: { getSession: async () => ({ data: { session: null } }) },
};
