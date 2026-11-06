// Connected MCP Gateway — tool-call RESULT validation (#1262 finding 4).
//
// After a `tools/call` returns, the runner used to emit `executed`/`read_observed` without ever
// inspecting the result — so a provider that RAN the tool and answered `{ isError: true }` (a
// documented MCP failure shape), or answered in a shape we do not accept, was reported as a
// success. This is the boundary that stops that: a returned result is a success only when it is
// the recognized MCP result shape AND does not carry `isError`.
//
// WHY THE GATEWAY HAS ITS OWN COPY. `_shared/mcp-outcome.ts` has an equivalent private
// `validateResult`, but that module is the n8n|zapier-TYPED legacy wrapper the gateway
// deliberately does not import (see `types.ts` header). This is the gateway's provider-agnostic
// home for the same check — identity + shape only, never provider content. Reconciling the two
// into one shared primitive is a §18 follow-up deferred to Phase C precisely so this slice does
// not touch the live Chat/zapier/n8n lane (`mcp-outcome.ts` is imported transitively by
// `paige-ai-chat`, which is parked pending #1255).

export type ToolResultCheck = {
  /** Whether the result is the documented MCP `{ content: [...] }` shape at all. An unrecognized
   *  shape is NOT a success — the runner reports it as a tool error, never as executed. */
  recognized: boolean;
  /** Whether this result is an error, honoured only when the shape is recognized. `true` when the
   *  provider set `isError: true` OR when `isError` is PRESENT but not a boolean — a malformed flag
   *  from untrusted provider output fails CLOSED to an error, never a silent success (Codex P2). */
  isError: boolean;
};

/**
 * Validates a `tools/call` result. Accepts only `{ content: Array<{ type: string, ... }> }`; maps
 * nothing and echoes nothing (content is provider-controlled and stays server-side). `isError` is
 * read only from the recognized shape.
 */
export function validateToolResult(raw: unknown): ToolResultCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { recognized: false, isError: false };
  const r = raw as { content?: unknown; isError?: unknown };
  if (!Array.isArray(r.content)) return { recognized: false, isError: false };
  for (const block of r.content) {
    if (!block || typeof block !== "object" || typeof (block as { type?: unknown }).type !== "string") {
      return { recognized: false, isError: false };
    }
  }
  // `isError` must be a boolean per the MCP spec. A PRESENT non-boolean isError (e.g. the string
  // "true", `1`, `null`) is a malformed shape from untrusted provider output — treat it as an error
  // (fail closed), never let it fall through the strict `=== true` check as a silent success.
  const isError = r.isError === true || (r.isError !== undefined && typeof r.isError !== "boolean");
  return { recognized: true, isError };
}

/** The bound on {@link projectToolResultData}. Generous enough to carry a useful page of records;
 * small enough that no provider can flood a model's context through a successful tool result. */
const RESULT_DATA_CAP = 4_000;

/**
 * Reduce a VALIDATED clean tool result to a bounded, control-stripped string the caller's model can
 * actually read. This exists because the closed outcome vocabulary alone made a successful read
 * unconfirmable: a caller that runs `contacts_get-contacts`, gets `{outcome:"read_observed"}`, and
 * has nothing that was read can only tell its operator "I couldn't confirm" (the 2026-11-06 owner
 * incident) — a vocabulary designed to stop provider prose from reaching models had also stopped
 * the data the tool existed to fetch. This projection reopens exactly that one channel:
 *
 *   * INPUT GATE — the caller must have already passed the raw result through
 *     {@link validateToolResult} and gotten `{recognized:true, isError:false}`. This function
 *     re-asserts the shape itself and returns `null` otherwise, so an unvalidated payload can
 *     never be echoed (fail closed, same posture as the validator).
 *   * WHAT CROSSES — text blocks' `text` fields (string-valued only) and, when present,
 *     `structuredContent` serialized as JSON. Non-text blocks (images, resources) contribute
 *     nothing — their payloads are not text and never cross.
 *   * HOW IT IS BOUNDED — control characters other than newline/tab are stripped (an untrusted
 *     provider cannot smuggle invisible steering into the string), the whole projection is capped
 *     at {@link RESULT_DATA_CAP} characters with an explicit truncation marker, and an empty
 *     projection returns `null` (never an empty string that could read as "provider said nothing").
 *
 * The output is still provider-written content — a prompt-injection surface. It is DATA to be
 * shown, never instructions; the chat adapter that forwards it to a model labels it as such.
 */
export function projectToolResultData(raw: unknown): string | null {
  const check = validateToolResult(raw);
  if (!check.recognized || check.isError) return null;
  const r = raw as { content?: unknown; structuredContent?: unknown };
  const parts: string[] = [];
  for (const block of Array.isArray(r.content) ? r.content : []) {
    const text = (block as { text?: unknown } | null)?.text;
    if (typeof text === "string" && text.length > 0) parts.push(text);
  }
  if (r.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(r.structuredContent));
    } catch { /* unserializable structured content contributes nothing */ }
  }
  const joined = parts
    .join("\n")
    // Strip control characters except \n and \t — the projection must never carry invisible
    // control bytes from an untrusted provider into a model transcript.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!joined) return null;
  return joined.length > RESULT_DATA_CAP
    ? joined.slice(0, RESULT_DATA_CAP) + "\n[truncated]"
    : joined;
}
