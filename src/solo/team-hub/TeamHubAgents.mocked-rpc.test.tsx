/**
 * EXP08 Team Hub agents, A1b: the visible states, driven against a MOCKED Supabase client.
 *
 * jsdom tests of the real workspace and hook. `supabase.rpc` is an in-memory double of the Team Hub
 * doors (A1a shapes) and `supabase.functions.invoke("paige-ai-chat")` is a double of the agent turn
 * (the HANDOFF's request and response shapes). They prove what the SCREEN does with each answer — the
 * identity it shows, what it sends, what only the asker sees, where focus goes. They prove nothing
 * about the database or a real model turn: those are the A1a SQL proof, the server unit tests, and the
 * authenticated drive, which stays UNVERIFIED here.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamHubWorkspace, type TeamHubApprovalHandler } from "./TeamHubWorkspace";
import { AGENT_WRITING_IDLE_RESET_MS, AGENT_WRITING_POLL_MAX_MS, AGENT_WRITING_POLL_MS, CARD_WORKING_POLL_MAX_MS, CARD_WORKING_POLL_MS, REFRESH_INTERVAL_MS } from "./useTeamHub";

const TENANT = "tenant-a";
const ME = "u-me";
const FIXED = "That part is just for you, so I'm answering it in our DM.";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(),
  storageFrom: vi.fn(),
  handoff: vi.fn(),
  tenant: { accountType: null as string | null },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke }, storage: { from: mocks.storageFrom } } }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: mocks.handoff }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenant: { id: TENANT, account_type: mocks.tenant.accountType }, activeTenantId: TENANT, activeUserId: ME,
    loading: false, accountContextStatus: "ready", refresh: vi.fn(),
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Record<string, unknown>;
const person = (user_id: string, display_name: string, title: string | null, permission = "member") => ({ user_id, display_name, title, permission });
const conv = (over: Row = {}) => ({ id: "c-launch", kind: "channel", name: "launch", visibility: "team", joined: true,
  member_count: null, member_ids: null, dm_user_id: null, unread: 0, last_message_at: null, ...over });
const agentDm = (agent: string, over: Row = {}) => conv({ id: `c-dm-${agent}`, kind: "agent_dm", name: null, visibility: "private", agent_key: agent,
  member_count: 1, member_ids: [ME], ...over });
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 27, 9, 0, clock++)).toISOString();
const msg = (over: Row = {}) => ({ id: `m-${clock}`, author_user_id: "u-priya", body: "Morning.", created_at: stamp(),
  parent_message_id: null, reply_count: 0, last_reply_at: null, mentions: [], files: [], work_ref: null,
  author_kind: "user", agent_key: null, asked_in_message_id: null, agent_mentions: [], ...over });
const reply = (agent: string, askedIn: string | null, body: string, over: Row = {}) =>
  msg({ id: `r-${agent}-${askedIn}`, author_user_id: ME, body, author_kind: "agent", agent_key: agent, asked_in_message_id: askedIn, ...over });

let db: { people: Row[]; conversations: Row[]; messages: Record<string, Row[]>; replies: Record<string, Row[]>; override: Record<string, (params: Row) => unknown>;
  /** The member-safe turn-state read's facts, keyed `${question}:${agent}` (anything not listed: the asker reads none, or replied). */
  states: Record<string, Row> };
let calls: Array<{ name: string; params: Row }>;
let turns: Row[];
/** A2b: the card read's rows by message id (the server's shape), and each card act sent, with its queued answers. */
let cardRows: Record<string, Row>;
let cardActs: Row[];
let cardAnswers: Array<Row | (() => Promise<Row>) | { error: unknown }>;

function backend(name: string, params: Row) {
  calls.push({ name, params });
  if (db.override[name]) return db.override[name](params);
  switch (name) {
    case "team_hub_list_conversations":
      return { ok: true, tenant_id: TENANT, me: { user_id: ME }, people: db.people, conversations: db.conversations };
    case "team_hub_list_messages": {
      const c = db.conversations.find((item) => item.id === params.p_channel_id);
      if (!c) return { ok: false, code: "not_found" };
      const summary = { id: c.id, kind: c.kind, name: c.name, visibility: c.visibility, joined: c.joined };
      if (params.p_thread_root) {
        const root = (db.messages[String(c.id)] ?? []).find((item) => item.id === params.p_thread_root);
        return root ? { ok: true, channel: summary, root, messages: [...(db.replies[String(root.id)] ?? [])].reverse(), has_more: false } : { ok: false, code: "not_found" };
      }
      return { ok: true, channel: summary, messages: [...(db.messages[String(c.id)] ?? [])].reverse(), has_more: false };
    }
    case "team_hub_mark_read":
      return { ok: true };
    case "team_hub_post_message": {
      const message = msg({ id: `m-sent-${calls.length}`, author_user_id: ME, body: String(params.p_body).trim(), mentions: params.p_mention_ids ?? [],
        parent_message_id: params.p_parent_message_id ?? null, agent_mentions: params.p_agent_mention_keys ?? [],
        ...(params.p_broadcast_mention ? { broadcast: params.p_broadcast_mention } : {}) });
      if (params.p_parent_message_id) (db.replies[String(params.p_parent_message_id)] ??= []).push(message);
      else (db.messages[String(params.p_channel_id)] ??= []).push(message);
      return { ok: true, duplicate: false, message };
    }
    case "team_hub_agent_turn_states": {
      // A double of the read's contract (proved in exp08_team_hub_agent_turn_states.sql and, for A1c,
      // exp08_team_hub_a1c.sql): the asker reads every state of their own questions; anyone else only a
      // reply being written (A1c), the two private-part lines and who a reply suggested bringing in,
      // without the line of context.
      const cid = String(params.p_channel_id);
      const c = db.conversations.find((item) => item.id === cid);
      if (!c) return { ok: false, code: "not_found" };
      const all = [...(db.messages[cid] ?? []), ...Object.values(db.replies).flat()];
      const states: Row[] = [];
      for (const id of params.p_message_ids as string[]) {
        const question = all.find((item) => item.id === id && item.author_kind !== "agent");
        if (!question) continue;
        const keys = c.kind === "agent_dm" ? [String(c.agent_key)] : (question.agent_mentions as string[]) ?? [];
        for (const key of keys) {
          const answered = all.some((item) => item.author_kind === "agent" && item.agent_key === key && item.asked_in_message_id === id);
          const fact = { state: answered ? "replied" : "none", private_part: false, asker_name: "Teammate", ...db.states[`${id}:${key}`] } as Row;
          const mine = question.author_user_id === ME;
          const bring = Array.isArray(fact.bring_in) ? (mine ? fact.bring_in : (fact.bring_in as Row[]).map((item) => ({ agent: item.agent }))) : undefined;
          const approved = (fact.private_part === true && (fact.state === "answering" || fact.state === "replied_privately"))
            || (fact.private_part !== true && fact.state === "answering");
          if (!mine && !approved && !bring) continue;
          states.push({ message_id: id, agent_key: key, state: mine || approved ? fact.state : "replied", private_part: fact.private_part,
            asker_name: fact.asker_name, ...(bring ? { bring_in: bring } : {}) });
        }
      }
      return { ok: true, states };
    }
    case "team_hub_card_states": {
      // A double of the A2b read's contract (proved in exp08_team_hub_a2b_cards.sql): the cards on the
      // asked messages of a conversation the reader can see, never their arguments.
      const cid = String(params.p_channel_id);
      if (!db.conversations.some((item) => item.id === cid)) return { ok: false, code: "not_found" };
      const cards = (params.p_message_ids as string[]).filter((id) => cardRows[id]).map((id) => ({ message_id: id, outcome_message_id: null, record: null, ...cardRows[id] }));
      return { ok: true, cards };
    }
    case "team_hub_open_agent_dm": {
      const key = String(params.p_agent_key);
      if (!db.conversations.some((item) => item.id === `c-dm-${key}`)) db.conversations.push(agentDm(key));
      db.messages[`c-dm-${key}`] ??= [];
      return { ok: true, channel_id: `c-dm-${key}` };
    }
    default:
      return { ok: false, code: "invalid" };
  }
}

/** The agent turn double: each call is answered by the next queued answer (or a deferred one). */
let answers: Array<Row | (() => Promise<Row>) | { error: unknown }>;
function turnDouble(name: string, options: { body: Row }) {
  if (name !== "paige-ai-chat") return Promise.resolve({ data: null, error: { message: "unexpected function" } });
  if ("teamHubCardAct" in options.body) {
    cardActs.push(options.body);
    const next = cardAnswers.shift();
    if (!next) return Promise.resolve({ data: { ok: false, outcome: "could_not_start", card: null, outcome_message: null }, error: null });
    if (typeof next === "function") return next().then((data) => ({ data, error: null }));
    if ("error" in next) return Promise.resolve({ data: null, error: next.error });
    return Promise.resolve({ data: next, error: null });
  }
  turns.push(options.body);
  const next = answers.shift();
  if (!next) return Promise.resolve({ data: { ok: false, outcome: "no_reply", agent: (options.body.teamHubAgentTurn as Row).agent }, error: null });
  if (typeof next === "function") return next().then((data) => ({ data, error: null }));
  if ("error" in next) return Promise.resolve({ data: null, error: next.error });
  return Promise.resolve({ data: next, error: null });
}
const posted = (message: Row, over: Row = {}) => ({ ok: true, outcome: "posted", agent: message.agent_key, intent: "reply", message,
  conversation_id: "c-launch", duplicate: false, ...over });
function deferred() {
  let resolve!: (value: Row) => void;
  const promise = new Promise<Row>((done) => { resolve = done; });
  return { answer: () => promise, resolve };
}

beforeEach(() => {
  document.body.innerHTML = "";
  clock = 0;
  calls = [];
  turns = [];
  answers = [];
  cardRows = {};
  cardActs = [];
  cardAnswers = [];
  mocks.tenant.accountType = null;
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, params: Row) => ({ data: backend(name, params), error: null }));
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(turnDouble);
  mocks.from.mockReset();
  mocks.handoff.mockReset();
  db = {
    people: [person(ME, "Morgan Reyes", null, "owner"), person("u-priya", "Priya Nair", "Operations lead", "admin"), person("u-sam", "Sam Lee", "Brand design")],
    conversations: [conv()],
    messages: { "c-launch": [msg({ id: "m-hello", body: "Workshop is Nov 14." })] },
    replies: {},
    override: {},
    states: {},
  };
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  vi.restoreAllMocks();
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))); });
  }
}
async function mount(props: { openPaige?: () => void; onOpenTeamSettings?: () => void; onApprovalAct?: TeamHubApprovalHandler } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => root.render(<TeamHubWorkspace {...props} />));
  await flush();
  return host;
}
const composer = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>(".th-conv textarea[role=combobox]")!;
const threadBox = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>("#th-thread-reply")!;
const button = (scope: ParentNode, name: string | RegExp) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
  .find((item) => typeof name === "string" ? item.textContent?.trim() === name || item.getAttribute("aria-label") === name : name.test(item.textContent ?? ""));
async function type(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.setSelectionRange(value.length, value.length);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function press(element: HTMLElement, key: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
}
async function click(element: HTMLElement | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await flush();
}
const rowOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`#th-msg-${id}`);
const liveRegion = (host: HTMLElement) => host.querySelector<HTMLElement>("[aria-live=polite]")!;
const turnBody = (index: number) => turns[index].teamHubAgentTurn as Row;

