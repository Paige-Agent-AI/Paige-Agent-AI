/**
 * C4c — PAIGE asks, waits, and the SAME objective resumes on the answer (frozen prototype frames
 * c1–c6, docs/design-references/prototypes/paige-turn-states-c3.html). What a person SEES and what is
 * SENT, live and on reload: the question in place with its choices (ink, never gold); the composer
 * saying it is answering — and how to say something else instead; the answer sent WITH the question's
 * id only when it is one; a skip hidden like a decision sentence; the question frozen once answered or
 * moved past; a refused answer put back, never re-sent as something else.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  threads: [] as Array<{ id: string; title: string; updated_at: string }>,
  turns: [] as Array<Record<string, unknown>>,
  // A fresh workspace per case: composer drafts live in a module-level store keyed by scope.
  tenant: "account-0",
  /** The props the Live surface was last given — so a case can drive a voice interruption. */
  live: null as null | { onVoiceInterrupt: () => void },
  toast: vi.fn(),
  loadTurns: vi.fn(),
  /** The composer's attached file, when a case attaches one. */
  attachedDoc: null as null | { name: string; type: string; size: number },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenant, activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: harness.attachedDoc, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: harness.threads, isLoading: false, isFetched: true,
    loadTurns: harness.loadTurns, ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { onVoiceInterrupt: () => void }) => { harness.live = props; return null; },
}));
vi.mock("@/components/chat/PaigeCrmResultCard", () => ({
  PaigeCrmResultCard: ({ result }: { result: unknown }) => <div data-testid="crm">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({
  PaigeResearchCard: ({ result }: { result: unknown }) => <div data-testid="research">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/chat/MessageAudioButton", () => ({ MessageAudioButton: () => <button type="button" data-testid="listen">Listen</button> }));

import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";
import { supabase } from "@/integrations/supabase/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const turn = (event: string, state: string, mode: string) => frame({ paige_turn: { v: 1, event, state, mode } });
const step = (id: string, seq: number, label: string, status?: string, extra: Record<string, unknown> = {}) =>
  frame({ paige_step: { id, seq, round: 1, kind: "action", label, group: "owner", ...(status ? { status } : {}), ...extra } });
const DONE = "data: [DONE]\n\n";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
type Chunk = string | Promise<unknown>;
const body = (chunks: Chunk[]) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          while (i < chunks.length && chunks[i] instanceof Promise) await chunks[i++];
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: enc.encode(chunks[i++] as string) };
        },
        releaseLock() {},
        async cancel() {},
      };
    },
  },
});
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

type Reply = ReturnType<typeof body> | { ok: false; status: number; json: () => Promise<unknown>; clone: () => { json: () => Promise<unknown> } };
function server(...replies: Reply[]) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; approvedConfirmations?: string[]; declinedConfirmations?: string[]; resume?: { kind: string; ask_id: string; skipped?: boolean }; threadId?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const reply = replies[bodies.length - 1] ?? body([say("Okay."), DONE]);
    return reply;
  }));
  return bodies;
}

const mounted: Array<() => Promise<void>> = [];
beforeEach(() => {
  harness.threads = [];
  harness.turns = [];
  harness.toast = vi.fn();
  harness.loadTurns = vi.fn(async () => harness.turns);
  harness.attachedDoc = null;
  harness.tenant = `account-${Math.random().toString(36).slice(2)}`;
  // Composer drafts persist per scope; every case starts from an empty one.
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
});

let lastRoot: ReturnType<typeof createRoot> | null = null;
async function mount(extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  lastRoot = root;
  await act(async () => {
    root.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety {...extra} />);
    await flush();
  });
  mounted.push(async () => { await act(async () => { root.unmount(); }); host.remove(); });
  for (let attempt = 0; attempt < 6 && host.querySelector("textarea")!.disabled; attempt += 1) await act(async () => flush());
  return host;
}

async function ask(host: HTMLElement, text = "Who hasn't heard from us in two weeks?") {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  await act(async () => { send.click(); await flush(); });
}


