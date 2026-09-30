// Connected MCP Gateway — CREATE (Slice ②: the gateway's create door).
//
// The second action on the one gateway door after Slice ①'s `verify` (§18: one door, many actions).
// `create` is a THIN, JWT-scoped pass-through onto the already-live G1a-1 registry writers
// `create_mcp_connection` (the MCP facet) and `create_mcp_rest_connection` (the n8n REST api-key
// facet). Those RPCs are SECURITY DEFINER and enforce EVERYTHING in-body — §9 authority
// (`_mcp_resolve_tenant` + the `mcp.connections.manage` capability, no service-role bypass,
// INT-089), credential-bundle validity (`_mcp_assert_credential_bundle`, incl. the INT-153
// ≥12 bearer/header floor), and the SSRF endpoint guard (`_mcp_endpoint_write_safe`). So this
// module does NOT re-implement any of that (§18 — duplicating the credential/SSRF/length checks
// here would be the real breach and a drift risk); routing through the caller's `userClient` means
// the RPC's in-body authority is the real gate and the edge can only NARROW it, never widen it.
//
// NO SERVICE-ROLE CLIENT HERE (§59). `verify` needs `admin` to decrypt a secret and write the probe;
// `create` needs neither. Handing `create` the service-role client would put it one typo away from
// `admin.rpc("create_mcp_connection", …)`, which runs with `auth.uid()` NULL — and `_mcp_resolve_tenant`
// accepts a passed `_tenant_id` with NO membership check for a NULL caller, leaving only the `{}`
// capability refusal between it and a cross-tenant write. §59 is explicit that the absence of a grant
// is never the guard, so `create` takes `{ userClient }` only and `admin` is not even in its scope.
//
// SECRET DISCIPLINE (§13). The writers return only host-safe facts — a connection id, the new
// status, an endpoint hash, and the last4 of a token (only for tokens ≥12). Nothing here returns the
// server URL, a credential, or raw provider text; the edge passes that safe shape straight through.

import { mapWriterError } from "./writer-errors.ts";

// The one thing runCreate needs from a Supabase client: an awaitable `rpc`. The real
// `SupabaseClient.rpc()` returns a PostgrestFilterBuilder — a thenable (`PromiseLike`), NOT a full
// `Promise` — so the seam is typed `PromiseLike` (matching verify.ts, so the real client satisfies
// the dep under `deno check`).
// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, params?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export type CreateDeps = {
  /** RLS-scoped as the caller (anon key + the caller's Authorization). The ONLY client create uses:
   *  the writer RPC's in-body §9 authority resolves through it. There is deliberately no service-role
   *  client in these deps (§59) — create reads no secret and writes no probe. */
  userClient: RpcClient;
};

export type CreateInput = {
  /** Explicit closed discriminator picking the writer RPC: "mcp" → create_mcp_connection,
   *  "rest" → create_mcp_rest_connection. Never inferred from auth_kind (an `api_key` on the MCP
   *  branch is left to the RPC's own MCP_AUTH_KIND_NOT_EXECUTABLE backstop, never silently rerouted). */
  facet: string;
  /** The tenant the caller BELIEVED they were acting on when the request left the browser (the
   *  workspace-switch-race guard). Never used as the write tenant — that is resolved from the JWT. */
  expectedTenantId: string | null;
  providerKey: string | null;
  label: string | null;
  visibility: string | null;
  // MCP facet fields (create_mcp_connection):
  serverUrl: string | null;
  authKind: string | null;
  authToken: string | null;
  authHeaderName: string | null;
  /** Untrusted map; malformed values must reach the canonical writer's validation, not disappear. */
  customHeaders?: unknown;
  refreshToken: string | null;
  oauthIssuer: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthScopes: string[] | null;
  accessTokenExpiresAt: string | null;
  // REST facet fields (create_mcp_rest_connection):
  baseUrl: string | null;
  apiKey: string | null;
};

export type CreateResult = {
  httpStatus: number;
  // Response body carries only model-/browser-safe facts; never a secret, a raw PG message, or a
  // gate-distinguishing suffix.
  body: Record<string, unknown>;
};

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : null;
}

/** Translate the untrusted HTTP body into the typed CreateInput. Absent or wrong-typed fields become
 *  null; the writer RPC's in-body checks turn a missing required field into its own coded error, so
 *  the edge does NOT pre-validate shape (§18 — the RPC owns validation). `expected_tenant_id` is
 *  passed separately because the wrapper shares it with the verify action. */
