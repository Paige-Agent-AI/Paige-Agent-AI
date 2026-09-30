/** Purpose-bound proof of the ONE runtime's released answer, not a voice brain.
 * Only paige-ai-chat and paige-live-relay import this module in production.
 * PAIGE_LIVE_STREAM_SIGNING_KEY is a server-only secret; proofs contain no key.
 */
export interface LiveRuntimeScope {
  sessionId: string;
  tenantId: string;
  actorId: string;
  threadId: string;
  epoch: string;
  turnId: string;
  transcriptHash: string;
  nonce: string;
  expiresAt: number;
}
export interface LiveRuntimeOutput {
  purpose: "output";
  scope: LiveRuntimeScope;
  streamId: string;
  seq: number;
  kind: "start" | "chunk" | "done";
  text?: string;
}
const encoder = new TextEncoder();
const TTL_MS = 120_000;
const DOMAIN = "paige-live-runtime-v1.";
const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(
  atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0),
);
export async function liveRuntimeDigest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function sameLiveRuntimeScope(a: LiveRuntimeScope, b: LiveRuntimeScope): boolean {
  return a.sessionId === b.sessionId && a.tenantId === b.tenantId && a.actorId === b.actorId &&
    a.threadId === b.threadId && a.epoch === b.epoch && a.turnId === b.turnId &&
    a.transcriptHash === b.transcriptHash && a.nonce === b.nonce && a.expiresAt === b.expiresAt;
}
function isScope(value: unknown): value is LiveRuntimeScope {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return ["sessionId", "tenantId", "actorId", "threadId", "epoch", "turnId", "transcriptHash", "nonce"]
    .every((key) => typeof s[key] === "string" && (s[key] as string).length > 0 && (s[key] as string).length <= 512) &&
    Number.isSafeInteger(s.expiresAt);
}

export function createLiveRuntimeProof(secret: string, now: () => number = Date.now) {
  if (secret.length < 32) throw new Error("live_runtime_proof_not_configured");
  const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sign = async (payload: unknown): Promise<string> => {
    const body = encode(encoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign("HMAC", await key, encoder.encode(DOMAIN + body));
    return `${body}.${encode(new Uint8Array(signature))}`;
  };
  const verify = async (token: unknown): Promise<Record<string, unknown> | null> => {
    if (typeof token !== "string" || token.length > 12_000) return null;
    try {
      const pieces = token.split(".");
      if (pieces.length !== 2 || !pieces.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
      if (!await crypto.subtle.verify("HMAC", await key, decode(pieces[1]), encoder.encode(DOMAIN + pieces[0]))) return null;
      const payload = JSON.parse(new TextDecoder().decode(decode(pieces[0])));
      if (!isScope(payload?.scope) || payload.scope.expiresAt <= now() || payload.scope.expiresAt > now() + TTL_MS) return null;
      return payload;
    } catch { return null; }
  };
  return {
    async issue(scope: Omit<LiveRuntimeScope, "nonce" | "expiresAt" | "transcriptHash">, transcript: string) {
      const full: LiveRuntimeScope = { ...scope, nonce: crypto.randomUUID(), expiresAt: now() + TTL_MS, transcriptHash: await liveRuntimeDigest(transcript) };
      return { scope: full, token: await sign({ purpose: "input", scope: full }) };
    },
    async readChallenge(token: string): Promise<LiveRuntimeScope | null> {
      const payload = await verify(token);
      return payload?.purpose === "input" ? payload.scope as LiveRuntimeScope : null;
    },
    async readOutput(token: string): Promise<LiveRuntimeOutput | null> {
      const p = await verify(token);
      if (p?.purpose !== "output" || typeof p.streamId !== "string" || !Number.isSafeInteger(p.seq) || (p.seq as number) < 0 ||
        !["start", "chunk", "done"].includes(p.kind as string)) return null;
      if (p.kind === "chunk" && (typeof p.text !== "string" || !p.text.length || p.text.length > 2048)) return null;
      return p as unknown as LiveRuntimeOutput;
    },
    /** Wrap ONLY the final caller-visible SSE stream, AFTER protected-content release.
     * Ordinary SSE bytes remain unchanged; speech proofs precede their corresponding
     * text/DONE line. Browser EOF is not a successful runtime completion.
     */
    outputStream(source: ReadableStream<Uint8Array>, scope: LiveRuntimeScope): ReadableStream<Uint8Array> {
      const decoder = new TextDecoder();
      const streamId = crypto.randomUUID();
      let buffer = "";
      let seq = 0;
      let started = false;
      let done = false;
      const emit = async (controller: TransformStreamDefaultController<Uint8Array>, kind: LiveRuntimeOutput["kind"], text?: string) => {
        const token = await sign({ purpose: "output", scope, streamId, seq: seq++, kind, ...(text === undefined ? {} : { text }) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ paige_live_output: token })}\n\n`));
      };
      const line = async (raw: string, controller: TransformStreamDefaultController<Uint8Array>) => {
        const data = raw.replace(/\r$/, "").startsWith("data: ") ? raw.slice(6).trim() : null;
        if (data && !done) {
          let content: unknown;
          if (data !== "[DONE]") {
            try { content = JSON.parse(data)?.choices?.[0]?.delta?.content; } catch { /* preserve non-content SSE */ }
          }
          if ((typeof content === "string" && content.length) || data === "[DONE]") {
            if (!started) { started = true; await emit(controller, "start"); }
            if (typeof content === "string") {
              for (let i = 0; i < content.length; i += 2048) await emit(controller, "chunk", content.slice(i, i + 2048));
            }
            if (data === "[DONE]") { done = true; await emit(controller, "done"); }
          }
        }
        controller.enqueue(encoder.encode(raw + "\n"));
      };
      return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        async transform(bytes, controller) {
          buffer += decoder.decode(bytes, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            await line(raw, controller);
          }
          if (buffer.length > 256_000) throw new Error("live_runtime_frame_too_large");
        },
        async flush(controller) {
          buffer += decoder.decode();
          if (buffer) await line(buffer, controller);
          if (!done) throw new Error("live_runtime_incomplete");
        },
      }));
    },
  };
}
