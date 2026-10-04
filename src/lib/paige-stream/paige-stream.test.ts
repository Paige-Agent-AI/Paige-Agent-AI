/**
 * The shared PAIGE stream reader: line framing, frame decoding, and the read loop that joins them.
 * docs/delivery/paige-conversational-loop-c1.md decision 6. Pure; no network, no React.
 */
import { describe, expect, it } from "vitest";

import { createSseFramer, decodePaigeFrame, decodePaigeFrameWithRaw, readPaigeStream, readPaigeStreamWithRaw, type PaigeFrame, type PaigeStreamOptions } from "./index";
import { turnFrame, turnFrameLine } from "../../../supabase/functions/_shared/paige-turn/contract";

const enc = new TextEncoder();

/** Delivered one piece per read, so a failure lands AFTER the pieces before it were read (erroring
 *  inside start() would discard the queue). */
function bodyOf(pieces: (string | Uint8Array)[], opts: { failAfter?: boolean } = {}): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < pieces.length) { const p = pieces[i++]; c.enqueue(typeof p === "string" ? enc.encode(p) : p); return; }
      if (opts.failAfter) c.error(new TypeError("network connection was lost"));
      else c.close();
    },
  });
}

function chunked(body: string, size: number): Uint8Array[] {
  const all = enc.encode(body);
  const out: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

async function readAll(body: ReadableStream<Uint8Array> | null | undefined, opts: PaigeStreamOptions): Promise<PaigeFrame[]> {
  const out: PaigeFrame[] = [];
  for await (const f of readPaigeStream(body, opts)) out.push(f);
  return out;
}

const SKIP_AT_DONE: PaigeStreamOptions = { stopAtDone: true, malformed: "skip" };
const SKIP_THROUGH: PaigeStreamOptions = { stopAtDone: false, malformed: "skip" };
const line = (payload: unknown) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
const content = (text: string) => line({ choices: [{ delta: { content: text } }] });

describe("createSseFramer — line framing", () => {
  it("returns the payload of each complete data line, trimmed", () => {
    const f = createSseFramer();
    expect(f.push(enc.encode('data: {"a":1}\n\ndata:   [DONE]  \n'))).toEqual(['{"a":1}', "[DONE]"]);
    expect(f.end()).toEqual([]);
  });

  it("keeps a partial line until its newline arrives, across any number of chunks", () => {
    const f = createSseFramer();
    expect(f.push(enc.encode('data: {"choi'))).toEqual([]);
    expect(f.push(enc.encode('ces":[]'))).toEqual([]);
    expect(f.push(enc.encode('}\nda'))).toEqual(['{"choices":[]}']);
    expect(f.push(enc.encode('ta: x\n'))).toEqual(["x"]);
  });

  it("decodes a multi-byte character split across chunks (TextDecoder stream mode)", () => {
    const f = createSseFramer();
    const bytes = enc.encode("data: 🚀✓\n");
    const out = [...f.push(bytes.slice(0, 8)), ...f.push(bytes.slice(8, 9)), ...f.push(bytes.slice(9)), ...f.end()];
    expect(out).toEqual(["🚀✓"]);
  });

  it("strips a trailing \\r, so CRLF streams read the same", () => {
    const f = createSseFramer();
    expect(f.push(enc.encode("data: one\r\n\r\ndata: two\r\n"))).toEqual(["one", "two"]);
  });

  it("skips comments, blank lines and non-data fields", () => {
    const f = createSseFramer();
    expect(f.push(enc.encode(": keep-alive\n\n   \nevent: message\nid: 7\nretry: 10\ndata:nospace\ndata: kept\n"))).toEqual(["kept"]);
  });

  it("flushes a final line that never got its newline when the stream ends", () => {
    const f = createSseFramer();
    expect(f.push(enc.encode("data: one\ndata: tw"))).toEqual(["one"]);
    expect(f.push(enc.encode("o"))).toEqual([]);
    expect(f.end()).toEqual(["two"]);
  });

  it("flushes a final character whose last bytes never arrived as a replacement, not a throw", () => {
    const f = createSseFramer();
    const bytes = enc.encode("data: ok🚀");
    expect(f.push(bytes.slice(0, bytes.length - 1))).toEqual([]);
    expect(f.end()).toEqual(["ok�"]);
  });

  it("a final unterminated comment or non-data line flushes to nothing", () => {
    const f = createSseFramer();
    f.push(enc.encode(": tail"));
    expect(f.end()).toEqual([]);
  });
});

describe("decodePaigeFrame — frame typing", () => {
  it.each<[string, unknown, PaigeFrame]>([
    ["[DONE]", "[DONE]", { type: "done" }],
    ["content", { choices: [{ delta: { content: "Hi" } }] }, { type: "content", text: "Hi" }],
    ["empty content", { choices: [{ delta: { content: "" } }] }, { type: "content", text: "" }],
    ["paige_step", { paige_step: { id: "0:a", label: "Read your goals" } }, { type: "step", step: { id: "0:a", label: "Read your goals" } }],
    ["paige_phase", { paige_phase: "writing" }, { type: "phase", phase: "writing" }],
    ["paige_confirm", { paige_confirm: { summary: "Move it", fingerprint: "a1b2c3d4e5f60718" } }, { type: "confirm", confirm: { summary: "Move it", fingerprint: "a1b2c3d4e5f60718" } }],
    ["paige_approval_outcome", { paige_approval_outcome: { actions: [] } }, { type: "approval_outcome", outcome: { actions: [] } }],
    ["paige_choices", { paige_choices: { prompt: "Which?", options: [] } }, { type: "choices", choices: { prompt: "Which?", options: [] } }],
    ["paige_artifact", { paige_artifact: { kind: "form", id: "f-1" } }, { type: "artifact", artifact: { kind: "form", id: "f-1" } }],
    ["paige_preview", { paige_preview: { kind: "page", blocks: [] } }, { type: "preview", preview: { kind: "page", blocks: [] } }],
    ["sync_status", { sync_status: { success: true } }, { type: "sync_status", syncStatus: { success: true } }],
    ["paige_withheld", { paige_withheld: true }, { type: "withheld" }],
  ])("%s", (_name, payload, expected) => {
    expect(decodePaigeFrame(typeof payload === "string" ? payload : JSON.stringify(payload))).toEqual(expected);
  });

  it("paige_turn: a frame inside the contract is typed; anything else is unknown", () => {
    const started = turnFrame("started", "WORKING", "pending");
    // The exact line the server writes, read back.
    const wire = turnFrameLine(started).replace(/^data: /, "").trim();
    expect(decodePaigeFrame(wire)).toEqual({ type: "turn", turn: { v: 1, event: "started", state: "WORKING", mode: "pending" } });
    for (const bad of [
      { v: 1, event: "started", state: "WORKING", mode: "pending", summary: "prose rides along" },
      { v: 2, event: "started", state: "WORKING", mode: "pending" },
      { v: 1, event: "began", state: "WORKING", mode: "pending" },
      { v: 1, event: "completed", state: "DONE", mode: "answer" },
      "started",
      null,
    ]) {
      expect(decodePaigeFrame(JSON.stringify({ paige_turn: bad }))).toEqual({ type: "unknown", frame: { paige_turn: bad } });
    }
  });

  it("an unknown key, a falsy known key, or a non-object JSON value is unknown — never a throw", () => {
    expect(decodePaigeFrame('{"paige_something_new":{"label":"x"}}')).toEqual({ type: "unknown", frame: { paige_something_new: { label: "x" } } });
    expect(decodePaigeFrame('{"paige_step":null}')).toEqual({ type: "unknown", frame: { paige_step: null } });
    expect(decodePaigeFrame('{"paige_withheld":false}')).toEqual({ type: "unknown", frame: { paige_withheld: false } });
    expect(decodePaigeFrame('{"choices":[{"delta":{"paige_thinking":"hm"}}]}')).toEqual({ type: "unknown", frame: { choices: [{ delta: { paige_thinking: "hm" } }] } });
    expect(decodePaigeFrame('{"choices":[{"delta":{"content":5}}]}')).toEqual({ type: "unknown", frame: { choices: [{ delta: { content: 5 } }] } });
    for (const v of ["null", "5", '"text"', "[1,2]", "true"]) expect(decodePaigeFrame(v)).toEqual({ type: "unknown", frame: JSON.parse(v) });
  });

  it("a line that is not JSON is malformed — never a throw", () => {
    for (const v of ["{not json", "", "{\"choices\":", "undefined"]) expect(decodePaigeFrame(v)).toEqual({ type: "malformed" });
  });

  it("a frame carrying a falsy known key falls through to the next one it does carry", () => {
    expect(decodePaigeFrame(JSON.stringify({ paige_step: null, choices: [{ delta: { content: "Hi" } }] }))).toEqual({ type: "content", text: "Hi" });
  });
});

describe("readPaigeStream — the read loop", () => {
  it("yields typed frames in wire order", async () => {
    const frames = await readAll(bodyOf([line({ paige_step: { id: "a", label: "One" } }), content("Hi"), "data: [DONE]\n\n"]), SKIP_AT_DONE);
    expect(frames).toEqual([{ type: "step", step: { id: "a", label: "One" } }, { type: "content", text: "Hi" }, { type: "done" }]);
  });

  it("stopAtDone: true ends the read at [DONE], even mid-chunk", async () => {
    const frames = await readAll(bodyOf([content("A") + "data: [DONE]\n\n" + content("B"), content("C")]), SKIP_AT_DONE);
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "done" }]);
  });

  it("stopAtDone: false reads past [DONE] to the end of the body", async () => {
    const frames = await readAll(bodyOf([content("A") + "data: [DONE]\n\n" + content("B"), "data: [DONE]\n\n"]), SKIP_THROUGH);
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "done" }, { type: "content", text: "B" }, { type: "done" }]);
  });

  it("malformed: \"skip\" drops the bad line and keeps reading", async () => {
    const frames = await readAll(bodyOf([content("A"), "data: {not json\n\n", content("B")]), SKIP_AT_DONE);
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "content", text: "B" }]);
  });

  it("malformed: \"stop\" ends the read at the bad line and says so", async () => {
    const frames = await readAll(bodyOf([content("A"), "data: {not json\n\n", content("B")]), { stopAtDone: true, malformed: "stop" });
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "malformed" }]);
  });

  it("malformed: \"drain\" yields the bad line, then reads the body to its end yielding nothing more", async () => {
    let n = 0;
    const pieces = [content("A"), "data: {not json\n\n", content("B"), line("[DONE]"), content("C")];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (n < pieces.length) controller.enqueue(enc.encode(pieces[n++]));
        else controller.close();
      },
    });
    const frames = await readAll(body, { stopAtDone: true, malformed: "drain" });
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "malformed" }]);
    // Every piece was read — the read waited for the body to close, as the stalled loop did.
    expect(n).toBe(pieces.length);
  });

  it("a final line without its newline is still delivered when the body ends", async () => {
    const frames = await readAll(bodyOf([content("A"), 'data: {"choices":[{"delta":{"content":"B"}}]}']), SKIP_AT_DONE);
    expect(frames).toEqual([{ type: "content", text: "A" }, { type: "content", text: "B" }]);
  });

  it("no body reads as an empty stream", async () => {
    expect(await readAll(null, SKIP_AT_DONE)).toEqual([]);
    expect(await readAll(undefined, SKIP_THROUGH)).toEqual([]);
  });

  it("a connection lost mid-stream throws to the caller after what already arrived", async () => {
    const seen: PaigeFrame[] = [];
    await expect((async () => {
      for await (const f of readPaigeStream(bodyOf([content("A"), 'data: {"choi'], { failAfter: true }), SKIP_AT_DONE)) seen.push(f);
    })()).rejects.toThrow("network connection was lost");
    expect(seen).toEqual([{ type: "content", text: "A" }]);
  });

  const BODY =
    line(JSON.parse(turnFrameLine(turnFrame("started", "WORKING", "pending")).slice(6)))
    + line({ paige_step: { id: "0:a", label: "Read your goals — “first month”" } })
    + ": keep-alive\r\n\r\n"
    + line({ paige_confirm: { summary: "Move Northwind ✓", fingerprint: "a1b2c3d4e5f60718" } })
    + content("Start with your intake call — 🚀")
    + line(JSON.parse(turnFrameLine(turnFrame("completed", "FINAL", "action")).slice(6)))
    + "data: [DONE]\n\n";

  it.each([1, 2, 3, 5, 7, 64, 100000])("a body cut into %i-byte chunks yields exactly what the whole body yields", async (size) => {
    const whole = await readAll(bodyOf([BODY]), SKIP_AT_DONE);
    expect(whole.map((f) => f.type)).toEqual(["turn", "step", "confirm", "content", "turn", "done"]);
    expect(await readAll(bodyOf(chunked(BODY, size)), SKIP_AT_DONE)).toEqual(whole);
  });
});

