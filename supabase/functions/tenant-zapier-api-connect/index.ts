// Workspace-bound Zapier Workflow API OAuth and contained read-only health test.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { validateZapierGrantScopes, zapierAuthorizationScopes } from "../_shared/zapier-workflow-contract.ts";
import { callZapierWorkflowApi, readZapierProviderJson } from "../_shared/zapier-workflow-transport.ts";
import { readChatControlBody } from "../_shared/paige-turn/control-transport.ts";

const AUTHORIZE_URL = "https://api.zapier.com/v2/authorize";
const TOKEN_URL = "https://zapier.com/oauth/token/";
const ZAPS_URL = "https://api.zapier.com/v2/zaps?limit=1&offset=0";
// Existing callers remain read-only. A separate owner-selected OAuth profile
// requires the native SOLO check and stores its scope on the ORIGINAL attempt.
const READ_ONLY_SCOPES = "profile zap:account:all";
const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
const REDIRECT_URI = `${PUBLIC_BASE}/oauth/zapier/callback`;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function digest(value: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function safeState() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return b64url(bytes); }
function configured() { return !!Deno.env.get("ZAPIER_API_CLIENT_ID") && !!Deno.env.get("ZAPIER_API_CLIENT_SECRET"); }
function tokenAuth() { return `Basic ${btoa(`${Deno.env.get("ZAPIER_API_CLIENT_ID")}:${Deno.env.get("ZAPIER_API_CLIENT_SECRET")}`)}`; }

// The project intentionally uses runtime RPCs that are introduced by the paired
// migration rather than generated database types. Keep the client boundary
// untyped here so Deno does not infer every new table and RPC as `never`.
type DatabaseClient = any;
type CheckResult = ({ ok: true; count: number | null } | { ok: false; state: string; code: string }) & { generation: string };
type ExchangeResult = { ok: true; token: Record<string, unknown> } | { ok: false; kind: "authorization" | "configuration" | "provider" | "response" };

async function readiness(userClient: DatabaseClient, tenantId: string, canManage: boolean) {
  const { data, error } = await userClient.rpc("get_zapier_api_readiness");
  if (error || !data || typeof data !== "object") return null;
  if (!configured()) return { ...data, permission_profiles_supported: true, tenant_id: tenantId, can_manage: canManage, state: "capability_unavailable", failure_code: "plan_or_api_unavailable",
    accessible_zap_count: null, capabilities: [],
    limitations: ["Zapier API access requires a published Zapier integration and provider-issued OAuth credentials"] };
  return { ...data, permission_profiles_supported: true };
}

async function storeGrant(admin: DatabaseClient, tenantId: string, actorId: string, token: Record<string, unknown>, originalRequested: readonly string[], retainedRefresh = "", attemptId: string | null = null, expectedGeneration: string | null = null) {
  const access = typeof token.access_token === "string" ? token.access_token : "";
  const refresh = typeof token.refresh_token === "string" && token.refresh_token ? token.refresh_token : retainedRefresh;
  const expires = typeof token.expires_in === "number" ? token.expires_in : Number(token.expires_in);
  let scopes: string[];
  try { scopes = validateZapierGrantScopes(token.scope, originalRequested); } catch { return false; }
  if (!access || !refresh || !Number.isFinite(expires) || expires <= 0 || expires > 365 * 86400) return false;
  const { error } = await admin.rpc("zapier_api_store_grant", { _tenant: tenantId, _actor: actorId, _access: access, _refresh: refresh,
    _expires: new Date(Date.now() + expires * 1000).toISOString(), _scopes: scopes, _attempt: attemptId, _expected_generation: expectedGeneration });
  return !error;
}

