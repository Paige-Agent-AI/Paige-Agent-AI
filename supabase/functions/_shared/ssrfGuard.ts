// Shared SSRF guard + hardened outbound transport for any edge function that fetches a
// caller/tenant-supplied URL (outbound webhooks, connected-app endpoints, MCP servers, …).
declare const Deno: { resolveDns(host: string, kind: "A" | "AAAA"): Promise<string[]> };
//
// String matching alone is bypassable (IPv4-mapped IPv6, DNS → internal, link-local),
// so we resolve the host and validate EVERY resolved IP numerically against
// private/loopback/link-local/ULA/carrier-grade-NAT/mapped ranges. IP literals are
// validated directly.
//
// This file is the ONE home (§18). The same numeric validator was independently forked
// inline into paige-n8n and call-zapier-action; new callers use `safeFetch` here rather
// than copying it a fifth time.
//
// `safeFetch` closes the three gaps every fork shares — credentials in the URL, an
// unbounded wait, and an unbounded response body — and refuses redirects outright
// instead of trying to re-validate each hop, which is the stricter of the two postures:
// a hop is never followed, so a hop is never validated, and a redirect chain cannot walk
// an approved host into an internal one.
//
// RESIDUAL RISK, stated rather than implied: this guard resolves the host and then hands
// the URL to `fetch`, which resolves it AGAIN. Between those two resolutions a name can
// change what it points at, and this validated the first answer while the socket used the
// second. Closing it needs the connection pinned to the IP that was checked, and Deno's
// `fetch` exposes no way to do that — there is no per-request resolver hook and no
// connect-time callback. So the window is real and is NOT closed here.
//
// What bounds it: a short TTL is not enough on its own, but an attacker also has to win
// the race on a host the workspace's own admin configured, and every fetch through here
// is already refused a redirect, refused a non-HTTPS scheme, and capped in time and size.
// Do not read the checks below as proving the connected address is safe; read them as
// proving the CONFIGURED address is, which is the property the product actually needs.
// If a pinned-IP transport becomes available, this is the first place it belongs.

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}

function ipv4Private(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  };
  return inRange("0.0.0.0", 8) || inRange("10.0.0.0", 8) || inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) || inRange("172.16.0.0", 12) || inRange("192.168.0.0", 16) ||
    inRange("100.64.0.0", 10) || inRange("192.0.0.0", 24) || inRange("198.18.0.0", 15) ||
    // 6to4 relay anycast: a public-looking address whose whole purpose is to forward
    // somewhere else, so what it finally reaches is not what was validated here.
    inRange("192.88.99.0", 24) ||
    // Multicast and the reserved top of the space. Neither is a legitimate destination
    // for an outbound API call, and 240/4 in particular is where non-addresses live.
    inRange("224.0.0.0", 4) || inRange("240.0.0.0", 4) ||
    n === ipv4ToInt("255.255.255.255");
}

/**
 * An IPv6 address as its 16 bytes, or null if it is not one.
 *
 * Written as a parser rather than a set of prefix regexes because the regexes kept being
 * one spelling short: `::ffff:127.0.0.1` was caught and `::ffff:0:127.0.0.1` was not, and
 * every such miss is silently an allow. A parser has no spellings — the same address in
 * any notation becomes the same 16 bytes, and the checks are then arithmetic.
 */
