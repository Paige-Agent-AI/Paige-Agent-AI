// _shared/stt-router.ts — Paige STT Router (#140 B1). The ONE home for speech-to-text (§18/§34).
//
// Mirrors the model-router ROUTE_TABLE pattern: a keyed table of cells, a pure route-picker, and
// an honest needs_config degrade when the provider is unconfigured — NEVER a wrong-provider
// substitution. §34: Deepgram is a routable STT commodity BEHIND our router; Paige owns the
// orchestration. There is exactly one Deepgram client on the platform, and it lives here — no
// second Deepgram connection anywhere else.
//
// Deepgram Nova-3 streaming STT is a WebSocket:
//   wss://api.deepgram.com/v1/listen?model=nova-3&encoding=mulaw&sample_rate=8000&channels=1&…
// Twilio Media Stream audio is 8 kHz mono μ-law, so encoding=mulaw&sample_rate=8000&channels=1
// hands Deepgram exactly what it needs — no transcoding. Auth: Deno's WebSocket cannot set
// headers, so we use Deepgram's `token` subprotocol — new WebSocket(url, ["token", <API_KEY>]) —
// the documented browser/edge auth path. The key is read HERE via envKey (case-insensitive, §12)
// and NEVER logged or returned.
//
// PURE where it can be (§32): the route-picker, the URL builder, and the config check are pure/
// key-free and unit-smoked in scripts/voice-stt-smoke.mts. Only openDeepgramSocket() touches the
// key + a live socket (can't be exercised headless — owed to a deployed call, §13).

import { envKey } from "./env-key.ts";

/** STT tiers. Nova-3 and Flux share the same Deepgram socket opener; the table is a Partial<Record> so
 *  a second tier (e.g. a batch/whisper lane) is an ADD, never a fork (§18). A missing cell ⇒
 *  needs_config, exactly like the model-router. */
export type SttTier = "nova-realtime" | "flux-realtime";

export interface SttRouteCell {
  provider: string; // provider slug (audit + honest reporting)
  model: string; // default model id for this cell
  justification: string; // one-line rationale (§11/§13), auditable in code
  host: string; // the wss listen host
}

// The STT route table. Every cell carries its own justification so the choice is auditable in
// code (mirrors model-router's ROUTE_TABLE). A missing cell resolves to a clean needs_config in
// planSttStream — never a silent wrong-provider substitution.
const STT_ROUTE_TABLE: Partial<Record<SttTier, SttRouteCell>> = {
  "nova-realtime": {
    provider: "deepgram",
    model: "nova-3",
    justification:
      "Deepgram Nova-3 streaming STT — lowest-latency real-time transcription for the live-call co-pilot; the routable STT commodity behind Paige's router (§34), never a second client.",
    host: "wss://api.deepgram.com/v1/listen",
  },
  "flux-realtime": {
    provider: "deepgram",
    model: "flux-general-en",
    justification:
      "Deepgram Flux turn-based streaming for Paige Live Conversation; the single STT router keeps Nova-3 callers unchanged.",
    host: "wss://api.deepgram.com/v2/listen",
  },
};

/** Pure route-picker. Returns the cell for a tier, or undefined (⇒ needs_config downstream). */
export function resolveSttRoute(tier: SttTier = "nova-realtime"): SttRouteCell | undefined {
  return STT_ROUTE_TABLE[tier];
}

/** Streaming parameters. Defaults match Twilio Media Stream audio (8 kHz mono μ-law). */
export interface DeepgramStreamOpts {
  encoding?: string; // default "mulaw"
  sampleRate?: number; // default 8000
  channels?: number; // default 1
  model?: string; // override the cell default
  interimResults?: boolean; // default true (partial transcripts for the live panel)
  punctuate?: boolean; // default true
  smartFormat?: boolean; // default true
  language?: string; // default "en-US"
  /** Deepgram endpointing (ms of silence to finalize an utterance). Omitted when undefined. */
  endpointing?: number;
  /** Flux (v2) only: confidence required to declare end of turn. Lower ends turns sooner. */
  eotThreshold?: number;
  /** Flux (v2) only: hard cap on silence before a turn is forced to end, in ms. */
  eotTimeoutMs?: number;
}

/** PURE builder for a Deepgram streaming URL. MIP opt-out is mandatory for both routes. */
export function buildDeepgramStreamUrl(cell: SttRouteCell, opts: DeepgramStreamOpts = {}): string {
  const p = new URLSearchParams();
  p.set("model", opts.model ?? cell.model);
  p.set("mip_opt_out", "true");
  if (cell.host.endsWith("/v2/listen")) {
    p.set("encoding", opts.encoding ?? "linear16");
    p.set("sample_rate", String(opts.sampleRate ?? 16000));
    // Turn detection was left entirely at Deepgram's defaults, so a turn could sit open for the
    // default timeout before Paige was allowed to answer. These two put the wait under our
    // control rather than leaving it implicit.
    if (opts.eotThreshold !== undefined) p.set("eot_threshold", String(opts.eotThreshold));
    if (opts.eotTimeoutMs !== undefined) p.set("eot_timeout_ms", String(opts.eotTimeoutMs));
  } else {
    p.set("encoding", opts.encoding ?? "mulaw");
    p.set("sample_rate", String(opts.sampleRate ?? 8000));
    p.set("channels", String(opts.channels ?? 1));
    p.set("punctuate", String(opts.punctuate ?? true));
    p.set("interim_results", String(opts.interimResults ?? true));
    p.set("smart_format", String(opts.smartFormat ?? true));
    p.set("language", opts.language ?? "en-US");
    if (opts.endpointing !== undefined) p.set("endpointing", String(opts.endpointing));
  }
  return `${cell.host}?${p.toString()}`;
}

