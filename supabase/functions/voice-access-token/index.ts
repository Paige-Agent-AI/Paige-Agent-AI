// Comms C-2v — Voice Access Token mint (#140 Slice A1). JWT-gated; a tenant admin
// (or the platform owner) requests a SHORT-lived Twilio Voice Access Token so their
// browser can register with Twilio and place/receive calls billed to the tenant's OWN
// Twilio subaccount. This is the callable token seam (§10) — the future dial-pad UI (A2)
// is just one caller; Paige's headless agent is another (service-role bearer).
//
// DOCTRINE
//  §9  The token is a bearer credential (whoever holds it can call as `identity` on the
//      tenant subaccount). So BOTH the tenant AND the identity are SERVER-DERIVED from
//      the caller JWT, never the body: tenant = current_user_tenant_id(); identity =
//      `${tenantId}:${userId}`. A body cannot widen scope, name another tenant, or set
//      the identity — it can only (optionally) SHORTEN the TTL within the server cap.
//      Mirrors comms-search-numbers' §9 pattern exactly (getUser → role gate →
//      current_user_tenant_id → service-role for Vault).
//  §53 PHASE 3 — a tenant-LESS platform OPERATOR (is_platform_operator(): super_admin OR
//      platform_admin) mints a token on the MASTER account with a `operator.<userId>`
//      identity (server-derived, §588). The operator branch is gated on NO tenant so the
//      tenant path stays byte-identical; an operator token NEVER touches a tenant subaccount
//      or tenant data (§9). The operator's voice runs on the same master account as operator
//      SMS + the +1 470 number.
//  §13 Honest: needs_config (not a fake token) when the subaccount / TwiML app is not
//      provisioned, or master/subaccount creds are missing. The token TTL is SHORT
//      (default 600s, hard-capped 3600s) and the identity is non-forgeable.
//  §18 Reuses the ONE Twilio seam (_shared/twilio.ts mintVoiceAccessToken) — no inline
//      JWT signing here, no second Twilio client, no new npm dep (Deno-native HMAC).
//  §34 Twilio is the last-mile commodity behind our seam. No voice-intelligence vendor
//      (Deepgram = Slice B1; Vapi = Marketplace #154) is touched here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintVoiceAccessToken, mintOperatorVoiceAccessToken, type SupabaseAdminLike } from "../_shared/twilio.ts";
import { classifyVoiceReadiness, hasTenantVoiceAuthority } from "./authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Request body — the ONLY tunable is an optional TTL, and the server CLAMPS it to
 * [60, 3600] (default 600). Tenant and identity are NEVER read from here (§9): a body
 * value can only shorten the token's life within the cap, never widen its scope.
 */
interface TokenBody {
  ttl_seconds?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── AuthN + admin gate (§9). Tenant + identity are derived from the JWT, never the body. ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  // The ONLY tunable is an optional TTL (clamped server-side). Parsed up front because BOTH the
  // operator and tenant mints need it. A body value can only shorten the token's life, never widen
  // its scope (§9/§588).
  let body: TokenBody = {};
  try { body = (await req.json()) as TokenBody; } catch { body = {}; }
  const ttlSeconds = typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined;

  // §9/§588: BOTH the tenant and the operator status are derived from the verified JWT, never the
  // body. current_user_tenant_id() resolves the caller's OWN tenant; is_platform_operator() is the
  // §53 super_admin-OR-platform_admin tier check (SECURITY DEFINER over auth.uid(); NOT overloaded,
  // so this .rpc is unambiguous — unlike the is_platform_owner() PGRST203 case).
  const { data: tenantId } = await userClient.rpc("current_user_tenant_id");
  const { data: isOperator } = await userClient.rpc("is_platform_operator");

  // ── OPERATOR path (§9/§53) — Phase 3. A tenant-LESS platform operator (super_admin OR
  //    platform_admin) mints a Voice token on the MASTER account with an operator identity
  //    (`operator.<userId>`), so they can place/receive calls billed to the platform master account
  //    (the same account as operator SMS + the +1 470 number). Gated on NO tenant, so EVERY tenant
  //    caller falls through to the byte-identical tenant path below (§37). The operator's voice never
  //    touches a tenant subaccount or tenant data (§9). ──
  if ((!tenantId || typeof tenantId !== "string") && isOperator === true) {
    // §588: the operator identity is derived SERVER-SIDE from the verified JWT (user.id), NEVER the
    // body. Format `operator.<userId>` matches OPERATOR_IDENTITY_PREFIX in voice-twiml/twiml.ts (the
    // webhook routes on it) — kept inline here exactly as the tenant identity is built inline below.
    const identity = `operator.${user.id}`;
    const minted = await mintOperatorVoiceAccessToken({ identity, ttlSeconds });
    if (!minted.ok || !minted.data) {
      // Honest degrade (§13): unconfigured master creds / master TwiML app → needs_config (200), a
      // real failure → 502. Never a fabricated token.
      return json({
        needs_config: minted.needs_config === true,
        error: minted.error ?? "voice_token_unavailable",
        message: minted.needs_config
          ? "Operator calling isn't fully set up yet. Once the platform voice number is configured you'll be able to call from the browser."
          : "Voice token is temporarily unavailable.",
      }, minted.needs_config ? 200 : 502);
    }
    return json({
      token: minted.data.token,
      identity: minted.data.identity,
      expiresAt: minted.data.expiresAt,
      ttlSeconds: minted.data.ttlSeconds,
    });
  }

