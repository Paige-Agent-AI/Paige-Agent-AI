/** Transport classification only. A hint never supplies actor, thread or execution authority. */
export const CHAT_CONTROL_HEADER = "x-paige-chat-control";
export const CHAT_CONTROL_POLL_MS = 2_000;
export const CHAT_CONTROL_MAX_BODY_BYTES = 4_096;
export type ChatControlKind = "status" | "stop";

/** Recognized hinted controls only: bound actual transport bytes before JSON/schema.
 * Content-Length is not authority. Ordinary history/documents keep their existing reader. */
export async function readChatControlBody(request: Request): Promise<{ text: string } | { status: 400 | 413 }> {
  const reader = request.body?.getReader();
  if (!reader) return { text: "" };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const chunks: Uint8Array[] = [];
  let length = 0;
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) { cancel(); return { status: 400 }; }
    while (true) {
      const { done, value } = await reader.read();
      if (request.signal.aborted) return { status: 400 };
      if (done) break;
      if (!(value instanceof Uint8Array)) { cancel(); return { status: 400 }; }
      if (length + value.byteLength > CHAT_CONTROL_MAX_BODY_BYTES) { cancel(); return { status: 413 }; }
      chunks.push(value);
      length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder().decode(bytes) };
  } catch {
    cancel();
    return { status: 400 };
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** All callers use the existing per-user native limiter; unknown/legacy input keeps20/min. */
export function chatIngressPolicy(hint: string | null) {
  return hint === "status" ? { key: "paige-ai-chat-status", maxRequests: 120 }
    : hint === "stop" ? { key: "paige-ai-chat-stop", maxRequests: 20 }
    : { key: "paige-ai-chat", maxRequests: 20 };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}

/** Run AFTER the canonical schema, BEFORE protocol/context/model work. Inspect raw keys too:
 * schema stripping must never turn a business payload into a privileged control transport. */
export function matchesChatControlHint(hint: string | null, raw: unknown, validatedKind: unknown): boolean {
  if (hint === null) return true; // Legacy callers retain their original20/min path.
  if ((hint !== "status" && hint !== "stop") || validatedKind !== hint) return false;
  const input = object(raw);
  if (!input || !onlyKeys(input, ["threadId", "requestIntentId", "messages", "interactive", "surfaceContext"])
    || typeof input.threadId !== "string" || typeof input.requestIntentId !== "string") return false;
  const control = object(input.interactive);
  const fields = hint === "status" ? ["kind", "pipelineEffectId", "workId", "approvalTurnId"] : ["kind", "supersedesIntentId"];
  if (!control || !onlyKeys(control, fields) || control.kind !== hint) return false;
  if (hint === "stop" && control.supersedesIntentId !== input.requestIntentId) return false;
  if ("surfaceContext" in input) {
    const surface = object(input.surfaceContext);
    if (!surface || !onlyKeys(surface, ["kind"]) || surface.kind !== "customer_portal") return false;
  }
  if (!Array.isArray(input.messages) || input.messages.length !== 1) return false;
  const message = object(input.messages[0]);
  return !!message && onlyKeys(message, ["role", "content"]) && message.role === "user"
    && (hint === "stop" ? message.content === "Stop" : message.content === "Status" || message.content === "Read pending approval status.");
}

/** Bounded client delay for an observed429; no automatic message/action/Stop retry. */
export function chatControlRetryDelay(retryAfter: string | null | undefined, now = Date.now()): number {
  const text = retryAfter?.trim() ?? "";
  const seconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  const date = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
    ? Date.parse(text) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Number.isFinite(date) ? date - now : 60_000;
  return Math.max(1_000, Math.min(300_000, delay));
}