const lines = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("[data-paige-turn-line]"));
const lineText = (el: HTMLElement | null | undefined) => el?.querySelector(".ptl-text")?.textContent ?? null;
const textarea = (host: HTMLElement) => host.querySelector("textarea")!;
async function type(host: HTMLElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea(host), text);
    textarea(host).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(host: HTMLElement, text: string) {
  await type(host, text);
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(); await flush(); });
  await act(async () => { await flush(); });
}
const button = (host: HTMLElement, label: RegExp) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => label.test(b.textContent ?? "")) ?? null;
const hint = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-paige-answering]");
const record = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-paige-ask-record]");
const userBubbles = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("[data-paige-message-id]"))
  .filter((el) => el.className.includes("flex-row-reverse")).map((el) => el.textContent ?? "");

const ASK_ID = "a5a5a5a5-1111-4222-8333-444444444444";
const QUESTION = "Kestrel signed a 14-person engagement but didn't pick a start. Which start should I build?";
const OPTIONS = [
  { label: "Full kickoff", value: "full_kickoff", description: "90-minute workshop plus the intake form" },
  { label: "Light start", value: "light_start", description: "Intake form now, kickoff next month" },
  { label: "Mirror Lumen Freight", value: "mirror_lumen", description: "Copy the onboarding you ran for Lumen Freight" },
];
const asks = (options: typeof OPTIONS | [] = OPTIONS, prompt = QUESTION) => body([
  turn("started", "WORKING", "pending"), step("a", 1, "Read The Kestrel Group's agreement", "done"),
  turn("waiting", "ASK_USER", "clarify"),
  frame({ paige_choices: { prompt, options, multi: false, allow_other: true, ask_id: ASK_ID } }), DONE,
]);
const continues = (text = "Got it — building the light start.") => body([
  turn("started", "WORKING", "pending"), turn("resumed", "WORKING", "pending"),
  step("b", 1, "Created the intake form", "done"), turn("completed", "FINAL", "build"), say(text), DONE,
]);
const refusal = (code: string) => ({
  ok: false as const, status: code === "ASK_ANSWER_UNAVAILABLE" ? 503 : 409,
  json: async () => ({ code, error: "x", reason: code === "ASK_ALREADY_ANSWERED" ? "PAIGE already has your answer to that question, so this wasn't sent again." : "That question isn't open any more, so your message wasn't sent as an answer." }),
  clone() { return { json: this.json }; },
});

describe("C4c — c2: PAIGE asks, and the question waits in place", () => {
  it("a bounded choice: her question, three options, nothing picked, Use this unavailable until a pick — ink, never gold", async () => {
    server(asks());
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    expect(host.textContent).toContain(QUESTION);
    const options = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-paige-ask-option]"));
    expect(options.map((o) => o.getAttribute("role"))).toEqual(["radio", "radio", "radio"]);
    expect(options.every((o) => o.getAttribute("aria-checked") === "false")).toBe(true);
    const use = host.querySelector<HTMLButtonElement>("[data-paige-ask-submit]")!;
    expect(use.getAttribute("aria-disabled")).toBe("true");
    expect(use.className).not.toMatch(/gold/);
    expect(host.querySelector("[data-paige-ask]")!.querySelector("[class*='gold']")).toBeNull();
    expect(lineText(lines(host).at(-1))).toBe("Your call");
    expect(lines(host).at(-1)!.dataset.kind).toBe("wait");
    // The composer says it is answering, and how to say something else instead.
    expect(hint(host)!.dataset.paigeAnswering).toBe("answer");
    expect(hint(host)!.textContent).toContain("PAIGE is waiting on your answer above");
    expect(textarea(host).placeholder).toBe("Or type your own answer…");
  });

  it("a free-form question: no card, the composer takes the answer in their own words", async () => {
    server(asks([], "Kestrel signed but didn't pick a start date. When should the onboarding start?"));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    expect(host.querySelector("[data-paige-ask]")).toBeNull();
    expect(textarea(host).placeholder).toBe("Type your answer…");
    expect(hint(host)!.dataset.paigeAnswering).toBe("answer");
  });
});

