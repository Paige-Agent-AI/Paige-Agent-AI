#!/usr/bin/env node
/**
 * The hardened outbound transport — driven, not described.
 *
 * WHY THIS EXISTS
 *
 * Four copies of the SSRF validator shipped, and every one of them was missing the same
 * three protections: credentials in the URL, a bounded wait, a bounded body. Prose in a
 * header comment is what let that happen four times. So this runs the REAL
 * `_shared/ssrfGuard.ts` and `_shared/mcp-client.ts` against a REAL HTTP server and
 * asserts on what they actually do.
 *
 * WHAT IS SUBSTITUTED, AND WHAT IS NOT
 *
 *   - `Deno.resolveDns` is shimmed, because this runs under Node. The shim returns the
 *     addresses each case is about; the numeric validation being tested is the shipped
 *     code, untouched.
 *   - Address translation is shimmed: the guard sees the real hostname and runs in full,
 *     and only afterwards is the connection pointed at the local server. Everything the
 *     transport cases are about — redirect status, byte counting, the abort, the SSE
 *     framing — happens against a genuine server over a genuine socket.
 *
 * Nothing else is stubbed. The guard, the client, the JSON-RPC handling and the error
 * mapping are the shipped code.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// ── DNS shim ──────────────────────────────────────────────────────────────────
// Hostnames each case needs. Anything unlisted throws, which is what a real
// unresolvable host does, so the fail-closed branch is exercised for real.
const DNS = {
  "public.example": { A: ["93.184.216.34"] },
  "rebind.example": { A: ["10.0.0.7"] },            // resolves inside — must be refused
  "mixed.example": { A: ["93.184.216.34", "127.0.0.1"] }, // one bad address is enough
  "v6-ula.example": { AAAA: ["fd00::1"] },
  "mapped.example": { AAAA: ["::ffff:169.254.169.254"] }, // metadata via mapped v6
  // The spellings the old prefix regexes did not have. Each one resolved to an address
  // that is not a legitimate destination and each one was ALLOWED.
  "translated.example": { AAAA: ["::ffff:0:127.0.0.1"] },  // IPv4-translated loopback
  "compat.example": { AAAA: ["::169.254.169.254"] },       // IPv4-compatible metadata
  "sitelocal.example": { AAAA: ["fec0::1"] },              // fec0::/10
  "multicast6.example": { AAAA: ["ff02::1"] },             // ff00::/8
  "multicast4.example": { A: ["224.0.0.1"] },              // 224.0.0.0/4
  "reserved4.example": { A: ["240.0.0.1"] },               // 240.0.0.0/4
  "relay6to4.example": { A: ["192.88.99.1"] },             // 6to4 relay anycast
  "sixtofour.example": { AAAA: ["2002:a00:1::1"] },        // 6to4 wrapping 10.0.0.1
};
globalThis.Deno = {
  resolveDns: async (host, kind) => {
    const rec = DNS[host]?.[kind];
    if (!rec) throw new Error("no records");
    return rec;
  },
  env: { get: () => undefined },
};

// ── The local server every transport case runs against ────────────────────────
let server, PORT;
const routes = new Map();
await new Promise((resolve) => {
  server = http.createServer((req, res) => {
    const handler = routes.get(req.url.split("?")[0]);
    if (!handler) { res.writeHead(404).end("no route"); return; }
    handler(req, res);
  });
  server.listen(0, "127.0.0.1", () => { PORT = server.address().port; resolve(); });
});

// The guard has already run by the time this is reached; only the destination moves.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = new URL(url);
  return realFetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, init);
};

const outDir = path.join(process.cwd(), "node_modules", ".cache", "mcp-transport-smoke");
const bundle = async (entry, name) => {
  const outfile = path.join(outDir, name);
  await build({ entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
};
const guard = await bundle("supabase/functions/_shared/ssrfGuard.ts", "guard.mjs");
const mcp = await bundle("supabase/functions/_shared/mcp-client.ts", "client.mjs");

let passed = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(`${label}${detail ? " — " + detail : ""}`); console.log(`  FAIL ${label} ${detail}`); }
}
async function reasonOf(fn) {
  try { await fn(); return null; } catch (e) { return e.reason ?? e.code ?? e.message; }
}

console.log("\nhardened outbound transport smoke\n");
console.log("— URL validation —");

// Scheme, credentials, shape.
check("http:// is refused", await reasonOf(() => guard.assertPublicHttpUrl("http://public.example/x")) === "url_must_be_https");
check("a malformed URL is refused", await reasonOf(() => guard.assertPublicHttpUrl("not a url")) === "invalid_url");
check("credentials embedded in the URL are refused",
  await reasonOf(() => guard.assertPublicHttpUrl("https://user:pw@public.example/x")) === "url_has_embedded_credentials");
check("a username alone is still refused",
  await reasonOf(() => guard.assertPublicHttpUrl("https://user@public.example/x")) === "url_has_embedded_credentials");
// This is the parser-confusion case: the real host is the one after the @.
check("the good.com@evil.com shape is refused rather than silently retargeted",
  await reasonOf(() => guard.assertPublicHttpUrl("https://public.example@rebind.example/x")) === "url_has_embedded_credentials");

// Hosts and addresses.
check("localhost is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://localhost/x")) === "url_host_not_allowed");
check(".internal is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://api.internal/x")) === "url_host_not_allowed");
check("a loopback literal is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://127.0.0.1/x")) === "url_host_not_allowed");
check("the cloud metadata address is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://169.254.169.254/x")) === "url_host_not_allowed");
check("an RFC1918 literal is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://10.1.2.3/x")) === "url_host_not_allowed");
// Named for what it actually tests. A host that resolves to a private address is refused
// — which is a static resolution, not a rebind. A rebind is a host that answers PUBLIC to
// this check and PRIVATE to the socket `fetch` opens afterwards, and nothing here can
// stop that, because `fetch` does its own resolution and cannot be pinned to the address
// that was validated. The old name claimed a property this file does not hold; the
// residual risk is written down in ssrfGuard.ts rather than asserted away.
check("a name that resolves to a private address is refused",
  await reasonOf(() => guard.assertPublicHttpUrl("https://rebind.example/x")) === "url_resolves_to_private_address");
check("one private address among several is enough to refuse",
  await reasonOf(() => guard.assertPublicHttpUrl("https://mixed.example/x")) === "url_resolves_to_private_address");
check("an IPv6 ULA is refused", await reasonOf(() => guard.assertPublicHttpUrl("https://v6-ula.example/x")) === "url_resolves_to_private_address");
check("metadata reached through a mapped IPv6 address is refused",
  await reasonOf(() => guard.assertPublicHttpUrl("https://mapped.example/x")) === "url_resolves_to_private_address");

// Every one of these was ALLOWED by the prefix regexes this guard used to carry. They are
// listed individually rather than folded into one case because each is a different way of
// writing an address, and "the parser handles notation" is exactly the claim under test.
for (const [host, what] of [
  ["translated.example", "an IPv4-translated loopback (::ffff:0:127.0.0.1)"],
  ["compat.example", "an IPv4-compatible metadata address (::169.254.169.254)"],
  ["sitelocal.example", "an IPv6 site-local address (fec0::/10)"],
  ["multicast6.example", "an IPv6 multicast address (ff00::/8)"],
  ["multicast4.example", "an IPv4 multicast address (224.0.0.0/4)"],
  ["reserved4.example", "a reserved IPv4 address (240.0.0.0/4)"],
  ["relay6to4.example", "the 6to4 relay anycast address (192.88.99.0/24)"],
  ["sixtofour.example", "a 6to4 address wrapping an RFC1918 target"],
]) {
  check(`${what} is refused`,
    await reasonOf(() => guard.assertPublicHttpUrl(`https://${host}/x`)) === "url_resolves_to_private_address");
}

// A literal that is not an address at all must fail closed rather than fall through the
// bottom of the parser as "a routable public IPv6".
check("an unparseable IPv6 literal fails closed",
  await reasonOf(() => guard.assertPublicHttpUrl("https://[::ffff:zz]/x")) !== null);
// ...and a genuinely public IPv6 still works, so the parser did not close the door.
check("a public IPv6 address is still allowed",
  await reasonOf(() => guard.assertPublicHttpUrl("https://[2606:4700:4700::1111]/x")) === null);
check("an unresolvable host fails closed",
  await reasonOf(() => guard.assertPublicHttpUrl("https://nowhere.example/x")) === "url_host_unresolvable");
check("a public host is allowed", await reasonOf(() => guard.assertPublicHttpUrl("https://public.example/x")) === null);

console.log("\n— transport —");

routes.set("/redirect", (_q, res) => { res.writeHead(302, { Location: "http://169.254.169.254/" }).end(); });
check("a redirect is refused, not followed",
  await reasonOf(() => guard.safeFetch("https://public.example/redirect")) === "url_redirect_refused");

routes.set("/huge", (_q, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  // Deliberately far larger than the cap, sent in chunks, so the cap has to hold
  // during the read rather than after it.
  for (let i = 0; i < 300; i++) res.write("x".repeat(10_000));
  res.end();
});
{
  const r = await guard.safeFetch("https://public.example/huge", {}, { maxBytes: 4096 });
  check("an oversized body is capped, not buffered", r.body.length === 4096, `got ${r.body.length}`);
  check("...and the truncation is reported rather than hidden", r.truncated === true);
}

routes.set("/slow", (_q, res) => { res.writeHead(200, { "Content-Type": "application/json" }); /* never ends */ });
{
  const started = Date.now();
  const reason = await reasonOf(() => guard.safeFetch("https://public.example/slow", {}, { timeoutMs: 400 }));
  const elapsed = Date.now() - started;
  check("a hung server aborts on the deadline", reason === "request_timed_out", String(reason));
  check("...and it actually stops near the deadline", elapsed < 3000, `${elapsed}ms`);
}

