// INT-321 — translate a refused voice-cost reservation into ONE stable, browser-safe TTS code.
//
// reserve_paige_voice_cost_internal raises a semantic identity as its exception MESSAGE
// ('PAIGE_VOICE_TENANT_COST_LIMIT', 'PAIGE_VOICE_PLATFORM_COST_LIMIT', …). Two of those share
// SQLSTATE 54000, so the SQLSTATE alone can never tell "this workspace used its allowance" from
// "the platform cap is hit" — classification keys on the identity, never on the code.
//
// PostgREST hands the identity back as error.message and the RAISE … DETAIL as error.details. The
// raw database text NEVER leaves the edge: the caller returns only `code` and, when the canonical
// function proved it, a `resetAt` rebuilt from validated parts (never echoed).
//
// Deploy order is safe in both directions. Before migration 20270581000000 the function carries no
// DETAIL (→ resetAt stays null, the copy omits a date rather than inventing one) and folds the
// emergency brake into PAIGE_VOICE_BUDGET_DISABLED (→ not-configured, never "platform paused").
//
// Pure: no Deno or Node globals, so the edge function and vitest import the same file.

export type VoiceCostRefusalCode =
  /** The workspace's own monthly voice allowance is used up. */
  | "tts_tenant_cost_limit"
  /** The platform-wide monthly voice cap is used up. */
  | "tts_platform_cost_limit"
  /** The platform operator engaged the emergency brake. */
  | "tts_emergency_disabled"
  /** Voice is switched off for this workspace (explicit brake or a zero allowance). */
  | "tts_workspace_voice_disabled"
  /** The platform voice budget is switched off or not configured. */
  | "tts_not_configured"
  /** The reservation saw a different profile revision than the one resolved moments earlier — a
   *  race with a profile change, not a configuration state. Retryable: the next tap re-resolves. */
  | "tts_voice_profile_changed"
  /** Anything else — a refusal this edge cannot honestly name. Retryable, never "paused". */
  | "tts_cost_limit_unavailable";

export interface VoiceCostRefusal {
  code: VoiceCostRefusalCode;
  status: number;
  /** ISO instant the allowance resets, ONLY when the canonical function proved it. */
  resetAt: string | null;
  /** The recognised identity, for server logs only. Null when unrecognised. */
  identity: string | null;
}

interface PostgrestLikeError {
  message?: unknown;
  details?: unknown;
  code?: unknown;
}

const IDENTITY_TO_CODE: Readonly<Record<string, { code: VoiceCostRefusalCode; status: number }>> = {
  PAIGE_VOICE_TENANT_COST_LIMIT: { code: "tts_tenant_cost_limit", status: 429 },
  PAIGE_VOICE_PLATFORM_COST_LIMIT: { code: "tts_platform_cost_limit", status: 503 },
  PAIGE_VOICE_EMERGENCY_DISABLED: { code: "tts_emergency_disabled", status: 503 },
  PAIGE_VOICE_TENANT_BUDGET_DISABLED: { code: "tts_workspace_voice_disabled", status: 503 },
  PAIGE_VOICE_BUDGET_DISABLED: { code: "tts_not_configured", status: 503 },
  // The resolver approved this exact revision moments ago, so a reservation refusal here means the
  // active profile changed in between. Never not-configured: that would disable playback for the
  // whole session over a race. If the profile is genuinely gone, the retry's resolver says so.
  PAIGE_VOICE_PROFILE_UNAVAILABLE: { code: "tts_voice_profile_changed", status: 503 },
};

const GENERIC: { code: VoiceCostRefusalCode; status: number } = { code: "tts_cost_limit_unavailable", status: 503 };

const BUDGET_MONTH = /^(\d{4})-(\d{2})-01$/;
const RESETS_AT = /^(\d{4})-(\d{2})-01T00:00:00Z$/;

/**
 * The reset instant from the RAISE DETAIL, or null. Accepted only when it is exactly the first
 * instant of the month after the budget month the cap was keyed on — anything else is discarded,
 * because a date the runtime cannot prove is worse than no date.
 */
export function parseVoiceCostResetAt(details: unknown): string | null {
  if (typeof details !== "string" || details.length > 512) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { budget_month: budgetMonth, resets_at: resetsAt } = parsed as Record<string, unknown>;
  if (typeof budgetMonth !== "string" || typeof resetsAt !== "string") return null;
  const month = BUDGET_MONTH.exec(budgetMonth);
  const reset = RESETS_AT.exec(resetsAt);
  if (!month || !reset) return null;
  const validMonth = (mm: string) => Number(mm) >= 1 && Number(mm) <= 12;
  if (!validMonth(month[2]) || !validMonth(reset[2])) return null;
  const monthIndex = Number(month[1]) * 12 + (Number(month[2]) - 1);
  const resetIndex = Number(reset[1]) * 12 + (Number(reset[2]) - 1);
  if (resetIndex !== monthIndex + 1) return null;
  // Fully pattern-matched above, so this is a known-shape value, not echoed database text.
  return resetsAt;
}

/** Map a reservation RPC error to the one code the browser may see. */
export function classifyVoiceCostRefusal(error: PostgrestLikeError | null | undefined): VoiceCostRefusal {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const known = Object.prototype.hasOwnProperty.call(IDENTITY_TO_CODE, message) ? IDENTITY_TO_CODE[message] : null;
  const mapped = known ?? GENERIC;
  return {
    code: mapped.code,
    status: mapped.status,
    resetAt: mapped.code === "tts_tenant_cost_limit" ? parseVoiceCostResetAt(error?.details) : null,
    identity: known ? message : null,
  };
}

/** The ONLY body a refused reservation may send: the code, plus the proven reset when there is one.
 *  Built here so no identity, SQLSTATE, DETAIL or message can be added to the browser body in passing. */
export function voiceCostRefusalBody(refusal: VoiceCostRefusal): { error: VoiceCostRefusalCode; reset_at?: string } {
  return refusal.resetAt ? { error: refusal.code, reset_at: refusal.resetAt } : { error: refusal.code };
}

export type VoiceProfileFailureCode =
  /** The resolver PROVED there is no approved, active, effective profile (or it names a voice this
   *  edge does not support). A configuration state: the client disables playback. */
  | "tts_not_configured"
  /** The resolver call itself failed (network, PostgREST, permission) or returned nothing. Transient:
   *  the client offers a retry and never disables playback for the session. */
  | "voice_profile_unavailable";

/**
 * Classify a failed resolve_paige_voice_profile_internal call. The resolver raises the identity
 * 'PAIGE_VOICE_PROFILE_UNAVAILABLE' (55000) when the active slot is missing, unapproved, inactive or
 * not yet effective — that is configuration. Any other error is the call failing, not an answer.
 */
export function classifyVoiceProfileFailure(
  error: PostgrestLikeError | null | undefined,
  profileReturned: boolean,
): { code: VoiceProfileFailureCode; status: number } {
  if (error) {
    const message = typeof error.message === "string" ? error.message.trim() : "";
    return message === "PAIGE_VOICE_PROFILE_UNAVAILABLE"
      ? { code: "tts_not_configured", status: 503 }
      : { code: "voice_profile_unavailable", status: 503 };
  }
  // No error: a returned profile this edge cannot use is configuration; nothing returned is an anomaly.
  return profileReturned
    ? { code: "tts_not_configured", status: 503 }
    : { code: "voice_profile_unavailable", status: 503 };
}