describe("C4c — c3: the answer is the person speaking, and the same work picks back up", () => {
  it("a picked option is sent as their reply WITH the question's id; the question freezes 'Answered below'; one continuation, never drawn as an approval", async () => {
    const bodies = server(asks(), continues());
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    const light = host.querySelectorAll<HTMLButtonElement>("[data-paige-ask-option]")[1];
    await act(async () => { light.click(); });
    expect(light.getAttribute("aria-checked")).toBe("true");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-paige-ask-submit]")!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: "user", content: "Light start — intake form now, kickoff next month" });
    expect(bodies[1].approvedConfirmations).toBeUndefined();
    for (const m of bodies[1].messages as Array<Record<string, unknown>>) { expect(m).not.toHaveProperty("ask"); expect(m).not.toHaveProperty("answer"); }
    expect(userBubbles(host).at(-1)).toContain("Light start — intake form now, kickoff next month");
    expect(record(host)!.dataset.paigeAskRecord).toBe("answered");
    expect(record(host)!.textContent).toBe("Answered below");
    expect(host.querySelector("[data-paige-ask]")).toBeNull(); // nothing left to press twice
    expect(host.querySelector('[data-paige-continues="resumed"]')).toBeNull(); // an answer is not an approval
    expect(lines(host).map(lineText)).toEqual(["What PAIGE did · 1 step", "What PAIGE did · 1 step"]);
    expect(host.textContent).toContain("Got it — building the light start.");
    expect(host.textContent).not.toMatch(/Approved\. PAIGE is working|starting over/i);
    expect(hint(host)).toBeNull();
  });

  it("while the answer is carried forward the line says PAIGE is working — never 'Approved'", async () => {
    const hold = deferred();
    server(asks([], "When should the onboarding start?"), body([
      turn("started", "WORKING", "pending"), turn("resumed", "WORKING", "pending"),
      step("b", 1, "Creating the intake form", "running"), hold.promise,
      step("b", 1, "Created the intake form", "done"), turn("completed", "FINAL", "build"), say("Ready."), DONE,
    ]));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); await flush(); });
    expect(lineText(lines(host).at(-1))).toBe("Creating the intake form");
    expect(host.textContent).not.toMatch(/Approved/);
    expect(host.querySelector("[data-paige-turn-announcer]")?.textContent ?? "").toMatch(/PAIGE is working/);
    await act(async () => { hold.resolve(); await flush(); });
  });

  it("typed words while answering are the answer, as written", async () => {
    const bodies = server(asks([], "When should the onboarding start?"), continues("Got it — starting November 1."));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    expect(bodies[1].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(bodies[1].messages.at(-1)!.content).toBe("Start it November 1.");
    expect(userBubbles(host).at(-1)).toContain("Start it November 1.");
  });

  it("Use this is pressed once: the card is gone the moment the answer is sent (no double send)", async () => {
    const hold = deferred();
    const bodies = server(asks(), body([turn("started", "WORKING", "pending"), turn("resumed", "WORKING", "pending"), hold.promise, turn("completed", "FINAL", "answer"), say("Done."), DONE]));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await act(async () => { host.querySelectorAll<HTMLButtonElement>("[data-paige-ask-option]")[0].click(); });
    const use = host.querySelector<HTMLButtonElement>("[data-paige-ask-submit]")!;
    await act(async () => { use.click(); use.click(); await flush(); });
    expect(bodies).toHaveLength(2);
    expect(host.querySelector("[data-paige-ask-submit]")).toBeNull();
    await act(async () => { hold.resolve(); await flush(); });
  });
});

