// paige-browser SSRF-guard smoke test (§32 — a green build is NOT a working guard; §39 peer-gate).
//
// Exercises the REAL ssrf-guard.mjs code (imported, NOT a hand-copied mirror) across the DNS-FREE
// deny-matrix: IP-literal ranges (private / loopback / link-local-metadata / reserved / CGNAT / IPv6
// ULA + link-local + the 6to4 / NAT64 / hex-IPv4-mapped tunnels), non-http(s) schemes, WHATWG numeric-
// host normalization (decimal/hex/octal/short-form loopback), userinfo normalization (good.com@evil.com
// -> evil.com), and the StevenBlack-style content denylist (via a fixture). Every blocked case asserts
// the EXACT reason code the paige_browser_usage audit rail records.
//
// HONEST §32.c SCOPE: the cases here are DNS-FREE and run deterministically headless. The DNS-dependent
// cases (a real public domain resolving + allowed; a Cloudflare-Families 0.0.0.0 sinkhole; a real
// redirect-to-private) and the browser-driven cases require the DEPLOYED Fly service and open outbound
// network — they are the §39 LIVE peer-gate, OWED to the next capable session, and are NOT claimed here.
//
// Run:  node smoke-ssrf.mjs   (or: npm run smoke:ssrf)
// Exit: 0 = every DNS-free guard case returns the exact expected reason; non-zero = a gap.
import { ipBlockReason, urlBlockReason, requestMethodBlockReason, requestEgressBlockReason, isDenylisted, loadDenylist } from "./ssrf-guard.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.error(`✗ ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok  ${label.padEnd(52)} -> ${JSON.stringify(got)}`);
};

// ── 1) ipBlockReason: every range, with the exact category the audit rail logs ────────────────────
const ipCases = [
  ["169.254.169.254", "link-local:metadata"], ["169.254.1.1", "link-local"],
  ["10.0.0.1", "private-ipv4"], ["172.16.0.1", "private-ipv4"], ["172.31.255.1", "private-ipv4"], ["192.168.1.1", "private-ipv4"],
  ["127.0.0.1", "loopback"], ["0.0.0.0", "reserved"], ["100.64.0.1", "cgnat"],
  ["255.255.255.255", "reserved"], ["224.0.0.1", "reserved"], ["240.0.0.1", "reserved"],
  ["198.18.0.1", "reserved"], ["192.0.2.1", "reserved"], ["198.51.100.1", "reserved"], ["203.0.113.1", "reserved"], ["192.0.0.1", "reserved"],
  ["::1", "loopback"], ["::", "reserved"], ["fc00::1", "private-ipv6"], ["fd12::1", "private-ipv6"], ["fe80::1", "private-ipv6"],
  ["ff02::1", "reserved"], ["2001:db8::1", "reserved"],
  ["::ffff:10.0.0.1", "private-ipv4"], ["::ffff:7f00:1", "loopback"],          // dotted + hex IPv4-mapped
  ["2002:7f00:1::", "loopback"], ["2002:0a00:0001::", "private-ipv4"],          // 6to4 -> 127.0.0.1 / 10.0.0.1
  ["64:ff9b::7f00:1", "loopback"], ["64:ff9b::a9fe:a9fe", "link-local:metadata"], // NAT64 -> 127.0.0.1 / 169.254.169.254
  // PUBLIC — must be allowed (null):
  ["8.8.8.8", null], ["1.1.1.1", null], ["93.184.216.34", null], ["2606:2800:220:1::", null],
];
for (const [ip, want] of ipCases) eq(`ip ${ip}`, ipBlockReason(ip), want);

// A read-only browser must gate the page's request method, not only its destination host.
for (const method of ["GET", "HEAD"]) eq(`method ${method}`, requestMethodBlockReason(method), null);
for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE", "OPTIONS"]) {
  eq(`method ${method}`, requestMethodBlockReason(method), "method:not-read-only");
}
// INT-312: the request policy admits exactly one OPTIONS — a body-less CORS preflight announcing a read.
const pf = (acr, hasBody = false) => ({ method: "OPTIONS", headers: acr ? { "access-control-request-method": acr } : {}, hasBody });
eq("egress GET", requestEgressBlockReason({ method: "GET", headers: {} }), null);
eq("egress preflight for GET", requestEgressBlockReason(pf("GET")), null);
eq("egress preflight for HEAD", requestEgressBlockReason(pf("head")), null);
eq("egress preflight for POST", requestEgressBlockReason(pf("POST")), "method:preflight-for-write");
eq("egress preflight for DELETE", requestEgressBlockReason(pf("DELETE")), "method:preflight-for-write");
eq("egress preflight for GET with a body", requestEgressBlockReason(pf("GET", true)), "method:preflight-for-write");
eq("egress bare OPTIONS (script, no preflight header)", requestEgressBlockReason(pf(null)), "method:not-read-only");
eq("egress POST", requestEgressBlockReason({ method: "POST", headers: {}, hasBody: true }), "method:not-read-only");

