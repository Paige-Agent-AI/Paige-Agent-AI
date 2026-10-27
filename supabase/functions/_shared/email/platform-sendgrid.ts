// PAIGE's own email, through SendGrid (owner ruling 2026-10-26: "I am moving EVERYTHING to SendGrid").
//
// The one transport for every platform-originated email that used to POST to api.resend.com directly:
// the welcome email, platform and client-portal invites, transactional email, booking emails, plan
// reminders. A business's own mailbox (Gmail, SMTP) and the governed reply door keep their own paths.
//
// FROM IS ALWAYS PAIGE'S OWN VERIFIED DOMAIN. SendGrid authenticates domains for the whole shared account,
// so it would accept a From on ANY domain the account verified — including one a different business
// verified (security H2, 20271031000100). This module therefore never sends from a domain outside
// PLATFORM_FROM_DOMAINS. Paige's own addresses on paigeagent.ai keep their local part (hello@, team@,
// calendar@ — every one is on the reserved list no business can claim, 20260711170000). Any other domain
// is a business's own, and its local part is NOT reused: a business sets that freely, so reusing it
// could put one business's mail on another business's shared address (acme@mail.paigeagent.ai). It
// sends as notifications@ (also reserved) under the business's display name instead.
// Reply-To is not an identity claim and passes through unchanged.
//
// The key is the restricted Mail Send key (SENDGRID_MAIL_SEND_API_KEY) — never the admin key.
// SendGrid answers 202 with an empty body; X-Message-Id is the id its Event Webhook echoes as the first
// segment of sg_message_id. SendGrid has no idempotent replay: only a 4xx proves nothing was accepted, so
// a thrown request, a timeout or a 5xx is reported `unconfirmed` and a caller must not resend blindly.

export const PLATFORM_FROM_DOMAIN = "mail.paigeagent.ai";
const PLATFORM_FROM_DOMAINS = new Set([PLATFORM_FROM_DOMAIN]);
const PLATFORM_OWNED_DOMAINS = new Set(["paigeagent.ai"]);
const BUSINESS_LOCAL_PART = "notifications";
const SEND_URL = "https://api.sendgrid.com/v3/mail/send";
const DEFAULT_TIMEOUT_MS = 20_000;

export type PlatformAttachment = { filename: string; content: string; type?: string };
export type PlatformEmail = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string | null;
  text?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string> | null;
  attachments?: PlatformAttachment[] | null;
  categories?: string[] | null;
  customArgs?: Record<string, string> | null;
  timeoutMs?: number;
};
export type PlatformSendResult = {
  ok: boolean;
  /** HTTP status SendGrid answered; 0 when no answer was read. */
  status: number;
  /** X-Message-Id on a 2xx, else null. */
  id: string | null;
  /** Short, provider-free reason when not ok. Never contains the key or the message. */
  error: string | null;
  /** True when SendGrid may have accepted the email although we could not confirm it. */
  unconfirmed: boolean;
};
export type PlatformDeps = { fetch?: typeof fetch; apiKey?: string | null };

