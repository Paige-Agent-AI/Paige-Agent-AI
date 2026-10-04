/**
 * useStudioChat — how the Studio reads Paige's stream, pinned frame by frame.
 *
 * CHARACTERIZATION (docs/delivery/paige-conversational-loop-c1.md, failing-first plan step 4).
 * These were written against the hand-written parser BEFORE it moved onto the shared
 * src/lib/paige-stream reader, and they must stay green, assertions untouched, after the move.
 * They pin what the hook HOLDS (turns, steps, status, choices, confirms, preview, the artifact
 * handed up), not how anything is drawn.
 *
 * EVIDENCE CLASS (§32/§70.1): automated, jsdom. The stream is a scripted SSE body served by a
 * stubbed fetch; studio-data's thread reads are in-memory doubles. Synthetic data only (§63).
 */
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "synthetic-token" } } }) } },
}));
vi.mock("./studio-data", async (orig) => {
  const real = await orig<typeof import("./studio-data")>();
  return { ...real, ensureThread: async () => "th-1", loadTurns: async () => [], loadHeldConfirms: async () => [] };
});

const { useStudioChat } = await import("./useStudioChat");
type Api = ReturnType<typeof useStudioChat>;

const enc = new TextEncoder();
const line = (payload: unknown) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
const content = (text: string) => line({ choices: [{ delta: { content: text } }] });

/** The whole body, cut into `size`-byte chunks — a boundary lands mid-line, mid-JSON, mid-UTF-8. */
function chunked(body: string, size: number): Uint8Array[] {
  const all = enc.encode(body);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

let api: Api;
let artifacts: unknown[];
let controller: ReadableStreamDefaultController<Uint8Array> | null;
let served: (Uint8Array | "BREAK")[] | null;
let host: HTMLDivElement;
let root: Root;

function Probe() {
  api = useStudioChat({ sessionId: "s-1", seedBrief: null, canvas: null, onArtifact: (a) => artifacts.push(a), onTurnDone: () => {} });
  return null;
}

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

/** What the hook holds, minus the wall-clock stamp on each step. */
const held = () => ({
  turns: api.turns,
  steps: api.steps.map(({ at: _at, ...s }) => s),
  status: api.status,
  choices: api.choices,
  confirms: api.confirms,
  preview: api.preview,
  sendError: api.sendError,
  sending: api.sending,
  artifacts,
});

beforeEach(async () => {
  artifacts = [];
  controller = null;
  served = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    start(c) {
      if (!served) { controller = c; return; }
      for (const piece of served) {
        if (piece === "BREAK") { c.error(new TypeError("network connection was lost")); return; }
        c.enqueue(piece);
      }
      c.close();
    },
  }), { status: 200 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(<Probe />); });
  await flush();
  expect(api.turns).toEqual([]);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Serve `body` (whole, or as chunks), send one message, and let the turn settle. */
async function turn(body: string | (Uint8Array | "BREAK")[], say = "Build me an intake form") {
  served = typeof body === "string" ? [enc.encode(body)] : body;
  await act(async () => { await api.send(say); });
  await flush();
}

