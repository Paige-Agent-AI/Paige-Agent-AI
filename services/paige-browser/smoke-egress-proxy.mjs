// PC-1 smoke — the connect-time egress proxy (egress-proxy.mjs) enforces the #138 closure.
//
// Legs:
//  A. VALIDATOR (unit, injected resolver — exercises the REAL resolvePublicConnectTarget): public
//     literal passes; every private/special-range literal refuses; hostnames with ANY private
//     answer refuse (mixed answers = hostile); unresolved refuses; .local suffix refuses;
//     denylisted host refuses (loaded from a temp hosts file through the REAL loadDenylist).
//  B. REFUSAL OVER THE WIRE: the REAL proxy (injected resolver) refuses CONNECT to a hostname that
//     resolves private, refuses CONNECT to a private literal, and refuses absolute-form http:// to
//     a private target — 403, socket destroyed, and the local target server is NEVER reached.
//  C. LOOPBACK BIND: the proxy listens on 127.0.0.1 only.
//  D. UPGRADE REFUSAL: absolute-form requests carrying an Upgrade header are refused fail-closed.
//
// HONEST LIMIT (§13): a live positive tunnel to a real public origin is NOT proven here (it needs
// outbound network + an origin we do not control); the allow decision is proven at the validation
// layer (leg A) and the deployed path gets its live proof in the §32.c owner drive.
import http from "node:http";
import net from "node:net";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDenylist, denylistSize } from "./ssrf-guard.mjs";
import { startEgressProxy, resolvePublicConnectTarget } from "./egress-proxy.mjs";