routes.set("/ok", (_q, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

routes.set("/denied", (_q, res) => {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "SUPER-SECRET-BODY: internal detail nobody asked to carry" }));
});
{
  const r = await guard.safeFetch("https://public.example/ok");
  check("a normal response is returned whole", r.status === 200 && !r.truncated && JSON.parse(r.body).ok === true);
}

console.log("\n— MCP client —");

const TOOLS = [
  { name: "send_email", description: "Send an email", inputSchema: { type: "object", properties: { to: {} } } },
  { name: "no_name_here" },
  { description: "nameless, must be dropped" },
];
/**
 * A server that ENFORCES the MCP lifecycle, which is the only kind worth testing against.
 *
 * The previous stub answered `tools/list` unconditionally, so a client that never sent
 * `initialize` passed every assertion here and would have been rejected by every compliant
 * provider. A stub more permissive than the real thing proves the code works against the
 * stub. This one refuses anything before the handshake, issues a session id, and requires
 * it on every later request — exactly what a stateful Streamable HTTP server does.
 */
const SESSION_ID = "sess-abc-123";
function lifecycleServer(resultFor) {
  return (req, res) => {
    // Terminating a session is a DELETE carrying no body; parsing one as JSON throws.
    if (req.method === "DELETE") {
      deleted.push(req.headers["mcp-session-id"] ?? null);
      deletedHeaders.push(req.headers);
      res.writeHead(204).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      exchange.push({ headers: req.headers, body });

      if (body.method === "initialize") {
        initialized = false;
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": SESSION_ID });
        res.end(JSON.stringify({
          jsonrpc: "2.0", id: body.id,
          result: { protocolVersion: body.params?.protocolVersion, capabilities: {}, serverInfo: { name: "stub", version: "1" } },
        }));
        return;
      }

      if (body.method === "notifications/initialized") {
        initialized = true;
        res.writeHead(202).end();
        return;
      }

      // Everything else requires a completed handshake AND the session it issued.
      if (!initialized) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32002, message: "server not initialized" } }));
        return;
      }
      if (req.headers["mcp-session-id"] !== SESSION_ID) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32001, message: "unknown session" } }));
        return;
      }

      lastRequest = { headers: req.headers, body };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: resultFor(body) }));
    });
  };
}
routes.set("/mcp-json", lifecycleServer(() => ({ tools: TOOLS })));
let lastRequest = null;
let initialized = false;
let exchange = [];
let deleted = [];
let deletedHeaders = [];
let ackFailDeleted = [];
let pagedCursors = [];
let loopPages = 0;
let badInitDeleted = [];

