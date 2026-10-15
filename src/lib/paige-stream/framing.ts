// SSE line framing for the paige-ai-chat stream — the one place a byte stream becomes data lines.
//
// docs/delivery/paige-conversational-loop-c1.md decision 6. Before this, every surface hand-wrote
// its own loop, and they disagreed: one decoded each chunk on its own with no carried tail, so a
// line or a character cut by a chunk boundary was lost. Here the buffer persists across chunks, the
// decoder runs in stream mode, and the last line is flushed even if the body ends without its
// newline. What a payload MEANS is decode.ts's job, not this file's.

const DATA_PREFIX = "data: ";

/**
 * One line in, its data payload out, or null for anything that is not a data line. Two rules do all
 * of it: a comment (": keep-alive"), a blank separator and the fields this stream never relies on
 * (event:, id:, retry:) fail the prefix, and the trim takes a CRLF line's trailing \r with it.
 */
function dataPayload(line: string): string | null {
  if (!line.startsWith(DATA_PREFIX)) return null;
  return line.slice(DATA_PREFIX.length).trim();
}

export interface SseFramer {
  /** Feed one chunk; returns the payloads of the lines it completed, in order. */
  push(chunk: Uint8Array): string[];
  /** The body ended: flush the decoder and any final line that never got its newline. */
  end(): string[];
}

export function createSseFramer(): SseFramer {
  const decoder = new TextDecoder();
  let buffer = "";

  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const payload = dataPayload(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (payload !== null) out.push(payload);
    }
    if (final && buffer) {
      const payload = dataPayload(buffer);
      buffer = "";
      if (payload !== null) out.push(payload);
    }
    return out;
  };

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      return drain(false);
    },
    end() {
      buffer += decoder.decode();
      return drain(true);
    },
  };
}
