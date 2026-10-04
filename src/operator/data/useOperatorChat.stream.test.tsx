/**
 * useOperatorChat — how the operator spine reads Paige's stream, pinned frame by frame.
 *
 * CHARACTERIZATION (docs/delivery/paige-conversational-loop-c1.md, failing-first plan step 4).
 * Written against the hand-written parser BEFORE it moved onto the shared src/lib/paige-stream
 * reader; it must stay green, assertions untouched, after the move. It pins the transcript the
 * hook holds — her turn's body, whether it is still streaming, the approval plate after it — not
 * how the spine draws any of it (useOperatorChat.approval.test.tsx covers the drawn plate).
 *
 * EVIDENCE CLASS (§32/§70.1): automated, jsdom, scripted SSE behind a stubbed fetch. Synthetic.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOperatorChat, type OperatorChat } from "@/operator/data/useOperatorChat";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test" } } })) } },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const line = (payload: unknown) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n`;
const content = (text: string) => line({ choices: [{ delta: { content: text } }] });
const confirm = (summary: unknown, fingerprint?: string, tool = "crm_update") =>
  line({ paige_confirm: { tool, summary, ...(fingerprint ? { fingerprint } : {}) } });

function chunked(body: string, size: number): Uint8Array[] {
  const all = enc.encode(body);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

let chat: OperatorChat;
let controller: ReadableStreamDefaultController<Uint8Array> | null;
let served: Uint8Array[] | null;
let host: HTMLDivElement;
let root: Root;

function Probe() {
  chat = useOperatorChat();
  return null;
}

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

/** The transcript as data: the handlers on a plate are reduced to whether they exist. */
const transcript = () => chat.transcript.map((t) => ({
  id: t.id, who: t.who, body: t.body, streaming: t.streaming, tone: t.tone, actItems: t.actItems, act: t.act,
  canAct: typeof t.onAct === "function",
}));

