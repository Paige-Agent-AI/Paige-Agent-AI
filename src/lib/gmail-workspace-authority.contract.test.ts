// @vitest-environment node
// Execute the actual native handlers. Every SDK/provider port is a neutral in-memory
// fixture: no existing environment, credential, customer, or network is used.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONNECTOR = "44444444-4444-4444-8444-444444444444";
const ENV: Record<string, string> = {
  SUPABASE_URL: "https://unit-test.invalid", SUPABASE_ANON_KEY: "fixture-public",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service", CALENDAR_ENCRYPTION_KEY: "fixture-state-signing-only",
  GOOGLE_OAUTH_CLIENT_ID: "fixture-client", GOOGLE_OAUTH_CLIENT_SECRET: "fixture-secret",
};
type Seat = "owner" | "admin" | "member" | null;
type Options = {
  seat?: Seat; active?: string | null; globalAdmin?: boolean; authenticated?: boolean;
  connector?: boolean; providerAllowed?: boolean; scopeError?: boolean; adminError?: boolean;
  switchAt?: "token" | "userinfo" | "vault" | "connector-read" | "secret-read" | "revoke";
  revokeAt?: "token" | "userinfo"; rejectCode?: boolean; missingGoogleClient?: boolean;
  switchAtProviderFloor?: boolean; switchActorAtToken?: boolean;
  expireAtProviderFloor?: boolean;
  membershipStatus?: "active" | "revoked";
  mailboxClass?: "personal" | "shared_support"; mailboxOwner?: string;
  foreignConnector?: boolean; lookupErrorAt?: "own" | "collision" | "mailbox";
  nativeMode?: "refused" | "lost-ack" | "throw-ack" | "foreign-envelope";
  auditFailure?: "error" | "throw";
};

