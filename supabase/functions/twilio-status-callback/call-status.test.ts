// An unanswered call is not a provider rejection.
//
// Before this test, every unsuccessful terminal CallStatus (busy / no-answer / canceled / failed)
// was written to the Conversations row as "The provider rejected this call." — prod carried a
// no-answer call labelled exactly that. The status stays 'failed' (messages_status_check has no
// other unsuccessful value, and every reader keys on it); only the wording becomes honest.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callOutcomeError, mapCallStatus } from "./call-status.ts";

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
