// The original Zapier connection resolver, shared by checks, discovery and actions.
// Credentials stay in the original encrypted store. An uncertain renewal is never replayed.
import { authFromSecret, type McpAuth } from "./mcp-client.ts";
import {
  discoverAuthorizationServer, discoverProtectedResource, isExpired, refreshTokens,
  revokeToken, type AuthorizationServer, type TokenSet,
} from "./mcp-oauth.ts";

export type McpRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type ZapierMcpSecret = Record<string, unknown> & { server_url: string; generation: string };
export type ZapierMcpResolution =
  | { secret: ZapierMcpSecret; auth: McpAuth }
  | { error: string; status: number };

function usable(value: unknown): ZapierMcpSecret | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  return s.configured === true && s.enabled === true && typeof s.server_url === "string"
    && typeof s.generation === "string" && !!s.generation ? s as ZapierMcpSecret : null;
}

export async function revokeZapierMcpSecret(secret: Record<string, unknown>): Promise<boolean> {
  try {
    if (typeof secret.oauth_issuer !== "string") return false;
    const server = await discoverAuthorizationServer(secret.oauth_issuer);
    const token = secret.refresh_token || secret.auth_token;
    if (typeof token !== "string" || !token) return false;
    return await revokeToken({ server, clientId: String(secret.oauth_client_id ?? ""),
      clientSecret: typeof secret.oauth_client_secret === "string" ? secret.oauth_client_secret : null,
      token, tokenTypeHint: secret.refresh_token ? "refresh_token" : "access_token" });
  } catch { return false; }
}

async function discardFresh(server: AuthorizationServer, secret: ZapierMcpSecret, tokens: TokenSet) {
  await revokeToken({ server, clientId: String(secret.oauth_client_id ?? ""),
    clientSecret: typeof secret.oauth_client_secret === "string" ? secret.oauth_client_secret : null,
    token: tokens.refreshToken || tokens.accessToken,
    tokenTypeHint: tokens.refreshToken ? "refresh_token" : "access_token" });
}

export async function resolveZapierMcpConnection(
  admin: McpRpcClient, tenantId: string, actorId: string,
): Promise<ZapierMcpResolution> {
  const { data, error } = await admin.rpc("get_tenant_mcp_secret", { _tenant_id: tenantId, _provider: "zapier" });
  if (error) return { error: "secret_lookup_failed", status: 500 };
  const original = usable(data);
  if (!original) return { error: (data as Record<string, unknown> | null)?.enabled === false
    ? "connection_disabled" : "not_connected", status: 200 };
  const unavailable = async (code: string, status: number): Promise<ZapierMcpResolution> => {
    await admin.rpc("record_tenant_zapier_mcp_probe", { _tenant: tenantId, _actor: actorId,
      _generation: original.generation, _status: "error", _last_error: code });
    return { error: code, status };
  };
  let secret = original;
  if (secret.auth_kind === "oauth" && ((secret.refresh_claim && !secret.refresh_completed_at) || isExpired(secret.expires_at as string | null))) {
    let server: AuthorizationServer;
    let resource = secret.server_url;
    try {
      server = await discoverAuthorizationServer(String(secret.oauth_issuer ?? ""));
      // Preserve the original resource fallback for already-saved deployed grants.
      try { resource = (await discoverProtectedResource(secret.server_url)).resource; } catch { /* original endpoint */ }
    } catch { return await unavailable("authorization_server_unavailable", 502); }

    const claimed = await admin.rpc("claim_tenant_zapier_mcp_refresh", {
      _tenant: tenantId, _actor: actorId, _generation: secret.generation,
    });
    const claim = claimed.data as Record<string, unknown> | null;
    if (claimed.error || !claim) return { error: "connection_changed", status: 409 };
    if (claim.state === "current") {
      const current = usable(claim.secret);
      if (!current) return { error: "not_connected", status: 200 };
      secret = current;
    } else if (claim.state === "claimed" && typeof claim.claim === "string") {
      const current = usable(claim.secret);
      if (!current || current.generation !== original.generation) return { error: "connection_changed", status: 409 };
      let tokens: TokenSet | undefined;
      try {
        tokens = await refreshTokens({ server, resource,
          clientId: String(current.oauth_client_id ?? ""),
          clientSecret: typeof current.oauth_client_secret === "string" ? current.oauth_client_secret : null,
          refreshToken: String(current.refresh_token ?? ""),
          grantedScopes: Array.isArray(current.oauth_scopes) ? current.oauth_scopes as string[] : [],
        });
        const stored = await admin.rpc("finish_tenant_zapier_mcp_refresh", {
          _tenant: tenantId, _actor: actorId, _generation: current.generation, _claim: claim.claim,
          _access_token: tokens.accessToken, _refresh_token: tokens.refreshToken,
          _expires_at: tokens.expiresAt, _scopes: tokens.scopes,
        });
        const result = stored.data as Record<string, unknown> | null;
        let saved = result?.state === "current" && !stored.error ? usable(result.secret) : null;
        if (!saved) {
          // The database may have committed before its response was lost. Reconcile
          // once through the original reader; never repeat the provider refresh.
          const readback = await admin.rpc("get_tenant_mcp_secret", { _tenant_id: tenantId, _provider: "zapier" });
          const candidate = readback.error ? null : usable(readback.data);
          if (candidate && candidate.auth_kind === "oauth" && candidate.refresh_claim === claim.claim && candidate.refresh_completed_at
            && candidate.auth_token === tokens.accessToken
            && (!tokens.refreshToken || candidate.refresh_token === tokens.refreshToken)
            && candidate.oauth_client_id === current.oauth_client_id
            && candidate.oauth_issuer === current.oauth_issuer && candidate.server_url === current.server_url
            && JSON.stringify(candidate.oauth_scopes) === JSON.stringify(tokens.scopes)) saved = candidate;
        }
        if (!saved) throw new Error("renewal_not_stored");
        secret = saved;
      } catch {
        const failed = await admin.rpc("fail_tenant_zapier_mcp_refresh", {
          _tenant: tenantId, _actor: actorId, _generation: current.generation, _claim: claim.claim,
        });
        // Compensate only after the original row confirms this nonce is still its
        // grant. Otherwise a committed renewal or unrelated reconnect may be healthy.
        if (tokens && !failed.error && failed.data === true) await discardFresh(server, current, tokens);
        if (failed.error || failed.data !== true) return { error: "authorization_renewal_unconfirmed", status: 409 };
        return await unavailable("reauthorization_required", 200);
      }
    } else {
      if (claim.state === "reauthorization_required") return await unavailable("reauthorization_required", 200);
      return { error: claim.state === "busy" ? "authorization_renewal_pending"
        : "connection_changed",
      status: claim.state === "busy" || claim.state === "changed" ? 409 : 200 };
    }
  }
  const auth = authFromSecret(secret);
  return auth ? { secret, auth } : { error: "not_connected", status: 200 };
}

// Revalidate before provider traffic and before returning any tenant-scoped result.
export async function zapierMcpReadAuthorized(
  userClient: McpRpcClient, tenantId: string, actorId: string, generation: string,
): Promise<boolean> {
  const { data, error } = await userClient.rpc("zapier_mcp_read_authorized", {
    _tenant: tenantId, _actor: actorId, _generation: generation,
  });
  return !error && data === true;
}