describe("flow 2: mention an agent in a channel", () => {
  it("sends the mention with the message, shows CURA is writing… to the asker, then CURA's reply as CURA", async () => {
    const pending = deferred();
    answers.push(pending.answer);
    const host = await mount();
    await type(composer(host), "@CURA who's onboarding this week?");
    await press(composer(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_agent_mention_keys).toEqual(["cura"]);
    // The exact request: the five documented keys, privateFollowUp left out, never a tenant or a user.
    expect(Object.keys(turns[0])).toEqual(["teamHubAgentTurn"]);
    expect(turnBody(0)).toEqual({ conversationId: "c-launch", sourceMessageId: expect.any(String), threadRootId: null, agent: "cura" });
    const asked = (db.messages["c-launch"] as Row[]).at(-1)!;
    expect(turnBody(0).sourceMessageId).toBe(asked.id);
    // The asker's own question carries the agent chip, in CURA's colour.
    const chip = rowOf(host, String(asked.id))!.querySelector(".th-ag-chip")!;
    expect(chip.textContent).toBe("@CURA");
    expect(chip.getAttribute("data-ag")).toBe("cura");
    const typing = host.querySelector(".th-ag-typing")!;
    expect(typing.getAttribute("role")).toBe("status");
    expect(typing.textContent).toBe("CURA is writing…");
    // Nothing is shown as posted before the server says so.
    expect(host.querySelector(".th-msg--agent")).toBeNull();
    const answer = reply("cura", String(asked.id), "Two people start Monday: the Harper team and one solo client.");
    await act(async () => pending.resolve(posted(answer)));
    await flush();
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    const row = rowOf(host, String(answer.id))!;
    expect(row.getAttribute("aria-label")).toMatch(/^CURA, agent, at /);
    expect(row.querySelector(".th-ag-namebtn")!.textContent).toBe("CURA");
    expect(row.querySelector(".th-ag-tag")!.textContent).toBe("Agent");
    expect(row.querySelector(".th-role")!.textContent).toBe("Client success");
    // Directly under the question, so no "replying to" link.
    expect(row.querySelector(".th-ag-re")).toBeNull();
    expect(row.textContent).not.toContain("Morgan");
  });

  it("links a top-level reply to the asker's message when it is not directly above, and the link goes there", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: "u-sam", body: "@CURA who's onboarding?", agent_mentions: ["cura"] }),
      msg({ id: "m-between", author_user_id: "u-priya", body: "Coffee's here." }),
      reply("cura", "m-ask", "Two people start Monday.", { author_user_id: "u-sam" })];
    const host = await mount();
    const link = rowOf(host, "r-cura-m-ask")!.querySelector<HTMLButtonElement>("button.th-ag-re")!;
    expect(link.textContent).toBe("replying to Sam");
    await click(link);
    expect(document.activeElement).toBe(rowOf(host, "m-ask"));
  });

  it("answers a thread reply in its thread: the request names the thread root and the reply lands there", async () => {
    db.messages["c-launch"] = [msg({ id: "m-root", body: "Kickoff agenda", reply_count: 1, last_reply_at: stamp() })];
    db.replies["m-root"] = [msg({ id: "m-r1", parent_message_id: "m-root", body: "Looks good." })];
    const host = await mount();
    await click(button(host, /^1 reply/));
    await type(threadBox(host), "@MENTOR what should the first exercise be?");
    await press(threadBox(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_parent_message_id).toBe("m-root");
    expect(post.params.p_agent_mention_keys).toEqual(["mentor"]);
    expect(turnBody(0)).toMatchObject({ conversationId: "c-launch", threadRootId: "m-root", agent: "mentor" });
    const question = String(turnBody(0).sourceMessageId);
    // No reply was queued, so the double said no_reply: the thread shows it to the asker, with Ask again.
    const thread = host.querySelector(".th-thread")!;
    expect(thread.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR didn't reply.Ask again");
    answers.push(posted(reply("mentor", question, "Start with one decision they own.", { parent_message_id: "m-root" })));
    await click(button(thread, "Ask again"));
    expect(turnBody(1)).toEqual(turnBody(0));
    expect(thread.textContent).toContain("Start with one decision they own.");
    expect(thread.textContent).not.toContain("didn't reply");
    // The main stream is not where a thread reply goes.
    expect(host.querySelector(".th-conv")!.textContent).not.toContain("Start with one decision they own.");
  });

  it("refuses a fourth agent in one message before anything is sent", async () => {
    const host = await mount();
    await type(composer(host), "@PAIGE @VERA @NEXUS @CURA all hands");
    await press(composer(host), "Enter");
    await flush();
    expect(calls.some((call) => call.name === "team_hub_post_message")).toBe(false);
    expect(host.querySelector(".th-composer-wrap .th-error")!.textContent).toBe("You can ask up to 3 agents in one message.");
    expect(liveRegion(host).textContent).toContain("You can ask up to 3 agents in one message.");
    expect(composer(host).value).toBe("@PAIGE @VERA @NEXUS @CURA all hands");
  });

  it("asks nobody for a lowercase name, an email address or a teammate whose name starts like an agent's", async () => {
    db.people.push(person("u-vera", "Vera Stone", "Bookkeeping"));
    const host = await mount();
    await type(composer(host), "@Vera");
    await press(composer(host), "Enter");
    await type(composer(host), "@Vera Stone thanks, and write to ops@ZION.example or @paige later");
    await press(composer(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_agent_mention_keys).toBeUndefined();
    expect(post.params.p_mention_ids).toEqual(["u-vera"]);
    expect(turns).toHaveLength(0);
  });
});

describe("flow 9: when an agent doesn't answer", () => {
  it.each([
    [{ ok: false, outcome: "no_reply", agent: "cura" }, "CURA didn't reply.", "Ask again"],
    [{ error: { message: "Edge Function returned a non-2xx status code" } }, "CURA couldn't start just now.", "Ask again"],
    [{ ok: false, outcome: "unconfirmed", agent: "cura" }, "CURA's reply may not have posted.", "Check again"],
    [{ ok: true, outcome: "posted", agent: "cura", message: { id: "x" } }, "CURA's reply may not have posted.", "Check again"],
    [{ ok: false, outcome: "rate_limited", agent: "cura" }, "You've reached 30 agent replies this hour. Try again later.", null],
    [{ ok: false, outcome: "cannot_post_here", agent: "cura" }, "CURA can't post here.", null],
  ])("shows the asker the exact line for %j, and the one recovery it offers", async (answer, line, action) => {
    answers.push(answer as Row);
    const host = await mount();
    await type(composer(host), "@CURA who's onboarding?");
    await press(composer(host), "Enter");
    await flush();
    const fail = host.querySelector(".th-ag-fail")!;
    // The line, then its one button: the recovery is never said twice.
    expect(fail.textContent).toBe(`${line}${action ?? ""}`);
    // A1c: a failure row is a status and carries no agent colour.
    expect(fail.hasAttribute("data-ag")).toBe(false);
    expect(fail.querySelector("[data-ag]")).toBeNull();
    expect(host.querySelector(".th-msg--agent")).toBeNull();
    if (action) {
      answers.push(posted(reply("cura", String(turnBody(0).sourceMessageId), "Two people start Monday.")));
      await click(button(fail, action));
      // Ask again and Check again send the SAME request; the server answers a repeat without posting twice.
      expect(turnBody(1)).toEqual(turnBody(0));
      expect(host.querySelector(".th-ag-fail")).toBeNull();
      expect(host.textContent).toContain("Two people start Monday.");
    } else {
      expect(fail.querySelector("button")).toBeNull();
    }
  });

  it("keeps CURA is writing… while another tab runs the same turn (in_flight)", async () => {
    answers.push({ ok: false, outcome: "in_flight", agent: "cura" });
    const host = await mount();
    await type(composer(host), "@CURA who's onboarding?");
    await press(composer(host), "Enter");
    await flush();
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("CURA is writing…");
    expect(host.querySelector(".th-ag-fail")).toBeNull();
  });

  it("coming back: the asker sees didn't reply under a question whose turn ended; nobody else does", async () => {
    db.messages["c-launch"] = [msg({ id: "m-mine", author_user_id: ME, body: "@MENTOR should the workshop be free?", agent_mentions: ["mentor"] }),
      msg({ id: "m-theirs", author_user_id: "u-priya", body: "@VERA how did last year's do?", agent_mentions: ["vera"] })];
    db.states = { "m-mine:mentor": { state: "failed" }, "m-theirs:vera": { state: "failed" } };
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR didn't reply.Ask again");
    expect(rowOf(host, "m-theirs")!.querySelector(".th-ag-fail")).toBeNull();
    answers.push(posted(reply("mentor", "m-mine", "Free gets a crowd; paid gets commitment.")));
    await click(button(rowOf(host, "m-mine")!, "Ask again"));
    expect(turnBody(0)).toEqual({ conversationId: "c-launch", sourceMessageId: "m-mine", threadRootId: null, agent: "mentor" });
    expect(host.textContent).toContain("Free gets a crowd; paid gets commitment.");
  });
});

describe("after a reload: the turn's true state, never a failure for a turn that may still be running (S3)", () => {
  const mine = (over: Row = {}) => msg({ id: "m-mine", author_user_id: ME, body: "@MENTOR should the workshop be free?", agent_mentions: ["mentor"], ...over });

  it("a turn still answering keeps MENTOR is writing… and no failure line", async () => {
    db.messages["c-launch"] = [mine()];
    db.states = { "m-mine:mentor": { state: "answering" } };
    const host = await mount();
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("MENTOR is writing…");
    expect(host.querySelector(".th-ag-fail")).toBeNull();
    expect(host.textContent).not.toContain("didn't reply");
  });

  it("a question asked moments ago with no turn yet (another tab is starting it) says only that it may still be coming, with Check again and a neutral mark", async () => {
    db.messages["c-launch"] = [mine({ created_at: new Date(Date.now() - 20_000).toISOString() })];
    const host = await mount();
    const line = rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!;
    expect(line.textContent).toBe("MENTOR may still be replying.Check again");
    // Not a failure: a neutral clock, never the warning triangle.
    expect(line.classList.contains("th-ag-fail--pending")).toBe(true);
    expect(line.hasAttribute("data-ag")).toBe(false);
    expect(line.querySelector("svg.lucide-clock")).not.toBeNull();
    expect(line.querySelector("svg.lucide-triangle-alert")).toBeNull();
  });

  it("Check again re-reads that question's turn state and never starts a turn: a turn still answering shows its writing row", async () => {
    db.messages["c-launch"] = [mine({ created_at: new Date(Date.now() - 20_000).toISOString() })];
    const host = await mount();
    const readsBefore = calls.filter((call) => call.name === "team_hub_agent_turn_states").length;
    // Another tab's turn is still running: the read says answering, so the writing row shows.
    db.states = { "m-mine:mentor": { state: "answering" } };
    await click(button(rowOf(host, "m-mine")!, "Check again"));
    await flush();
    const reads = calls.filter((call) => call.name === "team_hub_agent_turn_states");
    expect(reads.length).toBe(readsBefore + 1);
    expect(reads.at(-1)!.params).toEqual({ p_expected_tenant: TENANT, p_channel_id: "c-launch", p_message_ids: ["m-mine"] });
    expect(turns).toHaveLength(0);
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("MENTOR is writing…");
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")).toBeNull();
  });

  it("Check again on an unknown state that the read then says failed shows didn't reply with Ask again, and starts no turn by itself", async () => {
    db.messages["c-launch"] = [mine({ created_at: new Date(Date.now() - 20_000).toISOString() })];
    db.override.team_hub_agent_turn_states = () => ({ ok: false, code: "invalid" });
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR may still be replying.Check again");
    delete db.override.team_hub_agent_turn_states;
    db.states = { "m-mine:mentor": { state: "failed" } };
    await click(button(rowOf(host, "m-mine")!, "Check again"));
    await flush();
    expect(turns).toHaveLength(0);
    const line = rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!;
    expect(line.textContent).toBe("MENTOR didn't reply.Ask again");
    expect(line.classList.contains("th-ag-fail--pending")).toBe(false);
    answers.push(posted(reply("mentor", "m-mine", "Paid, with a free first session.")));
    await click(button(rowOf(host, "m-mine")!, "Ask again"));
    expect(turnBody(0)).toEqual({ conversationId: "c-launch", sourceMessageId: "m-mine", threadRootId: null, agent: "mentor" });
    expect(host.textContent).toContain("Paid, with a free first session.");
  });

  it("an old question no turn ever started for reads didn't reply", async () => {
    db.messages["c-launch"] = [mine({ created_at: "2026-10-01T09:00:00.000Z" })];
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR didn't reply.Ask again");
  });

  it("when the state cannot be read, nothing claims a failure: Check again only", async () => {
    db.messages["c-launch"] = [mine({ created_at: "2026-10-01T09:00:00.000Z" })];
    db.override.team_hub_agent_turn_states = () => ({ ok: false, code: "invalid" });
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR may still be replying.Check again");
    expect(host.textContent).not.toContain("didn't reply");
  });

  it("when Check again's own read fails too, it falls back to Ask again so the asker is never stuck (the accept door cannot post twice)", async () => {
    db.messages["c-launch"] = [mine({ created_at: "2026-10-01T09:00:00.000Z" })];
    db.override.team_hub_agent_turn_states = () => ({ ok: false, code: "invalid" });
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR may still be replying.Check again");
    answers.push(posted(reply("mentor", "m-mine", "Paid, with a free first session.")));
    await click(button(rowOf(host, "m-mine")!, "Check again"));
    await flush();
    expect(turns).toHaveLength(1);
    expect(turnBody(0)).toEqual({ conversationId: "c-launch", sourceMessageId: "m-mine", threadRootId: null, agent: "mentor" });
    expect(host.textContent).toContain("Paid, with a free first session.");
  });

  it("reads only this conversation's asking messages, under the reader's own session", async () => {
    db.messages["c-launch"] = [mine(), msg({ id: "m-plain", body: "No agent here." })];
    await mount();
    const read = calls.find((call) => call.name === "team_hub_agent_turn_states")!;
    expect(read.params).toEqual({ p_expected_tenant: TENANT, p_channel_id: "c-launch", p_message_ids: ["m-mine"] });
  });
});

describe("flow 3: Bring in", () => {
  const paigeReply = (asker: string) => [
    msg({ id: "m-ask", author_user_id: asker, body: "@PAIGE who's doing what for launch?", agent_mentions: ["paige"] }),
    reply("paige", "m-ask", "Tight, but doable. @CURA already has the welcome emails. I'd put @NEXUS on the announcement and @ZION on the task plan. Want me to bring them in?", { author_user_id: asker }),
  ];

  const suggested = { state: "replied", bring_in: [{ agent: "nexus", context: "PAIGE suggested you take the workshop announcement." },
    { agent: "zion", context: "PAIGE suggested you take the launch task plan." }] };

  it("gives only the asker Bring in buttons, for the agents PAIGE suggested; one writes the mention and its line into the composer and sends nothing", async () => {
    db.messages["c-launch"] = paigeReply(ME);
    db.states = { "m-ask:paige": suggested };
    const host = await mount();
    const row = rowOf(host, "r-paige-m-ask")!;
    // Agents named in PAIGE's text show as chips in their colours; nothing was asked by them.
    expect(Array.from(row.querySelectorAll(".th-ag-chip")).map((chip) => chip.getAttribute("data-ag"))).toEqual(["cura", "nexus", "zion"]);
    // CURA is named ("already has the welcome emails") but not suggested: only the suggestions are offered.
    const bring = Array.from(row.querySelectorAll<HTMLButtonElement>(".th-ag-bring-btn")).map((item) => item.textContent);
    expect(bring).toEqual(["Bring in NEXUS", "Bring in ZION"]);
    await click(button(row, "Bring in NEXUS"));
    // Exactly the approved prefill: the mention, then the one line.
    expect(composer(host).value).toBe("@NEXUS PAIGE suggested you take the workshop announcement.");
    expect(document.activeElement).toBe(composer(host));
    expect(liveRegion(host).textContent).toContain("The mention for NEXUS is in your message box. Send it to bring them in.");
    expect(calls.some((call) => call.name === "team_hub_post_message")).toBe(false);
    expect(turns).toHaveLength(0);
    // Sent, it asks exactly NEXUS, and the button goes.
    answers.push(posted(reply("nexus", "x", "On it.")));
    await press(composer(host), "Enter");
    await flush();
    expect(calls.find((call) => call.name === "team_hub_post_message")!.params.p_agent_mention_keys).toEqual(["nexus"]);
    expect(button(rowOf(host, "r-paige-m-ask")!, "Bring in NEXUS")).toBeUndefined();
  });

  it("a reply that names agents but suggested nobody offers no Bring in", async () => {
    db.messages["c-launch"] = paigeReply(ME);
    const host = await mount();
    expect(rowOf(host, "r-paige-m-ask")!.querySelector(".th-ag-bring")).toBeNull();
  });

  it("the asker's own fresh reply offers its suggestions from the turn's answer", async () => {
    const host = await mount();
    answers.push(() => Promise.resolve(posted(reply("paige", String(turnBody(0).sourceMessageId), "I'd put @NEXUS on the announcement."),
      { bring_in: [{ agent: "nexus", context: "PAIGE suggested you take the announcement." }] })));
    await type(composer(host), "@PAIGE who takes the announcement?");
    await press(composer(host), "Enter");
    await flush();
    await click(button(host.querySelector<HTMLElement>(".th-msg--agent")!, "Bring in NEXUS"));
    expect(composer(host).value).toBe("@NEXUS PAIGE suggested you take the announcement.");
  });

  it("tells everyone else who can bring them in, with no buttons and no line of context", async () => {
    db.messages["c-launch"] = paigeReply("u-priya");
    db.states = { "m-ask:paige": suggested };
    const host = await mount();
    const row = rowOf(host, "r-paige-m-ask")!;
    expect(row.querySelector(".th-ag-bring-btn")).toBeNull();
    expect(row.querySelector(".th-ag-bring")!.textContent).toBe("Only Priya can bring them in.");
  });
});

describe("flow 5: the private part, answered in the asker's DM", () => {
  it("shows the fixed line, then writing → answer in your DM with Open DM, and the DM holds the answer", async () => {
    const dmTurn = deferred();
    const host = await mount();
    const question = () => String(turnBody(0).sourceMessageId);
    answers.push(() => Promise.resolve(posted(reply("merit", question(), `Happy to talk deals.\n\n${FIXED}`),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: null } })));
    answers.push(dmTurn.answer);
    await type(composer(host), "@MERIT what did Harper & Co. pay us last quarter?");
    await press(composer(host), "Enter");
    await flush();
    // The DM turn started at once, from this tab, with privateFollowUp and the same question.
    expect(turnBody(1)).toEqual({ ...turnBody(0), privateFollowUp: true });
    const row = host.querySelector<HTMLElement>(".th-msg--agent")!;
    expect(row.querySelector(".th-text--fixed")!.textContent).toBe(FIXED);
    // The agent's own words do not repeat the fixed line.
    expect(row.querySelector(".th-text:not(.th-text--fixed)")!.textContent).toBe("Happy to talk deals.");
    expect(row.querySelector(".th-ag-priv")!.textContent).toContain("MERIT is writing your answer in your DM. Only you can see it.");
    expect(button(row, /Open DM/)).toBeDefined();
    // The DM appears in the list once its turn posts.
    db.conversations.push(agentDm("merit", { unread: 1 }));
    db.messages["c-dm-merit"] = [reply("merit", null, "Harper & Co. paid two invoices last quarter.", { id: "r-dm" })];
    await act(async () => dmTurn.resolve(posted(db.messages["c-dm-merit"][0], { intent: "dm", conversation_id: "c-dm-merit" })));
    await flush();
    expect(row.querySelector(".th-ag-priv")!.textContent).toContain("Your answer is in your DM with MERIT. Only you can see it.");
    // Nothing says the private answer was sent, and no DM text reaches the channel.
    expect(host.querySelector(".th-conv")!.textContent).not.toContain("paid two invoices");
    await click(button(row, /Open DM/));
    expect(host.querySelector(".th-conv-head--agent")!.textContent).toContain("MERIT");
    expect(host.querySelector(".th-ag-dmnote")!.textContent).toBe("Only you and MERIT can see this conversation. Not even owners can read it. MERIT works with what you're allowed to see.");
    expect(host.textContent).toContain("Harper & Co. paid two invoices last quarter.");
  });

  it("when the DM turn fails, the asker sees couldn't finish your private answer with Ask again, under the channel note", async () => {
    const host = await mount();
    const question = () => String(turnBody(0).sourceMessageId);
    answers.push(() => Promise.resolve(posted(reply("merit", question(), FIXED),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: "c-dm-merit" } })));
    answers.push({ ok: false, outcome: "no_reply", agent: "merit" });
    await type(composer(host), "@MERIT what did Harper & Co. pay us?");
    await press(composer(host), "Enter");
    await flush();
    const note = host.querySelector(".th-msg--agent .th-ag-priv")!;
    expect(note.textContent).toContain("MERIT couldn't finish your private answer.");
    // A1c owner ruling: the failed box is neutral. It carries no agent, so no agent tint or ring reaches it.
    expect(note.hasAttribute("data-ag")).toBe(false);
    expect(note.classList.contains("th-ag-priv--status")).toBe(true);
    expect(note.querySelector("[data-ag]")).toBeNull();
    answers.push(posted(reply("merit", null, "Two invoices.", { id: "r-dm" }), { intent: "dm", conversation_id: "c-dm-merit" }));
    await click(button(note as HTMLElement, "Ask again"));
    // Ask again re-runs the private part only, not the channel reply.
    expect(turnBody(2)).toEqual({ ...turnBody(0), privateFollowUp: true });
    expect(host.querySelector(".th-msg--agent .th-ag-priv")!.textContent).toContain("Your answer is in your DM with MERIT.");
  });

  it.each([
    ["answering", "MERIT is answering Sam privately."],
    ["replied_privately", "MERIT replied to Sam privately."],
  ])("shows another member the approved line while the private part is %s, and nothing else", async (state, line) => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: "u-sam", body: "@MERIT what did Harper pay?", agent_mentions: ["merit"] }),
      reply("merit", "m-ask", FIXED, { author_user_id: "u-sam" })];
    db.states = { "m-ask:merit": { state, private_part: true, asker_name: "Sam Lee" } };
    const host = await mount();
    const row = rowOf(host, "r-merit-m-ask")!;
    expect(row.querySelector(".th-ag-priv--others")!.textContent).toBe(line);
    expect(button(row, /Open DM/)).toBeUndefined();
    expect(row.textContent).not.toContain("Ask again");
  });

  it("a private part whose state cannot be read says it may still be coming; Check again re-reads it and starts no turn", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@MERIT what did Harper pay?", agent_mentions: ["merit"] }),
      reply("merit", "m-ask", FIXED)];
    db.override.team_hub_agent_turn_states = () => ({ ok: false, code: "invalid" });
    const host = await mount();
    const note = () => rowOf(host, "r-merit-m-ask")!.querySelector<HTMLElement>(".th-ag-priv")!;
    expect(note().textContent).toContain("MERIT may still be writing your private answer.");
    // §28: the unknown box keeps MERIT's tint exactly as A1b had it; only the FAILED box is neutral.
    expect(note().getAttribute("data-ag")).toBe("merit");
    expect(note().classList.contains("th-ag-priv--status")).toBe(false);
    expect(note().classList.contains("th-ag-priv--failed")).toBe(false);
    expect(note().querySelector("svg.lucide-lock")).not.toBeNull();
    delete db.override.team_hub_agent_turn_states;
    db.states = { "m-ask:merit": { state: "replied_privately", private_part: true } };
    await click(button(note(), "Check again"));
    await flush();
    expect(turns).toHaveLength(0);
    expect(calls.filter((call) => call.name === "team_hub_agent_turn_states").at(-1)!.params.p_message_ids).toEqual(["m-ask"]);
    expect(note().textContent).toContain("Your answer is in your DM with MERIT. Only you can see it.");
  });

  it("after a reload the asker sees the private part's true state from the read", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@MERIT what did Harper pay?", agent_mentions: ["merit"] }),
      reply("merit", "m-ask", FIXED)];
    db.states = { "m-ask:merit": { state: "replied_privately", private_part: true } };
    const host = await mount();
    expect(rowOf(host, "r-merit-m-ask")!.querySelector(".th-ag-priv")!.textContent).toContain("Your answer is in your DM with MERIT. Only you can see it.");
    expect(host.querySelector(".th-ag-fail")).toBeNull();
  });

  it("shows another member only the fixed line: no note, no Open DM, nothing private", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: "u-sam", body: "@MERIT what did Harper pay?", agent_mentions: ["merit"] }),
      reply("merit", "m-ask", FIXED, { author_user_id: "u-sam" })];
    const host = await mount();
    const row = rowOf(host, "r-merit-m-ask")!;
    expect(row.querySelector(".th-text--fixed")!.textContent).toBe(FIXED);
    expect(row.querySelector(".th-ag-priv")).toBeNull();
    expect(button(row, /Open DM/)).toBeUndefined();
  });
});

