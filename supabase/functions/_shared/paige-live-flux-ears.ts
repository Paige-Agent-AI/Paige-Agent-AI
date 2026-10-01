/** Live ears adapter. The Deepgram socket itself remains in the ONE STT home. */
import { extractDeepgramFluxTurn, openDeepgramSocket, planSttStream } from "./stt-router.ts";

export interface FluxEarsEvents {
  startOfTurn(text: string, turnIndex: number): void;
  partial(text: string, turnIndex: number): void;
  final(text: string, turnIndex: number): void;
  unavailable(): void;
}

export interface FluxEars {
  /** Milliseconds of audio actually handed to the socket (may be fractional). */
  sendPcm(bytes: ArrayBuffer): number | null;
  /** Ask Flux to flush its last Update before closing. */
  close(): void;
  /** Discard an interrupted turn without delivering buffered text. */
  cancel(): void;
}

export type FluxEarsOpenResult =
  | { ok: true; ears: FluxEars }
  | { ok: false; code: "stt_not_configured" | "stt_open_failed" };

/**
 * Opens Flux only through stt-router. Browser PCM is 16 kHz mono linear16.
 * An opener can be injected only by a local no-network harness; production uses
 * openDeepgramSocket, which reasserts mip_opt_out=true at the wire boundary.
 */
export async function openFluxEars(
  events: FluxEarsEvents,
  options: { opener?: (url: string) => WebSocket | null; openTimeoutMs?: number; closeTimeoutMs?: number } = {},
): Promise<FluxEarsOpenResult> {
  // Turn detection is what decides how long Paige waits after you stop talking. Left unset,
  // Deepgram's own defaults govern it and a turn can stay open for seconds of silence. These are
  // deliberately a little eager: in a spoken conversation, answering a beat early reads as
  // attentive, while answering a beat late reads as lag.
  const plan = planSttStream("flux-realtime", {
    encoding: "linear16",
    sampleRate: 16_000,
    eotThreshold: 0.6,
    eotTimeoutMs: 2_000,
  });
  if (!plan.ok) return { ok: false, code: "stt_not_configured" };
  let socket: WebSocket | null;
  try { socket = (options.opener ?? openDeepgramSocket)(plan.url); }
  catch { return { ok: false, code: "stt_open_failed" }; }
  if (!socket) return { ok: false, code: "stt_not_configured" };

  let cancelled = false;
  let finishing = false;
  let forcedClose = false;
  let failed = false;
  let lastSequence = -1;
  let finalTurnIndex = -1;
  let flushedUpdate: { text: string; turnIndex: number } | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const failOnce = () => {
    if (failed || cancelled) return;
    failed = true;
    events.unavailable();
  };

  const opened = await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      resolve(value);
    };
    const openTimer = setTimeout(() => {
      try { socket.close(1011, "stt_open_timeout"); } catch { /* already closed */ }
      settle(false);
    }, options.openTimeoutMs ?? 5000);
    socket.onopen = () => settle(true);
    socket.onerror = () => {
      failOnce();
      try { socket.close(1011, "stt_error"); } catch { /* already closed */ }
      settle(false);
    };
    socket.onclose = (event) => {
      if (closeTimer) clearTimeout(closeTimer);
      // Flux documents a normal CloseStream shutdown with no status code
      // (the browser reports reserved code 1005). Also tolerate an explicit
      // normal 1000; 1008/1011 are errors even if the handshake was clean.
      const providerClosedNormally = event.wasClean && (event.code === 1005 || event.code === 1000);
      // CloseStream's last transcript is an Update, not an EndOfTurn. It is
      // final only when we deliberately asked Flux to flush and then closed.
      if (finishing && providerClosedNormally && !forcedClose && !cancelled && !failed &&
        flushedUpdate && flushedUpdate.turnIndex !== finalTurnIndex) {
        events.final(flushedUpdate.text, flushedUpdate.turnIndex);
      } else if (!finishing || (finishing && !providerClosedNormally)) failOnce();
      settle(false);
    };
    socket.onmessage = (message) => {
      if (failed || cancelled) return;
      const turn = extractDeepgramFluxTurn(message.data);
      if (!turn || turn.sequenceId <= lastSequence) return;
      lastSequence = turn.sequenceId;
      if (turn.event === "StartOfTurn") events.startOfTurn(turn.transcript, turn.turnIndex);
      else if (turn.isFinal) {
        finalTurnIndex = turn.turnIndex;
        flushedUpdate = null;
        events.final(turn.transcript, turn.turnIndex);
      } else if (turn.event === "Update") {
        if (finishing) flushedUpdate = { text: turn.transcript, turnIndex: turn.turnIndex };
        events.partial(turn.transcript, turn.turnIndex);
      }
    };
  });
  if (!opened) return { ok: false, code: "stt_open_failed" };

  return {
    ok: true,
    ears: {
      sendPcm(bytes) {
        if (failed || cancelled || finishing || socket.readyState !== WebSocket.OPEN ||
          bytes.byteLength < 2 || bytes.byteLength > 32_000 || bytes.byteLength % 2 !== 0) return null;
        try {
          socket.send(bytes);
          return bytes.byteLength / 2 / 16;
        } catch {
          failOnce();
          return null;
        }
      },
      close() {
        if (finishing || cancelled) return;
        flushedUpdate = null;
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: "CloseStream" }));
            finishing = true;
          } catch {
            failOnce();
            try { socket.close(1011, "stt_close_failed"); } catch { /* already closed */ }
            return;
          }
          closeTimer = setTimeout(() => {
            if (socket.readyState !== WebSocket.CLOSED) {
              forcedClose = true;
              failOnce();
              socket.close(1000, "relay_end");
            }
          }, options.closeTimeoutMs ?? 3000);
        } else if (socket.readyState !== WebSocket.CLOSED) {
          failOnce();
          try { socket.close(1000, "relay_end"); } catch { /* already closed */ }
        }
      },
      cancel() {
        if (cancelled) return;
        cancelled = true;
        if (closeTimer) clearTimeout(closeTimer);
        if (socket.readyState !== WebSocket.CLOSED) {
          try { socket.close(1000, "relay_cancel"); } catch { /* already closed */ }
        }
      },
    },
  };
}
