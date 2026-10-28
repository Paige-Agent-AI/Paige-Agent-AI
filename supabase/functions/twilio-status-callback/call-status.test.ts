// An unanswered call is not a provider rejection.
//
// Before this test, every unsuccessful terminal CallStatus (busy / no-answer / canceled / failed)
// was written to the Conversations row as "The provider rejected this call." — prod carried a
// no-answer call labelled exactly that. The status stays 'failed' (messages_status_check has no
// other unsuccessful value, and every reader keys on it); only the wording becomes honest.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callOutcomeError, decideInboundCall, mapCallStatus } from "./call-status.ts";

describe("call outcome wording is honest about why a call did not connect", () => {
  it("no-answer says No answer, never 'rejected'", () => {
    assert.equal(callOutcomeError("no-answer", null), "No answer.");
  });
  it("busy says the line was busy", () => {
    assert.equal(callOutcomeError("busy", null), "The line was busy.");
  });
  it("canceled says the call was cancelled", () => {
    assert.equal(callOutcomeError("canceled", null), "The call was cancelled.");
  });
  it("a busy callback that carries a SIP code still reads as busy, not rejected", () => {
    const text = callOutcomeError("busy", "486");
    assert.equal(text, "The line was busy.");
    assert.doesNotMatch(text, /rejected/i);
  });
  it("is case- and whitespace-insensitive, like mapCallStatus", () => {
    assert.equal(callOutcomeError("  NO-ANSWER ", null), "No answer.");
  });
  it("keeps 'rejected' ONLY for a genuine provider failure", () => {
    assert.equal(callOutcomeError("failed", null), "The provider rejected this call.");
    assert.equal(callOutcomeError("failed", "13224"), "The provider rejected this call (error 13224).");
  });
  it("an unknown terminal status falls back to the provider-failure wording, not a guess", () => {
    assert.equal(callOutcomeError("wobble", null), "The provider rejected this call.");
  });
  it("the stored status is unchanged: all four unsuccessful terminals are still 'failed'", () => {
    for (const s of ["busy", "no-answer", "canceled", "failed"]) assert.equal(mapCallStatus(s), "failed");
  });
});

// INBOUND calls ring every seat at once (one <Client> leg per owner/admin) and, once a number has a
// VoiceUrl, the number-level StatusCallback also posts the PARENT call's end. Callbacks arrive in any
// order, so the inbound outcome is decided per callback kind, never "first terminal wins":
//   • a CHILD leg that answered (in-progress, or completed with duration > 0) is the answer;
//   • a CHILD leg that did not answer (the losers Twilio cancels, or a leg nobody picked up) decides
//     nothing on its own — another seat may still answer;
//   • the PARENT's end settles "nobody answered" — and only if no leg answered.
describe("inbound call decision is robust to callback order", () => {
  const child = { parentCallSid: "CAparent" };
  const parent = { parentCallSid: null };
  it("an answered child leg is the answer", () => {
    assert.deepEqual(decideInboundCall({ ...child, twilioStatus: "completed", duration: 42, errorCode: null }), { kind: "answered" });
    assert.deepEqual(decideInboundCall({ ...child, twilioStatus: "in-progress", duration: null, errorCode: null }), { kind: "answered" });
  });
  it("a completed child leg with no talk time is NOT an answer", () => {
    assert.deepEqual(decideInboundCall({ ...child, twilioStatus: "completed", duration: 0, errorCode: null }), { kind: "record_leg" });
    assert.deepEqual(decideInboundCall({ ...child, twilioStatus: "completed", duration: null, errorCode: null }), { kind: "record_leg" });
  });
  it("a losing or unanswered child leg never decides the call", () => {
    for (const s of ["canceled", "no-answer", "busy", "failed"]) {
      assert.deepEqual(decideInboundCall({ ...child, twilioStatus: s, duration: 0, errorCode: null }), { kind: "record_leg" }, s);
    }
  });
  it("the parent's completed settles an unanswered call as No answer — it never means connected", () => {
    assert.deepEqual(decideInboundCall({ ...parent, twilioStatus: "completed", duration: 30, errorCode: null }),
      { kind: "settle_unanswered", error: "No answer." });
  });
  it("other parent terminals settle with their own honest wording", () => {
    assert.deepEqual(decideInboundCall({ ...parent, twilioStatus: "no-answer", duration: null, errorCode: null }),
      { kind: "settle_unanswered", error: "No answer." });
    assert.deepEqual(decideInboundCall({ ...parent, twilioStatus: "failed", duration: null, errorCode: "13224" }),
      { kind: "settle_unanswered", error: "The provider rejected this call (error 13224)." });
  });
  it("a non-terminal parent status decides nothing", () => {
    for (const s of ["ringing", "in-progress", "queued", "wobble"]) {
      assert.deepEqual(decideInboundCall({ ...parent, twilioStatus: s, duration: null, errorCode: null }), { kind: "record_leg" }, s);
    }
  });
});