describe("a turn another tab owns is settled by the state read, never writing forever (Codex P2, A1c)", () => {
  const focusRead = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); await flush(); };
  const ask = async (host: HTMLElement, text = "@CURA who's onboarding?") => {
    await type(composer(host), text);
    await press(composer(host), "Enter");
    await flush();
    return String(turnBody(0).sourceMessageId);
  };

  it("in_flight, then the read says it ended without a post: the failure line with Ask again, which asks the same request", async () => {
    answers.push({ ok: false, outcome: "in_flight", agent: "cura" });
    const host = await mount();
    const question = await ask(host);
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("CURA is writing…");
    db.states = { [`${question}:cura`]: { state: "failed" } };
    await focusRead();
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    const fail = rowOf(host, question)!.querySelector(".th-ag-fail")!;
    expect(fail.textContent).toBe("CURA didn't reply.Ask again");
    answers.push(posted(reply("cura", question, "Two people start Monday.")));
    await click(button(fail as HTMLElement, "Ask again"));
    expect(turnBody(1)).toEqual(turnBody(0));
    expect(host.textContent).toContain("Two people start Monday.");
  });

  it("in_flight, then the other tab's reply posts: the row ends and the reply shows", async () => {
    answers.push({ ok: false, outcome: "in_flight", agent: "cura" });
    const host = await mount();
    const question = await ask(host);
    db.messages["c-launch"].push(reply("cura", question, "Two people start Monday."));
    await focusRead();
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    expect(host.querySelector(".th-ag-fail")).toBeNull();
    expect(host.textContent).toContain("Two people start Monday.");
  });

  it("in_flight while the read still says answering keeps CURA is writing…", async () => {
    answers.push({ ok: false, outcome: "in_flight", agent: "cura" });
    const host = await mount();
    const question = await ask(host);
    db.states = { [`${question}:cura`]: { state: "answering" } };
    await focusRead();
    expect(host.querySelectorAll(".th-ag-typing")).toHaveLength(1);
    expect(host.querySelector(".th-ag-fail")).toBeNull();
  });

  it("this tab's own running turn is never ended by a read, even one that says failed", async () => {
    const pending = deferred();
    answers.push(pending.answer);
    const host = await mount();
    const question = await ask(host);
    db.states = { [`${question}:cura`]: { state: "failed" } };
    await focusRead();
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("CURA is writing…");
    expect(host.querySelector(".th-ag-fail")).toBeNull();
    await act(async () => pending.resolve(posted(reply("cura", question, "Two people start Monday."))));
    await flush();
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    expect(host.textContent).toContain("Two people start Monday.");
  });

  it("a read issued before the turn went in_flight cannot settle it", async () => {
    // The first state read is held until after this tab hears in_flight; it says failed (stale).
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let held = false;
    const impl = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, params: Row) => {
      if (name === "team_hub_agent_turn_states" && !held && (params.p_message_ids as string[]).some((id) => id.startsWith("m-sent"))) {
        held = true;
        const stale = { ok: true, states: (params.p_message_ids as string[]).map((id) => ({ message_id: id, agent_key: "cura", state: "failed", private_part: false, asker_name: "Teammate" })) };
        await gate;
        calls.push({ name, params });
        return { data: stale, error: null };
      }
      return impl(name, params);
    });
    const pending = deferred();
    answers.push(pending.answer);
    const host = await mount();
    const question = await ask(host);
    // The read is out (held) while this tab's turn is still running; then the turn answers in_flight.
    expect(held).toBe(true);
    await act(async () => pending.resolve({ ok: false, outcome: "in_flight", agent: "cura" }));
    await flush();
    await act(async () => { release(); await gate; });
    await flush();
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("CURA is writing…");
    expect(rowOf(host, question)!.querySelector(".th-ag-fail")).toBeNull();
    // A read issued after it began waiting does settle it.
    db.states = { [`${question}:cura`]: { state: "failed" } };
    await focusRead();
    expect(rowOf(host, question)!.querySelector(".th-ag-fail")!.textContent).toBe("CURA didn't reply.Ask again");
  });

  const privateFirst = (host: HTMLElement) => () => String(turnBody(0).sourceMessageId);
  it("a private part left writing (another tab runs it) that the read says failed: couldn't finish, with Ask again, in the channel and in the DM", async () => {
    const host = await mount();
    const question = privateFirst(host);
    answers.push(() => Promise.resolve(posted(reply("merit", question(), FIXED),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: "c-dm-merit" } })));
    answers.push({ ok: false, outcome: "in_flight", agent: "merit" });
    await type(composer(host), "@MERIT what did Harper & Co. pay us?");
    await press(composer(host), "Enter");
    await flush();
    const note = () => host.querySelector<HTMLElement>(".th-msg--agent .th-ag-priv")!;
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    // The asker goes to the DM while it is being written: the channel's state is still read there.
    await click(button(note(), /Open DM/));
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("MERIT is writing…");
    db.states = { [`${question()}:merit`]: { state: "failed", private_part: true } };
    await focusRead();
    expect(calls.filter((call) => call.name === "team_hub_agent_turn_states").at(-1)!.params).toMatchObject({ p_channel_id: "c-launch" });
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    const fail = host.querySelector(".th-ag-fail")!;
    expect(fail.textContent).toBe("MERIT couldn't finish your private answer.Ask again");
    answers.push(posted(reply("merit", null, "Two invoices.", { id: "r-dm" }), { intent: "dm", conversation_id: "c-dm-merit" }));
    await click(button(fail as HTMLElement, "Ask again"));
    expect(turnBody(2)).toEqual({ ...turnBody(0), privateFollowUp: true });
  });

  it("a private part left writing that the read says replied privately: your answer is in your DM", async () => {
    const host = await mount();
    const question = privateFirst(host);
    answers.push(() => Promise.resolve(posted(reply("merit", question(), FIXED),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: null } })));
    answers.push({ ok: false, outcome: "in_flight", agent: "merit" });
    await type(composer(host), "@MERIT what did Harper & Co. pay us?");
    await press(composer(host), "Enter");
    await flush();
    const note = () => host.querySelector<HTMLElement>(".th-msg--agent .th-ag-priv")!;
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    db.states = { [`${question()}:merit`]: { state: "replied_privately", private_part: true } };
    await focusRead();
    expect(note().textContent).toContain("Your answer is in your DM with MERIT. Only you can see it.");
  });

  // The conversation read is held so the screen shows only what the STATE read settled: the reply
  // itself cannot arrive and hide a writing row or a failure line that should not be there.
  const holdConversationReads = () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let holding = false;
    const impl = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, params: Row) => {
      if (holding && name === "team_hub_list_messages") await gate;
      return impl(name, params);
    });
    return { hold: () => { holding = true; }, release: async () => { holding = false; await act(async () => { release(); await gate; }); await flush(); } };
  };
  it.each([
    ["answering", "MERIT is writing your answer in your DM. Only you can see it."],
    ["replied_privately", "Your answer is in your DM with MERIT. Only you can see it."],
    ["failed", "MERIT couldn't finish your private answer."],
  ])("in_flight, and the other tab's reply has a private part (%s): the row ends as replied, never writing forever and never didn't reply", async (state, note) => {
    // The read reports the DM turn's state for a reply with a private part, never `replied`: the
    // channel reply posted all the same, so this tab's in_flight row must end.
    answers.push({ ok: false, outcome: "in_flight", agent: "merit" });
    const reads = holdConversationReads();
    const host = await mount();
    const question = await ask(host, "@MERIT what did Harper & Co. pay us?");
    expect(host.querySelector(".th-ag-typing")!.textContent).toBe("MERIT is writing…");
    db.messages["c-launch"].push(reply("merit", question, `Quick one for everyone: dates close faster.\n\n${FIXED}`));
    db.states = { [`${question}:merit`]: { state, private_part: true } };
    reads.hold();
    await focusRead();
    expect(calls.filter((call) => call.name === "team_hub_agent_turn_states").at(-1)!.params.p_message_ids).toContain(question);
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    expect(host.textContent).not.toContain("MERIT didn't reply.");
    expect(rowOf(host, question)!.querySelector(".th-ag-fail")).toBeNull();
    await reads.release();
    const row = host.querySelector<HTMLElement>(".th-msg--agent")!;
    expect(row.querySelector(".th-text--fixed")!.textContent).toBe(FIXED);
    expect(row.querySelector(".th-ag-priv")!.textContent).toContain(note);
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    expect(host.textContent).not.toContain("MERIT didn't reply.");
    expect(turns).toHaveLength(1);
  });

  it("this tab's own Ask again on a private part is never ended by a read, even one that says failed", async () => {
    const host = await mount();
    const question = privateFirst(host);
    answers.push(() => Promise.resolve(posted(reply("merit", question(), FIXED),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: "c-dm-merit" } })));
    answers.push({ ok: false, outcome: "no_reply", agent: "merit" });
    await type(composer(host), "@MERIT what did Harper & Co. pay us?");
    await press(composer(host), "Enter");
    await flush();
    const note = () => host.querySelector<HTMLElement>(".th-msg--agent .th-ag-priv")!;
    expect(note().textContent).toContain("MERIT couldn't finish your private answer.");
    // The server still says the earlier DM turn failed; this tab asks for the private part again.
    db.states = { [`${question()}:merit`]: { state: "failed", private_part: true } };
    const pending = deferred();
    answers.push(pending.answer);
    await click(button(note(), "Ask again"));
    expect(turnBody(2)).toEqual({ ...turnBody(0), privateFollowUp: true });
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    const reads = calls.filter((call) => call.name === "team_hub_agent_turn_states").length;
    await focusRead();
    expect(calls.filter((call) => call.name === "team_hub_agent_turn_states").length).toBeGreaterThan(reads);
    // The stale failed read does not flicker the running turn to couldn't finish.
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    expect(host.textContent).not.toContain("couldn't finish");
    await act(async () => pending.resolve(posted(reply("merit", null, "Two invoices.", { id: "r-dm" }), { intent: "dm", conversation_id: "c-dm-merit" })));
    await flush();
    expect(note().textContent).toContain("Your answer is in your DM with MERIT. Only you can see it.");
  });

  it("a read issued before the private part went in_flight cannot end it", async () => {
    // The first state read is held until after this tab's DM turn hears in_flight; it says failed (stale).
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let held = false;
    const impl = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, params: Row) => {
      if (name === "team_hub_agent_turn_states" && !held && (params.p_message_ids as string[]).some((id) => id.startsWith("m-sent"))) {
        held = true;
        const stale = { ok: true, states: (params.p_message_ids as string[]).map((id) => ({ message_id: id, agent_key: "merit", state: "failed", private_part: true, asker_name: "Teammate" })) };
        await gate;
        calls.push({ name, params });
        return { data: stale, error: null };
      }
      return impl(name, params);
    });
    const host = await mount();
    const question = privateFirst(host);
    const dmTurn = deferred();
    answers.push(() => Promise.resolve(posted(reply("merit", question(), FIXED),
      { private_followup: { conversationId: "c-launch", sourceMessageId: question(), threadRootId: null, agent: "merit", privateFollowUp: true, dm_conversation_id: "c-dm-merit" } })));
    answers.push(dmTurn.answer);
    await type(composer(host), "@MERIT what did Harper & Co. pay us?");
    await press(composer(host), "Enter");
    await flush();
    const note = () => host.querySelector<HTMLElement>(".th-msg--agent .th-ag-priv")!;
    // The read is out (held) while this tab's DM turn is still running; then that turn answers in_flight.
    expect(held).toBe(true);
    expect(turns).toHaveLength(2);
    await act(async () => dmTurn.resolve({ ok: false, outcome: "in_flight", agent: "merit" }));
    await flush();
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    await act(async () => { release(); await gate; });
    await flush();
    expect(note().textContent).toContain("MERIT is writing your answer in your DM.");
    expect(host.textContent).not.toContain("couldn't finish");
    // A read issued after it began waiting does end it.
    db.states = { [`${question()}:merit`]: { state: "failed", private_part: true } };
    await focusRead();
    expect(note().textContent).toContain("MERIT couldn't finish your private answer.");
  });
});

