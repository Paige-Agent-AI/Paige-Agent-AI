// tenant-mcp-connect — connect, verify and disconnect a workspace's own MCP server.
// REDEPLOY NOTE (2026-08-31): a deploy that said it succeeded and did not.
//
// The edge-function pipeline ran for the commit that added `tools/list` pagination to
// `_shared/mcp-client.ts`, resolved this function as affected (correctly -- it imports that
// file), bundled it, and printed "deployed tenant-mcp-connect". The platform record stayed
// at version 1 with its original timestamp, and the deployed source still had the old
// single-page reader, while `call-zapier-action` -- bundled from the SAME shared file eight
// seconds earlier in the SAME run -- advanced to version 45 with the new code.
//
// So a green deploy log is not evidence a function is live. The check that caught it was
// comparing the function's stored `version`/`updated_at` against the run that claimed to
// deploy it; the source read alone looked like a cache artefact and would have been
// dismissed. Anything that matters should be verified against the stored record, not the
// CLI's own report -- the schema twin of "it compiled, therefore it runs".

//
// WHY THIS IS AN EDGE FUNCTION AND NOT AN RPC. Saving a connection is a database write
// and lives in `set_tenant_n8n_mcp_connection`, which is where its authority belongs.
// But a saved connection is only a claim: the address may be unreachable, the credential
// wrong, the endpoint not an MCP server at all. Proving it needs an outbound request,
// which Postgres cannot make. So the setter writes `pending_verification`, and this
// function — the only holder of the service-role probe writer — is the only thing that
// can move a row to `connected`. A workspace never sees a green state it has not earned.
//
// AUTHORITY (§9/§59). The caller's JWT authenticates them and their tenant is resolved
// SERVER-SIDE from that JWT; a tenant id in the request body is never trusted. Writes go
// through the user's own client so the RPC's in-body tenant-admin check is what gates
// them — the service-role client is used only to read the decrypted secret for the
// already-resolved tenant and to write the probe result.
//
// SECRET DISCIPLINE. The server URL and credential are decrypted server-side, held for
// the duration of one probe, and dropped. Nothing in any response contains them, and no
// provider error text is returned raw: failures come back as a stable code, which the
// browser renders in the product's own words.
//
// SSRF (§13). Every outbound request runs through `_shared/mcp-client.ts` → `safeFetch`:
// https only, no embedded credentials, public addresses only, redirects refused rather
// than followed, bounded wall clock, bounded response size, fail-closed on every branch.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { mcpListToolFingerprints, mcpProbe, type McpAuth, authFromSecret } from "../_shared/mcp-client.ts";
import {
  buildAuthorizationUrl, createPkce, createState, discoverAuthorizationServer,
  discoverProtectedResource, exchangeCode, OAuthError, registerClient,
  statesMatch, type AuthorizationServer,
} from "../_shared/mcp-oauth.ts";
import { verifyApprovalPins } from "../_shared/mcp-outcome.ts";
import { isZapierMcpAddress, ZAPIER_MCP_URL } from "../_shared/zapier-mcp-address.ts";
import {
  resolveZapierMcpConnection, revokeZapierMcpSecret, savedZapierMcpGrantMatches, zapierMcpReadAuthorized,
  type McpRpcClient,
} from "../_shared/zapier-mcp-auth.ts";

/** Providers that connect by a tenant-supplied credential. */
const CONNECTABLE = new Set(["n8n"]);
/** Providers that connect by an authorization grant. No credential is ever pasted. */
const OAUTH_PROVIDERS = new Set(["zapier"]);

const PUBLIC_BASE = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai").replace(/\/$/, "");
/**
 * One fixed redirect, registered with the provider and compared by it on every exchange.
 * It is derived from configuration rather than from the request, because a redirect the
 * caller can influence is an open redirect and an authorization-code interception at once.
 */
const REDIRECT_URI = `${PUBLIC_BASE}/oauth/mcp/callback`;

