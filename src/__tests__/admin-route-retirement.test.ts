import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { safeRedirectOr } from "@/lib/auth/safeRedirect";
import { canonicalSetupPath } from "@/components/auth/RequireSetupComplete";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const executableSource = (path: string) => source(path)
  .split(/\r?\n/)
  .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
  .join("\n");

// INT-280 retains this one inbound bookmark as a redirect to the guarded Operator
// door. It produces no /admin destination; every other executable legacy URL stays forbidden.
const intelligenceInboundRoute = '<Route path="/admin/platform/intelligence" element={<LegacyIntelligenceRedirect />} />';
const withoutIntelligenceInboundRoute = (code: string) => code.replace(intelligenceInboundRoute, "");
const legacyDestination = /["'`]\/admin(?:\/|["'`])/;


describe("retired privileged URL", () => {
  it("does not mount a legacy privileged route in the product router", () => {
    const app = source("src/App.tsx");
    expect(app).not.toMatch(/path=["']\/admin(?:\/\*)?["']/);
    expect(app).not.toMatch(/import\([^)]*pages\/Admin/);
  });

  it("rejects legacy notification and OAuth return targets", () => {
    expect(safeRedirectOr("/admin", "/choose-account")).toBe("/choose-account");
    expect(safeRedirectOr("/admin/contacts/secret", "/choose-account")).toBe("/choose-account");
    expect(safeRedirectOr("//evil.example/admin", "/choose-account")).toBe("/choose-account");
  });

  it("keeps canonical product returns available", () => {
    expect(safeRedirectOr("/solo/42/command-center", "/choose-account")).toBe("/solo/42/command-center");
    expect(safeRedirectOr("/business/84/setup", "/choose-account")).toBe("/business/84/setup");
    expect(safeRedirectOr("/agency/12/command-center", "/choose-account")).toBe("/agency/12/command-center");
  });

  it("resolves setup only from a valid server-derived account address", () => {
    expect(canonicalSetupPath("solo", 42)).toBe("/solo/42/settings/setup");
    expect(canonicalSetupPath("sub_account", "84")).toBe("/business/84/setup");
    expect(canonicalSetupPath("agency", 12)).toBeNull();
    expect(canonicalSetupPath("solo", "not-an-account")).toBeNull();
  });

  it("minimizes the tenant fields returned during landing", () => {
    const resolver = executableSource("src/lib/auth/resolveLandingRoute.ts");
    expect(resolver).toContain('.select("id, account_type, parent_tenant_id, account_number")');
    expect(resolver).not.toContain('from("tenants").select("*")');
  });

  it("removes executable producers from the core entry flow", () => {
    for (const path of [
      "src/App.tsx", "src/pages/ChooseAccount.tsx", "src/lib/auth/resolveLandingRoute.ts",
      "src/pages/GmailCallback.tsx", "src/pages/GoogleCalendarCallback.tsx",
      "src/components/dashboard/NotificationBell.tsx", "src/components/auth/RequireSetupComplete.tsx",
    ]) {
      const code = executableSource(path);
      expect(path === "src/App.tsx" ? withoutIntelligenceInboundRoute(code) : code).not.toMatch(legacyDestination);
    }
  });

  it("permits only the dedicated inbound Intelligence redirect, never a legacy producer or privileged mount", () => {
    expect(withoutIntelligenceInboundRoute(intelligenceInboundRoute)).not.toMatch(legacyDestination);
    for (const forbidden of [
      '<Navigate to="/admin/platform/intelligence" />',
      '<Route path="/admin/platform/intelligence" element={<PrivilegedPage />} />',
      '<Route path="/admin/*" element={<LegacyIntelligenceRedirect />} />',
      '<Route path="/admin/another-view" element={<LegacyIntelligenceRedirect />} />',
    ]) expect(withoutIntelligenceInboundRoute(`${intelligenceInboundRoute}\n${forbidden}`)).toMatch(legacyDestination);

    const app = executableSource("src/App.tsx");
    expect(app.split(intelligenceInboundRoute)).toHaveLength(2);
    const redirect = app.match(/function LegacyIntelligenceRedirect\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(redirect).toContain('pathname: "/operator/settings/paige-intelligence", search: route.search, hash: route.hash');
    expect(redirect).toContain(" replace />");
  });
});