describe("flow 4: a DM with an agent", () => {
  it("New message lists the seven agents under Your Paige team; opening one makes the DM and shows its note", async () => {
    const host = await mount();
    await click(button(host, "Message a teammate"));
    const picker = host.querySelector<HTMLElement>("[role=group][aria-label='Message a teammate']")!;
    expect(picker.querySelector(".th-pick-head")!.textContent).toBe("Your Paige team");
    const agents = Array.from(picker.querySelectorAll<HTMLElement>(".th-option[data-ag]"));
    expect(agents.map((item) => item.getAttribute("data-ag"))).toEqual(["paige", "vera", "nexus", "cura", "mentor", "merit", "zion"]);
    expect(agents[1].textContent).toContain("Finance & insights · only you see this DM");
    await click(agents[1]);
    expect(calls.find((call) => call.name === "team_hub_open_agent_dm")!.params).toMatchObject({ p_expected_tenant: TENANT, p_agent_key: "vera" });
    const head = host.querySelector(".th-conv-head--agent")!;
    expect(head.getAttribute("data-ag")).toBe("vera");
    expect(head.textContent).toContain("VERA");
    expect(head.textContent).toContain("Finance & insights: business performance, numbers & risk");
    expect(host.textContent).toContain("Ask VERA anything");
    expect(host.textContent).toContain("Your DM with VERA is separate from PAIGE chat, and the two don't share messages.");
    expect(composer(host).getAttribute("placeholder")).toBe("Message VERA");
    expect(host.querySelector(".th-hint")!.textContent).toBe("VERA replies here");
    // No @ list in an agent DM: nobody else can be in it, and no other agent is asked there.
    expect(button(host, "Mention someone")).toBeUndefined();
  });

  it("a message in the DM asks that agent (no stored mention) and its reply arrives in the DM", async () => {
    db.conversations.push(agentDm("vera"));
    db.messages["c-dm-vera"] = [];
    const host = await mount();
    await click(host.querySelector<HTMLElement>(".th-conv-item--agent[data-ag='vera']"));
    answers.push(() => Promise.resolve(posted(reply("vera", String(turnBody(0).sourceMessageId), "September is up 12% on August."), { intent: "dm", conversation_id: "c-dm-vera" })));
    // Another agent's name in the DM asks nobody else: the DM is only the person's and VERA's (the
    // server refuses an agent mention in an agent DM).
    await type(composer(host), "How did September close? @CURA says it was busy.");
    await press(composer(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_channel_id).toBe("c-dm-vera");
    expect(post.params.p_agent_mention_keys).toBeUndefined();
    expect(turns).toHaveLength(1);
    expect(turnBody(0)).toMatchObject({ conversationId: "c-dm-vera", agent: "vera", threadRootId: null });
    expect(host.textContent).toContain("September is up 12% on August.");
    expect(host.querySelector(".th-ag-dmnote")).not.toBeNull();
    // In the DM, no "replying to" and no private note.
    expect(host.querySelector(".th-msg--agent .th-ag-re")).toBeNull();
  });
});

describe("agent identity", () => {
  it("lists Your Paige team with each agent's plate, symbol and short role, and opens the profile from a message", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@CURA hi", agent_mentions: ["cura"] }), reply("cura", "m-ask", "Hello!")];
    const host = await mount();
    const rows = Array.from(host.querySelectorAll<HTMLElement>(".th-conv-item--agent"));
    expect(rows.map((item) => item.querySelector(".th-conv-role")?.textContent)).toEqual(
      ["Runs the team", "Finance & insights", "Marketing & growth", "Client success", "Discovery & strategy", "Sales & getting paid", "Operations & tasks"]);
    for (const item of rows) {
      const plate = item.querySelector(".th-ag-plate")!;
      expect(plate.getAttribute("data-ag")).toBe(item.getAttribute("data-ag"));
      expect(plate.querySelector("svg")).not.toBeNull();
      // The list rows carry no "Agent" word; the heading says it.
      expect(item.querySelector(".th-ag-tag")).toBeNull();
    }
    // PAIGE carries her Command Mark, not a stock icon.
    expect(rows[0].querySelector(".th-ag-mark")).not.toBeNull();
    // One tab stop per author: the plate is a pointer target only; the name carries the label.
    const plateButton = rowOf(host, "r-cura-m-ask")!.querySelector<HTMLButtonElement>(".th-ag-avbtn")!;
    expect(plateButton.tabIndex).toBe(-1);
    expect(plateButton.getAttribute("aria-hidden")).toBe("true");
    expect(rowOf(host, "r-cura-m-ask")!.querySelector(".th-ag-namebtn")!.getAttribute("aria-label")).toBe("CURA's profile");
    const trigger = rowOf(host, "r-cura-m-ask")!.querySelector<HTMLButtonElement>(".th-ag-namebtn")!;
    await click(trigger);
    const panel = host.querySelector<HTMLElement>("aside.th-profile")!;
    expect(panel.getAttribute("data-ag")).toBe("cura");
    expect(panel.querySelector("h2")!.textContent).toBe("Agent profile");
    expect(document.activeElement).toBe(panel.querySelector("h2"));
    expect(panel.textContent).toContain("“I'm CURA. I make sure every client feels looked after.”");
    expect(panel.textContent).toContain("A personality changes how CURA sounds, never what CURA can do.");
    expect(panel.textContent).toContain("Client success: onboarding, check-ins & the Customer Portal");
    expect(panel.textContent).toContain("Your DM with CURA is separate from PAIGE chat, and the two don't share messages.");
    // A1: read-only. Editing is A4, so there is no Edit view and no gold act here.
    expect(panel.textContent).not.toContain("Edit for your business");
    expect(panel.querySelector(".th-btn--act")).toBeNull();
    await press(panel, "Escape");
    await flush();
    expect(host.querySelector("aside.th-profile")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("groups the @ list under People in this conversation and Your Paige team, and the keyboard picks an agent", async () => {
    const host = await mount();
    await type(composer(host), "@");
    const box = host.querySelector<HTMLElement>("[role=listbox][aria-label='People and agents']")!;
    // A1c: Slack-style, one list for anyone you'd address: people, then the agents, then Everyone.
    expect(Array.from(box.querySelectorAll(".th-pop-head")).map((item) => item.textContent)).toEqual(["People in this conversation", "Your Paige team", "Everyone"]);
    const agentOption = box.querySelector<HTMLElement>("[role=option][data-ag='zion']")!;
    expect(agentOption.textContent).toContain("ZION");
    expect(agentOption.querySelector(".th-ag-tag")!.textContent).toBe("Agent");
    expect(agentOption.textContent).toContain("Operations & tasks · replies in this conversation");
    await type(composer(host), "@ZI");
    expect(composer(host).getAttribute("aria-activedescendant")).toBe(host.querySelector("[role=option][data-ag='zion']")!.id);
    await press(composer(host), "Enter");
    expect(composer(host).value).toBe("@ZION ");
  });

  it("shows no agent anywhere on a tier without Team Hub agents, and @CURA there asks nobody", async () => {
    mocks.tenant.accountType = "agency";
    const host = await mount();
    expect(host.querySelector(".th-conv-item--agent")).toBeNull();
    expect(host.textContent).not.toContain("Your Paige team");
    await type(composer(host), "@CURA hello");
    await press(composer(host), "Enter");
    await flush();
    expect(calls.find((call) => call.name === "team_hub_post_message")!.params.p_agent_mention_keys).toBeUndefined();
    expect(turns).toHaveLength(0);
  });
});

describe("a turn answered not_visible because the person is now in another workspace", () => {
  it("says it is another workspace, not that they can't see the conversation", async () => {
    const host = await mount();
    // The turn's server resolved another workspace (another tab switched it). The hub's own door answers
    // scope_changed to exactly that question, once; the hub then re-reads as usual.
    answers.push(() => {
      let once = true;
      db.override.team_hub_list_conversations = (params) => {
        if (once) { once = false; return { ok: false, code: "scope_changed" }; }
        delete db.override.team_hub_list_conversations;
        return backend("team_hub_list_conversations", params);
      };
      return Promise.resolve({ ok: false, outcome: "not_visible", agent: "cura" });
    });
    await type(composer(host), "@CURA who's onboarding?");
    await press(composer(host), "Enter");
    await flush();
    expect(host.querySelector(".th-ag-fail")!.textContent).toBe("CURA couldn't reply: you're working in another workspace now.");
  });
  it("a conversation that is really gone still says so", async () => {
    const host = await mount();
    answers.push({ ok: false, outcome: "not_visible", agent: "cura" });
    await type(composer(host), "@CURA who's onboarding?");
    await press(composer(host), "Enter");
    await flush();
    expect(host.querySelector(".th-ag-fail")!.textContent).toBe("CURA couldn't reply: you can't see this conversation any more.");
  });
});

describe("the agent DM header", () => {
  it("carries the long and the approved short Profile label; the container query shows one", async () => {
    db.conversations.push(agentDm("mentor"));
    db.messages["c-dm-mentor"] = [];
    const host = await mount();
    await click(host.querySelector<HTMLElement>("#th-conv-c-dm-mentor"));
    const head = host.querySelector(".th-conv-head--agent .th-head-actions button")!;
    expect(head.querySelector(".th-label-wide")!.textContent).toBe("How MENTOR works");
    expect(head.querySelector(".th-label-narrow")!.textContent).toBe("Profile");
  });
});

describe("A1c: \"<AGENT> is writing…\" for everyone who can see the conversation (owner ruling)", () => {
  const theirs = (over: Row = {}) => msg({ id: "m-q", author_user_id: "u-priya", body: "@MERIT what should the workshop cost?", agent_mentions: ["merit"], ...over });
  const stateReads = () => calls.filter((call) => call.name === "team_hub_agent_turn_states").length;
  // A manual clock for the hub's intervals (window.setInterval) and Date.now only: React's scheduling
  // and jsdom's animation frames keep real time, so the screen still settles between ticks.
  let now = 0;
  let intervals: Map<number, { fn: () => void; ms: number; next: number }>;
  const useClock = () => {
    now = Date.parse("2026-10-27T09:30:00Z");
    intervals = new Map();
    let ids = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const realSet = window.setInterval.bind(window);
    const realClear = window.clearInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      // Only the hub's own two cadences; anything else (jsdom's animation frames) keeps real time.
      if (ms !== AGENT_WRITING_POLL_MS && ms !== REFRESH_INTERVAL_MS) return realSet(fn, ms, ...rest);
      ids += 1;
      intervals.set(ids, { fn, ms: ms ?? 0, next: now + (ms ?? 0) });
      return 1_000_000 + ids;
    }) as unknown as typeof window.setInterval);
    vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
      if (id !== undefined && id > 1_000_000) intervals.delete(id - 1_000_000); else realClear(id);
    }) as typeof window.clearInterval);
  };
  const tick = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...intervals.entries()].filter(([, item]) => item.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
      if (!due) break;
      now = due[1].next;
      due[1].next += due[1].ms;
      await act(async () => { due[1].fn(); });
      await flush();
    }
    now = end;
  };

  it("another member sees MERIT is writing… under Priya's question, with the dots in MERIT's colour, and never a failure", async () => {
    db.messages["c-launch"] = [theirs()];
    db.states = { "m-q:merit": { state: "answering", asker_name: "Priya Nair" } };
    const host = await mount();
    const typing = host.querySelectorAll(".th-ag-typing");
    expect(typing).toHaveLength(1);
    expect(typing[0].textContent).toBe("MERIT is writing…");
    expect(typing[0].getAttribute("data-ag")).toBe("merit");
    expect(typing[0].getAttribute("role")).toBe("status");
    expect(typing[0].querySelectorAll(".th-ag-dots i")).toHaveLength(3);
    // At the end of the stream, after the question.
    expect(host.querySelector(".th-stream-content")!.lastElementChild).toBe(typing[0]);
    expect(host.querySelector(".th-ag-fail")).toBeNull();
    // Nothing of the asker's own: no Ask again, no private note, no turn of this tab.
    expect(button(host, "Ask again")).toBeUndefined();
    expect(turns).toHaveLength(0);
  });

  it("another member sees it in a thread too, at the end of the thread", async () => {
    db.messages["c-launch"] = [msg({ id: "m-root", body: "Kickoff agenda", reply_count: 1, last_reply_at: stamp() })];
    db.replies["m-root"] = [theirs({ id: "m-tq", parent_message_id: "m-root", body: "@MERIT and the price?" })];
    db.states = { "m-tq:merit": { state: "answering", asker_name: "Priya Nair" } };
    const host = await mount();
    expect(host.querySelector(".th-conv .th-ag-typing")).toBeNull();
    await click(button(host, /^1 reply/));
    const thread = host.querySelector(".th-thread")!;
    expect(thread.querySelectorAll(".th-ag-typing")).toHaveLength(1);
    expect(thread.querySelector(".th-ag-typing")!.textContent).toBe("MERIT is writing…");
  });

  it("a private part being written stays the approved line for others, never a writing row", async () => {
    db.messages["c-launch"] = [theirs(), reply("merit", "m-q", FIXED, { author_user_id: "u-priya" })];
    db.states = { "m-q:merit": { state: "answering", private_part: true, asker_name: "Priya Nair" } };
    const host = await mount();
    expect(host.textContent).toContain("MERIT is answering Priya privately.");
    expect(host.querySelector(".th-ag-typing")).toBeNull();
  });

  it("the asker's own question shows one writing row, not two, while the server also says answering", async () => {
    const pending = deferred();
    answers.push(pending.answer);
    const host = await mount();
    await type(composer(host), "@CURA who's onboarding?");
    await press(composer(host), "Enter");
    await flush();
    const question = String(turnBody(0).sourceMessageId);
    db.states = { [`${question}:cura`]: { state: "answering" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(calls.filter((call) => call.name === "team_hub_agent_turn_states").some((call) => (call.params.p_message_ids as string[]).includes(question))).toBe(true);
    expect(host.querySelectorAll(".th-ag-typing")).toHaveLength(1);
    pending.resolve(posted(reply("cura", question, "Two people start Monday.")));
    await flush();
  });

  it("re-reads every 3 s while MERIT is writing, then the reply appears and the row ends; the 3 s reads stop", async () => {
    useClock();
    db.messages["c-launch"] = [theirs()];
    db.states = { "m-q:merit": { state: "answering", asker_name: "Priya Nair" } };
    const host = await mount();
    const before = stateReads();
    await tick(AGENT_WRITING_POLL_MS);
    expect(stateReads()).toBe(before + 1);
    await tick(AGENT_WRITING_POLL_MS);
    expect(stateReads()).toBe(before + 2);
    // The reply posts: the next read says replied (others read nothing), and the stream is read again.
    db.messages["c-launch"].push(reply("merit", "m-q", "Charge for the outcome, not the hours.", { author_user_id: "u-priya" }));
    db.states = {};
    const lists = calls.filter((call) => call.name === "team_hub_list_messages").length;
    await tick(AGENT_WRITING_POLL_MS);
    expect(calls.filter((call) => call.name === "team_hub_list_messages").length).toBeGreaterThan(lists);
    expect(host.querySelector(".th-ag-typing")).toBeNull();
    expect(host.textContent).toContain("Charge for the outcome, not the hours.");
    // Nothing is being written now: the 3 s interval is gone (the 15 s tick is the next read, at 15 s).
    expect([...intervals.values()].some((item) => item.ms === AGENT_WRITING_POLL_MS)).toBe(false);
    const settled = stateReads();
    await tick(AGENT_WRITING_POLL_MS - 1);
    expect(stateReads()).toBe(settled);
  });

  it("stops the 3 s reads while the tab is hidden, and after 2 minutes; the 15 s tick carries on", async () => {
    useClock();
    db.messages["c-launch"] = [theirs()];
    db.states = { "m-q:merit": { state: "answering", asker_name: "Priya Nair" } };
    let visibility = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
    await mount();
    const hidden = stateReads();
    await tick(AGENT_WRITING_POLL_MS * 4);
    expect(stateReads()).toBe(hidden);
    visibility = "visible";
    await tick(AGENT_WRITING_POLL_MAX_MS);
    const capped = stateReads();
    // Inside the window the 3 s reads ran (and the 15 s tick too); past it only the 15 s tick reads.
    expect(capped).toBeGreaterThan(hidden + 20);
    expect([...intervals.values()].some((item) => item.ms === AGENT_WRITING_POLL_MS)).toBe(false);
    await tick(REFRESH_INTERVAL_MS);
    expect(stateReads()).toBe(capped + 1);
  }, 60_000);

  it("caps the 3 s reads 2 minutes from when they began, even when another reply starts writing; a pause resets it", async () => {
    useClock();
    const fast = () => [...intervals.values()].some((item) => item.ms === AGENT_WRITING_POLL_MS);
    db.messages["c-launch"] = [theirs(), msg({ id: "m-q2", author_user_id: "u-sam", body: "@CURA who starts Monday?", agent_mentions: ["cura"] })];
    db.states = { "m-q:merit": { state: "answering", asker_name: "Priya Nair" } };
    await mount();
    expect(fast()).toBe(true);
    await tick(99_000);
    // 99 s in, CURA starts writing too: the set of writing replies changes, the cap does not restart.
    db.states = { ...db.states, "m-q2:cura": { state: "answering", asker_name: "Sam Lee" } };
    await tick(AGENT_WRITING_POLL_MS);
    expect(document.querySelectorAll(".th-ag-typing")).toHaveLength(2);
    expect(fast()).toBe(true);
    // At 2 minutes from the FIRST fast read the 3 s reads stop, though both are still writing (now 123 s in;
    // a cap restarted when CURA began would run to 222 s).
    await tick(AGENT_WRITING_POLL_MAX_MS - 99_000);
    expect(fast()).toBe(false);
    const capped = stateReads();
    await tick(AGENT_WRITING_POLL_MS * 3);
    expect(stateReads()).toBe(capped);
    // MERIT finishes while CURA keeps writing: still capped (writing never paused).
    db.states = { "m-q2:cura": { state: "answering", asker_name: "Sam Lee" } };
    await tick(REFRESH_INTERVAL_MS);
    expect(document.querySelectorAll(".th-ag-typing")).toHaveLength(1);
    expect(fast()).toBe(false);
    // Nothing written for a while, then a new reply starts: a new burst, so fast reads begin again.
    db.states = {};
    await tick(REFRESH_INTERVAL_MS);
    expect(document.querySelectorAll(".th-ag-typing")).toHaveLength(0);
    await tick(AGENT_WRITING_IDLE_RESET_MS);
    db.states = { "m-q:merit": { state: "answering", asker_name: "Priya Nair" } };
    await tick(REFRESH_INTERVAL_MS);
    expect(document.querySelectorAll(".th-ag-typing")).toHaveLength(1);
    expect(fast()).toBe(true);
  }, 60_000);

  it("with nothing being written there are no 3 s reads at all", async () => {
    useClock();
    db.messages["c-launch"] = [theirs(), reply("merit", "m-q", "Done.", { author_user_id: "u-priya" })];
    await mount();
    const before = stateReads();
    await tick(REFRESH_INTERVAL_MS - 1);
    expect(stateReads()).toBe(before);
  });
});

