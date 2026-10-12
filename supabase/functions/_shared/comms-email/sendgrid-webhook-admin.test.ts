// Operator broker tests — fully mocked provider IO (ANT-78/S7.3).
import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { APPROVED_RECEIVER_URL, assertEndpoint, inspectWebhook, prepareSignedDisabledWebhook, type ProviderFetch } from "./sendgrid-webhook-admin.ts";

const KEY = "SG.synthetic-scoped-webhook-admin-key";
const BASE = "https://api.sendgrid.com/v3/user/webhooks/event/settings";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Records every call (method+url+body); serves canned responses in order. */
function mockProvider(responses: Array<(call: { method: string; url: string; body: unknown }) => Response>) {
  const calls: { method: string; url: string; body: unknown; authHeader?: string }[] = [];
  let i = 0;
  const impl: ProviderFetch = (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const authHeader = (init?.headers as Record<string, string>)?.Authorization;
    calls.push({ method, url, body, authHeader });
    const responder = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(responder({ method, url, body }));
  };
  return { calls, impl };
}

Deno.test("inspectWebhook reads only the allowed endpoint and reports state truthfully", async () => {
  const m = mockProvider([() => jsonResponse(200, { enabled: false, url: null, delivered: false })]);
  const settings = await inspectWebhook(m.impl, KEY);
  assertEquals(settings.enabled, false);
  assertEquals(settings.url, null);
  assertEquals(m.calls.length, 1);
  assertEquals(m.calls[0].method, "GET");
  assertEquals(m.calls[0].url, BASE);
  assertEquals(m.calls[0].authHeader, `Bearer ${KEY}`);
});

Deno.test("prepare REUSES an existing webhook already pointing at the approved receiver", async () => {
  const m = mockProvider([
    () => jsonResponse(200, { enabled: false, url: APPROVED_RECEIVER_URL, signed: true, delivered: true }),
    () => jsonResponse(200, { public_key: "-----BEGIN PUBLIC KEY-----\\nMOCK\\n-----END PUBLIC KEY-----" }),
  ]);
  const result = await prepareSignedDisabledWebhook(m.impl, KEY);
  assertEquals(result.action, "reused");
  assertEquals(result.settings.url, APPROVED_RECEIVER_URL);
  assertEquals(result.publicKeyPem?.includes("BEGIN PUBLIC KEY"), true);
  // reuse = exactly the GET + the signed-key GET; NO write call.
  assertEquals(m.calls.filter((c) => c.method !== "GET").length, 0);
});

Deno.test("prepare CREATES (POST, disabled, signed) when no webhook exists (GET 404)", async () => {
  const m = mockProvider([
    () => jsonResponse(404, { errors: [{ message: "not found" }] }),
    ({ body }) => jsonResponse(200, { enabled: false, url: APPROVED_RECEIVER_URL, signed: true, ...(body as object) }),
    () => jsonResponse(200, { public_key: "PEM-MOCK" }),
  ]);
  const result = await prepareSignedDisabledWebhook(m.impl, KEY);
  assertEquals(result.action, "created");
  const create = m.calls.find((c) => c.method === "POST");
  assertEquals(!!create, true);
  assertEquals((create!.body as { enabled: boolean }).enabled, false); // delivery stays disabled
  assertEquals((create!.body as { url: string }).url, APPROVED_RECEIVER_URL);
  assertEquals((create!.body as { signed: boolean }).signed, true);
});

Deno.test("prepare REFUSES to repoint a webhook aimed at another destination", async () => {
  const m = mockProvider([
    () => jsonResponse(200, { enabled: true, url: "https://elsewhere.example.invalid/hook" }),
  ]);
  const err = await assertRejects(() => prepareSignedDisabledWebhook(m.impl, KEY), Error);
  assertEquals(err.message.startsWith("webhook_points_elsewhere:"), true);
  assertEquals(m.calls.filter((c) => c.method === "POST" || c.method === "PATCH").length, 0); // no writes
});

Deno.test("prepare PATCHES the approved receiver (disabled + signed) when the webhook is unset", async () => {
  const m = mockProvider([
    () => jsonResponse(200, { enabled: false, url: null }),
    ({ body }) => jsonResponse(200, { enabled: false, ...(body as object) }),
    () => jsonResponse(200, { public_key: "PEM-MOCK" }),
  ]);
  const result = await prepareSignedDisabledWebhook(m.impl, KEY);
  assertEquals(result.action, "patched");
  const patch = m.calls.find((c) => c.method === "PATCH");
  assertEquals((patch!.body as { enabled: boolean }).enabled, false);
  assertEquals((patch!.body as { url: string }).url, APPROVED_RECEIVER_URL);
});

Deno.test("the endpoint guard throws PRE-FETCH for anything outside the allowlist", () => {
  // Real enforcement proof: the exported guard itself rejects disallowed
  // method/URL pairs — including the exact scope-creep shapes (scopes read,
  // mail send, arbitrary hosts) — and accepts each of the four allowed pairs.
  for (const bad of [
    "GET https://api.sendgrid.com/v3/scopes",
    "POST https://api.sendgrid.com/v3/mail/send",
    "GET https://evil.example.invalid/user/webhooks/event/settings",
    "DELETE https://api.sendgrid.com/v3/user/webhooks/event/settings",
  ]) {
    const [method, url] = bad.split(" ");
    assertThrows(() => assertEndpoint(method, url), Error, "endpoint_not_allowed");
  }
  for (const good of ["GET", "POST", "PATCH"]) {
    assertEndpoint(good, "https://api.sendgrid.com/v3/user/webhooks/event/settings");
  }
  assertEndpoint("GET", "https://api.sendgrid.com/v3/user/webhooks/event/settings/signed");
});
Deno.test("provider errors surface truthfully (status + bounded body, never the key)", async () => {
  const m = mockProvider([() => jsonResponse(403, { errors: [{ message: "access forbidden" }] })]);
  const err = await assertRejects(() => inspectWebhook(m.impl, KEY), Error);
  assertEquals(err.message.startsWith("sendgrid_403:"), true);
  assertEquals(err.message.includes(KEY), false);
});
