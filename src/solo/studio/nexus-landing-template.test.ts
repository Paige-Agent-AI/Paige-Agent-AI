import { describe, expect, it } from "vitest";
import { buildNexusLandingTemplate, NEXUS_LANDING_TEMPLATE_ID } from "./nexus-landing-template";
import { projectStudioBusinessContext } from "./business-context";

const confirmed = { source: "owner_confirmed", confidence: "confirmed" };
function context() {
  return projectStudioBusinessContext({ expectedTenantId: "test-tenant-recipe", target: { kind: "workspace" }, readStatus: "available", context: {
    tenantId: "test-tenant-recipe", contextRevision: 2, brief: { publicName: "Test Workshop", offers: "A planning workshop", idealCustomer: "Independent consultants", brandVoice: "Plain spoken", doNotAssume: "Do not promise results", provenance: Object.fromEntries(["publicName", "offers", "idealCustomer", "brandVoice", "doNotAssume"].map((key) => [key, confirmed])) },
    primaryBusinessEmail: "private@example.invalid", vault: { token: "private-source-token" },
  }, projectValues: { offers: "A project-specific workshop" } });
}

describe("NEXUS editorial landing recipe", () => {
  it("provides one stable reusable structure and grounded context without fabricated commercial blocks", () => {
    const result = buildNexusLandingTemplate({ context: context() });
    expect(result.id).toBe(NEXUS_LANDING_TEMPLATE_ID);
    expect(result.sections.map((section) => section.blockType)).toEqual(["hero", "two_column", "conversion"]);
    expect(result.brief).toContain("A project-specific workshop");
    expect(result.brief).toContain("Test Workshop");
    expect(result.brief).toContain("Private design guidance");
    expect(result.brief).toContain("never place this guidance in public copy");
    expect(result.brief).toContain("omit");
    expect(result.conversion).toBeNull();
    expect(result.missing).toEqual(["ctaLabel", "conversionDestination"]);
    expect(result).not.toHaveProperty("blocks");
    expect(result).not.toHaveProperty("published");
    expect(result.brief).not.toContain("private@example.invalid");
    expect(result.brief).not.toContain("private-source-token");
  });

  it("uses only an explicitly confirmed normalized CTA and destination", () => {
    const result = buildNexusLandingTemplate({ context: context(), conversion: { confirmed: true, ctaLabel: "Book a conversation", destination: { kind: "native_booking", slug: "test-workshop" } } });
    expect(result.conversion).toEqual({ ctaLabel: "Book a conversation", destination: { kind: "native_booking", slug: "test-workshop" } });
    expect(result.missing).toEqual([]);
    expect(result.brief).toContain("Book a conversation");
    expect(result.brief).not.toContain("booking is available");
    expect(result.brief).not.toContain("publication approved");
  });

  it.each([
    { confirmed: false, ctaLabel: "Book now", destination: { kind: "native_booking", slug: "test-workshop" }, missing: ["ctaLabel", "conversionDestination"] },
    { confirmed: true, ctaLabel: "", destination: { kind: "native_booking", slug: "test-workshop" }, missing: ["ctaLabel"] },
    { confirmed: true, ctaLabel: "Book now", destination: { kind: "external_booking", mode: "embed", url: "javascript:alert(1)" }, missing: ["conversionDestination"] },
    { confirmed: true, ctaLabel: "Book now", destination: { kind: "native_form", formId: "another-tenant-label" }, missing: ["conversionDestination"] },
  ])("keeps missing conversion choices missing instead of inventing a link", (conversion) => {
    const result = buildNexusLandingTemplate({ context: context(), conversion });
    expect(result.conversion).toBeNull();
    expect(result.missing).toEqual(conversion.missing);
    expect(result.brief).not.toContain("javascript:");
    expect(result.brief).not.toContain("another-tenant-label");
  });

  it("does not recover workspace facts for a custom target or fabricate missing business facts", () => {
    const custom = projectStudioBusinessContext({ expectedTenantId: "test-tenant-recipe", target: { kind: "custom", reference: "test-custom", label: "Other brand" }, readStatus: "available", context: { tenantId: "test-tenant-recipe", contextRevision: 1, brief: { publicName: "Workspace secret name", provenance: { publicName: confirmed } } }, projectValues: { publicName: "Entered other brand" } });
    const result = buildNexusLandingTemplate({ context: custom });
    expect(result.brief).toContain("Entered other brand");
    expect(result.brief).not.toContain("Workspace secret name");
    expect(result.missing).toContain("offer");
    expect(result.missing).toContain("audience");
    expect(result.brief).toContain("original conversation");
  });

  it("does not mutate the source projection or treat private guidance as a public fact", () => {
    const source = context(); const before = JSON.stringify(source);
    const result = buildNexusLandingTemplate({ context: source });
    expect(JSON.stringify(source)).toBe(before);
    expect(result.publicFacts.some((fact) => fact.key === "doNotAssume" || fact.key === "brandVoice")).toBe(false);
    expect(result.privateGuidance.map((fact) => fact.key)).toEqual(["brandVoice", "doNotAssume"]);
  });

  it("preserves an already confirmed CTA choice when only its destination needs correction", () => {
    const result = buildNexusLandingTemplate({ context: context(), conversion: { confirmed: true, ctaLabel: "Book a conversation", destination: { kind: "external_booking", mode: "embed", url: "javascript:alert(1)" } } });
    expect(result.conversion).toBeNull();
    expect(result.missing).toEqual(["conversionDestination"]);
    expect(result.brief).toContain("Book a conversation");
    expect(result.brief).not.toContain("javascript:");
  });

  it("does not reflect an obvious secret into CTA guidance even if it is marked confirmed", () => {
    const result = buildNexusLandingTemplate({ context: context(), conversion: { confirmed: true, ctaLabel: "api_key=private1234", destination: { kind: "native_booking", slug: "test-workshop" } } });
    expect(result.conversion).toBeNull();
    expect(result.missing).toEqual(["ctaLabel"]);
    expect(result.brief).not.toContain("private1234");
  });

  it("does not reinstate saved facts or expose raw values after an explicit cleared or invalid project edit", () => {
    const source = context();
    const result = buildNexusLandingTemplate({ context: source, projectValues: { publicName: "", offers: "api_key=private1234" } });
    expect(result.publicFacts.some((fact) => fact.key === "publicName" || fact.key === "offers")).toBe(false);
    expect(result.missing).toContain("businessName");
    expect(result.missing).toContain("offer");
    expect(result.brief).not.toContain("Test Workshop");
    expect(result.brief).not.toContain("private1234");
  });

  it("ignores stale source arrays when the caller reports unavailable context", () => {
    const source = context();
    const result = buildNexusLandingTemplate({ context: { ...source, status: "unavailable", reason: "read_pending", projectValues: {} } });
    expect(result.publicFacts).toEqual([]);
    expect(result.privateGuidance).toEqual([]);
    expect(result.brief).not.toContain("Test Workshop");
    expect(result.missing).toContain("businessName");
  });

  it("matches the canonical conversion label boundary at 60 characters", () => {
    const destination = { kind: "native_booking", slug: "test-workshop" };
    expect(buildNexusLandingTemplate({ context: context(), conversion: { confirmed: true, ctaLabel: "x".repeat(60), destination } }).conversion?.ctaLabel).toHaveLength(60);
    const tooLong = buildNexusLandingTemplate({ context: context(), conversion: { confirmed: true, ctaLabel: "x".repeat(61), destination } });
    expect(tooLong.conversion).toBeNull();
    expect(tooLong.missing).toEqual(["ctaLabel"]);
    expect(tooLong.brief).not.toContain("x".repeat(61));
  });

  it("keeps selected target kind, label and reference as project data in the reusable brief", () => {
    const selected = projectStudioBusinessContext({ expectedTenantId: "test-tenant-recipe", target: { kind: "custom", reference: "selected-brand-reference", label: "Selected project brand" }, readStatus: "available", context: null });
    const result = buildNexusLandingTemplate({ context: selected });
    expect(result.brief).toContain('"kind":"custom"');
    expect(result.brief).toContain('"reference":"selected-brand-reference"');
    expect(result.brief).toContain('"label":"Selected project brand"');
    expect(result.brief).not.toMatch(/verified target|authorized target/i);
    const unknown = buildNexusLandingTemplate({ context: { ...selected, target: null } });
    expect(unknown.brief).toContain("Selected business target is unknown");
  });
});