type ProbeOutcome = { status: "connected"; toolCount: number } | { status: "error"; code: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!CONNECTABLE.has(provider) && !OAUTH_PROVIDERS.has(provider)) {
    return jsonResponse({ error: "unsupported_provider" }, 400);
  }

  // The tenant comes from the caller's own JWT context, never from the body (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || !tenantId) return jsonResponse({ error: "no_tenant" }, 400);

  // WHICH WORKSPACE THE PERSON THOUGHT THEY WERE ACTING ON.
  //
  // `current_user_tenant_id()` reads `profiles.active_tenant_id`, which a workspace switch
  // has already written by the time this resolves. So an admin who starts a connect, a
  // disconnect or an approval and switches workspaces before the request lands has the
  // whole mutation rebound to the NEW workspace: A's credential stored in B, B's grant
  // revoked, A's approval selection applied to B. Nothing about that is visible; both
  // workspaces are theirs and the request succeeds.
  //
  // This value is NOT authority and grants nothing — the server still resolves the tenant
  // itself and every check below uses the resolved one. It is an EXPECTATION, and its only
  // power is to refuse: if the caller meant a different workspace than the one the server
  // now resolves, nothing happens at all. Omitting it keeps the old behaviour, so this
  // cannot break a caller that has not been taught to send it.
  const expected = typeof body.expected_tenant_id === "string" ? body.expected_tenant_id : null;
  if (expected && expected !== tenantId) {
    return jsonResponse({ error: "tenant_changed" }, 409);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  // Preserve n8n OAuth from the legacy bearer/admin mutation seam.
  if (provider === "n8n") {
    const { data: readiness, error } = await userClient.rpc("get_n8n_connection_readiness");
    if (error) return jsonResponse({ error: "forbidden" }, 403);
    if (readiness?.mcp?.auth_kind === "oauth") return jsonResponse({ error: "use_n8n_oauth_owner_flow" }, 409);
  }


  if (action === "disconnect") {
    // Authority BEFORE the irreversible part. Revoking at the provider cannot be undone,
    // and it used to happen before the RPC's admin check — so any member of the workspace
    // could destroy the grant, get a 403 for their trouble, and leave the row still
    // reading as connected. "The RPC checks it" is only true for the RPC; it says nothing
    // about the service-role work done on the way there.
    const { data: canDisconnect } = await userClient.rpc("is_current_user_tenant_admin");
    if (canDisconnect !== true) return jsonResponse({ error: "forbidden" }, 403);

    let revoked: boolean | null = null;
    if (provider === "zapier") {
      const { data: secret, error: readError } = await admin.rpc("get_tenant_mcp_secret", {
        _tenant_id: tenantId, _provider: provider,
      });
      if (readError) return jsonResponse({ error: "secret_lookup_failed" }, 500);
      // Keep this exact grant in memory while the original native writer detaches it.
      // A stale disconnect cannot clear or revoke a grant saved by a newer reconnect.
      const { data: cleared, error } = await userClient.rpc("disconnect_tenant_zapier_mcp", {
        _tenant: tenantId, _actor: user.id, _generation: secret?.generation ?? null,
      });
      if (error || cleared !== true) return jsonResponse({ error: "connection_changed" }, 409);
      revoked = secret?.configured ? await revokeZapierMcpSecret(secret) : null;
      return jsonResponse({ ok: true, status: "unconfigured", revoked_at_provider: revoked });
    }

    // Authority lives in the RPC too: it raises unless the caller is an admin of this
    // tenant. Kept as well as the check above — this is the boundary that actually holds
    // for every other caller of the RPC.
    const { error } = await userClient.rpc("clear_tenant_mcp_connection", { _provider: provider, _tenant_id: tenantId });
    if (error) {
      const code = writeCode(error.message);
      return jsonResponse({ error: "write_failed", code }, code === "MCP_FORBIDDEN" ? 403 : 400);
    }
    // The local row is always cleared: a workspace must be able to disconnect even when
    // the provider is unreachable. Whether the grant was withdrawn is reported, not assumed.
    return jsonResponse({ ok: true, status: "unconfigured", revoked_at_provider: revoked });
  }

  if (action === "connect") {
    // `CONNECTABLE` is the set of providers a workspace connects by PASTING an address and
    // a token. Zapier is not one of them — it is granted through OAuth — and this check is
    // what makes that true at the seam rather than only in the UI. Without it, `connect`
    // with `provider: "zapier"` fell through to the n8n setter below and overwrote the
    // workspace's n8n row with whatever the caller sent, from a surface that never offers
    // that combination and therefore never gets tested with it.
    if (!CONNECTABLE.has(provider)) {
      return jsonResponse({ error: "not_directly_connectable", provider }, 400);
    }
    const serverUrl = typeof body.server_url === "string" ? body.server_url.trim() : "";
    const authToken = typeof body.auth_token === "string" ? body.auth_token : "";
    const transport = typeof body.transport === "string" ? body.transport : "http";
    const authKind = typeof body.auth_kind === "string" ? body.auth_kind : "bearer";
    const headerName = typeof body.header_name === "string" ? body.header_name.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";

    // authority-note: this branch has no separate admin check because the FIRST thing it
    // does is the admin-gated setter, running as the user so the RPC's own tenant-admin
    // check applies. `probeAndRecord` below is reached only after that write succeeded, so
    // nothing service-role and nothing outbound happens for a caller who lacks authority.
    //
    // The setter validates shape and enforces tenant-admin in its own body, and writes
    // `pending_verification`. Running it as the USER is what makes that check apply.
    //
    const { error } = await userClient.rpc("set_tenant_n8n_mcp_connection", {
      _server_url: serverUrl,
      _auth_token: authToken,
      _transport: transport,
      _auth_kind: authKind,
      _header_name: headerName || undefined,
      _label: label || undefined,
    });
    if (error) {
      const code = writeCode(error.message);
      return jsonResponse({ error: "write_failed", code }, code === "MCP_FORBIDDEN" ? 403 : 400);
    }
    return jsonResponse({ ok: true, ...(await probeAndRecord(admin, userClient, tenantId, provider, user.id)) });
  }

  if (action === "verify") {
    // No write happens here, so the admin check the setter would have applied has to be
    // made explicitly rather than assumed.
    const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
    if (isAdmin !== true) return jsonResponse({ error: "forbidden" }, 403);
    return jsonResponse({ ok: true, ...(await probeAndRecord(admin, userClient, tenantId, provider, user.id)) });
  }

  // ── Discovery and approval ──────────────────────────────────────────────────
  // Connecting a provider is reachability. Approving a capability is authority. They are
  // separate acts on purpose, and this is the second one.

  if (action === "discover") {
    const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
    if (isAdmin !== true) return jsonResponse({ error: "forbidden" }, 403);
    const resolved = await resolveConnection(admin, userClient, tenantId, provider, user.id);
    if ("error" in resolved) return jsonResponse(resolved.error, resolved.status);
    try {
      const tools = await mcpListToolFingerprints({ serverUrl: resolved.serverUrl, auth: resolved.auth });
      if (provider === "zapier" && !await zapierMcpReadAuthorized(userClient, tenantId, user.id, resolved.generation!)) {
        return jsonResponse({ error: "connection_changed" }, 409);
      }
      const approved = new Set(resolved.approved);
      return jsonResponse({
        ok: true,
        // For a HUMAN choosing what to approve. The description is provider-written text
        // and is bounded here; it is deliberately NOT carried on the path that reaches a
        // model, where provider prose is an instruction surface (_shared/mcp-outcome.ts).
        // The fingerprint travels so approval can pin the exact contract being approved
        // — a hash discloses nothing, and re-deriving it later would pin a different
        // moment than the one the person actually looked at.
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          pin: t.pin,
          // Deprecated alias, same VALUE as `pin`. A browser bundle deployed before this
          // change reads this key, and the frontend and this function do not deploy
          // atomically. Remove one release after this ships.
          schema_hash: t.pin,
          approved: approved.has(t.name),
          connected_app: t.app,
          action_type: t.actionType,
          effects: t.effects,
          authority: "ask_first",
        })),
      });
    } catch (e) {
      return jsonResponse({ error: "discovery_failed", code: e instanceof Error ? (e as { code?: string }).code ?? "unknown" : "unknown" }, 502);
    }
  }

  if (action === "approve") {
    // Names and their pins arrive together, from one discovery the person just looked at.
    const requested = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : null;
    if (!requested) return jsonResponse({ error: "missing_capabilities" }, 400);
    const pins = body.pins && typeof body.pins === "object" && !Array.isArray(body.pins)
      ? body.pins as Record<string, unknown>
      : {};

    // Authority BEFORE the workspace's credential is decrypted and before a single
    // request leaves for the provider. Without this, any member could make the platform
    // spend the tenant's credential on provider traffic, and could enumerate capability
    // names by the difference in what came back: a name that exists reaches the RPC and
    // returns 403, a name that does not returns `capabilities_changed` naming it. Two
    // different answers to the same unauthorised question is an oracle.
    const { data: canApprove } = await userClient.rpc("is_current_user_tenant_admin");
    if (canApprove !== true) return jsonResponse({ error: "forbidden" }, 403);

    // A pin from the browser is not trusted: it is re-derived from the provider here, so
    // approving cannot be used to pin a contract the provider never offered. The client's
    // pins are used only to detect that the provider changed BETWEEN the person looking
    // and the person approving — in which case nothing is approved and they look again.
    const resolved = await resolveConnection(admin, userClient, tenantId, provider, user.id);
    if ("error" in resolved) return jsonResponse(resolved.error, resolved.status);
    let live;
    try {
      live = await mcpListToolFingerprints({ serverUrl: resolved.serverUrl, auth: resolved.auth });
    } catch {
      return jsonResponse({ error: "discovery_failed" }, 502);
    }
    const liveByName = new Map(live.map((t) => [t.name, t.pin]));

    const { verified, stale } = verifyApprovalPins(requested, liveByName, pins);

    if (stale.length) {
      // Approving a moved target is worse than approving nothing: it records consent to
      // something nobody read.
      return jsonResponse({ error: "capabilities_changed", changed: stale.slice(0, 50) }, 409);
    }

    const { data, error } = provider === "zapier" ? await userClient.rpc("set_tenant_zapier_mcp_approval", {
      _tenant: tenantId, _actor: user.id, _generation: resolved.generation,
      _capabilities: Object.keys(verified), _pins: verified,
    }) : await userClient.rpc("set_tenant_mcp_approved_capabilities", {
      _provider: provider,
      _tenant_id: tenantId,
      _capabilities: Object.keys(verified),
      _pins: verified,
    });
    if (error) {
      const code = writeCode(error.message);
      return jsonResponse({ error: "write_failed", code }, code === "MCP_FORBIDDEN" ? 403 : 400);
    }
    return jsonResponse({ ok: true, ...(data as Record<string, unknown>) });
  }

  // ── OAuth ───────────────────────────────────────────────────────────────────
  // Two halves, and nothing secret crosses the browser in either. The first returns a
  // consent URL; the second takes back only the code and the state the provider echoed.

  if (action === "oauth_begin") {
    if (!OAUTH_PROVIDERS.has(provider)) return jsonResponse({ error: "unsupported_provider" }, 400);
    const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
    if (isAdmin !== true) return jsonResponse({ error: "forbidden" }, 403);
    try {
      const serverUrl = body.server_url === undefined ? ZAPIER_MCP_URL
        : typeof body.server_url === "string" ? body.server_url.trim() : "";
      if (!isZapierMcpAddress(serverUrl)) return jsonResponse({ error: "address_rejected" }, 400);
      const { server, resource, scopes } = await resolveZapierAuthority(serverUrl);
      const registration = await registerClient({
        server, redirectUri: REDIRECT_URI, clientName: "Paige",
      });
      const pkce = await createPkce();
      const state = createState();

      // The verifier is stored before the browser is sent anywhere. Storing it after the
      // redirect would leave a consent that can complete against nothing.
      const { error } = await admin.rpc("begin_tenant_zapier_mcp_oauth", {
        _tenant: tenantId,
        _state: state,
        _verifier: pkce.verifier,
        _redirect_uri: REDIRECT_URI,
        _issuer: server.issuer,
        _resource: resource,
        _client_id: registration.clientId,
        _client_secret: registration.clientSecret,
        _actor: user.id,
        _requested_scopes: scopes,
      });
      if (error) return jsonResponse({ error: "oauth_begin_failed" }, 500);

      return jsonResponse({
        ok: true,
        // The only thing the browser receives: where to send the person. It carries the
        // challenge, never the verifier.
        authorize_url: buildAuthorizationUrl({
          server, clientId: registration.clientId, redirectUri: REDIRECT_URI,
          state, challenge: pkce.challenge, scopes, resource,
        }),
      });
    } catch (e) {
      return jsonResponse({ error: "oauth_begin_failed", code: e instanceof OAuthError ? e.code : "discovery_failed" }, 502);
    }
  }

  if (action === "oauth_complete") {
    const code = typeof body.code === "string" ? body.code : "";
    const returnedState = typeof body.state === "string" ? body.state : "";
    if (!code || !returnedState) return jsonResponse({ error: "oauth_bad_callback" }, 400);

    // The same provider check `oauth_begin` makes, and for a sharper reason. Without it a
    // callback naming `n8n` was accepted, spent the single-use state, wrote the ZAPIER row
    // (the setter names that provider itself), and then probed and updated the N8N row
    // from the request's provider — one action mutating two providers' rows, neither of
    // them the one the caller named. Checked before the state is consumed, so a request
    // that will be refused cannot destroy a flow someone else legitimately started.
    if (!OAUTH_PROVIDERS.has(provider)) return jsonResponse({ error: "unsupported_provider" }, 400);

    // Completing a grant is the act that gives Paige a credential for this workspace, so
    // it needs the same authority as starting one. `oauth_begin` is admin-gated and this
    // was not, which left the second half of an admin-only flow open to any member who
    // ended up holding the callback.
    //
    // The native consumer also binds the initiating actor BEFORE spending the state.
    const { data: canComplete } = await userClient.rpc("is_current_user_tenant_admin");
    if (canComplete !== true) return jsonResponse({ error: "forbidden" }, 403);

    // Redeemed exactly once, in SQL. A replayed callback finds nothing.
    const { data: pending, error: sErr } = await admin.rpc("consume_tenant_zapier_mcp_oauth", {
      _tenant: tenantId, _actor: user.id, _state: returnedState,
    });
    if (sErr || pending?.found !== true) return jsonResponse({ error: "oauth_state_invalid" }, 400);

    // The stored state is compared in constant time against the one the provider echoed.
    // The lookup was keyed on it, so this cannot fail on a well-formed request — but a
    // lookup and a comparison are different guarantees, and writing only the lookup is
    // how a later change to how flows are found silently removes the check.
    if (typeof pending.state !== "string" || !statesMatch(returnedState, pending.state)) {
      return jsonResponse({ error: "oauth_state_invalid" }, 400);
    }

    // The tenant comes from the STORED flow, never from the caller. Whoever completes the
    // callback cannot redirect a grant into a workspace that did not start it.
    const flowTenant = String(pending.tenant_id);
    if (flowTenant !== tenantId || pending.provider !== provider) return jsonResponse({ error: "oauth_state_invalid" }, 400);

    try {
      const server = await discoverAuthorizationServer(String(pending.issuer));
      const tokens = await exchangeCode({
        server,
        clientId: String(pending.client_id),
        clientSecret: pending.client_secret ? String(pending.client_secret) : null,
        redirectUri: String(pending.redirect_uri),
        code,
        verifier: String(pending.code_verifier),
        resource: String(pending.resource),
        requestedScopes: Array.isArray(pending.requested_scopes) ? pending.requested_scopes : undefined,
      });

      const { data: completed, error } = await admin.rpc("complete_tenant_zapier_mcp_oauth", {
        _tenant: flowTenant,
        _state: returnedState,
        _access_token: tokens.accessToken,
        _refresh_token: tokens.refreshToken,
        _expires_at: tokens.expiresAt,
        _scopes: tokens.scopes,
        _actor: user.id,
      });
      let completedGeneration = typeof completed?.generation === "string" ? completed.generation : null;
      if (error) {
        // A lost response can follow a committed grant. Reconcile once, without
        // exchanging the code again or revoking a possibly healthy saved connection.
        const readback = await admin.rpc("get_tenant_mcp_secret", { _tenant_id: flowTenant, _provider: provider });
        if (readback.error || !savedZapierMcpGrantMatches(readback.data, tokens, {
          clientId: String(pending.client_id), issuer: server.issuer, resource: String(pending.resource),
        })) return jsonResponse({ error: "oauth_store_unconfirmed" }, 409);
        completedGeneration = readback.data.generation;
      }
      if (!completedGeneration) return jsonResponse({ error: "oauth_store_unconfirmed" }, 409);

      // A granted token is still not a working connection until the probe says so.
      return jsonResponse({ ok: true, ...(await probeAndRecord(admin, userClient, flowTenant, provider, user.id, completedGeneration)) });
    } catch (e) {
      return jsonResponse({ error: "oauth_exchange_failed", code: e instanceof OAuthError ? e.code : "token_exchange_failed" }, 502);
    }
  }

  return jsonResponse({ error: "unknown_action" }, 400);
});