  // ── TENANT path — UNCHANGED behavior (§37 byte-identical for every tenant caller). ──
  // Platform owner OR an active owner/admin IN THIS TENANT may mint. A
  // global user_roles row is not tenant authority and must never unlock another
  // workspace's billable Voice token.
  const { data: isOwner } = await userClient.rpc("is_platform_owner");
  // §9: the tenant is the caller's OWN tenant (JWT-scoped), never a body value.
  if (!tenantId || typeof tenantId !== "string") {
    return json({ needs_config: true, error: "tenant_not_resolved" });
  }
  const { data: membership, error: membershipError } = await admin
    .from("tenant_members")
    .select("tenant_id, role, status")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) {
    console.error("[voice-access-token] tenant authority lookup failed", { code: membershipError.code ?? null });
    return json({ error: "authorization_unavailable", message: "We couldn't verify calling access. Try again." }, 503);
  }
  if (!hasTenantVoiceAuthority({
    isPlatformOwner: isOwner === true,
    membershipTenantId: typeof membership?.tenant_id === "string" ? membership.tenant_id : null,
    activeTenantId: tenantId,
    membershipStatus: typeof membership?.status === "string" ? membership.status : null,
    membershipRole: typeof membership?.role === "string" ? membership.role : null,
  })) {
    return json({ error: "forbidden", message: "You don't have permission to place calls for this workspace." }, 403);
  }

  // Voice readiness is stricter than “a token can be signed.” The caller ID
  // must be the single active primary number, voice-capable, provider-bound,
  // and owned by the same active subaccount the token will use.
  const { data: subaccount, error: subaccountError } = await admin
    .from("tenant_twilio_subaccounts")
    .select("id, active, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (subaccountError) {
    console.error("[voice-access-token] calling configuration lookup failed", { code: subaccountError.code ?? null });
    return json({ error: "calling_configuration_unavailable", message: "We couldn't verify calling configuration. Try again." }, 503);
  }
  const { data: primaryNumbers, error: numberError } = await admin
    .from("tenant_phone_numbers")
    .select("subaccount_id, twilio_sid, capabilities")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("is_primary", true)
    .limit(2);
  if (numberError) {
    console.error("[voice-access-token] caller-id readiness lookup failed", { code: numberError.code ?? null });
    return json({ error: "calling_configuration_unavailable", message: "We couldn't verify your calling number. Try again." }, 503);
  }
  const readiness = classifyVoiceReadiness(subaccount, primaryNumbers);
  if (!readiness.ok) {
    return json({
      needs_config: true,
      error: readiness.code,
      // INT-345: the exact repairable reason (e.g. no number yet vs. a number that
      // can't make calls) rides alongside the coarse code so the surface can point
      // at the canonical next step instead of one collapsed string.
      reason_code: readiness.reason_code ?? null,
      message: readiness.message,
    });
  }

  // §9/§13: identity is derived SERVER-SIDE from the verified JWT (tenant + user), NEVER
  // the body. Stable per (tenant, user) so a token can only ever act as this principal;
  // the tenant prefix means it can never register under another tenant's namespace.
  // Separator is a DOT, not a colon: Twilio Client identities are embedded into the
  // `client:IDENTITY` address and must stay in [A-Za-z0-9_-.] — a colon collides with the
  // `client:` scheme and breaks inbound <Client> dial-by-identity in A2/A3. The format is
  // baked in here NOW because those later slices route on it (crew verifier + compliance).
  const identity = `${tenantId}.${user.id}`;

  const minted = await mintVoiceAccessToken(admin as unknown as SupabaseAdminLike, {
    tenantId,
    identity,
    ttlSeconds,
  });
  if (!minted.ok || !minted.data) {
    // Honest degrade (§13): a subaccount/TwiML-app that isn't provisioned yields
    // needs_config (200, so the UI shows a "not set up yet" state, not an error toast);
    // a real failure is a 502. Never a fabricated token.
    return json({
      needs_config: minted.needs_config === true,
      error: minted.needs_config === true ? "calling_not_configured" : "voice_token_unavailable",
      message: minted.needs_config
        ? "Voice isn't set up for this practice yet. Once your phone number is provisioned you'll be able to call from the browser."
        : "Voice token is temporarily unavailable.",
    }, minted.needs_config ? 200 : 502);
  }

  return json({
    token: minted.data.token,
    identity: minted.data.identity,
    expiresAt: minted.data.expiresAt,
    ttlSeconds: minted.data.ttlSeconds,
  });
});
