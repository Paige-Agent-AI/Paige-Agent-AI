// SendGridProvider tests (mocked fetch — no network, no credentials).
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildProvider, type TenantEmailProviderConfig } from "./providers.ts";

// Synthetic credentials only — named like the real secrets so buildProvider's
// resolution path runs, but values are obviously fake and never sent anywhere
// (fetch is mocked in every test).
Deno.env.set("SENDGRID_MAIL_SEND_API_KEY", "SG.synthetic-test-key-not-real");

const MSG = {
  from: "PAIGE Email <test@sg-mail.paigeagent.ai>",
  to: "recipient@example.invalid",
  subject: "synthetic",
  html: "<p>hi</p>",
  text: "hi",
};

function withFetchMock(status: number, headers: Record<string, string> = {}, body = ""): { calls: unknown[]; restore: () => void } {
  const calls: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(new Response(body, { status, headers }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("buildProvider resolves sendgrid and sends a Mail Send v3 shape", async () => {
  const mock = withFetchMock(202, { "x-message-id": "sg-msg-1" });
  try {
    const provider = buildProvider({ provider: "sendgrid" } as TenantEmailProviderConfig);
    assertEquals(provider.key, "sendgrid");
    const result = await provider.send(MSG);
    assertEquals(result, { ok: true, provider: "sendgrid", id: "sg-msg-1" });
    const call = mock.calls[0] as { init: RequestInit };
    const body = JSON.parse(call.init.body as string);
    assertEquals(body.personalizations, [{ to: [{ email: MSG.to }] }]);
    assertEquals(body.content.length, 2);
    assertEquals((call.init.headers as Record<string, string>)["Content-Type"], "application/json");
  } finally {
    mock.restore();
  }
});

Deno.test("SendGridProvider surfaces provider errors truthfully (non-202)", async () => {
  const mock = withFetchMock(403, {}, '{"errors":[{"message":"forbidden"}]}');
  try {
    const provider = buildProvider({ provider: "sendgrid" } as TenantEmailProviderConfig);
    const result = await provider.send(MSG);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.provider, "sendgrid");
      assertEquals(result.error?.startsWith("sendgrid_403"), true);
      assertEquals(result.id, undefined);
    }
  } finally {
    mock.restore();
  }
});

Deno.test("unknown providers still fail safe to platform Resend", () => {
  const provider = buildProvider({ provider: "not-a-provider" });
  assertEquals(provider.key, "resend");
});
