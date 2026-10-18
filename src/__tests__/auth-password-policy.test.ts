import { describe, expect, it } from "vitest";
import { authSchema, signupSchema } from "@/pages/Auth";

// EXP00 live-incident pin (2026-10-17): the server password policy requires one
// lowercase, one uppercase, one digit and one symbol; the form previously only
// enforced min-6 and surfaced a dead-end "contact support" toast. The rule is
// SIGNUP-only — sign-in keeps accepting legacy weaker passwords.
const POLICY_MESSAGE = "Password needs a lowercase letter, an uppercase letter, a number, and a symbol (like !@#$%).";

const base = { email: "someone@example.com", fullName: "Some One" };

describe("authSchema password policy matches the Supabase server policy", () => {
  it("accepts a policy-compliant password at signup", () => {
    const result = signupSchema.safeParse({ ...base, password: "1Hr#55R9YoNjYMsd4QlH" });
    expect(result.success).toBe(true);
  });

  it("rejects a strong-but-symbol-less password at signup with the specific message", () => {
    const result = signupSchema.safeParse({ ...base, password: "ZVIhoCfEnhUOuH1NVSSd" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(POLICY_MESSAGE);
    }
  });

  it("rejects missing character classes one at a time", () => {
    const noLower = signupSchema.safeParse({ ...base, password: "1HR#55R9YONJYMSD4QLH" });
    const noUpper = signupSchema.safeParse({ ...base, password: "1hr#55r9yonjymsd4qlh" });
    const noDigit = signupSchema.safeParse({ ...base, password: "xHr#xxRxxOnjYMsdxxQlH" });
    const noSymbol = signupSchema.safeParse({ ...base, password: "1Hra55R9YoNjYMsd4QlH" });
    for (const result of [noLower, noUpper, noDigit, noSymbol]) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(POLICY_MESSAGE);
      }
    }
  });

  it("still enforces the minimum length first", () => {
    const result = signupSchema.safeParse({ ...base, password: "aB1!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Password must be at least 6 characters");
    }
  });

  it("lets a legacy min-6-only password through SIGN-IN validation", () => {
    const result = authSchema.safeParse({ email: "someone@example.com", password: "hunter2" });
    expect(result.success).toBe(true);
  });
});