const bearer = { kind: "bearer", token: "super-secret-token-1234" };
{
  exchange = [];
  // Caught rather than allowed to propagate. A client that skips the lifecycle is REJECTED
  // by the server below, and an uncaught rejection would abort the whole run before any
  // FAIL line printed — a crash that reports nothing looks the same as a pass to anything
  // counting failures, which is how a proof stops proving without anyone noticing.
  let tools = [];
  let listError = null;
  try {
    tools = await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-json", auth: bearer });
  } catch (e) { listError = e; }
  check("a compliant server accepts the exchange at all", listError === null,
    listError ? `${listError.code ?? listError.message} ${listError.httpStatus ?? ""}` : "");
  check("tools/list returns the named tools", tools.length === 2 && tools[0].name === "send_email");
  check("a tool with no name is dropped rather than half-read", tools.every((t) => typeof t.name === "string" && t.name));
  check("no input schema crosses the boundary",
    !JSON.stringify(tools).includes("inputSchema") && !JSON.stringify(tools).includes("properties"));
  check("the credential is sent as a Bearer header", lastRequest?.headers?.authorization === `Bearer ${bearer.token}`);
  check("the protocol version is declared", !!lastRequest?.headers?.["mcp-protocol-version"]);
  check("both response framings are advertised",
    !!lastRequest?.headers?.accept?.includes("application/json") && !!lastRequest?.headers?.accept?.includes("text/event-stream"));
  check("the method is chosen by us, not the caller", lastRequest?.body?.method === "tools/list");

  // The lifecycle the client used to skip. A compliant server rejects everything before it.
  check("the exchange opens with initialize", exchange[0]?.body?.method === "initialize");
  check("...then acknowledges with notifications/initialized",
    exchange[1]?.body?.method === "notifications/initialized" && exchange[1]?.body?.id === undefined);
  check("...and only then sends the request", exchange[2]?.body?.method === "tools/list");
  check("the session the server issued is carried on every request after it",
    exchange.slice(1).every((e) => e.headers["mcp-session-id"] === SESSION_ID));
  check("the credential is sent on the handshake too, not only on the request",
    exchange.every((e) => e.headers.authorization === `Bearer ${bearer.token}`));
  // A stateful server allocates a session per initialize and expects it back; without the
  // DELETE every probe, discovery and action leaks one until the provider expires it.
  check("the session is released when the work is done", deleted.includes(SESSION_ID),
    JSON.stringify(deleted));
}

