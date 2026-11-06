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
const integrationsSurface = read("src/operator/surfaces/IntegrationsSurface.tsx");
const operatorSocialDoor = read("src/operator/surfaces/OperatorSocialDoor.tsx");
const providerSeam = read("supabase/functions/_shared/social-provider/mod.ts");
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
    // search from the guard forward: an unrelated deleteProfile exists earlier in the
    // connect-error path, and the contract is that the DISCONNECT delete comes after the guard
    const providerDelete = endpoint.indexOf("adapter.deleteProfile", providedBranch);
    expect(providedBranch).toBeGreaterThan(-1);
    expect(providerDelete).toBeGreaterThan(providedBranch);
    expect(endpoint.indexOf("_disconnected_at", providedBranch)).toBeGreaterThan(providedBranch);
  });

  it("adoption is reachable from the Integrations surface and every adoption carries the governed approval", () => {
    expect(hook).toContain('action: "hub_profiles"');
    expect(hook).toContain('action: "adopt"');
    expect(hook).toContain('"social_connection_adopt"');
    expect(hook).toContain("providedByPlatform: row.provided_by_platform === true");
    expect(drawer).toContain("Confirm this Social change · Approve once");
    expect(drawer).toContain('capability === "social_connection_adopt"');
    expect(drawer).toContain("social.approve()");
    expect(catalogue).toContain("SocialHubPanel");
  });

  it("platform-provided identities are labeled in the drawer", () => {
    expect(drawer).toContain("{platform.name} identity{connection.providedByPlatform ? \" · platform connection\" : \"\"}");
  });

  it("resolves the designated platform workspace for the Platform Operator and nowhere else", () => {
    // The God Level account holds no active workspace in the console: the door falls back to
    // the platform-owner-only resolver, server-side, fail-closed. Authority comes from that
    // resolution alone — never from the request body.
    expect(endpoint).toContain('caller.rpc("resolve_platform_operator_workspace")');
    expect(endpoint).toContain("actingAsPlatformWorkspace");
    expect(endpoint).toContain("const isAdmin = actingAsPlatformWorkspace ||");
    expect(endpoint).not.toMatch(/body??.(tenant|workspace)/);
  });

  it("mounts the governed Social door on the Solo-shell Integrations surface — and no grant apparatus anywhere", () => {
    // Owner ruling 2026-11-05: the Operator Integrations page IS the Solo shell page
    // (same markup, same stylesheet); the Social cards open ONE drawer whose every
    // act runs through the governed approval. The retired hub card's capability —
    // adopting a channel the platform already holds — lives on inside that drawer.
    expect(integrationsSurface).toContain('from "./OperatorSocialDoor"');
    expect(integrationsSurface).toContain("<OperatorSocialDrawer");
    expect(integrationsSurface).toContain("same fixed options");
    expect(operatorSocialDoor).toContain('action: "channels"');
    expect(operatorSocialDoor).toContain('action: "hub_profiles"');
    expect(operatorSocialDoor).toContain('action: "adopt"');
    expect(operatorSocialDoor).toContain('action: "start"');
    expect(operatorSocialDoor).toContain('action: "disconnect"');
    expect(operatorSocialDoor).toContain("approval_fingerprint");
    expect(operatorSocialDoor).toContain("Approve once");
    // "There should be no reason that I need to approve any of the Solo account":
    // per-workspace social grants are gone from the UI, and nothing may reintroduce
    // them on an operator surface.
    for (const source of [integrationsSurface, operatorSocialDoor]) {
      expect(source).not.toMatch(/social_platform_grant/);
      expect(source).not.toContain("Which workspaces may use which company channels");
    }
  });

  it("widens CONNECTING to the provider's apps while publishing stays social-only (owner 2026-11-05)", () => {
    expect(providerSeam).toContain("export const SOCIAL_CONNECTION_PLATFORMS");
    for (const app of ['"google"', '"discord"', '"telegram"']) expect(providerSeam).toContain(app);
    expect(providerSeam).toContain("export const GOOGLE_CONNECT_AREAS");
    expect(endpoint).toContain("SOCIAL_CONNECTION_PLATFORMS.includes");
    // Google requires its areas; the door defaults the operator's start to Gmail-and-Calendar.
    expect(endpoint).toContain('["email", "calendar"]');
    // The posting arm must NOT widen with the connection set.
    expect(adapter).toContain("function postPlatform");
    expect(adapter).toContain('"unsupported_post_platform"');
    // The callback accepts the SAME return destinations as the door — the Solo-only check
    // silently killed every Operator connect at the return step (fixed with this change).
    expect(callback).toContain("|operator)");
  });

  it("shows the platform's held channels at card level and adopts them across the full connection set (owner 2026-11-06)", () => {
    // "My connections are not live on the Platform Operator Integrations": channels the
    // provider hub already holds are provider-proven truth — the card states them and
    // the drawer's governed bring-in adopts them, now for every connection platform.
    expect(operatorSocialDoor).toContain("Held by the platform");
    expect(operatorSocialDoor).toContain("bring it in");
    expect(operatorSocialDoor).toContain("SOCIAL_PROVIDER_UNAVAILABLE");
    expect(endpoint).toContain("adoptable: (SOCIAL_CONNECTION_PLATFORMS as readonly string[]).includes(account.platform)");
    expect(endpoint).toContain("&& SOCIAL_CONNECTION_PLATFORMS.includes(p as typeof SOCIAL_CONNECTION_PLATFORMS[number])");
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

describe("Platform Integrations redesign seam (owner 2026-11-05)", () => {
  const grantsMigration = read("supabase/migrations/20271131000002_social_platform_grant_ops.sql");

  it("serves the console's channel list through the same admin-gated door, read-only", () => {
    expect(endpoint.indexOf('action === "channels"')).toBeGreaterThan(endpoint.indexOf("const isAdmin ="));
    expect(endpoint.indexOf('action === "channels"')).toBeLessThan(endpoint.indexOf('action === "hub_profiles"'));
    const channelsBlock = endpoint.slice(endpoint.indexOf('action === "channels"'), endpoint.indexOf('action === "hub_profiles"'));
    expect(channelsBlock).toContain("SOCIAL_CHANNELS_FORBIDDEN");
    // Read-only: the channels action never touches a governed mutation.
    expect(channelsBlock).not.toContain("govern(");
  });

  it("lets a fresh connect start from the Platform console return path as well as a Solo one", () => {
    expect(endpoint).toContain("RETURN_PATH = /^\\/(solo\\/[A-Za-z0-9_-]+|operator)\\/settings\\/integrations\\/?$/");
  });

  it("gates every workspace-grant RPC on the platform-owner resolver and fails closed", () => {
    expect(grantsMigration).toContain("SOCIAL_GRANTS_FORBIDDEN");
    for (const fn of ["social_platform_grant_workspaces", "social_platform_grants_list", "social_platform_grant_set"]) {
      const start = grantsMigration.indexOf(`create or replace function public.${fn}`);
      const end = grantsMigration.indexOf("create or replace function public.", start + 10);
      const block = grantsMigration.slice(start, end > start ? end : undefined);
      expect(block, `${fn} must exist`).toContain("security definer");
      expect(block, `${fn} must gate on the resolver`).toContain("resolve_platform_operator_workspace()");
      expect(block, `${fn} must fail closed`).toContain("SOCIAL_GRANTS_FORBIDDEN");
    }
    expect(grantsMigration).not.toMatch(/revoke all on function/);
  });
});

describe("platform operator workspace resolver (incident fix 2026-11-05)", () => {
  const resolverMigration = read("supabase/migrations/20271132000001_resolve_platform_operator_workspace.sql");

  it("ships the resolver its grant RPCs call — reference-without-create can never land again", () => {
    // 20271131000002 shipped RPC bodies calling resolve_platform_operator_workspace()
    // without ever creating it; Supabase applies migrations with plpgsql body
    // checking off, so the gap only surfaced at first CALL in the owner's browser.
    expect(resolverMigration).toMatch(/create or replace function public\.resolve_platform_operator_workspace\(\)/);
    expect(resolverMigration).toContain("security definer");
    expect(resolverMigration).toContain("is_super_admin()");
    expect(resolverMigration).toContain("platform_operator_tenant_id");
    expect(resolverMigration).toMatch(/revoke execute on function public\.resolve_platform_operator_workspace\(\) from public, anon/);
    expect(resolverMigration).toContain("set search_path to ''");
  });
});
