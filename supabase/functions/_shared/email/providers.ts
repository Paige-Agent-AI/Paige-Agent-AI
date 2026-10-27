// Per-tenant email provider seam (bring-your-own sending system, GHL-style).
//
// NOTHING SENDS FROM THIS SEAM TODAY. The platform default used to be a Resend adapter on the
// platform RESEND_API_KEY; production's Resend account was emptied 2026-10-26 when the owner moved
// everything to SendGrid, and that adapter had no caller (nothing called provider.send()), so it was
// removed rather than repointed. PAIGE's own email goes out through _shared/email/platform-sendgrid.ts;
// a business's SendGrid email goes out only through the governed email door (comms-email-command →
// send-message). Every provider string here — including a stored "resend" — resolves to a provider that
// refuses loudly, so a tenant-controlled `email_provider` can never open a second, ungoverned send path.
//
// Doctrine §7/§200: nothing tenant-specific is hardcoded here. A bring-your-own provider is added by
// implementing EmailProvider and registering a case in buildProvider() — no caller changes required.

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
// store, never stored inline. Absent → the platform seam (which does not send).
export type TenantEmailProviderConfig = {
  provider?: "resend" | "smtp" | "mailgun" | "mailchimp" | "postmark" | string | null;
  // Optional per-tenant credential secret NAME, for a future bring-your-own adapter. A tenant-controlled
  // name MUST stay namespaced (TENANT_EMAIL_KEY_*) when an adapter reads it — never an arbitrary env var
  // like the service-role key. No adapter reads it today.
  api_key_secret?: string | null;
  // Provider-specific extras (SMTP host/port, Mailgun region/domain, etc.).
  options?: Record<string, unknown> | null;
};

// ---------- Providers ----------

// SendGrid (PAIGE Email) is deliberately NOT an adapter here. A business's SendGrid email goes out
// ONLY through the governed one-to-one email door (comms-email-command → send-message, which refuses a
// SendGrid send that is not the door's prepared operation), so the sender's domain verification, the
// approval binding and the receipts all apply. An adapter here would read the platform SendGrid key on a
// tenant-controlled `email_provider` with no domain check (Experience 03 round-4 security LOW-3), so
// buildProvider() resolves "sendgrid" to a provider that refuses to send (see below).

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
 * Resolve the provider for a tenant's stored config. Every case refuses today (see the header): the
 * key it reports is the one the tenant asked for, so a misconfigured tenant is visible, but nothing is
 * ever sent and nothing falls back to another provider or credential.
 */
export function buildProvider(config?: TenantEmailProviderConfig | null): EmailProvider {
  const provider = String(config?.provider ?? "platform").trim().toLowerCase() || "platform";
  switch (provider) {
    case "smtp":
    case "mailgun":
    case "mailchimp":
    case "postmark":
      // Wiring point for bring-your-own providers. Implement the class above
      // and swap this line for `return new XProvider(config)`.
      return new UnimplementedProvider(provider);
    case "sendgrid":
      // Never sends from this seam: PAIGE Email (SendGrid) goes out only through the governed email
      // door (see the note above UnimplementedProvider).
      return new UnimplementedProvider("sendgrid");
    case "resend":
      // The retired platform default. A tenant row may still name it; it refuses like everything else.
      return new UnimplementedProvider("resend");
    default:
      // No config, or an unknown provider string → the platform seam, which does not send from here.
      return new UnimplementedProvider("platform");
  }
}
