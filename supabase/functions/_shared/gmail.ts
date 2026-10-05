// _shared/gmail.ts — the ONE authenticated Gmail seam for the comms rail (#141b).
//
// Mirrors _shared/twilio.ts: a pure Deno/esm helper with NO product logic and NO
// table writes. It resolves a tenant's Gmail refresh token from the proven Vault
// bridge (read_channel_secret), exchanges it for a short-lived access token, and
// sends an RFC 822 message through the Gmail API — handing callers a uniform,
// structured result. Callers own the DB/audit rows (send-message).
//
// DESIGN CONTRACT (matches twilio.ts, §18 one home — no fork)
//   • Structured result, never a throw for an API-level failure: every call resolves
//     to { ok, status, error, data, needs_config? }. A missing Vault secret / OAuth
//     client is an HONEST needs_config degrade (§13), NOT a crash and NEVER a faked send.
//   • Secrets NEVER appear in an error string or a log. The refresh token travels only
//     in the token-exchange form body; the access token only in the Bearer header.
//   • CREDENTIAL STORAGE (§9/§34): the refresh token lives ONLY in Vault, addressed by
//     channel_connectors.credentials_vault_ref (a NAME). resolveGmailAccessToken reads it
//     back through read_channel_secret (the same SECURITY-DEFINER, service_role-only RPC
//     _shared/twilio.ts uses) — the token is never a column and never logged.
//   • The OAuth client id/secret reuse the SAME GOOGLE_OAUTH_CLIENT_ID / _SECRET env the
//     calendar OAuth trio uses (§14 cost-low — no new secret minted). Read at CALL time so
//     rotation needs no redeploy.

// -----------------------------------------------------------------------------
// Result + client shapes
// -----------------------------------------------------------------------------

/** Uniform return of every Gmail seam call. `data` is the parsed payload on success. */
export interface GmailResult<T = Record<string, unknown>> {
  ok: boolean;
  /** HTTP status, or 0 for a transport-level failure (never reached Google). */
  status: number;
  /** Structured error message on failure, else null. Never contains a secret. */
  error: string | null;
  /** Parsed payload on success, else null. */
  data: T | null;
  /**
   * Present + true when the call could not run because something isn't wired yet —
   * no OAuth client env, no Vault ref, an empty/rotated-away secret. An HONEST degrade
   * (§13), distinct from an API error, so callers branch to "not configured" UX
   * (gmail_oauth_not_configured) rather than "send failed".
   */
  needs_config?: boolean;
}

/**
 * Loose structural type for the supabase-js admin (service-role) client this helper
 * needs — kept permissive (mirrors twilio.ts's SupabaseAdminLike) so any service-role
 * SupabaseClient assigns without friction and gmail.ts stays dependency-free.
 */
// deno-lint-ignore no-explicit-any
export type SupabaseAdminLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const MAX_ERROR_BODY = 400; // cap echoed error bodies (belt-and-suspenders on secrets)

const enc = new TextEncoder();

