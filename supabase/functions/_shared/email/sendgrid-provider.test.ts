// buildProvider never sends PAIGE Email (SendGrid) — mocked fetch, no network, no credentials.
//
// SendGrid email goes out only through the governed email door (comms-email-command → send-message).
// This generic seam reads a tenant-controlled `email_provider`, so it must never reach SendGrid on the
// platform key (Experience 03 round-4 security LOW-3): "sendgrid" resolves to a provider that refuses,
// and never falls back to sending through another provider.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildProvider, type TenantEmailProviderConfig } from "./providers.ts";

// Synthetic credentials only — named like the real secrets so a regression that read them would have a
// key to send with; values are obviously fake and never sent anywhere (fetch is mocked).
Deno.env.set("SENDGRID_MAIL_SEND_API_KEY", "SG.synthetic-test-key-not-real");
Deno.env.set("TENANT_EMAIL_KEY_SYNTHETIC", "SG.synthetic-tenant-key-not-real");

const MSG = {
  from: "PAIGE Email <test@sg-mail.paigeagent.ai>",
  to: "recipient@example.invalid",
  subject: "synthetic",
  html: "<p>hi</p>",
  text: "hi",
};

function withFetchMock(): { calls: unknown[]; restore: () => void } {
  const calls: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(new Response("", { status: 202, headers: { "x-message-id": "sg-msg-1" } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

for (const config of [
  { provider: "sendgrid" },
  { provider: "SendGrid" },
  { provider: "sendgrid", api_key_secret: "TENANT_EMAIL_KEY_SYNTHETIC" },
] as TenantEmailProviderConfig[]) {
  Deno.test(`buildProvider(${JSON.stringify(config)}) refuses to send and makes no provider call`, async () => {
    const mock = withFetchMock();
    try {
      const provider = buildProvider(config);
      assertEquals(provider.key, "sendgrid");
      const result = await provider.send(MSG);
      assertEquals(result, { ok: false, provider: "sendgrid", error: "provider_not_implemented:sendgrid" });
      assertEquals(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
}

Deno.test("unknown providers still fail safe to platform Resend", () => {
  const provider = buildProvider({ provider: "not-a-provider" });
  assertEquals(provider.key, "resend");
});
