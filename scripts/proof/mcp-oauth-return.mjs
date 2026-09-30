#!/usr/bin/env node
// Local-only regression proof. The real callback runs with an in-memory state/grant adapter;
// neither the provider nor Supabase is contacted. SQL atomicity is a separate proof obligation.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";

const outfile = path.resolve("node_modules/.cache/mcp-oauth-return/callback.mjs");
await build({ entryPoints: ["supabase/functions/_shared/mcp-gateway/oauth-callback.ts"], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
const { runOauthCallback } = await import(pathToFileURL(outfile).href);
const origin = "https://paigeagent.ai";
const state = "test-state-not-a-credential";
const connection = "10000000-0000-4000-8000-000000000001";
const pending = {
  found: true, state, state_id: "10000000-0000-4000-8000-000000000002",
  tenant_id: "test-tenant-one", connection_id: connection,
  issuer: "https://provider.example", client_id: "test-client",
  redirect_uri: "https://callback.example/oauth", resource: "https://provider.example/mcp",
  code_verifier: "test-verifier-not-a-credential", client_secret: null,
  return_destination: "integrations", account_type: "solo", account_number: "10000001",
  requested_scopes: ["records.read"], actor: "test-owner", config_generation: 4,
};
const cases = [];
const check = (name, run) => cases.push({ name, run });
function harness(overrides = {}) {
  let consumed = false;
  const calls = { consume: 0, exchange: [], grant: [] };
  const deps = {
    admin: { rpc: async (fn, args) => {
      if (fn === "consume_mcp_oauth_state") {
        calls.consume++;
        if (consumed) return { data: { found: false }, error: null };
        consumed = true;
        return { data: { ...pending, ...overrides.pending }, error: overrides.consumeError ?? null };
      }
      if (fn === "complete_mcp_oauth_grant") {
        calls.grant.push(args);
        return { data: { connection_id: connection, status: "pending_verification", account_type: "solo", account_number: "10000001" }, error: overrides.grantError ?? null };
      }
      throw new Error(`Unexpected RPC ${fn}`);
    } },
    ops: {
      discoverAuthorizationServer: async () => ({ issuer: pending.issuer, scopesSupported: ["records.read", "records.delete"] }),
      exchangeCode: async (args) => {
        calls.exchange.push(args);
        if (overrides.exchangeError) throw new Error("provider text must remain private");
        return { accessToken: "test-access-not-a-credential", refreshToken: null, scopes: ["records.read"], expiresAt: null };
      },
    },
  };
  return { calls, run: (query = {}) => runOauthCallback(deps, { code: "test-code", state, error: null, ...query }, { appOrigin: origin }) };
}
function clean(result) {
  const url = new URL(result.location);
  assert.equal(result.status, 302);
  for (const key of ["code", "state", "access_token", "refresh_token"]) assert.equal(url.searchParams.has(key), false);
  for (const value of [state, pending.code_verifier, "test-access-not-a-credential", "provider text"]) assert.equal(result.location.includes(value), false);
  return url;
}
check("success returns to the stored Integrations owner without asserting provider readiness", async () => {
  const h = harness(); const url = clean(await h.run());
  assert.equal(url.pathname, "/solo/10000001/settings/integrations");
  assert.equal(url.searchParams.get("mcp"), "connected");
  assert.equal(url.searchParams.get("connection"), connection);
  assert.equal(h.calls.grant[0]._state_id, pending.state_id);
  assert.equal(h.calls.grant[0]._actor, pending.actor);
});
check("preserves existing non-Solo Connections returns without inventing Integrations routes", async () => {
  for (const [tier, prefix] of [["agency", "agency"], ["sub_account", "business"]]) {
    const url=clean(await harness({pending:{account_type:tier,return_destination:"connections"}}).run());
    assert.equal(url.pathname,`/${prefix}/10000001/calendar/connections`);
  }
});
check("rejects invalid tier/destination pairs and unmounted tiers before exchange", async () => {
  for (const [tier,destination] of [["solo","connections"],["agency","integrations"],["enterprise","connections"],["operator","integrations"]]) {
    const h=harness({pending:{account_type:tier,return_destination:destination}});
    assert.equal(clean(await h.run()).pathname,"/auth");
    assert.equal(h.calls.exchange.length,0);
  }
});
check("cancellation consumes valid state once and returns without exchange or grant", async () => {
  const h = harness(); const url = clean(await h.run({ code: null, error: "access_denied" }));
  assert.equal(url.pathname, "/solo/10000001/settings/integrations");
  assert.equal(url.searchParams.get("mcp"), "cancelled");
  assert.equal(h.calls.consume, 1); assert.equal(h.calls.exchange.length, 0); assert.equal(h.calls.grant.length, 0);
  assert.equal(clean(await h.run()).searchParams.get("mcp_detail"), "state_invalid");
});
check("post-consent failures retain the safe Integrations recovery route", async () => {
  for (const opts of [{ exchangeError: true }, { grantError: { message: "private database detail" } }]) {
    const url = clean(await harness(opts).run());
    assert.equal(url.pathname, "/solo/10000001/settings/integrations");
    assert.equal(url.searchParams.get("mcp"), "error");
    assert.equal(url.toString().includes("private database"), false);
  }
});
check("provider failures are not mislabeled as owner cancellation", async () => {
  const h = harness(); const url = clean(await h.run({ code: null, error: "server_error" }));
  assert.equal(url.searchParams.get("mcp"), "error");
  assert.equal(url.searchParams.get("mcp_detail"), "authorization_failed");
  assert.equal(h.calls.exchange.length, 0); assert.equal(h.calls.grant.length, 0);
});
check("requested scopes are frozen at begin rather than re-read from changed discovery", async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.calls.exchange[0].requestedScopes, ["records.read"]);
});
check("unknown, expired, replayed and store-error cancellation state has identical refusal", async () => {
  const results = [];
  for (const opts of [{ pending: { found: false } }, { pending: { state: "different" } }, { consumeError: { message: "private database detail" } }]) {
    const h = harness(opts); results.push(clean(await h.run({ code: null, error: "access_denied" })).toString());
    assert.equal(h.calls.exchange.length, 0); assert.equal(h.calls.grant.length, 0);
  }
  assert.equal(new Set(results).size, 1);
  assert.equal(new URL(results[0]).searchParams.get("mcp_detail"), "state_invalid");
});
check("missing or non-allowlisted saved return context fails closed before provider contact", async () => {
  for (const patch of [{ return_destination: undefined }, { return_destination: "https://evil.example" }, { actor: null }, { state_id: null }, { config_generation: null }, { requested_scopes: null }]) {
    const h = harness({ pending: patch }); const url = clean(await h.run());
    assert.equal(url.pathname, "/auth"); assert.equal(url.searchParams.get("mcp_detail"), "state_invalid");
    assert.equal(h.calls.exchange.length, 0); assert.equal(h.calls.grant.length, 0);
  }
});
check("browser route, account and connection hints cannot retarget the callback", async () => {
  const url = clean(await harness().run({ return_to: "https://evil.example", account: "10000002", connection: "different" }));
  assert.equal(url.pathname, "/solo/10000001/settings/integrations");
  assert.equal(url.searchParams.get("connection"), connection);
});
check("concurrent callbacks exchange and grant at most once with atomic state adapter", async () => {
  const h = harness(); const results = await Promise.all([h.run(), h.run()]);
  assert.equal(h.calls.exchange.length, 1); assert.equal(h.calls.grant.length, 1);
  assert.equal(results.filter(r => r.outcome === "state_invalid").length, 1);
});
let failed = 0;
for (const c of cases) {
  try { await c.run(); console.log(`PASS ${c.name}`); }
  catch (e) { failed++; console.error(`FAIL ${c.name}: ${e.message}`); }
}
console.log(`${cases.length - failed}/${cases.length} passed; provider and database runtime UNVERIFIED`);
process.exitCode = failed ? 1 : 0;
