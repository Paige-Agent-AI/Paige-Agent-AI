import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyTtsFailure } from "./messageTtsFailure";

// Dates inside the current UTC year render without a year, so build them from the clock.
const THIS_YEAR = new Date().getUTCFullYear();

describe("message TTS failure copy", () => {
  it("keeps the required failure states distinct without naming a provider", () => {
    const cases = [
      ["tts_tenant_allowance_reached", 429, "allowance", "monthly allowance"],
      ["tts_tenant_cost_limit", 429, "allowance", "this workspace’s monthly allowance"],
      ["tts_global_cap_reached", 429, "platform_unavailable", "temporarily unavailable"],
      ["tts_platform_cost_limit", 503, "platform_unavailable", "temporarily unavailable"],
      ["tts_emergency_disabled", 503, "paused", "paused right now"],
      ["tts_request_already_reserved", 409, "pending", "still be processing"],
      ["tts_request_ambiguous", 409, "pending", "still be processing"],
      ["tts_synth_failed", 502, "retryable", "didn’t start"],
      ["tts_cost_limit_unavailable", 503, "retryable", "didn’t start"],
      ["tts_not_configured", 503, "not_configured", "isn’t available"],
      ["tts_workspace_voice_disabled", 503, "not_configured", "isn’t available"],
      // INT-321: transient profile failures are retries, never the sticky not-configured state.
      ["voice_profile_unavailable", 503, "retryable", "didn’t start"],
      ["tts_voice_profile_changed", 503, "retryable", "didn’t start"],
    ] as const;

    for (const [code, status, kind, copy] of cases) {
      const result = classifyTtsFailure(code, status);
      expect(result.kind, code).toBe(kind);
      expect(result.message, code).toContain(copy);
      expect(result.message).not.toMatch(/openai|elevenlabs|provider|PAIGE_VOICE|54000|budget/i);
    }
  });

  it("INT-321: a workspace that used its allowance is never told the platform is paused", () => {
    const tenant = classifyTtsFailure("tts_tenant_cost_limit", 429, `${THIS_YEAR}-11-01T00:00:00Z`);
    expect(tenant.kind).toBe("allowance");
    expect(tenant.message).not.toMatch(/paused|temporarily/i);
    expect(tenant.message).toBe(
      "Voice playback has reached this workspace’s monthly allowance. It resets November 1.",
    );
  });

  it("INT-321: tenant allowance, platform cap and emergency brake are three different states", () => {
    const kinds = new Set([
      classifyTtsFailure("tts_tenant_cost_limit", 429).kind,
      classifyTtsFailure("tts_platform_cost_limit", 503).kind,
      classifyTtsFailure("tts_emergency_disabled", 503).kind,
    ]);
    expect(kinds.size).toBe(3);
    const messages = new Set([
      classifyTtsFailure("tts_tenant_cost_limit", 429).message,
      classifyTtsFailure("tts_platform_cost_limit", 503).message,
      classifyTtsFailure("tts_emergency_disabled", 503).message,
    ]);
    expect(messages.size).toBe(3);
  });

  it("shows reset timing only when the server supplies a valid value, as the UTC calendar day", () => {
    const withoutReset = classifyTtsFailure("tts_tenant_cost_limit", 429);
    const withReset = classifyTtsFailure("tts_tenant_cost_limit", 429, `${THIS_YEAR}-10-01T00:00:00Z`);
    const invalidReset = classifyTtsFailure("tts_tenant_cost_limit", 429, "not-a-date");
    const nextYear = classifyTtsFailure("tts_tenant_cost_limit", 429, `${THIS_YEAR + 1}-01-01T00:00:00Z`);

    expect(withoutReset.message).toBe("Voice playback has reached this workspace’s monthly allowance.");
    expect(withReset.message).toMatch(/It resets October 1\.$/);
    expect(invalidReset.message).toBe(withoutReset.message);
    expect(nextYear.message).toMatch(new RegExp(`It resets January 1, ${THIS_YEAR + 1}\\.$`));
  });

  it("INT-321: only proven configuration disables playback; a profile blip or race is a retry", () => {
    expect(classifyTtsFailure("tts_not_configured", 503).kind).toBe("not_configured");
    expect(classifyTtsFailure("tts_workspace_voice_disabled", 503).kind).toBe("not_configured");
    expect(classifyTtsFailure("voice_profile_unavailable", 503)).toEqual({
      kind: "retryable",
      message: "Voice playback didn’t start. Please try again.",
    });
    expect(classifyTtsFailure("tts_voice_profile_changed", 503)).toEqual({
      kind: "retryable",
      message: "Voice playback didn’t start. Please try again.",
    });
  });

  it("never infers paused or unavailable from a status code alone", () => {
    expect(classifyTtsFailure(null, 409).kind).toBe("pending");
    expect(classifyTtsFailure(null, 502).kind).toBe("retryable");
    expect(classifyTtsFailure(null, 503).kind).toBe("retryable");
    expect(classifyTtsFailure("unknown_future_code", 503).kind).toBe("retryable");
    expect(classifyTtsFailure("unknown_future_code", 418).kind).toBe("retryable");
  });
});

// INT-321 (F5): the reset day must be the UTC calendar day the server proved. In a negative-offset
// zone, 00:00Z on the 1st is still the last day of the previous month locally — so this only passes
// if formatting really pins UTC. The guard asserts the zone actually took effect for Intl.
describe("message TTS reset date in a viewer's negative-offset timezone", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("renders 00:00Z on November 1 as November 1, not the viewer's October 31", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    expect(new Date(`${THIS_YEAR}-11-01T00:00:00Z`).getDate()).toBe(31);

    expect(classifyTtsFailure("tts_tenant_cost_limit", 429, `${THIS_YEAR}-11-01T00:00:00Z`).message).toBe(
      "Voice playback has reached this workspace’s monthly allowance. It resets November 1.",
    );
    expect(classifyTtsFailure("tts_tenant_cost_limit", 429, `${THIS_YEAR + 1}-01-01T00:00:00Z`).message).toBe(
      `Voice playback has reached this workspace’s monthly allowance. It resets January 1, ${THIS_YEAR + 1}.`,
    );
  });
});