async function exchange(params: URLSearchParams): Promise<ExchangeResult> {
  try {
    const signal = AbortSignal.timeout(10_000);
    const response = await fetch(TOKEN_URL, { method: "POST", redirect: "error", signal,
      headers: { Authorization: tokenAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: params });
    if (response.status === 429 || response.status >= 500) return { ok: false, kind: "provider" };
    if (!response.ok) {
      const errorBody = await readZapierProviderJson(response, signal).catch(() => null) as { error?: unknown } | null;
      const oauthError = typeof errorBody?.error === "string" ? errorBody.error.slice(0, 64) : "";
      if (oauthError === "invalid_grant") return { ok: false, kind: "authorization" };
      return { ok: false, kind: oauthError === "invalid_client" ? "configuration" : "response" };
    }
    const data = await readZapierProviderJson(response, signal).catch(() => null);
    return data && typeof data === "object" && !Array.isArray(data) ? { ok: true, token: data as Record<string, unknown> } : { ok: false, kind: "response" };
  } catch { return { ok: false, kind: "provider" }; }
}

async function currentSecret(admin: DatabaseClient, tenantId: string, actorId: string) {
  const { data } = await admin.rpc("zapier_api_secret_for_service", { _tenant: tenantId });
  if (!data || typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.generation !== "string") return { ok: false as const, state: "authorization_expired", code: "authorization_expired", generation: null };
  if (Date.parse(String(data.expires_at)) > Date.now() + 120_000) return { ok: true as const, secret: data as Record<string, unknown> & { generation: string } };
  const next = await exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refresh_token }));
  if (!next.ok) return { ok: false as const,
    state: next.kind === "authorization" ? "authorization_expired" : next.kind === "configuration" ? "capability_unavailable" : next.kind === "provider" ? "provider_unavailable" : "needs_attention",
    code: next.kind === "authorization" ? "authorization_expired" : next.kind === "configuration" ? "plan_or_api_unavailable" : next.kind === "provider" ? "provider_unavailable" : "response_invalid",
    generation: String(data.generation) };
  if (!await storeGrant(admin, tenantId, actorId, next.token, data.scopes, String(data.refresh_token), null, String(data.generation))) return { ok: false as const, state: "needs_attention", code: "response_invalid", generation: String(data.generation) };
  const { data: refreshed } = await admin.rpc("zapier_api_secret_for_service", { _tenant: tenantId });
  return refreshed && typeof refreshed.access_token === "string" && typeof refreshed.generation === "string"
    ? { ok: true as const, secret: refreshed as Record<string, unknown> & { generation: string } }
    : { ok: false as const, state: "needs_attention", code: "response_invalid", generation: String(data.generation) };
}

async function checkProvider(admin: DatabaseClient, tenantId: string, actorId: string): Promise<CheckResult> {
  const current = await currentSecret(admin, tenantId, actorId);
  if (!current.ok) {
    if (!current.generation) throw new Error("ZAPIER_CONNECTION_NOT_FOUND");
    return { ok: false, state: current.state, code: current.code, generation: current.generation };
  }
  const secret = current.secret;
  const generation = secret.generation;
  try {
    const signal = AbortSignal.timeout(10_000);
    const response = await fetch(ZAPS_URL, { redirect: "error", signal, headers: { Authorization: `Bearer ${secret.access_token}`, Accept: "application/json" } });
    if (response.status === 401) return { ok: false, state: "authorization_expired", code: "authorization_expired", generation };
    if (response.status === 403) return { ok: false, state: "capability_unavailable", code: "plan_or_api_unavailable", generation };
    if (response.status === 429 || response.status >= 500) return { ok: false, state: "provider_unavailable", code: "provider_unavailable", generation };
    if (!response.ok) return { ok: false, state: "needs_attention", code: "response_invalid", generation };
    const raw = await readZapierProviderJson(response, signal).catch(() => null);
    const body = (Array.isArray(raw) && raw.length === 1 ? raw[0] : raw) as { meta?: { count?: unknown }; data?: unknown } | null;
    if (!body || !Array.isArray(body.data)) return { ok: false, state: "needs_attention", code: "response_invalid", generation };
    const count = typeof body.meta?.count === "number" && Number.isSafeInteger(body.meta.count) && body.meta.count >= 0 ? body.meta.count : null;
    return { ok: true, count, generation };
  } catch { return { ok: false, state: "provider_unavailable", code: "provider_unavailable", generation }; }
}