describe("C4c — c5 / c6: saying something else, or letting PAIGE choose", () => {
  it("'Ask something else instead' sends an ordinary message: no resume, and the question stays 'Not answered'", async () => {
    const bodies = server(asks(), body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Two sessions tomorrow."), DONE]));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await act(async () => { button(host, /Ask something else instead/)!.click(); });
    expect(hint(host)!.dataset.paigeAnswering).toBe("new");
    expect(textarea(host).placeholder).not.toMatch(/answer/i);
    await send(host, "Actually — who's on my calendar tomorrow?");
    expect(bodies[1].resume).toBeUndefined();
    expect(record(host)!.dataset.paigeAskRecord).toBe("unanswered");
    expect(record(host)!.textContent).toBe("Not answered");
    expect(lineText(lines(host)[0])).toBe("Question not answered");
  });

  it("'Skip, use your best guess' is an answer marked skipped, its sentence hidden; the question reads 'You let PAIGE choose'", async () => {
    const bodies = server(asks(), continues("I'll go with the light start — it's the lightest lift."));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await act(async () => { button(host, /Skip, use your best guess/)!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies[1].resume).toEqual({ kind: "answer", ask_id: ASK_ID, skipped: true });
    expect(bodies[1].messages.at(-1)!.content).toBe("Use your best guess.");
    expect(host.textContent).not.toContain("Use your best guess.");
    expect(record(host)!.textContent).toBe("You let PAIGE choose");
  });
});

describe("C4c — a refused answer is put back, never re-sent as something else", () => {
  it("already answered (another tab): the message comes back, the server's sentence is said, the thread is re-read", async () => {
    const bodies = server(asks([], "When should the onboarding start?"), refusal("ASK_ALREADY_ANSWERED"));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: "When should the onboarding start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: ASK_ID, question: "When should the onboarding start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: null } } },
      { id: "u2", role: "user", content: "November 1", bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
      { id: "a2", role: "assistant", content: "Got it — November 1.", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "answer", rounds: 1, tools: 0, resumed: { kind: "answer" } }, paige_resume: { kind: "answer", from_turn_id: null, outcomes: [] } } },
    ];
    await send(host, "Start it November 1.");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].resume?.ask_id).toBe(ASK_ID);
    expect(textarea(host).value).toBe("Start it November 1."); // back in the box
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "PAIGE already has your answer to that question, so this wasn't sent again. Your message is back in the box." }));
    expect(harness.loadTurns).toHaveBeenCalledWith("thread-a");
    expect(host.textContent).toContain("Got it — November 1.");
    expect(record(host)!.textContent).toBe("Answered below");
    expect(hint(host)).toBeNull();
  });

  it("no longer open: nothing is sent again by itself; the words stay for the person to send as a new message", async () => {
    const bodies = server(asks([], "When should the onboarding start?"), refusal("ASK_NOT_OPEN"));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    expect(bodies).toHaveLength(2);
    expect(textarea(host).value).toBe("Start it November 1.");
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("isn't open any more") }));
  });
});

describe("C4c — an answer that never reached PAIGE comes back as the same question, asked again", () => {
  const ASK_AGAIN = "b6b6b6b6-1111-4222-8333-444444444444";
  const REASON = "PAIGE couldn't carry on from your answer, so nothing was done with it yet. She's asked the question again.";
  const reopened = (status: number) => ({
    ok: false as const, status,
    json: async () => ({ code: "ASK_REOPENED", cause_code: status === 429 ? null : "chat_unavailable", error: REASON, reason: REASON, ask_reopened: { prompt: "When should the onboarding start?", options: [], multi: false, allow_other: true, ask_id: ASK_AGAIN } }),
    clone() { return { json: this.json }; },
  });
  const savedTurns = () => [
    { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
    { id: "q1", role: "assistant", content: "When should the onboarding start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: ASK_ID, question: "When should the onboarding start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: null } } },
    { id: "u2", role: "user", content: "Start it November 1.", bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
    { id: "q2", role: "assistant", content: "I couldn't carry on from your answer, so nothing was done with it yet.\n\nWhen should the onboarding start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 0, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: ASK_AGAIN, question: "When should the onboarding start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: null, reopens: ASK_ID } } },
  ];

  for (const status of [500, 429]) {
    it(`PAIGE was not reached (${status}): the words come back, the server's sentence is said, the thread is re-read — the question is open again and the next send answers the NEW id`, async () => {
      const bodies = server(asks([], "When should the onboarding start?"), reopened(status));
      const host = await mount();
      await send(host, "Set up onboarding for Kestrel.");
      harness.turns = savedTurns();
      await send(host, "Start it November 1.");
      expect(bodies).toHaveLength(2);
      expect(bodies[1].resume?.ask_id).toBe(ASK_ID);
      expect(textarea(host).value).toBe("Start it November 1."); // back in the box, never re-sent by itself
      expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PAIGE asked again", description: `${REASON} Your message is back in the box.` }));
      expect(harness.loadTurns).toHaveBeenCalledWith("thread-a");
      expect(host.textContent).toContain("I couldn't carry on from your answer");
      expect(hint(host)?.dataset.paigeAnswering).toBe("answer");
      expect(button(host, /^Retry$/)).toBeNull(); // no retry of the old question's id
      await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(); await flush(); });
      await act(async () => { await flush(); });
      expect(bodies).toHaveLength(3);
      expect(bodies[2].resume?.ask_id).toBe(ASK_AGAIN);
    });
  }

  it("still with PAIGE (a claim younger than any request): the words come back, the server's 'may still be working' is said, the thread is re-read — nothing re-sent", async () => {
    const reason = "PAIGE already has your answer to that question and may still be working on it, so this wasn't sent again. If she hasn't replied 10 minutes after you sent it, send it again and she'll ask the question again.";
    const bodies = server(asks([], "When should the onboarding start?"), { ok: false as const, status: 409, json: async () => ({ code: "ASK_ANSWER_IN_PROGRESS", error: reason, reason }), clone() { return { json: this.json }; } });
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    expect(bodies).toHaveLength(2);
    expect(textarea(host).value).toBe("Start it November 1.");
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("may still be working") }));
    expect(harness.loadTurns).toHaveBeenCalledWith("thread-a");
  });
});

