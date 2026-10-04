// _shared/smtp.ts — the ONE generic-SMTP seam for the comms rail (#141c).
//
// Mirrors _shared/gmail.ts / _shared/twilio.ts: a pure Deno/esm helper with NO product
// logic and NO table writes. It resolves a tenant's SMTP {user,pass} from the proven
// Vault bridge (read_channel_secret), then sends an email through the tenant's OWN SMTP
// host — handing callers a uniform, structured result. Callers own the DB/audit rows
// (send-message). §18: this is a home for the SMTP TRANSPORT only; it is dispatched from
// the SAME email OutboundChannelAdapter that already routes Gmail-vs-Resend — NOT a second
// 'email' registry entry.
//
// DESIGN CONTRACT (matches gmail.ts, §18 one home — no fork)
//   • Structured result, never a throw for a transport-level failure: every call resolves
//     to { ok, status, error, data, needs_config? }. A missing Vault secret is an HONEST
//     needs_config degrade (§13), NOT a crash and NEVER a faked send.
//   • Secrets NEVER appear in an error string or a log. {user,pass} travel only in the
//     SMTP AUTH exchange; denomailer's debug logging is left OFF (default), and echoed
//     errors are capped AND scrubbed of the password defensively.
//   • CREDENTIAL STORAGE (§9/§34): the {user,pass} pair lives ONLY in Vault as a JSON
//     blob, addressed by channel_connectors.credentials_vault_ref (a NAME). Non-secret
//     host/port/secure live in channel_connectors.config (jsonb). resolveSmtpCreds reads
//     the blob back through read_channel_secret (the same SECURITY-DEFINER, service_role-
//     only RPC gmail.ts/twilio.ts use) — the creds are never a column and never logged.
//
// SSRF GUARD (CRITICAL, §9/§13) — the SMTP host is TENANT-SUPPLIED, so it is an SSRF /
// internal-port-scan vector. assertHostAllowed() runs BEFORE any socket, in BOTH smtpSend
// AND the connect-test (smtp-connect): it rejects a non-mail port, the literal "localhost",
// and any host whose RESOLVED A/AAAA address falls in a private / loopback / link-local /
// reserved range (checking the resolved IP defeats a DNS record that points at an internal
// host). Honest structured error (smtp_host_not_allowed), never a connect.
//
// §14: denomailer is the ONE justified new dependency — Deno ships no native SMTP client,
// and re-implementing SMTP + STARTTLS + AUTH by hand would be far more code and risk than
// a pinned, well-attested library. Pinned to a specific tag (no floating version).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// -----------------------------------------------------------------------------
// Result + client shapes (mirror gmail.ts)
// -----------------------------------------------------------------------------

/** Uniform return of every SMTP seam call. `data` is the parsed payload on success. */
export interface SmtpResult<T = Record<string, unknown>> {
  ok: boolean;
  /** HTTP-ish status, or 0 for a transport-level failure (never reached the host). */
  status: number;
  /** Structured error message on failure, else null. Never contains a secret. */
  error: string | null;
  /** Parsed payload on success, else null. */
  data: T | null;
  /**
   * Present + true when the call could not run because something isn't wired yet —
   * no Vault ref, an empty/rotated-away secret, an incomplete cred blob. An HONEST
   * degrade (§13), distinct from a send failure, so callers branch to "not configured"
   * UX rather than "send failed".
   */
  needs_config?: boolean;
}

/**
 * Loose structural type for the supabase-js admin (service-role) client this helper
 * needs — kept permissive (mirrors gmail.ts's SupabaseAdminLike) so any service-role
 * SupabaseClient assigns without friction and smtp.ts stays dependency-free.
 */
// deno-lint-ignore no-explicit-any
export type SupabaseAdminLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const MAX_ERROR_BODY = 400; // cap echoed error bodies (belt-and-suspenders on secrets)

/** The mail-submission ports we permit — everything else is an internal-port-scan vector. */
const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2525]);

/**
 * Strip CR/LF (and surrounding whitespace) from a header-bound value before it reaches
 * the message. Without this, a `\r\n` in a caller-supplied From/To/Subject would inject
 * arbitrary headers (e.g. a hidden Bcc that exfiltrates the send) — the SAME anti-injection
 * discipline gmail.ts uses (§13 no injection holes).
 */
function sanitizeHeaderValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

