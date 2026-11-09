import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { soloAuthRecoveryFromUrl } from "./soloBetaAcquisition";

describe("existing-account OAuth recovery", () => {
  it("recognizes both query and implicit-flow fragment errors without returning provider payloads", () => {
    expect(soloAuthRecoveryFromUrl("?error=server_error&error_code=unexpected_failure", "")).toBe("provider_error");
    expect(soloAuthRecoveryFromUrl("?mode=login", "#error=access_denied&error_description=private-detail")).toBe("denied");
    expect(soloAuthRecoveryFromUrl("", "#error_code=otp_expired")).toBe("expired");
    expect(soloAuthRecoveryFromUrl("?mode=login", "#access_token=test-only&refresh_token=test-only")).toBeNull();
    expect(soloAuthRecoveryFromUrl("?error=server_error", "#error=access_denied")).toBe("provider_error");
  });

  it("keeps existing-account and invite OAuth returns out of the signup-plan builder", () => {
    const auth = readFileSync("src/pages/Auth.tsx", "utf8");
    const builder = auth.slice(auth.indexOf("const oauthRedirectWithPlan"), auth.indexOf("const handleGoogleSignIn"));
    expect(builder).toMatch(/if \(isClientInvite \|\| isLogin\) return oauthRedirectTo;/);
    expect(builder.indexOf("return oauthRedirectTo")).toBeLessThan(builder.indexOf("stashPlanIntent"));
    expect(auth).toContain('setIsLogin(true); navigate("/auth?mode=login", { replace: true })');
    expect(auth).not.toContain("Nothing was provisioned.");
  });

  it("declares PAIGE's existing icon on the separately served auth document", () => {
    const html = readFileSync("auth.html", "utf8");
    expect(html).toContain('rel="icon" href="/favicon.png"');
    expect(html).toContain('rel="apple-touch-icon" href="/favicon.png"');
    expect(html).toContain("Consent is not a condition of purchase.");
  });
});