export function readCreateInput(
  body: Record<string, unknown>,
  expectedTenantId: string | null,
): CreateInput {
  return {
    facet: typeof body.facet === "string" ? body.facet : "",
    expectedTenantId,
    providerKey: nonEmptyString(body.provider_key),
    label: nonEmptyString(body.label),
    visibility: nonEmptyString(body.visibility),
    serverUrl: nonEmptyString(body.server_url),
    authKind: nonEmptyString(body.auth_kind),
    authToken: nonEmptyString(body.auth_token),
    authHeaderName: nonEmptyString(body.auth_header_name),
    customHeaders: Object.hasOwn(body, "custom_headers") ? body.custom_headers : {},
    refreshToken: nonEmptyString(body.refresh_token),
    oauthIssuer: nonEmptyString(body.oauth_issuer),
    oauthClientId: nonEmptyString(body.oauth_client_id),
    oauthClientSecret: nonEmptyString(body.oauth_client_secret),
    oauthScopes: stringArray(body.oauth_scopes),
    accessTokenExpiresAt: nonEmptyString(body.access_token_expires_at),
    baseUrl: nonEmptyString(body.base_url),
    apiKey: nonEmptyString(body.api_key),
  };
}

/**
 * Authorize (via the writer RPC's in-body gate) and create one registry connection. Returns an HTTP
 * status + a safe body. The caller is already authenticated by the wrapper; this resolves tenant scope
 * for the workspace-switch guard, then hands a per-facet named-params call to the SECURITY DEFINER
 * writer, whose in-body §9 authority + validation is the authority. `_tenant_id` is deliberately NOT
 * passed: the writer derives the tenant from `auth.uid()`, and a passed hint would either RAISE 42501
 * on a mismatch (normal caller) or override for a platform owner — neither is wanted from the edge,
 * which already guards the switch race itself.
 */
export async function runCreate(deps: CreateDeps, input: CreateInput): Promise<CreateResult> {
  const { userClient } = deps;

  // Explicit facet gate — an unknown/absent facet is a defined reject, never a default that guesses.
  if (input.facet !== "mcp" && input.facet !== "rest") {
    return { httpStatus: 400, body: { error: "unsupported_facet" } };
  }

  // Tenant from the caller's JWT context — never the body (§9). Needed only for the switch-race guard;
  // the writer re-resolves it in-body as the authority.
  const { data: tenantId, error: tErr } = await userClient.rpc("current_user_tenant_id");
  if (tErr || typeof tenantId !== "string" || !tenantId) {
    return { httpStatus: 400, body: { error: "no_tenant" } };
  }

  // Workspace-switch-race guard: refuse if the caller has since switched away from the tenant they
  // launched the create from (a rebind to a different — also theirs — workspace is silent otherwise).
  // This is the edge's genuine value-add over a direct RPC call and the reason `_tenant_id` is omitted.
  if (input.expectedTenantId && input.expectedTenantId !== tenantId) {
    return { httpStatus: 409, body: { error: "tenant_mismatch" } };
  }

  // Dispatch to the correct writer with per-facet NAMED params (never positional — the REST writer's
  // `_provider_key`-first signature would misbind a positional call). Null flows through for absent
  // fields; the writer's in-body checks turn a missing required field into its own coded error
  // (MCP_BAD_LABEL / MCP_BAD_ENDPOINT / MCP_BAD_CREDENTIAL_BUNDLE / …). `_visibility` defaults to
  // 'tenant' here so a caller who omits it never sends NULL into the NOT NULL column.
  const rpc = input.facet === "mcp"
    ? userClient.rpc("create_mcp_connection", {
      _provider_key: input.providerKey,
      _label: input.label,
      _server_url: input.serverUrl,
      _auth_kind: input.authKind,
      _auth_token: input.authToken,
      _auth_header_name: input.authHeaderName,
      _custom_headers: input.customHeaders === undefined ? {} : input.customHeaders,
      _refresh_token: input.refreshToken,
      _oauth_issuer: input.oauthIssuer,
      _oauth_client_id: input.oauthClientId,
      _oauth_client_secret: input.oauthClientSecret,
      _oauth_scopes: input.oauthScopes,
      _access_token_expires_at: input.accessTokenExpiresAt,
      _visibility: input.visibility ?? "tenant",
    })
    : userClient.rpc("create_mcp_rest_connection", {
      _provider_key: input.providerKey ?? "n8n",
      _label: input.label,
      _base_url: input.baseUrl,
      _api_key: input.apiKey,
      _visibility: input.visibility ?? "tenant",
    });

  const { data, error } = await rpc;
  if (error) {
    const mapped = mapWriterError(error, "create_failed");
    return { httpStatus: mapped.httpStatus, body: mapped.body };
  }

  // Success — the writer returns { connection_id, status, endpoint_hash, auth_token_last4 } (secret-free).
  // A response with no connection_id is not a real create (§13 — never claim a row that was not made).
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (typeof row.connection_id !== "string") {
    return { httpStatus: 500, body: { error: "create_failed" } };
  }
  return {
    httpStatus: 200,
    body: {
      connection_id: row.connection_id,
      status: row.status,
      endpoint_hash: row.endpoint_hash,
      auth_token_last4: row.auth_token_last4,
      address_configured: row.address_configured,
      credentials_configured: row.credentials_configured,
      custom_header_count: row.custom_header_count,
      config_generation: row.config_generation,
    },
  };
}
