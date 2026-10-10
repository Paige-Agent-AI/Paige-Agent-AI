export function hasTenantVoiceAuthority(input: {
  isPlatformOwner: boolean;
  membershipTenantId: string | null;
  activeTenantId: string;
  membershipStatus: string | null;
  membershipRole: string | null;
}): boolean {
  if (input.isPlatformOwner) return true;
  return input.membershipTenantId === input.activeTenantId &&
    input.membershipStatus === "active" &&
    ["owner", "admin"].includes(input.membershipRole ?? "");
}

/**
 * INT-345 — the exact, repairable reason a calling number failed readiness.
 * Each code maps to ONE canonical next step so the dialer can tell the owner
 * what to do instead of collapsing five repairable states into one string.
 * `no_active_primary_number`, `multiple_active_primary_numbers`, and
 * `primary_number_voice_capability_unconfirmed` are self-service in
 * Settings → Communications; the other two need platform-side repair.
 */
export type VoiceReadinessReasonCode =
  | "no_active_primary_number"
  | "multiple_active_primary_numbers"
  | "primary_number_under_different_subaccount"
  | "primary_number_missing_provider_binding"
  | "primary_number_voice_capability_unconfirmed";

export type VoiceReadiness =
  | { ok: true }
  | {
    ok: false;
    code: "calling_not_configured" | "calling_number_needs_verification";
    reason_code?: VoiceReadinessReasonCode;
    message: string;
  };

export function classifyVoiceReadiness(
  subaccount: { id?: string; active?: boolean; status?: string } | null,
  primaryNumbers: Array<{
    subaccount_id?: string | null;
    twilio_sid?: string | null;
    capabilities?: { voice?: boolean } | null;
  }> | null,
): VoiceReadiness {
  if (!subaccount || subaccount.active !== true || subaccount.status !== "active") {
    return { ok: false, code: "calling_not_configured", message: "Calling is not configured for this workspace." };
  }
  // Exactly one active primary is the contract. Zero or many are both broken
  // invariants, each with its own honest repair path.
  if (!primaryNumbers || primaryNumbers.length === 0) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "no_active_primary_number",
      // The buy step lives in Settings → Registration ("Find a number");
      // "Send from this" (the only writer of is_primary) lives in Settings →
      // Communications. Buying alone does NOT make a number the calling number
      // — the copy names both steps in their real places.
      message: "This workspace hasn't chosen a calling number yet. Buy a number in Settings → Registration, then select \"Send from this\" on it in Settings → Communications.",
    };
  }
  if (primaryNumbers.length > 1) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "multiple_active_primary_numbers",
      // Defensive branch (a per-tenant partial unique index normally makes this
      // unreachable): the fix is a data correction, not a user-facing control.
      message: "More than one number is marked as this workspace's calling number. Contact support so we can fix which one is used.",
    };
  }
  const primary = primaryNumbers[0];
  if (primary.subaccount_id !== subaccount.id) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "primary_number_under_different_subaccount",
      message: "This workspace's calling number is linked to another calling account. Contact support so we can relink it.",
    };
  }
  if (!primary.twilio_sid) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "primary_number_missing_provider_binding",
      message: "This workspace's calling number isn't fully connected yet. Contact support so we can finish the connection.",
    };
  }
  if (primary.capabilities?.voice !== true) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "primary_number_voice_capability_unconfirmed",
      message: "The number set as this workspace's calling number can't make calls. Buy a number marked for calls in Settings → Registration, then select \"Send from this\" on it in Settings → Communications.",
    };
  }
  return { ok: true };
}