describe("A1c: a thread's reply box carries the same @ list (Slack lets you @ in a thread)", () => {
  const threadList = (host: HTMLElement) => host.querySelector<HTMLElement>(".th-thread [role=listbox][aria-label='People and agents']");
  const threadKeys = (host: HTMLElement) => Array.from(threadList(host)?.querySelectorAll<HTMLElement>("[role=option]") ?? [])
    .map((option) => option.getAttribute("data-ag") ?? (option.getAttribute("data-bc") ? `@${option.getAttribute("data-bc")}` : option.querySelector(".th-option-meta span")!.textContent));
  const openThreadOf = async (host: HTMLElement) => { await click(button(host, /^1 reply/)); expect(threadBox(host)).toBeTruthy(); };
  const withThread = (channel: string) => {
    db.messages[channel] = [msg({ id: `m-root-${channel}`, body: "Kickoff agenda", reply_count: 1, last_reply_at: stamp() })];
    db.replies[`m-root-${channel}`] = [msg({ id: `m-r1-${channel}`, parent_message_id: `m-root-${channel}`, body: "Looks good." })];
  };

  it("in a channel thread: people who can see it, Your Paige team, then Everyone; a picked person is mentioned and @here is sent", async () => {
    withThread("c-launch");
    const host = await mount();
    await openThreadOf(host);
    // The same Composer: an @ button, no / menu in a thread.
    const thread = host.querySelector<HTMLElement>(".th-thread")!;
    expect(button(thread, "Mention someone")).toBeTruthy();
    expect(button(thread, "PAIGE commands")).toBeUndefined();
    await type(threadBox(host), "@");
    expect(threadKeys(host)).toEqual(["Priya Nair", "Sam Lee", "paige", "vera", "nexus", "cura", "mentor", "merit", "zion", "@channel", "@here"]);
    await type(threadBox(host), "@pri");
    await press(threadBox(host), "Enter");
    expect(threadBox(host).value).toBe("@Priya Nair ");
    await type(threadBox(host), "@Priya Nair @he");
    await press(threadBox(host), "Tab");
    expect(threadBox(host).value).toBe("@Priya Nair @here ");
    await type(threadBox(host), "@Priya Nair @here can someone check?");
    await press(threadBox(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_parent_message_id).toBe("m-root-c-launch");
    expect(post.params.p_mention_ids).toEqual(["u-priya"]);
    expect(post.params.p_broadcast_mention).toBe("here");
    expect(post.params.p_agent_mention_keys).toBeUndefined();
    expect(turns).toHaveLength(0);
  });

  it("in a thread, a leading / is just text: no command menu or note opens, and it is sent as typed", async () => {
    withThread("c-launch");
    const host = await mount();
    await openThreadOf(host);
    const thread = host.querySelector<HTMLElement>(".th-thread")!;
    await type(threadBox(host), "/draft a task");
    expect(thread.querySelector("[role=listbox][aria-label='PAIGE commands']")).toBeNull();
    expect(thread.textContent).not.toContain("No command matches");
    await press(threadBox(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_parent_message_id).toBe("m-root-c-launch");
    expect(post.params.p_body).toBe("/draft a task");
  });

  it("in a person DM's thread: no Everyone group, and a typed @here is never sent as a broadcast", async () => {
    db.conversations.push(conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-priya"], dm_user_id: "u-priya" }));
    withThread("c-dm-priya");
    const host = await mount();
    await click(host.querySelector<HTMLElement>("#th-conv-c-dm-priya"));
    await openThreadOf(host);
    await type(threadBox(host), "@");
    expect(threadKeys(host)).toEqual(["Priya Nair", "paige", "vera", "nexus", "cura", "mentor", "merit", "zion"]);
    expect(threadList(host)!.querySelector("[data-bc]")).toBeNull();
    await type(threadBox(host), "@here are you free?");
    await press(threadBox(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_parent_message_id).toBe("m-root-c-dm-priya");
    expect("p_broadcast_mention" in post.params).toBe(false);
  });

  it("in an agent DM's thread: neither Your Paige team nor Everyone is offered, and @channel is never sent", async () => {
    db.conversations.push(agentDm("cura"));
    withThread("c-dm-cura");
    const host = await mount();
    await click(host.querySelector<HTMLElement>("#th-conv-c-dm-cura"));
    await openThreadOf(host);
    await type(threadBox(host), "@");
    expect(threadList(host)).toBeNull();
    await type(threadBox(host), "@channel ping");
    await press(threadBox(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect("p_broadcast_mention" in post.params).toBe(false);
    expect(post.params.p_agent_mention_keys).toBeUndefined();
  });
});

describe("A1c: one @ list for anyone you'd address (Slack-style), and @channel / @here", () => {
  const box = (host: HTMLElement) => host.querySelector<HTMLElement>("[role=listbox][aria-label='People and agents']");
  const optionKeys = (host: HTMLElement) => Array.from(box(host)?.querySelectorAll<HTMLElement>("[role=option]") ?? [])
    .map((option) => option.getAttribute("data-ag") ?? (option.getAttribute("data-bc") ? `@${option.getAttribute("data-bc")}` : option.querySelector(".th-option-meta span")!.textContent));

  it("lists people who can see the conversation first, then Your Paige team, then Everyone with @channel and @here", async () => {
    const host = await mount();
    await type(composer(host), "@");
    expect(optionKeys(host)).toEqual(["Priya Nair", "Sam Lee", "paige", "vera", "nexus", "cura", "mentor", "merit", "zion", "@channel", "@here"]);
    const everyone = Array.from(box(host)!.querySelectorAll("[role=option][data-bc]"));
    expect(everyone.map((option) => option.textContent)).toEqual(["@channelEveryone in #launch", "@hereEveryone active in #launch"]);
    // Neutral: no agent colour on the Everyone options.
    expect(everyone.every((option) => !option.hasAttribute("data-ag") && !option.querySelector("[data-ag]"))).toBe(true);
  });

  it("filters every group by the start of any word, closest first, and the keyboard moves, picks and closes", async () => {
    const host = await mount();
    await type(composer(host), "@le");
    expect(optionKeys(host)).toEqual(["Sam Lee"]);
    await type(composer(host), "@ri");
    expect(box(host)).toBeNull();
    await type(composer(host), "@me");
    expect(optionKeys(host)).toEqual(["mentor", "merit"]);
    await type(composer(host), "@merit");
    expect(optionKeys(host)).toEqual(["merit"]);
    await type(composer(host), "@ev");
    expect(optionKeys(host)).toEqual(["@channel", "@here"]);
    await type(composer(host), "@he");
    expect(optionKeys(host)).toEqual(["@here"]);
    // Up from the first option wraps to the last, which is scrolled into view; Tab picks; Esc closes a reopened list.
    const seen: Element[] = [];
    const scroll = vi.fn(function (this: Element) { seen.push(this); });
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scroll });
    await type(composer(host), "@");
    await press(composer(host), "ArrowUp");
    expect(composer(host).getAttribute("aria-activedescendant")).toBe(box(host)!.querySelector("[role=option][data-bc='here']")!.id);
    expect(seen.at(-1)).toBe(box(host)!.querySelector("[role=option][data-bc='here']"));
    expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
    if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    await press(composer(host), "ArrowUp");
    expect(composer(host).getAttribute("aria-activedescendant")).toBe(box(host)!.querySelector("[role=option][data-bc='channel']")!.id);
    await press(composer(host), "Tab");
    expect(composer(host).value).toBe("@channel ");
    await type(composer(host), "@channel @");
    expect(box(host)).not.toBeNull();
    await press(composer(host), "Escape");
    expect(box(host)).toBeNull();
  });

  it("@channel is stored with the message, never asks an agent, and shows as a neutral chip", async () => {
    const host = await mount();
    await type(composer(host), "@channel the launch is Friday");
    await press(composer(host), "Enter");
    await flush();
    const post = calls.find((call) => call.name === "team_hub_post_message")!;
    expect(post.params.p_broadcast_mention).toBe("channel");
    expect(post.params.p_agent_mention_keys).toBeUndefined();
    expect(turns).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalled();
    const chip = host.querySelector(".th-bc-chip")!;
    expect(chip.textContent).toBe("@channel");
    expect(chip.classList.contains("th-mention")).toBe(true);
    expect(chip.hasAttribute("data-ag")).toBe(false);
  });

  it("@here and @channel together send @channel; a plain message sends neither", async () => {
    const host = await mount();
    await type(composer(host), "@here and @channel: standup moved");
    await press(composer(host), "Enter");
    await flush();
    await type(composer(host), "standup moved");
    await press(composer(host), "Enter");
    await flush();
    const posts = calls.filter((call) => call.name === "team_hub_post_message");
    expect(posts[0].params.p_broadcast_mention).toBe("channel");
    expect("p_broadcast_mention" in posts[1].params).toBe(false);
  });

  it("is never offered or sent in a person DM or an agent DM", async () => {
    db.conversations.push(conv({ id: "c-dm-priya", kind: "dm", name: null, visibility: "private", member_count: 2, member_ids: [ME, "u-priya"], dm_user_id: "u-priya" }));
    db.messages["c-dm-priya"] = [];
    db.conversations.push(agentDm("cura"));
    db.messages["c-dm-cura"] = [];
    const host = await mount();
    await click(host.querySelector<HTMLElement>("#th-conv-c-dm-priya"));
    await type(composer(host), "@");
    expect(box(host)!.querySelector("[data-bc]")).toBeNull();
    await type(composer(host), "@here are you free?");
    await press(composer(host), "Enter");
    await flush();
    await click(host.querySelector<HTMLElement>("#th-conv-c-dm-cura"));
    await type(composer(host), "@here hello");
    await press(composer(host), "Enter");
    await flush();
    const posts = calls.filter((call) => call.name === "team_hub_post_message");
    expect(posts).toHaveLength(2);
    expect(posts.every((call) => !("p_broadcast_mention" in call.params))).toBe(true);
  });

  it("renders a sent message's person, agent and @channel chips: the person and @channel neutral, the agent in its identity", async () => {
    db.messages["c-launch"] = [
      msg({ id: "m-chips", body: "@channel @Priya Nair and @CURA: Friday", mentions: ["u-priya"], agent_mentions: ["cura"], broadcast: "channel" }),
      msg({ id: "m-typed", body: "a typed @channel the server did not store" }),
    ];
    const host = await mount();
    const row = rowOf(host, "m-chips")!;
    const person = Array.from(row.querySelectorAll(".th-mention")).find((chip) => chip.textContent === "@Priya Nair")!;
    expect(person.hasAttribute("data-ag")).toBe(false);
    expect(person.classList.contains("th-bc-chip")).toBe(false);
    expect(row.querySelector(".th-ag-chip[data-ag='cura']")!.textContent).toBe("@CURA");
    expect(row.querySelector(".th-bc-chip")!.textContent).toBe("@channel");
    expect(rowOf(host, "m-typed")!.querySelector(".th-bc-chip")).toBeNull();
  });
});

// EXP08 A2a: the approved card is mounted in the real workspace, and the Solo shell passes no
// onApprovalAct (SoloApp.tsx), so the asker must never see an Approve that nothing can redeem (§70).
describe("A2a: the approval card in the real workspace", () => {
  const approval = { state: "waiting", kind: "Operations task", asker_user_id: ME,
    actions: [{ summary: "ZION wants to create a task in Operations: \u201cPrepare the onboarding packet\u201d.", fingerprint: "fp-zion-1" }] };

  // A2b changed this: the Solo shell still passes no seam, and the hub's own actOnCard redeems the card,
  // so the asker gets Approve, and it reaches the server (which alone says whether it is a card).
  it("draws the asker's card with Approve where the shell holds no seam, because the hub redeems it (A2b)", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@ZION set up the packet task", agent_mentions: ["zion"] }),
      reply("zion", "m-ask", "Here is the task I'd create.", { approval })];
    const host = await mount();
    const card = rowOf(host, "r-zion-m-ask")!.querySelector(".th-ap")!;
    expect(card).toBeTruthy();
    expect(card.querySelector('[data-confirm-part="refusal"]')).toBeNull();
    expect(host.textContent).not.toContain("isn't connected yet");
    await click(card.querySelector<HTMLElement>('[data-confirm-part="approve"]'));
    expect(cardActs).toEqual([{ teamHubCardAct: { conversationId: "c-launch", messageId: "r-zion-m-ask", act: "approve", fingerprint: "fp-zion-1" } }]);
  });

  it("binds Approve to the message and its fingerprint only where a seam is passed", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@ZION set up the packet task", agent_mentions: ["zion"] }),
      reply("zion", "m-ask", "Here is the task I'd create.", { approval })];
    const onApprovalAct = vi.fn();
    const host = await mount({ onApprovalAct });
    await click(rowOf(host, "r-zion-m-ask")!.querySelector<HTMLElement>('[data-confirm-part="approve"]'));
    expect(onApprovalAct).toHaveBeenCalledTimes(1);
    expect(onApprovalAct.mock.calls[0][0]).toMatchObject({ id: "r-zion-m-ask" });
    expect(onApprovalAct.mock.calls[0][1]).toEqual({ kind: "approve", fingerprints: ["fp-zion-1"] });
  });
});

