import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSoloBetaPlan,
  isVerifiedSoloEntitlement,
  keepPublicSoloPlan,
  soloBetaCheckoutBody,
  soloBetaDisplayIntent,
  soloBetaSignupPath,
  soloAuthRecoveryState,
} from "./soloBetaAcquisition";

// The home's copy lives in the page and in src/marketing/* — the honesty guards read all of it.
const publicHome = [
  "src/pages/PaigeHome.tsx",
  ...readdirSync("src/marketing").filter((f) => /\.tsx?$/.test(f)).map((f) => `src/marketing/${f}`),
].map((f) => readFileSync(f, "utf8")).join("\n");
const pricing = readFileSync("src/pages/Pricing.tsx", "utf8");
const auth = readFileSync("src/pages/Auth.tsx", "utf8");

describe("Solo-only beta acquisition contract", () => {
  it("emits one fixed public display intent and signup path", () => {
    expect(soloBetaDisplayIntent()).toEqual({ plan: "solo", billing: "monthly" });
    expect(soloBetaSignupPath()).toBe("/auth?mode=signup&plan=solo&billing=monthly");
    expect(isSoloBetaPlan("solo")).toBe(true);
    expect(isSoloBetaPlan("agency")).toBe(false);
    expect(isSoloBetaPlan("enterprise")).toBe(false);
    expect(isSoloBetaPlan(null)).toBe(false);
  });

  it("classifies verification and OAuth recovery without exposing provider payloads", () => {
    expect(soloAuthRecoveryState({ errorCode: "otp_expired" })).toBe("expired");
    expect(soloAuthRecoveryState({ error: "access_denied" })).toBe("denied");
    expect(soloAuthRecoveryState({ error: "server_error" })).toBe("provider_error");
    expect(soloAuthRecoveryState({})).toBeNull();
  });

  it("keeps only the active Solo offer on public pricing", () => {
    expect(keepPublicSoloPlan([
      { slug: "solo", is_active: true },
      { slug: "agency", is_active: true },
      { slug: "enterprise", is_active: true },
      { slug: "solo", is_active: false },
    ])).toEqual([{ slug: "solo", is_active: true }]);
  });

  it("repeats the exact paid offer at pricing and account commitment", () => {
    expect(pricing).toContain("Paige Solo Beta");
    expect(pricing).toContain("$74.50");
    expect(pricing).toContain("30-day trial");
    expect(auth).toContain("Start Paige Solo Beta");
    expect(auth).toContain("Start your 30-day trial. Then $74.50/month unless you cancel before your first paid renewal.");
    expect(auth).toContain("Create Solo Beta account");
    expect(auth).toContain("signUpWithReferral");
    expect(auth).toContain('signup_offer_code: "paige-solo-beta-monthly-v1"');
    expect(auth).not.toContain("14-day");
    expect(auth).not.toContain("no trial");
    expect(auth).not.toContain("$149");
  });

  it("never sends caller-selected plan, account type, billing period, or trial to checkout", () => {
    expect(soloBetaCheckoutBody()).toEqual({
      offer_code: "paige-solo-beta-monthly-v1",
      success_path: "/welcome?checkout=success",
      cancel_path: "/welcome?checkout=cancelled",
    });
    expect(soloBetaCheckoutBody()).not.toHaveProperty("plan_slug");
    expect(soloBetaCheckoutBody()).not.toHaveProperty("account_type");
    expect(soloBetaCheckoutBody()).not.toHaveProperty("billing_period");
    expect(soloBetaCheckoutBody()).not.toHaveProperty("trial_period_days");
  });

  it("keeps the reachable Solo story free of unsupported automatic-action and agency claims", () => {
    for (const unsupported of [
      "sent prep", "onboarded while you slept", "Invoice sent", "welcome sequences sent",
      "check-ins sent", "Agency owner", "Paige runs your", "Fully handled",
      "hired Paige", "Ready to hire me", "I sent this month's invoices",
      "Every client gets the follow-up", "Paige runs your operation",
    ]) expect(publicHome).not.toContain(unsupported);
    // The honest line replaced the old hedge (Lane D, 2026-09-28): Paige's work is the
    // deliverable, the owner's say is the control, and anything not live is labelled in build.
    expect(publicHome).toContain("waits for your yes.");
    expect(publicHome).toContain("Reading your inbox directly is in build.");
    expect(publicHome).not.toContain("ready for your review");
    expect(publicHome).not.toMatch(/\bbeta\b/i);
    for (const invented of ["Solo business coach", "Solo executive coach", "Solo consultant", "Solo advisor", "Solo strategist", "Solo creator"]) {
      expect(publicHome).not.toContain(invented);
    }
  });

  it("accepts only a server-returned live Solo entitlement", () => {
    expect(isVerifiedSoloEntitlement({ plan_slug: "solo", status: "active" })).toBe(true);
    expect(isVerifiedSoloEntitlement({ plan_slug: "solo", status: "trialing" })).toBe(true);
    expect(isVerifiedSoloEntitlement({ plan_slug: "agency", status: "active" })).toBe(false);
    expect(isVerifiedSoloEntitlement({ plan_slug: "solo", status: "past_due" })).toBe(false);
    expect(isVerifiedSoloEntitlement(null)).toBe(false);
  });
});