// Supplementary headers belong to the same canonical auth bundle, on every request.
{
  const headers = { "X-Workspace": "test-scope-not-a-secret", "X-Region": "us" };
  const auth = mcp.authFromSecret({ server_url: "https://public.example/mcp-json",
    auth_kind: "bearer", auth_token: bearer.token, custom_headers: headers });
  check("canonical loader retains supplementary headers", JSON.stringify(auth?.headers) === JSON.stringify(headers));
  exchange = [];
  await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-json", auth });
  check("supplementary headers accompany initialize, acknowledgment and discovery",
    exchange.length === 3 && exchange.every(e => e.headers["x-workspace"] === headers["X-Workspace"] && e.headers["x-region"] === "us"));
  check("supplementary credentials accompany session cleanup", deletedHeaders.at(-1)?.["x-workspace"] === headers["X-Workspace"]);
  exchange = [];
  await mcp.mcpRequest({ serverUrl: "https://public.example/mcp-json", auth, method: "tools/call", params: { name: "test_local_only", arguments: {} } });
  check("supplementary headers accompany tool dispatch and its handshake",
    exchange.length === 3 && exchange.at(-1).body.method === "tools/call" && exchange.every(e => e.headers["x-workspace"] === headers["X-Workspace"]));
  for (const bad of [null, [], { Authorization: "override" }, { Host: "other.example" },
    { "X-Key": "one", "x-key": "two" }, { "X-Key": "bad\r\nvalue" }, { "X-Key": 4 },
    { "X-Key": "" }, { "X-Key": "\u0100" }, { "X-Forwarded-Host": "other.example" }]) {
    const candidate = { kind: "bearer", token: bearer.token, headers: bad };
    check("invalid supplementary header bundle fails closed before dispatch", !mcp.authUsable(candidate));
  }
  check("primary custom auth header cannot collide case-insensitively",
    !mcp.authUsable({ kind: "header", name: "X-Key", token: bearer.token, headers: { "x-key": "another" } }));
  for (const bad of [Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`X-${i}`, "x"])),
    { ["X".repeat(65)]: "x" }, { "X-Key": "x".repeat(4097) },
    Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`X-${i}`, "x".repeat(4000)]))]) {
    check("supplementary header cardinality/name/value/total bounds enforced", !mcp.authUsable({ ...bearer, headers: bad }));
  }
  exchange = [];
  const refused = await reasonOf(() => mcp.mcpRequest({ serverUrl: "https://public.example/mcp-json",
    auth: { ...bearer, headers: { Host: "other.example" } }, method: "tools/list" }));
  check("invalid bundle never reaches local server", refused === "mcp_protocol_error" && exchange.length === 0);
}

