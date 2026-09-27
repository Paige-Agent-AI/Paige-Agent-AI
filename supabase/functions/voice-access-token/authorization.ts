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

export type VoiceReadiness =
  | { ok: true }
  | { ok: false; code: "calling_not_configured" | "calling_number_needs_verification"; message: string };

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
  const primary = primaryNumbers?.length === 1 ? primaryNumbers[0] : null;
  if (
    !primary ||
    primary.subaccount_id !== subaccount.id ||
    !primary.twilio_sid ||
    primary.capabilities?.voice !== true
  ) {
    return {
      ok: false,
      code: "calling_number_needs_verification",
      message: "Your calling number needs verification.",
    };
  }
  return { ok: true };
}
