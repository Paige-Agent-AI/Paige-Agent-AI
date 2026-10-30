// Inert provider-boundary tests: every fetch is replaced before a send is attempted.
// SMS creation must not repeat underneath the caller's current consent/legal decision.
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const globals = globalThis as unknown as { Deno?: unknown };
const priorDeno = globals.Deno;
globals.Deno = { env: { get: () => undefined } };
const { sendSms, twilioRequest } = await import("./twilio.ts");

afterEach(() => { globalThis.fetch = realFetch; });
after(() => { globals.Deno = priorDeno; });

const SID = "SM" + "1".repeat(32);
const options = { to: "+15555550101", from: "+15555550100", body: "Fictional approved words" };
const accepted = () => new Response(JSON.stringify({ sid: SID, status: "queued" }), { status: 201 });

describe("sendSms performs one provider invocation per caller decision", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    it(`returns HTTP ${status} without a hidden second message POST`, async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return calls === 1
          ? new Response(JSON.stringify({ code: status, message: "Fictional provider refusal" }), { status })
          : accepted();
      };
      const result = await sendSms("ACfixture", "fixture-secret", options);
      assert.equal(calls, 1, "later dispatch requires a new caller eligibility decision");
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
    });
  }

  it("does not repeat an attempt whose response was lost", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) throw new TypeError("Fictional connection lost after request");
      return accepted();
    };
    const result = await sendSms("ACfixture", "fixture-secret", options);
    assert.equal(calls, 1, "a lost response does not establish that the first request had no effect");
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.equal(result.data, null);
  });

  it("does not repeat a request when the successful response body could not be read", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      const response = accepted();
      response.text = async () => { throw new TypeError("Fictional response body lost"); };
      return response;
    };
    const result = await sendSms("ACfixture", "fixture-secret", options);
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
  });

  it("preserves the original provider request, API-key auth and accepted result", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return accepted();
    };
    const result = await sendSms("ACfixture", "fixture-secret", {
      ...options,
      messagingServiceSid: "MGfixture",
      statusCallback: "https://fixture.example.test/status",
    }, "SKfixture");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json");
    assert.equal(calls[0].init.method, "POST");
    const body = new URLSearchParams(String(calls[0].init.body));
    assert.deepEqual(Object.fromEntries(body), {
      To: options.to, Body: options.body,
      StatusCallback: "https://fixture.example.test/status", MessagingServiceSid: "MGfixture",
    });
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Basic " + btoa("SKfixture:fixture-secret"));
    assert.equal(result.ok, true);
    assert.equal(result.data?.sid, SID);
    assert.equal(result.data?.status, "queued", "provider acceptance is not handset delivery");
  });

  it("still refuses absent credentials without a provider invocation", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return accepted(); };
    const result = await sendSms("ACfixture", "", options);
    assert.equal(calls, 0);
    assert.equal(result.needs_config, true);
  });

  it("does not change the original retry behavior of a separate read request", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1 ? new Response("Fictional unavailable read", { status: 503 })
        : new Response(JSON.stringify({ friendly_name: "Fictional account" }), { status: 200 });
    };
    const result = await twilioRequest("ACfixture", "fixture-secret", "/2010-04-01/Accounts/ACfixture.json", "GET");
    assert.equal(calls, 2);
    assert.equal(result.ok, true);
  });
});