// ── Which stored connections are usable, and as what ──────────────────────────────
//
// This predicate existed three times -- in the Zapier action caller, in resolveConnection
// and in probeAndRecord -- and when the URL-credential shape was added, the AUTH MAPPING
// learned about it in all three while the GUARD learned about it in one. A correctly saved
// Zapier address was therefore mapped to the right auth and then refused before use:
// discovery said "not connected" and the probe recorded an error, on a connection that had
// just been saved. Answering both questions in one function is what stops that recurring.
{
  const url = "https://mcp.zapier.com/api/mcp/s/secret/mcp";

  const urlAuth = mcp.authFromSecret({ server_url: url, auth_kind: "url" });
  check("an address that carries its own credential is usable",
    urlAuth !== null, JSON.stringify(urlAuth));
  check("...and sends no Authorization header",
    urlAuth?.kind === "none", JSON.stringify(urlAuth));

  const bearer = mcp.authFromSecret({ server_url: url, auth_kind: "bearer", auth_token: "t" });
  check("a bearer connection still authenticates as a bearer",
    bearer?.kind === "bearer" && bearer.token === "t");

  const header = mcp.authFromSecret({
    server_url: url, auth_kind: "header", auth_header_name: "X-Key", auth_token: "t",
  });
  check("a header connection still names its header",
    header?.kind === "header" && header.name === "X-Key" && header.token === "t");

  // The refusals stay refusals: widening for the URL shape must not make a genuinely
  // unconfigured connection look usable.
  check("a connection with no address is refused",
    mcp.authFromSecret({ auth_kind: "bearer", auth_token: "t" }) === null);
  check("a non-URL connection with no credential is refused",
    mcp.authFromSecret({ server_url: url, auth_kind: "bearer" }) === null);
  check("header auth without a header name falls back rather than sending a nameless header",
    mcp.authFromSecret({ server_url: url, auth_kind: "header", auth_token: "t" })?.kind === "bearer");
  check("nothing at all is refused", mcp.authFromSecret(null) === null);

  // The auth follows the SECRET, so whatever last wrote to the secret is what goes on the
  // wire. This is the contract an OAuth refresh depends on: rotation writes the new access
  // token onto `secret`, and the auth derived afterwards must carry it. It broke because a
  // local `token` copy was rotated while the auth was derived from the untouched field, so
  // the first call after every expiry went out with the dead token.
  const rotating = { server_url: url, auth_kind: "oauth", auth_token: "expired" };
  check("before rotation the auth carries the stored token",
    mcp.authFromSecret(rotating)?.token === "expired");
  rotating.auth_token = "rotated";
  check("after rotation writes to the secret, the auth carries the NEW token",
    mcp.authFromSecret(rotating)?.token === "rotated");
}

// A provider that allocates a session and then answers initialize with a JSON-RPC error.
// The session exists the moment the header comes back, so it has to be released even
// though the handshake never completed. Validating the body before reading the header
// meant the throw happened with the id still unread.
const BAD_INIT_SESSION = "bad-init-session";
routes.set("/mcp-init-errors", (req, res) => {
  if (req.method === "DELETE") {
    badInitDeleted.push(req.headers["mcp-session-id"]);
    res.writeHead(204).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": BAD_INIT_SESSION });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "boom" } }));
  });
});
{
  badInitDeleted = [];
  let initError = null;
  try {
    await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-init-errors", auth: bearer });
  } catch (e) { initError = e; }
  check("a failed initialize is an error, not an empty catalogue",
    initError?.code === "mcp_protocol_error", String(initError?.code));
  check("...and the session it allocated before failing is still released",
    badInitDeleted.includes(BAD_INIT_SESSION), JSON.stringify(badInitDeleted));
}

