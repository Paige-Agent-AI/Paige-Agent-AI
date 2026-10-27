// SendGrid Inbound Parse — the pure half of handle-inbound-email's SendGrid arm.
//
// Replies to PAIGE's managed `<slug>@mail.paigeagent.ai` senders arrive here once the owner points
// SendGrid → Settings → Inbound Parse (host `mail.paigeagent.ai`) at this function. SendGrid POSTs the
// parsed email as multipart/form-data (default "parsed" mode, not "raw"): `from`, `to`, `cc`, `subject`,
// `text`, `html`, `headers` (the raw header block), `envelope` (JSON: `to` array + `from`), `attachments`
// (a count), `attachment-info` (JSON), `attachment1..N` (files), `charsets` (JSON), `spam_score`,
// `spam_report`, `SPF`, `dkim`, `sender_ip`, `content-ids`. Field list per SendGrid's "Setting Up the
// Inbound Parse Webhook" reference (read 2026-10-27).
//
// Everything here is IO-free: authentication of the request, field extraction, and the inbound
// adapter's pure mapping to a NormalizedMessage. Tenant, contact, connector and the stored provider id
// are resolved by the handler against the database (§9: never from the payload).
import type {
  InboundChannelAdapter,
  MessageParty,
  NormalizedMessage,
} from "../_shared/channel-adapters.ts";
import { constantTimeEquals } from "../_shared/service-role-bearer.ts";

/** The edge secret NAME gating this arm. Its value is never logged, echoed or stored. */
export const SENDGRID_INBOUND_PARSE_SECRET_NAME = "SENDGRID_INBOUND_PARSE_SECRET";

/**
 * Request body ceiling. SendGrid rejects inbound mail over 30 MB itself; the multipart envelope adds a
 * little, so 32 MiB admits every message SendGrid will deliver and nothing much larger.
 */
export const SENDGRID_INBOUND_MAX_BYTES = 32 * 1024 * 1024;

/** At most this many attachments are DESCRIBED in meta; their bytes are never stored (no store exists). */
export const SENDGRID_INBOUND_MAX_ATTACHMENTS_DESCRIBED = 20;

const FIELD_MAX_CHARS = 1_000_000; // text / html each
const SHORT_FIELD_MAX_CHARS = 4_000; // from / to / cc / subject / spf / dkim / ...

export type InboundParseAuth =
  | { ok: true; via: "basic_auth" | "url_token" }
  | { ok: false; status: 503 | 401; reason: "inbound_parse_not_configured" | "no_proof_offered" | "bad_secret" };

/**
 * Authenticate a SendGrid Inbound Parse POST. FAILS CLOSED.
 *
 * SendGrid does not HMAC-sign Inbound Parse posts in the documentation this was built against, so the
 * proof is a shared secret the owner puts into the destination URL, carried either as HTTP basic auth
 * (`https://inbound:<secret>@<host>/functions/v1/handle-inbound-email` — the password is the proof, the
 * username is ignored) or as the `t` query parameter (`…/handle-inbound-email?t=<secret>`, the same
 * convention as the stamped Twilio webhook URLs). Compared in constant time.
 *
 * - secret unset → 503 `inbound_parse_not_configured` (nothing is processed; SendGrid keeps retrying
 *   until it is set, rather than the mail being accepted into nowhere).
 * - no proof / wrong proof → 401.
 */
