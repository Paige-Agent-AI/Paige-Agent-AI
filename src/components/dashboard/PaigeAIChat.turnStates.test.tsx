/**
 * C3a — the living turn states in the Solo PAIGE chat, driven frame by frame from scripted SSE
 * bodies (paige_turn + paige_step running/done/error/withdrawn). Each `it` names the owner's
 * pre-merge proof it carries (docs/delivery/paige-conversational-loop-c3.md §Proof):
 *  (1) a fast answer has no status/trace chrome;
 *  (2) a tool-backed answer evolves IN PLACE from truthful state;
 *  (3) running/done/error rows correspond to actual server events;
 *  (4) reload reconstructs the same "What PAIGE did";
 *  (5) approval hides the synthetic bubble without corrupting canonical history;
 *  (6) nothing implies C4 resume behaviour;
 *  (9) no chain-of-thought is exposed.
 * Everything here asserts what a person SEES and what is SENT — never how the loop is written.
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
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenant, activeTenant: { account_number: "42" } }),
}));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">mic</button> }));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: null, isDragOver: false, fileInputRef: { current: null }, acceptString: ".pdf",
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
    loadTurns: vi.fn(async () => harness.turns), ensureThread: vi.fn(async () => "thread-a"),
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

function server(...replies: Array<ReturnType<typeof body>>) {
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; approvedConfirmations?: string[]; declinedConfirmations?: string[] }> = [];
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
const lastLine = (host: HTMLElement) => lines(host).at(-1) ?? null;
const lineText = (el: HTMLElement | null) => el?.querySelector(".ptl-text")?.textContent ?? null;
const rowsOf = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll<HTMLElement>("[data-paige-turn-step]") ?? []).map((r) => [r.textContent?.replace(/^(In progress|Done|Problem|Stopped): /, ""), r.dataset.status]);
const openTrace = async (el: HTMLElement) => {
  const btn = el.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (btn && btn.getAttribute("aria-expanded") === "false") await act(async () => { btn.click(); });
};
const C4_LANGUAGE = /resum|pick(ing)? (this|it) back up|keep going|same answer/i;

describe("C3a — proof (1): a fast answer has no status or trace chrome", () => {
  it("draws no line before, during or after a fast answer", async () => {
    const hold = deferred();
    server(body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Try this: “Your next 90 days”."), hold.promise, DONE]));
    const host = await mount();
    await ask(host);
    expect(lines(host)).toHaveLength(0);
    await act(async () => { hold.resolve(); await flush(); });
    expect(host.textContent).toContain("Your next 90 days");
    expect(lines(host)).toHaveLength(0);
    expect(host.textContent).not.toMatch(/What PAIGE did|Thinking/);
    expect(host.textContent).not.toMatch(C4_LANGUAGE);
  });
});

describe("C3a — proof (1): the 400 ms gate comes before every working label", () => {
  // Held (protected) answers, Live and document turns send `paige_phase: "writing"` BEFORE their
  // terminal. A fast answer that does so must still draw nothing — not a flash of "Writing".
  it("a writing marker inside the gate, then a fast terminal, draws nothing at any point", async () => {
    const hold = deferred();
    server(body([frame({ paige_phase: "writing" }), turn("completed", "FINAL", "fast_answer"), say("Hi."), hold.promise, DONE]));
    const host = await mount();
    await ask(host, "hi");
    expect(lines(host)).toHaveLength(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(lines(host)).toHaveLength(0);
    await act(async () => { hold.resolve(); await flush(); });
    expect(lines(host)).toHaveLength(0);
    expect(host.textContent).toContain("Hi.");
  });

  it("a writing marker inside the gate on an ordinary answer waits for the gate, then says Writing", async () => {
    const hold = deferred();
    server(body([frame({ paige_phase: "writing" }), hold.promise, turn("completed", "FINAL", "answer"), say("Long answer."), DONE]));
    const host = await mount();
    await ask(host, "explain");
    expect(lines(host)).toHaveLength(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(lineText(lastLine(host))).toBe("Writing the answer");
    await act(async () => { hold.resolve(); await flush(); });
  });
});

describe("C3a — proof (2)/(3): a tool-backed answer evolves in place from real step events", () => {
  it("one line node goes running → running → writing → What PAIGE did, and its rows match the frames", async () => {
    const a = deferred();
    const b = deferred();
    const c = deferred();
    server(body([
      turn("started", "WORKING", "pending"),
      step("a:1:0", 1, "Looking through your contacts", "running"),
      a.promise,
      step("a:1:0", 1, "Looked through your contacts", "done", { detail: "41 contacts" }),
      step("a:1:1", 2, "Reviewing your pipeline", "running"),
      step("a:1:2", 3, "Checking your calendar", "running"),
      step("a:1:2", 3, "Checking your calendar", "withdrawn"),
      b.promise,
      step("a:1:1", 2, "Reviewed your pipeline", "done"),
      step("a:2:0", 4, "Checking your calendar for booked sessions", "error", { detail: "Calendar isn't connected — skipped" }),
      turn("completed", "FINAL", "action"),
      c.promise,
      say("Three clients haven't heard from you."),
      DONE,
    ]));
    const host = await mount();
    await ask(host);
    const node = lastLine(host)!;
    expect(node).not.toBeNull();
    expect(lineText(node)).toBe("Looking through your contacts");
    expect(node.dataset.kind).toBe("work");

    await act(async () => { a.resolve(); await flush(); });
    expect(lastLine(host)).toBe(node);
    expect(lineText(node)).toBe("Reviewing your pipeline");
    await openTrace(node);
    expect(rowsOf(node)).toEqual([
      ["Looked through your contactsOwner Ops · 41 contacts", "done"],
      ["Reviewing your pipelineOwner Ops", "running"],
    ]);

    await act(async () => { b.resolve(); await flush(); });
    expect(lastLine(host)).toBe(node);
    expect(lineText(node)).toBe("Writing the answer");

    await act(async () => { c.resolve(); await flush(); });
    expect(lastLine(host)).toBe(node);
    expect(node.isConnected).toBe(true);
    expect(node.dataset.kind).toBe("done");
    expect(lineText(node)).toBe("What PAIGE did · 3 steps");
    expect(rowsOf(node)).toEqual([
      ["Looked through your contactsOwner Ops · 41 contacts", "done"],
      ["Reviewed your pipelineOwner Ops", "done"],
      ["Checking your calendar for booked sessionsOwner Ops · Calendar isn't connected — skipped", "error"],
    ]);
    expect(host.textContent).toContain("Three clients haven't heard from you.");
  });

  it("an earlier answer keeps its trace after the next send", async () => {
    server(
      body([turn("started", "WORKING", "pending"), step("a", 1, "Looked through your contacts", "done"), turn("completed", "FINAL", "answer"), say("First."), DONE]),
      body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Second."), DONE]),
    );
    const host = await mount();
    await ask(host, "first");
    await ask(host, "second");
    expect(lines(host)).toHaveLength(1);
    expect(lineText(lines(host)[0])).toBe("What PAIGE did · 1 step");
  });

  it("[DONE] with no terminal frame never shows a check or Done", async () => {
    server(body([step("a", 1, "Looked through your contacts", "done"), say("Here."), DONE]));
    const host = await mount();
    await ask(host);
    const node = lastLine(host)!;
    expect(node.dataset.kind).toBe("neutral");
    expect(node.querySelector(".ptl-glyph svg")).toBeNull();
    expect(host.textContent).not.toMatch(/\bDone\b/);
  });

  it("LIMIT_REACHED and INTERRUPTED never show a check", async () => {
    server(
      body([turn("started", "WORKING", "pending"), step("a", 1, "Reviewed notes", "done"), turn("completed", "LIMIT_REACHED", "answer"), say("I reviewed 9 of 14."), DONE]),
      body([turn("started", "WORKING", "pending"), turn("completed", "INTERRUPTED", "answer"), say("I hit a snag finishing that — mind trying again?"), DONE]),
    );
    const host = await mount();
    await ask(host, "check goals");
    expect(lineText(lastLine(host))).toBe("Reached the limit for one answer");
    expect(lastLine(host)!.dataset.kind).toBe("warn");
    await ask(host, "again");
    expect(lineText(lastLine(host))).toBe("Stopped before finishing");
    expect(host.querySelector("[data-paige-turn-footer]")?.textContent).toContain("What arrived is above.");
    expect(host.textContent).not.toMatch(C4_LANGUAGE);
    // "Ask again" prefills the composer with the original request and never sends it.
    const fetches = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const askAgain = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-paige-turn-footer] button")).find((b) => b.textContent === "Ask again")!;
    await act(async () => { askAgain.click(); await flush(); });
    expect(host.querySelector("textarea")!.value).toBe("again");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(fetches);
  });
});

describe("C3a — Stop", () => {
  it("says Stopped by you, keeps the started step as stopped, focuses the footer, and puts the question back", async () => {
    const hold = deferred();
    server(body([turn("started", "WORKING", "pending"), step("a", 1, "Looked through your contacts", "done"), step("b", 2, "Reviewing your pipeline", "running"), hold.promise, say("late"), DONE]));
    const host = await mount();
    await ask(host, "who is quiet");
    const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="Cancel PAIGE response"]')!;
    await act(async () => { cancel.click(); await flush(); });
    const node = lastLine(host)!;
    expect(lineText(node)).toBe("Stopped by you");
    expect(node.dataset.kind).toBe("stop");
    const foot = host.querySelector<HTMLElement>("[data-paige-turn-footer]")!;
    // §13 — Stop ends the read, not the work; and the rollback already put the question back, so
    // the footer says so and offers no "Ask again" that would do nothing new.
    expect(foot.querySelector("p")!.textContent).toBe(
      "Stopped showing this answer. PAIGE may still finish work that had already started. Your question is back in the message box.",
    );
    expect(Array.from(foot.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["See what finished"]);
    expect(document.activeElement).toBe(foot);
    const see = Array.from(foot.querySelectorAll("button")).find((b) => b.textContent === "See what finished")!;
    await act(async () => { see.click(); });
    expect(rowsOf(node)).toEqual([
      ["Looked through your contactsOwner Ops", "done"],
      ["Reviewing your pipelineOwner Ops · Stopped — it may still finish on its own", "stopped"],
    ]);
    // The old jargon notice is gone; its truth is in the footer.
    expect(host.textContent).not.toContain("Response stream cancelled locally");
    expect(host.querySelector("textarea")!.value).toBe("who is quiet");
    await act(async () => { hold.resolve(); await flush(); });
    expect(host.textContent).not.toContain("late");
  });

  it("a Live voice interruption stops the read the same way but never moves keyboard focus", async () => {
    const hold = deferred();
    server(body([turn("started", "WORKING", "pending"), step("a", 1, "Reviewing your pipeline", "running"), hold.promise, DONE]));
    const host = await mount();
    await ask(host, "who is quiet");
    // Where focus is during a Live session (the Live controls live outside the transcript).
    const liveControl = document.createElement("button");
    document.body.appendChild(liveControl);
    liveControl.focus();
    expect(harness.live).not.toBeNull();
    await act(async () => { harness.live!.onVoiceInterrupt(); await flush(); });
    expect(lineText(lastLine(host))).toBe("Stopped by you");
    expect(host.querySelector("[data-paige-turn-footer]")).not.toBeNull();
    expect(document.activeElement).toBe(liveControl);
    liveControl.remove();
    await act(async () => { hold.resolve(); await flush(); });
  });
});

describe("C3a — a workspace switch mid-answer", () => {
  it("leaves no line behind — not the live one, not a stopped one", async () => {
    const hold = deferred();
    server(body([turn("started", "WORKING", "pending"), step("a", 1, "Reviewing your pipeline", "running"), hold.promise, say("late"), DONE]));
    const host = await mount();
    await ask(host, "who is quiet");
    expect(lineText(lastLine(host))).toBe("Reviewing your pipeline");
    harness.tenant = `account-switched-${Math.random().toString(36).slice(2)}`;
    await act(async () => {
      lastRoot!.render(<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />);
      await flush();
    });
    await act(async () => { await flush(); });
    expect(lines(host)).toHaveLength(0);
    expect(host.querySelector("[data-paige-pending-turn]")).toBeNull();
    expect(host.textContent).not.toMatch(/Stopped by you|Reviewing your pipeline/);
    await act(async () => { hold.resolve(); await flush(); });
    expect(lines(host)).toHaveLength(0);
    expect(host.textContent).not.toContain("late");
  });
});

describe("C3a — proof (5): approval presentation without a synthetic bubble", () => {
  const card = (fp: string) => frame({ paige_confirm: { tool: "send_email", summary: "Send the renewal proposal to Daniel Reyes", fingerprint: fp } });

  it("Approve: the sentence is still SENT, never SHOWN; the next answer is drawn as a continuation", async () => {
    const bodies = server(
      body([turn("started", "WORKING", "pending"), step("a", 1, "Drafted the cover note", "done"), card("fp-1"), turn("waiting", "WAIT_APPROVAL", "action"), say("Here's what I'll send."), DONE]),
      body([turn("started", "WORKING", "pending"), step("b", 1, "Sent to Daniel", "done"), turn("completed", "FINAL", "action"), say("Sent."), DONE]),
    );
    const host = await mount();
    await ask(host, "send the renewal");
    expect(lineText(lastLine(host))).toBe("Waiting for your OK");
    expect(lastLine(host)!.dataset.kind).toBe("wait");
    // One voice per state: the approval card announces "Needs your OK" itself, so the line is quiet.
    expect(lastLine(host)!.querySelector("[data-paige-turn-announcer]")).toBeNull();
    const approve = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /Approve/.test(b.textContent ?? ""))!;
    await act(async () => { approve.click(); await flush(); });
    await act(async () => { await flush(); });
    const sent = bodies[1].messages.filter((m) => m.role === "user").at(-1)!;
    expect(sent.content).toBe("Approved — run it.");
    expect(bodies[1].approvedConfirmations).toEqual(["fp-1"]);
    // The view's own fields never ride the wire: the request is the shape it was before C3.
    for (const m of bodies[1].messages as Array<Record<string, unknown>>) {
      expect(m).not.toHaveProperty("turnSnapshot");
      expect(m).not.toHaveProperty("decision");
    }
    expect(host.textContent).not.toContain("Approved — run it.");
    const continuation = host.querySelector<HTMLElement>('[data-paige-continues="approval"]');
    expect(continuation).not.toBeNull();
    expect(continuation!.textContent).toContain("Sent.");
    expect(lineText(lines(host)[0])).toBe("What PAIGE did · 1 step");
    expect(host.textContent).not.toMatch(C4_LANGUAGE);
  });

  it("Not now: hidden too, and the card settles to Skipped", async () => {
    const bodies = server(
      body([turn("started", "WORKING", "pending"), card("fp-2"), turn("waiting", "WAIT_APPROVAL", "action"), DONE]),
      body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Okay — it's not sent."), DONE]),
    );
    const host = await mount();
    await ask(host, "send it");
    const notNow = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /Not now/.test(b.textContent ?? ""))!;
    await act(async () => { notNow.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(bodies[1].messages.filter((m) => m.role === "user").at(-1)!.content).toBe("Hold off — skip that one.");
    expect(bodies[1].declinedConfirmations).toEqual(["fp-2"]);
    expect(host.textContent).not.toContain("Hold off — skip that one.");
    expect(host.textContent).toContain("Skipped");
    // The button that was pressed went away with the card; focus lands on the record that replaced
    // it (the composer is disabled while the follow-up runs), not on <body>.
    expect(document.activeElement).toBe(host.querySelector("[data-paige-decided-record]"));
    expect((document.activeElement as HTMLElement).textContent).toContain("Skipped");
  });

  it("the drawer mount (no Solo safety) settles the decided card instead of losing it", async () => {
    server(
      body([turn("started", "WORKING", "pending"), card("fp-3"), turn("waiting", "WAIT_APPROVAL", "action"), say("Ready."), DONE]),
      body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("Done and logged."), DONE]),
    );
    const host = await mount({ soloTenantSafety: false });
    await ask(host, "send it");
    const approve = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /Approve/.test(b.textContent ?? ""))!;
    await act(async () => { approve.click(); await flush(); });
    await act(async () => { await flush(); });
    expect(host.textContent).not.toContain("Approved — run it.");
    // The decided card settled into its record (it used to vanish on this mount).
    expect(Array.from(host.querySelectorAll("div")).some((d) => d.textContent === "Approved" && d.className.includes("rounded-full"))).toBe(true);
    expect(Array.from(host.querySelectorAll("button")).some((b) => /^Approve/.test(b.textContent ?? ""))).toBe(false);
    expect(document.activeElement).toBe(host.querySelector("[data-paige-decided-record]"));
    // No card result was recorded for this decision, so nothing claims whether it ran.
    expect(host.querySelector("[data-paige-card-result]")).toBeNull();
  });

  it("the drawer shows the client's own verified result when the stored proposal ran through the door", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { ok: false, outcome: "refused", message: "Already in your clients." }, error: null } as never);
    const bodies = server(
      body([turn("started", "WORKING", "pending"), frame({ paige_confirm: { tool: "crm_create_contact", summary: "Add John Coleman to your clients", fingerprint: "fp-door", command: { op: "create_contact" }, idempotency_key: "idem-1" } }), turn("waiting", "WAIT_APPROVAL", "action"), say("Ready."), DONE]),
      body([turn("started", "WORKING", "pending"), turn("completed", "FINAL", "fast_answer"), say("He was already there."), DONE]),
    );
    const host = await mount({ soloTenantSafety: false });
    await ask(host, "add John Coleman");
    const approve = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /Approve/.test(b.textContent ?? ""))!;
    await act(async () => { approve.click(); await flush(); });
    await act(async () => { await flush(); });
    const sent = bodies[1].messages.filter((m) => m.role === "user").at(-1)!.content;
    expect(sent).toBe("Approved — run it. [Card result — Add John Coleman to your clients: didn't run]");
    expect(host.textContent).not.toContain("Approved — run it.");
    // Hiding the bubble does not hide whether it ran: the record carries the same verified result.
    expect(host.querySelector("[data-paige-card-result]")!.textContent).toBe("Result: Add John Coleman to your clients: didn't run");
  });
});

describe("C3a — proof (4)/(5): a saved thread reads back the same", () => {
  it("rebuilds What PAIGE did from turn_state + turn_trace, hides the decision sentence, and adds a receipt", async () => {
    harness.threads = [{ id: "thread-r", title: "Quiet clients", updated_at: "2026-10-04T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Who hasn't heard from us?", created_at: "2026-10-04T09:00:00Z" },
      { id: "a1", role: "assistant", content: "Three clients.", created_at: "2026-10-04T09:00:14Z", bundle_ref: {
        turn_state: { v: 1, state: "FINAL", mode: "action", rounds: 2, tools: 3 },
        turn_trace: [
          { label: "Looked through your contacts", group: "owner", status: "done" },
          { label: "Checked your calendar", group: "owner", status: "error" },
        ],
      } },
      { id: "u2", role: "user", content: "Send the renewal.", created_at: "2026-10-04T09:01:00Z" },
      { id: "a2", role: "assistant", content: "Here's the draft.", created_at: "2026-10-04T09:01:10Z", bundle_ref: {
        paige_confirm: [{ tool: "send_email", summary: "Send the renewal proposal to Daniel Reyes" }],
        turn_state: { v: 1, state: "WAIT_APPROVAL", mode: "action", rounds: 1, tools: 1, waiting_on: { kind: "approval", approvals: 1 } },
        turn_trace: [{ label: "Drafted the cover note", group: "owner", status: "done" }],
      } },
      { id: "u3", role: "user", content: "Approved — run it.", created_at: "2026-10-04T14:14:00Z" },
      { id: "a3", role: "assistant", content: "Sent.", created_at: "2026-10-04T14:14:05Z", bundle_ref: { turn_state: { v: 1, state: "FINAL", mode: "fast_answer", rounds: 1, tools: 0 } } },
      // The same sentence with no card before it is the person's own words, shown as typed.
      { id: "u4", role: "user", content: "Approved — run it.", created_at: "2026-10-04T14:20:00Z" },
      { id: "a4", role: "assistant", content: "Approved what?", created_at: "2026-10-04T14:20:03Z" },
      { id: "u5", role: "user", content: "Count sessions.", created_at: "2026-10-04T14:30:00Z" },
      { id: "a5", role: "assistant", content: "", created_at: "2026-10-04T14:30:03Z", bundle_ref: {
        turn_state: { v: 1, state: "WORKING", mode: "pending", rounds: 1, tools: 1 },
        turn_trace: [{ label: "Counted sessions", group: "owner", status: "done" }],
      } },
    ];
    server();
    const host = await mount();
    await act(async () => { await flush(); });
    const all = lines(host);
    expect(all.map(lineText)).toEqual(["What PAIGE did · 2 steps", "What PAIGE did · 1 step", "Didn't finish"]);
    await openTrace(all[0]);
    expect(rowsOf(all[0])).toEqual([["Looked through your contactsOwner Ops", "done"], ["Checked your calendarOwner Ops", "error"]]);
    // Never a live Approve on a reloaded card; the receipt says what the person said, not what ran.
    expect(Array.from(host.querySelectorAll("button")).some((b) => /^Approve/.test(b.textContent ?? ""))).toBe(false);
    // Pinned exactly: what they said and when — no word about whether it ran (none was recorded).
    const settled = Array.from(host.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Earlier, Paige asked you to confirm"))!;
    expect(settled.textContent).toMatch(/^Earlier, Paige asked you to confirm: Send the renewal proposal to Daniel Reyes · You approved · \d{1,2}:\d{2}\s?[AP]M$/);
    expect(settled.parentElement!.querySelector("[data-paige-card-result]")).toBeNull();
    expect(host.textContent?.match(/Approved — run it\./g)).toHaveLength(1);
    expect(host.textContent).not.toMatch(C4_LANGUAGE);
  });

  it("a reloaded decision that carried a card result shows that result — the bubble stays hidden", async () => {
    harness.threads = [{ id: "thread-c", title: "John", updated_at: "2026-10-04T10:00:00Z" }];
    harness.turns = [
      { id: "u1", role: "user", content: "Add John Coleman.", created_at: "2026-10-04T09:00:00Z" },
      { id: "a1", role: "assistant", content: "Ready.", created_at: "2026-10-04T09:00:05Z", bundle_ref: {
        paige_confirm: [{ tool: "crm_create_contact", summary: "Add John Coleman to your clients" }],
      } },
      { id: "u2", role: "user", content: "Approved — run it. [Card result — Add John Coleman to your clients: didn't run]", created_at: "2026-10-04T09:01:00Z" },
      { id: "a2", role: "assistant", content: "He was already there.", created_at: "2026-10-04T09:01:04Z" },
    ];
    const bodies = server();
    const host = await mount();
    await act(async () => { await flush(); });
    expect(host.textContent).not.toContain("Approved — run it.");
    expect(host.textContent).toContain("· You approved");
    expect(host.querySelector("[data-paige-card-result]")!.textContent).toBe("Result: Add John Coleman to your clients: didn't run");
    // The next request after a reload carries none of the view's own fields.
    await ask(host, "Thanks.");
    expect(bodies.length).toBe(1);
    for (const m of bodies[0].messages as Array<Record<string, unknown>>) {
      expect(m).not.toHaveProperty("confirmReceipt");
      expect(m).not.toHaveProperty("turnSnapshot");
      expect(m).not.toHaveProperty("decision");
    }
  });
});

describe("C3a — proof (9): no chain-of-thought", () => {
  for (const solo of [true, false]) {
    it(`never draws a thought — ${solo ? "Solo page" : "drawer"} mount`, async () => {
      server(body([
        turn("started", "WORKING", "pending"),
        frame({ paige_step: { id: "t:1", seq: 0, round: 1, kind: "thought", label: "SECRET-REASONING I should check the CRM first", group: "owner" } }),
        step("a", 1, "Looked through your contacts", "done"),
        turn("completed", "FINAL", "answer"),
        say("Done looking."),
        DONE,
      ]));
      const host = await mount({ soloTenantSafety: solo });
      await ask(host);
      for (const el of lines(host)) await openTrace(el);
      expect(host.textContent).not.toContain("SECRET-REASONING");
      expect(host.textContent).not.toMatch(/Thought process/i);
    });
  }
});
