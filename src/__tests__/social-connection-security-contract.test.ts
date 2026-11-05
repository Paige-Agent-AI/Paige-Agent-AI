// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const endpoint = read("supabase/functions/paige-social/index.ts");
const callback = read("supabase/functions/paige-social-callback/index.ts");
const migration = read("supabase/migrations/20270127000000_social_connection_lifecycle.sql")
  + read("supabase/migrations/20270130000000_social_connection_platform_scope.sql");
const platformMigration = read("supabase/migrations/20271131000001_social_platform_connections.sql");
const adapter = read("supabase/functions/_shared/social-provider/zernio.ts");
const hook = read("src/solo/data/useSocialConnections.ts");
const drawer = read("src/solo/settings-integrations-social.tsx");
const catalogue = read("src/solo/settings-integrations.tsx");

describe("Social connection authority and tenant isolation", () => {
  it("authenticates, resolves the active tenant server-side, and treats a body tenant only as a stale-workspace assertion", () => {
    const authAt = endpoint.indexOf("auth.getUser()");
    const tenantAt = endpoint.indexOf('caller.rpc("current_user_tenant_id")');
    const actionAt = endpoint.indexOf('if (action === "start")');
    expect(authAt).toBeGreaterThan(-1);
    expect(tenantAt).toBeGreaterThan(authAt);
    expect(actionAt).toBeGreaterThan(tenantAt);
    expect(endpoint).toContain("expectedTenant !== tenantId");
    expect(endpoint).not.toMatch(/body\.tenant_id/);
  });

  it("governs every customer mutation before creating a connection, selecting an account, or disconnecting", () => {
    for (const capability of [
      "social_connection_start",
      "social_account_select",
      "social_connection_disconnect",
    ]) expect(endpoint).toContain(capability);
    expect(endpoint.indexOf('const result = await govern(\n      "social_connection_start"'))
      .toBeLessThan(endpoint.indexOf('.insert({\n        id: connectionId'));
    expect(endpoint).toContain("approval_fingerprint");
    expect(migration).toContain("p.args->>'connection_id'=_connection_id::text and p.args->>'account_id'=_account_id::text");
    expect(migration).toContain("p.args->>'connection_id'=_connection_id::text");
  });

  it("binds accounts to a tenant-matched connection and exposes no service-only correlation through status RPCs", () => {
    expect(migration).toContain("foreign key (tenant_id,connection_id)");
    expect(migration).toContain("SOCIAL_ACCOUNT_CONNECTION_MISMATCH");
    expect(migration).toContain("update of tenant_id,provider_key,connection_id,platform on public.paige_social_accounts");
    expect(migration).toContain("constraint paige_social_connections_provider_profile_key unique (provider_key,provider_profile_key)");
    expect(migration).toContain("alter table public.paige_social_connections force row level security");
    expect(migration).toContain("alter table public.paige_social_connection_attempts force row level security");
    expect(migration).toMatch(/revoke all on public\.paige_social_connections,public\.paige_social_connection_attempts\s+from public,anon,authenticated/);
    const accountStatusAt = migration.indexOf("create function public.social_account_status()");
    const connectionStatusAt = migration.indexOf("create function public.social_connection_status()", accountStatusAt);
    const statusProjection = migration.slice(accountStatusAt, connectionStatusAt);
    expect(statusProjection).not.toContain("provider_profile_key");
    expect(statusProjection).not.toContain("token_hash");
  });
});

