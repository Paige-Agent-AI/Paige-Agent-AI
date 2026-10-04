// SSRF egress guard + two-layer content denylist for the Paige browser services (Slice 3a).
//
// EXTRACTED to its OWN module (§18 one home) so BOTH server.js AND the smoke test import the SAME
// real code — a security guard must be tested as-shipped, never as a hand-copied mirror that can drift
// (§32: a green build is not a working guard). It is also the consolidation seam for #138 (the guard
// was once duplicated in services/visual-renderer — that service is deleted; render.mjs imports this).
//
// Every function returns a REASON CODE (null = allowed) so the response + the paige_browser_usage
// audit rail carry the SPECIFIC block cause (§13 honest reporting), never a generic "blocked".
//
// Coverage: private IPv4 (10/172.16/192.168), loopback (127/::1), link-local + cloud-metadata
// (169.254.0.0/16, 169.254.169.254 flagged distinctly), CGNAT (100.64/10), reserved/broadcast/
// multicast (0/8, 224/4, 240/4, 192.0.0.0/24, TEST-NETs, 198.18/15), IPv6 ULA/link-local (fc00::/7,
// fe80::/10), IPv6 multicast/doc (ff00::/8, 2001:db8::/32), and the embedded-v4 tunnels — ::ffff:
// (dotted + hex IPv4-mapped), 6to4 (2002::/16), NAT64 (64:ff9b::/96). WHATWG `new URL()` normalizes
// numeric-encoded hosts (decimal/hex/octal/short) to dotted-decimal and strips `user@host` userinfo,
// so those bypass classes are closed by the parser (locked by smoke-ssrf.mjs).
//
// §13/#138 caveat: DNS-rebinding (a hostile short-TTL record that resolves PUBLIC for this check then
// PRIVATE for Chromium's own socket connect) is NOT fully closed — one shared warm browser can't pin
// a per-request resolver. Mid-REDIRECT to a literal internal host IS caught (the caller re-checks the
// final URL + a per-request route interceptor). Full rebind closure is tracked as #138.
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";

// ── Layer-2 content denylist: StevenBlack/hosts (downloaded to /app/blocklist.txt at image build) ──
// A hostname is denied if IT or any PARENT domain is listed (sub.evil.com blocked when evil.com is).
// Missing file (local dev / failed build fetch) -> empty Set -> no-op layer (the SSRF private-IP guard
// + Cloudflare Families still hold). Loaded from PAIGE_BROWSER_DENYLIST_PATH (default /app/blocklist.txt).
// HONEST REFRESH STATUS (§13): this is a BUILD-TIME snapshot, refreshed only on image rebuild. A
// scheduled weekly refresh is a tracked follow-up (task #151), not yet built.
const DENYLIST = new Set();
export function loadDenylist(pathOverride) {
  DENYLIST.clear();
  const path = pathOverride || process.env.PAIGE_BROWSER_DENYLIST_PATH || "/app/blocklist.txt";
  try {
    const raw = fs.readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      // hosts-file rows are "0.0.0.0 domain.com" / "127.0.0.1 domain.com"; take the domain token.
      const parts = t.split(/\s+/);
      const domain = (parts.length >= 2 ? parts[1] : parts[0]).toLowerCase();
      if (domain && domain !== "0.0.0.0" && domain !== "127.0.0.1" && domain !== "localhost" && domain.includes(".")) {
        DENYLIST.add(domain);
      }
    }
    console.log(`[ssrf-guard] denylist loaded: ${DENYLIST.size} domains from ${path}`);
  } catch (e) {
    console.log(`[ssrf-guard] denylist not loaded (${e?.code || e?.message || "missing"}); Layer-2 content denylist is a no-op`);
  }
  return DENYLIST.size;
}
export function denylistSize() { return DENYLIST.size; }
export function isDenylisted(host) {
  if (DENYLIST.size === 0) return false;
  const labels = String(host).toLowerCase().split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DENYLIST.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

// Decode an embedded IPv4 out of two 16-bit hex groups (6to4 / NAT64 / hex IPv4-mapped) -> "a.b.c.d".
function embeddedV4(hiHex, loHex) {
  const hi = parseInt(hiHex || "0", 16), lo = parseInt(loHex || "0", 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

// Returns a category string for a blocked IP, or null if the IP is a routable public address.
export function ipBlockReason(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 127) return "loopback";                                            // 127.0.0.0/8
    if (a === 0) return "reserved";                                              // 0.0.0.0/8 (this-host/any)
    if (a === 10) return "private-ipv4";                                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return "private-ipv4";                  // 172.16.0.0/12
    if (a === 192 && b === 168) return "private-ipv4";                           // 192.168.0.0/16
    if (a === 169 && b === 254) return ip === "169.254.169.254" ? "link-local:metadata" : "link-local"; // 169.254.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";                        // 100.64.0.0/10
    if (a === 192 && b === 0 && c === 0) return "reserved";                      // 192.0.0.0/24 (IETF)
    if (a === 192 && b === 0 && c === 2) return "reserved";                      // 192.0.2.0/24 TEST-NET-1
    if (a === 198 && b === 51 && c === 100) return "reserved";                   // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return "reserved";                    // 203.0.113.0/24 TEST-NET-3
    if (a === 198 && (b === 18 || b === 19)) return "reserved";                  // 198.18.0.0/15 benchmarking
    if (a >= 224) return "reserved";                                             // 224/4 multicast + 240/4 reserved + 255.255.255.255 broadcast
    return null;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1") return "loopback";
    if (s === "::") return "reserved";
    if (s.startsWith("fe80")) return "private-ipv6";                             // fe80::/10 link-local
    if (s.startsWith("fc") || s.startsWith("fd")) return "private-ipv6";         // fc00::/7 ULA
    if (s.startsWith("ff")) return "reserved";                                   // ff00::/8 multicast
    if (s.startsWith("2001:db8")) return "reserved";                             // 2001:db8::/32 documentation
    const dotted = s.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);      // ::ffff:a.b.c.d (dotted IPv4-mapped)
    if (dotted) return ipBlockReason(dotted[1]);
    const hexMapped = s.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);        // ::ffff:HHHH:HHHH (hex IPv4-mapped)
    if (hexMapped) { const v4 = embeddedV4(hexMapped[1], hexMapped[2]); if (v4) return ipBlockReason(v4); }
    if (s.startsWith("2002:")) { const p = s.split(":"); const v4 = embeddedV4(p[1], p[2]); const r = v4 && ipBlockReason(v4); return r || "reserved"; } // 6to4
    if (s.startsWith("64:ff9b:")) { const p = s.split(":").filter(Boolean); const v4 = embeddedV4(p[p.length - 2], p[p.length - 1]); const r = v4 && ipBlockReason(v4); return r || "reserved"; } // NAT64
    return null;
  }
  return null;
}

