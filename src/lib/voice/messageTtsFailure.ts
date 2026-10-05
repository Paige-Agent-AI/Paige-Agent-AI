export type TtsFailureKind =
  | "allowance"
  | "platform_unavailable"
  | "paused"
  | "pending"
  | "retryable"
  | "not_configured";

export interface TtsFailureFeedback {
  kind: TtsFailureKind;
  message: string;
}

// Codes come from paige-tts (supabase/functions/_shared/voice-cost-refusal.ts is the server half).
// Each set names exactly one state; a code in none of them is retryable — never "paused" (INT-321).
const TENANT_ALLOWANCE_CODES = new Set([
  "tts_tenant_allowance_reached",
  "tts_tenant_cost_limit",
]);

const PLATFORM_LIMIT_CODES = new Set([
  "tts_global_cap_reached",
  "tts_platform_cost_limit",
]);

const EMERGENCY_CODES = new Set([
  "tts_emergency_disabled",
]);

const PENDING_CODES = new Set([
  "tts_request_pending",
  "tts_request_ambiguous",
  "tts_request_already_reserved",
]);

// Not-configured DISABLES playback for the rest of the session (messageTts.needsConfig is sticky),
// so only a state the server PROVED is configuration belongs here — never a transient failure.
const NOT_CONFIGURED_CODES = new Set([
  "tts_not_configured",
  "tts_tier_reserved",
  "tts_workspace_voice_disabled",
]);

// Transient by construction: the profile resolver call failed (voice_profile_unavailable), or the
// active profile changed between resolve and reserve (tts_voice_profile_changed). The next tap
// re-resolves, so these get retry copy and must never disable playback. Listed so the intent is
// explicit; the fall-through below would land them in the same place.
const RETRYABLE_CODES = new Set([
  "voice_profile_unavailable",
  "tts_voice_profile_changed",
]);

const RETRY_MESSAGE = "Voice playback didn’t start. Please try again.";

/** "November 1", or "January 1, 2027" across a year boundary. Always the UTC calendar day the
 *  server proved — never the viewer's local day, which could read as October 31. */
function formatResetDate(resetAt: string | null | undefined): string | null {
  if (!resetAt) return null;
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Maps a machine response to one honest, provider-neutral user state. */
export function classifyTtsFailure(
  code: string | null | undefined,
  status: number,
  resetAt?: string | null,
): TtsFailureFeedback {
  if (code && TENANT_ALLOWANCE_CODES.has(code)) {
    const resetDate = formatResetDate(resetAt);
    return {
      kind: "allowance",
      message: resetDate
        ? `Voice playback has reached this workspace’s monthly allowance. It resets ${resetDate}.`
        : "Voice playback has reached this workspace’s monthly allowance.",
    };
  }

  if (code && RETRYABLE_CODES.has(code)) {
    return { kind: "retryable", message: RETRY_MESSAGE };
  }

  if (code && NOT_CONFIGURED_CODES.has(code)) {
    return { kind: "not_configured", message: "Voice playback isn’t available for this workspace." };
  }

  if ((code && PENDING_CODES.has(code)) || status === 409) {
    return { kind: "pending", message: "That audio may still be processing. Please try again in a moment." };
  }

  if (code && PLATFORM_LIMIT_CODES.has(code)) {
    return { kind: "platform_unavailable", message: "Voice playback is temporarily unavailable. Please try again later." };
  }

  if (code && EMERGENCY_CODES.has(code)) {
    return { kind: "paused", message: "Voice playback is paused right now. Please try again later." };
  }

  // No status-only route to "paused" or "unavailable": a bare 503 proves nothing about why.
  return { kind: "retryable", message: RETRY_MESSAGE };
}