/** DEEPGRAM_API_KEY presence (case-insensitive, §12). Never returns/logs the value. */
export function sttConfigured(): boolean {
  return Boolean(envKey("DEEPGRAM_API_KEY"));
}

/** The plan a caller acts on: a ready wss URL (key present) or an HONEST needs_config degrade. */
export type SttStreamPlan =
  | { ok: true; url: string; provider: string; model: string }
  | { ok: false; needs_config: true; provider: "unconfigured" }
  | { ok: false; error: string };

/**
 * Resolve the streaming plan for a tier WITHOUT opening a socket (so it's unit-testable). No cell
 * ⇒ a typed error; a cell but no key ⇒ needs_config (the SAME honest shape a missing model-router
 * cell produces). The URL is built but the key is NOT included in the result — the opener reads
 * the key itself so a plan object can be logged safely (§13).
 */
export function planSttStream(tier: SttTier = "nova-realtime", opts: DeepgramStreamOpts = {}): SttStreamPlan {
  const cell = resolveSttRoute(tier);
  if (!cell) return { ok: false, error: `stt_route_unconfigured_tier:${tier}` };
  if (!sttConfigured()) return { ok: false, needs_config: true, provider: "unconfigured" };
  return { ok: true, url: buildDeepgramStreamUrl(cell, opts), provider: cell.provider, model: opts.model ?? cell.model };
}

/**
 * Open the Deepgram streaming socket for a resolved plan URL. Reads DEEPGRAM_API_KEY HERE and
 * authenticates via the `token` subprotocol (Deno WebSocket can't set an Authorization header).
 * Returns null when the key is absent (honest degrade — the caller closes the Twilio socket and
 * never fabricates a transcript stream, §13). The key is used ONLY as the subprotocol credential
 * and is never logged. This is the ONLY function in the codebase that opens a Deepgram connection.
 */
export function openDeepgramSocket(url: string): WebSocket | null {
  const key = envKey("DEEPGRAM_API_KEY");
  if (!key) return null;
  // Defense in depth: no caller can omit or negate MIP opt-out, including legacy Nova callers.
  // Reject non-Deepgram endpoints before attaching the server-only credential.
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { return null; }
  if (endpoint.protocol !== "wss:" || endpoint.hostname !== "api.deepgram.com" ||
    !["/v1/listen", "/v2/listen"].includes(endpoint.pathname)) return null;
  endpoint.searchParams.set("mip_opt_out", "true");
  // Deepgram's documented token-subprotocol auth: ["token", "<DEEPGRAM_API_KEY>"].
  return new WebSocket(endpoint.toString(), ["token", key]);
}

/** Flux v2 TurnInfo: only EndOfTurn is a committed utterance. */
export interface DeepgramFluxTurn {
  transcript: string;
  isFinal: boolean;
  event: string;
  turnIndex: number;
  sequenceId: number;
}

export function extractDeepgramFluxTurn(raw: string | ArrayBuffer | Uint8Array): DeepgramFluxTurn | null {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  let frame: unknown;
  try { frame = JSON.parse(text); } catch { return null; }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return null;
  const turn = frame as Record<string, unknown>;
  if (turn.type !== "TurnInfo" || typeof turn.transcript !== "string" ||
    typeof turn.event !== "string" || typeof turn.turn_index !== "number" || typeof turn.sequence_id !== "number") return null;
  // StartOfTurn is Flux announcing that the speaker has BEGUN, before a word has been
  // transcribed -- so it necessarily carries an empty transcript. Requiring non-empty text here
  // silently dropped every one of them, which made the ears' startOfTurn dispatch dead code and
  // left barge-in waiting for Deepgram to transcribe actual words before Paige would stop
  // talking. That delay is the whole reason interrupting her did not feel like a conversation.
  // Every OTHER event still needs real text: an empty Update or EndOfTurn carries nothing.
  if (turn.event !== "StartOfTurn" && !turn.transcript.trim()) return null;
  return {
    transcript: turn.transcript,
    isFinal: turn.event === "EndOfTurn",
    event: turn.event,
    turnIndex: turn.turn_index,
    sequenceId: turn.sequence_id,
  };
}

/** Shape of a Deepgram streaming `Results` message (the fields we consume for B1). */
export interface DeepgramTranscriptResult {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
  confidence?: number;
  start?: number;
  duration?: number;
}

/**
 * PURE extractor: pull the transcript + finality from a Deepgram streaming message. Deepgram
 * sends { type:"Results", is_final, speech_final, channel:{ alternatives:[{ transcript, confidence }] } }
 * plus non-transcript control messages (Metadata, UtteranceEnd, SpeechStarted). Returns null for
 * a control message or an empty transcript so the caller only broadcasts real words (§13).
 */
export function extractDeepgramTranscript(raw: string | ArrayBuffer | Uint8Array): DeepgramTranscriptResult | null {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Uint8Array) text = new TextDecoder().decode(raw);
  else text = new TextDecoder().decode(new Uint8Array(raw));

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (obj.type && obj.type !== "Results") return null; // Metadata / UtteranceEnd / SpeechStarted
  const channel = (obj.channel ?? {}) as Record<string, unknown>;
  const alts = (channel.alternatives ?? []) as Array<Record<string, unknown>>;
  const first = alts[0] ?? {};
  const transcript = typeof first.transcript === "string" ? first.transcript : "";
  if (!transcript) return null;
  return {
    transcript,
    isFinal: Boolean(obj.is_final),
    speechFinal: Boolean(obj.speech_final),
    confidence: typeof first.confidence === "number" ? first.confidence : undefined,
    start: typeof obj.start === "number" ? obj.start : undefined,
    duration: typeof obj.duration === "number" ? obj.duration : undefined,
  };
}
