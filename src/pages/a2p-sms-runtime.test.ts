import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("platform A2P runtime boundaries", () => {
  it("gates operator sends on platform-only durable consent and registered framing", () => {
    const source = read("supabase/functions/paige-operator-sms-send/index.ts");
    expect(source).toContain('formatPaigeAgentAiSms({');
    // The platform-only, unrevoked, verified-number rules live in the one SQL gate (#2087), proven by
    // supabase/tests/security_consent_and_form_links.sql; the sender must use it and hold on anything else.
    expect(source).toContain('admin.rpc("has_sms_consent"');
    expect(source).toContain("platformConsent !== true");
    expect(source).not.toContain('.from("communications_consents")');
    expect(source).toContain('reason: "platform_sms_consent_required"');
    expect(source).not.toContain("STOP_SUFFIX");
  });

  it("fails closed when legacy send classes do not match the platform Campaign", () => {
    const source = read("supabase/functions/send-sms/index.ts");
    expect(source).toContain("PLATFORM_ACCOUNT_NOTIFICATION_TYPES");
    expect(source).toContain("campaign_not_registered");
    expect(source).toContain("platform_sms_consent_required");
    expect(source).toContain("formatPaigeAgentAiSms({");
    expect(source).toContain("sendOperatorSms(normalizedTo, finalBody)");
    expect(source).not.toContain("Messages.json");
  });

  it("removes or suppresses every discovered raw-master send bypass", () => {
    const reminder = read("supabase/functions/send-sms-reminder/index.ts");
    expect(reminder).toContain("/functions/v1/send-sms");
    expect(reminder).toContain("user.id !== userId");
    expect(reminder).not.toContain("Messages.json");

    for (const path of [
      "supabase/functions/schedule-automated-tasks/index.ts",
      "supabase/functions/voice-command-processor/index.ts",
    ]) {
      expect(read(path)).toContain("user.id !== userId");
    }

    const booking = read("supabase/functions/_shared/bookingNotify.ts");
    expect(booking).toContain("SMS suppressed: tenant governed send context required");
    expect(booking).not.toContain("Messages.json");

    const mcp = read("supabase/functions/paige-mcp/index.ts");
    expect(mcp).toContain("blocked_a2p_governed_sender_required");
    expect(mcp).not.toContain("authToken}`");
  });

  it("persists STOP and START while suppressing duplicate Advanced Opt-Out replies", () => {
    for (const path of [
      "supabase/functions/paige-operator-sms-inbound/index.ts",
      "supabase/functions/twilio-inbound-webhook/index.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("OptOutType");
      expect(source).toContain("revoked_at");
      expect(source).toContain("sms_start_keyword");
      expect(source).toContain("paige-platform-sms-keyword-start-v1-2026-08-31");
      expect(source).toMatch(/if \(optOutType\) return twiml\(\)/);
    }
  });

  it("makes platform consent identity and marketing scope immutable", () => {
    const source = read("supabase/migrations/20260901020000_harden_platform_sms_consent_evidence.sql");
    expect(source).toContain("NEW.sms_marketing");
    expect(source).toContain("NEW.source_url");
    expect(source).toContain("NEW.disclosure_version");
    expect(source).toContain("withdrawal is irreversible");
  });
});
