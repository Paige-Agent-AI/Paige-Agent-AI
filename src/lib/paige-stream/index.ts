// The shared reader for paige-ai-chat's SSE stream (docs/delivery/paige-conversational-loop-c1.md
// decision 6). One framing (framing.ts), one frame typing (decode.ts), and the read loop here.
//
// The surfaces that read this stream genuinely differ in two places, measured before the move, and
// the options keep each one as it was:
//  - whether `[DONE]` ends the read (Studio and the portal send: yes; the operator spine and the
//    portal's opening greeting: no — they read to the end of the body);
//  - what a line that is not JSON does: "skip" drops it and reads on; "stop" ends the read there.
// Everything else — buffering, CR stripping, comment and blank skipping, the final-line flush — is
// the same for everyone.
import { createSseFramer } from "./framing";
import { decodePaigeFrame, type PaigeFrame } from "./decode";

export { createSseFramer, type SseFramer } from "./framing";
export { decodePaigeFrame, type PaigeFrame } from "./decode";

export interface PaigeStreamOptions {
  stopAtDone: boolean;
  malformed: "skip" | "stop";
}

/**
 * Read a response body as typed frames, in wire order. A body that is missing reads as empty. A
 * connection lost mid-stream throws to the caller after the frames that already arrived — the
 * caller's own catch decides what a broken turn means, as it did before.
 */
export async function* readPaigeStream(
  body: ReadableStream<Uint8Array> | null | undefined,
  opts: PaigeStreamOptions,
): AsyncGenerator<PaigeFrame, void, undefined> {
  const reader = body?.getReader();
  if (!reader) return;
  const framer = createSseFramer();
  for (;;) {
    const { done, value } = await reader.read();
    const payloads = done ? framer.end() : framer.push(value);
    for (const payload of payloads) {
      const frame = decodePaigeFrame(payload);
      if (frame.type === "malformed") {
        if (opts.malformed === "skip") continue;
        yield frame;
        return;
      }
      yield frame;
      if (frame.type === "done" && opts.stopAtDone) return;
    }
    if (done) return;
  }
}