describe("the raw variants — the same frames, plus the JSON they were named from", () => {
  it("decodePaigeFrameWithRaw names the frame exactly as decodePaigeFrame does and keeps the whole object", () => {
    for (const payload of [
      "[DONE]", "{not json", "null", "5",
      JSON.stringify({ paige_step: { id: "a" }, paige_live_output: "x" }),
      JSON.stringify({ paige_phase: "thinking", choices: [{ delta: { content: "Hi" } }] }),
      JSON.stringify({ sync_status: { ok: true }, extraction_proposal: { id: "p" } }),
    ]) {
      const { frame, raw } = decodePaigeFrameWithRaw(payload);
      expect(frame).toEqual(decodePaigeFrame(payload));
      if (payload === "[DONE]" || payload === "{not json") expect(raw).toBeUndefined();
      else expect(raw).toEqual(JSON.parse(payload));
    }
  });

  it("readPaigeStreamWithRaw yields the frames readPaigeStream yields, under every option", async () => {
    const pieces = [content("A"), line({ paige_step: { id: "s" }, paige_live_output: "x" }), "data: {not json\n\n", content("B"), "data: [DONE]\n\n", content("C")];
    for (const opts of [SKIP_AT_DONE, SKIP_THROUGH, { stopAtDone: true, malformed: "stop" } as PaigeStreamOptions]) {
      const plain = await readAll(bodyOf(pieces), opts);
      const withRaw: Array<{ frame: PaigeFrame; raw: unknown }> = [];
      for await (const item of readPaigeStreamWithRaw(bodyOf(pieces), opts)) withRaw.push(item);
      expect(withRaw.map((item) => item.frame)).toEqual(plain);
    }
    const first: Array<{ frame: PaigeFrame; raw: unknown }> = [];
    for await (const item of readPaigeStreamWithRaw(bodyOf(pieces), SKIP_AT_DONE)) first.push(item);
    expect(first[1]).toEqual({ frame: { type: "step", step: { id: "s" } }, raw: { paige_step: { id: "s" }, paige_live_output: "x" } });
  });
});
