// _shared/elevenlabs.ts — low-level ElevenLabs text-to-speech transport.
//
// Callers must resolve the provider reference through the service-only Paige Voice Profile and
// readiness gate before entering this adapter. This file owns transport only.
//
// FAIL-CLOSED (doctrine §13): ELEVENLABS_API_KEY is read at CALL time; if absent we throw
// NeedsConfigError("elevenlabs") — never a generic crash, never fake audio. The key is very
// never inferred present from a deployment. HTTP uses a header; Live WSS uses its first server-only
// frame. The key is NEVER logged/echoed/placed in a URL or returned result.

import { NeedsConfigError, type ProviderCallResult } from "./provider-types.ts";
import { envKey } from "./env-key.ts";

// Local declaration keeps the shared adapter type-checkable in the Node test graph.
declare const Deno: { env: { get(name: string): string | undefined } };
const ELEVENLABS_BASE = Deno.env.get("ELEVENLABS_BASE_URL") ?? "https://api.elevenlabs.io/v1";
export const APPROVED_PAIGE_ELEVENLABS_VOICE_ID = "g6xIsTj2HwM6VR4iXFCw";
export type PaigeElevenLabsModel = "eleven_v3_conversational" | "eleven_v3";

/** The owner may switch models by server secret/config only; legacy models fail closed. */
export function resolveElevenLabsModel(): PaigeElevenLabsModel | null {
  const configured = envKey("ELEVENLABS_MODEL")?.trim() || "eleven_v3_conversational";
  return configured === "eleven_v3_conversational" || configured === "eleven_v3" ? configured : null;
}

function elevenlabsKey(): string {
  const k = envKey("ELEVENLABS_API_KEY");
  if (!k) throw new NeedsConfigError("elevenlabs");
  return k;
}

export interface ElevenLabsTtsInput {
  text: string;
  /** Required server-resolved provider reference. There is deliberately no provider default. */
  voiceId: string;
  modelId?: string;
}

/**
 * Render `text` to speech via ElevenLabs and return the mp3 bytes. Throws NeedsConfigError when
 * the key is unset (honest degrade) and a typed Error on an API failure — never a fake artifact.
 */