// ── 2) urlBlockReason: schemes rejected ───────────────────────────────────────────────────────────
for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "about:blank", "ftp://h/x", "gopher://h", "chrome://net-internals", "view-source:http://x"]) {
  eq(`scheme ${u}`, await urlBlockReason(u), "ssrf:scheme");
}

// ── 3) urlBlockReason: IP-literal hosts carry the ssrf: prefix ─────────────────────────────────────
eq("url http://169.254.169.254/", await urlBlockReason("http://169.254.169.254/latest/meta-data/"), "ssrf:link-local:metadata");
eq("url http://10.0.0.1/", await urlBlockReason("http://10.0.0.1/"), "ssrf:private-ipv4");
eq("url http://127.0.0.1/", await urlBlockReason("http://127.0.0.1/"), "ssrf:loopback");
eq("url http://[::1]/", await urlBlockReason("http://[::1]/"), "ssrf:loopback");
eq("url http://[fc00::1]/", await urlBlockReason("http://[fc00::1]/"), "ssrf:private-ipv6");
eq("url http://[::ffff:10.0.0.1]/", await urlBlockReason("http://[::ffff:10.0.0.1]/"), "ssrf:private-ipv4");

// ── 4) WHATWG numeric-host normalization closes the decimal/hex/octal/short bypass class ──────────
eq("url http://2130706433/ (decimal)", await urlBlockReason("http://2130706433/"), "ssrf:loopback");
eq("url http://0x7f000001/ (hex)", await urlBlockReason("http://0x7f000001/"), "ssrf:loopback");
eq("url http://017700000001/ (octal)", await urlBlockReason("http://017700000001/"), "ssrf:loopback");
eq("url http://127.1/ (short-form)", await urlBlockReason("http://127.1/"), "ssrf:loopback");
// userinfo normalization: good.com@169.254.169.254 -> the HOST is the metadata IP, not good.com
eq("url userinfo@metadata", await urlBlockReason("http://good.com@169.254.169.254/"), "ssrf:link-local:metadata");

// ── 5) content denylist (StevenBlack-style hosts fixture) — reason "denylist:stevenblack" ─────────
const fixture = path.join(os.tmpdir(), `paige-denylist-smoke-${process.pid}.txt`);
fs.writeFileSync(fixture, "# test hosts\n0.0.0.0 evil.example\n0.0.0.0 ads.tracker.test\n127.0.0.1 localhost\n");
loadDenylist(fixture);
eq("denylist evil.example", isDenylisted("evil.example"), true);
eq("denylist sub.evil.example (parent match)", isDenylisted("sub.deep.evil.example"), true);
eq("denylist ads.tracker.test", isDenylisted("ads.tracker.test"), true);
eq("denylist good.example (not listed)", isDenylisted("good.example"), false);
eq("denylist localhost token skipped", isDenylisted("localhost"), false);
eq("url denylisted host -> reason", await urlBlockReason("http://evil.example/path"), "denylist:stevenblack");
// userinfo trick can't smuggle past the denylist: good.com@evil.example resolves to host evil.example
eq("url good@evil.example -> denylist", await urlBlockReason("http://good.com@evil.example/"), "denylist:stevenblack");
try { fs.unlinkSync(fixture); } catch { /* best effort */ }

console.log(
  fails === 0
    ? "\n✓✓ SSRF guard: all DNS-free deny cases return the exact reason code.\n" +
      "   OWED to the §39 LIVE peer-gate (deployed Fly + open network): the real public-domain positive\n" +
      "   control, the Cloudflare-Families 0.0.0.0 sinkhole, and a real redirect-to-private — those\n" +
      "   require the deployed service and are NOT claimed by this headless run (§32.c honest scope)."
    : `\n✗ ${fails} guard case(s) failed — do NOT ship.`,
);
process.exit(fails === 0 ? 0 : 1);
