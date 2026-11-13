import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveZapierMcpConnection, zapierMcpReadAuthorized } from "../../supabase/functions/_shared/zapier-mcp-auth";

const oauth = vi.hoisted(() => ({ discoverAuthorizationServer: vi.fn(), discoverProtectedResource: vi.fn(),
  refreshTokens: vi.fn(), revokeToken: vi.fn(), isExpired: vi.fn() }));
vi.mock("../../supabase/functions/_shared/mcp-oauth.ts", () => oauth);

const old = () => ({ configured: true, enabled: true, generation: "generation-a",
  auth_kind: "oauth", server_url: "https://mcp.zapier.com/api/v1/connect", auth_token: "old-access",
  refresh_token: "old-refresh", oauth_issuer: "https://issuer.example", oauth_client_id: "test-client",
  oauth_scopes: ["records.read"], expires_at: "2020-01-01T00:00:00Z", approved_capabilities: ["read"] });
const renewed = () => ({ ...old(), auth_token: "saved-access", refresh_token: "saved-refresh", refresh_claim: null });
const tokenSet = () => ({ accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresAt: "2099-01-01T00:00:00Z", scopes: ["records.read"] });
function database(overrides: Record<string, unknown> = {}) {
  return { rpc: vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    const values: Record<string, unknown> = { get_tenant_mcp_secret: old(),
      claim_tenant_zapier_mcp_refresh: { state: "claimed", claim: "claim-a", secret: old() },
      finish_tenant_zapier_mcp_refresh: { state: "current", secret: renewed() },
      fail_tenant_zapier_mcp_refresh: true, ...overrides };
    const result = values[name];
    return result instanceof Error ? { data: null, error: result } : { data: result, error: null };
  }) };
}
beforeEach(() => {
  vi.resetAllMocks();
  oauth.isExpired.mockReturnValue(true);
  oauth.discoverAuthorizationServer.mockResolvedValue({ issuer: "https://issuer.example" });
  oauth.discoverProtectedResource.mockResolvedValue({ resource: "https://resource.example/mcp" });
  oauth.refreshTokens.mockResolvedValue(tokenSet());
  oauth.revokeToken.mockResolvedValue(true);
});

describe("original Zapier MCP resolver shared by checks and actions", () => {
  it("stores rotation before using the saved credential, with actor, generation, claim and scopes", async () => {
    const db = database();
    const result = await resolveZapierMcpConnection(db, "workspace-a", "actor-a");
    expect(result).toMatchObject({ auth: { kind: "bearer", token: "saved-access" } });
    expect(db.rpc).toHaveBeenCalledWith("claim_tenant_zapier_mcp_refresh", {
      _tenant: "workspace-a", _actor: "actor-a", _generation: "generation-a" });
    expect(oauth.refreshTokens).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://resource.example/mcp", refreshToken: "old-refresh", grantedScopes: ["records.read"] }));
    expect(db.rpc).toHaveBeenCalledWith("finish_tenant_zapier_mcp_refresh", expect.objectContaining({
      _generation: "generation-a", _claim: "claim-a", _access_token: "fresh-access", _scopes: ["records.read"] }));
    expect(oauth.revokeToken).not.toHaveBeenCalled();
  });
  it("uses the current transaction snapshot if another request already renewed", async () => {
    const db = database({ claim_tenant_zapier_mcp_refresh: { state: "current", secret: renewed() } });
    expect(await resolveZapierMcpConnection(db, "workspace-a", "actor-a"))
      .toMatchObject({ auth: { token: "saved-access" } });
    expect(oauth.refreshTokens).not.toHaveBeenCalled();
  });
  it.each([["busy", "authorization_renewal_pending"], ["changed", "connection_changed"],
    ["reauthorization_required", "reauthorization_required"]])("never refreshes a %s claim", async (state, error) => {
    const db = database({ claim_tenant_zapier_mcp_refresh: { state } });
    expect(await resolveZapierMcpConnection(db, "workspace-a", "actor-a")).toMatchObject({ error });
    expect(oauth.refreshTokens).not.toHaveBeenCalled();
  });
  it("does not claim a token when provider metadata is unavailable", async () => {
    const db = database();
    oauth.discoverAuthorizationServer.mockRejectedValue(new Error("provider unavailable"));
    expect(await resolveZapierMcpConnection(db, "workspace-a", "actor-a"))
      .toMatchObject({ error: "authorization_server_unavailable" });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["get_tenant_mcp_secret", "record_tenant_zapier_mcp_probe"]);
    expect(db.rpc).not.toHaveBeenCalledWith("claim_tenant_zapier_mcp_refresh", expect.anything());
  });
  it("marks a lost provider response uncertain and does not send the old token to MCP", async () => {
    const db = database();
    oauth.refreshTokens.mockRejectedValue(new Error("lost response with sensitive provider text"));
    const result = await resolveZapierMcpConnection(db, "workspace-a", "actor-a");
    expect(result).toEqual({ error: "reauthorization_required", status: 200 });
    expect(db.rpc).toHaveBeenCalledWith("fail_tenant_zapier_mcp_refresh", expect.objectContaining({ _claim: "claim-a" }));
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain("finish_tenant_zapier_mcp_refresh");
  });
  it.each([new Error("write failed"), { state: "changed" }])("refuses unpersisted rotation and withdraws only the fresh returned grant", async (result) => {
    const db = database({ finish_tenant_zapier_mcp_refresh: result });
    expect(await resolveZapierMcpConnection(db, "workspace-a", "actor-a"))
      .toEqual({ error: "reauthorization_required", status: 200 });
    expect(oauth.revokeToken).toHaveBeenCalledWith(expect.objectContaining({ token: "fresh-refresh" }));
  });
  it("preserves already-saved URL credentials without inventing an OAuth grant", async () => {
    const db = database({ get_tenant_mcp_secret: { ...old(), auth_kind: "url", auth_token: null } });
    expect(await resolveZapierMcpConnection(db, "workspace-a", "actor-a")).toMatchObject({ auth: { kind: "none" } });
    expect(oauth.refreshTokens).not.toHaveBeenCalled();
  });
  it("does not expose credentials when native read admission fails", async () => {
    const db = database({ zapier_mcp_read_authorized: false });
    expect(await zapierMcpReadAuthorized(db, "workspace-a", "actor-a", "generation-a")).toBe(false);
    expect(db.rpc).toHaveBeenCalledWith("zapier_mcp_read_authorized", {
      _tenant: "workspace-a", _actor: "actor-a", _generation: "generation-a" });
  });
});
