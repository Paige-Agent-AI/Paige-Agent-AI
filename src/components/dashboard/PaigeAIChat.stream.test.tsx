/**
 * PaigeAIChat's stream handling, pinned frame by frame — written BEFORE its read loop moved onto the
 * shared reader (src/lib/paige-stream), run green against the hand-written loop, and then kept
 * unchanged across the move. A test edited to pass after the move would be a regression hidden in
 * plain sight, so these assert what a person SEES (and what the Live voice sink is told), never how
 * the loop is written.
 *
 * Every body here is delivered chunk by chunk through a reader — the shape the browser hands the
 * component — so a line or a character cut by a chunk boundary is exercised for real. The cards the
 * frames produce are replaced by thin stand-ins that print the props they were given; the approval
 * card is the real one, because pressing it is how an approval turn begins.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaigeStep } from "@/components/dashboard/PaigeStepTrace";
import type { LiveVoiceSink } from "@/components/paige/live/PaigeLiveConversation";

const harness = vi.hoisted(() => ({
  liveVoiceTurn: null as ((text: string, sink: LiveVoiceSink) => Promise<void>) | null,
  liveCard: null as null | { id: string; title: string },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: "account-a", activeTenant: { account_number: "42" } }),
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
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) } },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: [], isLoading: false, isFetched: true,
    loadTurns: vi.fn(async () => []), ensureThread: vi.fn(async () => "thread-a"),
    onTurnPersisted: vi.fn(), renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/paige/live/PaigeLiveConversation", () => ({
  PaigeLiveConversation: (props: { activeCard: null | { id: string; title: string }; onVoiceTurn: (text: string, sink: LiveVoiceSink) => Promise<void> }) => {
    harness.liveVoiceTurn = props.onVoiceTurn;
    harness.liveCard = props.activeCard;
    return null;
  },
}));
// Stand-ins that print exactly what each card was handed.
vi.mock("@/components/chat/PaigeCrmResultCard", () => ({
  PaigeCrmResultCard: ({ result }: { result: unknown }) => <div data-testid="crm">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeResearchCard", () => ({
  PaigeResearchCard: ({ result }: { result: unknown }) => <div data-testid="research">{JSON.stringify(result)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeArtifactCard", () => ({
  PaigeArtifactCard: ({ artifact, tenantId }: { artifact: unknown; tenantId: string }) => (
    <div data-testid="artifact">{JSON.stringify({ artifact, tenantId })}</div>
  ),
}));
vi.mock("@/components/chat/ExtractionProposalCard", () => ({
  ExtractionProposalCard: ({ proposal }: { proposal: unknown }) => <div data-testid="proposal">{JSON.stringify(proposal)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeCompactingCard", () => ({
  PaigeCompactingCard: ({ signal }: { signal: unknown }) => <div data-testid="compacting">{JSON.stringify(signal)}</div>,
}));
vi.mock("@/components/paige/chat/PaigeThinkingIndicator", () => ({
  PaigeThinkingIndicator: ({ active, writing }: { active: boolean; writing: boolean }) => (
    <div data-testid="thinking" data-active={String(active)} data-writing={String(writing)} />
  ),
}));

import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const say = (text: string) => frame({ choices: [{ delta: { content: text } }] });
const DONE = "data: [DONE]\n\n";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A body read chunk by chunk. A string or byte chunk is one read; a promise in the list holds the
 * NEXT read until it settles, so a test can look at the screen mid-stream. `endless` never closes
 * the body after the last chunk — only [DONE] can end that turn.
 */
type Chunk = string | Uint8Array | Promise<unknown>;
const body = (chunks: Chunk[], opts: { endless?: boolean } = {}) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      let i = 0;
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          while (i < chunks.length && chunks[i] instanceof Promise) await chunks[i++];
          if (i >= chunks.length) {
            if (opts.endless) return new Promise(() => {});
            return { done: true, value: undefined };
          }
          const c = chunks[i++] as string | Uint8Array;
          return { done: false, value: typeof c === "string" ? enc.encode(c) : c };
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

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
  harness.liveVoiceTurn = null;
  harness.liveCard = null;
});