/** Cap + scrub a thrown error message so a stray payload can never smuggle out the password. */
function scrubError(message: string, secret: string): string {
  let out = String(message);
  if (secret && secret.length > 0) out = out.split(secret).join("***");
  return out.slice(0, MAX_ERROR_BODY);
}

// -----------------------------------------------------------------------------
// SSRF GUARD (§9/§13) — reject internal hosts/ports BEFORE any socket.
// -----------------------------------------------------------------------------

/** Parse a dotted-quad IPv4 to a uint32, or null if it isn't a valid literal. */
function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

/** True when an IPv4 literal falls in ANY private / loopback / link-local / reserved range. */
function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → fail closed (block)
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||        // "this network"
    inRange("10.0.0.0", 8) ||       // private
    inRange("100.64.0.0", 10) ||    // CGNAT
    inRange("127.0.0.0", 8) ||      // loopback
    inRange("169.254.0.0", 16) ||   // link-local
    inRange("172.16.0.0", 12) ||    // private
    inRange("192.0.0.0", 24) ||     // IETF protocol
    inRange("192.0.2.0", 24) ||     // TEST-NET-1
    inRange("192.168.0.0", 16) ||   // private
    inRange("198.18.0.0", 15) ||    // benchmarking
    inRange("198.51.100.0", 24) ||  // TEST-NET-2
    inRange("203.0.113.0", 24) ||   // TEST-NET-3
    inRange("224.0.0.0", 4) ||      // multicast
    inRange("240.0.0.0", 4)         // reserved (incl. 255.255.255.255)
  );
}

/** Expand an IPv6 literal (incl. `::` and embedded IPv4) to 16 bytes, or null if invalid. */
function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct); // drop a zone id

  // Embedded IPv4 tail (e.g. ::ffff:192.168.0.1 or 64:ff9b::192.0.2.1).
  const embedded: string[] = [];
  if (s.includes(".")) {
    const idx = s.lastIndexOf(":");
    if (idx < 0) return null;
    const n = ipv4ToInt(s.slice(idx + 1));
    if (n === null) return null;
    embedded.push(((n >>> 16) & 0xffff).toString(16), (n & 0xffff).toString(16));
    s = s.slice(0, idx); // keep the colon-separated head, drop the dotted quad
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (str: string): string[] => (str.length ? str.split(":").filter((g) => g.length > 0) : []);
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const provided = head.length + tail.length + embedded.length;

  let ordered: string[];
  if (halves.length === 2) {
    if (provided > 8) return null;
    const zeros = new Array(8 - provided).fill("0");
    ordered = [...head, ...zeros, ...tail, ...embedded]; // zero-fill sits at the `::`
  } else {
    ordered = [...head, ...embedded];
  }
  if (ordered.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of ordered) {
    const v = parseInt(g, 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 255, v & 255);
  }
  return bytes;
}

/** True when an IPv6 literal is loopback/unspecified/ULA/link-local, or an embedded blocked v4. */
function isBlockedV6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (b === null) return true; // unparseable → fail closed (block)
  const allZeroExceptLast = b.slice(0, 15).every((x) => x === 0);
  if (allZeroExceptLast && b[15] === 1) return true; // ::1 loopback
  if (b.every((x) => x === 0)) return true;          // :: unspecified
  if ((b[0] & 0xfe) === 0xfc) return true;           // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  // IPv4-mapped ::ffff:0:0/96 → validate the embedded v4.
  const mappedPrefix = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  // NAT64 64:ff9b::/96 → validate the embedded v4.
  const nat64Prefix = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b &&
    b.slice(4, 12).every((x) => x === 0);
  if (mappedPrefix || nat64Prefix) {
    const v4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    return isBlockedV4(v4);
  }
  return false;
}

/** True when an already-resolved IP literal (v4 or v6) is in a blocked range. */
function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedV6(ip) : isBlockedV4(ip);
}

