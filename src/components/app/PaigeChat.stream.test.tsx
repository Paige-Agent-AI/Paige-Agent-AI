import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client portal chat (PaigeChat) — how its two stream readers behave, pinned frame by frame.
 *
 * CHARACTERIZATION (docs/delivery/paige-conversational-loop-c1.md, failing-first plan step 4).
 * Written against the hand-written parsers BEFORE they moved onto the shared src/lib/paige-stream
 * reader. Everything here must stay green, assertions untouched, after the move — except the two
 * owner-approved fixes, which have their own tests below (each named "FIX").
 *
 * The send reader handles paige_step (upsert), paige_phase, sync_status, paige_withheld and content.
 * The opening greeting reader handles content only.
 *
 * EVIDENCE CLASS (§32/§70.1): automated, jsdom, the real component with its data hooks doubled and
 * a scripted SSE body behind a stubbed fetch. Synthetic data only (§63).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const h = vi.hoisted(() => ({
  doc: null as { name: string; base64: string } | null,
  context: { contextBlock: "", isLoading: false, hasCreditData: false },
  extractDocumentSummary: (() => {}) as (...a: unknown[]) => void,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/app" }) };
});
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/playbook", () => ({
  usePlaybook: () => ({
    persona: { greeting: "Harness greeting", name: "Paige", role: "AI COO" },
    quickActions: [{ label: "What's next", prompt: "What should I work on next?" }],
  }),
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: null, loading: false }) }));
vi.mock("@/hooks/useClientChatContext", () => ({ useClientChatContext: () => h.context }));
vi.mock("@/hooks/useProfileSnapshot", () => ({ useProfileSnapshot: () => ({ snapshot: {}, refresh: vi.fn() }) }));
vi.mock("@/hooks/useBeforeUnloadGuard", () => ({ useBeforeUnloadGuard: () => undefined }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/usePaigeMemory", () => ({
  usePaigeMemory: () => ({
    extractDocumentSummary: (...a: unknown[]) => h.extractDocumentSummary(...a),
    getSessionDocumentContext: vi.fn(() => undefined), trackActivity: vi.fn(),
    generateSessionSummary: vi.fn(), resetSession: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => ({
    attachedDoc: h.doc, isProcessingFile: false, isDragOver: false, fileInputRef: { current: null },
    handleFileSelect: vi.fn(), handleDragOver: vi.fn(), handleDragLeave: vi.fn(), handleDrop: vi.fn(),
    removeAttachment: vi.fn(), openFilePicker: vi.fn(), setAttachedDoc: vi.fn(),
  }),
}));
vi.mock("@/components/voice/DictationMicButton", () => ({ DictationMicButton: () => <button type="button">Dictate</button> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token", user: { id: "client-a" }, expires_at: Math.floor(Date.now() / 1000) + 600 } } })) },
    functions: { invoke: vi.fn() },
  },
}));

import { PaigeChat } from "./PaigeChat";

const enc = new TextEncoder();
const line = (payload: unknown) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
const content = (text: string) => line({ choices: [{ delta: { content: text } }] });
const step = (s: Record<string, unknown>) => line({ paige_step: { kind: "action", group: "owner", status: "done", round: 0, ...s } });

function chunked(body: string, size: number): Uint8Array[] {
  const all = enc.encode(body);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

/** A body served whole or as chunks; `null` hands the controller to the test instead. */
type Body = string | Uint8Array[] | null;
let sendBody: Body;
let greetBody: Body;
let controller: ReadableStreamDefaultController<Uint8Array> | null;
let host: HTMLDivElement;
let root: Root;

function respond(body: Body): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      if (body === null) { controller = c; return; }
      for (const piece of typeof body === "string" ? [enc.encode(body)] : body) c.enqueue(piece);
      c.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  sessionStorage.clear();
  h.doc = null;
  h.context = { contextBlock: "", isLoading: false, hasCreditData: false };
  h.extractDocumentSummary = vi.fn();
  sendBody = "data: [DONE]\n\n";
  greetBody = "data: [DONE]\n\n";
  controller = null;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    // Only the opening greeting's context leads with its "Session:" line.
    return respond(String(body.clientContext ?? "").startsWith("Session:") ? greetBody : sendBody);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

const settle = async (n = 20) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = () => host.textContent ?? "";
const sendButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.className.includes("bg-gradient-gold"))!;
const loading = () => !!sendButton().querySelector(".animate-spin");
/** The transcript, without ids that are random per mount. */
const markup = () => host.innerHTML.replace(/(data-paige-message-id|id|aria-controls)="[^"]*"/g, '$1=""');