/** Each call to fetch takes the next scripted reply. */
function server(...replies: Array<ReturnType<typeof body>>) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return replies[bodies.length - 1] ?? body([say("Okay."), DONE]);
  }));
  return bodies;
}

interface Mounted {
  host: HTMLElement;
  trace: PaigeStep[][];
  released: string[];
}

async function mount(extra: Record<string, unknown> = {}): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const trace: PaigeStep[][] = [];
  const released: string[] = [];
  await act(async () => {
    root.render(
      <PaigeAIChat
        hideHeader
        fill
        enableHistory
        soloTenantSafety
        onTrace={(steps) => { trace.push(steps); }}
        onFocusRelease={(reason: string) => { released.push(reason); }}
        {...extra}
      />,
    );
    await flush();
  });
  mounted.push(async () => { await act(async () => { root.unmount(); }); host.remove(); });
  const textarea = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
  for (let attempt = 0; attempt < 6 && textarea().disabled; attempt += 1) await act(async () => flush());
  expect(textarea().disabled).toBe(false);
  return { host, trace, released };
}

async function ask(host: HTMLElement, text = "what is happening") {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
  await act(async () => { send.click(); await flush(); });
}

const all = (host: HTMLElement, id: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)).map((el) => JSON.parse(el.textContent ?? "null"));
const thinking = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="thinking"]');
const buttons = (host: HTMLElement, label: RegExp) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter((b) => label.test(b.textContent ?? ""));
const reports = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[data-card-mode="report"]'));
const SERVER_ISSUE = "Something went wrong on our side and PAIGE didn't get to answer.";
const LIVE_ISSUE = "Paige's answer was interrupted.";
const composerFree = (host: HTMLElement) => !host.querySelector("textarea")!.disabled;
/** The question as a sent bubble in the transcript (not the composer, which a rollback refills). */
const sentBubble = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll("p, div, span")).some((el) => el.children.length === 0 && el.textContent === text && !el.closest("textarea"));

const step = (id: string, seq: number, label: string, status: PaigeStep["status"] = "running"): PaigeStep =>
  ({ id, seq, round: 1, kind: "action", label, group: "owner", status });

