// INT-328 comms.email_send — the canonical command and its pure, deterministic derivations.
//
// One home for the shape every seam agrees on: the command door parses it, the chat dispatch
// builds it, the prepare RPC re-checks it field for field, and send-message compares the HTML the
// door derived here byte for byte against the prepared row. Pure: no Deno imports, no database,
// no clock — vitest exercises it directly.
//
// Scope (§13): a generic ONE-recipient business email. Never marketing, never an invoice,
// agreement, booking link or campaign — those keep their own capabilities and doors.

export const COMMS_EMAIL_TOOL = "comms_send_email" as const;
export const COMMS_EMAIL_ACTION = "comms.email_send" as const;
export const COMMS_EMAIL_CAPABILITY_KEY = "comms.email_send" as const;
export const COMMS_EMAIL_SUBJECT_MAX = 200;
export const COMMS_EMAIL_BODY_MAX = 10000;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FINGERPRINT = /^[0-9a-f]{16}$/;
export const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CommsEmailCommand {
  action: typeof COMMS_EMAIL_ACTION;
  contact_id: string;
  connector_id: string | null;
  subject: string;
  body: string;
}

const COMMAND_KEYS = new Set(["action", "contact_id", "connector_id", "subject", "body"]);

/**
 * Strict parse of the closed command shape. Unknown keys refuse (no request-authored governance,
 * recipient, sender address or HTML can ride in). UUIDs are lower-cased so the canonical command
 * compares equal to the text Postgres renders for a uuid. Subject and body are kept VERBATIM —
 * they are what the person approves and what is digested — but must carry visible text, and may
 * not hold a NUL (jsonb/text cannot store one) or, for the subject, a line break (header safety).
 */
export function parseCommsEmailCommand(value: unknown): CommsEmailCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("COMMS_EMAIL_COMMAND_INVALID");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !COMMAND_KEYS.has(key))) throw new TypeError("COMMS_EMAIL_COMMAND_INVALID");
  if (v.action !== COMMS_EMAIL_ACTION) throw new TypeError("COMMS_EMAIL_COMMAND_INVALID");
  if (typeof v.contact_id !== "string" || !UUID.test(v.contact_id)) throw new TypeError("COMMS_EMAIL_COMMAND_INVALID");
  if (v.connector_id !== undefined && v.connector_id !== null && (typeof v.connector_id !== "string" || !UUID.test(v.connector_id))) {
    throw new TypeError("COMMS_EMAIL_COMMAND_INVALID");
  }
  const subject = v.subject, body = v.body;
  if (typeof subject !== "string" || !subject.trim() || subject.length > COMMS_EMAIL_SUBJECT_MAX || /[\r\n\u0000]/.test(subject)) {
    throw new TypeError("COMMS_EMAIL_SUBJECT_INVALID");
  }
  if (typeof body !== "string" || !body.trim() || body.length > COMMS_EMAIL_BODY_MAX || body.includes("\u0000")) {
    throw new TypeError("COMMS_EMAIL_BODY_INVALID");
  }
  return Object.freeze({
    action: COMMS_EMAIL_ACTION,
    contact_id: v.contact_id.toLowerCase(),
    connector_id: typeof v.connector_id === "string" ? v.connector_id.toLowerCase() : null,
    subject,
    body,
  });
}

/* ───────────────────────── "Approve now, send later" (scheduled governed email) ───────────────────────── */

/** The earliest a scheduled email may be set for, measured when the card is raised. */
export const COMMS_EMAIL_SEND_AT_MIN_LEAD_MS = 2 * 60_000;
/** The furthest ahead a scheduled email may be set for. */
export const COMMS_EMAIL_SEND_AT_MAX_LEAD_MS = 30 * 24 * 60 * 60_000;
/**
 * How long after its time a scheduled email may still be released. The drainer runs every minute and
 * leases a row for five; past this window the release is closed as `scheduled_release_missed` (nothing
 * went out) instead of an email arriving hours after the time the owner chose.
 */
export const COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS = 15 * 60_000;

const SEND_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * The canonical form of a requested send time, WITHOUT the window check: an ISO-8601 instant carrying
 * `Z` or an explicit offset (a zone-less local time is refused — it would mean a different moment on
 * the server), with real calendar fields (V8's Date.parse rolls "02-30" into March; this does not),
 * floored to the minute and rendered exactly as `Date#toISOString` — the same text the database stores
 * on the binding. Throws `COMMS_EMAIL_SEND_AT_INVALID`.
 */
export function canonicalCommsEmailSendAt(value: unknown): string {
  const invalid = () => new TypeError("COMMS_EMAIL_SEND_AT_INVALID");
  if (typeof value !== "string" || value.length > 40) throw invalid();
  const m = SEND_AT.exec(value);
  if (!m) throw invalid();
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const daysInMonth = mo >= 1 && mo <= 12 ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
  if (y < 2000 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) throw invalid();
  let offsetMinutes = 0;
  if (m[8] !== "Z") {
    const oh = Number(m[10]), om = Number(m[11]);
    if (oh > 14 || om > 59 || (oh === 14 && om > 0)) throw invalid();
    offsetMinutes = (m[9] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) throw invalid();
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/**
 * A requested send time, canonical (see above) and inside the window: at least two minutes and at
 * most thirty days after `nowMs`. Pure — the caller passes the clock.
 */
export function parseCommsEmailSendAt(value: unknown, nowMs: number): string {
  const canonical = canonicalCommsEmailSendAt(value);
  const at = Date.parse(canonical);
  if (!Number.isFinite(nowMs) || at < nowMs + COMMS_EMAIL_SEND_AT_MIN_LEAD_MS || at > nowMs + COMMS_EMAIL_SEND_AT_MAX_LEAD_MS) {
    throw new TypeError("COMMS_EMAIL_SEND_AT_INVALID");
  }
  return canonical;
}

/** The recipient form every seam compares: trimmed and lower-cased (send-message's normalizeRecipient). */
export function normalizeCommsEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  return address && address.length <= 320 && EMAIL_ADDRESS.test(address) ? address : null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The HTML the provider receives, derived on the server from the approved plain text — the model
 * never authors markup. Deterministic: line endings fold to \n, blank lines split paragraphs,
 * a single newline inside a paragraph becomes <br>, and every character the text holds is escaped.
 */
export function commsEmailBodyHtml(text: string): string {
  return text.replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim() !== "")
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * sha256_hex(recipient \n connector_id \n subject \n body_text) — byte-identical to the digest
 * prepare_comms_email_send recomputes (convert_to(..., 'UTF8')), which refuses a mismatch.
 */
export async function commsEmailContentDigest(input: { recipient: string; connectorId: string; subject: string; bodyText: string }): Promise<string> {
  const bytes = new TextEncoder().encode([input.recipient, input.connectorId, input.subject, input.bodyText].join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