// A provider that paginates its catalogue, which the spec allows and Zapier-scale
// accounts produce. Reading only the first page is not a smaller list with a smaller
// consequence: approvals are stored as a whole set, so an operator editing one visible
// approval silently revokes every tool that was on a later page.
const PAGED_SESSION = "paged-session";
routes.set("/mcp-paged", (req, res) => {
  if (req.method === "DELETE") { res.writeHead(204).end(); return; }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (body.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": PAGED_SESSION });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      return;
    }
    if (body.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    if (body.method === "tools/list") {
      pagedCursors.push(body.params?.cursor ?? null);
      const page = body.params?.cursor === "p2"
        ? { tools: [{ name: "page_two_tool", description: "d" }] }
        : { tools: [{ name: "page_one_tool", description: "d" }], nextCursor: "p2" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: page }));
      return;
    }
    res.writeHead(400).end();
  });
});
{
  pagedCursors = [];
  const tools = await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-paged", auth: bearer });
  const names = tools.map((t) => t.name);
  check("a tool on a later page is not lost", names.includes("page_two_tool"), JSON.stringify(names));
  check("...alongside the first page rather than instead of it", names.includes("page_one_tool"));
  // The cursor the server handed back is the one sent, not one we invented.
  check("the provider's own cursor is what asks for the next page",
    JSON.stringify(pagedCursors) === JSON.stringify([null, "p2"]), JSON.stringify(pagedCursors));
}

// A provider whose cursor never advances would page forever. The chain is bounded rather
// than trusted, because the cursor is provider-controlled.
routes.set("/mcp-cursor-loop", (req, res) => {
  if (req.method === "DELETE") { res.writeHead(204).end(); return; }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (body.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      return;
    }
    if (body.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    loopPages += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "looping", description: "d" }], nextCursor: "same" } }));
  });
});
{
  loopPages = 0;
  await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-cursor-loop", auth: bearer });
  check("a cursor that never advances does not page forever", loopPages <= 21, String(loopPages));
}

// A provider that issues a session and then refuses the acknowledgement. This is the
// unhealthy-provider case: an outage, or a server that disagrees about the protocol
// version. A session was allocated, so it must still be released — the cleanup used to
// begin AFTER the acknowledgement, so this exact path leaked one every time.
const ACK_FAIL_SESSION = "ack-fail-session";
routes.set("/mcp-ack-fails", (req, res) => {
  if (req.method === "DELETE") {
    ackFailDeleted.push(req.headers["mcp-session-id"]);
    res.writeHead(204).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (body.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": ACK_FAIL_SESSION });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      return;
    }
    // The acknowledgement, and anything after it, is refused.
    res.writeHead(503, { "Content-Type": "text/plain" }).end("unavailable");
  });
});
{
  ackFailDeleted = [];
  let ackError = null;
  try {
    await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-ack-fails", auth: bearer });
  } catch (e) { ackError = e; }
  check("a refused handshake acknowledgement is an error, not a silent continue",
    ackError?.code === "mcp_http_error" && ackError?.httpStatus === 503);
  check("...and the session it already issued is still released",
    ackFailDeleted.includes(ACK_FAIL_SESSION), JSON.stringify(ackFailDeleted));
}

