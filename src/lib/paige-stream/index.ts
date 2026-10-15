// The shared reader for paige-ai-chat's SSE stream (docs/delivery/paige-conversational-loop-c1.md
// decision 6). One framing (framing.ts), one frame typing (decode.ts), and the read loop here.
//
// The surfaces that read this stream genuinely differ in two places, measured before the move, and
// the options keep each one as it was:
//  - whether `[DONE]` ends the read (Studio and the portal send: yes; the operator spine and the
//    portal's opening greeting: no — they read to the end of the body);
//  - what a line that is not JSON does: "skip" drops it and reads on; "stop" ends the read there;
//    "drain" yields it, then reads the body to its end yielding nothing more (the dashboard chat,
//    PaigeAIChat, whose old loop stalled on such a line until the body closed — it reads to the
//    body's end and breaks on `[DONE]` itself, so a frame it halts on keeps the turn open past a
//    later `[DONE]` as the old loop did, and reads through readPaigeStreamWithRaw to keep its own
//    branch order over the whole object).
// Everything else — buffering, CR stripping, comment and blank skipping, the final-line flush — is
// the same for everyone.
import { createSseFramer } from "./framing";
import { decodePaigeFrameWithRaw, type PaigeFrame } from "./decode";

export { createSseFramer, type SseFramer } from "./framing";
export { decodePaigeFrame, decodePaigeFrameWithRaw, type PaigeFrame } from "./decode";
export { normalizeStepStatus, settleOpenSteps, type StepStatus } from "./step-status";

export interface PaigeStreamOptions {
  stopAtDone: boolean;
  malformed: "skip" | "stop" | "drain";
}

/**
 * Read a response body as typed frames, in wire order. A body that is missing reads as empty. A
 * connection lost mid-stream throws to the caller after the frames that already arrived — the
 * caller's own catch decides what a broken turn means, as it did before.
 */
export function readPaigeStream(
  body: ReadableStream<Uint8Array> | null | undefined,
  opts: PaigeStreamOptions,
): AsyncGenerator<PaigeFrame, void, undefined> {
  return readDecoded(body, opts, (decoded) => decoded.frame);
}

/**
 * The same read, yielding each frame with the parsed JSON it was named from (decode.ts
 * decodePaigeFrameWithRaw). Identical framing, `[DONE]` and malformed handling — only the item
 * shape differs.
 */
export function readPaigeStreamWithRaw(
  body: ReadableStream<Uint8Array> | null | undefined,
  opts: PaigeStreamOptions,
): AsyncGenerator<{ frame: PaigeFrame; raw: unknown }, void, undefined> {
  return readDecoded(body, opts, (decoded) => decoded);
}

async function* readDecoded<T>(
  body: ReadableStream<Uint8Array> | null | undefined,
  opts: PaigeStreamOptions,
  shape: (decoded: { frame: PaigeFrame; raw: unknown }) => T,
): AsyncGenerator<T, void, undefined> {
  const reader = body?.getReader();
  if (!reader) return;
  const framer = createSseFramer();
  for (;;) {
    const { done, value } = await reader.read();
    const payloads = done ? framer.end() : framer.push(value);
    for (const payload of payloads) {
      const decoded = decodePaigeFrameWithRaw(payload);
      const { frame } = decoded;
      if (frame.type === "malformed") {
        if (opts.malformed === "skip") continue;
        yield shape(decoded);
        if (opts.malformed === "drain") {
          // Nothing after the line is acted on; the read still waits for the body to close.
          for (;;) { if ((await reader.read()).done) return; }
        }
        return;
      }
      yield shape(decoded);
      if (frame.type === "done" && opts.stopAtDone) return;
    }
    if (done) return;
  }
}
export {
  DECISION_REPLY,
  STILL_RESEARCHING,
  TURN_LINE_GATE_MS,
  deriveLiveTurnView,
  deriveSnapshotView,
  formatElapsed,
  decisionCardResult,
  isDecisionReplyText,
  mergeResumedRows,
  outcomeFromRecord,
  readTurnRecord,
  readTurnTrace,
  settleTurnRows,
  upsertTurnRow,
  type AskStanding,
  type LiveTurnInput,
  type TurnEndCause,
  type TurnFooterAction,
  type TurnGlyph,
  type TurnLineKind,
  type TurnOutcome,
  type TurnRow,
  type TurnSnapshot,
  type TurnView,
} from "./turn-view";
