// systems-check-runners/comms_configured.ts — Check #1 (runner_key: comms_configured).
//
// SEAM (reuse ONLY this): tenant_email_identities (a row exists — PK is tenant_id, there is no id
//   column) AND (tenant_phone_numbers.is_primary OR a tenant_a2p_registrations row) AND the
//   Spine-owned business_context_readiness contract's 'business_phone' field (owner_confirmed =
//   Setup has a business phone on file).
// A tenant is "comms configured" when it can BOTH email (an identity registered) and text/call (a
// primary from-number or an A2P registration) AND has a business phone on record.
//
// The business-phone half used to read tenants.brand->>'business_phone' directly, which the
// current Setup save path never writes -- a fresh scan reported "missing" regardless of what an
// Owner saved. Reading the readiness contract instead fixes this at the one broken pointer (§18);
// the email/A2P checks were already correctly Connections-owned and are untouched.
//
// §51 tenant-scoped: every read is `.eq("tenant_id", ctx.tenantId)` (the tenants row keys on id).
// §32 fail-loud: any db error throws → status:'error' (never a silent pass). §13 honest evidence.
// NOTE: the core does the forge(remediation) + department routing from the registry row on 'fail';
//   this runner only observes and returns the CheckResult (the CheckResult interface carries no
//   draftedFix/departmentSlug field — that is the core's job, §18 one home).

import type { CheckRunner } from "../systems-check-runner.ts";
import { throwOnDbError, errorResult } from "./_kit.ts";
import { readBusinessContextReadiness, isConfirmed } from "./_business-context-readiness.ts";

export const runnerKey = "comms_configured";

export const run: CheckRunner = async (ctx, _row) => {
  const { admin, tenantId } = ctx;
  try {
    const [emailRes, phoneRes, a2pRes, readiness, subRes] = await Promise.all([
      admin.from("tenant_email_identities").select("tenant_id").eq("tenant_id", tenantId).limit(1),
      admin.from("tenant_phone_numbers").select("id, capabilities").eq("tenant_id", tenantId).eq("is_primary", true).limit(1),
      admin.from("tenant_a2p_registrations").select("tenant_id").eq("tenant_id", tenantId).limit(1),
      readBusinessContextReadiness(admin, tenantId),
      // INT-345: the calling ACCOUNT is a distinct fact from number assignment —
      // its absence is fixable by the owner's own one-click setup (Settings →
      // Registration → "Set up calling"), so the check names it separately.
      admin.from("tenant_twilio_subaccounts")
        .select("twilio_subaccount_sid, api_key_sid, auth_token_vault_ref, status, active")
        .eq("tenant_id", tenantId).limit(1),
    ]);
    throwOnDbError(emailRes.error, "tenant_email_identities");
    throwOnDbError(phoneRes.error, "tenant_phone_numbers");
    throwOnDbError(a2pRes.error, "tenant_a2p_registrations");
    throwOnDbError(subRes.error, "tenant_twilio_subaccounts");

    const hasEmailIdentity = (emailRes.data?.length ?? 0) > 0;
    const hasPrimaryPhone = (phoneRes.data?.length ?? 0) > 0;
    const hasA2p = (a2pRes.data?.length ?? 0) > 0;
    const hasBusinessPhone = isConfirmed(readiness.business_phone.status);
    const subRow = (subRes.data?.[0] ?? null) as Record<string, unknown> | null;
    const callingAccountConfigured = !!subRow
      && !!subRow.twilio_subaccount_sid
      && !!subRow.api_key_sid
      && !!subRow.auth_token_vault_ref
      && subRow.active === true
      && subRow.status === "active";
    const primaryVoiceCapable = hasPrimaryPhone
      && ((phoneRes.data?.[0] as { capabilities?: Record<string, unknown> } | undefined)
        ?.capabilities?.voice === true);

    const canText = hasPrimaryPhone || hasA2p;
    const pass = hasEmailIdentity && canText && hasBusinessPhone;

    const missing: string[] = [];
    if (!hasEmailIdentity) missing.push("no sending email identity");
    if (!canText) missing.push("no primary phone number or A2P registration");
    if (!hasBusinessPhone) missing.push("no business phone on the profile");
    if (!callingAccountConfigured) missing.push("calling account not connected (Settings → Registration → Set up calling)");
    else if (!hasPrimaryPhone) missing.push("calling account connected but no primary number chosen yet");
    else if (!primaryVoiceCapable) missing.push("the primary number is not voice-capable");

    return {
      status: pass ? "pass" : "fail",
      evidence: {
        has_email_identity: hasEmailIdentity,
        has_primary_phone: hasPrimaryPhone,
        has_a2p_registration: hasA2p,
        has_business_phone: hasBusinessPhone,
        // INT-345: the four calling facts, reported separately — account,
        // number, voice capability of that number — never conflated.
        calling_account_configured: callingAccountConfigured,
        primary_voice_capable: primaryVoiceCapable,
      },
      interpretation: pass
        ? `Communications are configured — a sending email identity plus a phone/A2P path and a business phone are on record.${callingAccountConfigured ? (primaryVoiceCapable ? " Calling is READY." : " The calling account is connected; the primary number is not voice-capable.") : ""}`
        : `Communications are not fully set up: ${missing.join("; ")}.`,
    };
  } catch (e) {
    return errorResult(e, runnerKey);
  }
};