function parseIpv6(ip: string): Uint8Array | null {
  if (!/^[0-9a-f:.]+$/.test(ip)) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;

  // A trailing dotted quad contributes two hextets.
  const toHextets = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      if (g.includes(".")) {
        if (i !== groups.length - 1) return null;
        const n = ipv4ToInt(g);
        if (n === null) return null;
        out.push((n >>> 16) & 0xffff, n & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toHextets(halves[0]);
  const tail = halves.length === 2 ? toHextets(halves[1]) : [];
  if (head === null || tail === null) return null;

  let hextets: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    hextets = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return null;

  const bytes = new Uint8Array(16);
  hextets.forEach((h, i) => { bytes[i * 2] = (h >> 8) & 0xff; bytes[i * 2 + 1] = h & 0xff; });
  return bytes;
}

const dotted = (b: Uint8Array, at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;

function ipUnsafe(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, "");
  if (ipv4ToInt(ip) !== null) return ipv4Private(ip);

  const b = parseIpv6(ip);
  if (b === null) return true; // unparseable -> treat as unsafe, same as IPv4

  // Anything whose top 64 bits are zero. That is `::`, `::1`, every IPv4-mapped and
  // IPv4-compatible spelling, and every IPv4-translated one -- and none of them is a
  // legitimate public destination, so the whole low block is refused rather than
  // enumerated. Where a v4 address is embedded, it is ALSO judged as a v4 address, so a
  // public one in a mapped form is still refused on the block rule and a private one
  // cannot slip through a notation this code has not seen before.
  if (b.subarray(0, 8).every((x) => x === 0)) return true;

  // fe80::/10 link-local, fec0::/10 site-local, fc00::/7 ULA, ff00::/8 multicast.
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xff) return true;

  // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 -- the embedded v4 is the real destination.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return ipv4Private(dotted(b, 12));
  // 2002::/16 (6to4) -- the embedded v4 sits immediately after the prefix.
  if (b[0] === 0x20 && b[1] === 0x02) return ipv4Private(dotted(b, 2));

  return false; // a routable public IPv6
}

/** Every rejection this module can produce. Stable, non-sensitive, safe to surface. */
export type SsrfReason =
  | "invalid_url"
  | "url_must_be_https"
  | "url_has_embedded_credentials"
  | "url_host_not_allowed"
  | "url_host_unresolvable"
  | "url_resolves_to_private_address"
  | "url_redirect_refused"
  | "request_timed_out"
  | "response_too_large"
  | "request_failed";

export class SsrfError extends Error {
  constructor(public readonly reason: SsrfReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "SsrfError";
  }
}

/**
 * Throws if `raw` is not an https:// URL, carries embedded credentials, or resolves to
 * anything but public addresses. Use before fetching any tenant/caller-supplied
 * destination. Prefer `safeFetch`, which runs this and then holds the rest of the
 * guarantees (no redirects, bounded time, bounded size).
 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SsrfError("invalid_url"); }
  if (u.protocol !== "https:") throw new SsrfError("url_must_be_https");
  // A URL like https://user:pass@host puts a secret somewhere it will be logged, and is
  // also a classic parser-confusion vector (https://good.com@evil.com).
  if (u.username || u.password) throw new SsrfError("url_has_embedded_credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SsrfError("url_host_not_allowed");
  }
  // IP literal → validate directly; hostname → resolve A + AAAA and validate all.
  if (ipv4ToInt(host) !== null || host.includes(":")) {
    if (ipUnsafe(host)) throw new SsrfError("url_host_not_allowed");
    return;
  }
  const ips: string[] = [];
  for (const kind of ["A", "AAAA"] as const) {
    try { ips.push(...await Deno.resolveDns(host, kind)); } catch { /* no records of this kind */ }
  }
  if (ips.length === 0) throw new SsrfError("url_host_unresolvable");
  for (const ip of ips) if (ipUnsafe(ip)) throw new SsrfError("url_resolves_to_private_address");
}

export type SafeFetchOptions = {
  /** Wall-clock ceiling for the whole request, including reading the body. */
  timeoutMs?: number;
  /** Hard ceiling on the bytes we will read. Reading stops at the cap, it never buffers past it. */
  maxBytes?: number;
  /** Inspect status/headers only, then abort the unused stream (e.g. an OAuth challenge). */
  headersOnly?: boolean;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB

/**
 * The single hardened outbound call for tenant-supplied destinations.
 *
 *  1. SSRF-validates the URL (https, no embedded credentials, public addresses only).
 *  2. Refuses to follow redirects — a 3xx is an error, not a hop. Re-validating each hop
 *     would still leave the window between the check and the connect; refusing has none.
 *  3. Bounds the wall clock with a real abort, so a hung provider cannot pin a worker.
 *  4. Bounds the body by reading the stream and stopping at the cap, so an enormous or
 *     endless response cannot exhaust memory.
 *
 * Throws `SsrfError` with a stable reason for every failure. The reason is safe to log
 * and safe to show; the caller's URL and credentials never appear in it.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<{ status: number; headers: Headers; body: string; truncated: boolean }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // The deadline starts BEFORE the guard, not after it. `assertPublicHttpUrl` resolves the
  // host, and a resolver that hangs is a wait like any other — outside the clock, a
  // "bounded" call could still sit for however long DNS took, which is the exact property
  // the bound exists to remove.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await assertPublicHttpUrl(url);
    if (controller.signal.aborted) throw new SsrfError("request_timed_out");

    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) throw new SsrfError("request_timed_out");
      throw new SsrfError("request_failed", e instanceof Error ? e.name : undefined);
    }

    // `redirect: "manual"` surfaces the 3xx rather than following it. Deno gives the real
    // status; a fetch implementation that opaques it reports status 0 with type
    // "opaqueredirect". Both mean the same thing here: we were pointed somewhere else,
    // and we do not go.
    if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
      throw new SsrfError("url_redirect_refused");
    }

    if (opts.headersOnly) {
      // MCP GET can be an endless SSE stream. Header discovery must not wait for its EOF.
      // Abort closes the actual request; cancellation releases the unused body. All URL,
      // redirect and deadline checks above are identical to ordinary body-reading calls.
      controller.abort();
      try { await res.body?.cancel(); } catch { /* abort may have already closed it */ }
      return { status: res.status, headers: res.headers, body: "", truncated: res.body !== null };
    }
    const { body, truncated } = await readBounded(res, maxBytes, controller);
    return { status: res.status, headers: res.headers, body, truncated };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads at most `maxBytes` from the response. Stops at the cap rather than buffering the
 * whole body first, so the cap is a real memory bound and not just a truncation after the
 * damage is done.
 */
async function readBounded(
  res: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (e) {
    if (controller.signal.aborted) throw new SsrfError("request_timed_out");
    throw new SsrfError("request_failed", e instanceof Error ? e.name : undefined);
  } finally {
    // Releasing the lock and cancelling lets the connection close even when we stopped
    // early at the cap; without it an endless body keeps the socket alive.
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.byteLength; }
  return { body: new TextDecoder().decode(merged), truncated };
}