const fail = (msg) => { console.error(`[smoke-egress-proxy] FAIL: ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`[smoke-egress-proxy] ok: ${msg}`);
const PUB = "93.184.216.34"; // a public literal for validator tests only — never dialed here

// Leg A — validator decisions.
{
  const resolve = async (h) => (h === "mixed.test" ? [{ address: PUB }, { address: "10.0.0.7" }]
    : h === "pubname.test" ? [{ address: PUB }]
    : h === "unresolvable.test" ? (() => { throw new Error("NXDOMAIN"); })()
    : [{ address: "127.0.0.1" }]);

  const cases = [
    [PUB, null], ["8.8.8.8", null],
    ["10.1.2.3", "ssrf:"], ["127.0.0.1", "ssrf:"], ["169.254.169.254", "ssrf:"], ["192.168.0.9", "ssrf:"],
    ["172.16.5.5", "ssrf:"], ["100.64.0.1", "ssrf:"], ["0.0.0.0", "ssrf:"],
    ["::1", "ssrf:"], ["fc00::9", "ssrf:"], ["fe80::1", "ssrf:"], ["64:ff9b::127.0.0.1", "ssrf:"],
    ["::ffff:10.0.0.1", "ssrf:"], ["2002:0a00:0001::", "ssrf:"],
    ["localhost", "ssrf:loopback"], ["host.local", "ssrf:loopback"], ["svc.internal", "ssrf:loopback"],
    ["mixed.test", "ssrf:"], ["unresolvable.test", "ssrf:unresolved"],
  ];
  for (const [target, expectPrefix] of cases) {
    const v = await resolvePublicConnectTarget(target, { resolve });
    if (expectPrefix === null) {
      if (v.reason || !v.address) fail(`public target ${target} should validate, got ${JSON.stringify(v)}`);
    } else if (!v.reason || !v.reason.startsWith(expectPrefix)) {
      fail(`target ${target} should refuse with ${expectPrefix}*, got ${JSON.stringify(v)}`);
    }
  }
  const allowed = await resolvePublicConnectTarget("pubname.test", { resolve });
  if (allowed.reason || allowed.address !== PUB) fail(`pubname.test should pin ${PUB}, got ${JSON.stringify(allowed)}`);
  ok(`leg A: ${cases.length} refusal cases + literal/name allow-and-pin decisions hold`);

  // Denylist through the REAL loader: a temp hosts file with one entry.
  const dir = mkdtempSync(join(tmpdir(), "pc1-deny-"));
  const list = join(dir, "hosts");
  writeFileSync(list, "# test denylist\n0.0.0.0 blocked.test\n");
  loadDenylist(list);
  if (denylistSize() < 1) fail("denylist did not load from temp hosts file");
  const dl = await resolvePublicConnectTarget("blocked.test", { resolve: async () => [{ address: PUB }] });
  if (dl.reason !== "denylist:stevenblack") fail(`denylisted host should refuse, got ${JSON.stringify(dl)}`);
  ok("leg A: denylisted host refuses even when the resolver answers public");
}

// Legs B-D — the real proxy over real sockets, with the resolver pinned to a private answer so the
// local target's reachability is exactly what a refusal must prevent.
{
  let targetHits = 0;
  const target = http.createServer((_req, res) => { targetHits++; res.writeHead(200); res.end("REACHED"); });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const tPort = target.address().port;

  const proxy = await startEgressProxy({ resolve: async () => [{ address: "127.0.0.1" }] });
  try {
    if (proxy.serverUrl.startsWith("http://127.0.0.1:") !== true) fail(`proxy not on loopback: ${proxy.serverUrl}`);
    ok(`leg C: proxy binds loopback only (${proxy.serverUrl})`);

    const speak = (raw) => new Promise((resolveResp) => {
      const sock = net.connect(proxy.port, "127.0.0.1");
      let buf = "";
      sock.setTimeout(6000, () => { sock.destroy(); resolveResp(buf || "TIMEOUT"); });
      sock.on("connect", () => sock.write(raw));
      sock.on("data", (d) => { buf += d.toString("latin1"); if (buf.includes("\r\n")) { sock.destroy(); resolveResp(buf); } });
      sock.on("error", () => resolveResp(buf || "SOCKERR"));
      sock.on("close", () => resolveResp(buf || "CLOSED"));
    });

    let r = await speak(`CONNECT privname.test:${tPort} HTTP/1.1\r\nHost: privname.test:${tPort}\r\n\r\n`);
    if (!/^HTTP\/1\.1 403/.test(r)) fail(`CONNECT private-resolving host should 403, got: ${r.slice(0, 60)}`);
    r = await speak(`CONNECT 127.0.0.1:${tPort} HTTP/1.1\r\nHost: 127.0.0.1:${tPort}\r\n\r\n`);
    if (!/^HTTP\/1\.1 403/.test(r)) fail(`CONNECT private literal should 403, got: ${r.slice(0, 60)}`);
    // Round-2 fix proof: a BRACKETED v6 target parses through to the VALIDATOR (private v6 refuses
    // with the ssrf reason header — not target:malformed, which is what the old colon-split gave).
    {
      const sock = net.connect(proxy.port, "127.0.0.1");
      let buf2 = "";
      const v6resp = await new Promise((res2) => {
        sock.setTimeout(6000, () => { sock.destroy(); res2(buf2 || "TIMEOUT"); });
        sock.on("connect", () => sock.write("CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]:443\r\n\r\n"));
        sock.on("data", (d) => { buf2 += d.toString("latin1"); if (buf2.includes("\r\n\r\n")) { sock.destroy(); res2(buf2); } });
        sock.on("error", () => res2(buf2 || "SOCKERR"));
      });
      if (!/^HTTP\/1\.1 403/.test(v6resp)) fail(`bracketed v6 should 403, got: ${v6resp.slice(0, 60)}`);
      if (!/X-Egress-Reason: ssrf:loopback/.test(v6resp)) fail(`bracketed v6 refusal must carry the ssrf reason (parse reached the validator), got: ${v6resp.slice(0, 120)}`);
    }
    r = await speak(`GET http://privname.test:${tPort}/x HTTP/1.1\r\nHost: privname.test:${tPort}\r\nConnection: close\r\n\r\n`);
    if (!/^HTTP\/1\.1 403/.test(r)) fail(`absolute-form private should 403, got: ${r.slice(0, 60)}`);
    r = await speak(`GET http://pubname.test/x HTTP/1.1\r\nHost: pubname.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    if (!/^HTTP\/1\.1 403/.test(r)) fail(`upgrade request should 403, got: ${r.slice(0, 60)}`);
    ok("leg B+D: CONNECT-to-private, literal-private, absolute-form-private and upgrade all refused");

    if (targetHits !== 0) fail(`local target was REACHED ${targetHits}x through the proxy — refusal is not enforced`);
    ok("leg B: the private target server was never reached");
  } finally {
    await proxy.close();
    target.close();
  }
}

console.log("[smoke-egress-proxy] PASS — egress proxy refusals + loopback bind proven");