async function persistCheck(admin: DatabaseClient, tenantId: string, actorId: string, result: CheckResult, outcome: string) {
  const { error } = await admin.rpc("zapier_api_record_check", { _tenant: tenantId, _actor: actorId, _healthy: result.ok,
    _state: result.ok ? "connected" : result.state, _failure: result.ok ? null : result.code,
    _count: result.ok ? result.count : null, _outcome: outcome, _generation: result.generation });
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);
  // Reuse the existing bounded transport reader for these small connection/read
  // commands. It supplies no Chat-control or execution authority here.
  const input = await readChatControlBody(new Request(req, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]) }));
  if ("status" in input) return jsonResponse({ error: "invalid_request_body" }, input.status);
  let body: Record<string, unknown>;
  try { body = input.text ? JSON.parse(input.text) : {}; }
  catch { return jsonResponse({ error: "invalid_request_body" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "invalid_request_body" }, 400);
  const action = typeof body.action === "string" ? body.action : "status";
  const { data: tenantId } = await userClient.rpc("current_user_tenant_id");
  if (!tenantId) return jsonResponse({ error: "no_tenant" }, 400);
  const expected = typeof body.expected_tenant_id === "string" ? body.expected_tenant_id : null;
  if (expected && expected !== tenantId) return jsonResponse({ error: "tenant_changed" }, 409);
  const { data: canManage } = await userClient.rpc("is_tenant_owner", { _user_id: user.id, _tenant_id: tenantId });
  if (action === "status") return jsonResponse({ ok: true, connection: await readiness(userClient, tenantId, canManage === true) });
  if (canManage !== true) return jsonResponse({ error: "forbidden" }, 403);
  if (!configured() && !["cancel", "disconnect", "oauth_refuse"].includes(action)) return jsonResponse({ error: "capability_unavailable", connection: await readiness(userClient, tenantId, true) }, 503);

  if (action === "workflow_read") {
    const operation = typeof body.operation === "string" ? body.operation : "";
    if (!["list", "apps", "actions", "connections", "history"].includes(operation)) return jsonResponse({ error: "read_operation_required" }, 400);
    const result = await callZapierWorkflowApi({ tenantId, actorId: user.id }, operation, body.arguments, {
      signal: req.signal, fetch,
      verifyOriginalAuthority: async (scope, request, generation) => {
        if (request.effect !== "read") return false;
        const fresh = await userClient.auth.getUser();
        if (fresh.error || fresh.data.user?.id !== scope.actorId) return false;
        const { data, error } = await userClient.rpc("zapier_api_workflow_read_authorized", {
          _expected_tenant: scope.tenantId, _expected_actor: scope.actorId,
          _generation: generation, _required_scope: request.requiredScope,
        });
        return !error && data === true;
      },
      loadGrant: async scope => {
        const current = await currentSecret(admin, scope.tenantId, scope.actorId);
        if (!current.ok) return null;
        const secret = current.secret;
        if (typeof secret.access_token !== "string" || !Array.isArray(secret.scopes)
          || secret.scopes.some(value => typeof value !== "string") || typeof secret.expires_at !== "string") return null;
        return { tenantId: scope.tenantId, generation: secret.generation, accessToken: secret.access_token,
          expiresAt: secret.expires_at, scopes: secret.scopes as string[] };
      },
    });
    // A read observation is not a workflow approval, activation or completed onboarding.
    return jsonResponse(result, result.state === "refused" ? 403 : result.state === "unavailable" ? 503 : 200);
  }

  if (action === "cancel") {
    const { error: cancelError } = await admin.from("tenant_zapier_api_oauth_attempts").update({ status: "cancelled" })
      .eq("tenant_id", tenantId).in("status", ["pending", "exchanging"]);
    if (cancelError) return jsonResponse({ error: "cancel_failed", connection: await readiness(userClient, tenantId, true) }, 503);
    return jsonResponse({ ok: true, outcome: "cancelled", connection: await readiness(userClient, tenantId, true) });
  }

  if (action === "oauth_refuse") {
    const state = typeof body.state === "string" ? body.state : "";
    if (!state) return jsonResponse({ error: "oauth_bad_callback" }, 400);
    const { data: refused, error: refuseError } = await admin.rpc("zapier_api_refuse", { _tenant: tenantId, _actor: user.id, _state_hash: await digest(state) });
    if (refuseError) return jsonResponse({ error: "refusal_persist_failed" }, 503);
    if (refused !== true) return jsonResponse({ error: "oauth_state_invalid" }, 409);
    return jsonResponse({ ok: true, outcome: "refused", connection: await readiness(userClient, tenantId, true) });
  }

  if (action === "oauth_begin") {
    const profile = body.permission_profile === undefined ? "read_only" : body.permission_profile;
    let scopes: readonly string[];
    try { if (typeof profile !== "string") throw new Error(); scopes = zapierAuthorizationScopes(profile); }
    catch { return jsonResponse({ error: "permission_profile_invalid" }, 400); }
    const state = safeState();
    const args = { _tenant: tenantId, _actor: user.id, _state_hash: await digest(state) };
    const { error } = profile === "read_only"
      ? await admin.rpc("zapier_api_begin_oauth", args)
      : await admin.rpc("zapier_api_begin_scoped_oauth", { ...args, _permission_profile: profile });
    if (error) return jsonResponse({ error: "start_failed" }, 500);
    const url = new URL(AUTHORIZE_URL); url.search = new URLSearchParams({ response_type: "code", client_id: Deno.env.get("ZAPIER_API_CLIENT_ID")!, redirect_uri: REDIRECT_URI,
      scope: profile === "read_only" ? READ_ONLY_SCOPES : scopes.join(" "), response_mode: "query", state }).toString();
    return jsonResponse({ ok: true, authorize_url: url.toString() });
  }

  if (action === "oauth_complete") {
    const state = typeof body.state === "string" ? body.state : ""; const code = typeof body.code === "string" ? body.code : "";
    if (!state || !code) return jsonResponse({ error: "oauth_bad_callback" }, 400);
    const hash = await digest(state);
    const { data: attempt } = await admin.from("tenant_zapier_api_oauth_attempts").select("id,tenant_id,actor_id,status,expires_at,requested_scopes").eq("state_hash", hash).maybeSingle();
    if (!attempt || attempt.actor_id !== user.id || attempt.tenant_id !== tenantId || attempt.status !== "pending" || Date.parse(attempt.expires_at) <= Date.now()) return jsonResponse({ error: "oauth_state_invalid" }, 409);
    const { data: claimed, error: claimError } = await admin.from("tenant_zapier_api_oauth_attempts").update({ status: "exchanging" })
      .eq("id", attempt.id).eq("status", "pending").select("id").maybeSingle();
    if (claimError || !claimed) return jsonResponse({ error: "oauth_state_invalid" }, 409);
    const token = await exchange(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }));
    if (!token.ok) {
      await admin.from("tenant_zapier_api_oauth_attempts").update({ status: "failed" }).eq("id", attempt.id).eq("status", "exchanging");
      return jsonResponse({ error: "oauth_exchange_failed" }, 502);
    }
    // The RPC atomically finalizes only an attempt that cancellation has not changed.
    if (!await storeGrant(admin, tenantId, user.id, token.token, attempt.requested_scopes, "", attempt.id)) {
      return jsonResponse({ error: "oauth_state_invalid" }, 409);
    }
    const result = await checkProvider(admin, tenantId, user.id);
    if (!await persistCheck(admin, tenantId, user.id, result, result.ok ? "zapier_api_connected" : "zapier_api_test_failed"))
      return jsonResponse({ error: "rail_unavailable", connection: await readiness(userClient, tenantId, true) }, 503);
    return jsonResponse({ ok: true, outcome: result.ok ? "connected" : "needs_attention", connection: await readiness(userClient, tenantId, true) });
  }

  if (action === "test") {
    const result = await checkProvider(admin, tenantId, user.id);
    if (!await persistCheck(admin, tenantId, user.id, result, result.ok ? "zapier_api_test_succeeded" : "zapier_api_test_failed"))
      return jsonResponse({ error: "rail_unavailable", connection: await readiness(userClient, tenantId, true) }, 503);
    return jsonResponse({ ok: result.ok, outcome: result.ok ? "succeeded" : "failed", error: result.ok ? undefined : result.code, connection: await readiness(userClient, tenantId, true) });
  }

  if (action === "disconnect") {
    // Zapier documents token deletion through the user's authorized-apps page, not a revocation endpoint.
    // Local access is removed immediately; the UI truthfully tells the owner how to revoke provider-side access.
    const { error: disconnectError } = await admin.rpc("zapier_api_disconnect", { _tenant: tenantId, _actor: user.id });
    if (disconnectError) return jsonResponse({ error: "local_disconnect_failed", connection: await readiness(userClient, tenantId, true) }, 503);
    return jsonResponse({ ok: true, outcome: "disconnected", provider_revoke_required: true, connection: await readiness(userClient, tenantId, true) });
  }
  return jsonResponse({ error: "unsupported_action" }, 400);
});