describe("Social authorization callback", () => {
  it("keeps the one-time token on the service callback and never sends it through the app", () => {
    expect(endpoint).toContain("/functions/v1/paige-social-callback");
    expect(endpoint).toContain('callback.searchParams.set("token", callbackToken)');
    expect(endpoint).not.toContain('callback.searchParams.set("social_token"');
    expect(hook).not.toContain("callback_token");
    expect(hook).not.toContain("social_token");
    expect(hook).toContain('params.get("social_result")');
  });

  it("returns to the canonical app origin when PUBLIC_SITE_URL is unset, and never to a malformed one", () => {
    // 2026-11-04 outage root cause: these were the platform's only hard-required PUBLIC_SITE_URL
    // reads. The env was never provisioned (nothing else requires it), so every Connect click was
    // refused while the provider key was present. The canonical-app-url fallback matches
    // mcp-oauth-callback (the same browser-redirect job) — and origin validation is unchanged.
    expect(endpoint).toContain('const configured = Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai"');
    expect(callback).toContain('const configured = Deno.env.get("PUBLIC_SITE_URL") ?? "https://paigeagent.ai"');
    expect(endpoint).toContain('url.protocol !== "https:" || url.username || url.password || url.search || url.hash');
    expect(callback).toContain('url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash');
  });

  it("does not require a separately managed profile secret when the server already has its service secret", () => {
    expect(endpoint).toContain('const configuredProfileSecret = Deno.env.get("SOCIAL_PROFILE_SIGNING_SECRET")?.trim()');
    expect(endpoint).toContain('`paige-social-profile-v1:${serviceKey}`');
    expect(endpoint).not.toContain("Boolean(profileSecret)");
  });

  it("derives tenant, actor, connection, and return path only from the single-use stored attempt", () => {
    expect(callback).toContain('admin.rpc("social_claim_connection_callback"');
    expect(callback).not.toMatch(/searchParams\.get\("(tenant|actor|connection|return)/);
    expect(callback).not.toMatch(/body\??\.tenant_id/);
    expect(migration).toContain("where a.id=_attempt_id and a.token_hash=_token_hash and a.expires_at>_claimed_at");
    expect(migration).toContain("p.server_issued_at is not null and p.consumed_at is not null");
    expect(migration).toContain("if auth.role()<>'service_role' then raise exception 'SOCIAL_CALLBACK_CLAIM_FORBIDDEN'");
  });

  it("requires provider readback before recording verified state and redirects without secrets", () => {
    const readAt = callback.indexOf("adapter.readProfile");
    const applyAt = callback.indexOf('admin.rpc("social_apply_connection_readback"');
    const receiptAt = callback.indexOf("const railRecorded = await recordCapabilityRun");
    const redirectAt = callback.indexOf('resultRedirect(claim.return_path, "verified"');
    expect(readAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(readAt);
    expect(receiptAt).toBeGreaterThan(applyAt);
    expect(redirectAt).toBeGreaterThan(receiptAt);
    expect(callback).toContain('"Cache-Control": "no-store"');
    expect(callback).toContain('"Referrer-Policy": "no-referrer"');
    expect(callback).toMatch(/new Response\(null,[\s\S]*Location: url\.href,[\s\S]*"Cache-Control": "no-store",[\s\S]*"Referrer-Policy": "no-referrer"/);
    expect(callback).not.toContain('url.searchParams.set("token"');
  });

  it("cannot apply callback readback after disconnect wins the connection lock", () => {
    expect(migration).toMatch(/where c\.tenant_id=_tenant_id and c\.id=_connection_id\s+and c\.status='authorizing'\s+and a\.id=_attempt_id/);
    expect(migration).toContain("state in ('created','redirected','processing')");
  });

  it("governs hub adoption and writes only provider-readback-verified channels as platform-provided", () => {
    expect(endpoint).toContain('"social_connection_adopt"');
    expect(endpoint).toContain('"Bring the platform hub\'s existing Social channels into this workspace as platform-provided connections. Nothing is published."');
    const governAt = endpoint.indexOf('"social_connection_adopt"');
    const rpcAt = endpoint.indexOf('admin.rpc("social_adopt_platform_channels"');
    expect(governAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(governAt);
    expect(endpoint).toContain('SOCIAL_ADOPT_NOTHING_VERIFIED');
    expect(platformMigration).toContain("SOCIAL_ADOPT_APPROVAL_INVALID");
    expect(platformMigration).toContain("p.tool_name='social_connection_adopt'");
    expect(platformMigration).toContain("provided_by_platform boolean not null default false");
    expect(platformMigration).toContain("'hub:' || _tenant_id::text || ':' || _hub_profile_id || ':' || k");
  });

  it("lists hub profiles admin-only and never offers tenant-owned provider profiles for adoption", () => {
    expect(endpoint).toContain('"hub_profiles"');
    expect(endpoint).toContain("SOCIAL_HUB_FORBIDDEN");
    // the adapter's hub helpers exclude profiles whose externalId is a tenant ps_ key
    expect(adapter).toContain("PROFILE_KEY_PATTERN.test(externalId)");
    expect(adapter).toContain("export async function listZernioHubProfiles");
    expect(adapter).toContain("export async function readZernioHubProfile");
    expect(adapter).toContain("HUB_PROFILE_ID_PATTERN");
  });

  it("disconnecting a platform-provided connection never revokes the shared hub provider profile", () => {
    expect(endpoint).toContain(".select(\"id,status,provider_key,provider_profile_key,provided_by_platform\")");
    const providedBranch = endpoint.indexOf("const isPlatformProvided");
    const providerDelete = endpoint.indexOf("adapter.deleteProfile");
    expect(providedBranch).toBeGreaterThan(-1);
    expect(providerDelete).toBeGreaterThan(providedBranch);
    expect(endpoint.indexOf("_disconnected_at", providedBranch)).toBeGreaterThan(providedBranch);
  });

  it("keeps per-workspace platform-channel grants service-role-only and empty by default", () => {
    expect(platformMigration).toContain("create table if not exists public.paige_social_platform_grants");
    expect(platformMigration).toContain("force row level security");
    expect(platformMigration).toMatch(/revoke all on public\.paige_social_platform_grants\s+from public, anon, authenticated/);
    expect(platformMigration).not.toMatch(/insert into public\.paige_social_platform_grants/);
  });

  it("recreates a provider profile only when reconnect readback proves it is missing", () => {
    expect(endpoint).toContain('error.code === "provider_profile_not_found"');
    expect(endpoint).toContain("createdProfile = (await adapter.createProfile({ providerProfileKey })).created");
  });
});

describe("customer-facing identity truth", () => {
  it("uses only Social language and contains no provider-company or owner-brand identity", () => {
    const customerSources = [drawer, catalogue, hook].join("\n");
    expect(customerSources).not.toMatch(/upload[\s-]?post/i);
    expect(customerSources).not.toMatch(/mogul maker/i);
    expect(customerSources).not.toMatch(/academy/i);
  });

  it("starts without a default identity or target and selects only an explicit discovered account", () => {
    expect(hook).toContain("connections: [], accounts: []");
    expect(drawer).toContain("No {platform.name} accounts are connected");
    expect(drawer).toContain("Select this account");
    expect(endpoint).toContain('.eq("tenant_id", tenantId).eq("connection_id", connectionId).eq("id", accountId)');
    expect(drawer).toContain("connection.requestedPlatform === platform.key");
    expect(endpoint).toContain("SOCIAL_OAUTH_PLATFORMS.includes");
    expect(callback).toContain("returnedPlatform !== claim.requested_platform");
    expect(migration).toContain("not selected or status='connected'");
    expect(migration).toContain("provider_account_id text;");
    expect(migration).not.toMatch(/\n\s+account_id text;/);
  });
});