describe("PaigeAIChat stream — framing", () => {
  it("joins content cut across chunks mid-line and mid-character, through CRLF, comments and blank lines", async () => {
    const tail = enc.encode(`${say("wörld ✓")}`);
    const cut = tail.indexOf(0xc3) + 1; // inside the two bytes of "ö"
    server(body([
      ": keep-alive\n\n",
      "\n   \n",
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo "}}]}\r\n\r\n',
      ": another comment\r\n",
      tail.slice(0, cut),
      tail.slice(cut),
      "event: message\nid: 4\n",
      DONE,
    ]));
    const { host } = await mount();
    await ask(host, "hi there");
    expect(sentBubble(host, "hi there")).toBe(true);
    expect(host.textContent).toContain("Hello wörld ✓");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("ends the turn at [DONE] even though the body stays open, and reads nothing after it", async () => {
    server(body([say("Before."), `${DONE}${say(" After.")}`], { endless: true }));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Before.");
    expect(host.textContent).not.toContain("After.");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("rolls the turn back when the body ends without [DONE]", async () => {
    server(body([say("Half an answer")]));
    const { host } = await mount();
    await ask(host, "my question");
    expect(host.textContent).not.toContain("Half an answer");
    expect(sentBubble(host, "my question")).toBe(false);
    expect(host.querySelector("textarea")!.value).toBe("my question");
    expect(host.textContent).toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("stops reading at a line that is not JSON — nothing after it lands, and the turn rolls back", async () => {
    server(body([say("First."), "data: {not json\n\n", say(" Second."), frame({ paige_step: step("s1", 1, "Later step") }), DONE]));
    const { host, trace } = await mount();
    await ask(host, "my question");
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).not.toContain("First.");
    expect(trace.flat().some((s) => s.label === "Later step")).toBe(false);
    expect(sentBubble(host, "my question")).toBe(false);
    expect(host.querySelector("textarea")!.value).toBe("my question");
    expect(host.textContent).toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("holds the turn open after a line that is not JSON until the body closes, as the old loop did", async () => {
    // The old loop pushed the bad line back and failed on it every chunk, so the rollback came only
    // when the server closed the body. The shared reader's "drain" keeps that timing exactly.
    const gate = deferred();
    server(body([say("First."), "data: {not json\n\n", say(" Second."), gate.promise, DONE]));
    const { host } = await mount();
    await ask(host, "my question");
    // Mid-stream, after the bad line: nothing rolled back, no error, the composer still busy.
    expect(host.textContent).toContain("First.");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(false);
    await act(async () => { gate.resolve(); await flush(); });
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("holds the turn open after a frame whose handling throws until the body closes", async () => {
    const gate = deferred();
    server(body([say("First."), "data: null\n\n", say(" Second."), gate.promise, DONE]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("First.");
    expect(composerFree(host)).toBe(false);
    await act(async () => { gate.resolve(); await flush(); });
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).toContain(SERVER_ISSUE);
  });

  it("after a frame whose handling throws, a later [DONE] does not end the turn — it waits for the body", async () => {
    const gate = deferred();
    server(body([say("First."), "data: null\n\n", say(" Second."), DONE, gate.promise]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("First.");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(false);
    await act(async () => { gate.resolve(); await flush(); });
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("never puts non-string content into the transcript", async () => {
    server(body([say("Real words."), frame({ choices: [{ delta: { content: 5 } }] }), frame({ choices: [{ delta: { content: { x: 1 } } }] }), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Real words.");
    expect(host.textContent).not.toContain("Real words.5");
    expect(host.textContent).not.toContain("[object Object]");
  });

  it("rolls a JSON null line back like a line that is not JSON once the body ends", async () => {
    server(body([say("First."), "data: null\n\n", say(" Second."), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).toContain(SERVER_ISSUE);
  });

  it("ignores empty content and frames it does not know, including the turn frame", async () => {
    server(body([
      frame({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } }),
      say(""),
      frame({ paige_turn: { v: 1, event: "completed", state: "FINAL", mode: "pending" } }),
      frame({ paige_turn: { v: 99, nonsense: true } }),
      frame({ paige_something_new: { label: "x" } }),
      frame({ paige_choices: [{ label: "A" }] }),
      frame({ sync_status: { success: true } }),
      frame({ paige_preview: { url: "x" } }),
      frame({ paige_withheld: true }),
      "data: 5\n\n",
      'data: "text"\n\n',
      "data: [1,2]\n\n",
      say("Only this."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Only this.");
    expect(host.textContent).not.toMatch(/WORKING|FINAL|nonsense|paige_/);
    expect(host.textContent).not.toContain(SERVER_ISSUE);
    expect(composerFree(host)).toBe(true);
  });

  it("drops a paige_live_error frame when no Live sink is attached", async () => {
    server(body([say("Text."), frame({ paige_live_error: "answer_interrupted" }), say(" More."), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Text. More.");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
  });
});

describe("PaigeAIChat stream — a frame carrying more than one key keeps this surface's branch order", () => {
  // The server writes one key per frame today, so none of these reach a person. They pin that the
  // order is THIS surface's, not the shared decoder's: the decoder names a frame by its first known
  // key, and naming is all it does here.
  it("still appends words that ride a phase frame which is not the writing phase", async () => {
    server(body([frame({ paige_phase: "thinking", choices: [{ delta: { content: "Rode along." } }] }), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Rode along.");
  });

  it("shows a proposal that rides a sync_status frame", async () => {
    const proposal = { id: "up-9", source: "document", fields: [{ key: "ein", label: "EIN", value: "1" }] };
    server(body([say("Read."), frame({ sync_status: { success: true }, extraction_proposal: proposal }), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "proposal")).toEqual([proposal]);
  });

  it("takes a Live output before a step in the same frame", async () => {
    server(body([frame({ paige_step: step("s", 1, "Hidden step"), paige_live_output: "signed" }), say("Ok."), DONE]));
    const { host, trace } = await mount();
    const s = { challenge: "c", proof: vi.fn(), done: vi.fn(), failed: vi.fn() };
    await act(async () => { await harness.liveVoiceTurn!("spoken", s); await flush(); });
    expect(s.proof.mock.calls).toEqual([["signed"]]);
    expect(trace.flat().some((x) => x.label === "Hidden step")).toBe(false);
    expect(host.textContent).toContain("Ok.");
  });
});

describe("PaigeAIChat stream — the work she shows", () => {
  it("upserts steps by id in seq order, and says Writing only on the writing phase or the first word", async () => {
    const afterSteps = deferred();
    const afterThinkingPhase = deferred();
    const afterWritingPhase = deferred();
    server(body([
      frame({ paige_step: step("b", 2, "Second step") }),
      frame({ paige_step: step("a", 1, "First step") }),
      frame({ paige_step: { ...step("b", 2, "Second step"), status: "done" } }),
      afterSteps.promise,
      frame({ paige_phase: "thinking" }),
      afterThinkingPhase.promise,
      frame({ paige_phase: "writing" }),
      afterWritingPhase.promise,
      say("Answer."),
      DONE,
    ]));
    const { host, trace } = await mount();
    await ask(host);
    const last = trace.at(-1)!;
    expect(last.map((s) => [s.id, s.status])).toEqual([["a", "running"], ["b", "done"]]);
    expect(thinking(host)?.dataset.writing).toBe("false");
    await act(async () => { afterSteps.resolve(); await flush(); });
    expect(thinking(host)?.dataset.writing).toBe("false");
    await act(async () => { afterThinkingPhase.resolve(); await flush(); });
    expect(thinking(host)?.dataset.writing).toBe("true");
    await act(async () => { afterWritingPhase.resolve(); await flush(); });
    expect(host.textContent).toContain("Answer.");
  });

  it("flips to Writing on the first word when no phase frame came", async () => {
    const hold = deferred();
    server(body([say("Hi"), hold.promise, DONE]));
    const { host } = await mount();
    await ask(host);
    expect(thinking(host)?.dataset.writing).toBe("true");
    await act(async () => { hold.resolve(); await flush(); });
  });

  it("shows the compacting card with the signal the server sent", async () => {
    server(body([frame({ paige_compacting: { state: "progress", pct: 40 } }), say("Folded."), DONE]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "compacting")).toEqual([{ state: "progress", pct: 40 }]);
    expect(host.textContent).toContain("Folded.");
  });

  it("hands a Live card to the Live surface", async () => {
    server(body([
      frame({ paige_live_card: { id: "card-0", kind: "not-a-kind", title: "Rejected", source: { availability: "LIVE" } } }),
      frame({ paige_live_card: { id: "card-1", kind: "question", title: "Deal A", source: { availability: "LIVE" } } }),
      say("Here."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(harness.liveCard?.title).toBe("Deal A");
  });
});

describe("PaigeAIChat stream — cards on the turn", () => {
  it("shows queued approvals, and only the confirmations that carry a summary", async () => {
    const bodies = server(body([
      say("I'll queue it."),
      frame({ approval_queued: [{ id: "q1", summary: "Send the follow-up email" }] }),
      frame({ paige_confirm: { tool: "move_deal", summary: "Move Deal A", fingerprint: "aaaaaaaaaaaaaaaa" } }),
      frame({ paige_confirm: { tool: "silent_tool", fingerprint: "bbbbbbbbbbbbbbbb" } }),
      say(" Done."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(host.textContent).toContain("Send the follow-up email");
    expect(host.textContent).toContain("Move Deal A");
    expect(host.textContent).toContain("I'll queue it. Done.");
    const approve = buttons(host, /^Approve/);
    expect(approve).toHaveLength(1);
    await act(async () => { approve[0].click(); await flush(); });
    expect(bodies[1]?.approvedConfirmations).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("reports what became of an approval on the turn that ran it, and ignores the frame on any other turn", async () => {
    server(
      body([
        frame({ paige_approval_outcome: { actions: [{ fingerprint: "x", outcome: "ran" }] } }),
        say("Here is what I'd do."),
        frame({ paige_confirm: { tool: "move_deal", summary: "Move Deal A", fingerprint: "aaaaaaaaaaaaaaaa" } }),
        DONE,
      ]),
      body([
        frame({ paige_approval_outcome: { actions: [{ fingerprint: "aaaaaaaaaaaaaaaa", outcome: "ran" }] } }),
        say("Moved."),
        DONE,
      ]),
    );
    const { host } = await mount();
    await ask(host);
    expect(reports(host)).toHaveLength(0);
    await act(async () => { buttons(host, /^Approve/)[0].click(); await flush(); });
    expect(reports(host)).toHaveLength(1);
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Done");
    expect(host.textContent).toContain("Moved.");
  });

  it("keeps an approval turn that ends without [DONE] and lets its card say it couldn't confirm", async () => {
    server(
      body([say("Here is what I'd do."), frame({ paige_confirm: { tool: "move_deal", summary: "Move Deal A", fingerprint: "aaaaaaaaaaaaaaaa" } }), DONE]),
      body([say("Working on it")]),
    );
    const { host } = await mount();
    await ask(host);
    await act(async () => { buttons(host, /^Approve/)[0].click(); await flush(); });
    expect(reports(host)[0].getAttribute("aria-label")).toBe("Couldn't confirm");
    expect(host.textContent).toContain("Working on it");
    expect(host.textContent).not.toContain(SERVER_ISSUE);
  });

  it("shows a CRM result only when its receipt was recorded", async () => {
    server(body([
      frame({ paige_crm_result: { action: "create_contact", receipt_recorded: true, record_locator: { record_id: "r1" } } }),
      frame({ paige_crm_result: { action: "create_contact", receipt_recorded: false, record_locator: { record_id: "r2" } } }),
      frame({ paige_crm_result: { action: "create_contact", receipt_recorded: "true", record_locator: { record_id: "r3" } } }),
      say("Added."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "crm").map((r) => r.record_locator.record_id)).toEqual(["r1"]);
    expect(host.textContent).toContain("Added.");
  });

  it("shows research that carries findings and drops research that does not", async () => {
    server(body([
      frame({ paige_research: { run_id: "run-1", findings: [{ claim: "x" }] } }),
      frame({ paige_research: { run_id: "run-2" } }),
      say("Found it."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "research").map((r) => r.run_id)).toEqual(["run-1"]);
  });

  it("keeps an artifact card that arrived before the text, under the tenant the frame named", async () => {
    server(body([
      frame({ paige_artifact: { id: "doc-1", title: "Plan", url: "https://x/doc", artifactType: "document", tenant_id: "account-b" } }),
      frame({ paige_artifact: { id: "vid-1", title: "Clip", artifactType: "video" } }),
      frame({ paige_artifact: { title: "No id", artifactType: "image" } }),
      say("Here is your plan."),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "artifact")).toEqual([
      { artifact: { id: "doc-1", title: "Plan", url: "https://x/doc", artifactType: "document", tenantId: "account-b" }, tenantId: "account-b" },
    ]);
    expect(host.textContent).toContain("Here is your plan.");
  });

  it("shows the document proposal that arrives at the close of the turn, and drops a malformed one", async () => {
    const proposal = { id: "up-1", source: "document", fields: [{ key: "ein", label: "EIN", value: "12-3" }] };
    server(body([
      say("I read it."),
      frame({ extraction_proposal: { id: "up-0" } }),
      frame({ extraction_proposal: proposal }),
      DONE,
    ]));
    const { host } = await mount();
    await ask(host);
    expect(all(host, "proposal")).toEqual([proposal]);
    expect(host.textContent).toContain("I read it.");
  });
});

describe("PaigeAIChat stream — a refused client", () => {
  it("releases focus on a permission refusal", async () => {
    server(body([frame({ client_scope: { status: "refused", kind: "permission", reason: "client belongs to a different workspace" } }), DONE]));
    const { host, released } = await mount({ clientId: "client-a" });
    await ask(host);
    expect(released).toEqual(["refused"]);
  });

  it("keeps focus and says it couldn't check on an unknown refusal", async () => {
    server(body([say("Let me look."), frame({ client_scope: { status: "refused", kind: "unknown", reason: "client authorization read failed" } }), DONE]));
    const { host, released } = await mount({ clientId: "client-a" });
    await ask(host);
    expect(released).toEqual([]);
    // Appended to the words already streamed, as its own paragraph.
    expect(host.textContent).toContain("Let me look.");
    expect(host.textContent).toContain("I couldn't check that client just now, so I stopped rather than guess. Nothing was saved — try that again.");
    expect(host.textContent!.indexOf("Let me look.")).toBeLessThan(host.textContent!.indexOf("I couldn't check"));
  });

  it("ignores a client_scope frame that is not a refusal", async () => {
    server(body([frame({ client_scope: { status: "ok" } }), say("Fine."), DONE]));
    const { host, released } = await mount({ clientId: "client-a" });
    await ask(host);
    expect(released).toEqual([]);
    expect(host.textContent).toContain("Fine.");
    expect(host.textContent).not.toContain("couldn't");
  });
});

describe("PaigeAIChat stream — Live voice", () => {
  const sink = () => ({ challenge: "test-challenge", proof: vi.fn(), done: vi.fn(), failed: vi.fn() });

  it("passes signed output to the sink and settles it done at [DONE]", async () => {
    server(body([frame({ paige_live_output: "signed-1" }), say("Spoken."), frame({ paige_live_output: "signed-2" }), DONE]));
    const { host } = await mount();
    const s = sink();
    await act(async () => { await harness.liveVoiceTurn!("my spoken question", s); await flush(); });
    expect(s.proof.mock.calls).toEqual([["signed-1"], ["signed-2"]]);
    expect(s.done).toHaveBeenCalledTimes(1);
    expect(s.failed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Spoken.");
    expect(host.textContent).not.toContain(LIVE_ISSUE);
  });

  it("stops at a Live error, keeps what arrived, and settles the sink failed once", async () => {
    server(body([say("First."), frame({ paige_live_error: "answer_interrupted" }), say(" Later."), frame({ paige_live_output: "late" }), DONE]));
    const { host } = await mount();
    const s = sink();
    await act(async () => { await harness.liveVoiceTurn!("my spoken question", s); await flush(); });
    expect(host.textContent).toContain("First.");
    expect(host.textContent).not.toContain("Later.");
    expect(s.proof).not.toHaveBeenCalledWith("late");
    expect(s.done).not.toHaveBeenCalled();
    expect(s.failed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(LIVE_ISSUE);
  });

  it("treats a line that is not JSON as an interrupted Live answer", async () => {
    server(body([frame({ paige_live_output: "signed-1" }), say("First."), "data: {broken\n\n", frame({ paige_live_output: "signed-2" }), say(" Second."), DONE]));
    const { host } = await mount();
    const s = sink();
    await act(async () => { await harness.liveVoiceTurn!("my spoken question", s); await flush(); });
    expect(s.proof.mock.calls).toEqual([["signed-1"]]);
    expect(s.done).not.toHaveBeenCalled();
    expect(s.failed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("my spoken question");
    expect(host.textContent).toContain("First.");
    expect(host.textContent).not.toContain("Second.");
    expect(host.textContent).toContain(LIVE_ISSUE);
  });

  it("keeps a Live answer open after a frame whose handling throws, even past a [DONE], until the body closes", async () => {
    // The old loop stalled on the throwing line and never saw the [DONE] behind it.
    const gate = deferred();
    server(body([frame({ paige_live_output: "signed-1" }), say("First."), "data: null\n\n", say(" Second."), DONE, gate.promise]));
    const { host } = await mount();
    const s = sink();
    let settled = false;
    let turn!: Promise<void>;
    await act(async () => {
      turn = harness.liveVoiceTurn!("my spoken question", s).then(() => { settled = true; });
      await flush();
    });
    expect(s.done).not.toHaveBeenCalled();
    expect(s.failed).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    await act(async () => { gate.resolve(); await turn; await flush(); });
    expect(s.done).not.toHaveBeenCalled();
    expect(s.failed).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Second.");
  });

  it("treats a body that ends without [DONE] as an interrupted Live answer", async () => {
    server(body([say("First.")]));
    const { host } = await mount();
    const s = sink();
    await act(async () => { await harness.liveVoiceTurn!("my spoken question", s); await flush(); });
    expect(s.done).not.toHaveBeenCalled();
    expect(s.failed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("First.");
    expect(host.textContent).toContain(LIVE_ISSUE);
  });
});