describe("useStudioChat reads the stream (characterization)", () => {
  it("[DONE] ends the read: nothing after it reaches the reply", async () => {
    await turn(content("Your form is ready.") + "data: [DONE]\n\n" + content(" And this never shows."));
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "Your form is ready." });
  });

  it("a stream that ends without [DONE] is still a finished turn", async () => {
    await turn(content("Here it is."));
    expect(api.turns).toEqual([{ role: "user", content: "Build me an intake form" }, { role: "assistant", content: "Here it is." }]);
    expect(api.sendError).toBeNull();
    expect(api.sending).toBe(false);
  });

  it("a malformed line is skipped and the rest of the reply still arrives", async () => {
    await turn(content("Before. ") + "data: {not json\n\n" + content("After.") + "data: [DONE]\n\n");
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "Before. After." });
    expect(api.sendError).toBeNull();
  });

  it("paige_step: append-only, first id wins, a label is required, status collapses to done|error", async () => {
    await turn([
      line({ paige_step: { id: "a", label: "Wrote 3 questions", status: "done", kind: "action", seq: 2, group: "owner" } }),
      line({ paige_step: { id: "a", label: "A second frame for the same id", status: "error" } }),
      line({ paige_step: { id: "b", status: "done" } }),
      line({ paige_step: { id: "c", label: "" } }),
      line({ paige_step: { label: "No id, so it is numbered", status: "error", detail: "why" } }),
      line({ paige_step: { id: "d", label: "Running maps to done", status: "running", seq: 1 } }),
      content("Done."),
      "data: [DONE]\n\n",
    ].map((s) => enc.encode(s)));
    expect(held().steps).toEqual([
      { id: "a", label: "Wrote 3 questions", detail: undefined, status: "done" },
      { id: "s:1", label: "No id, so it is numbered", detail: "why", status: "error" },
      { id: "d", label: "Running maps to done", detail: undefined, status: "done" },
    ]);
    // The status line clears when the turn settles.
    expect(api.status).toBeNull();
  });

  it("the status line follows the latest step label while the turn is still open", async () => {
    let finished = false;
    await act(async () => { void api.send("Build me a page").then(() => { finished = true; }); });
    await flush();
    await act(async () => { controller!.enqueue(enc.encode(line({ paige_step: { id: "a", label: "Laying out the page" } }))); });
    await flush();
    expect(api.status).toBe("Laying out the page");
    await act(async () => { controller!.enqueue(enc.encode(line({ paige_step: { id: "b", label: "Writing the headline" } }))); });
    await flush();
    expect(api.status).toBe("Writing the headline");
    expect(api.sending).toBe(true);
    await act(async () => { controller!.enqueue(enc.encode("data: [DONE]\n\n")); controller!.close(); });
    await flush();
    expect(finished).toBe(true);
    expect(api.status).toBeNull();
    expect(api.sending).toBe(false);
  });

  it("paige_confirm needs a fingerprint, and one fingerprint is one card", async () => {
    await turn([
      line({ paige_confirm: { tool: "crm_update", summary: "No fingerprint, so it is dropped" } }),
      line({ paige_confirm: { tool: "crm_update", summary: "Move Northwind to Proposal", fingerprint: "a1b2c3d4e5f60718" } }),
      line({ paige_confirm: { tool: "crm_update", summary: "The same call again", fingerprint: "a1b2c3d4e5f60718" } }),
      line({ paige_confirm: { summary: "No tool named", fingerprint: "0000000000000001" } }),
      "data: [DONE]\n\n",
    ].join(""));
    expect(api.confirms).toEqual([
      { tool: "crm_update", summary: "Move Northwind to Proposal", fingerprint: "a1b2c3d4e5f60718" },
      { tool: "action", summary: "No tool named", fingerprint: "0000000000000001" },
    ]);
    // A turn that only proposed is a real turn, not "I didn't catch that".
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "" });
  });

  it("paige_approval_outcome settles the matching card and leaves the others", async () => {
    await turn([
      line({ paige_confirm: { tool: "crm_update", summary: "Move Northwind", fingerprint: "1111111111111111" } }),
      line({ paige_confirm: { tool: "crm_update", summary: "Tag Northwind", fingerprint: "2222222222222222" } }),
      line({ paige_approval_outcome: { actions: [
        { fingerprint: "1111111111111111", outcome: "ran" },
        { fingerprint: "2222222222222222", outcome: "made_up_word" },
      ], note: "One ran." } }),
      "data: [DONE]\n\n",
    ].join(""));
    expect(api.confirms).toEqual([
      { tool: "crm_update", summary: "Move Northwind", fingerprint: "1111111111111111", state: "ran", note: "One ran." },
      { tool: "crm_update", summary: "Tag Northwind", fingerprint: "2222222222222222" },
    ]);
  });

  it("paige_choices: the question is held, and its prompt seeds an empty reply", async () => {
    await turn([
      line({ paige_choices: { prompt: "Which look?", options: [{ label: "Bold", value: "bold", description: "Big type" }, { label: "Calm" }, { value: "no-label" }], multi: true, allow_other: true } }),
      "data: [DONE]\n\n",
    ].join(""));
    expect(api.choices).toEqual({
      prompt: "Which look?",
      options: [{ label: "Bold", value: "bold", description: "Big type" }, { label: "Calm", value: "Calm", description: undefined }],
      multi: true,
      allowOther: true,
    });
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "Which look?" });
  });

  it("paige_choices does not overwrite a reply that already has words", async () => {
    await turn(content("First, one question.") + line({ paige_choices: { prompt: "Which look?", options: [] } }) + "data: [DONE]\n\n");
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "First, one question." });
    expect(api.choices).toEqual({ prompt: "Which look?", options: [], multi: false, allowOther: false });
  });

  it("paige_preview is held; a later saved artifact replaces it and is handed up after the stream", async () => {
    await turn(line({ paige_preview: { kind: "page", title: "Draft home", blocks: [{ type: "hero" }], theme: { tone: "calm" } } }) + "data: [DONE]\n\n");
    expect(api.preview).toEqual({ kind: "page", title: "Draft home", blocks: [{ type: "hero" }], theme: { tone: "calm" } });
    expect(artifacts).toEqual([]);

    await turn(
      line({ paige_preview: { kind: "funnel", blocks: [] } })
      + line({ paige_artifact: { kind: "page", id: "p-1", title: "Old" } })
      + line({ paige_artifact: { kind: "image", id: "img-1", title: "" } })
      + line({ paige_artifact: { kind: "nonsense", id: "x-1" } })
      + content("Saved.")
      + "data: [DONE]\n\n",
      "Save it",
    );
    // Empty blocks never replace a preview; the saved piece clears it.
    expect(api.preview).toBeNull();
    // Last valid artifact wins; an unknown kind keeps the previous one.
    expect(artifacts).toEqual([{ kind: "content", id: "img-1", title: "Untitled" }]);
  });

  it("an empty turn says so in a fixed sentence", async () => {
    await turn("data: [DONE]\n\n");
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "I didn't catch that. Try saying it another way?" });
  });

  it("lines that are not data lines are ignored, and CRLF endings read the same", async () => {
    await turn(": keep-alive\r\n\r\nevent: message\r\n" + "data: " + JSON.stringify({ choices: [{ delta: { content: "Hi." } }] }) + "\r\n\r\n" + "data: [DONE]\r\n\r\n");
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "Hi." });
  });

  it("losing the connection mid-turn rolls the turn back and says so", async () => {
    await turn([
      enc.encode(line({ paige_step: { id: "a", label: "Started" } })),
      enc.encode(content("Half an ans")),
      "BREAK",
    ]);
    expect(api.turns).toEqual([]);
    expect(api.steps).toEqual([]);
    expect(api.sendError).toBe("Paige couldn't take that just now. Check your connection and try again.");
    expect(api.sending).toBe(false);
  });

  const SPLIT_BODY =
    line({ paige_step: { id: "a", label: "Wrote 3 questions — “intake”" } })
    + line({ paige_confirm: { tool: "crm_update", summary: "Move Northwind to Proposal ✓", fingerprint: "a1b2c3d4e5f60718" } })
    + content("Your intake form is ready — ")
    + content("want a pipeline stage? 🚀")
    + "data: [DONE]\n\n";

  it.each([1, 2, 3, 5, 7, 64])("a body cut into %i-byte chunks reads exactly like the whole body", async (size) => {
    await turn(SPLIT_BODY);
    const whole = held();
    // Reset by sending again; the transcript grows, so compare the turn just produced.
    await turn(chunked(SPLIT_BODY, size));
    const cut = held();
    expect(cut.turns.at(-1)).toEqual(whole.turns.at(-1));
    expect(cut.turns.at(-1)).toEqual({ role: "assistant", content: "Your intake form is ready — want a pipeline stage? 🚀" });
    expect(cut.steps).toEqual(whole.steps);
    expect(cut.confirms).toEqual(whole.confirms);
  });
});

