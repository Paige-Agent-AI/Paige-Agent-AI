// call-zapier-action — per-tenant Zapier/MCP action caller (Wave 1 #240, Track B slice B2).
//
// Calls a Zapier MCP action (Streamable HTTP MCP JSON-RPC tools/call) using the
// CALLER'S OWN tenant credentials — the per-tenant replacement for the shared
// ZAPIER_MCP_TOKEN env var + platform-global paige_mcp_connections row.
//
// Body (two shapes):
//   { tool_name: string, arguments?: object }  → run one action (MCP tools/call)
//   { action: "list" }                         → discover enabled actions (MCP tools/list)
//   (legacy `connection_id` is accepted-but-ignored — see §37 note below.)
//   The `action` field is ADDITIVE (§37): existing {tool_name} callers are unaffected.
//
// Security (§9 tenant isolation):
//  • The caller's JWT authenticates them; admin-gated (has_role admin).
//  • The tenant is derived SERVER-SIDE from the JWT (current_user_tenant_id, run in
//    the caller's JWT context) — a client-supplied tenant_id is NEVER trusted for the
//    secret read. Mirrors the proven paige-n8n pattern.
//  • The MCP server URL + bearer token are decrypted server-side ONLY, via the
//    service-role-only get_tenant_mcp_secret RPC. They never touch the browser and
//    are read only for the caller's OWN resolved tenant, never an arbitrary one.
//  • The tenant-supplied MCP server_url is SSRF-guarded via the shared client: https
//    only, no credentials embedded in the URL, numeric validation of every resolved
//    address, redirects refused rather than followed, and a bounded wall clock and
//    response size — so a tenant admin can't point it at an internal target, DNS-rebind
//    onto one, or hold a worker open (§13).
//  • If the tenant has no configured/enabled connection → an honest structured
//    "not_connected" response (§13); NEVER a fallback to the shared env token.
//
// THE EGRESS BOUNDARY. This function's response is serialised into a model's context by
// `paige-ai-chat`. A provider's answer is therefore UNTRUSTED INPUT reaching Paige: it can
// carry instructions aimed at her, credentials, or another tenant's records. So no
// provider payload, prose, schema or error text is returned from here. What is returned is
// the outcome projection from `_shared/mcp-outcome.ts` — which capability ran, whether it
// worked, when, whether it was authorised, and an opaque reference under which the detail
// is held encrypted and tenant-scoped.
//
// AND IT FAILS CLOSED. A capability the workspace has not approved is not called at all.
// A connection proves reachability; `approved_capabilities` is the separate authorisation
// decision, and it is empty until somebody makes it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { mcpListTools, authFromSecret } from "../_shared/mcp-client.ts";
import { callApprovedCapability, fileGovernedOutcome, projectDiscovery } from "../_shared/mcp-outcome.ts";
import { discoverAuthorizationServer, discoverProtectedResource, isExpired, refreshTokens } from "../_shared/mcp-oauth.ts";

