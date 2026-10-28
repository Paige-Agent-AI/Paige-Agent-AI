import { describe, expect, it } from "vitest";
import {
  acquireCallStart,
  discardExpiredVoiceDevice,
  destroyDeferredVoiceDevice,
  isDialableNumber,
  normalizeDialNumber,
  providerCallErrorMessage,
  voiceHistoryStatus,
} from "./voiceCallSafety";

describe("voice call safety", () => {
  it("normalizes US local numbers to E.164 without exposing a client number", () => {
    expect(normalizeDialNumber("(555) 010-0123")).toBe("+15550100123");
    expect(normalizeDialNumber("1 555 010 0123")).toBe("+15550100123");
  });

  it("preserves valid international E.164 numbers and rejects ambiguous input", () => {
    expect(normalizeDialNumber("+44 20 7946 0958")).toBe("+442079460958");
    expect(isDialableNumber("+442079460958")).toBe(true);
    expect(isDialableNumber(normalizeDialNumber("12345"))).toBe(false);
  });

  it("maps provider failures to actionable categories without leaking raw messages", () => {
    const raw = "private provider payload";
    expect(providerCallErrorMessage({ code: 21211, message: raw })).toContain("valid phone number");
    expect(providerCallErrorMessage({ code: 20104, message: raw })).toContain("session expired");
    expect(providerCallErrorMessage({ code: 31005, message: raw })).toContain("Retry");
    expect(providerCallErrorMessage({ code: 99999, message: raw })).toBe(
      "The provider rejected this call. Check the number and retry.",
    );
    expect(providerCallErrorMessage({ code: 99999, message: raw })).not.toContain(raw);
  });

  // The callee not picking up, being busy, or declining is not a provider rejection. These are
  // the Voice JS SDK's SIP-derived errors (@twilio/voice-sdk 2.x: TemporarilyUnavailable 31480,
  // BusyHere 31486, Decline 31603); before this they fell through to the "rejected" catch-all.
  // A declined call reaches Twilio's status callback as CallStatus=no-answer, which the call log
  // writes as "No answer." — so the dialer says the same thing, not a second, different story.
  it("names an unanswered, busy or declined call honestly instead of calling it rejected", () => {
    const raw = "private provider payload";
    expect(providerCallErrorMessage({ code: 31480, message: raw })).toBe("No answer.");
    expect(providerCallErrorMessage({ code: 31486, message: raw })).toBe("The line was busy.");
    expect(providerCallErrorMessage({ code: "31486" })).toBe("The line was busy.");
    expect(providerCallErrorMessage({ code: 31603, message: raw })).toBe("No answer.");
    for (const code of [31480, 31486, 31603]) {
      expect(providerCallErrorMessage({ code, message: raw })).not.toMatch(/rejected/i);
      expect(providerCallErrorMessage({ code, message: raw })).not.toContain(raw);
    }
  });

  it("discards an expired Device so retry must mint a fresh token", () => {
    let destroyed = 0;
    const device = { destroy: () => { destroyed += 1; } };
    const holder = { current: device };

    expect(discardExpiredVoiceDevice({ code: 20104 }, device, holder)).toBe(true);
    expect(holder.current).toBeNull();
    expect(destroyed).toBe(1);

    const healthy = { destroy: () => { destroyed += 1; } };
    const healthyHolder = { current: healthy };
    expect(discardExpiredVoiceDevice({ code: 31005 }, healthy, healthyHolder)).toBe(false);
    expect(healthyHolder.current).toBe(healthy);
    expect(destroyed).toBe(1);

    const established = { destroy: () => { destroyed += 1; } };
    const establishedHolder = { current: established };
    expect(
      discardExpiredVoiceDevice({ code: 31205 }, established, establishedHolder, true),
    ).toBe(true);
    expect(establishedHolder.current).toBeNull();
    expect(destroyed).toBe(1);
    const deferred = { current: established };
    expect(destroyDeferredVoiceDevice(deferred)).toBe(true);
    expect(deferred.current).toBeNull();
    expect(destroyed).toBe(2);
  });

  it("allows only one outbound start before the provider returns a Call object", () => {
    const lock = { current: false };
    expect(acquireCallStart(lock, false)).toBe(true);
    expect(acquireCallStart(lock, false)).toBe(false);
    lock.current = false;
    expect(acquireCallStart(lock, true)).toBe(false);
  });

  it("uses provider-evidence language for call history", () => {
    expect(voiceHistoryStatus("queued")).toEqual({ label: "Initiated", state: "pending" });
    expect(voiceHistoryStatus("delivered")).toEqual({ label: "Completed", state: "success" });
    expect(voiceHistoryStatus("failed")).toEqual({ label: "Failed", state: "error" });
  });
});
