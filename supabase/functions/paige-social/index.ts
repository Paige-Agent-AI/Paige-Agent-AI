import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { recordCapabilityRun, stableRunId, type CapabilityOutcome } from "../_shared/capability-record.ts";
import { buildSocialProfileKey, GOOGLE_CONNECT_AREAS, SOCIAL_CONNECTION_PLATFORMS, SocialProviderError } from "../_shared/social-provider/mod.ts";
import { governSocialMutation } from "../_shared/social-provider/governance.ts";
import { zernioSocialAdapter, listZernioHubProfiles, readZernioHubProfile } from "../_shared/social-provider/zernio.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETURN_PATH = /^\/(solo\/[A-Za-z0-9_-]+|operator)\/settings\/integrations\/?$/;
// Zernio is the SOLE social provider (owner directive ANT-164 3f511055, Nov 2 2026 — Zernio sole
// aggregator, Upload-Post retired). No vaulted ZERNIO_API_KEY means the honest
// SOCIAL_PROVIDER_UNAVAILABLE refusal below, never a second provider.
const adapter = zernioSocialAdapter;

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function safePublicBase(): string | null {
  // Canonical-app-url contract (mcp-oauth-callback, tenant-signup, send-transactional-email,
  // public-booking): PUBLIC_SITE_URL is optional with the platform's canonical origin as the
  // fallback. This was the platform's only hard-required read — PUBLIC_SITE_URL was never
  // provisioned because nothing else needs it, which silently closed the whole connect door
  // (2026-11-04: every click refused 503 while the provider key was present and toast-confirmed).
  const configured = Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorCode(error: unknown): string {
  if (error instanceof SocialProviderError) return error.code;
  return "provider_request_failed";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const configuredProfileSecret = Deno.env.get("SOCIAL_PROFILE_SIGNING_SECRET")?.trim();
  // Domain-separate the already server-only service secret so Social does not
  // require a second privileged secret-management step merely to mint opaque profile ids.
  const profileSecret = configuredProfileSecret || `paige-social-profile-v1:${serviceKey}`;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ ok: false, code: "SOCIAL_UNAVAILABLE" }, 503);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return jsonResponse({ ok: false, code: "SOCIAL_UNAUTHENTICATED" }, 401);

  const [tenantResult, adminResult] = await Promise.all([
    caller.rpc("current_user_tenant_id"),
    caller.rpc("is_current_user_tenant_admin"),
  ]);
  const sessionTenantId = typeof tenantResult.data === "string" ? tenantResult.data : null;
  // Platform Operator (God Level) fallback: when the caller holds no active workspace, the
  // ONE designated workspace is resolved server-side via the platform-owner-only resolver —
  // never from the request (§9/§10). Zero rows for anyone else: fail closed.
  let tenantId = sessionTenantId;
  let actingAsPlatformWorkspace = false;
  if (!tenantId) {
    const resolved = await caller.rpc("resolve_platform_operator_workspace");
    const row = object(Array.isArray(resolved.data) ? resolved.data[0] : resolved.data);
    const resolvedId = row && typeof row.id === "string" ? row.id : null;
    if (resolvedId) { tenantId = resolvedId; actingAsPlatformWorkspace = true; }
  }
  if (!tenantId) return jsonResponse({ ok: false, code: "SOCIAL_TENANT_UNRESOLVED" }, 403);

  let body: Json;
  try {
    body = object(await req.json()) ?? {};
  } catch {
    return jsonResponse({ ok: false, code: "BAD_JSON" }, 400);
  }
  const expectedTenant = text(body.expected_tenant_id, 36);
  if (expectedTenant && expectedTenant !== tenantId) {
    return jsonResponse({ ok: false, code: "ACTIVE_ACCOUNT_CHANGED" }, 409);
  }
  const action = text(body.action, 40) ?? "";
  const approvedFingerprint = body.approval_fingerprint === undefined
    ? undefined
    : text(body.approval_fingerprint, 16);
  // The platform owner acting on the designated workspace holds workspace authority by
  // construction (the resolver grants nothing less) — that authority is the access gate here.
  const isAdmin = actingAsPlatformWorkspace || (adminResult.error ? false : adminResult.data === true);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "decline") {
    const fingerprint = text(body.approval_fingerprint, 16);
    const capability = text(body.capability, 80);
    if (!fingerprint || !/^[0-9a-f]{16}$/.test(fingerprint) || ![
      "social_connection_start", "social_connection_disconnect", "social_account_select",
      "social_connection_adopt",
    ].includes(capability ?? "")) {
      return jsonResponse({ ok: false, code: "SOCIAL_DECLINE_INVALID" }, 400);
    }
    const declined = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", capability)
      .eq("fingerprint", fingerprint).is("thread_id", null).is("scoped_client_id", null)
      .is("consumed_at", null).not("server_issued_at", "is", null)
      .select("id").maybeSingle();
    if (declined.error || !object(declined.data)) {
      return jsonResponse({ ok: false, code: "SOCIAL_DECLINE_NOT_RECORDED" }, 409);
    }
    return jsonResponse({ ok: true, state: "declined" });
  }

  const govern = async (
    capability: "social_connection_start" | "social_connection_disconnect" | "social_account_select" | "social_connection_adopt",
    args: Json,
    summary: string,
    availability: "needs_approval" | "needs_setup" | "unavailable" = "needs_approval",
  ) => governSocialMutation({
    callerDb: caller as never,
    adminDb: admin as never,
    userId: user.id,
    tenantId,
    accessAllowed: isAdmin,
    capability,
    availability,
    requestArgs: args,
    summary,
    approvedFingerprint,
  });

  const governedResponse = (result: Awaited<ReturnType<typeof govern>>) => {
    if (result.kind === "approval_required") {
      return jsonResponse({
        ok: false,
        state: "approval_required",
        approval: { fingerprint: result.fingerprint, summary: result.summary, expires_at: result.expiresAt },
      }, 202);
    }
    if (result.kind === "refuse") {
      const status = result.code === "access_denied" ? 403 : result.code === "capability_unavailable" ? 503 : 409;
      return jsonResponse({ ok: false, state: "refused", code: result.code, message: result.message }, status);
    }
    return null;
  };

  const record = async (capabilityKey: string, confirmationId: string, outcome: CapabilityOutcome, detail: Json) =>
    recordCapabilityRun(admin, {
      tenantId,
      actorId: user.id,
      capabilityKey,
      outcome,
      runId: await stableRunId(["social", capabilityKey, tenantId, confirmationId]),
      detail,
    });

  if (action === "start") {
    const returnPath = text(body.return_path, 300);
    const label = text(body.label, 120);
    const reconnectId = text(body.connection_id, 36);
    const platform = text(body.platform, 32);
    // Google is the one platform whose connect areas ride along (the provider requires
    // them; every other platform ignores or rejects a scopes parameter). Areas are
    // validated against the provider's closed set and default to Gmail-and-Calendar.
    const googleAreas = (raw: unknown): string[] => Array.isArray(raw)
      ? [...new Set(raw.filter((area): area is typeof GOOGLE_CONNECT_AREAS[number] =>
          typeof area === "string" && (GOOGLE_CONNECT_AREAS as readonly string[]).includes(area)))].slice(0, 4)
      : [];
    const requestedAreas = platform === "google" ? googleAreas(body.scopes) : [];
    const scopes = platform === "google" && requestedAreas.length ? requestedAreas
      : platform === "google" ? ["email", "calendar"] : undefined;
    if (!returnPath || !RETURN_PATH.test(returnPath) || (reconnectId && !UUID.test(reconnectId))
        || !platform || !SOCIAL_CONNECTION_PLATFORMS.includes(platform as typeof SOCIAL_CONNECTION_PLATFORMS[number])) {
      return jsonResponse({ ok: false, code: "SOCIAL_REQUEST_INVALID" }, 400);
    }
    const configured = adapter.isConfigured() && Boolean(safePublicBase());
    const args: Json = { return_path: returnPath, platform, label, ...(reconnectId ? { connection_id: reconnectId } : {}), ...(scopes ? { scopes } : {}) };
    const result = await govern(
      "social_connection_start",
      args,
      reconnectId
        ? "Reconnect this Social identity and verify the accounts it authorizes. Nothing will be published."
        : "Create a Social connection and open secure account authorization. Nothing will be published.",
      configured ? "needs_approval" : "unavailable",
    );
    const early = governedResponse(result);
    if (early || result.kind !== "execute") return early!;

    const approved = result.args;
    const approvedReturnPath = text(approved.return_path, 300);
    const approvedLabel = text(approved.label, 120);
    const approvedReconnectId = text(approved.connection_id, 36);
    const approvedPlatform = text(approved.platform, 32);
    const approvedScopes = approvedPlatform === "google" ? googleAreas(approved.scopes) : [];
    const approvedAreas = approvedPlatform === "google" && approvedScopes.length ? approvedScopes
      : approvedPlatform === "google" ? ["email", "calendar"] : undefined;
    if (!approvedReturnPath || !RETURN_PATH.test(approvedReturnPath) || (approvedReconnectId && !UUID.test(approvedReconnectId))
        || !approvedPlatform || !SOCIAL_CONNECTION_PLATFORMS.includes(approvedPlatform as typeof SOCIAL_CONNECTION_PLATFORMS[number])) {
      return jsonResponse({ ok: false, code: "SOCIAL_APPROVAL_INVALID" }, 409);
    }

    const connectionId = approvedReconnectId ?? crypto.randomUUID();
    let providerProfileKey: string;
    let createdProfile = false;
    if (approvedReconnectId) {
      const existing = await admin.from("paige_social_connections")
        .select("id,provider_key,provider_profile_key,requested_platform")
        .eq("tenant_id", tenantId).eq("id", approvedReconnectId).maybeSingle();
      const row = object(existing.data);
      if (existing.error || !row || row.provider_key !== adapter.key || row.requested_platform !== approvedPlatform || typeof row.provider_profile_key !== "string") {
        return jsonResponse({ ok: false, code: "SOCIAL_CONNECTION_NOT_FOUND" }, 404);
      }
      providerProfileKey = row.provider_profile_key;
      const changed = await admin.from("paige_social_connections").update({
        status: "authorizing", failure_code: null, label: approvedLabel,
        authorization_expires_at: null, disconnected_at: null,
      }).eq("tenant_id", tenantId).eq("id", connectionId);
      if (changed.error) return jsonResponse({ ok: false, code: "SOCIAL_STATE_WRITE_FAILED" }, 500);
    } else {
      providerProfileKey = await buildSocialProfileKey(tenantId, connectionId, profileSecret);
      const inserted = await admin.from("paige_social_connections").insert({
        id: connectionId, tenant_id: tenantId, provider_key: adapter.key,
        provider_profile_key: providerProfileKey, requested_platform: approvedPlatform, label: approvedLabel,
        status: "authorizing", connected_by: user.id,
      });
      if (inserted.error) return jsonResponse({ ok: false, code: "SOCIAL_STATE_WRITE_FAILED" }, 500);
    }

    const attemptId = crypto.randomUUID();
    const callbackToken = randomToken();
    const tokenHash = await sha256(callbackToken);
    const base = safePublicBase();
    if (!base) return jsonResponse({ ok: false, code: "SOCIAL_UNAVAILABLE" }, 503);
    const callback = new URL(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/paige-social-callback`);
    callback.searchParams.set("attempt", attemptId);
    callback.searchParams.set("token", callbackToken);

    try {
      if (!approvedReconnectId) {
        createdProfile = (await adapter.createProfile({ providerProfileKey })).created;
      }
      const attempt = await admin.from("paige_social_connection_attempts").insert({
        id: attemptId, tenant_id: tenantId, connection_id: connectionId,
        confirmation_id: result.confirmationId, token_hash: tokenHash, requested_platform: approvedPlatform,
        state: "created", return_path: approvedReturnPath,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), created_by: user.id,
      });
      if (attempt.error) throw new Error("attempt_write_failed");
      let authorization: Awaited<ReturnType<typeof adapter.createConnectUrl>>;
      try {
        authorization = await adapter.createConnectUrl({ providerProfileKey, redirectUrl: callback.href, platform: approvedPlatform, ...(approvedAreas ? { scopes: approvedAreas } : {}) });
      } catch (error) {
        if (!(approvedReconnectId && error instanceof SocialProviderError && error.code === "provider_profile_not_found")) throw error;
        createdProfile = (await adapter.createProfile({ providerProfileKey })).created;
        authorization = await adapter.createConnectUrl({ providerProfileKey, redirectUrl: callback.href, platform: approvedPlatform, ...(approvedAreas ? { scopes: approvedAreas } : {}) });
      }
      const update = await admin.from("paige_social_connections").update({
        authorization_expires_at: authorization.expiresAt,
      }).eq("tenant_id", tenantId).eq("id", connectionId);
      if (update.error) throw new Error("connection_expiry_write_failed");
      const railRecorded = await record("social_connection_start", result.confirmationId, "capability_succeeded", {
        connection_id: connectionId,
        state: "authorizing",
        budget: "no_paid_action",
      });
      return jsonResponse({
        ok: true,
        state: "authorization_required",
        platform: approvedPlatform,
        connection_id: connectionId,
        authorization_url: authorization.url,
        expires_at: authorization.expiresAt,
        receipt_recorded: railRecorded,
        scope_notice: "The secure Social connection page shows each platform's requested permissions before you consent.",
      });
    } catch (error) {
      if (createdProfile) await adapter.deleteProfile({ providerProfileKey }).catch(() => undefined);
      const code = errorCode(error);
      await admin.from("paige_social_connections").update({ status: "error", failure_code: code })
        .eq("tenant_id", tenantId).eq("id", connectionId);
      await admin.from("paige_social_connection_attempts").update({
        state: "failed", completed_at: new Date().toISOString(), provider_error_code: code,
      }).eq("tenant_id", tenantId).eq("id", attemptId).in("state", ["created", "redirected"]);
      await record("social_connection_start", result.confirmationId, "capability_failed", {
        connection_id: connectionId, platform: approvedPlatform, state: "error", failure_code: code, budget: "no_paid_action",
      });
      const safeCode = code === "provider_profile_limit" || code === "provider_rate_limited"
        ? code : "SOCIAL_PROVIDER_UNAVAILABLE";
      const status = safeCode === "provider_profile_limit" ? 409 : safeCode === "provider_rate_limited" ? 429 : 502;
      return jsonResponse({ ok: false, code: safeCode }, status);
    }
  }

  if (action === "channels") {
    if (!isAdmin) return jsonResponse({ ok: false, code: "SOCIAL_CHANNELS_FORBIDDEN" }, 403);
    // Read-only listing of the resolved workspace's own Social connections — the same
    // authority hub_profiles uses. Reads mirror provider-proven facts only; mutations stay
    // governed, and nothing here publishes or exposes credentials.
    const [connRead, accRead] = await Promise.all([
      admin.from("paige_social_connections")
        .select("id,requested_platform,label,status,last_verified_at,provided_by_platform")
        .eq("tenant_id", tenantId)
        .order("requested_platform", { ascending: true }),
      admin.from("paige_social_accounts")
        .select("connection_id")
        .eq("tenant_id", tenantId),
    ]);
    if (connRead.error || accRead.error) {
      return jsonResponse({ ok: false, code: "SOCIAL_CHANNELS_READ_FAILED" }, 502);
    }
    const conns = Array.isArray(connRead.data) ? connRead.data : [];
    const accs = Array.isArray(accRead.data) ? accRead.data : [];
    const counts = new Map<string, number>();
    for (const acc of accs) {
      const key = typeof acc?.connection_id === "string" ? acc.connection_id : "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return jsonResponse({
      ok: true,
      channels: conns.map((row) => ({
        // id rides along so the operator's card drawer can target THIS connection
        // for a governed disconnect; it is the row key, never a credential.
        id: row.id,
        platform: row.requested_platform,
        label: row.label,
        status: row.status,
        providedByPlatform: row.provided_by_platform === true,
        lastVerifiedAt: row.last_verified_at,
        accountCount: counts.get(row.id) ?? 0,
      })),
    });
  }

  if (action === "hub_profiles") {
    if (!isAdmin) return jsonResponse({ ok: false, code: "SOCIAL_HUB_FORBIDDEN" }, 403);
    if (!adapter.isConfigured()) {
      return jsonResponse({ ok: false, code: "capability_unavailable", message: "Social connection setup is not configured for this environment." }, 503);
    }
    // Read-only listing of the platform hub's non-tenant profiles for the adoption
    // surface. Mutations stay governed; this read reveals only channels the provider
    // readback already proves, mapped onto the customer catalogue vocabulary.
    const hubs = await listZernioHubProfiles();
    return jsonResponse({
      ok: true,
      hubs: hubs.map((hub) => ({
        profileId: hub.profileId,
        name: hub.name,
        channels: hub.accounts.map((account) => ({
          platform: account.platform,
          handle: account.handle,
          displayName: account.displayName,
          status: account.status,
          adoptable: (SOCIAL_CONNECTION_PLATFORMS as readonly string[]).includes(account.platform),
        })),
      })),
    });
  }

  if (action === "adopt") {
    const profileId = text(body.profileId, 64);
    const requestedPlatforms = Array.isArray(body.platforms)
      ? [...new Set(body.platforms.filter((p): p is string => typeof p === "string" && SOCIAL_CONNECTION_PLATFORMS.includes(p as typeof SOCIAL_CONNECTION_PLATFORMS[number])))].slice(0, 10)
      : [];
    if (!profileId || !requestedPlatforms.length) {
      return jsonResponse({ ok: false, code: "SOCIAL_REQUEST_INVALID" }, 400);
    }
    const configured = adapter.isConfigured();
    const args: Json = { profileId, platforms: requestedPlatforms };
    const result = await govern(
      "social_connection_adopt",
      args,
      "Bring the platform hub's existing Social channels into this workspace as platform-provided connections. Nothing is published.",
      configured ? "needs_approval" : "unavailable",
    );
    const early = governedResponse(result);
    if (early || result.kind !== "execute") return early!;

    const approvedProfileId = text(result.args.profileId, 64);
    const approvedPlatforms = Array.isArray(result.args.platforms)
      ? result.args.platforms.filter((p): p is string => typeof p === "string" && SOCIAL_CONNECTION_PLATFORMS.includes(p as typeof SOCIAL_CONNECTION_PLATFORMS[number]))
      : [];
    if (!approvedProfileId || !approvedPlatforms.length) {
      return jsonResponse({ ok: false, code: "SOCIAL_APPROVAL_INVALID" }, 409);
    }
    // Provider readback is the only truth: a platform is adopted only when the hub
    // readback actually holds a connected account for it.
    const hub = await readZernioHubProfile(approvedProfileId);
    const verified = hub.accounts.filter((account) => approvedPlatforms.includes(account.platform));
    const skipped = approvedPlatforms.filter((p) => !verified.some((account) => account.platform === p));
    if (!verified.length) return jsonResponse({ ok: false, code: "SOCIAL_ADOPT_NOTHING_VERIFIED", skipped }, 409);
    const accountsJson = verified.map((account) => ({
      platform: account.platform,
      providerAccountId: account.providerAccountId,
      handle: account.handle,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      status: account.status,
      capabilities: account.capabilities,
    }));
    const written = await admin.rpc("social_adopt_platform_channels", {
      _tenant_id: tenantId, _actor_id: user.id, _confirmation_id: result.confirmationId,
      _hub_profile_id: approvedProfileId, _accounts: accountsJson,
    });
    if (written.error || !object(written.data)) return jsonResponse({ ok: false, code: "SOCIAL_ADOPT_FAILED" }, 500);
    const railRecorded = await record("social_connection_adopt", result.confirmationId, "capability_succeeded", {
      hub_profile_id: approvedProfileId,
      platforms: verified.map((account) => account.platform),
      skipped,
      budget: "no_paid_action",
    });
    return jsonResponse({
      ok: true, state: "adopted", ...(written.data as Json), skipped, receipt_recorded: railRecorded,
    });
  }

  if (action === "select") {
    const connectionId = text(body.connection_id, 36);
    const accountId = text(body.account_id, 36);
    if (!connectionId || !accountId || !UUID.test(connectionId) || !UUID.test(accountId)) {
      return jsonResponse({ ok: false, code: "SOCIAL_REQUEST_INVALID" }, 400);
    }
    const account = await admin.from("paige_social_accounts").select("id,status")
      .eq("tenant_id", tenantId).eq("connection_id", connectionId).eq("id", accountId).maybeSingle();
    const selectable = !account.error && object(account.data)?.status === "connected";
    const result = await govern(
      "social_account_select",
      { connection_id: connectionId, account_id: accountId },
      "Select this connected Social account as the target for future drafts. Nothing will be published.",
      selectable ? "needs_approval" : "needs_setup",
    );
    const early = governedResponse(result);
    if (early || result.kind !== "execute") return early!;
    const written = await admin.rpc("social_set_selected_account", {
      _tenant_id: tenantId, _connection_id: connectionId, _account_id: accountId,
      _actor_id: user.id, _confirmation_id: result.confirmationId,
      _selected_at: new Date().toISOString(),
    });
    if (written.error || !object(written.data)) return jsonResponse({ ok: false, code: "SOCIAL_SELECTION_FAILED" }, 409);
    const railRecorded = await record("social_account_select", result.confirmationId, "capability_succeeded", {
      connection_id: connectionId, account_id: accountId, budget: "no_paid_action",
    });
    return jsonResponse({ ok: true, state: "selected", ...(written.data as Json), receipt_recorded: railRecorded });
  }

  if (action === "disconnect") {
    const connectionId = text(body.connection_id, 36);
    if (!connectionId || !UUID.test(connectionId)) return jsonResponse({ ok: false, code: "SOCIAL_REQUEST_INVALID" }, 400);
    const existing = await admin.from("paige_social_connections").select("id,status,provider_key,provider_profile_key,provided_by_platform")
      .eq("tenant_id", tenantId).eq("id", connectionId).maybeSingle();
    const connection = object(existing.data);
    const available = !existing.error && connection && connection.provider_key === adapter.key && connection.status !== "disconnected";
    const result = await govern(
      "social_connection_disconnect",
      { connection_id: connectionId },
      "Disconnect this Social identity and revoke its provider profile. Future Social actions will be blocked.",
      available ? "needs_approval" : "needs_setup",
    );
    const early = governedResponse(result);
    if (early || result.kind !== "execute") return early!;
    if (!connection || typeof connection.provider_profile_key !== "string") {
      return jsonResponse({ ok: false, code: "SOCIAL_CONNECTION_NOT_FOUND" }, 404);
    }
    // A platform-provided connection shares the operator's hub profile: disconnecting
    // removes this workspace's rows only — never the provider profile other workspaces use.
    const isPlatformProvided = connection.provided_by_platform === true;
    if (isPlatformProvided) {
      const written0 = await admin.rpc("social_mark_connection_disconnected", {
        _tenant_id: tenantId, _connection_id: connectionId, _actor_id: user.id,
        _confirmation_id: result.confirmationId, _disconnected_at: new Date().toISOString(),
      });
      if (written0.error || !object(written0.data)) return jsonResponse({ ok: false, code: "SOCIAL_DISCONNECT_RECONCILIATION_REQUIRED" }, 500);
      const rail0 = await record("social_connection_disconnect", result.confirmationId, "capability_succeeded", {
        connection_id: connectionId, state: "disconnected", provided_by_platform: true, budget: "no_paid_action",
      });
      return jsonResponse({ ok: true, state: "disconnected", receipt_recorded: rail0 });
    }
    try {
      await adapter.deleteProfile({ providerProfileKey: connection.provider_profile_key });
    } catch (error) {
      if (!(error instanceof SocialProviderError && error.code === "provider_profile_not_found")) {
        await record("social_connection_disconnect", result.confirmationId, "capability_failed", {
          connection_id: connectionId, failure_code: errorCode(error), budget: "no_paid_action",
        });
        return jsonResponse({ ok: false, code: "SOCIAL_DISCONNECT_UNCONFIRMED" }, 502);
      }
    }
    const written = await admin.rpc("social_mark_connection_disconnected", {
      _tenant_id: tenantId, _connection_id: connectionId, _actor_id: user.id,
      _confirmation_id: result.confirmationId, _disconnected_at: new Date().toISOString(),
    });
    if (written.error || !object(written.data)) {
      await record("social_connection_disconnect", result.confirmationId, "capability_completed_unrecorded", {
        connection_id: connectionId, state: "provider_revoked_local_state_unknown", budget: "no_paid_action",
      });
      return jsonResponse({ ok: false, code: "SOCIAL_DISCONNECT_RECONCILIATION_REQUIRED" }, 500);
    }
    const railRecorded = await record("social_connection_disconnect", result.confirmationId, "capability_succeeded", {
      connection_id: connectionId, state: "disconnected", budget: "no_paid_action",
    });
    return jsonResponse({ ok: true, state: "disconnected", receipt_recorded: railRecorded });
  }

  return jsonResponse({ ok: false, code: "SOCIAL_ACTION_UNKNOWN" }, 400);
});