// EXP08 A2b: the card in the asker's DM with an agent, read from `team_hub_card_states` and redeemed by
// the hub itself (`{ teamHubCardAct }` through `paige-ai-chat`, the way it asks its agents). These prove
// what the SCREEN sends and shows for each documented answer; the decide, run and settle are the server's
// (exp08_team_hub_a2b_cards.sql and the card-act unit tests), and the authenticated drive stays UNVERIFIED.
describe("A2b: a Team Hub card, read and redeemed in the asker's DM", () => {
  const REDIRECT = "I can do that with you in our DM.";
  const SUMMARY = "ZION wants to cancel the task “Prepare the onboarding packet”.";
  const EXPIRES = "2026-10-28T15:42:00Z";
  const serverCard = (over: Row = {}) => ({ card: { state: "waiting", kind: "task_cancel", asker_user_id: ME, decided_by_name: null, decided_at: null,
    expires_at: EXPIRES, actions: [{ summary: SUMMARY, fingerprint: "a1b2c3d4e5f60718" }], ...over } });
  const inDm = () => {
    db.conversations.push(agentDm("zion"));
    db.messages["c-dm-zion"] = [msg({ id: "m-ask", author_user_id: ME, body: "Cancel the packet task." }),
      reply("zion", "m-ask", "Here's the cancel. Approve it and I'll do it.")];
  };
  const openDm = async (host: HTMLElement) => click(host.querySelector<HTMLElement>(".th-conv-item--agent[data-ag='zion']"));
  const cardIn = (host: HTMLElement) => rowOf(host, "r-zion-m-ask")!.querySelector<HTMLElement>(".th-ap");
  const cardReads = () => calls.filter((call) => call.name === "team_hub_card_states");

  it("puts the server's card on the agent message it belongs to: kind, summary, expiry as a time, and Approve", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard();
    db.messages["c-launch"].push(msg({ id: "m-q", author_user_id: ME, body: "@ZION how's the week?", agent_mentions: ["zion"] }), reply("zion", "m-q", "Three things are due."));
    const host = await mount();
    expect(rowOf(host, "r-zion-m-q")).not.toBeNull();
    // A channel is never read for cards, even with an agent's reply in it (A2b makes them in agent DMs only).
    expect(cardReads()).toHaveLength(0);
    await openDm(host);
    expect(cardReads().at(-1)!.params).toEqual({ p_expected_tenant: TENANT, p_channel_id: "c-dm-zion", p_message_ids: ["r-zion-m-ask"] });
    const card = cardIn(host)!;
    expect(card.getAttribute("data-ap-state")).toBe("waiting");
    expect(card.querySelector(".th-ap-kind")!.textContent).toBe("Task cancel");
    expect(card.querySelector('[data-confirm-part="summary"]')!.textContent).toBe(SUMMARY);
    expect(card.querySelector('[data-confirm-part="action-note"]')!.textContent).toMatch(/^Expires at .+\.$/);
    expect(card.querySelector('[data-confirm-part="approve"]')).not.toBeNull();
    expect(card.querySelector('[data-confirm-part="refusal"]')).toBeNull();
  });

  it("Approve sends exactly the four keys, reads Running while it runs, then Done with the outcome in the card's thread", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard();
    const pending = deferred();
    cardAnswers.push(pending.answer);
    const host = await mount();
    await openDm(host);
    await click(cardIn(host)!.querySelector<HTMLElement>('[data-confirm-part="approve"]'));
    expect(cardActs).toHaveLength(1);
    expect(Object.keys(cardActs[0])).toEqual(["teamHubCardAct"]);
    expect(cardActs[0].teamHubCardAct).toEqual({ conversationId: "c-dm-zion", messageId: "r-zion-m-ask", act: "approve", fingerprint: "a1b2c3d4e5f60718" });
    // No agent turn is started for it, and nothing says done before the server does.
    expect(turns).toHaveLength(0);
    expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("working");
    expect(cardIn(host)!.querySelector('[data-confirm-part="approve"]')).toBeNull();
    expect(cardIn(host)!.textContent).not.toContain("Done");
    const outcome = msg({ id: "m-out", author_user_id: ME, author_kind: "agent", agent_key: "zion", parent_message_id: "r-zion-m-ask",
      body: "Done. The packet task is cancelled." });
    const done = serverCard({ state: "done", decided_at: "2026-10-28T15:35:00Z", decided_by_name: "Morgan Reyes", actions: [{ summary: SUMMARY }] });
    cardRows["r-zion-m-ask"] = { ...done, outcome_message_id: "m-out" };
    // What the server now holds: the outcome message is a reply in the card's thread.
    db.replies["r-zion-m-ask"] = [outcome];
    Object.assign((db.messages["c-dm-zion"] as Row[])[1], { reply_count: 1, last_reply_at: outcome.created_at });
    await act(async () => pending.resolve({ ok: true, outcome: "done", card: done.card, outcome_message: outcome }));
    await flush();
    const card = cardIn(host)!;
    expect(card.getAttribute("data-ap-state")).toBe("done");
    expect(card.querySelector('[data-confirm-part="approve"]')).toBeNull();
    expect(card.textContent).toContain("Approved by you");
    expect(rowOf(host, "r-zion-m-ask")!.querySelector(".th-replies")!.textContent).toContain("1 reply");
    expect(cardActs).toHaveLength(1);
  });

  it("Not now sends decline, once, and the card settles into Not now", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard();
    const pending = deferred();
    cardAnswers.push(pending.answer);
    const host = await mount();
    await openDm(host);
    const deny = cardIn(host)!.querySelector<HTMLElement>('[data-confirm-part="deny"]')!;
    await click(deny);
    await click(deny);
    expect(cardActs.map((body) => body.teamHubCardAct)).toEqual([{ conversationId: "c-dm-zion", messageId: "r-zion-m-ask", act: "decline", fingerprint: "a1b2c3d4e5f60718" }]);
    const declined = serverCard({ state: "declined", decided_at: "2026-10-28T15:35:00Z", decided_by_name: "Morgan Reyes", actions: [{ summary: SUMMARY }] });
    cardRows["r-zion-m-ask"] = declined;
    await act(async () => pending.resolve({ ok: false, outcome: "declined", card: declined.card, outcome_message: null }));
    await flush();
    expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("declined");
    expect(cardIn(host)!.textContent).toContain("You chose Not now");
    expect(cardIn(host)!.textContent).toContain("Nothing was changed.");
  });

  it("an answer it can't read never says the act ran: the card is read again, and is Couldn't confirm only if that fails too", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard();
    cardAnswers.push({ error: { message: "Edge Function returned a non-2xx status code" } });
    const host = await mount();
    await openDm(host);
    // The read after the failed act fails as well.
    db.override.team_hub_card_states = () => ({ ok: false, code: "unavailable" });
    const before = cardReads().length;
    await click(cardIn(host)!.querySelector<HTMLElement>('[data-confirm-part="approve"]'));
    expect(cardReads().length).toBeGreaterThan(before);
    expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("unconfirmed");
    expect(cardIn(host)!.textContent).toContain("Couldn't confirm it ran");
    expect(cardIn(host)!.textContent).not.toContain("Done");
  });

  for (const [outcome, line] of [["not_yours", "Only the person who asked can approve this card."],
    ["could_not_start", "That didn't go through just now. Try again."],
    ["already_decided", "That card was already decided. It shows what happened."]] as const) {
    it(`a turned-down act is said in words, never silent (verifier fix 5): ${outcome}`, async () => {
      inDm();
      cardRows["r-zion-m-ask"] = serverCard();
      cardAnswers.push({ ok: false, outcome, card: null, outcome_message: null });
      const host = await mount();
      await openDm(host);
      await click(cardIn(host)!.querySelector<HTMLElement>('[data-confirm-part="approve"]'));
      await flush();
      expect(host.querySelector<HTMLElement>(".th-sr[aria-live=polite]")!.textContent).toBe(line);
    });
  }

  it("a done card shows the server's note in the summary's place (compliance fix 2)", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard({ state: "done", decided_at: "2026-10-28T15:35:00Z", decided_by_name: "Morgan Reyes",
      actions: [{ summary: SUMMARY, note: "“Prepare the onboarding packet” is cancelled." }] });
    const host = await mount();
    await openDm(host);
    expect(cardIn(host)!.textContent).toContain("“Prepare the onboarding packet” is cancelled.");
  });

  it("a failed card shows the server's reason (compliance fix 2)", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard({ state: "failed", decided_at: "2026-10-28T15:35:00Z", decided_by_name: "Morgan Reyes",
      actions: [{ summary: SUMMARY, note: "the task changed after I read it" }] });
    const host = await mount();
    await openDm(host);
    expect(cardIn(host)!.textContent).toContain("the task changed after I read it");
  });

  it("the person who did not ask reads Waiting on them, with nothing to press", async () => {
    inDm();
    cardRows["r-zion-m-ask"] = serverCard({ asker_user_id: "u-priya", actions: [{ summary: SUMMARY }] });
    const host = await mount();
    await openDm(host);
    const card = cardIn(host)!;
    expect(card.getAttribute("data-ap-view")).toBe("other");
    expect(card.textContent).toContain("Waiting on Priya");
    expect(card.querySelector('[data-confirm-part="approve"], [data-confirm-part="deny"]')).toBeNull();
  });

  it("shows the card a DM reply carries as soon as the reply posts", async () => {
    db.conversations.push(agentDm("zion"));
    db.messages["c-dm-zion"] = [];
    const host = await mount();
    await openDm(host);
    answers.push(() => Promise.resolve(posted(reply("zion", String(turnBody(0).sourceMessageId), "Here's the cancel.", { id: "r-card" }),
      { intent: "dm", conversation_id: "c-dm-zion", card: { message_id: "r-card" } })));
    cardRows["r-card"] = serverCard();
    await type(composer(host), "Cancel the packet task.");
    await press(composer(host), "Enter");
    await flush();
    expect(cardReads().some((call) => (call.params.p_message_ids as string[]).includes("r-card"))).toBe(true);
    expect(rowOf(host, "r-card")!.querySelector(".th-ap .th-ap-kind")!.textContent).toBe("Task cancel");
  });

  describe("while a card is working", () => {
    let now = 0;
    let intervals: Map<number, { fn: () => void; ms: number; next: number }>;
    const useClock = () => {
      now = Date.parse("2026-10-28T15:30:00Z");
      intervals = new Map();
      let ids = 0;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const realSet = window.setInterval.bind(window);
      const realClear = window.clearInterval.bind(window);
      vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
        if (ms !== CARD_WORKING_POLL_MS && ms !== REFRESH_INTERVAL_MS) return realSet(fn, ms, ...rest);
        ids += 1;
        intervals.set(ids, { fn, ms: ms ?? 0, next: now + (ms ?? 0) });
        return 1_000_000 + ids;
      }) as unknown as typeof window.setInterval);
      vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
        if (id !== undefined && id > 1_000_000) intervals.delete(id - 1_000_000); else realClear(id);
      }) as typeof window.clearInterval);
    };
    const tick = async (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = [...intervals.entries()].filter(([, item]) => item.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        now = due[1].next;
        due[1].next += due[1].ms;
        await act(async () => { due[1].fn(); });
        await flush();
      }
      now = end;
    };
    const working = () => serverCard({ state: "working", decided_at: "2026-10-28T15:29:00Z", decided_by_name: "Morgan Reyes", actions: [{ summary: SUMMARY }] });

    it("re-reads it every 3 s, stops when it settles, and reads the conversation again so the outcome shows", async () => {
      useClock();
      inDm();
      cardRows["r-zion-m-ask"] = working();
      const host = await mount();
      await openDm(host);
      expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("working");
      const start = cardReads().length;
      await tick(CARD_WORKING_POLL_MS);
      expect(cardReads().length).toBe(start + 1);
      // It settles: the next read says done, and the DM is read again for the outcome message.
      cardRows["r-zion-m-ask"] = { ...serverCard({ state: "done", decided_at: "2026-10-28T15:29:00Z", decided_by_name: "Morgan Reyes", actions: [{ summary: SUMMARY }] }) };
      const listsBefore = calls.filter((call) => call.name === "team_hub_list_messages" && call.params.p_channel_id === "c-dm-zion").length;
      await tick(CARD_WORKING_POLL_MS);
      expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("done");
      expect(calls.filter((call) => call.name === "team_hub_list_messages" && call.params.p_channel_id === "c-dm-zion").length).toBeGreaterThan(listsBefore);
      // Nothing is working now, so no more 3 s re-reads (the 15 s refresh, left out here, still reads it).
      for (const [id, item] of intervals) if (item.ms === REFRESH_INTERVAL_MS) intervals.delete(id);
      const settled = cardReads().length;
      await tick(CARD_WORKING_POLL_MS * 3);
      expect(cardReads().length).toBe(settled);
      expect([...intervals.values()].some((item) => item.ms === CARD_WORKING_POLL_MS)).toBe(false);
    });

    it("stops the 3 s re-reads after 2 minutes, even if it is still working", async () => {
      useClock();
      inDm();
      cardRows["r-zion-m-ask"] = working();
      const host = await mount();
      await openDm(host);
      // Past the cap, with the 15 s refresh left out of the count.
      await tick(CARD_WORKING_POLL_MAX_MS + CARD_WORKING_POLL_MS);
      const capped = cardReads().length;
      for (const [id, item] of intervals) if (item.ms === REFRESH_INTERVAL_MS) intervals.delete(id);
      await tick(CARD_WORKING_POLL_MS * 4);
      expect(cardReads().length).toBe(capped);
      expect([...intervals.values()].some((item) => item.ms === CARD_WORKING_POLL_MS)).toBe(false);
      expect(cardIn(host)!.getAttribute("data-ap-state")).toBe("working");
    }, 60_000);
  });

  it("the asker's Open DM sits under a reply that ends with the redirect line, read from the line after a reload, and opens that DM", async () => {
    db.messages["c-launch"] = [msg({ id: "m-ask", author_user_id: ME, body: "@ZION cancel the packet task", agent_mentions: ["zion"] }),
      reply("zion", "m-ask", `Cancelling it means Priya's checklist loses a step, so check that first.\n\n${REDIRECT}`)];
    // A fresh mount is a reload: nothing of this tab's turn is held, only the stored reply.
    const host = await mount();
    const row = rowOf(host, "r-zion-m-ask")!;
    expect(row.textContent).toContain(REDIRECT);
    const open = button(row, "Open DM with ZION")!;
    expect(open).toBeTruthy();
    expect(open.classList.contains("th-btn")).toBe(true);
    expect(open.className).not.toMatch(/act|gold|primary/);
    await click(open);
    expect(calls.find((call) => call.name === "team_hub_open_agent_dm")!.params).toMatchObject({ p_expected_tenant: TENANT, p_agent_key: "zion" });
    expect(host.querySelector(".th-conv-head--agent")!.getAttribute("data-ag")).toBe("zion");
  });

  it("offers no Open DM to anyone else, on a reply without the line, or inside the DM itself", async () => {
    db.conversations.push(agentDm("zion"));
    db.messages["c-launch"] = [msg({ id: "m-q", author_user_id: "u-priya", body: "@ZION cancel the packet task", agent_mentions: ["zion"] }),
      reply("zion", "m-q", `Check Priya's checklist first.\n\n${REDIRECT}`, { author_user_id: "u-priya" }),
      msg({ id: "m-ask", author_user_id: ME, body: "@ZION how's the week?", agent_mentions: ["zion"] }),
      reply("zion", "m-ask", "Three things are due.")];
    db.messages["c-dm-zion"] = [msg({ id: "m-dm", author_user_id: ME, body: "Cancel it." }), reply("zion", "m-dm", `Sure.\n\n${REDIRECT}`)];
    const host = await mount();
    expect(button(host, "Open DM with ZION")).toBeUndefined();
    await openDm(host);
    expect(button(host, "Open DM with ZION")).toBeUndefined();
  });
});