export function authenticateInboundParse(req: Request, secret: string | null | undefined): InboundParseAuth {
  if (!secret) return { ok: false, status: 503, reason: "inbound_parse_not_configured" };
  let basicPassword: string | null = null;
  const authz = req.headers.get("authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(authz.trim());
  if (m) {
    try {
      const decoded = atob(m[1]);
      const colon = decoded.indexOf(":");
      basicPassword = colon >= 0 ? decoded.slice(colon + 1) : null;
    } catch {
      basicPassword = null;
    }
  }
  let urlToken: string | null = null;
  try {
    urlToken = new URL(req.url).searchParams.get("t");
  } catch {
    urlToken = null;
  }
  if (!basicPassword && !urlToken) return { ok: false, status: 401, reason: "no_proof_offered" };
  if (basicPassword && constantTimeEquals(basicPassword, secret)) return { ok: true, via: "basic_auth" };
  if (urlToken && constantTimeEquals(urlToken, secret)) return { ok: true, via: "url_token" };
  return { ok: false, status: 401, reason: "bad_secret" };
}

/** One attachment SendGrid described — metadata only; the bytes are not kept. */
export interface SendGridAttachmentInfo {
  field: string;
  filename: string | null;
  type: string | null;
  size: number | null;
}

/** The parsed-mode fields this arm reads, as plain strings. */
export interface SendGridInboundFields {
  from: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
  html: string;
  headers: string;
  envelope: string;
  spf: string;
  dkim: string;
  spam_score: string;
  sender_ip: string;
  attachment_count: number;
  attachments: SendGridAttachmentInfo[];
  /** True when `text` or `html` was longer than the per-field cap and was cut. */
  body_truncated: boolean;
}

function overCap(form: FormData, name: string, max: number): boolean {
  const v = form.get(name);
  return typeof v === "string" && v.length > max;
}

function field(form: FormData, name: string, max: number): string {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pull the parsed-mode fields out of SendGrid's form. Attachment files are counted and described, never read. */
export function sendgridFieldsFromForm(form: FormData): SendGridInboundFields {
  const info = parseJsonObject(field(form, "attachment-info", SHORT_FIELD_MAX_CHARS * 25)) ?? {};
  const declared = Number.parseInt(field(form, "attachments", 16), 10);
  const attachments: SendGridAttachmentInfo[] = [];
  let fileCount = 0;
  for (const [name, value] of form.entries()) {
    if (!/^attachment\d+$/.test(name) || typeof value === "string") continue;
    fileCount += 1;
    if (attachments.length >= SENDGRID_INBOUND_MAX_ATTACHMENTS_DESCRIBED) continue;
    const meta = (info[name] ?? {}) as Record<string, unknown>;
    const file = value as File;
    attachments.push({
      field: name,
      filename: (typeof meta.filename === "string" ? meta.filename : file.name || null)?.slice(0, 255) ?? null,
      type: (typeof meta.type === "string" ? meta.type : file.type || null)?.slice(0, 255) ?? null,
      size: typeof file.size === "number" ? file.size : null,
    });
  }
  return {
    from: field(form, "from", SHORT_FIELD_MAX_CHARS),
    to: field(form, "to", SHORT_FIELD_MAX_CHARS),
    cc: field(form, "cc", SHORT_FIELD_MAX_CHARS),
    subject: field(form, "subject", SHORT_FIELD_MAX_CHARS),
    text: field(form, "text", FIELD_MAX_CHARS),
    html: field(form, "html", FIELD_MAX_CHARS),
    headers: field(form, "headers", FIELD_MAX_CHARS),
    envelope: field(form, "envelope", SHORT_FIELD_MAX_CHARS),
    spf: field(form, "SPF", 64),
    dkim: field(form, "dkim", SHORT_FIELD_MAX_CHARS),
    spam_score: field(form, "spam_score", 32),
    sender_ip: field(form, "sender_ip", 64),
    attachment_count: Math.max(Number.isFinite(declared) ? declared : 0, fileCount),
    attachments,
    body_truncated: overCap(form, "text", FIELD_MAX_CHARS) || overCap(form, "html", FIELD_MAX_CHARS),
  };
}

/** Raw header block → lower-cased name → FIRST value, with folded continuation lines unfolded. */
export function parseHeaderBlock(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = String(block ?? "").replace(/\r\n/g, "\n").split("\n");
  let name = "";
  let value = "";
  const flush = () => {
    if (name && !out.has(name)) out.set(name, value.trim());
    name = "";
    value = "";
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && name) {
      value += " " + line.trim();
      continue;
    }
    flush();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    name = line.slice(0, colon).trim().toLowerCase();
    value = line.slice(colon + 1);
  }
  flush();
  return out;
}

/** `<id@host>` → `id@host`; empty, `<>` or whitespace → null (the caller then derives an identity). */
export function stripMessageId(v: string | undefined | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /<([^<>]*)>/.exec(s);
  const id = (m ? m[1] : s.replace(/[<>]/g, "")).trim();
  return id ? id.slice(0, 998) : null;
}

/**
 * One `Name <addr>` / `addr` / `"Last, First" <addr>` / RFC 5322 comment form `addr (Name)` → a party;
 * null when there is no address.
 */
export function parseParty(raw: string): MessageParty | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const angle = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(s);
  const comment = angle ? null : /^([^\s()<>]+@[^\s()<>]+)\s*\((.*)\)\s*$/.exec(s);
  const address = (angle ? angle[1] : comment ? comment[1] : s).trim().replace(/^mailto:/i, "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) return null;
  const name = angle
    ? s.slice(0, angle.index).trim().replace(/^"(.*)"$/, "$1").trim()
    : comment
    ? comment[2].trim().replace(/^"(.*)"$/, "$1").trim()
    : "";
  return name ? { address, display_name: name } : { address };
}

function domainOf(address: string | null | undefined): string {
  const a = String(address ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  return at >= 0 ? a.slice(at + 1) : "";
}

// Second-level labels that sit under a two-letter country code as part of the public suffix
// (`client.co.uk`, `firm.com.au`). Without a full public-suffix list this keeps the common cases
// from collapsing to a shared suffix; an unknown multi-part suffix falls back to the last two labels.
const COUNTRY_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ltd", "plc", "or", "ne", "go"]);

/** The organizational domain, approximating the DMARC definition without a public-suffix list. */
function organizationalDomain(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && COUNTRY_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** Relaxed alignment in the DMARC sense: both domains share an organizational domain. */
function aligned(a: string, b: string): boolean {
  if (!a || !b || !a.includes(".") || !b.includes(".")) return false;
  const orgA = organizationalDomain(a);
  return orgA.includes(".") && orgA === organizationalDomain(b);
}

/** SendGrid's `dkim` field, e.g. `{@sendgrid.com : pass}` (one `@domain : result` pair per signature). */
export function parseDkimResults(raw: string): Array<{ domain: string; result: string }> {
  const out: Array<{ domain: string; result: string }> = [];
  for (const m of String(raw ?? "").matchAll(/@([a-z0-9.-]+)\s*:\s*([a-z]+)/gi)) {
    out.push({ domain: m[1].toLowerCase(), result: m[2].toLowerCase() });
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Did the From domain authenticate? True when SendGrid's DKIM result is `pass` for a signing domain
 * aligned with the From domain, or its SPF result (`SPF` field, which SPF evaluates against the SMTP
 * envelope sender) is `pass` and the envelope sender's domain is aligned with the From domain.
 * Anything else — fail, softfail, neutral, none, missing, or a pass for some other domain — is not.
 */
export function senderAuthentication(
  fromAddress: string,
  envelopeFrom: string | null,
  spf: string,
  dkim: string,
): { authenticated: boolean; spf_aligned_pass: boolean; dkim_aligned_pass: boolean } {
  const fromDomain = domainOf(fromAddress);
  // SendGrid documents a bare `pass`; a result with a trailing explanation ("pass (…)") is still a pass.
  const spfAlignedPass = /^pass\b/.test(String(spf ?? "").trim().toLowerCase()) && aligned(fromDomain, domainOf(envelopeFrom));
  const dkimAlignedPass = parseDkimResults(dkim).some((d) => d.result === "pass" && aligned(fromDomain, d.domain));
  return { authenticated: spfAlignedPass || dkimAlignedPass, spf_aligned_pass: spfAlignedPass, dkim_aligned_pass: dkimAlignedPass };
}

/** A header address list → parties. Commas inside quotes or angle brackets do not split. */
export function parsePartyList(raw: string): MessageParty[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (const ch of String(raw ?? "")) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle += 1;
    else if (ch === ">" && !quoted && angle > 0) angle -= 1;
    if (ch === "," && !quoted && angle === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(parseParty).filter((p): p is MessageParty => !!p).slice(0, 100);
}

/** The SMTP envelope: the addresses SendGrid's MX actually accepted the mail for. Null when unusable. */
export function parseEnvelope(raw: string): { to: string[]; from: string | null } | null {
  const env = parseJsonObject(raw);
  if (!env) return null;
  const toRaw = Array.isArray(env.to) ? env.to : typeof env.to === "string" ? [env.to] : [];
  const to = toRaw
    .map((t) => parseParty(String(t ?? ""))?.address ?? "")
    .filter((a): a is string => !!a)
    .slice(0, 100);
  if (!to.length) return null;
  const from = typeof env.from === "string" ? (parseParty(env.from)?.address ?? null) : null;
  return { to, from };
}

/**
 * The deterministic fallback identity when the mail carries no Message-ID header: the same email
 * redelivered by SendGrid hashes to the same value, a different email to a different one. The handler
 * hashes this string with sha256.
 */
export function fallbackIdentityInput(f: SendGridInboundFields): string {
  const date = parseHeaderBlock(f.headers).get("date") ?? "";
  return [f.from, f.to, f.subject, date, f.text].join("\n");
}

function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * SendGrid Inbound Parse → NormalizedMessage. PURE mapping, registered into the channel-adapters
 * registry as the 'email' channel's `sendgrid` provider adapter.
 *
 * - recipients = the SMTP envelope `to` (what the MX accepted), which the handler routes the tenant on;
 *   the header To/Cc are display data and are kept in meta. No envelope → no recipients → the handler
 *   skips (it never routes on a header a sender wrote).
 * - provider_message_id = the RFC 5322 Message-ID (brackets stripped), or null; the handler scopes it to
 *   the resolved tenant and derives a hash identity when it is absent.
 * - attachment BYTES are not stored: nothing here has a store to put them in, and `attachments` only
 *   ever holds resolvable URLs (§13). They are counted and described in meta.
 */
export const sendgridInboundAdapter: InboundChannelAdapter = {
  channel_type: "email",
  provider: "sendgrid",
  onEvent(raw: unknown): NormalizedMessage {
    const f = raw as SendGridInboundFields;
    const headers = parseHeaderBlock(f.headers);
    const sender = parseParty(f.from) ?? parseParty(headers.get("from") ?? "") ?? { address: "" };
    const envelope = parseEnvelope(f.envelope);
    const recipients: MessageParty[] = (envelope?.to ?? []).map((address) => ({ address }));
    const rfcMessageId = stripMessageId(headers.get("message-id"));
    const inReplyTo = stripMessageId(headers.get("in-reply-to"));
    const headerTo = parsePartyList(f.to || headers.get("to") || "").map((p) => p.address);
    const headerCc = parsePartyList(f.cc || headers.get("cc") || "").map((p) => p.address);
    const auth = senderAuthentication(sender.address, envelope?.from ?? null, f.spf, f.dkim);
    return {
      thread_key: sender.address,
      channel_type: "email",
      direction: "inbound",
      status: "received",
      sender,
      recipients,
      subject: f.subject || null,
      body_text: f.text || null,
      body_html: f.html || null,
      attachments: [],
      provider_message_id: rfcMessageId,
      in_reply_to_provider_id: inReplyTo,
      meta: {
        provider: "sendgrid_inbound_parse",
        rfc_message_id: rfcMessageId,
        to: recipients.map((r) => r.address),
        header_to: headerTo,
        header_cc: headerCc,
        envelope_from: envelope?.from ?? null,
        spf: f.spf || null,
        dkim: f.dkim || null,
        spam_score: f.spam_score || null,
        sender_ip: f.sender_ip || null,
        raw_attachment_count: f.attachment_count,
        attachments_not_stored: f.attachments,
        sender_auth: { spf_aligned_pass: auth.spf_aligned_pass, dkim_aligned_pass: auth.dkim_aligned_pass },
        ...(auth.authenticated ? {} : { sender_unauthenticated: true }),
        ...(f.body_truncated ? { body_truncated: true } : {}),
      },
      sent_at: isoDate(headers.get("date")),
    };
  },
};
