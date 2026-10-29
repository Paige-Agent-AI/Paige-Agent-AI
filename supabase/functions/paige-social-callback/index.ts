import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { recordCapabilityRun, stableRunId } from "../_shared/capability-record.ts";
import { uploadPostSocialAdapter } from "../_shared/social-provider/upload-post.ts";
import { SocialProviderError } from "../_shared/social-provider/mod.ts";
import { zernioSocialAdapter } from "../_shared/social-provider/zernio.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const RETURN_PATH = /^\/solo\/[A-Za-z0-9_-]+\/settings\/integrations\/?$/;
// Same provider selection as paige-social: whichever adapter carries a vaulted key.
const adapter = zernioSocialAdapter.isConfigured() ? zernioSocialAdapter : uploadPostSocialAdapter;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeBase(): string | null {
  try {
    const configured = Deno.env.get("PUBLIC_SITE_URL");
    if (!configured) return null;
    const url = new URL(configured);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}

const SAFE_REASONS = new Set(["consent_cancelled", "account_already_linked", "platform_mismatch", "connection_failed", "readback_failed"]);

function resultRedirect(returnPath: string, result: string, receipt?: boolean, reason?: string): Response {
  const base = safeBase();
  if (!base || !RETURN_PATH.test(returnPath)) return errorPage(500, "Social could not return to a verified Paige destination.");
  const url = new URL(returnPath, base);
  url.searchParams.set("social_result", result);
  if (reason && SAFE_REASONS.has(reason)) url.searchParams.set("social_reason", reason);
  if (receipt !== undefined) url.searchParams.set("social_receipt", receipt ? "recorded" : "missing");
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function errorPage(status: number, message: string): Response {
  const escaped = message.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[value]!));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Social connection</title><body><main><h1>Social connection could not be verified</h1><p>${escaped}</p><p>Return to Paige and start a new secure connection.</p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return errorPage(405, "This return link only accepts a browser redirect.");
  const url = new URL(req.url);
  const attemptId = url.searchParams.get("attempt") ?? "";
  const callbackToken = url.searchParams.get("token") ?? "";
  if (!UUID.test(attemptId) || !TOKEN.test(callbackToken)) return errorPage(400, "This secure return link is invalid or incomplete.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return errorPage(503, "Social connection verification is unavailable right now.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await sha256(callbackToken);
  const claimed = await admin.rpc("social_claim_connection_callback", {
    _attempt_id: attemptId, _token_hash: tokenHash, _claimed_at: new Date().toISOString(),
  });
  const claim = object(claimed.data);
  if (claimed.error || !claim || claim.provider_key !== adapter.key
      || typeof claim.tenant_id !== "string" || typeof claim.actor_id !== "string"
      || typeof claim.connection_id !== "string" || typeof claim.provider_profile_key !== "string"
      || typeof claim.requested_platform !== "string"
      || typeof claim.return_path !== "string" || !RETURN_PATH.test(claim.return_path)) {
    return errorPage(409, "This secure return link is expired, already used, or could not be matched.");
  }

  const providerStatus = url.searchParams.get("connect_status");
  const returnedPlatform = (url.searchParams.get("platform") ?? "").replace(/-/g, "_");
  // Zernio does not document its redirect parameters; its documented completion signal is
  // the profile readback. Zernio rows therefore verify by the readback below (which
  // requires the requested platform's account to be present) and fail early only on an
  // explicit cancelled/failed return. The strict redirect-parameter contract above the
  // readback stays intact for the other provider.
  const readbackIsTruth = claim.provider_key === zernioSocialAdapter.key;
  const explicitCancel = providerStatus === "cancelled" || url.searchParams.get("status") === "cancelled";
  const explicitFailure = (providerStatus !== null && providerStatus !== "success")
    || url.searchParams.get("status") === "error" || url.searchParams.get("error") !== null;
  const platformMismatch = !readbackIsTruth && returnedPlatform !== claim.requested_platform;
  if (explicitCancel || explicitFailure || platformMismatch) {
    const reportedCode = (url.searchParams.get("error_code") ?? "").toUpperCase();
    const safeReason = reportedCode === "ACCOUNT_ALREADY_LINKED" ? "account_already_linked"
      : explicitCancel ? "consent_cancelled"
        : platformMismatch ? "platform_mismatch" : "connection_failed";
    const failureCode = explicitCancel && reportedCode === "ACCESS_DENIED"
      ? "provider_consent_cancelled"
      : platformMismatch ? "provider_platform_mismatch" : "provider_connection_failed";
    await admin.rpc("social_release_connection_attempt", {
      _tenant_id: claim.tenant_id, _attempt_id: attemptId, _actor_id: claim.actor_id,
      _failure_code: failureCode, _released_at: new Date().toISOString(),
    });
    return resultRedirect(claim.return_path, explicitCancel ? "cancelled" : "verification_failed", undefined, safeReason);
  }

  try {
    const profile = await adapter.readProfile({ providerProfileKey: claim.provider_profile_key });
    if (profile.providerProfileKey !== claim.provider_profile_key) {
      throw new SocialProviderError("profile_mismatch", 502, "Profile mismatch");
    }
    const exactAccounts = profile.accounts.filter((account) => account.platform === claim.requested_platform);
    if (!exactAccounts.length) {
      throw new SocialProviderError("account_readback_missing", 502, "The connected Social account was not present in provider readback.");
    }
    const observedAt = new Date().toISOString();
    const applied = await admin.rpc("social_apply_connection_readback", {
      _tenant_id: claim.tenant_id,
      _connection_id: claim.connection_id,
      _attempt_id: attemptId,
      _token_hash: tokenHash,
      _actor_id: claim.actor_id,
      _accounts: exactAccounts,
      _observed_at: observedAt,
    });
    const readback = object(applied.data);
    if (applied.error || !readback) throw new Error("readback_write_failed");

    const railRecorded = await recordCapabilityRun(admin, {
      tenantId: claim.tenant_id,
      actorId: claim.actor_id,
      capabilityKey: "social_connection_readback",
      outcome: "capability_succeeded",
      runId: await stableRunId(["social", "connection_readback", claim.tenant_id, attemptId]),
      detail: {
        connection_id: claim.connection_id,
        platform: claim.requested_platform,
        account_count: readback.account_count,
        verified_at: readback.verified_at,
      },
    });
    return resultRedirect(claim.return_path, "verified", railRecorded);
  } catch (error) {
    const failureCode = error instanceof SocialProviderError ? error.code : "provider_readback_failed";
    await admin.rpc("social_release_connection_attempt", {
      _tenant_id: claim.tenant_id, _attempt_id: attemptId, _actor_id: claim.actor_id,
      _failure_code: failureCode, _released_at: new Date().toISOString(),
    });
    return resultRedirect(claim.return_path, "verification_failed", undefined, "readback_failed");
  }
});