describe("useStudioChat ignores frames it does not read (paige_turn, unknown)", () => {
  const TURN_STARTED = line({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } });
  const TURN_DONE = line({ paige_turn: { v: 1, event: "completed", state: "FINAL", mode: "build" } });
  const UNKNOWN = line({ paige_something_new: { anything: "at all", label: "Not a step" } });

  it("a turn with paige_turn and unknown frames holds exactly what the same turn without them holds", async () => {
    const plain = line({ paige_step: { id: "a", label: "Saved the form" } }) + content("Ready.") + "data: [DONE]\n\n";
    await turn(plain);
    const without = held();
    act(() => root.unmount());
    root = createRoot(host);
    act(() => { root.render(<Probe />); });
    await flush();
    artifacts = [];
    await turn(TURN_STARTED + UNKNOWN + line({ paige_step: { id: "a", label: "Saved the form" } }) + TURN_DONE + content("Ready.") + UNKNOWN + "data: [DONE]\n\n");
    expect(held()).toEqual(without);
    expect(host.innerHTML).toBe("");
  });

  it("a turn of ONLY paige_turn and unknown frames is the same empty turn as no frames at all", async () => {
    await turn(TURN_STARTED + UNKNOWN + TURN_DONE + "data: [DONE]\n\n");
    expect(api.turns.at(-1)).toEqual({ role: "assistant", content: "I didn't catch that. Try saying it another way?" });
    expect(api.steps).toEqual([]);
    expect(api.status).toBeNull();
    expect(api.choices).toBeNull();
    expect(api.confirms).toEqual([]);
    expect(api.preview).toBeNull();
    expect(artifacts).toEqual([]);
  });
});