/**
 * SSRF/port guard — the ONE gate every SMTP socket passes through (§9). Rejects, BEFORE
 * any connection:
 *   • a port outside the mail allowlist {25,465,587,2525},
 *   • the literal "localhost" (and *.localhost),
 *   • an empty/CRLF host,
 *   • a host that RESOLVES (A/AAAA) to a private/loopback/link-local/reserved IP — checking
 *     the RESOLVED address, not the name, defeats a public-looking hostname that points at an
 *     internal box (DNS-record trick). ALL resolved addresses are validated; if ANY is blocked,
 *     the host is rejected.
 *
 * Returns { ok:true } to proceed, else { ok:false, error } with a machine reason code.
 *
 * §13/§32 HONEST RESIDUAL: denomailer re-resolves DNS when it opens the socket, so a
 * classic DNS-rebinding attacker could theoretically flip the record between this check and
 * that connect (TOCTOU). We minimize the window by validating immediately before the send and
 * rejecting on ANY blocked address; a fully rebinding-proof guard would require connecting to
 * the pre-validated IP, which breaks TLS certificate/SNI validation and would mean forking
 * denomailer. Validating all A/AAAA records right before connect is the strongest practical
 * guard without that fork — stated plainly, not silently assumed away.
 */
export async function assertHostAllowed(
  host: string,
  port: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!ALLOWED_SMTP_PORTS.has(port)) {
    return { ok: false, error: "smtp_port_not_allowed" };
  }
  const clean = sanitizeHeaderValue(host).toLowerCase();
  if (!clean || clean !== String(host).trim().toLowerCase()) {
    // Empty, or a CRLF/whitespace-bearing host — reject rather than normalize away an attack.
    return { ok: false, error: "smtp_host_invalid" };
  }
  if (clean === "localhost" || clean.endsWith(".localhost")) {
    return { ok: false, error: "smtp_host_not_allowed" };
  }

  // If the host IS an IP literal, validate it directly — no DNS to resolve.
  const isV4Literal = ipv4ToInt(clean) !== null;
  const isV6Literal = clean.includes(":") && ipv6ToBytes(clean.replace(/^\[|\]$/g, "")) !== null;
  if (isV4Literal || isV6Literal) {
    const lit = clean.replace(/^\[|\]$/g, "");
    return isBlockedIp(lit) ? { ok: false, error: "smtp_host_not_allowed" } : { ok: true };
  }

  // Resolve the hostname and validate EVERY resolved address (§9 — check the resolved IP).
  const addrs: string[] = [];
  for (const kind of ["A", "AAAA"] as const) {
    try {
      const recs = await Deno.resolveDns(clean, kind);
      for (const r of recs) addrs.push(r);
    } catch {
      // NXDOMAIN / no records of this kind — ignore; the other family may resolve.
    }
  }
  if (addrs.length === 0) {
    return { ok: false, error: "smtp_host_unresolvable" };
  }
  for (const ip of addrs) {
    if (isBlockedIp(ip)) return { ok: false, error: "smtp_host_not_allowed" };
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Credential resolution — Vault bridge (§9, mirrors resolveGmailAccessToken)
// -----------------------------------------------------------------------------

/**
 * Resolve a tenant's SMTP {user,pass} from Vault: read the JSON blob from the connector's
 * credentials_vault_ref via read_channel_secret (the ONLY path an edge fn can decrypt a
 * Vault secret), then JSON.parse it. Returns:
 *   • ok:true  + data:{ user, pass }   — ready to send
 *   • ok:false + needs_config:true     — no ref / empty secret / incomplete blob
 *   • ok:false + error                 — a real lookup / parse failure
 *
 * MUST be called with a SERVICE-ROLE client — read_channel_secret is granted to
 * service_role only, and the credentials must never transit an anon/authenticated context.
 */
export async function resolveSmtpCreds(
  admin: SupabaseAdminLike,
  credentialsVaultRef: string | null | undefined,
): Promise<SmtpResult<{ user: string; pass: string }>> {
  if (!credentialsVaultRef) {
    return { ok: false, status: 0, error: "smtp_vault_ref_missing", data: null, needs_config: true };
  }
  const { data: secret, error: secErr } = await admin.rpc("read_channel_secret", {
    _ref: credentialsVaultRef,
  });
  if (secErr) {
    return {
      ok: false, status: 0,
      error: `smtp_vault_read_failed: ${String((secErr as { message?: string })?.message ?? secErr).slice(0, MAX_ERROR_BODY)}`,
      data: null,
    };
  }
  const raw = typeof secret === "string" ? secret : "";
  if (!raw) {
    return { ok: false, status: 0, error: "smtp_vault_ref_empty", data: null, needs_config: true };
  }
  let parsed: { user?: unknown; pass?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt/legacy blob — honest failure, never a silent send with empty creds (§13).
    return { ok: false, status: 0, error: "smtp_vault_ref_malformed", data: null };
  }
  const user = typeof parsed?.user === "string" ? parsed.user : "";
  const pass = typeof parsed?.pass === "string" ? parsed.pass : "";
  if (!user || !pass) {
    return { ok: false, status: 0, error: "smtp_credentials_incomplete", data: null, needs_config: true };
  }
  return { ok: true, status: 200, error: null, data: { user, pass } };
}

// -----------------------------------------------------------------------------
// Send — SSRF-guard, connect (STARTTLS/implicit TLS), AUTH, send, close.
// -----------------------------------------------------------------------------

export interface SmtpSendInput {
  host: string;
  port: number;
  /** true = implicit TLS (465). false/undefined = STARTTLS (587/25/2525). */
  secure?: boolean | null;
  user: string;
  pass: string;
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  /** RFC 5322 In-Reply-To (a provider message-id) when replying in a thread. */
  inReplyTo?: string | null;
  /** Extra headers (e.g. List-Unsubscribe). Names must be RFC 5322 tokens; values are CRLF-stripped. */
  headers?: Record<string, string> | null;
}

/**
 * Send one email through a tenant's OWN SMTP host. SSRF-guards the host/port FIRST, then
 * connects (implicit TLS for 465, STARTTLS otherwise — denomailer never falls back to
 * cleartext because allowUnsecure is left OFF, so the AUTH credentials are never sent in the
 * clear), authenticates, sends, and closes. Returns a structured SmtpResult — never a throw
 * for a transport failure, never a faked success (§13).
 *
 * §13 HONESTY on the message id: the SMTP submission protocol (and denomailer's send(), which
 * resolves to void) does NOT return a durable per-message id, so data.messageId is honestly
 * null — we never fabricate one. The send is still recorded via the connector + audit row.
 */
export async function smtpSend(
  input: SmtpSendInput,
): Promise<SmtpResult<{ messageId: string | null }>> {
  // ── SSRF/port guard BEFORE any socket (§9/§13). ──
  const guard = await assertHostAllowed(input.host, input.port);
  if (!guard.ok) {
    return { ok: false, status: 0, error: guard.error ?? "smtp_host_not_allowed", data: null };
  }

  // Every header-bound field is CRLF-stripped before it reaches the message (§13 anti-injection).
  const from = sanitizeHeaderValue(input.from);
  const to = sanitizeHeaderValue(input.to);
  const subject = sanitizeHeaderValue(input.subject || "(no subject)");
  const fromNameClean = input.fromName ? sanitizeHeaderValue(String(input.fromName).replace(/[<>]/g, " ")) : "";
  const fromHeader = fromNameClean ? `${fromNameClean} <${from}>` : from;

  const html = input.html && input.html.length > 0 ? String(input.html) : undefined;
  // denomailer needs at least one of content/html; default a space when a caller sent neither.
  const content = input.text && input.text.length > 0 ? String(input.text) : (html ? undefined : " ");

  const implicitTls = input.secure ?? (input.port === 465);

  let client: SMTPClient | null = null;
  try {
    client = new SMTPClient({
      connection: {
        hostname: input.host,
        port: input.port,
        tls: implicitTls, // true = implicit TLS (465); false = STARTTLS (allowUnsecure OFF → no cleartext)
        auth: { username: input.user, password: input.pass },
      },
    });
    await client.send({
      from: fromHeader,
      to,
      subject,
      content,
      html,
      inReplyTo: input.inReplyTo ? sanitizeHeaderValue(input.inReplyTo) : undefined,
      headers: Object.fromEntries(Object.entries(input.headers ?? {})
        .filter(([name]) => /^[A-Za-z0-9-]{1,64}$/.test(name))
        .map(([name, value]) => [name, sanitizeHeaderValue(String(value))])),
    });
    // §13: no durable id from the protocol — honestly null, never fabricated.
    return { ok: true, status: 200, error: null, data: { messageId: null } };
  } catch (e) {
    return {
      ok: false, status: 0,
      error: `smtp_send_failed: ${scrubError((e as Error).message, input.pass)}`,
      data: null,
    };
  } finally {
    try {
      await client?.close();
    } catch {
      // best-effort close — a close fault never changes the send disposition.
    }
  }
}
