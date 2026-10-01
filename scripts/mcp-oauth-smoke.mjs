#!/usr/bin/env node
/**
 * OAuth 2.1 for a tenant's MCP provider — driven against a real server.
 *
 * The properties here are the ones whose absence is silent: a `plain` PKCE challenge still
 * completes a connection, a `state` that is never compared still completes a connection,
 * an authorization server that claims someone else's identity still completes a
 * connection. Each of those is a working integration and a broken one at the same time,
 * which is why none of them can be left to a code reading.
 *
 * Only DNS and address translation are substituted (this runs under Node, and the servers
 * are local). The discovery, registration, exchange, refresh and revocation paths are the
 * shipped code, talking real HTTP.
 */
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

globalThis.Deno = {
  resolveDns: async (host) => (host.endsWith(".example") ? ["93.184.216.34"] : (() => { throw new Error("no records"); })()),
  env: { get: () => undefined },
};

// Two hosts, so "the endpoint belongs to the issuer" is testable rather than assumed.
const HOSTS = { "as.example": null, "evil.example": null, "mcp.example": null };
const routes = new Map();
let PORT;
await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const host = (req.headers["x-forwarded-host"] || "as.example").toString();
    const key = `${host}${req.url.split("?")[0]}`;
    const handler = routes.get(key);
    if (!handler) { res.writeHead(404, { "Content-Type": "application/json" }).end("{}"); return; }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => handler(req, res, body));
  });
  server.listen(0, "127.0.0.1", () => { PORT = server.address().port; HOSTS.server = server; resolve(); });
});
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = new URL(url);
  return realFetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), "x-forwarded-host": u.host },
  });
};