// The SSRF validator that used to live inline here is now `_shared/ssrfGuard.ts`, reached
// through `_shared/mcp-client.ts`. It is the same numeric guard, plus the three things
// every inline copy was missing: credentials in the URL are rejected, the wall clock is
// bounded, and the response body is bounded. Redirects were already refused and still are.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1. Authenticate the caller and resolve their tenant from the JWT.
  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return jsonResponse({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  // Two request shapes (§37 — additive, existing `{tool_name, arguments}` callers unchanged):
  //  • { action: "list" }                 → MCP tools/list (discover the tenant's enabled actions)
  //  • { tool_name, arguments? }           → MCP tools/call (run one action) — the original contract
  const isList = body?.action === "list";
  if (!isList && !body?.tool_name) return jsonResponse({ error: "missing_tool_name" }, 400);

  // current_user_tenant_id runs in the caller's JWT context → their own tenant.
  // NEVER trust a client-supplied tenant_id for the secret read (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || !tenantId) return jsonResponse({ error: "no_tenant" }, 400);
  const fileConnectionTest = async (succeeded: boolean) => {
    if (!isList) return true;
    const { error } = await admin.rpc("record_zapier_mcp_connection_test", {
      _tenant_id: tenantId,
      _actor_id: user.id,
      _succeeded: succeeded,
    });
    if (error) {
      console.error("[call-zapier-action] connection test outcome not recorded:", error.message);
      return false;
    }
    return true;
  };

  // 2. Pull the tenant's decrypted MCP creds (service-role-only RPC), scoped to the
  //    caller's OWN resolved tenant. Honest degrade if not configured/enabled (§13) —
  //    never a fallback to the shared ZAPIER_MCP_TOKEN env.
  // The registry is provider-scoped: one tenant may hold an n8n MCP connection AND a
  // Zapier one, so the provider must be named. This function is the Zapier caller.
  const { data: secret, error: sErr } = await admin.rpc("get_tenant_mcp_secret", {
    _tenant_id: tenantId,
    _provider: "zapier",
  });
  if (sErr) { await fileConnectionTest(false); return jsonResponse({ error: "secret_lookup_failed" }, 500); }
  if (!secret?.configured) {
    await fileConnectionTest(false);
    return jsonResponse({ ok: false, error: "not_connected", detail: "This workspace hasn't connected a Zapier/MCP account yet. Connect one in Settings → Integrations → Zapier." });
  }
  if (secret.enabled === false) {
    await fileConnectionTest(false);
    return jsonResponse({ ok: false, error: "connection_disabled", detail: "This workspace's Zapier/MCP connection is turned off. Re-enable it in Settings → Integrations → Zapier." });
  }
  const serverUrl: string = secret.server_url;

  // An access token that has lapsed is refreshed here rather than surfacing as a failed
  // action. Rotation is stored immediately: a server that issues a new refresh token has
  // killed the old one, so keeping the old one would work now and break at the next
  // refresh with nothing to point at.
  if (secret.auth_kind === "oauth" && isExpired(secret.expires_at) && secret.refresh_token && secret.oauth_issuer) {
    try {
      const server = await discoverAuthorizationServer(String(secret.oauth_issuer));
      // RFC 8707: the resource indicator has to be the one the SERVER advertises, and the
      // grant was obtained with that value. Substituting the endpoint URL happens to be
      // the same string for Zapier today and is not the same thing — an authorization
      // server that advertises a different resource identifier would refuse the refresh,
      // and the connection would look like it had expired rather than like it had been
      // asked the wrong question. Re-read rather than stored so it cannot go stale, and
      // the endpoint is the fallback because that is what the grant used before this.
      let resource = serverUrl;
      try { resource = (await discoverProtectedResource(serverUrl)).resource; } catch { /* keep the endpoint */ }
      const rotated = await refreshTokens({
        server,
        clientId: String(secret.oauth_client_id ?? ""),
        clientSecret: secret.oauth_client_secret ? String(secret.oauth_client_secret) : null,
        refreshToken: String(secret.refresh_token),
        resource,
      });
      const { error: rErr } = await admin.rpc("rotate_tenant_mcp_tokens", {
        _tenant_id: tenantId,
        _provider: "zapier",
        _access_token: rotated.accessToken,
        _refresh_token: rotated.refreshToken,
        _expires_at: rotated.expiresAt,
      });
      // FAIL CLOSED when the rotation cannot be stored. The provider has already
      // invalidated the old refresh token by issuing this one, so a database that still
      // holds the old one can never refresh again: this single request would succeed and
      // the connection would be permanently unable to renew, discovered days later as an
      // expiry nobody can explain. Logging and carrying on trades one visible failure now
      // for an invisible, unrecoverable one later.
      //
      // Nothing has been spent at this point — the capability has not run — so refusing
      // costs one action and keeps the connection repairable by reconnecting.
      if (rErr) {
        console.error("[call-zapier-action] token rotation not stored:", rErr.message);
        return jsonResponse({
          ok: false,
          error: "reauthorization_required",
          detail: "This workspace's Zapier authorization could not be renewed. Reconnect it in Settings → Integrations → Zapier.",
        });
      }
      // Written back onto `secret`, which is the ONE thing the auth is derived from.
      // A local copy alongside it is what broke this: the rotation updated the copy and
      // `authFromSecret(secret)` kept reading the expired field, so the first call after
      // every expiry went out with the dead token and failed even though the refresh and
      // the database write had both succeeded. Two representations of one fact is the same
      // defect as the guard-and-mapping split this function was just consolidated to
      // remove; the fix is the same one -- keep a single representation.
      secret.auth_token = rotated.accessToken;
      secret.expires_at = rotated.expiresAt;
    } catch {
      // A grant that can no longer be refreshed has been withdrawn or has expired. Saying
      // so is the honest answer; retrying with the dead token would fail less clearly.
      return jsonResponse({ ok: false, error: "reauthorization_required", detail: "This workspace's Zapier authorization has expired. Reconnect it in Settings → Integrations → Zapier." });
    }
  }
  // A 'url' connection has no separate token by design -- Zapier's per-user MCP server
  // carries its secret in the address. Requiring a token here would report a correctly
  // saved connection as missing one, which is the failure that looks exactly like "not
  // connected" and sends the operator to re-enter something that was never absent.
  // One call for both the verdict and the auth shape, shared with the connect function so
  // the two cannot drift apart again.
  const auth = authFromSecret(secret);
  if (!auth) {
    return jsonResponse({ ok: false, error: "not_connected", detail: "The Zapier connection is missing its server URL. Reconnect it in Settings → Integrations → Zapier." });
  }

  // 3. Discovery, reduced to the workspace's OWN approved names. The provider's
  //    catalogue and its descriptions are provider-written text and do not cross.

  const approved: string[] = Array.isArray(secret.approved_capabilities)
    ? (secret.approved_capabilities as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  // Missing or malformed pins resolve to an empty map, which refuses everything. That is
  // the correct reading: no pin means no verified contract.
  const pins: Record<string, string> =
    secret.capability_pins && typeof secret.capability_pins === "object" && !Array.isArray(secret.capability_pins)
      ? Object.fromEntries(Object.entries(secret.capability_pins as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")) as Record<string, string>
      : {};

  if (isList) {
    let discovered: Array<{ name: string }> = [];
    try {
      discovered = await mcpListTools({ serverUrl, auth });
    } catch {
      // The provider's failure reason is not carried; an empty, honest answer is.
      await fileConnectionTest(false);
      return jsonResponse({ ok: false, error: "discovery_unavailable", actions: [], approved_count: 0 });
    }
    const projected = projectDiscovery(discovered, approved);
    if (!await fileConnectionTest(true)) {
      return jsonResponse({ ok: false, error: "rail_unavailable", actions: [], approved_count: 0 }, 500);
    }
    return jsonResponse({
      ok: true,
      // `actions` is kept as the key so the existing consumer keeps working, but it now
      // carries approved NAMES only — never the provider's descriptions (§37: the
      // consumer's access path is preserved, the unsafe payload is not).
      actions: projected.approved,
      approved_count: projected.approved.length,
      // Stated rather than hidden, so "no actions" is distinguishable from "none approved".
      unapproved_count: projected.unapproved_count,
      // The unapproved NAMES (identifier-shaped, validated in the projection) so the
      // operator can be told exactly which actions are waiting on their approval — the
      // 2026-10-02 gap was a count the operator could not act on.
      unapproved: projected.unapproved,
    });
  }

  // 4. One governed call. Authorisation is checked before anything leaves the process,
  //    and only the projection comes back.
  const { outcome, evidence } = await callApprovedCapability({
    serverUrl,
    auth,
    provider: "zapier",
    capability: String(body.tool_name),
    approvedCapabilities: approved,
    capabilityPins: pins,
    tenantId,
    args: (body.arguments ?? {}) as Record<string, unknown>,
  });

  // The detail is written where a model cannot read it. A failure to store evidence must
  // not turn a completed action into a reported failure, so it is recorded and moved past.
  if (evidence) {
    const { error: eErr } = await admin.rpc("record_tenant_mcp_evidence", {
      _tenant_id: tenantId,
      _provider: evidence.provider,
      _capability: evidence.capability,
      _status: outcome.status,
      _payload: evidence.payload,
      _ref: evidence.ref,
    });
    if (eErr) console.error("[call-zapier-action] evidence not recorded:", eErr.message);
  }

  // 5. Provenance. Every call — including every refusal — leaves a record the workspace
  //    can read, carrying what happened and never what the provider said. The rail entry
  //    is contact-scoped by construction, so it is written only when this turn genuinely
  //    has a contact; `contact_id` is taken from the caller's request rather than invented.
  const contactId = typeof body.contact_id === "string" && body.contact_id ? body.contact_id : null;
  await fileGovernedOutcome(admin, { tenantId, outcome, contactId, actorId: user.id });

  return jsonResponse({ ok: outcome.status === "ok", ...outcome });
});
