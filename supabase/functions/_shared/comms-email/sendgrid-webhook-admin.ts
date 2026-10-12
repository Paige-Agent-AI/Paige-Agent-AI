// Operator-only SendGrid Event Webhook administration broker (ANT-78/S7.3).
//
// The ONE control-plane module for automated webhook configuration. Hard rules:
//   * Only the FOUR endpoints below may ever be called — no arbitrary URLs.
//   * The destination URL is ALWAYS the approved PAIGE receiver; the broker
//     refuses to point any webhook anywhere else.
//   * Delivery stays DISABLED: prepare() sets the receiver + enables signature
//     verification while enabled=false. Enabling real delivery is a separate,
//     explicitly reserved owner action this module cannot perform.
//   * The API key crosses NO logs and NO responses; the verification public
//     key is returned exactly once for the operator to install as
//     SENDGRID_WEBHOOK_PUBLIC_KEY.
//   * The Mail Send executor key is never accepted here; callers pass the
//     scoped webhook-admin credential.
// Provider IO is injectable so tests run fully mocked.

export const APPROVED_RECEIVER_URL =
  "https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/handle-sendgrid-webhook";

const BASE = "https://api.sendgrid.com/v3/user/webhooks/event/settings";
const ALLOWED_ENDPOINTS = new Set<string>([
  `GET ${BASE}`,
  `POST ${BASE}`,
  `PATCH ${BASE}`,
  `GET ${BASE}/signed`,
]);

export type WebhookSettings = {
  enabled: boolean;
  url: string | null;
  /** SendGrid's signed-event flag names differ by API shape; carry both. */
  signed: boolean;
  group_resubscribe: boolean;
  delivered: boolean;
  group_unsubscribe: boolean;
  spam_report: boolean;
  bounce: boolean;
  deferred: boolean;
  unsubscribe: boolean;
  processed: boolean;
  open: boolean;
  click: boolean;
  dropped: boolean;
  friendly_name?: string | null;
};

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;

export function assertEndpoint(method: string, url: string): void {
  if (!ALLOWED_ENDPOINTS.has(`${method} ${url}`)) {
    throw new Error(`endpoint_not_allowed:${method} ${url}`);
  }
}

async function providerCall(
  fetchImpl: ProviderFetch, key: string, method: "GET" | "POST" | "PATCH", url: string, body?: unknown,
): Promise<Record<string, unknown>> {
  assertEndpoint(method, url);
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    // Truthful, non-logging failure: status only, never the key or headers.
    throw new Error(`sendgrid_${res.status}:${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function toSettings(raw: Record<string, unknown>): WebhookSettings {
  const bool = (v: unknown) => v === true;
  return {
    enabled: bool(raw.enabled),
    url: typeof raw.url === "string" ? raw.url : null,
    signed: bool(raw.signed),
    group_resubscribe: bool(raw.group_resubscribe),
    delivered: bool(raw.delivered),
    group_unsubscribe: bool(raw.group_unsubscribe),
    spam_report: bool(raw.spam_report),
    bounce: bool(raw.bounce),
    deferred: bool(raw.deferred),
    unsubscribe: bool(raw.unsubscribe),
    processed: bool(raw.processed),
    open: bool(raw.open),
    click: bool(raw.click),
    dropped: bool(raw.dropped),
    friendly_name: typeof raw.friendly_name === "string" ? raw.friendly_name : null,
  };
}

/** Inspect the current (single-account) Event Webhook configuration. Read-only. */
export async function inspectWebhook(fetchImpl: ProviderFetch, key: string): Promise<WebhookSettings> {
  const raw = await providerCall(fetchImpl, key, "GET", BASE);
  return toSettings(raw);
}

/**
 * Prepare the webhook for signed PAIGE receipt WITHOUT enabling delivery:
 *  1. inspect — reuse the existing configuration when it already points at
 *     the approved receiver (never duplicating webhooks);
 *  2. otherwise PATCH (or POST when none exists) to set the approved receiver
 *     URL, the truthful event selection, and signed=true, with enabled=false;
 *  3. fetch the ECDSA verification public key.
 * Never enables delivery. Returns the exact resulting state + the public key.
 */
export async function prepareSignedDisabledWebhook(
  fetchImpl: ProviderFetch,
  key: string,
): Promise<{ settings: WebhookSettings; publicKeyPem: string | null; action: "reused" | "patched" | "created" }> {
  let current: Record<string, unknown>;
  try {
    current = await providerCall(fetchImpl, key, "GET", BASE);
  } catch (e) {
    // A 404 on GET means no webhook exists yet -> create it.
    if ((e as Error).message.startsWith("sendgrid_404")) {
      const created = await providerCall(fetchImpl, key, "POST", BASE, {
        enabled: false,
        url: APPROVED_RECEIVER_URL,
        signed: true,
        delivered: true, deferred: true, open: true, click: true,
        bounce: true, dropped: true, spam_report: true, unsubscribe: true,
        group_resubscribe: false, group_unsubscribe: false, processed: false,
      });
      const signedRaw = await providerCall(fetchImpl, key, "GET", `${BASE}/signed`);
      return {
        settings: toSettings(created),
        publicKeyPem: typeof signedRaw.public_key === "string" ? signedRaw.public_key : null,
        action: "created",
      };
    }
    throw e;
  }
  const settings = toSettings(current);
  if (settings.url === APPROVED_RECEIVER_URL) {
    // Reuse: never create a second webhook for the same receiver — but only
    // when it is ALREADY in the prepared state (signed on, delivery off).
    // An existing webhook on our receiver that is unsigned or delivering is
    // PATCHED into the prepared state (never silently left misconfigured).
    if (settings.signed && !settings.enabled) {
      const signedRaw = await providerCall(fetchImpl, key, "GET", `${BASE}/signed`);
      return {
        settings,
        publicKeyPem: typeof signedRaw.public_key === "string" ? signedRaw.public_key : null,
        action: "reused",
      };
    }
    const patched = await providerCall(fetchImpl, key, "PATCH", BASE, {
      enabled: false,
      url: APPROVED_RECEIVER_URL,
      signed: true,
      delivered: true, deferred: true, open: true, click: true,
      bounce: true, dropped: true, spam_report: true, unsubscribe: true,
      group_resubscribe: false, group_unsubscribe: false, processed: false,
    });
    const signedRaw = await providerCall(fetchImpl, key, "GET", `${BASE}/signed`);
    return {
      settings: toSettings(patched),
      publicKeyPem: typeof signedRaw.public_key === "string" ? signedRaw.public_key : null,
      action: "patched",
    };
  }
  if (settings.url && settings.url !== APPROVED_RECEIVER_URL) {
    // The account's webhook points elsewhere. NEVER silently repoint another
    // integration's webhook: refuse and report truthfully.
    throw new Error(`webhook_points_elsewhere:${settings.url}`);
  }
  const patched = await providerCall(fetchImpl, key, "PATCH", BASE, {
    enabled: false,
    url: APPROVED_RECEIVER_URL,
    signed: true,
    delivered: true, deferred: true, open: true, click: true,
    bounce: true, dropped: true, spam_report: true, unsubscribe: true,
    group_resubscribe: false, group_unsubscribe: false, processed: false,
  });
  const signedRaw = await providerCall(fetchImpl, key, "GET", `${BASE}/signed`);
  return {
    settings: toSettings(patched),
    publicKeyPem: typeof signedRaw.public_key === "string" ? signedRaw.public_key : null,
    action: "patched",
  };
}