async function mount() {
  await act(async () => root.render(<PaigeChat user={{ id: "client-a", user_metadata: { full_name: "Sam Rivera" } } as never} session={null} />));
  await settle();
}

/** Mount, send one message (the quick action, or the attached document), and let it settle. */
async function send(body: Body) {
  sendBody = body;
  await mount();
  const trigger = h.doc ? sendButton() : [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "What's next")!;
  await act(async () => { trigger.click(); });
  if (body !== null) await settle();
}

describe("PaigeChat send reader (characterization)", () => {
  it("content accumulates into her reply, and [DONE] ends the read", async () => {
    await send(content("Start with ") + content("your intake call.") + "data: [DONE]\n\n" + content(" Never shown."));
    expect(text()).toContain("Start with your intake call.");
    expect(text()).not.toContain("Never shown.");
    expect(loading()).toBe(false);
  });

  it("a stream that ends without [DONE] is still a finished turn", async () => {
    await send(content("Start with your intake call."));
    expect(text()).toContain("Start with your intake call.");
    expect(loading()).toBe(false);
  });

  it("paige_step upserts by id and keeps seq order; the strip shows the last step", async () => {
    await send(
      step({ id: "0:b", seq: 2, label: "Looked at your calendar" })
      + step({ id: "0:a", seq: 1, label: "Read your goals" })
      + step({ id: "0:b", seq: 2, label: "Looked at this week's calendar" })
      + content("Start with your intake call.")
      + "data: [DONE]\n\n",
    );
    expect(text()).toContain("Looked at this week's calendar");
    expect(text()).not.toContain("Looked at your calendar");
    expect(text()).toContain("2 steps");
    expect(text()).toContain("Done");
  });

  // C2 — the start/finish lifecycle. An action arrives as "running" and closes on the same id.
  it("a running step that closes as done is one row, done", async () => {
    await send(
      step({ id: "0:a", seq: 1, label: "Reading your goals", status: "running" })
      + step({ id: "0:a", seq: 1, label: "Read your goals", status: "done" })
      + content("Start with your intake call.")
      + "data: [DONE]\n\n",
    );
    expect(text()).toContain("Read your goals");
    expect(text()).not.toContain("Reading your goals");
    expect(text()).toContain("1 step");
    expect(text()).toContain("Done");
  });

  it("a running step that is withdrawn leaves no row", async () => {
    await send(
      step({ id: "0:a", seq: 1, label: "Read your goals" })
      + step({ id: "0:b", seq: 2, label: "Checking your calendar", status: "running" })
      + step({ id: "0:b", seq: 2, label: "Checking your calendar", status: "withdrawn" })
      + content("Start with your intake call.")
      + "data: [DONE]\n\n",
    );
    expect(text()).toContain("1 step");
    expect(text()).not.toContain("Checking your calendar");
  });

  it("a running step never closed is settled when the read ends — the strip says Done, not at work", async () => {
    await send(null);
    await settle();
    await act(async () => {
      controller!.enqueue(enc.encode(step({ id: "0:a", seq: 1, label: "Read your goals" }) + step({ id: "0:b", seq: 2, label: "Checking your calendar", status: "running" })));
    });
    await settle();
    expect(text()).toContain("Paige at work");
    expect(text()).toContain("Checking your calendar");
    await act(async () => { controller!.enqueue(enc.encode(content("Here.") + "data: [DONE]\n\n")); controller!.close(); });
    await settle();
    expect(loading()).toBe(false);
    expect(text()).not.toContain("Paige at work");
    expect(text()).not.toContain("Checking your calendar");
    expect(text()).toContain("1 step");
    expect(text()).toContain("Done");
  });

  it("a read that fails after a running step leaves nothing running", async () => {
    await send(null);
    await settle();
    await act(async () => {
      controller!.enqueue(enc.encode(step({ id: "0:a", seq: 1, label: "Read your goals" }) + step({ id: "0:b", seq: 2, label: "Checking your calendar", status: "running" })));
    });
    await settle();
    expect(text()).toContain("Checking your calendar");
    // The connection drops mid-turn: the read throws, and nothing will ever close "0:b".
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { controller!.error(new Error("connection lost")); });
    await settle();
    errors.mockRestore();
    expect(loading()).toBe(false);
    expect(text()).not.toContain("Checking your calendar");
    expect(text()).not.toContain("Paige at work");
    expect(text()).toContain("Read your goals");
  });

  it("a frame without a status still reads as done", async () => {
    await send(line({ paige_step: { id: "0:a", seq: 1, round: 0, kind: "action", group: "owner", label: "Read your goals" } }) + content("Here.") + "data: [DONE]\n\n");
    expect(text()).toContain("Read your goals");
    expect(text()).toContain("Done");
  });

  it("paige_phase \"writing\" flips Thinking… to Writing… before any word arrives", async () => {
    await send(null);
    await settle();
    expect(text()).toContain("Thinking…");
    await act(async () => { controller!.enqueue(enc.encode(line({ paige_phase: "something-else" }))); });
    await settle();
    expect(text()).toContain("Thinking…");
    await act(async () => { controller!.enqueue(enc.encode(line({ paige_phase: "writing" }))); });
    await settle();
    expect(text()).toContain("Writing…");
    expect(text()).not.toContain("Thinking…");
    await act(async () => { controller!.enqueue(enc.encode(content("Here.") + "data: [DONE]\n\n")); controller!.close(); });
    await settle();
    expect(loading()).toBe(false);
  });

  it("sync_status rides to a panel after a document answer longer than 100 characters", async () => {
    h.doc = { name: "intake.pdf", base64: "JVBERi0xLjQK" };
    const answer = "I read your intake form. It lists your goals for the first month and the mornings you are free to meet.";
    await send(
      line({ sync_status: { success: false, awaiting_review: true, error: "Your form is read and waiting for a review." } })
      + content(answer)
      + "data: [DONE]\n\n",
    );
    expect(text()).toContain(answer);
    expect(text()).toContain("Your form is read and waiting for a review.");
    expect(h.extractDocumentSummary).toHaveBeenCalledWith(answer, "intake.pdf");
  });

  it("paige_withheld keeps the sentence on screen and out of the document summary", async () => {
    h.doc = { name: "intake.pdf", base64: "JVBERi0xLjQK" };
    const sentence = "I wrote an answer, but it included internal system details that aren't meant to be shared here, so I didn't send it.";
    await send(line({ paige_withheld: true }) + line({ sync_status: { success: true } }) + content(sentence) + "data: [DONE]\n\n");
    expect(text()).toContain(sentence);
    expect(h.extractDocumentSummary).not.toHaveBeenCalled();
    expect(text()).not.toContain("Profile Sync");
  });

  it("lines that are not data lines are ignored, and CRLF endings read the same", async () => {
    await send(": keep-alive\r\n\r\nevent: message\r\n" + "data: " + JSON.stringify({ choices: [{ delta: { content: "Hi there." } }] }) + "\r\n\r\n" + "data: [DONE]\r\n\r\n");
    expect(text()).toContain("Hi there.");
    expect(loading()).toBe(false);
  });

  const SPLIT_BODY =
    step({ id: "0:a", seq: 1, label: "Read your goals — “first month”" })
    + line({ paige_phase: "writing" })
    + content("Start with your intake call — ")
    + content("it sets the month up ✓ 🚀")
    + "data: [DONE]\n\n";

  it.each([1, 2, 3, 5, 7, 64])("a body cut into %i-byte chunks reads exactly like the whole body", async (size) => {
    await send(SPLIT_BODY);
    const whole = markup();
    expect(text()).toContain("Start with your intake call — it sets the month up ✓ 🚀");
    expect(text()).toContain("Read your goals — “first month”");
    act(() => root.unmount());
    root = createRoot(host);
    await send(chunked(SPLIT_BODY, size));
    expect(markup()).toBe(whole);
  });

  it("FIX: a complete malformed line is skipped — the rest of the reply still arrives", async () => {
    // Before the shared reader, this line was pushed back and the read stopped there: every later
    // line was lost while the turn still finished as a success.
    await send(content("Before. ") + "data: {not json\n\n" + content("After.") + "data: [DONE]\n\n");
    expect(text()).toContain("Before. After.");
    expect(loading()).toBe(false);
  });
});

