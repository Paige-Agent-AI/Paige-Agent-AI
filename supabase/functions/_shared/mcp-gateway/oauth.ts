// Connected MCP Gateway — OAUTH BEGIN (Slice ②: start an authorization-code flow for one connection).
//
// The third action on the one gateway door after `verify` (Slice ①) and `create` (Slice ②) — §18: one
// door, many actions. `oauth_begin` mirrors `runVerify` EXACTLY for authority (a connection-scoped
// admin action), then runs the OAuth 2.1 discovery + registration spine and stores the in-flight flow.
// The BROWSER receives only a consent URL; nothing secret crosses it. The flow is COMPLETED, out of
// band, by the JWT-less `mcp-oauth-callback` edge fn (the provider redirect target) — see that function
// for why the completion cannot be an action on this JWT-gated door.
//
// AUTHORITY (§9/§59) — identical gates to runVerify, all bound to the caller's server-resolved tenant:
//   1. tenant from `current_user_tenant_id` (never the body);
//   2. the workspace-switch-race guard (`expected_tenant_id`);
//   3. `is_current_user_tenant_admin` (the `mcp.connections.manage` gate the writer RPCs require);
//   4. the connection is visible to THIS caller in `get_mcp_connections_v2` (RLS + tenant + owner_only
//      scoped) — a foreign/invisible id is `not_found`, the same as a nonexistent one (no IDOR);
//   5. defense in depth: the tenant-agnostic secret read must return the caller's own tenant.
//
// THE STATE IS STORED BEFORE THE BROWSER IS SENT ANYWHERE. Storing it after the redirect would leave a
// consent that can complete against nothing. Every outbound request (discovery, registration) runs
// through _shared/mcp-oauth.ts → safeFetch (https-only, public-address-only, no-redirect, bounded).
//
// NO SECRET IS RETURNED. The client secret a server may mint at DCR is stored ENCRYPTED via
// begin_mcp_oauth; the response carries only the authorize URL, which holds the PKCE challenge, never
// the verifier.

import {
  buildAuthorizationUrl, createPkce, createState, discoverAuthorizationServer,
  discoverProtectedResource, OAuthError, registerClient,
} from "../mcp-oauth.ts";
import { isHttpMcpFacet } from "./connection.ts";

// NB: makeRpcConnectionLoader (connection.ts) is deliberately NOT used here — it is the DISPATCH loader
// and fails closed on an expired OAuth token, which reauthorization must still serve. Read from
// get_mcp_connection_secret (the §18 one home for the decrypted read), and apply the shared facet
// predicate without the dispatch credential-expiry gate. Unsupported facets remain refused.

// The one thing runOauthBegin needs from a Supabase client: an awaitable `rpc` (a PromiseLike, matching
// verify.ts/create.ts, so the real SupabaseClient satisfies the dep under `deno check`).
// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type OauthBeginDeps = {
  /** RLS-scoped as the caller (anon key + the caller's Authorization). All authority gates run here. */
  userClient: RpcClient;
  /** service-role client — reads the decrypted server URL and stores the in-flight flow (verifier +
   *  client secret encrypted). The EXECUTE grant is never the guard; the authority is the gates above. */
  admin: RpcClient;
};

export type OauthBeginInput = {
  connectionId: string;
  /** The tenant the caller BELIEVED they were acting on when the request left the browser. */
  expectedTenantId: string | null;
  /** The authenticated caller's user id (from the wrapper's getUser) — recorded as the flow's actor. */
  actor: string;
  /** The mcp-oauth-callback edge URL, computed by the wrapper from SUPABASE_URL. Registered with the
   *  provider (DCR), placed in the authorize URL, and stored — a redirect the caller cannot influence. */
  redirectUri: string;
};