beforeEach(async () => {
  controller = null;
  served = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    start(c) {
      if (!served) { controller = c; return; }
      for (const piece of served) c.enqueue(piece);
      c.close();
    },
  }), { status: 200 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function turn(body: string | Uint8Array[], say = "What's on today?") {
  served = typeof body === "string" ? [enc.encode(body)] : body;
  await act(async () => { chat.send(say); });
  await flush();
}

const hers = () => transcript().find((t) => t.id === "a2");

describe("useOperatorChat reads the stream (characterization)", () => {
  it("[DONE] is NOT terminal here: words after it still reach her turn", async () => {
    await turn(content("Two meetings.") + "data: [DONE]\n" + content(" And one call."));
    expect(hers()).toMatchObject({ body: "Two meetings. And one call.", streaming: false });
  });

  it("a malformed line is skipped and the rest of her answer arrives", async () => {
    await turn(content("Before. ") + "data: {not json\n" + content("After.") + "data: [DONE]\n");
    expect(hers()).toMatchObject({ body: "Before. After.", streaming: false, tone: undefined });
  });

  it("frames it does not read leave no trace", async () => {
    await turn(
      line({ paige_step: { id: "a", label: "Looked at the calendar", kind: "action", status: "done" } })
      + line({ paige_phase: "writing" })
      + line({ paige_choices: { prompt: "Which?", options: [{ label: "A" }] } })
      + content("Two meetings.")
      + "data: [DONE]\n",
    );
    expect(transcript()).toEqual([
      { id: "u1", who: "You", body: "What's on today?", streaming: undefined, tone: undefined, actItems: undefined, act: undefined, canAct: false },
      { id: "a2", who: "Paige", body: "Two meetings.", streaming: false, tone: undefined, actItems: undefined, act: undefined, canAct: false },
    ]);
  });

  it("her turn fills as tokens arrive, and the approval plate appears only once the stream ends", async () => {
    await act(async () => { chat.send("Move Northwind"); });
    await flush();
    expect(hers()).toMatchObject({ body: "", streaming: true });
    await act(async () => {
      controller!.enqueue(enc.encode(content("One change to approve.")));
      controller!.enqueue(enc.encode(confirm("Move Northwind to Proposal", "a1b2c3d4e5f60718")));
    });
    await flush();
    expect(hers()).toMatchObject({ body: "One change to approve.", streaming: true });
    expect(transcript()).toHaveLength(2);
    expect(chat.busy).toBe(true);
    await act(async () => { controller!.close(); });
    await flush();
    expect(chat.busy).toBe(false);
    expect(transcript()).toEqual([
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ id: "a2", body: "One change to approve.", streaming: false }),
      { id: "c3", who: "Paige — needs your OK", body: "", streaming: undefined, tone: "gold", actItems: ["Move Northwind to Proposal"], act: "Approve", canAct: true },
    ]);
  });

  it("confirms de-dupe by fingerprint, else by sentence; a non-string summary is not a confirm", async () => {
    await turn(
      confirm("Move Northwind to Proposal", "1111111111111111")
      + confirm("Worded differently, same call", "1111111111111111")
      + confirm("Tag Northwind")
      + confirm("Tag Northwind")
      + confirm("Archive the old deal", "2222222222222222")
      + confirm(42 as unknown as string, "3333333333333333")
      + "data: [DONE]\n",
    );
    // All proposal, no prose: her empty bubble is dropped and the plate stands in for it.
    expect(transcript().map((t) => t.id)).toEqual(["u1", "c3"]);
    expect(transcript()[1]).toMatchObject({
      who: "Paige — needs your OK · 3 actions",
      actItems: ["Move Northwind to Proposal", "Tag Northwind", "Archive the old deal"],
      act: "Approve all",
      canAct: true,
    });
  });

  it("a plate whose confirms carry no fingerprint lists them with no Approve", async () => {
    await turn(content("I need an OK.") + confirm("Tag Northwind") + "data: [DONE]\n");
    expect(transcript().at(-1)).toMatchObject({ actItems: ["Tag Northwind"], act: undefined, canAct: false });
  });

  it("an empty stream is a named failure, not a blank bubble", async () => {
    await turn("data: [DONE]\n");
    expect(hers()).toMatchObject({ body: "The connection held but she sent nothing back. Nothing was saved.", tone: "negative", streaming: false });
  });

  it("lines that are not data lines are ignored, and CRLF endings read the same", async () => {
    await turn(": keep-alive\r\n\r\nevent: message\r\n" + "data: " + JSON.stringify({ choices: [{ delta: { content: "Hi." } }] }) + "\r\n\r\n" + "data: [DONE]\r\n");
    expect(hers()).toMatchObject({ body: "Hi.", streaming: false });
  });

  const SPLIT_BODY =
    content("Northwind — “Proposal” stage ✓ ")
    + confirm("Move Northwind to Proposal 🚀", "a1b2c3d4e5f60718")
    + content("ready when you are.")
    + "data: [DONE]\n";

  it.each([1, 2, 3, 5, 7, 64])("a body cut into %i-byte chunks reads exactly like the whole body", async (size) => {
    await turn(chunked(SPLIT_BODY, size));
    expect(transcript().slice(1)).toEqual([
      { id: "a2", who: "Paige", body: "Northwind — “Proposal” stage ✓ ready when you are.", streaming: false, tone: undefined, actItems: undefined, act: undefined, canAct: false },
      { id: "c3", who: "Paige — needs your OK", body: "", streaming: undefined, tone: "gold", actItems: ["Move Northwind to Proposal 🚀"], act: "Approve", canAct: true },
    ]);
  });
});

describe("useOperatorChat ignores frames it does not read (paige_turn, unknown)", () => {
  const TURN_STARTED = line({ paige_turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } });
  const TURN_WAITING = line({ paige_turn: { v: 1, event: "waiting", state: "WAIT_APPROVAL", mode: "action" } });
  const UNKNOWN = line({ paige_something_new: { summary: "Not a confirm", label: "Not a step" } });

  it("a turn with paige_turn and unknown frames holds exactly what the same turn without them holds", async () => {
    const plain = content("One change to approve.") + confirm("Move Northwind to Proposal", "a1b2c3d4e5f60718") + "data: [DONE]\n";
    await turn(plain);
    const without = transcript();
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
    await turn(TURN_STARTED + UNKNOWN + content("One change to approve.") + confirm("Move Northwind to Proposal", "a1b2c3d4e5f60718") + TURN_WAITING + UNKNOWN + "data: [DONE]\n");
    expect(transcript()).toEqual(without);
    expect(host.innerHTML).toBe("");
  });

  it("a turn of ONLY paige_turn and unknown frames is the same empty turn as no frames at all", async () => {
    await turn(TURN_STARTED + UNKNOWN + TURN_WAITING + "data: [DONE]\n");
    expect(transcript()).toHaveLength(2);
    expect(hers()).toMatchObject({ body: "The connection held but she sent nothing back. Nothing was saved.", tone: "negative" });
  });
});