describe("PaigeChat opening greeting reader (characterization)", () => {
  beforeEach(() => {
    h.context = { contextBlock: "Goals: launch the spring cohort.", isLoading: false, hasCreditData: true };
  });

  it("the greeting is the content frames, joined and trimmed, replacing the persona's line", async () => {
    greetBody = [content("  Welcome back, "), content("Sam. "), content("Ready when you are.  "), "data: [DONE]\n\n"].join("");
    await mount();
    expect(text()).toContain("Welcome back, Sam. Ready when you are.");
    expect(text()).not.toContain("Harness greeting");
  });

  it("[DONE] is NOT terminal for the greeting: words after it still join", async () => {
    greetBody = content("Welcome back.") + "data: [DONE]\n\n" + content(" One more thing.");
    await mount();
    expect(text()).toContain("Welcome back. One more thing.");
  });

  it("only content counts: steps, phases, a malformed line and paige_turn leave no trace", async () => {
    greetBody =
      line({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } })
      + step({ id: "0:a", seq: 1, label: "Read your goals" })
      + line({ paige_phase: "writing" })
      + "data: {not json\n\n"
      + line({ paige_something_new: { label: "Not a step" } })
      + content("Welcome back.")
      + line({ paige_turn: { v: 1, event: "completed", state: "FINAL", mode: "fast_answer" } })
      + "data: [DONE]\n\n";
    await mount();
    expect(text()).toContain("Welcome back.");
    expect(text()).not.toContain("Read your goals");
    expect(text()).not.toContain("Not a step");
  });

  it("an empty greeting keeps the persona's line", async () => {
    greetBody = "data: [DONE]\n\n";
    await mount();
    expect(text()).toContain("Harness greeting");
  });

  it("FIX: a line split across two chunks is read, not lost", async () => {
    // Before the shared reader, each chunk was split on its own with no carried tail, so both
    // halves of this line failed to parse and the greeting lost these words.
    const body = content("Welcome back, ") + content("Sam — ready when you are ✓.") + "data: [DONE]\n\n";
    const cut = body.indexOf("Sam") - 4;
    greetBody = [enc.encode(body.slice(0, cut)), enc.encode(body.slice(cut))];
    await mount();
    expect(text()).toContain("Welcome back, Sam — ready when you are ✓.");
  });

  it("FIX: a character split across two chunks decodes whole", async () => {
    // Before, each chunk was decoded without {stream:true}, so a multi-byte character cut by a chunk
    // boundary became two replacement characters.
    greetBody = chunked(content("Welcome back 🚀 — ready.") + "data: [DONE]\n\n", 3);
    await mount();
    expect(text()).toContain("Welcome back 🚀 — ready.");
    expect(text()).not.toContain("�");
  });
});