function fixture(options: Options = {}) {
  let active = options.active === undefined ? TENANT : options.active;
  const seat: Seat = options.seat === undefined ? "owner" : options.seat;
  let actorId = ACTOR;
  let membershipStatus = options.membershipStatus ?? "active";
  let timeOffset = 0;
  class FixtureDate extends Date { static now() { return Date.now() + timeOffset; } }
  const calls: { name: string; args?: unknown }[] = [];
  const writes: { table: string; value: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const provider: string[] = [];
  let codeUsed = false;
  const ok = (data: unknown) => ({ data, error: null });
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "has_role") return ok(Boolean(options.globalAdmin));
    if (name === "current_user_tenant_id") return options.scopeError ? { data: null, error: { message: "fixture" } } : ok(active);
    if (name === "is_tenant_admin_as") {
      return options.adminError ? { data: true, error: { message: "fixture" } }
        : ok(args?._actor === ACTOR && args?._tenant === TENANT && membershipStatus === "active"
          && ["owner", "admin"].includes(seat ?? ""));
    }
    if (name === "comms_provider_execution_allowed") {
      if (options.switchAtProviderFloor) active = OTHER;
      if (options.expireAtProviderFloor) timeOffset += 11 * 60 * 1000;
      return ok(options.providerAllowed !== false);
    }
    if (name === "get_user_primary_tenant") return ok([{ tenant_id: TENANT }]);
    if (name === "write_channel_secret") {
      writes.push({ table: "vault", value: args ?? {}, filters: {} });
      if (options.switchAt === "vault") active = OTHER;
      return ok(null);
    }
    if (name === "read_channel_secret") {
      if (options.switchAt === "secret-read") active = OTHER;
      return ok("fixture-refresh");
    }
    if (name === "provision_gmail_connection" || name === "disconnect_gmail_connection") {
      if (options.nativeMode === "refused") return { data: null, error: { message: "GMAIL_CONNECTION_FORBIDDEN", code: "42501" } };
      writes.push({ table: "native-transaction", value: { operation: name }, filters: {} });
      if (options.switchAt === "vault") active = OTHER;
      if (options.nativeMode === "throw-ack") throw new Error("fixture lost acknowledgement");
      if (options.nativeMode === "lost-ack") return { data: null, error: { message: "fixture acknowledgement lost" } };
      const tenantId = options.nativeMode === "foreign-envelope" ? OTHER : TENANT;
      return ok(name === "provision_gmail_connection"
        ? { ok: true, connection_saved: true, tenant_id: tenantId, connector_id: CONNECTOR,
          gmail_address: "fixture@example.invalid", reconnected: Boolean(options.connector),
          mailbox_class: options.mailboxClass ?? "personal" }
        : { ok: true, disconnected: true, tenant_id: tenantId, connector_id: CONNECTOR });
    }
    throw new Error(`Unexpected RPC ${name}`);
  };
  const client = {
    auth: { getUser: async () => {
      calls.push({ name: "auth.getUser" });
      return { data: { user: options.authenticated === false ? null : { id: actorId } }, error: null };
    } }, rpc,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let value: Record<string, unknown> | null = null;
      const result = () => {
        if (value) {
          writes.push({ table, value, filters: { ...filters } });
          if (table === "audit_logs" && options.auditFailure === "throw") throw new Error("fixture audit lost acknowledgement");
          if (table === "audit_logs" && options.auditFailure === "error") return { data: null, error: { message: "fixture audit unavailable" } };
          return ok(null);
        }
        if (table === "tenant_members") return ok(seat && filters.user_id === ACTOR && filters.tenant_id === TENANT
          ? { tenant_id: TENANT, role: seat, status: "active" } : null);
        if (table === "channel_connectors") {
          calls.push({ name: "connector-read", args: { ...filters } });
          if (options.switchAt === "connector-read") active = OTHER;
          if ((options.lookupErrorAt === "own" && filters.tenant_id)
            || (options.lookupErrorAt === "collision" && !filters.tenant_id && !filters.id)
            || (options.lookupErrorAt === "mailbox" && filters.id)) return { data: null, error: { message: "fixture lookup failed" } };
          if (options.foreignConnector && !filters.tenant_id && !filters.id) return ok({ id: "foreign-connector", tenant_id: OTHER });
          return ok(options.connector ? { id: CONNECTOR, tenant_id: TENANT,
            inbound_address: "fixture@example.invalid", credentials_vault_ref: `gmail_refresh_token:${TENANT}:fixture-google`,
            external_account_id: "fixture-google", updated_at: "2026-10-16T00:00:00.000000Z",
            mailbox_class: options.mailboxClass ?? "personal", mailbox_owner_user_id: options.mailboxOwner ?? ACTOR } : null);
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const builder = {
        select: () => builder, eq: (key: string, input: unknown) => { filters[key] = input; return builder; },
        update: (input: Record<string, unknown>) => { value = input; return builder; },
        insert: (input: Record<string, unknown>) => { value = input; return builder; },
        maybeSingle: async () => result(),
        then: (done: (input: ReturnType<typeof ok>) => unknown) => Promise.resolve(result()).then(done),
      };
      return builder;
    },
  };
  const providerFetch = async (url: string) => {
    provider.push(url);
    if (url === "https://oauth2.googleapis.com/token") {
      if (options.switchAt === "token") active = OTHER;
      if (options.revokeAt === "token") membershipStatus = "revoked";
      if (options.switchActorAtToken) actorId = OTHER;
      if (options.rejectCode || codeUsed) return Response.json({ error: "invalid_grant" }, { status: 400 });
      codeUsed = true;
      return Response.json({ refresh_token: "fixture-refresh", access_token: "fixture-access",
        scope: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels" });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
      if (options.switchAt === "userinfo") active = OTHER;
      if (options.revokeAt === "userinfo") membershipStatus = "revoked";
      return Response.json({ email: "fixture@example.invalid", sub: "fixture-google", name: "Fixture" });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      if (options.switchAt === "revoke") active = OTHER;
      return new Response("ok");
    }
    throw new Error(`Unapproved fixture URL ${url}`);
  };
  function load(file: string): Record<string, unknown> {
    const module = { exports: {} as Record<string, unknown> };
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText;
    runInNewContext(source, {
      module, exports: module.exports, require: (specifier: string) => specifier.startsWith("https:")
        ? { createClient: () => client } : load(resolve(dirname(file), specifier)),
      Deno: { env: { get: (key: string) => options.missingGoogleClient && key === "GOOGLE_OAUTH_CLIENT_ID" ? undefined : ENV[key] },
        serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; } },
      crypto: webcrypto, TextEncoder, Request, Response, URL, URLSearchParams, Date: FixtureDate, Uint8Array,
      btoa, atob, fetch: providerFetch, console: { error: () => undefined },
    }, { filename: file });
    return module.exports;
  }
  let handler: (req: Request) => Promise<Response>;
  async function run(name: string, body: Record<string, unknown> = {}) {
    load(resolve(`supabase/functions/${name}/index.ts`));
    const response = await handler!(new Request("https://unit-test.invalid", { method: "POST",
      headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  }
  return { run, calls, writes, provider, setActive: (tenant: string) => { active = tenant; } };
}

async function signedState(overrides: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({ u: ACTOR, w: TENANT, p: "inbox", n: "fixture-nonce",
    t: Date.now(), r: "https://paigeagent.ai", ...overrides })).toString("base64url");
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(ENV.CALENDAR_ENCRYPTION_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}
const callback = async (overrides: Record<string, unknown> = {}) => ({ code: "fixture-code",
  state: await signedState(), origin: "https://paigeagent.ai", ...overrides });

describe("Gmail connections use the existing current-workspace admin authority", () => {
  for (const seat of ["owner", "admin"] as const) {
    for (const purpose of ["send", "inbox"]) {
      it(`${seat} without global admin can request existing ${purpose} consent`, async () => {
        const f = fixture({ seat });
        const result = await f.run("gmail-oauth-start", { origin: "https://paigeagent.ai", purpose });
        expect(result.status).toBe(200);
        const url = new URL(result.body.authorization_url);
        const state = JSON.parse(Buffer.from(url.searchParams.get("state")!.split(".")[0], "base64url").toString());
        expect(state).toMatchObject({ u: ACTOR, w: TENANT, p: purpose });
        expect(url.searchParams.get("scope")).toContain(purpose === "inbox" ? "gmail.modify" : "gmail.send");
        expect(f.provider).toEqual([]);
        expect(f.calls.some(c => c.name === "has_role")).toBe(false);
        expect(f.calls.filter(c => c.name === "is_tenant_admin_as").every(c =>
          JSON.stringify(c.args) === JSON.stringify({ _actor: ACTOR, _tenant: TENANT }))).toBe(true);
      });
    }
    it(`${seat} without global admin completes the mocked exact-workspace callback`, async () => {
      const f = fixture({ seat });
      const result = await f.run("gmail-oauth-callback", await callback());
      expect(result.status).toBe(200);
      expect(result.body.ok).toBe(true);
      expect(f.calls.find(c => c.name === "provision_gmail_connection")?.args).toMatchObject({
        _expected_tenant_id: TENANT, _actor_user_id: ACTOR, _purpose: "inbox", _google_account_id: "fixture-google" });
      expect(f.writes.filter(w => w.table === "native-transaction")).toHaveLength(1);
      expect(f.writes.filter(w => w.table === "audit_logs")).toHaveLength(1);
    });
    it(`${seat} without global admin disconnects only the existing workspace connector`, async () => {
      const f = fixture({ seat, connector: true });
      const result = await f.run("gmail-disconnect");
      expect(result).toMatchObject({ status: 200, body: { ok: true, disconnected: true } });
      expect(f.calls.find(c => c.name === "disconnect_gmail_connection")?.args).toMatchObject({
        _expected_tenant_id: TENANT, _actor_user_id: ACTOR, _connector_id: CONNECTOR,
        _expected_updated_at: "2026-10-16T00:00:00.000000Z" });
      expect(f.calls.some(c => c.name === "write_channel_secret")).toBe(false);
    });
  }
  for (const [label, options] of [
    ["global admin with member seat", { globalAdmin: true, seat: "member" }],
    ["missing seat", { globalAdmin: true, seat: null }],
    ["revoked owner seat", { globalAdmin: true, seat: "owner", membershipStatus: "revoked" }],
    ["foreign active workspace", { globalAdmin: true, active: OTHER }],
    ["missing active workspace", { globalAdmin: true, active: null }],
    ["unavailable scope", { scopeError: true }], ["errored positive authority", { adminError: true }],
    ["unauthenticated", { authenticated: false }],
  ] as [string, Options][]) {
    for (const name of ["gmail-oauth-start", "gmail-oauth-callback", "gmail-disconnect"]) {
      it(`${name} refuses ${label} before provider or writes`, async () => {
        const f = fixture({ ...options, connector: true });
        const result = await f.run(name, name.endsWith("callback") ? await callback() : { origin: "https://paigeagent.ai" });
        expect(result.status).toBeGreaterThanOrEqual(400);
        expect(f.provider).toEqual([]);
        expect(f.writes).toEqual([]);
      });
    }
  }
  for (const [label, overrides] of [
    ["foreign signed workspace", { w: OTHER }], ["missing signed workspace", { w: null }],
    ["different signed actor", { u: OTHER }], ["expired state", { t: Date.now() - 11 * 60 * 1000 }],
    ["invalid expiry", { t: "invalid" }], ["future state", { t: Date.now() + 60 * 1000 }],
  ] as [string, Record<string, unknown>][]) {
    it(`callback refuses ${label} before exchange`, async () => {
      const f = fixture({ globalAdmin: true });
      const result = await f.run("gmail-oauth-callback", await callback({ state: await signedState(overrides) }));
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
    });
  }
  for (const name of ["gmail-oauth-start", "gmail-disconnect"]) {
    for (const expected of [OTHER, null, "invalid"]) {
      it(`${name} refuses mismatched or invalid expected tenant ${String(expected)} before effects`, async () => {
        const f = fixture({ connector: true });
        expect((await f.run(name, { origin: "https://paigeagent.ai", expected_tenant_id: expected })).status).toBe(409);
        expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
      });
    }
    it(`${name} accepts a matching uppercase expected UUID without selecting another target`, async () => {
      const f = fixture({ connector: true });
      expect((await f.run(name, { origin: "https://paigeagent.ai", expected_tenant_id: TENANT.toUpperCase() })).status).toBe(200);
      expect(f.writes.filter(w => w.table === "channel_connectors").every(w => w.filters.tenant_id === TENANT)).toBe(true);
    });
  }
  it("callback refuses an origin different from its signed consent origin", async () => {
    const f = fixture();
    expect((await f.run("gmail-oauth-callback", await callback({ origin: "https://other.invalid" }))).body.error).toBe("state_origin_mismatch");
    expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
  });
  it("callback rechecks expiry after an awaited provider-floor read before exchange", async () => {
    const f = fixture({ expireAtProviderFloor: true });
    expect((await f.run("gmail-oauth-callback", await callback())).body.error).toBe("state_expired");
    expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
  });
  for (const name of ["gmail-oauth-start", "gmail-oauth-callback", "gmail-disconnect"]) {
    it(`${name} retires a workspace change while awaiting the provider authority floor`, async () => {
      const f = fixture({ switchAtProviderFloor: true, connector: true });
      const result = await f.run(name, name.endsWith("callback") ? await callback() : { origin: "https://paigeagent.ai" });
      expect(result.status).toBe(409); expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
    });
  }
  it("callback requires the original authenticated actor again after the exchange", async () => {
    const f = fixture({ switchActorAtToken: true });
    expect((await f.run("gmail-oauth-callback", await callback())).status).toBe(401);
    expect(f.provider).toEqual(["https://oauth2.googleapis.com/token"]); expect(f.writes).toEqual([]);
  });
  it("callback withholds private details while preserving saved truth after native commit and workspace change", async () => {
    const f = fixture({ switchAt: "vault" });
    const result = await f.run("gmail-oauth-callback", await callback());
    expect(result.status).toBe(409);
    expect(f.writes.map(w => w.table)).toEqual(["native-transaction", "audit_logs"]);
    expect(result.body.connection_saved).toBe(true); expect(result.body.gmail_address).toBeUndefined();
    expect(result.body.ok).toBeUndefined();
  });
  it("invalid state is refused, and a replayed provider code cannot make another connector", async () => {
    const f = fixture({ globalAdmin: true });
    const invalid = await f.run("gmail-oauth-callback", await callback({ state: "invalid" }));
    expect(invalid.status).toBe(400); expect(f.provider).toEqual([]);
    const body = await callback();
    expect((await f.run("gmail-oauth-callback", body)).status).toBe(200);
    const count = f.writes.length;
    expect((await f.run("gmail-oauth-callback", body)).body.error).toBe("token_exchange_failed");
    expect(f.writes).toHaveLength(count);
  });
  for (const switchAt of ["token", "userinfo", "connector-read"] as const) {
    it(`callback retires changed workspace during ${switchAt} before subsequent writes`, async () => {
      const f = fixture({ globalAdmin: true, switchAt });
      const result = await f.run("gmail-oauth-callback", await callback());
      expect(result.status).toBe(409);
      expect(f.writes.filter(w => w.table === "channel_connectors" || w.table === "audit_logs")).toEqual([]);
      expect(f.writes).toEqual([]);
    });
  }
  it("disconnect preserves committed local result if scope changes during later best-effort Google revocation", async () => {
    const f = fixture({ connector: true, switchAt: "revoke" });
    const result = await f.run("gmail-disconnect");
    expect(result.status).toBe(409); expect(result.body.disconnected).toBe(true);
    expect(f.provider).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(f.writes.map(w => w.table)).toEqual(["native-transaction", "audit_logs"]);
  });
  for (const revokeAt of ["token", "userinfo"] as const) {
    it(`callback refuses authority revoked during ${revokeAt} before credential persistence`, async () => {
      const f = fixture({ globalAdmin: true, revokeAt });
      expect((await f.run("gmail-oauth-callback", await callback())).status).toBe(403);
      expect(f.writes).toEqual([]);
    });
  }
  for (const switchAt of ["connector-read", "secret-read"] as const) {
    it(`disconnect retires changed workspace during ${switchAt} before credential/provider effects`, async () => {
      const f = fixture({ globalAdmin: true, connector: true, switchAt });
      expect((await f.run("gmail-disconnect")).status).toBe(409);
      expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
    });
  }
  it("keeps configuration and provider restriction failures distinct", async () => {
    const unconfigured = fixture({ missingGoogleClient: true });
    expect((await unconfigured.run("gmail-oauth-start", { origin: "https://paigeagent.ai" })).body.error).toBe("gmail_oauth_not_configured");
    const held = fixture({ providerAllowed: false });
    expect((await held.run("gmail-oauth-start", { origin: "https://paigeagent.ai" })).body.error).toBe("COMMS_PROVIDER_EXECUTION_DISABLED");
    expect(held.provider).toEqual([]); expect(held.writes).toEqual([]);
  });
  for (const [label, options, purpose] of [
    ["another person's personal inbox", { connector: true, mailboxOwner: OTHER }, "inbox"],
    ["another person's personal inbox sending consent", { connector: true, mailboxOwner: OTHER }, "send"],
    ["workspace shared mailbox inbox consent", { connector: true, mailboxClass: "shared_support" }, "inbox"],
    ["foreign connector collision", { foreignConnector: true }, "inbox"],
    ["incomplete own lookup", { lookupErrorAt: "own" }, "inbox"],
    ["incomplete collision lookup", { lookupErrorAt: "collision" }, "inbox"],
  ] as [string, Options, string][]) {
    it(`callback refuses ${label} before any Vault or connector mutation`, async () => {
      const f = fixture(options);
      const result = await f.run("gmail-oauth-callback", await callback({ state: await signedState({ p: purpose }) }));
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(f.writes).toEqual([]);
    });
  }
  it("preserves idempotent absent-connector disconnect", async () => {
    const f = fixture();
    expect((await f.run("gmail-disconnect")).body).toEqual({ ok: true, disconnected: false });
    expect(f.provider).toEqual([]); expect(f.writes).toEqual([]);
  });
  for (const name of ["gmail-oauth-callback", "gmail-disconnect"]) {
    it(`${name} preserves a known native authority refusal without effect or retry`, async () => {
      const f = fixture({ connector: true, nativeMode: "refused" });
      const result = await f.run(name, name.endsWith("callback") ? await callback() : {});
      expect(result.status).toBeGreaterThanOrEqual(400); expect(f.writes).toEqual([]);
      expect(f.calls.filter(c => c.name === "provision_gmail_connection" || c.name === "disconnect_gmail_connection")).toHaveLength(1);
      expect(f.calls.some(c => c.name === "write_channel_secret")).toBe(false);
      if (name === "gmail-disconnect") expect(f.provider).toEqual([]);
    });
    for (const nativeMode of ["lost-ack", "throw-ack", "foreign-envelope"] as const) {
      it(`${name} never retries an uncertain ${nativeMode} native transaction or invents success`, async () => {
        const f = fixture({ connector: true, nativeMode });
        const result = await f.run(name, name.endsWith("callback") ? await callback() : {});
        expect(result.status).toBe(503); expect(result.body.ok).toBeUndefined();
        expect(result.body.gmail_address).toBeUndefined();
        expect(f.calls.filter(c => c.name === "provision_gmail_connection" || c.name === "disconnect_gmail_connection")).toHaveLength(1);
        expect(f.writes.filter(w => w.table === "native-transaction")).toHaveLength(1);
      });
    }
    for (const auditFailure of ["error", "throw"] as const) {
      it(`${name} retains verified completion when the later audit ${auditFailure} is unconfirmed`, async () => {
        const f = fixture({ connector: true, auditFailure });
        const result = await f.run(name, name.endsWith("callback") ? await callback() : {});
        expect(result.status).toBe(200); expect(result.body.ok).toBe(true); expect(result.body.audit_confirmed).toBe(false);
        expect(f.writes.filter(w => w.table === "native-transaction")).toHaveLength(1);
      });
    }
  }
});