const outfile = path.join(process.cwd(), "node_modules", ".cache", "mcp-oauth-smoke", "oauth.mjs");
await build({ entryPoints: ["supabase/functions/_shared/mcp-oauth.ts"], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
const oauth = await import(pathToFileURL(outfile).href);

let passed = 0;
const failures = [];
const check = (label, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  FAIL ${label} ${detail}`); }
};
const codeOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.code ?? e.message; } };
const json = (res, body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

const ISSUER = "https://as.example";
const RESOURCE_SERVER = "https://mcp.example/mcp";
const REDIRECT = "https://app.example/oauth/callback";

const goodMetadata = (over = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  registration_endpoint: `${ISSUER}/register`,
  revocation_endpoint: `${ISSUER}/revoke`,
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["mcp:tools"],
  ...over,
});

console.log("\nMCP OAuth 2.1\n");
console.log("— discovery —");

routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) => json(res, goodMetadata()));
routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) =>
  json(res, { resource: RESOURCE_SERVER, authorization_servers: [ISSUER] }));

{
  const pr = await oauth.discoverProtectedResource(RESOURCE_SERVER);
  check("the MCP server names its own authorization server", pr.authorizationServers[0] === ISSUER);
  check("...and the resource it protects, for binding the token", pr.resource === RESOURCE_SERVER);

  const server = await oauth.discoverAuthorizationServer(ISSUER);
  check("the authorization server's endpoints are discovered, not guessed",
    server.tokenEndpoint === `${ISSUER}/token` && server.authorizationEndpoint === `${ISSUER}/authorize`);
}

// A resource's permissions are not the authorization server's global catalogue.
routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) =>
  json(res, { resource: RESOURCE_SERVER, authorization_servers: [ISSUER], scopes_supported: ["records.read"] }));
{
  const pr = await oauth.discoverProtectedResource(RESOURCE_SERVER);
  check("resource discovery retains its own scope set", JSON.stringify(pr.scopesSupported) === '["records.read"]');
}
routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) =>
  json(res, { resource: RESOURCE_SERVER, authorization_servers: [ISSUER] }));
check("absent resource scopes are explicitly empty, never AS-wide permissions",
  JSON.stringify((await oauth.discoverProtectedResource(RESOURCE_SERVER)).scopesSupported) === "[]");

const resourceMetadata = { resource: RESOURCE_SERVER, authorization_servers: [ISSUER], scopes_supported: ["records.read"] };
routes.set("mcp.example/metadata", (_q, res) => json(res, resourceMetadata));
const challenge = value => routes.set("mcp.example/mcp", (_q, res) => {
  res.writeHead(401, { "WWW-Authenticate": value }).end();
});
challenge('Basic realm="private, service", Bearer resource_metadata="https://mcp.example/metadata", scope="records.write"');
{
  const pr = await oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true });
  check("challenge chooses the advertised metadata URL", JSON.stringify(pr.scopesSupported) === '["records.read"]');
  check("challenge scopes remain authoritative even outside metadata scopes", JSON.stringify(pr.challengeScopes) === '["records.write"]');
}
challenge('Bearer resource_metadata="https://mcp.example/metadata"');
check("absent challenge scope allows resource scope fallback",
  (await oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true })).challengeScopes === null);
for (const resource of [undefined, "https://unrelated.example/api"]) {
  routes.set("mcp.example/metadata", (_q, res) => json(res, { ...resourceMetadata, resource }));
  check("challenge metadata cannot omit or retarget the requested resource",
    await codeOf(() => oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true })) === "malformed_metadata");
}
routes.set("mcp.example/metadata", (_q, res) => json(res, resourceMetadata));
challenge('Bearer resource_metadata="https://127.0.0.1/private", scope="records.read"');
check("a private challenge metadata URL is refused before fetching",
  await codeOf(() => oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true })) === "discovery_failed");
for (const value of [
  'Bearer scope="records.read", scope="records.write"',
  'Bearer scope="records.read", Bearer scope="records.write"',
  'Bearer scope="unterminated',
  'Bearer scope=""',
]) {
  challenge(value);
  check("ambiguous or malformed challenge is refused without permission guessing",
    await codeOf(() => oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true })) === "malformed_metadata");
}
routes.delete("mcp.example/mcp");
routes.set("mcp.example/mcp", (_q, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.flushHeaders(); // A real GET stream is allowed to stay open indefinitely.
});
{
  const started = Date.now();
  let streamingResource;
  try { streamingResource = await oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true }); } catch {}
  check("an open SSE response does not stall OAuth metadata discovery", !!streamingResource && Date.now() - started < 3000);
}
routes.delete("mcp.example/mcp");
routes.delete("mcp.example/.well-known/oauth-protected-resource/mcp");
routes.set("mcp.example/.well-known/oauth-protected-resource", (_q, res) => json(res, resourceMetadata));
check("explicit OAuth discovery falls back from missing path metadata to root",
  JSON.stringify((await oauth.discoverProtectedResource(RESOURCE_SERVER, { requestChallenge: true })).scopesSupported) === '["records.read"]');
check("specialized resource-only discovery retains its existing no-root-fallback behavior",
  await codeOf(() => oauth.discoverProtectedResource(RESOURCE_SERVER)) === "discovery_failed");
routes.delete("mcp.example/.well-known/oauth-protected-resource");
routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) => json(res, resourceMetadata));
for (const value of [null, "records.read", ["records.read", 1], ["records.read records.write"]]) {
  routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) => json(res, { ...resourceMetadata, scopes_supported: value }));
  check("malformed resource scopes are refused, not silently filtered",
    await codeOf(() => oauth.discoverProtectedResource(RESOURCE_SERVER)) === "malformed_metadata");
}
routes.set("mcp.example/.well-known/oauth-protected-resource/mcp", (_q, res) => json(res, { resource: RESOURCE_SERVER, authorization_servers: [ISSUER] }));

// The check that makes discovery meaningful: a server may not claim another's identity.
routes.set("evil.example/.well-known/oauth-authorization-server", (_q, res) => json(res, goodMetadata()));
check("a server claiming someone else's issuer is refused",
  await codeOf(() => oauth.discoverAuthorizationServer("https://evil.example")) === "issuer_mismatch");

// A hostile metadata document pointing the token request — which carries the code and the
// verifier — at a host of its choosing.
routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) =>
  json(res, goodMetadata({ token_endpoint: "https://evil.example/token" })));
check("an endpoint outside the issuer's own origin is refused",
  await codeOf(() => oauth.discoverAuthorizationServer(ISSUER)) === "malformed_metadata");

routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) =>
  json(res, goodMetadata({ registration_endpoint: "https://evil.example/register" })));
check("...including the registration endpoint",
  await codeOf(() => oauth.discoverAuthorizationServer(ISSUER)) === "malformed_metadata");

routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) =>
  json(res, goodMetadata({ code_challenge_methods_supported: ["plain"] })));
check("a server that offers only `plain` PKCE is refused",
  await codeOf(() => oauth.discoverAuthorizationServer(ISSUER)) === "pkce_unsupported");

routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) =>
  json(res, goodMetadata({ code_challenge_methods_supported: undefined })));
check("a server that does not say whether it supports S256 is refused, not assumed capable",
  await codeOf(() => oauth.discoverAuthorizationServer(ISSUER)) === "pkce_unsupported");

routes.set("as.example/.well-known/oauth-authorization-server", (_q, res) => json(res, goodMetadata()));
check("an unreachable discovery document fails closed",
  await codeOf(() => oauth.discoverAuthorizationServer("https://nowhere.example")) === "discovery_failed");
check("a private address is never contacted for discovery",
  await codeOf(() => oauth.discoverAuthorizationServer("https://10.0.0.5")) === "discovery_failed");

console.log("\n— PKCE and state —");
{
  const a = await oauth.createPkce();
  const b = await oauth.createPkce();
  check("the method is S256 and is not a parameter", a.method === "S256");
  check("the verifier meets the RFC's minimum length", a.verifier.length >= 43 && a.verifier.length <= 128);
  check("the verifier is base64url with no padding", /^[A-Za-z0-9\-_]+$/.test(a.verifier));
  check("two verifiers are never the same", a.verifier !== b.verifier);
  // The challenge is checked against an INDEPENDENT implementation. A self-consistent
  // wrong transform would pass a round-trip test and fail against every real server.
  const expected = createHash("sha256").update(a.verifier).digest("base64url");
  check("the challenge is SHA-256 of the verifier, base64url", a.challenge === expected, a.challenge);
  check("the challenge is not merely the verifier (which is what `plain` would be)", a.challenge !== a.verifier);

  const s1 = oauth.createState(), s2 = oauth.createState();
  check("state has real entropy and does not repeat", s1 !== s2 && s1.length >= 43);
  check("a matching state compares equal", oauth.statesMatch(s1, s1));
  check("a differing state does not", !oauth.statesMatch(s1, s2));
  check("a state differing only in length does not", !oauth.statesMatch(s1, s1 + "x"));
  check("a prefix of the state does not match", !oauth.statesMatch(s1, s1.slice(0, -1)));
  for (const junk of [null, undefined, 0, {}, []]) {
    check(`a non-string state (${JSON.stringify(junk) ?? "undefined"}) does not match`, !oauth.statesMatch(s1, junk));
  }
}

console.log("\n— the consent URL —");
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  const pkce = await oauth.createPkce();
  const state = oauth.createState();
  const url = new URL(oauth.buildAuthorizationUrl({
    server, clientId: "client-123", redirectUri: REDIRECT, state,
    challenge: pkce.challenge, scopes: ["mcp:tools"], resource: RESOURCE_SERVER,
  }));
  check("the consent URL carries the S256 challenge", url.searchParams.get("code_challenge_method") === "S256");
  check("...and never the verifier", !url.toString().includes(pkce.verifier));
  check("...and binds the token to this resource", url.searchParams.get("resource") === RESOURCE_SERVER);
  check("...and is at the discovered authorization endpoint", url.origin + url.pathname === `${ISSUER}/authorize`);
  const defaultUrl = new URL(oauth.buildAuthorizationUrl({
    server: { ...server, authorizationEndpoint: `${ISSUER}/authorize?scope=admin&audience=preserved` },
    clientId: "client-123", redirectUri: REDIRECT, state, challenge: pkce.challenge,
    scopes: [], resource: RESOURCE_SERVER,
  }));
  check("omitted scope cannot inherit a permission from the authorization endpoint query", !defaultUrl.searchParams.has("scope"));
  check("unrelated provider endpoint query parameters are preserved", defaultUrl.searchParams.get("audience") === "preserved");
}

console.log("\n— registration, exchange, refresh, revoke —");

let lastForm = null;
routes.set("as.example/register", (_q, res, body) => {
  lastForm = JSON.parse(body);
  json(res, { client_id: "client-abc" }, 201);
});
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  const reg = await oauth.registerClient({ server, redirectUri: REDIRECT, clientName: "Paige" });
  check("the client is registered per workspace", reg.clientId === "client-abc");
  check("...as a public client, so no platform secret is created", lastForm.token_endpoint_auth_method === "none");
  check("...with exactly the redirect we will use", JSON.stringify(lastForm.redirect_uris) === JSON.stringify([REDIRECT]));
  check("no secret is invented when the server issues none", reg.clientSecret === null);
}

routes.set("as.example/token", (_q, res, body) => {
  lastForm = Object.fromEntries(new URLSearchParams(body));
  if (lastForm.grant_type === "authorization_code") {
    return json(res, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "mcp:tools" });
  }
  // Rotation: the old refresh token is dead after this.
  return json(res, { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 });
});
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  const pkce = await oauth.createPkce();
  const tokens = await oauth.exchangeCode({
    server, clientId: "client-abc", clientSecret: null, redirectUri: REDIRECT,
    code: "auth-code", verifier: pkce.verifier, resource: RESOURCE_SERVER,
  });
  check("the exchange sends the verifier, proving we began the flow", lastForm.code_verifier === pkce.verifier);
  check("...and the resource, so the token cannot be replayed elsewhere", lastForm.resource === RESOURCE_SERVER);
  check("...and returns an access and refresh token", tokens.accessToken === "at-1" && tokens.refreshToken === "rt-1");
  check("...with an absolute expiry rather than a duration", !!tokens.expiresAt && !Number.isNaN(Date.parse(tokens.expiresAt)));

  const rotated = await oauth.refreshTokens({
    server, clientId: "client-abc", clientSecret: null, refreshToken: "rt-1", resource: RESOURCE_SERVER,
  });
  check("a refresh returns the ROTATED refresh token, which must replace the old one",
    rotated.refreshToken === "rt-2" && rotated.accessToken === "at-2");

  // RFC 6749 5.1: `scope` is OPTIONAL in a token response when it is identical to what
  // was requested -- and this route deliberately omits it, as a refresh_token grant
  // commonly does. Reading that as ZERO scopes made every downstream scope assertion
  // fail, the caller revoked the token it had just been issued, and the provider had
  // already killed the old refresh token by rotating it. The connection could then never
  // refresh again and only a full re-authorization brought it back -- once per token
  // lifetime, indefinitely.
  check("an omitted scope on refresh means UNCHANGED, not none",
    (await oauth.refreshTokens({
      server, clientId: "client-abc", clientSecret: null, refreshToken: "rt-1",
      resource: RESOURCE_SERVER, grantedScopes: ["mcp:tools", "mcp:read"],
    })).scopes.join(" ") === "mcp:tools mcp:read");
  check("...and a caller that names no scopes still gets none, rather than a guess",
    rotated.scopes.length === 0);

  // The security half: an omission is filled in, a DISAGREEMENT never is.
  routes.set("as.example/token", (_q, res) => json(res, { access_token: "at-3", expires_in: 3600, scope: "mcp:admin" }));
  check("a scope the server actually states is never overridden by what we asked for",
    (await oauth.refreshTokens({
      server, clientId: "c", clientSecret: null, refreshToken: "rt-2",
      resource: RESOURCE_SERVER, grantedScopes: ["mcp:tools"],
    })).scopes.join(" ") === "mcp:admin");

  routes.set("as.example/token", (_q, res) => json(res, { access_token: "at-4", expires_in: 3600, scope: "" }));
  check("an explicitly EMPTY scope is the server saying none, and stays none",
    (await oauth.refreshTokens({
      server, clientId: "c", clientSecret: null, refreshToken: "rt-2",
      resource: RESOURCE_SERVER, grantedScopes: ["mcp:tools"],
    })).scopes.length === 0);

  // Only the KEY'S ABSENCE carries the RFC's "identical to requested". A present-but-
  // malformed scope is a broken response, and reading it as agreement would record
  // privileges the response never established -- in the n8n exchange path, write and
  // execute scopes that the discovery probe cannot verify, because it only ever calls
  // search_workflows. Raised by Codex on this PR; taken as the safer reading.
  for (const [label, value] of [["a number", 42], ["an array", ["mcp:tools"]], ["an explicit null", null]]) {
    routes.set("as.example/token", (_q, res) => json(res, { access_token: "at-5", expires_in: 3600, scope: value }));
    check(`a scope that is ${label} is malformed, not agreement`,
      await codeOf(() => oauth.refreshTokens({
        server, clientId: "c", clientSecret: null, refreshToken: "rt-2",
        resource: RESOURCE_SERVER, grantedScopes: ["mcp:tools"],
      })) === "malformed_token_response");
  }
}

routes.set("as.example/token", (_q, res) => json(res, { error: "invalid_grant", error_description: "token rt-1 for user bob@corp" }, 400));
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  const err = await codeOf(() => oauth.refreshTokens({ server, clientId: "c", clientSecret: null, refreshToken: "rt-1", resource: RESOURCE_SERVER }));
  check("a rejected refresh reports a stable code", err === "refresh_failed");
}
{
  // The property that matters most: an authorization server's error body is where tokens
  // and user identifiers live, and it must not survive into anything we carry or log.
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  let thrown;
  try { await oauth.refreshTokens({ server, clientId: "c", clientSecret: null, refreshToken: "rt-1", resource: RESOURCE_SERVER }); }
  catch (e) { thrown = e; }
  const surface = `${thrown?.message}|${thrown?.stack}|${JSON.stringify(thrown)}|${thrown?.providerError}`;
  check("no token or user identifier from the error body survives into the thrown error",
    !surface.includes("rt-1") && !surface.includes("bob@corp"));

  // ...but the RFC 6749 5.2 CODE does, and only the code. Without it, "the user revoked
  // us at the provider" and "the network hiccuped" are the same event, so a connection
  // gets discarded for a stumble. That is the whole reason connections did not stick.
  check("the provider's own error CODE survives, so a revocation is distinguishable",
    thrown?.providerError === "invalid_grant" && oauth.isGrantWithdrawn(thrown));
  check("...and the free-text description beside it does not",
    thrown?.providerError === "invalid_grant" && !surface.includes("token rt-1 for user"));
}

{
  // An error code we do not recognise is not carried at all: the allowlist is what keeps
  // this from becoming a second, quieter channel for provider prose.
  routes.set("as.example/token", (_q, res) => json(res, { error: "please email admin@corp for token rt-9", error_description: "x" }, 400));
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  let thrown;
  try { await oauth.refreshTokens({ server, clientId: "c", clientSecret: null, refreshToken: "rt-1", resource: RESOURCE_SERVER }); }
  catch (e) { thrown = e; }
  check("an unrecognised error code is dropped rather than carried as prose",
    thrown?.providerError === undefined);
  check("...and none of it reaches the thrown error",
    !`${thrown?.message}|${JSON.stringify(thrown)}|${thrown?.providerError}`.includes("rt-9"));
  check("...and a dropped code is NOT read as a withdrawn grant",
    oauth.isGrantWithdrawn(thrown) === false);

  // A transient failure must never be mistaken for a revocation.
  routes.set("as.example/token", (_q, res) => json(res, {}, 503));
  let blip;
  try { await oauth.refreshTokens({ server, clientId: "c", clientSecret: null, refreshToken: "rt-1", resource: RESOURCE_SERVER }); }
  catch (e) { blip = e; }
  check("a 503 with no body is not a withdrawn grant", oauth.isGrantWithdrawn(blip) === false);
}

routes.set("as.example/token", (_q, res) => json(res, { refresh_token: "rt-3" }));
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  check("a token response with no access token is malformed, not a success",
    await codeOf(() => oauth.refreshTokens({ server, clientId: "c", clientSecret: null, refreshToken: "x", resource: RESOURCE_SERVER })) === "malformed_token_response");
}

let revoked = null;
routes.set("as.example/revoke", (_q, res, body) => { revoked = Object.fromEntries(new URLSearchParams(body)); res.writeHead(200).end(); });
{
  const server = await oauth.discoverAuthorizationServer(ISSUER);
  const ok = await oauth.revokeToken({ server, clientId: "client-abc", clientSecret: null, token: "rt-2", tokenTypeHint: "refresh_token" });
  check("disconnecting revokes the grant at the provider", ok === true && revoked.token === "rt-2");
  check("...naming what kind of token it is", revoked.token_type_hint === "refresh_token");

  const noEndpoint = await oauth.revokeToken({ server: { ...server, revocationEndpoint: null }, clientId: "c", clientSecret: null, token: "t", tokenTypeHint: "refresh_token" });
  check("a server with no revocation endpoint reports honestly rather than claiming success", noEndpoint === false);
}

console.log("\n— expiry —");
{
  check("a token past its expiry is expired", oauth.isExpired(new Date(Date.now() - 1000).toISOString()));
  check("a token expiring within the skew is treated as expired",
    oauth.isExpired(new Date(Date.now() + 30_000).toISOString()));
  check("a token well inside its life is not", !oauth.isExpired(new Date(Date.now() + 3_600_000).toISOString()));
  check("no expiry means no expiry, not instantly expired", !oauth.isExpired(null));
  check("an unparseable expiry is treated as expired rather than valid", oauth.isExpired("not-a-date"));
}

HOSTS.server.close();
console.log(`\n${passed} assertions passed.`);
if (failures.length) { console.error(`\n${failures.length} FAILURE(S):\n- ${failures.join("\n- ")}`); process.exit(1); }