describe("PaigeChat ignores frames it does not read (paige_turn, unknown)", () => {
  const TURN_STARTED = line({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } });
  const TURN_DONE = line({ paige_turn: { v: 1, event: "completed", state: "FINAL", mode: "answer" } });
  const UNKNOWN = line({ paige_something_new: { label: "Not a step", summary: "Not a confirm" } });

  it("a send with paige_turn and unknown frames renders exactly what the same send without them renders", async () => {
    const frames = [step({ id: "0:a", seq: 1, label: "Read your goals" }), line({ paige_phase: "writing" }), content("Start with your intake call.")];
    await send(frames.join("") + "data: [DONE]\n\n");
    const without = markup();
    act(() => root.unmount());
    root = createRoot(host);
    await send(TURN_STARTED + UNKNOWN + frames.join("") + TURN_DONE + UNKNOWN + "data: [DONE]\n\n");
    expect(markup()).toBe(without);
  });

  it("paige_turn and unknown frames mid-stream change nothing while the turn is open", async () => {
    await send(null);
    await settle();
    const before = markup();
    await act(async () => { controller!.enqueue(enc.encode(TURN_STARTED + UNKNOWN)); });
    await settle();
    expect(markup()).toBe(before);
    await act(async () => { controller!.enqueue(enc.encode("data: [DONE]\n\n")); controller!.close(); });
    await settle();
  });
});
