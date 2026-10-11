// Pluggable per-tenant email provider layer (GHL-style).
//
// Every outbound email in the platform flows through the EmailProvider
// interface. The PLATFORM DEFAULT is Resend (Paige Agent AI's own account).
// Any tenant may later "bring their own" sending system — SMTP, Mailgun,
// Mailchimp/Mandrill, Postmark, etc. — by storing a provider config on their
// tenant row; buildProvider() resolves the right adapter.
//
// Doctrine §7/§200: nothing tenant-specific is hardcoded here. A tenant with no
// provider config falls back to the platform RESEND_API_KEY (Paige Agent AI as
// the default sender). New providers are added by implementing EmailProvider
// and registering a case in buildProvider() — no caller changes required.

export type OutboundEmail = {
  from: string; // "Display Name <local@domain>"
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
};

export type SendResult = {
  ok: boolean;
  provider: string;
  id?: string | null;
  error?: string | null;
};

export interface EmailProvider {
  readonly key: string;
  send(msg: OutboundEmail): Promise<SendResult>;
}

// Shape of a tenant's stored email-provider config. Persisted (per tenant) as
// jsonb; secrets are referenced by name and read from the function's secret
// store, never stored inline. Absent/`resend` → platform default.
export type TenantEmailProviderConfig = {
  provider?: "resend" | "smtp" | "mailgun" | "mailchimp" | "postmark" | string | null;
  // Optional per-tenant credential secret NAME (looked up in Deno env), so a
  // tenant can send from their OWN provider account. When null, the platform
  // default credential is used (Paige Agent AI = platform RESEND_API_KEY).
  api_key_secret?: string | null;
  // Provider-specific extras (SMTP host/port, Mailgun region/domain, etc.).
  options?: Record<string, unknown> | null;
};

// ---------- Providers ----------

// SendGrid Mail Send (v3). Bearer key; 202 Accepted is the success contract —
// v3/mail/send returns an EMPTY body, so the provider id is the X-Message-Id
// response header when present (it corresponds to the Event Webhook's
// sg_message_id). The executor key is the platform's restricted Mail Send
// credential (SENDGRID_MAIL_SEND_API_KEY) or a tenant's own key by secret name;
// the full-access ADMIN key is NEVER acceptable here (CI-enforced).
class SendGridProvider implements EmailProvider {
  readonly key = "sendgrid";
  #apiKey: string;
  constructor(apiKey: string) {
    if (!apiKey) throw new Error("sendgrid_api_key_missing");
    this.#apiKey = apiKey;
  }
  async send(msg: OutboundEmail): Promise<SendResult> {
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: msg.to }] }],
          from: msg.from,
          subject: msg.subject,
          content: [
            ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
            ...(msg.text ? [{ type: "text/plain", value: msg.text }] : []),
          ],
          ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, provider: this.key, error: `sendgrid_${res.status}: ${body.slice(0, 300)}` };
      }
      return { ok: true, provider: this.key, id: res.headers.get("x-message-id") };
    } catch (e) {
      return { ok: false, provider: this.key, error: `sendgrid_exception: ${(e as Error).message}` };
    }
  }
}

class ResendProvider implements EmailProvider {
  readonly key = "resend";
  #apiKey: string;
  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }
  async send(msg: OutboundEmail): Promise<SendResult> {
    if (!this.#apiKey) return { ok: false, provider: this.key, error: "resend_api_key_missing" };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          ...(msg.text ? { text: msg.text } : {}),
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, provider: this.key, error: `resend_${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
      }
      return { ok: true, provider: this.key, id: (body as { id?: string })?.id ?? null };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { ok: false, provider: this.key, error: m.slice(0, 300) };
    }
  }
}

// --- Future providers (bring-your-own). Stubbed intentionally so the wiring
// --- exists and adding one is a localized change. Each fails LOUD (never
// --- silently drops mail) so a misconfigured tenant is caught immediately.
class UnimplementedProvider implements EmailProvider {
  constructor(readonly key: string) {}
  send(): Promise<SendResult> {
    return Promise.resolve({ ok: false, provider: this.key, error: `provider_not_implemented:${this.key}` });
  }
}
// e.g. class SmtpProvider implements EmailProvider { ... }
//      class MailgunProvider implements EmailProvider { ... }
//      class MailchimpProvider implements EmailProvider { ... }  // Mandrill transactional

/**
 * Resolve the concrete provider for a tenant. Defaults to Resend on the
 * platform key (Paige Agent AI). A tenant that has stored its own provider +
 * credential secret name sends from its own account.
 */
export function buildProvider(config?: TenantEmailProviderConfig | null): EmailProvider {
  const platformResendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const provider = (config?.provider ?? "resend").toLowerCase();

  // Per-tenant credential override: read the named secret from the env store.
  // SECURITY: the secret NAME is tenant-controlled, so it MUST be namespaced —
  // a tenant may only reference platform-provisioned per-tenant secrets
  // (TENANT_EMAIL_KEY_*), never an arbitrary env var like the service-role key.
  // Anything outside the namespace is ignored → falls back to the platform key.
  const rawSecret = config?.api_key_secret ?? "";
  const secretAllowed = /^TENANT_EMAIL_KEY_[A-Z0-9_]+$/.test(rawSecret);
  const tenantKey = secretAllowed ? (Deno.env.get(rawSecret) ?? "") : "";

  switch (provider) {
    case "resend":
      return new ResendProvider(tenantKey || platformResendKey);
    case "smtp":
    case "mailgun":
    case "mailchimp":
    case "postmark":
      // Wiring point for bring-your-own providers. Implement the class above
      // and swap this line for `return new XProvider(config)`.
      return new UnimplementedProvider(provider);
    case "sendgrid": {
      // Restricted Mail Send key only (see class doc); the full-access admin
      // key is CI-forbidden everywhere and never read here.
      const sendgridKey = tenantKey || (Deno.env.get("SENDGRID_MAIL_SEND_API_KEY") ?? "");
      if (!sendgridKey) return new UnimplementedProvider("sendgrid");
      return new SendGridProvider(sendgridKey);
    }
    default:
      // Unknown provider string → fail safe to platform Resend.
      return new ResendProvider(platformResendKey);
  }
}