export type OauthBeginResult = {
  httpStatus: number;
  // Response body carries only browser-safe facts: the authorize URL (challenge, not verifier) or a
  // closed error code. Never a secret or raw provider prose.
  body: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authorize (identical gates to runVerify), then run the OAuth discovery + DCR spine and store the
 * flow. Returns an HTTP status + a safe body. Never throws through: a discovery/registration failure
 * is a closed 502 code, an authority failure a 4xx, a store failure a 500.
 */
export async function runOauthBegin(deps: OauthBeginDeps, input: OauthBeginInput): Promise<OauthBeginResult> {
  const { userClient, admin } = deps;
  const { connectionId, expectedTenantId, actor, redirectUri } = input;

  if (!UUID_RE.test(connectionId)) {
    return { httpStatus: 400, body: { error: "bad_connection_id" } };
  }
  // Canonical lowercase (PG uuid form) so the JS ownership compare matches a mixed-case input the way
  // PG's uuid type does — fail-closed either way (a mismatch only narrows the gate), so a usability fix.
  const id = connectionId.toLowerCase();

  if (!redirectUri) return { httpStatus: 500, body: { error: "callback_not_configured" } };

  // 1. Tenant from the caller's JWT — never the body (§9).
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }

  // 2. Workspace-switch-race guard: refuse if the caller has since switched away from the tenant they
  //    launched from (a rebind to a different — also theirs — workspace would silently mis-target).
  if (expectedTenantId && expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  // 3. Manage gate — mirror the writer RPCs (`mcp.connections.manage` = tenant admin).
  const { data: isAdmin } = await userClient.rpc("is_current_user_tenant_admin");
  if (isAdmin !== true) {
    return { httpStatus: 403, body: { error: "forbidden" } };
  }

  // 4. §9 ownership + visibility: the connection must appear in the caller's own tenant-scoped v2 read.
  //    A row in another tenant, or an owner_only row this caller cannot see, is absent → not_found.
  const { data: v2, error: vErr } = await userClient.rpc("get_mcp_connections_v2");
  if (vErr) return { httpStatus: 500, body: { error: "lookup_failed" } };
  const rows = Array.isArray(v2) ? v2 : [];
  const owned = rows.some((r) => r && typeof r === "object" && (r as { connection_id?: unknown }).connection_id === id);
  if (!owned) return { httpStatus: 404, body: { error: "not_found" } };

  // 5. Read the connection's server URL server-side. Deliberately NOT the dispatch loader
  //    (makeRpcConnectionLoader): that wrapper fails closed on an EXPIRED oauth token and on
  //    non-executable facets — but re-authorizing an expired oauth connection is exactly a case
  //    oauth_begin must still serve, and we are about to (re)configure the connection, not dispatch to
  //    it. get_mcp_connection_secret is the §18 one home for the decrypted read; we take only the
  //    server URL, tenant, generation and facet from it; credential expiry does not block consent.
  const { data: sec, error: sErr } = await admin.rpc("get_mcp_connection_secret", { _connection_id: id });
  if (sErr) return { httpStatus: 500, body: { error: "lookup_failed" } };
  const row = (sec ?? {}) as { configured?: unknown; enabled?: unknown; server_url?: unknown; tenant_id?: unknown; config_generation?: unknown; auth_kind?: unknown; transport?: unknown };
  if (row.configured !== true) return { httpStatus: 409, body: { error: "connection_unconfigured" } };
  if (row.enabled === false) return { httpStatus: 409, body: { error: "connection_disabled" } };
  const serverUrl = typeof row.server_url === "string" ? row.server_url : "";
  const rowTenant = typeof row.tenant_id === "string" ? row.tenant_id : "";
  if (!serverUrl) return { httpStatus: 409, body: { error: "connection_unconfigured" } };
  // Defense in depth (§9): the tenant-agnostic read loaded SOME row; it must be the caller's.
  if (rowTenant !== tenantId) return { httpStatus: 403, body: { error: "forbidden" } };
  // The SQL backstop runs only after discovery/DCR. Reject unsupported facets here first,
  // after ownership, so even client registration cannot cross the specialized n8n boundary.
  // Use only the shared facet predicate: the full dispatch loader refuses expired credentials,
  // which this explicit reauthorization flow must still be able to repair.
  if (!isHttpMcpFacet(row.auth_kind, row.transport)) {
    return { httpStatus: 409, body: { error: "connection_unusable" } };
  }
  if (!Number.isSafeInteger(row.config_generation) || Number(row.config_generation) < 1) {
    return { httpStatus: 409, body: { error: "connection_unconfigured" } };
  }

  try {
    // OAuth 2.1 discovery spine (all issuer-verified, all safeFetch): ask the MCP server which
    // authorization servers protect it (RFC 9728), then read the first one's metadata (RFC 8414,
    // issuer must match, S256 required). Nothing here is hardcoded to a provider.
    const { resource, authorizationServers } = await discoverProtectedResource(serverUrl);
    const server = await discoverAuthorizationServer(authorizationServers[0]);

    // One client registration per connection (RFC 7591 DCR, public client) — never a shared platform
    // credential. A server that issues a secret anyway has it kept encrypted.
    const registration = await registerClient({ server, redirectUri, clientName: "Paige" });

    const pkce = await createPkce();
    const state = createState();

    // Store the flow BEFORE the browser is sent anywhere (verifier + client secret encrypted; §9/§59
    // begin_mcp_oauth re-verifies the connection is in the passed tenant).
    const { error: bErr } = await admin.rpc("begin_mcp_oauth", {
      _connection_id: id,
      _tenant_id: tenantId,
      _state: state,
      _verifier: pkce.verifier,
      _redirect_uri: redirectUri,
      _issuer: server.issuer,
      _resource: resource,
      _client_id: registration.clientId,
      _client_secret: registration.clientSecret,
      _actor: actor,
      _expected_generation: row.config_generation,
      _requested_scopes: server.scopesSupported,
    });
    if (bErr) return { httpStatus: 500, body: { error: "oauth_begin_failed" } };

    return {
      httpStatus: 200,
      body: {
        ok: true,
        // The only thing the browser receives: where to send the person. It carries the PKCE
        // challenge, never the verifier, and the resource that binds the token (RFC 8707).
        authorize_url: buildAuthorizationUrl({
          server,
          clientId: registration.clientId,
          redirectUri,
          state,
          challenge: pkce.challenge,
          scopes: server.scopesSupported,
          resource,
        }),
      },
    };
  } catch (e) {
    // OAuthError carries a closed code (discovery_failed / issuer_mismatch / registration_failed / …);
    // anything else is an internal fault mapped to the same closed shape. Never provider prose.
    return {
      httpStatus: 502,
      body: { error: "oauth_begin_failed", code: e instanceof OAuthError ? e.code : "discovery_failed" },
    };
  }
}
