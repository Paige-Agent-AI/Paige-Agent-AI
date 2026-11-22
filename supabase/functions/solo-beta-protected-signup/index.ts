import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { issueProtectedSoloCheckout } from "../_shared/solo-beta-issue-protected-checkout.ts";
import { prepareProtectedSoloOwner } from "../_shared/solo-beta-prepare-protected-owner.ts";
import { PROTECTED_SOLO_BETA_OFFER_CODE } from "../_shared/solo-beta-protected-trial.ts";
import { isProtectedSoloSandbox, PROTECTED_SOLO_LOCAL_ORIGIN } from "../_shared/solo-beta-protected-sandbox.ts";
import { handleProtectedMeetLive } from "../_shared/solo-beta-protected-meet-live.ts";
import { enableProtectedSoloRenewal } from "../_shared/solo-beta-protected-renewal.ts";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";

const consentVersion = "solo_beta_v2_email_verified_2026_11";
const origins = new Set(["https://paigeagent.ai", "https://www.paigeagent.ai", "https://app.paigeagent.ai"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const secret = /^[a-f0-9]{64}$/;
const bodyLimit = 16_384;

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readRequestBody(req: Request) {
  if (!req.body) throw new Error("invalid_request");
  if (Number(req.headers.get("content-length")) > bodyLimit) throw new Error("request_too_large");
  const reader = req.body.getReader();
  const buffer = new Uint8Array(bodyLimit);
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bodyLimit) {
        await reader.cancel();
        throw new Error("request_too_large");
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))) as unknown;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const sandboxRequested = Deno.env.get("SOLO_BETA_PROTECTED_SIGNUP_SANDBOX") === "true";
  const sandbox = isProtectedSoloSandbox(sandboxRequested, url, stripeKey);
  if (sandbox ? origin !== PROTECTED_SOLO_LOCAL_ORIGIN : !origins.has(origin)) {
    return new Response(null, { status: 403 });
  }
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  const reply = (status: number, data: object) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { code: "method_not_allowed" });
  // Availability is enabled only after the rest of the enrollment path can
  // receive a protected Stripe receipt and resume the same owner's workspace.
  if (Deno.env.get("SOLO_BETA_PROTECTED_SIGNUP_ENABLED") !== "true" || !url || !key ||
      (sandboxRequested ? !sandbox : !/^(sk|rk)_live_/.test(stripeKey))) {
    return reply(503, { code: "protected_signup_unavailable" });
  }
  const livemode = !sandbox;

  let input: Record<string, unknown>;
  try {
    const body = await readRequestBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { code: "invalid_request" });
    input = body as Record<string, unknown>;
  } catch (error) {
    return error instanceof Error && error.message === "request_too_large" ? reply(413, { code: "request_too_large" }) :
      reply(400, { code: "invalid_request" });
  }
  if (input.action !== "quote" && input.action !== "start" && input.action !== "status" &&
      input.action !== "prepare_owner" && input.action !== "meet_live" && input.action !== "verify_owner" &&
      input.action !== "enable_renewal" && input.action !== "renewal_status") {
    return reply(400, { code: "invalid_request" });
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const ip = await hash(trustedClientIp(req));
  const actionLimit = input.action === "start" ? 8 : input.action === "meet_live" ? 80 : 20;
  if (await overRateLimit(admin, `protected-solo-${input.action}:${ip}`, actionLimit, 600, true)) {
    return reply(429, { code: "retry_later" });
  }
  if (input.action === "start" && await overRateLimit(admin, "protected-solo-start:all", 80, 600, true)) {
    return reply(429, { code: "retry_later" });
  }

  const reference = typeof input.reference_id === "string" ? input.reference_id : "";
  const resume = typeof input.resume_secret === "string" ? input.resume_secret : "";
  const optionalText = (value: unknown) => typeof value === "string" ? value : undefined;
  if (input.action === "enable_renewal" || input.action === "renewal_status") {
    const enable = input.action === "enable_renewal";
    const token = req.headers.get("Authorization");
    if (!token?.startsWith("Bearer ")) return reply(401, { code: "sign_in_required" });
    if (enable && (input.renewal_consent_version !== consentVersion || input.accepted_renewal_terms !== true)) {
      return reply(400, { code: "renewal_consent_required" });
    }
    try {
      const auth = await admin.auth.getUser(token.slice(7));
      const owner = auth.data.user;
      const verifiedReference = owner?.app_metadata?.solo_beta_protected_reference;
      if (auth.error || !owner?.email_confirmed_at || typeof verifiedReference !== "string" || !uuid.test(verifiedReference)) {
        return reply(403, { code: "verified_owner_required" });
      }
      const [workspace, intake, attempt] = await Promise.all([
        admin.rpc("solo_beta_read_protected_workspace", {
          _reference_id: verifiedReference, _owner_user_id: owner.id, _provider_livemode: livemode,
        }).maybeSingle(),
        admin.from("solo_beta_protected_signup_intake").select("renewal_consent_version")
          .eq("reference_id", verifiedReference).eq("owner_user_id", owner.id).eq("provider_livemode", livemode).maybeSingle(),
        admin.from("solo_beta_protected_checkout_attempts")
          .select("stripe_checkout_id,stripe_subscription_id,stripe_customer_id,stripe_product_id,stripe_price_id,trial_ends_at")
          .eq("reference_id", verifiedReference).eq("provider_livemode", livemode).maybeSingle(),
      ]);
      if (workspace.error || intake.error || attempt.error) return reply(503, { code: "renewal_unavailable" });
      if (!workspace.data || intake.data?.renewal_consent_version !== consentVersion || !attempt.data?.stripe_subscription_id) {
        return reply(403, { code: "verified_owner_required" });
      }
      const workspaceTenant = (workspace.data as { tenant_id: string }).tenant_id;
      if (input.expected_tenant_id !== undefined && input.expected_tenant_id !== workspaceTenant) {
        return reply(409, { code: "workspace_changed" });
      }
      const bound = attempt.data;
      const result = await enableProtectedSoloRenewal(new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" }), {
        referenceId: verifiedReference, livemode, stripeCheckoutId: bound.stripe_checkout_id,
        subscriptionId: bound.stripe_subscription_id, stripeCustomerId: bound.stripe_customer_id,
        stripeProductId: bound.stripe_product_id, stripePriceId: bound.stripe_price_id,
        trialEnd: Date.parse(bound.trial_ends_at) / 1000,
      }, Math.floor(Date.now() / 1000), enable);
      return !enable || result === "renewal_enabled" ? reply(200, { state: result }) : reply(409, { code: result });
    } catch {
      return reply(503, { code: "renewal_unavailable" });
    }
  }
  if (input.action === "meet_live") {
    if (!uuid.test(reference) || !secret.test(resume)) return reply(404, { code: "signup_not_found" });
    if (await overRateLimit(admin, `protected-solo-meet:${reference}`, 35, 120, true)) {
      return reply(429, { code: "retry_later" });
    }
    try {
      const result = await handleProtectedMeetLive(admin, {
        referenceId: reference, resumeSecretHash: await hash(resume), returnOrigin: origin,
        operation: optionalText(input.operation) ?? "",
        sessionId: optionalText(input.session_id), transition: optionalText(input.transition),
        challenge: optionalText(input.challenge), transcript: optionalText(input.transcript),
        cue: optionalText(input.cue), acknowledgementVersion: optionalText(input.acknowledgement_version),
      });
      return reply(result.status, result.body);
    } catch {
      return reply(503, { code: "meet_access_unavailable" });
    }
  }
  if (input.action === "verify_owner") {
    if (!uuid.test(reference) || !secret.test(resume)) return reply(404, { code: "signup_not_found" });
    const scope = { _reference_id: reference, _resume_secret_hash: await hash(resume), _return_origin: origin };
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) return reply(503, { code: "verification_unavailable" });
    try {
      const owner = await admin.rpc("solo_beta_read_protected_owner", scope).maybeSingle();
      const identity = owner.data as { primary_email: string; owner_user_id: string | null; email_verified: boolean } | null;
      if (owner.error || !identity?.owner_user_id) return reply(409, { code: "verification_unavailable" });
      if (identity.email_verified) return reply(200, { state: "already_verified" });
      // Sending a link is a recovery action. It can continue after the Meet
      // window closes, and never provisions or reopens a workspace itself.
      const { data: enrollment, error: enrollmentError } = await admin.from("solo_beta_enrollments")
        .select("tenant_id").eq("reference_id", reference).eq("user_id", identity.owner_user_id)
        .eq("offer_code", PROTECTED_SOLO_BETA_OFFER_CODE).eq("state", "fulfilled").maybeSingle();
      if (enrollmentError || !enrollment?.tenant_id) return reply(409, { code: "verification_unavailable" });
      if (await overRateLimit(admin, `protected-solo-verification:${reference}`, 3, 600, true)) {
        return reply(429, { code: "retry_later" });
      }
      const auth = createClient(url, anonKey, { auth: { persistSession: false } });
      // Native recovery verifies possession of this mailbox and takes the
      // owner through the existing password creation screen. It cannot create
      // an account and no verification token crosses this response.
      const { error } = await auth.auth.resetPasswordForEmail(identity.primary_email, {
        redirectTo: `${origin}/reset-password`,
      });
      return error ? reply(503, { code: "verification_unavailable" }) : reply(200, { state: "verification_sent" });
    } catch {
      return reply(503, { code: "verification_unavailable" });
    }
  }
  if (input.action === "prepare_owner") {
    if (!uuid.test(reference) || !secret.test(resume)) return reply(404, { code: "signup_not_found" });
    if (await overRateLimit(admin, "protected-solo-owner:all", 80, 600, true)) return reply(429, { code: "retry_later" });
    const scope = { _reference_id: reference, _resume_secret_hash: await hash(resume), _return_origin: origin };
    try {
      const result = await prepareProtectedSoloOwner(reference, {
        async read() {
          const { data, error } = await admin.rpc("solo_beta_read_protected_owner", scope).maybeSingle();
          if (error) throw new Error("owner_preparation_unavailable");
          const row = data as { primary_email: string; owner_user_id: string | null; email_verified: boolean } | null;
          if (!row) return null;
          const { data: receipt, error: receiptError } = await admin.from("solo_beta_protected_checkout_attempts")
            .select("checkout_event_id").eq("reference_id", reference).eq("provider_livemode", livemode).maybeSingle();
          if (receiptError) throw new Error("owner_preparation_unavailable");
          // The receipt column can only be set by the signed event binding RPC.
          return { primaryEmail: row.primary_email, ownerUserId: row.owner_user_id,
            emailVerified: row.email_verified, signedCheckout: Boolean(receipt?.checkout_event_id) };
        },
        async create(input) {
          const { error } = await admin.auth.admin.createUser(input);
          if (error) throw new Error("owner_preparation_unavailable");
        },
        async bind(ownerUserId) {
          const { data, error } = await admin.rpc("solo_beta_bind_protected_owner", { ...scope, _owner_user_id: ownerUserId });
          if (error) throw new Error("owner_preparation_unavailable");
          return data === true;
        },
      });
      if (!result.ok) return reply(409, { code: result.code });
      const workspace = await admin.rpc("solo_beta_prepare_protected_workspace", scope).maybeSingle();
      if (workspace.error) return reply(503, { code: "workspace_preparation_unavailable" });
      if (!workspace.data) {
        const { data: attempt } = await admin.from("solo_beta_protected_checkout_attempts")
          .select("verification_deadline_at").eq("reference_id", reference).eq("provider_livemode", livemode).maybeSingle();
        if (!result.emailVerified && attempt?.verification_deadline_at &&
            Date.parse(attempt.verification_deadline_at) <= Date.now()) {
          return reply(200, { state: "verification_required" });
        }
        return reply(409, { code: "workspace_preparation_pending" });
      }
      return reply(200, { state: "workspace_prepared", email_verified: result.emailVerified });
    } catch {
      return reply(503, { code: "owner_preparation_unavailable" });
    }
  }
  if (input.action === "status") {
    if (!uuid.test(reference) || !secret.test(resume)) return reply(404, { code: "signup_not_found" });
    const { data: intake, error } = await admin.from("solo_beta_protected_signup_intake")
      .select("reference_id").eq("reference_id", reference).eq("resume_secret_hash", await hash(resume))
      .eq("provider_livemode", livemode).eq("return_origin", origin).maybeSingle();
    if (error) return reply(503, { code: "protected_signup_unavailable" });
    if (!intake) return reply(404, { code: "signup_not_found" });
    const { data: attempt, error: attemptError } = await admin.from("solo_beta_protected_checkout_attempts")
      .select("trial_ends_at,provider_state,last_error_code,checkout_event_id").eq("reference_id", reference)
      .eq("provider_livemode", livemode).maybeSingle();
    if (attemptError) return reply(503, { code: "protected_signup_unavailable" });
    if (!attempt?.trial_ends_at || !attempt.checkout_event_id) {
      return reply(200, { state: attempt?.last_error_code ? "needs_recovery" : "billing_pending" });
    }
    const remainingTrial = Date.parse(attempt.trial_ends_at) > Date.now();
    return reply(200, { state: remainingTrial && (!attempt.provider_state || attempt.provider_state === "trialing") ?
      "billing_ready" : "billing_ended" });
  }

  let stripePriceId: string;
  let stripeProductId: string;
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  if (sandbox) {
    const testPriceId = Deno.env.get("SOLO_BETA_PROTECTED_SANDBOX_PRICE_ID") ?? "";
    if (!/^price_[A-Za-z0-9]+$/.test(testPriceId)) return reply(503, { code: "protected_signup_unavailable" });
    const price = await stripe.prices.retrieve(testPriceId, { expand: ["product"] }).catch(() => null);
    const product = price?.product;
    if (!price || price.id !== testPriceId || price.livemode || !price.active || price.unit_amount !== 9700 ||
        price.currency !== "usd" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 ||
        !product || typeof product === "string" || product.deleted || product.livemode || !product.active) {
      return reply(503, { code: "protected_signup_unavailable" });
    }
    stripePriceId = price.id;
    stripeProductId = product.id;
  } else {
    const { data: offer, error } = await admin.from("platform_subscription_offers")
      .select("stripe_product_id,stripe_price_id,provider_mode,status,unit_amount_cents,currency,billing_interval,interval_count,trial_days")
      .eq("offer_code", PROTECTED_SOLO_BETA_OFFER_CODE).maybeSingle();
    if (error || !offer || offer.status !== "live_ready" || offer.provider_mode !== "live" ||
        !offer.stripe_price_id || !offer.stripe_product_id || offer.unit_amount_cents !== 9700 || offer.currency !== "usd" ||
        offer.billing_interval !== "month" || offer.interval_count !== 1 || offer.trial_days !== 30) {
      return reply(503, { code: "protected_signup_unavailable" });
    }
    stripePriceId = offer.stripe_price_id;
    stripeProductId = offer.stripe_product_id;
  }

  if (input.action === "quote") {
    const { data: documents, error } = await admin.from("legal_documents").select("slug,version,title")
      .eq("is_current", true).or("required_at_signup.eq.true,slug.eq.saas-standalone").order("slug");
    if (error || !documents?.some((document) => document.slug === "saas-standalone")) {
      return reply(503, { code: "protected_signup_unavailable" });
    }
    return reply(200, { offer: { renews_at_cents: 9700, currency: "usd", interval: "month", trial_days: 30 },
      documents, renewal_consent_version: consentVersion });
  }

  const email = typeof input.primary_email === "string" ? input.primary_email.trim().toLowerCase() : "";
  const documents = input.accepted_documents;
  if (!uuid.test(reference) || !secret.test(resume) || email.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(email) ||
      !documents || typeof documents !== "object" || Array.isArray(documents) ||
      input.renewal_consent_version !== consentVersion || input.accepted_renewal_terms !== true) {
    return reply(400, { code: "signup_terms_required" });
  }

  try {
    const digest = await hash(resume);
    const { data: reserved, error } = await admin.rpc("solo_beta_reserve_protected_signup", {
      _reference_id: reference, _resume_secret_hash: digest, _primary_email: email, _accepted_documents: documents,
      _renewal_consent_version: consentVersion, _stripe_product_id: stripeProductId,
      _stripe_price_id: stripePriceId, _provider_livemode: livemode, _return_origin: origin,
    });
    if (error) return reply(503, { code: "protected_signup_unavailable" });
    if (reserved === "terms_changed") return reply(409, { code: "terms_changed" });
    if (reserved !== "created" && reserved !== "existing") return reply(409, { code: "protected_signup_unavailable" });
    const { data: bound, error: readError } = await admin.from("solo_beta_protected_signup_intake")
      .select("reference_id,primary_email,stripe_product_id,stripe_price_id,provider_livemode,created_at,return_origin")
      .eq("reference_id", reference).eq("resume_secret_hash", digest).maybeSingle();
    if (readError || !bound || bound.provider_livemode !== livemode || bound.return_origin !== origin ||
        bound.stripe_price_id !== stripePriceId || bound.stripe_product_id !== stripeProductId) {
      return reply(503, { code: "protected_signup_unavailable" });
    }

    const readAttempt = async (ref: string) => {
      const { data, error } = await admin.from("solo_beta_protected_checkout_attempts")
        .select("stripe_checkout_id,stripe_customer_id").eq("reference_id", ref).maybeSingle();
      if (error) throw new Error("checkout_attempt_read_failed");
      return data && { checkoutId: data.stripe_checkout_id, stripeCustomerId: data.stripe_customer_id };
    };
    const result = await issueProtectedSoloCheckout({
      referenceId: bound.reference_id, primaryEmail: bound.primary_email, stripeProductId: bound.stripe_product_id,
      stripePriceId: bound.stripe_price_id, livemode, createdAt: Math.floor(Date.parse(bound.created_at) / 1000),
      returnOrigin: bound.return_origin,
    }, Math.floor(Date.now() / 1000), {
      readAttempt,
      async bindAttempt(intake, checkoutId, stripeCustomerId) {
        const { error } = await admin.from("solo_beta_protected_checkout_attempts").upsert({
          reference_id: intake.referenceId, provider_livemode: intake.livemode, stripe_customer_id: stripeCustomerId,
          stripe_checkout_id: checkoutId, stripe_product_id: intake.stripeProductId, stripe_price_id: intake.stripePriceId,
        }, { onConflict: "reference_id", ignoreDuplicates: true });
        if (error) return false;
        const readback = await readAttempt(intake.referenceId);
        return readback?.checkoutId === checkoutId && readback.stripeCustomerId === stripeCustomerId;
      },
    }, stripe);
    return result.ok ? reply(200, { url: result.url }) : reply(409, { code: result.code });
  } catch {
    return reply(503, { code: "protected_signup_unavailable" });
  }
});