describe("C4c — an answer claimed with nothing after it keeps the composer bound to its question (re-verifier 2, V2-1)", () => {
  const IN_PROGRESS = "PAIGE already has your answer to that question and may still be working on it, so this wasn't sent again. If she hasn't replied 10 minutes after you sent it, send it again and she'll ask the question again.";
  const inProgress = () => ({ ok: false as const, status: 409, json: async () => ({ code: "ASK_ANSWER_IN_PROGRESS", error: IN_PROGRESS, reason: IN_PROGRESS }), clone() { return { json: this.json }; } });
  const ASK_AGAIN = "b6b6b6b6-1111-4222-8333-444444444444";
  const REOPENED = "PAIGE couldn't carry on from your answer, so nothing was done with it yet. She's asked the question again.";
  const reopened = () => ({ ok: false as const, status: 409, json: async () => ({ code: "ASK_REOPENED", error: REOPENED, reason: REOPENED, ask_reopened: { prompt: "When should the onboarding start?", options: [], multi: false, allow_other: true, ask_id: ASK_AGAIN } }), clone() { return { json: this.json }; } });
  const question = { id: "q1", role: "assistant", content: "When should the onboarding start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 1, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: ASK_ID, question: "When should the onboarding start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: null } } };
  const claim = { id: "u2", role: "user", content: "Start it November 1.", bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } };
  const claimedTurns = () => [{ id: "u1", role: "user", content: "Set up onboarding for Kestrel." }, question, claim];

  it("'may still be working' → the thread is re-read → sending again names the SAME question (resume), and keeps naming it until the server asks again", async () => {
    const bodies = server(asks([], "When should the onboarding start?"), inProgress(), inProgress(), reopened());
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    harness.turns = claimedTurns();
    await send(host, "Start it November 1.");
    expect(bodies[1].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("Your message is back in the box.") }));
    // The re-read thread ends on the claim: the question is frozen as answered, the composer stays bound.
    expect(record(host)!.textContent).toBe("Answered below");
    expect(hint(host)!.dataset.paigeAnswering).toBe("claimed");
    expect(hint(host)!.textContent).toContain("PAIGE has your answer. If she hasn't replied 10 minutes after you sent it, send it again and she'll ask her question again");
    expect(textarea(host).placeholder).toBe("Send your answer again…");
    expect(textarea(host).value).toBe("Start it November 1.");
    // Sent again inside the window: still the answer to THAT question — never an unbound message.
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies).toHaveLength(3);
    expect(bodies[2].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    // …and once the server asks the question again, the re-read thread holds it open and the next send answers the NEW id.
    harness.turns = [...claimedTurns(), { id: "q2", role: "assistant", content: "I couldn't carry on from your answer, so nothing was done with it yet.\n\nWhen should the onboarding start?", bundle_ref: { turn_state: { v: 1, state: "ASK_USER", mode: "clarify", rounds: 0, tools: 0, waiting_on: { kind: "choice" } }, paige_ask: { v: 1, ask_id: ASK_AGAIN, question: "When should the onboarding start?", options: [], multi: false, allow_other: true, needs: "the start date", objective: null, reopens: ASK_ID } } }];
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies[3].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(hint(host)!.dataset.paigeAnswering).toBe("answer");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies[4].resume).toEqual({ kind: "answer", ask_id: ASK_AGAIN });
  });

  it("on reload, a claim with nothing after it binds the composer: the send carries its question's id; 'Ask something else instead' sends an ordinary message", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = claimedTurns();
    const bodies = server(inProgress(), body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Two sessions."), DONE]));
    const host = await mount();
    await act(async () => { await flush(); });
    expect(hint(host)!.dataset.paigeAnswering).toBe("claimed");
    expect(host.querySelector("[data-paige-ask]")).toBeNull(); // the card stays frozen; only the composer binds
    await send(host, "Start it November 1.");
    expect(bodies[0].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(bodies[0].threadId).toBe("thread-k");
    await act(async () => { button(host, /Ask something else instead/)!.click(); });
    expect(hint(host)!.dataset.paigeAnswering).toBe("new");
    expect(hint(host)!.textContent).toContain("Sending as a new message");
    expect(hint(host)!.textContent).not.toContain("stays unanswered");
    await send(host, "Who's on my calendar tomorrow?");
    expect(bodies[1].resume).toBeUndefined();
  });

  it("a claim for ANOTHER question never binds the composer, and never answers this one ('Not answered')", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [{ id: "u1", role: "user", content: "Set up onboarding for Kestrel." }, question,
      { ...claim, bundle_ref: { paige_resume: { kind: "answer", key: "answer:c7c7c7c7-1111-4222-8333-444444444444", from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } }];
    const bodies = server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(record(host)!.textContent).toBe("Not answered");
    expect(hint(host)).toBeNull();
    await send(host, "Start it November 1.");
    expect(bodies[0].resume).toBeUndefined();
  });
});

