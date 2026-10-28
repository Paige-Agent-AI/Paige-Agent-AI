// #168 — PURE Twilio CallStatus mapping for the VOICE branch of twilio-status-callback.
//
// WHY A SEPARATE MODULE (§32): a live call can't be driven in CI, so the call-status request-shaping
// logic (status map, SID matching, duration parse) is factored OUT of the Deno.serve handler into these
// PURE, side-effect-free functions. scripts/voice-conversations-smoke.mjs imports them directly and
// asserts the mapping — catching a "compiles but maps the wrong status / drops the duration" defect
// before it ships, not on a live call. No Deno/network imports here, so it loads cleanly under Node.

/**
 * Twilio CallStatus → messages.status enum (draft/queued/sent/delivered/failed/received/read).
 * A connected-and-ended call is 'delivered'; every unsuccessful terminal (busy/no-answer/failed/
 * canceled) is 'failed'; intermediates stay 'queued'. NOTE (§13): 'initiated' is NOT a valid
 * messages.status value — the voice row starts life as 'queued' (see voice-twiml), and this map
 * advances it. Anything unmapped ⇒ null (the caller acks 200 and does not guess).
 */
export const CALL_STATUS_MAP: Record<string, string> = {
  queued: "queued",
  initiated: "queued",
  ringing: "queued",
  "in-progress": "queued",
  answered: "queued",
  completed: "delivered",
  busy: "failed",
  "no-answer": "failed",
  failed: "failed",
  canceled: "failed",
};

export function mapCallStatus(callStatus: string | null | undefined): string | null {
  return CALL_STATUS_MAP[String(callStatus ?? "").trim().toLowerCase()] ?? null;
}

/**
 * The owner-facing reason written to messages.error for an unsuccessful call. All four terminals
 * still STORE as 'failed' (messages_status_check has no other unsuccessful value, and the call log,
 * pills and counters all key on it) — but nobody picking up is not the provider rejecting the call,
 * and saying so was the owner-reported defect (2026-10-28). "Rejected" is kept ONLY for a genuine
 * provider failure (CallStatus=failed) or a status we do not recognise.
 */
const CALL_OUTCOME_COPY: Record<string, string> = {
  "no-answer": "No answer.",
  busy: "The line was busy.",
  canceled: "The call was cancelled.",
};

export function callOutcomeError(
  callStatus: string | null | undefined,
  errorCode: string | null | undefined,
): string {
  const honest = CALL_OUTCOME_COPY[String(callStatus ?? "").trim().toLowerCase()];
  if (honest) return honest;
  return errorCode
    ? `The provider rejected this call (error ${errorCode}).`
    : "The provider rejected this call.";
}

/**
 * INBOUND call outcome, decided per callback KIND rather than "first terminal wins".
 *
 * An inbound call rings every seat at once (voice-twiml `buildInboundTwiml`: one <Client> leg per
 * owner/admin, each with its own statusCallback) and, once a number has a VoiceUrl, the number-level
 * StatusCallback also posts the PARENT call's end with no ParentCallSid. Twilio cancels the losing legs
 * the moment one seat answers, and every one of these callbacks can arrive in any order. So:
 *   • a CHILD leg that answered — in-progress, or completed with talk time > 0 — is the answer and wins
 *     over anything recorded before it;
 *   • a CHILD leg that did not answer decides nothing: another seat may still pick up;
 *   • the PARENT's terminal status settles "nobody answered", and only while no leg has answered. The
 *     parent's `completed` means the call ENDED, never that it connected, so it settles as "No answer.".
 * Outbound calls do not use this: they have exactly one <Number> leg and keep the first-terminal rule.
 */
export type InboundCallDecision =
  | { kind: "answered" }
  | { kind: "settle_unanswered"; error: string }
  | { kind: "record_leg" };

const PARENT_TERMINALS = new Set(["completed", "busy", "no-answer", "canceled", "failed"]);

export function decideInboundCall(input: {
  twilioStatus: string | null | undefined;
  parentCallSid: string | null | undefined;
  duration: number | null;
  errorCode: string | null | undefined;
}): InboundCallDecision {
  const s = String(input.twilioStatus ?? "").trim().toLowerCase();
  const isChildLeg = String(input.parentCallSid ?? "").trim().length > 0;
  if (isChildLeg) {
    const answered = s === "in-progress" || s === "answered" || (s === "completed" && (input.duration ?? 0) > 0);
    return answered ? { kind: "answered" } : { kind: "record_leg" };
  }
  if (!PARENT_TERMINALS.has(s)) return { kind: "record_leg" };
  return {
    kind: "settle_unanswered",
    error: s === "completed" ? CALL_OUTCOME_COPY["no-answer"] : callOutcomeError(s, input.errorCode),
  };
}

/**
 * The provider_message_id(s) a call-status callback could match. The voice row stored the PARENT call
 * SID (voice-twiml used params.CallSid). A <Number>/<Client> child-leg statusCallback posts the CHILD
 * CallSid PLUS ParentCallSid = that parent SID. Try both (parent first) so matching works whether the
 * callback is child-leg (has ParentCallSid) or a future parent-level callback (CallSid == our stored
 * SID). De-duped; empties dropped so a missing field never produces an over-broad `in ('')` filter.
 */
export function callMatchSids(
  callSid: string | null | undefined,
  parentCallSid: string | null | undefined,
): string[] {
  return [...new Set(
    [parentCallSid, callSid].map((s) => String(s ?? "").trim()).filter((s) => s.length > 0),
  )];
}

/** Parse Twilio CallDuration (whole seconds, as a string) → a non-negative integer, or null if absent/invalid. */
export function parseCallDuration(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Fleet Comms S3 P3 — a trimmed non-empty string, or null. Used to read RecordingUrl / TranscriptionText
 * from a Twilio callback WITHOUT fabricating them (§13): a plain CallStatus=completed hit carries neither
 * (recording is only produced when the <Dial> enables it — NOT yet, human-answered bridge only), so this
 * returns null and the webhook stores null. When recording IS enabled later, Twilio's recording/transcription
 * callback POSTs these fields to the same URL and they are stored verbatim — no code change needed.
 */
export function nonEmptyOrNull(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return s.length > 0 ? s : null;
}
