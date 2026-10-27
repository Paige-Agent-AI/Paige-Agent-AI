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
import { TeamHubWorkspace } from "./TeamHubWorkspace";

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
        parent_message_id: params.p_parent_message_id ?? null, agent_mentions: params.p_agent_mention_keys ?? [] });
      if (params.p_parent_message_id) (db.replies[String(params.p_parent_message_id)] ??= []).push(message);
      else (db.messages[String(params.p_channel_id)] ??= []).push(message);
      return { ok: true, duplicate: false, message };
    }
    case "team_hub_agent_turn_states": {
      // A double of the read's contract (proved in exp08_team_hub_agent_turn_states.sql): the asker reads
      // every state of their own questions; anyone else only the two private-part lines and who a reply
      // suggested bringing in, without the line of context.
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
          const approved = fact.private_part === true && (fact.state === "answering" || fact.state === "replied_privately");
          if (!mine && !approved && !bring) continue;
          states.push({ message_id: id, agent_key: key, state: mine || approved ? fact.state : "replied", private_part: fact.private_part,
            asker_name: fact.asker_name, ...(bring ? { bring_in: bring } : {}) });
        }
      }
      return { ok: true, states };
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
async function mount(props: { openPaige?: () => void; onOpenTeamSettings?: () => void } = {}) {
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

  it("a question asked moments ago with no turn yet (another tab is starting it) says only that it may still be coming, with Check again", async () => {
    db.messages["c-launch"] = [mine({ created_at: new Date(Date.now() - 20_000).toISOString() })];
    const host = await mount();
    expect(rowOf(host, "m-mine")!.querySelector(".th-ag-fail")!.textContent).toBe("MENTOR may still be replying.Check again");
    answers.push(posted(reply("mentor", "m-mine", "Paid, with a free first session.")));
    await click(button(rowOf(host, "m-mine")!, "Check again"));
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
    expect(Array.from(box.querySelectorAll(".th-pop-head")).map((item) => item.textContent)).toEqual(["People in this conversation", "Your Paige team"]);
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