// A provider may answer the same request as an event stream.
routes.set("/mcp-sse", (req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const id = JSON.parse(raw).id;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n");
    res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ name: "sse_tool", description: "d" }] } })}\n\n`);
    res.end();
  });
});
{
  const tools = await mcp.mcpListTools({ serverUrl: "https://public.example/mcp-sse", auth: bearer });
  check("an SSE-framed response is read as the same result", tools.length === 1 && tools[0].name === "sse_tool");
}

routes.set("/mcp-error", (_q, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }));
});
routes.set("/mcp-401", (_q, res) => { res.writeHead(401, { "Content-Type": "text/plain" }).end("bad token"); });
routes.set("/mcp-garbage", (_q, res) => { res.writeHead(200, { "Content-Type": "application/json" }).end("<html>not json</html>"); });
{
  const asError = async (p) => { try { await p; return null; } catch (e) { return e; } };
  const rpcErr = await asError(mcp.mcpListTools({ serverUrl: "https://public.example/mcp-error", auth: bearer }));
  check("a JSON-RPC error is raised, never returned as an empty list", rpcErr?.code === "mcp_protocol_error");

  const httpErr = await asError(mcp.mcpListTools({ serverUrl: "https://public.example/mcp-401", auth: bearer }));
  check("a rejected credential surfaces as an HTTP error with its status",
    httpErr?.code === "mcp_http_error" && httpErr?.httpStatus === 401);

  const junkErr = await asError(mcp.mcpListTools({ serverUrl: "https://public.example/mcp-garbage", auth: bearer }));
  // The reason was declared and worded and never raised, so an oversized answer read as
// "not an MCP server" — which points the workspace at their address instead of the server.
check("an oversized MCP response is named as oversized, not as a bad address",
  await reasonOf(() => mcp.mcpRequest({
    serverUrl: "https://public.example/huge",
    auth: { kind: "bearer", token: "t" },
    method: "tools/list",
    maxBytes: 4096,
  })) === "response_too_large");

// The status is what a workspace can act on. The body is arbitrary third-party text and
// has no business inside an Error that other code will log and stringify.
{
  let carried = null;
  try {
    await mcp.mcpRequest({ serverUrl: "https://public.example/denied", auth: { kind: "bearer", token: "t" }, method: "tools/list" });
  } catch (e) { carried = e; }
  check("a rejected credential does not carry the provider's error body in the message",
    !String(carried?.message ?? "").includes("SUPER-SECRET-BODY"), String(carried?.message));
}

check("a non-MCP endpoint is refused rather than half-parsed", junkErr?.code === "mcp_malformed_response");

  // The single most important property of this whole layer.
  const everything = [rpcErr, httpErr, junkErr]
    .map((e) => `${e?.message}|${e?.detail}|${e?.stack}`).join("|");
  check("no error carries the credential", !everything.includes(bearer.token));
}

{
  // A tenant supplies the header NAME for header auth, so it is a header-injection
  // surface until it is constrained.
  const asError = async (p) => { try { await p; return null; } catch (e) { return e; } };
  const injected = await asError(mcp.mcpListTools({
    serverUrl: "https://public.example/mcp-json",
    auth: { kind: "header", name: "X-Bad\r\nX-Injected: yes", token: "t" },
  }));
  check("a header name carrying CRLF is refused", injected?.code === "mcp_protocol_error");

  await mcp.mcpListTools({
    serverUrl: "https://public.example/mcp-json",
    auth: { kind: "header", name: "X-N8N-Api-Key", token: "hdr-secret" },
  });
  // The grammar check stops a new header being injected; it says nothing about an existing
// one being replaced, and the auth headers are spread last.
for (const reserved of ["Authorization", "Accept", "Content-Type", "MCP-Protocol-Version", "Host"]) {
  check(`a custom header name of ${reserved} is refused rather than overriding ours`,
    (await reasonOf(() => mcp.mcpRequest({
      serverUrl: "https://public.example/ok",
      auth: { kind: "header", name: reserved, token: "t" },
      method: "tools/list",
    }))) !== null);
}

check("a valid custom header name is used verbatim", lastRequest.headers["x-n8n-api-key"] === "hdr-secret");
  check("...and no Bearer header is sent alongside it", lastRequest.headers.authorization === undefined);
}

{
  // The probe is what earns `connected`; a failure must report failure.
  const good = await mcp.mcpProbe({ serverUrl: "https://public.example/mcp-json", auth: bearer });
  check("a probe against a real MCP server succeeds", good.ok === true && good.toolCount === 2);
  const bad = await mcp.mcpProbe({ serverUrl: "https://public.example/mcp-401", auth: bearer });
  check("a probe with a rejected credential fails rather than passing quietly",
    bad.ok === false && bad.code === "mcp_http_error");
  const unsafe = await mcp.mcpProbe({ serverUrl: "https://10.0.0.9/mcp", auth: bearer });
  check("a probe at a private address never leaves the process", unsafe.ok === false && unsafe.code === "url_host_not_allowed");
}

{
  // Every code the client can produce must have owner-facing words, or some surface
  // will end up rendering a raw code.
  const codes = ["invalid_url", "url_must_be_https", "url_has_embedded_credentials", "url_host_not_allowed",
    "url_host_unresolvable", "url_resolves_to_private_address", "url_redirect_refused", "request_timed_out",
    "response_too_large", "request_failed", "mcp_http_error", "mcp_malformed_response", "mcp_protocol_error"];
  const described = codes.map((c) => mcp.describeMcpError(c));
  check("every failure code has owner-facing words",
    described.every((d) => typeof d === "string" && d.length > 10 && !/_/.test(d)));
  check("no two unrelated failures read identically",
    new Set(described).size >= codes.length - 3);
}

server.close();
console.log(`\n${passed} assertions passed.`);
if (failures.length) { console.error(`\n${failures.length} FAILURE(S):\n- ${failures.join("\n- ")}`); process.exit(1); }