/**
 * Zapier's authority, discovered from Zapier. Nothing about the flow is hardcoded beyond
 * the MCP endpoint itself, so a change on their side is followed rather than broken.
 *
 * THE HOST IS THE SECURITY BOUNDARY. It is what stops this becoming an SSRF into an
 * arbitrary address, and it does not move. The path and query are shape checks, and the
 * shape moved underneath us:
 *
 *   /api/v1/connect          current, OAuth -- what mcp.zapier.com hands out today
 *   /api/mcp/s/<secret>/mcp  legacy, token in the path -- still valid for older servers
 *
 * Accepting only the legacy prefix rejected the address Zapier actually issues, so the
 * connection could not be started at all. A query string is allowed for the same reason:
 * the copy-to-clipboard address carries one, and nothing downstream is harmed by it --
 * discoverProtectedResource builds the well-known URL from origin + pathname only, and
 * the RFC 8707 resource indicator is read from Zapier's own metadata, never from this
 * string. A FRAGMENT is still refused: it is never sent to a server, so its presence
 * means the address was copied out of a browser bar rather than off the Connect tab.
 */
async function resolveZapierAuthority(serverUrl: string): Promise<{ server: AuthorizationServer; resource: string; scopes: string[] }> {
  const pr = await discoverProtectedResource(serverUrl, { requestChallenge: true });
  // The first advertised authorization server. Its metadata still has to name itself as
  // the issuer, so accepting the advertisement is not the same as trusting it.
  const server = await discoverAuthorizationServer(pr.authorizationServers[0]);
  return { server, resource: pr.resource, scopes: pr.challengeScopes ?? pr.scopesSupported };
}

