import { describe, expect, it } from "vitest";
import {
  classifyVoiceReadiness,
  hasTenantVoiceAuthority,
} from "../../../supabase/functions/voice-access-token/authorization";

describe("tenant Voice authorization", () => {
  it("denies a global role or membership from another tenant", () => {
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: false,
      membershipTenantId: "tenant-a",
      activeTenantId: "tenant-b",
      membershipStatus: "active",
      membershipRole: "admin",
    })).toBe(false);
  });

  it.each(["owner", "admin"])("allows active %s authority in the resolved tenant", (role) => {
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: false,
      membershipTenantId: "tenant-a",
      activeTenantId: "tenant-a",
      membershipStatus: "active",
      membershipRole: role,
    })).toBe(true);
  });

  it("fails closed with actionable readiness states", () => {
    expect(classifyVoiceReadiness(null, null)).toMatchObject({ ok: false, code: "calling_not_configured" });
    expect(classifyVoiceReadiness(
      { id: "sub-a", active: true, status: "active" },
      [{ subaccount_id: "sub-b", twilio_sid: "PN", capabilities: { voice: true } }],
    )).toMatchObject({ ok: false, code: "calling_number_needs_verification" });
    expect(classifyVoiceReadiness(
      { id: "sub-a", active: true, status: "active" },
      [{ subaccount_id: "sub-a", twilio_sid: "PN", capabilities: { voice: true } }],
    )).toEqual({ ok: true });
  });
});