async function speechResponse(opts: ElevenLabsTtsInput, stream: boolean, signal?: AbortSignal): Promise<{ response: Response; modelId: PaigeElevenLabsModel }> {
  const key = elevenlabsKey();
  const voiceId = opts.voiceId;
  if (voiceId !== APPROVED_PAIGE_ELEVENLABS_VOICE_ID) {
    throw new NeedsConfigError("elevenlabs:approved_voice");
  }
  const modelId = opts.modelId || resolveElevenLabsModel();
  if (modelId !== "eleven_v3_conversational" && modelId !== "eleven_v3") {
    throw new NeedsConfigError("elevenlabs:approved_model");
  }
  // The server-resolved reference is still encoded so no unexpected provider value can reshape
  // the request path (§13 secure-by-construction).
  const suffix = stream ? "/stream" : "";
  const query = stream ? "enable_logging=false&output_format=pcm_16000" : "enable_logging=false";
  const resp = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}${suffix}?${query}`, {
    method: "POST",
    // Key in the xi-api-key header only — never the URL — so a network-level fetch reject
    // (which echoes the request URL into a TypeError) can never leak the secret.
    headers: { "xi-api-key": key, "content-type": "application/json", accept: stream ? "audio/pcm" : "audio/mpeg" },
    body: JSON.stringify({ text: opts.text, model_id: modelId }),
    signal,
  });
  if (!resp.ok) {
    // A provider error body could echo the submitted text. Do not put it in
    // an exception or log; only the HTTP status is safe to surface internally.
    throw new Error(`ElevenLabs HTTP ${resp.status}`);
  }
  return { response: resp, modelId };
}

export interface ElevenLabsLiveInput extends ElevenLabsTtsInput {
  /** Required from canonical scoped admission, never supplied by the browser. */
  retentionPolicy: "default_provider_retention";
}

/**
 * Live-only v3 dialogue transport. Preserve the existing PCM Response/body seam.
 * https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket (2026-09-24).
 * Default retention is explicitly authorized by scoped admission, NOT verified zero retention.
 * One queued speech batch owns one socket. Only is_final confirms all audio was flushed.
 */
export async function elevenlabsSpeechStream(opts: ElevenLabsLiveInput, signal: AbortSignal): Promise<Response> {
  if (opts.retentionPolicy !== "default_provider_retention") throw new NeedsConfigError("elevenlabs:retention_policy");
  if (opts.voiceId !== APPROVED_PAIGE_ELEVENLABS_VOICE_ID) throw new NeedsConfigError("elevenlabs:approved_voice");
  const model = opts.modelId || resolveElevenLabsModel();
  if (model !== "eleven_v3_conversational" && model !== "eleven_v3") throw new NeedsConfigError("elevenlabs:approved_model");
  if (signal.aborted) throw new Error("mouth_cancelled");
  const key = elevenlabsKey();
  if (!opts.text.trim()) throw new Error("mouth_empty_text");
  const url = new URL("wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input");
  url.searchParams.set("model_id", model);
  url.searchParams.set("output_format", "pcm_16000");
  url.searchParams.set("enable_logging", "true");
  let socket: WebSocket | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let settled = false;
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    // Cancellation never sends close_socket (which would flush more speech).
    try { socket.close(); } catch { /* already closed or interrupted during handshake */ }
  };
  const fail = (code: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    controller.error(new Error(code));
  };
  const abort = () => fail("mouth_cancelled");
  const deadline = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => fail("mouth_timeout"), ms);
  };
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try { socket = new WebSocket(url.toString()); } catch { fail("mouth_unavailable"); return; }
      deadline(8_000);
      socket.onopen = () => {
        if (settled) return;
        try {
          socket!.send(JSON.stringify({ voices: [opts.voiceId], xi_api_key: key }));
          socket!.send(JSON.stringify({ inputs: [{ text: opts.text, voice_id: opts.voiceId }] }));
          // Also flushes sentences below the provider's minimum context threshold.
          socket!.send(JSON.stringify({ close_socket: true }));
          deadline(10_000);
        } catch { fail("mouth_unavailable"); }
      };
      socket.onmessage = (event) => {
        if (settled) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 1_048_576) throw new Error();
          const frame: unknown = JSON.parse(event.data);
          if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error();
          const message = frame as Record<string, unknown>;
          if ("error" in message || "message" in message || "detail" in message) throw new Error();
          if (message.audio !== undefined) {
            if (typeof message.audio !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.audio)) throw new Error();
            const decoded = atob(message.audio);
            if (decoded.length > (controller.desiredSize ?? 0)) throw new Error();
            if (decoded.length) {
              controller.enqueue(Uint8Array.from(decoded, (char) => char.charCodeAt(0)));
              bytes += decoded.length;
              deadline(10_000);
            }
          }
          if (message.is_final === true) {
            if (!bytes || bytes % 2) throw new Error();
            settled = true;
            cleanup();
            controller.close();
          }
          // Turn-final is not session completion. Metadata cannot extend the deadline.
        } catch { fail("mouth_invalid_stream"); }
      };
      socket.onerror = () => fail("mouth_unavailable");
      socket.onclose = () => fail("mouth_incomplete_stream");
    },
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: 524_288 }));
  return new Response(body, { headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store" } });
}

export async function elevenlabsTts(opts: ElevenLabsTtsInput): Promise<ProviderCallResult> {
  const started = Date.now();
  const { response: resp, modelId } = await speechResponse(opts, false);

  // The endpoint returns the rendered audio as the raw response body (no JSON envelope).
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length === 0) throw new Error("ElevenLabs: empty audio response");
  return {
    artifact_bytes: bytes,
    artifact_mime: "audio/mpeg",
    provider: "elevenlabs",
    model: modelId,
    latency_ms: Date.now() - started,
  };
}