const ADDRESS = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** "Name <a@b>" | "a@b" -> a header-safe display name and the lowercased address. */
function parseFrom(from: string): { name: string; address: string } {
  const raw = String(from ?? "").trim();
  const m = /^([\s\S]*?)\s*<\s*([^<>\s]+)\s*>$/.exec(raw);
  // Letters and digits in any script survive (a brand name is not ASCII-only); quotes, @, <> and line
  // breaks do not, so the name can neither break the header nor pose as an address.
  const name = (m ? m[1] : "").replace(/[^\p{L}\p{M}\p{N} \-.'’&,()]/gu, " ").replace(/\s+/g, " ").trim();
  return { name, address: (m ? m[2] : raw).trim().toLowerCase() };
}

/**
 * For PAIGE's OWN platform senders only (a From PAIGE's code chose, never a business's data):
 * "Name <a@b>" | "a@b" -> { name, address } with the address moved onto the platform domain.
 */
export function platformFrom(from: string): { email: string; name?: string } {
  const { name, address } = parseFrom(from);
  const [local, domain] = ADDRESS.test(address) ? address.split("@") : ["no-reply", PLATFORM_FROM_DOMAIN];
  const email = PLATFORM_FROM_DOMAINS.has(domain) ? `${local}@${domain}`
    : PLATFORM_OWNED_DOMAINS.has(domain) ? `${local}@${PLATFORM_FROM_DOMAIN}`
    : `${BUSINESS_LOCAL_PART}@${PLATFORM_FROM_DOMAIN}`;
  return name ? { email, name } : { email };
}

/**
 * For a From that comes from a BUSINESS's data (a connector's from_address, a sender identity, a request
 * body) — security H2. Any workspace admin can write a connector, so its address is a claim, not a fact.
 * A mail.paigeagent.ai address is kept ONLY when it is this business's own managed address as resolved
 * server-side (`ownManagedAddresses`, compared trimmed and case-insensitively). Anything else — another
 * business's managed address, PAIGE's own (support@, team@ on either paigeagent.ai domain), a business's
 * own domain — is sent as notifications@mail.paigeagent.ai under the business's display name. Unlike
 * platformFrom, a paigeagent.ai address is never remapped: that would let a business send as PAIGE.
 */
export function tenantFrom(
  from: string,
  ownManagedAddresses: string | readonly (string | null | undefined)[] | null | undefined,
): { email: string; name?: string } {
  const { name, address } = parseFrom(from);
  const own = new Set(
    (Array.isArray(ownManagedAddresses) ? ownManagedAddresses : [ownManagedAddresses])
      .map((a) => String(a ?? "").trim().toLowerCase())
      .filter((a) => ADDRESS.test(a) && a.split("@")[1] === PLATFORM_FROM_DOMAIN),
  );
  const email = ADDRESS.test(address) && own.has(address) ? address : `${BUSINESS_LOCAL_PART}@${PLATFORM_FROM_DOMAIN}`;
  return name ? { email, name } : { email };
}

function envKey(): string | null {
  try {
    const d = (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno;
    return d?.env?.get?.("SENDGRID_MAIL_SEND_API_KEY") ?? null;
  } catch {
    return null;
  }
}

export async function sendPlatformEmail(input: PlatformEmail, deps: PlatformDeps = {}): Promise<PlatformSendResult> {
  const key = deps.apiKey !== undefined ? deps.apiKey : envKey();
  if (!key) return { ok: false, status: 0, id: null, error: "email_provider_not_configured", unconfirmed: false };
  const to = (Array.isArray(input.to) ? input.to : [input.to]).map((a) => String(a ?? "").trim()).filter((a) => ADDRESS.test(a));
  if (!to.length) return { ok: false, status: 0, id: null, error: "recipient_invalid", unconfirmed: false };
  const html = input.html ?? null;
  const text = input.text ?? null;
  if (!html && !text) return { ok: false, status: 0, id: null, error: "content_missing", unconfirmed: false };
  const replyTo = input.replyTo && ADDRESS.test(input.replyTo.trim()) ? input.replyTo.trim() : null;
  const payload = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: platformFrom(input.from),
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
    subject: String(input.subject ?? "").slice(0, 998) || "(no subject)",
    // SendGrid requires text/plain first when both are present.
    content: [
      ...(text ? [{ type: "text/plain", value: text }] : []),
      ...(html ? [{ type: "text/html", value: html }] : []),
    ],
    ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
    ...(input.attachments?.length ? {
      attachments: input.attachments.map((a) => ({
        content: a.content, filename: a.filename, disposition: "attachment",
        ...(a.type ? { type: a.type } : {}),
      })),
    } : {}),
    ...(input.categories?.length ? { categories: input.categories.slice(0, 10) } : {}),
    ...(input.customArgs && Object.keys(input.customArgs).length ? { custom_args: input.customArgs } : {}),
  };
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(SEND_URL, {
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return { ok: true, status: res.status, id: res.headers.get("x-message-id"), error: null, unconfirmed: false };
    }
    await res.text().catch(() => "");
    const definitive = res.status >= 400 && res.status < 500;
    return { ok: false, status: res.status, id: null, error: `email_provider_${res.status}`, unconfirmed: !definitive };
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    return { ok: false, status: 0, id: null, error: name === "TimeoutError" || name === "AbortError" ? "email_provider_timeout" : "email_provider_unreachable", unconfirmed: true };
  }
}