describe("C4c — a connection retry of an answer keeps it the answer (re-verifier 2, N2)", () => {
  it("a 5xx with no answer code offers Retry, and Retry sends the same words WITH the question's id", async () => {
    const bodies = server(asks([], "When should the onboarding start?"), { ok: false as const, status: 500, json: async () => ({ error: "Something went wrong", reason: "Something went wrong on our side." }), clone() { return { json: this.json }; } }, continues());
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    expect(bodies[1].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    const retry = button(host, /^Retry$/)!;
    expect(retry).not.toBeNull();
    await act(async () => { retry.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies).toHaveLength(3);
    expect(bodies[2].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(bodies[2].messages.at(-1)!.content).toBe("Start it November 1.");
  });
});

describe("C4c — what the refusal says about the person's words is true (re-verifier 2, V2-3)", () => {
  it("another message reached PAIGE first: the answer is kept in the conversation, so it leaves the composer — never 'send it as a new message'", async () => {
    const KEPT = "Another message reached PAIGE before your answer, so she didn't act on it and her question stays unanswered. Your answer is kept in the conversation.";
    const bodies = server(asks([], "When should the onboarding start?"), { ok: false as const, status: 409, json: async () => ({ code: "ASK_NOT_OPEN", answer_kept: true, error: KEPT, reason: KEPT }), clone() { return { json: this.json }; } });
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await send(host, "Start it November 1.");
    expect(bodies).toHaveLength(2);
    expect(textarea(host).value).toBe("");
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Another message came first", description: KEPT }));
  });

  it("a choice made on the card and refused is not said to be 'back in the box' (it never was there)", async () => {
    const NOT_OPEN = "That question isn't open any more, so your message wasn't sent as an answer.";
    server(asks(), { ok: false as const, status: 409, json: async () => ({ code: "ASK_NOT_OPEN", error: NOT_OPEN, reason: NOT_OPEN }), clone() { return { json: this.json }; } });
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    await act(async () => { host.querySelectorAll<HTMLButtonElement>("[data-paige-ask-option]")[1].click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-paige-ask-submit]")!.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ description: NOT_OPEN }));
  });
});

describe("C4c — a file is never sent as an answer, and the composer says so", () => {
  it("with a file attached while her question is open: the line says the file goes as a new message, and offers no switch", async () => {
    server(asks([], "When should the onboarding start?"));
    const host = await mount();
    await send(host, "Set up onboarding for Kestrel.");
    expect(hint(host)?.dataset.paigeAnswering).toBe("answer");
    harness.attachedDoc = { name: "kestrel-agreement.pdf", type: "application/pdf", size: 1200 };
    await act(async () => { lastRoot!.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />); await flush(); });
    expect(hint(host)?.dataset.paigeAnswering).toBe("new");
    expect(hint(host)?.textContent).toContain("Your file goes as a new message — her question stays unanswered");
    expect(button(host, /Ask something else instead|Answer her question/)).toBeNull();
  });
});

describe("C4c — reload: what was asked and what was said read back the same", () => {
  const askBundle = (state = "ASK_USER") => ({
    turn_state: { v: 1, state, mode: "clarify", rounds: 1, tools: 1, ...(state === "ASK_USER" ? { waiting_on: { kind: "choice" } } : {}) },
    turn_trace: [{ label: "Read The Kestrel Group's agreement", group: "client", status: "done" }],
    paige_ask: { v: 1, ask_id: ASK_ID, question: QUESTION, options: OPTIONS, multi: false, allow_other: true, needs: "which start", objective: "Setting up Kestrel's onboarding" },
  });

  it("before the answer: the question is open again — its choices, 'Your call', the composer answering it — and the answer carries the SAVED id", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: QUESTION, bundle_ref: askBundle() },
    ];
    const bodies = server(continues());
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.querySelectorAll("[data-paige-ask-option]")).toHaveLength(3);
    expect(lineText(lines(host)[0])).toBe("Your call");
    expect(hint(host)!.dataset.paigeAnswering).toBe("answer");
    await send(host, "Light start");
    expect(bodies[0].resume).toEqual({ kind: "answer", ask_id: ASK_ID });
    expect(bodies[0].threadId).toBe("thread-k");
  });

  it("after the answer: answered in place, their reply as written, PAIGE's continuation as its own answer — no card, the composer free", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: QUESTION, bundle_ref: askBundle() },
      { id: "u2", role: "user", content: "Light start — intake form now, kickoff next month", bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } } },
      { id: "a2", role: "assistant", content: "The intake form is ready.", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "build", rounds: 1, tools: 1, resumed: { kind: "answer" } }, turn_trace: [{ label: "Created the intake form", group: "client", status: "done" }], paige_resume: { kind: "answer", from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", outcomes: [] } } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-paige-ask]")).toBeNull();
    expect(record(host)!.textContent).toBe("Answered below");
    expect(userBubbles(host).at(-1)).toContain("Light start — intake form now, kickoff next month");
    expect(lines(host).map(lineText)).toEqual(["What PAIGE did · 1 step", "What PAIGE did · 1 step"]);
    expect(host.querySelector('[data-paige-continues="resumed"]')).toBeNull();
    expect(hint(host)).toBeNull();
  });

  it("after a skip: the sentence stays hidden and the question reads 'You let PAIGE choose'", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: QUESTION, bundle_ref: askBundle() },
      { id: "u2", role: "user", content: "Use your best guess.", bundle_ref: { paige_resume: { kind: "answer", key: `answer:${ASK_ID}`, from_turn_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a", skipped: true } } },
      { id: "a2", role: "assistant", content: "I'll go with the light start.", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "answer", rounds: 1, tools: 0, resumed: { kind: "answer" } } } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.textContent).not.toContain("Use your best guess.");
    expect(record(host)!.textContent).toBe("You let PAIGE choose");
  });

  it("moved past: an ordinary message after it leaves the question 'Not answered' — never answered for them", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: QUESTION, bundle_ref: askBundle() },
      { id: "u2", role: "user", content: "Actually — who's on my calendar tomorrow?" },
      { id: "a2", role: "assistant", content: "Two sessions.", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 } } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(record(host)!.textContent).toBe("Not answered");
    expect(lineText(lines(host)[0])).toBe("Question not answered");
    expect(host.querySelector("[data-paige-ask]")).toBeNull();
  });

  it("a saved question outside its record draws no card (never a guess)", async () => {
    harness.threads = [{ id: "thread-k", title: "Kestrel", updated_at: "2026-10-05T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Set up onboarding for Kestrel." },
      { id: "q1", role: "assistant", content: QUESTION, bundle_ref: { ...askBundle(), paige_ask: { v: 9, ask_id: ASK_ID, question: QUESTION, options: OPTIONS } } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-paige-ask]")).toBeNull();
    expect(hint(host)).toBeNull();
  });
});