/**
 * The tenant's own connection, decrypted and ready to call. One place, so the auth shape
 * and the not-configured answers cannot drift between the paths that need them.
 */
async function resolveConnection(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userClient: McpRpcClient,
  tenantId: string,
  provider: string,
  actorId: string,
): Promise<
  | { serverUrl: string; auth: McpAuth; approved: string[]; generation?: string }
  | { error: Record<string, unknown>; status: number }
> {
  if (provider === "zapier") {
    const resolved = await resolveZapierMcpConnection(admin, tenantId, actorId);
    if ("error" in resolved) return { error: { ok: false, error: resolved.error }, status: resolved.status };
    if (!await zapierMcpReadAuthorized(userClient, tenantId, actorId, resolved.secret.generation)) {
      return { error: { error: "connection_changed" }, status: 409 };
    }
    return { serverUrl: resolved.secret.server_url, auth: resolved.auth,
      approved: Array.isArray(resolved.secret.approved_capabilities)
        ? resolved.secret.approved_capabilities.filter((v): v is string => typeof v === "string") : [],
      generation: resolved.secret.generation };
  }
  const { data: secret, error } = await admin.rpc("get_tenant_mcp_secret", {
    _tenant_id: tenantId,
    _provider: provider,
  });
  if (error) return { error: { error: "secret_lookup_failed" }, status: 500 };
  if (!secret?.configured) return { error: { ok: false, error: "not_connected" }, status: 200 };
  if (secret.enabled === false) return { error: { ok: false, error: "connection_disabled" }, status: 200 };
  // One call answers both "can this be used?" and "how". They used to be separate here,
  // and separate again in probeAndRecord, and they drifted.
  const auth = authFromSecret(secret);
  if (!auth) return { error: { ok: false, error: "not_connected" }, status: 200 };
  return {
    serverUrl: secret.server_url,
    auth,
    approved: Array.isArray(secret.approved_capabilities)
      ? (secret.approved_capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
  };
}

/**
 * Reads the tenant's own decrypted connection, proves it, and records the outcome.
 *
 * A failed probe is recorded as `error` and reported as one. It is never reported as
 * "not connected", because a workspace that has saved a connection and a workspace that
 * has none are different situations and must not look the same (§13).
 */
async function probeAndRecord(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userClient: McpRpcClient,
  tenantId: string,
  provider: string,
  actorId: string,
  expectedGeneration?: string,
): Promise<ProbeOutcome> {
  if (provider === "zapier") {
    const resolved = await resolveConnection(admin, userClient, tenantId, provider, actorId);
    if ("error" in resolved) return { status: "error", code: String(resolved.error.error ?? "connection_changed") };
    if (expectedGeneration && resolved.generation !== expectedGeneration) return { status: "error", code: "connection_changed" };
    const result = await mcpProbe({ serverUrl: resolved.serverUrl, auth: resolved.auth });
    const { data, error } = await admin.rpc("record_tenant_zapier_mcp_probe", {
      _tenant: tenantId, _actor: actorId, _generation: resolved.generation,
      _status: result.ok ? "connected" : "error", _last_error: result.ok ? null : result.code,
    });
    if (error || data !== true || !await zapierMcpReadAuthorized(userClient, tenantId, actorId, resolved.generation!)) {
      return { status: "error", code: "connection_changed" };
    }
    return result.ok ? { status: "connected", toolCount: result.toolCount } : { status: "error", code: result.code };
  }
  const { data: secret, error } = await admin.rpc("get_tenant_mcp_secret", {
    _tenant_id: tenantId,
    _provider: provider,
  });
  // Same one call, same reason.
  const probeAuth = error ? null : authFromSecret(secret);
  if (error || !secret?.configured || secret?.enabled === false || !probeAuth) {
    await record(admin, tenantId, provider, "error", "connection is missing its address or credential");
    return { status: "error", code: "mcp_protocol_error" };
  }

  const auth: McpAuth = probeAuth;

  const result = await mcpProbe({ serverUrl: secret.server_url, auth });

  if (!result.ok) {
    // The stable code is retained for the operator. Provider text is not carried here:
    // it is unbounded external content and has no reader that needs it.
    await record(admin, tenantId, provider, "error", result.httpStatus ? `${result.code} (${result.httpStatus})` : result.code);
    return { status: "error", code: result.code };
  }

  // Only this line, reached only after a real MCP exchange, writes `connected`.
  //
  // And only if the write LANDS. The rule this function exists to enforce is that the
  // persisted probe result is what establishes connection state — so returning
  // `connected` when the row still says pending would break that rule from inside the
  // function that states it. The surfaces read this return value: the callback would say
  // Connected over a row that says otherwise, and the next read would silently disagree
  // with what the person was just told.
  if (!await record(admin, tenantId, provider, "connected", null)) {
    return { status: "error", code: "mcp_protocol_error" };
  }
  return { status: "connected", toolCount: result.toolCount };
}

async function record(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tenantId: string,
  provider: string,
  status: "connected" | "error",
  lastError: string | null,
): Promise<boolean> {
  const { error } = await admin.rpc("update_tenant_mcp_probe", {
    _tenant_id: tenantId,
    _provider: provider,
    _status: status,
    _last_error: lastError,
    // `tools_cache` is deliberately left alone. Nothing in this slice may act on an
    // unpinned tool list, and the registry read derives its tool count from
    // `tools_cache -> 'tools'` — so writing any other shape here would publish a
    // permanent "0 tools" that is worse than the honest absence of a number. The
    // pinned cache belongs with the allowlist that will actually read it.
    _tools_cache: undefined,
  });
  if (error) console.error("[tenant-mcp-connect] probe status not stored:", error.message);
  return !error;
}

/** Stable non-sensitive setter codes only. */
function writeCode(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  for (const code of ["MCP_NO_URL", "MCP_INSECURE_URL", "MCP_URL_CREDENTIALS", "MCP_NO_TOKEN",
                      "MCP_BAD_TRANSPORT", "MCP_BAD_AUTH_KIND", "MCP_NO_HEADER_NAME",
                      "MCP_FORBIDDEN", "MCP_NO_TENANT", "MCP_BAD_PROVIDER"]) {
    if (s.includes(code)) return code;
  }
  return "MCP_WRITE_FAILED";
}