const _dnsCache = new Map(); // host -> {reason:string|null, at:number}
// Returns a "ssrf:*" / "denylist:*" reason for a blocked host, or null if allowed. Fail-closed on any
// resolution failure (unresolvable host -> "ssrf:unresolved").
export async function hostBlockReason(host) {
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "ssrf:loopback";
  if (isDenylisted(h)) return "denylist:stevenblack";
  if (net.isIP(h)) { const r = ipBlockReason(h); return r ? `ssrf:${r}` : null; }
  const hit = _dnsCache.get(h);
  if (hit && Date.now() - hit.at < 30_000) return hit.reason;
  let reason = "ssrf:unresolved"; // fail-closed if we can't resolve
  try {
    const addrs = await dns.lookup(h, { all: true });
    if (addrs.length > 0) {
      reason = null;
      for (const a of addrs) {
        if (a.address === "0.0.0.0") { reason = "denylist:cloudflare-families"; break; } // Families sinkhole answer
        const r = ipBlockReason(a.address);
        if (r) { reason = `ssrf:${r}`; break; }
      }
    }
  } catch {
    reason = "ssrf:unresolved";
  }
  _dnsCache.set(h, { reason, at: Date.now() });
  return reason;
}

// Back-compat boolean wrapper — /self-verify + the page.route interceptor keep exact behavior (§58).
export async function hostIsPrivate(host) { return (await hostBlockReason(host)) !== null; }

// Returns a reason code for a blocked URL (scheme or host), or null if allowed.
export async function urlBlockReason(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return "scheme:invalid-url"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "ssrf:scheme";
  return await hostBlockReason(u.hostname);
}

export async function assertPublicUrl(raw) {
  const reason = await urlBlockReason(raw);
  if (reason) throw new Error(`blocked: ${reason}`);
}

// A read-only page is an egress policy, not merely a navigation policy. Page JavaScript may issue
// writes to an otherwise-public host, so only safe retrieval methods are allowed through Chromium.
export function requestMethodBlockReason(method) {
  const normalized = String(method || "").toUpperCase();
  return normalized === "GET" || normalized === "HEAD" ? null : "method:not-read-only";
}

// Install the actual browser egress fence on the BrowserContext before any page exists. Context-level
// routing covers the initial request of popups as well as navigation and subresources in existing pages.
// `fallback()` keeps this composable with test instrumentation while the last handler reaches the network.
export async function installReadOnlyBrowserEgress(context) {
  await context.routeWebSocket("**/*", (ws) => ws.close());
  await context.route("**/*", async (route) => {
    try {
      if (requestMethodBlockReason(route.request().method())) return route.abort("blockedbyclient");
      const host = new URL(route.request().url()).hostname;
      if (await hostIsPrivate(host)) return route.abort("blockedbyclient");
      return route.fallback();
    } catch {
      return route.abort("blockedbyclient");
    }
  });
}
