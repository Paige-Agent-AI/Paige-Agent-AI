// A number bought through the marketplace must be wired for VOICE at buy time, not only for SMS.
//
// Before this test existed `purchaseNumber` posted SmsUrl + StatusCallback and nothing for voice,
// so an inbound call to a freshly bought number never reached `voice-twiml`. The only code that
// wired a number's voice was the one-off `repair-voice-twiml-app`, which POSTs
// `{ VoiceUrl: voiceTwimlUrl(inbound_webhook_secret), VoiceMethod: "POST" }` per number. These
// assertions pin purchase to that same end state, built by that same helper (§18 one home).
//
// Runs under `node --test` (no Deno, no network): fetch is replaced and the form body inspected.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

const SECRET = "fixture-webhook-secret-0123456789";
const SUPABASE_URL = "https://fixture-project.example.test";

type Captured = { url: string; method: string; body: URLSearchParams };
const captured: Captured[] = [];
const realFetch = globalThis.fetch;
const g = globalThis as unknown as { Deno?: unknown };
const priorDeno = g.Deno;

// twilio.ts binds Deno.env at module load, so the env must exist before the import.
g.Deno = { env: { get: (k: string) => (k === "SUPABASE_URL" ? SUPABASE_URL : undefined) } };
const { purchaseNumber, voiceTwimlUrl } = await import("./twilio.ts");

before(() => {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      body: new URLSearchParams(String(init?.body ?? "")),
    });
    return new Response(JSON.stringify({ sid: "PN" + "0".repeat(32), phone_number: "+15555550100" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  g.Deno = priorDeno;
});

describe("purchaseNumber wires the number's voice webhook at buy time", () => {
  it("posts VoiceUrl = the repair's stamped voice-twiml URL, with VoiceMethod POST", async () => {
    captured.length = 0;
    const voiceUrl = voiceTwimlUrl(SECRET);
    assert.ok(voiceUrl, "fixture env must yield a voice URL");
    const r = await purchaseNumber("ACfixturesub", "fixture-key-secret", "+15555550100", {
      smsUrl: `${SUPABASE_URL}/functions/v1/handle-inbound-sms?t=${SECRET}`,
      statusCallback: `${SUPABASE_URL}/functions/v1/twilio-status-callback?t=${SECRET}`,
      voiceUrl: voiceUrl!,
    }, "SKfixturekey");
    assert.equal(r.ok, true);
    assert.equal(captured.length, 1, "exactly one provider request");
    const { url, method, body } = captured[0];
    assert.equal(method, "POST");
    assert.match(url, /\/Accounts\/ACfixturesub\/IncomingPhoneNumbers\.json$/);
    assert.equal(body.get("VoiceUrl"), `${SUPABASE_URL}/functions/v1/voice-twiml?t=${SECRET}`);
    assert.equal(body.get("VoiceMethod"), "POST");
    // The repair converges on VoiceUrl, not on a TwiML Application; a new number has none to clear.
    assert.equal(body.has("VoiceApplicationSid"), false);
    // SMS wiring is unchanged.
    assert.equal(body.get("SmsUrl"), `${SUPABASE_URL}/functions/v1/handle-inbound-sms?t=${SECRET}`);
    assert.equal(body.get("StatusCallback"), `${SUPABASE_URL}/functions/v1/twilio-status-callback?t=${SECRET}`);
    assert.equal(body.get("PhoneNumber"), "+15555550100");
  });

  it("the URL it posts is byte-identical to what repair-voice-twiml-app stamps", async () => {
    // The repair's preflight treats a number whose voice_url (minus ?t=) is not
    // voiceTwimlUrl(null) as a CUSTOM route and refuses it (409). Purchase must therefore build
    // its URL with the same helper, or every newly bought number would block a later repair.
    const stamped = new URL(voiceTwimlUrl(SECRET)!);
    stamped.searchParams.delete("t");
    assert.equal(stamped.toString(), new URL(voiceTwimlUrl(null)!).toString());
  });

  it("a caller that passes no voiceUrl sends no voice fields (no half-wired VoiceMethod)", async () => {
    captured.length = 0;
    await purchaseNumber("ACfixturesub", "fixture-key-secret", "+15555550100", {}, "SKfixturekey");
    const { body } = captured[0];
    assert.equal(body.has("VoiceUrl"), false);
    assert.equal(body.has("VoiceMethod"), false);
  });
});
