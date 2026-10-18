import { describe, expect, it } from "vitest";
import { authSchema } from "@/pages/Auth";

// EXP00 live-incident pin (2026-10-17): the server password policy requires one
// lowercase, one uppercase, one digit and one symbol; the form previously only
// enforced min-6 and surfaced a dead-end "contact support" toast.
const POLICY_MESSAGE = "Password needs a lowercase letter, an uppercase letter, a number, and a symbol (like !@#$%).";

const base = { email: "someone@example.com", fullName: "Some One" };

describe("authSchema password policy matches the Supabase server policy", () => {
  it("accepts a policy-compliant password", () => {
    const result = authSchema.safeParse({ ...base, password: "1Hr#55R9YoNjYMsd4QlH" });
    expect(result.success).toBe(true);
  });

  it("rejects a strong-but-symbol-less password with the specific message", () => {
    const result = authSchema.safeParse({ ...base, password: "ZVIhoCfEnhUOuH1NVSSd" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(POLICY_MESSAGE);
    }
  });

  it("rejects missing character classes one at a time", () => {
    const noLower = authSchema.safeParse({ ...base, password: "1HR#55R9YONJYMSD4QLH" });
    const noUpper = authSchema.safeParse({ ...base, password: "1hr#55r9yonjymsd4qlh" });
    const noDigit = authSchema.safeParse({ ...base, password: "xHr#xxRxxOnjYMsdxxQlH" });
    const noSymbol = authSchema.safeParse({ ...base, password: "1Hra55R9YoNjYMsd4QlH" });
    for (const result of [noLower, noUpper, noDigit, noSymbol]) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(POLICY_MESSAGE);
      }
    }
  });

  it("still enforces the minimum length first", () => {
    const result = authSchema.safeParse({ ...base, password: "aB1!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Password must be at least 6 characters");
    }
  });
});