/** Base64url-encode a UTF-8 string (Gmail's raw-message encoding, RFC 4648 §5). */
function base64UrlEncode(value: string): string {
  const bytes = enc.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Strip CR/LF (and surrounding whitespace) from a header value before it is
 * interpolated into the raw RFC 822 message. Without this, a `\r\n` in a
 * caller-supplied To/Subject/threading id would inject arbitrary headers (e.g. a
 * hidden `Bcc:` that exfiltrates the send under the tenant's authenticated Gmail
 * identity) — §13 no injection holes. The Resend path is safe because Resend takes
 * to/subject as JSON fields it encodes; this raw-MIME path is the one place that
 * must guard the header line itself.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** MIME encoded-word for a header value when it carries non-ASCII (RFC 2047). */
function encodeHeaderWord(value: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value; // pure ASCII — leave as-is
  let binary = "";
  for (const byte of enc.encode(value)) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

// -----------------------------------------------------------------------------
// OAuth client env (reused from the calendar trio, §14) — read at CALL time
// -----------------------------------------------------------------------------

/** The Google OAuth client credentials, or null when unset (honest needs_config degrade). */
function googleOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// -----------------------------------------------------------------------------
// Credential resolution — Vault bridge (§9, mirrors resolveTwilioCreds)
// -----------------------------------------------------------------------------

/**
 * Resolve a Gmail access token for a connector: read the refresh token from Vault via
 * read_channel_secret(credentials_vault_ref) (the ONLY path an edge fn can decrypt a
 * Vault secret), then exchange refresh→access at Google's token endpoint. Returns:
 *   • ok:true  + data:{ accessToken }            — ready to send
 *   • ok:false + needs_config:true               — no OAuth env / no ref / empty secret
 *   • ok:false + error                           — a real lookup/exchange failure
 *
 * MUST be called with a SERVICE-ROLE client — read_channel_secret is granted to
 * service_role only, and the refresh token must never transit an anon/authenticated
 * context. The caller resolves the connector (and thus the ref) server-authoritatively.
 */
export async function resolveGmailAccessToken(
  admin: SupabaseAdminLike,
  credentialsVaultRef: string | null | undefined,
): Promise<GmailResult<{ accessToken: string }>> {
  const oauth = googleOAuthClient();
  if (!oauth) {
    return { ok: false, status: 0, error: "gmail_oauth_not_configured", data: null, needs_config: true };
  }
  if (!credentialsVaultRef) {
    return { ok: false, status: 0, error: "gmail_vault_ref_missing", data: null, needs_config: true };
  }

  const { data: secret, error: secErr } = await admin.rpc("read_channel_secret", {
    _ref: credentialsVaultRef,
  });
  if (secErr) {
    return {
      ok: false, status: 0,
      error: `gmail_vault_read_failed: ${String((secErr as { message?: string })?.message ?? secErr).slice(0, MAX_ERROR_BODY)}`,
      data: null,
    };
  }
  const refreshToken = typeof secret === "string" ? secret : "";
  if (!refreshToken) {
    return { ok: false, status: 0, error: "gmail_vault_ref_empty", data: null, needs_config: true };
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.access_token) {
      // Google's token errors are { error, error_description } — safe to echo (no secret),
      // capped defensively. An invalid_grant here means the user revoked access → honest degrade.
      const gErr = String(json?.error ?? `http_${res.status}`);
      return {
        ok: false, status: res.status,
        error: `gmail_token_exchange_failed: ${gErr.slice(0, MAX_ERROR_BODY)}`,
        data: null,
        needs_config: gErr === "invalid_grant", // revoked/expired consent → reconnect needed
      };
    }
    return { ok: true, status: res.status, error: null, data: { accessToken: String(json.access_token) } };
  } catch (e) {
    return {
      ok: false, status: 0,
      error: `gmail_token_network: ${(e as Error).message.slice(0, MAX_ERROR_BODY)}`,
      data: null,
    };
  }
}

// -----------------------------------------------------------------------------
// Send — build RFC 822, base64url, POST to Gmail
// -----------------------------------------------------------------------------

import {attachmentMime,type EmailAttachment} from './email-attachments.ts';
export interface GmailSendInput {
  attachments?: EmailAttachment[];
  from: string;          // the authenticated Gmail address (Google enforces this)
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
 * Send one message as the authenticated Gmail user. Builds an RFC 822 message
 * (HTML when provided, else plain text), base64url-encodes it, and POSTs to
 * users/me/messages/send. `data.id` is the Gmail message id (the provider_message_id
 * the caller records). Returns a structured GmailResult — never a throw for an API
 * failure, never a faked id (§13).
 */
export async function gmailSend(
  accessToken: string,
  input: GmailSendInput,
): Promise<GmailResult<{ id: string; threadId?: string }>> {
  if (!accessToken) {
    return { ok: false, status: 0, error: "gmail_missing_access_token", data: null, needs_config: true };
  }
  const fromHeader = input.fromName
    ? `${encodeHeaderWord(input.fromName.replace(/[<>\r\n]/g, " ").trim())} <${input.from}>`
    : input.from;

  const isHtml = Boolean(input.html && input.html.length > 0);
  const bodyContent = isHtml ? String(input.html) : String(input.text ?? "");
  const contentType = isHtml ? "text/html; charset=UTF-8" : "text/plain; charset=UTF-8";

  // Every header value derived from caller input is CRLF-stripped before it reaches the
  // header line (§13 anti-injection). Subject is stripped THEN encoded-word'd — a pure-ASCII
  // subject would otherwise pass through unencoded and carry an injected \r\n.
  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${sanitizeHeaderValue(input.to)}`,
    `Subject: ${encodeHeaderWord(sanitizeHeaderValue(input.subject || "(no subject)"))}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}`,
    "Content-Transfer-Encoding: 8bit",
  ];
  if (input.inReplyTo) {
    const ref = sanitizeHeaderValue(input.inReplyTo);
    headerLines.push(`In-Reply-To: ${ref}`);
    headerLines.push(`References: ${ref}`);
  }
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (/^[A-Za-z0-9-]{1,64}$/.test(name)) headerLines.push(`${name}: ${sanitizeHeaderValue(String(value))}`);
  }
  const mime = attachmentMime(bodyContent,contentType,input.attachments??[]);
  // Use the SAME boundary in the header and body.
  const typeIndex=headerLines.findIndex(line=>line.startsWith('Content-Type:'));
  headerLines[typeIndex]=`Content-Type: ${mime.contentType}`;
  const rfc822 = `${headerLines.join("\r\n")}\r\n\r\n${mime.body}`;
  const raw = base64UrlEncode(rfc822);

  try {
    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.id) {
      const gMsg = json?.error?.message ?? `http_${res.status}`;
      return {
        ok: false, status: res.status,
        error: `gmail_send_failed: ${String(gMsg).slice(0, MAX_ERROR_BODY)}`,
        data: null,
      };
    }
    return {
      ok: true, status: res.status, error: null,
      data: { id: String(json.id), threadId: json.threadId ? String(json.threadId) : undefined },
    };
  } catch (e) {
    return {
      ok: false, status: 0,
      error: `gmail_send_network: ${(e as Error).message.slice(0, MAX_ERROR_BODY)}`,
      data: null,
    };
  }
}
