import { describe, expect, it } from "vitest";
import { projectStudioBusinessContext, type StudioBusinessContextInput } from "./business-context";

const tenant = "test-tenant-studio-a";
const confirmed = { source: "owner_confirmed", confidence: "confirmed", confirmedAt: "2026-11-01T10:00:00Z" };

function context(brief: Record<string, unknown> = {}) {
  return {
    tenantId: tenant,
    contextRevision: 7,
    tenantName: "Unconfirmed fallback name",
    brief: {
      publicName: "Test Studio",
      dbaName: "Test Studio Design",
      offers: "A practical service workshop",
      idealCustomer: "Independent service businesses",
      customerSegments: "Consultants",
      serviceArea: "Online",
      brandVoice: "Direct and considerate",
      doNotAssume: "Do not promise business results",
      provenance: Object.fromEntries([
        "publicName", "dbaName", "offers", "idealCustomer", "customerSegments", "serviceArea", "brandVoice", "doNotAssume",
      ].map((key) => [key, { ...confirmed }])),
      ...brief,
    },
    businessOwners: [{ legalName: "Private owner", representativeUserId: "private-owner-id" }],
    primaryBusinessEmail: "private@example.invalid",
    managedEmail: { address: "managed@example.invalid" },
    knowledgeSources: [{ notes: "Private Knowledge content" }],
    vault: { token: "private-vault-value" },
    accessScope: "owner_full",
  };
}

function input(overrides: Partial<StudioBusinessContextInput> = {}): StudioBusinessContextInput {
  return { expectedTenantId: tenant, target: { kind: "workspace" }, readStatus: "available", context: context(), ...overrides };
}

function brand(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: tenant,
    target: { kind: "workspace" },
    readStatus: "available",
    observedAt: "2026-11-13T10:00:00Z",
    values: {
      product_name: "Test Studio",
      primary_color: "#123456",
      accent_color: "#fedcba",
      font: "Schibsted Grotesk",
      logo_url: "https://assets.example.invalid/public/logo.png",
      logo_dark_url: "https://assets.example.invalid/public/logo-dark.png",
      tagline: "A clear next step",
      address: "Private address",
      phone: "Private phone",
      support_email: "private@example.invalid",
      api_key: "private-brand-key",
    },
    ...overrides,
  };
}

const values = (facts: { key: string; value: string }[]) => Object.fromEntries(facts.map((fact) => [fact.key, fact.value]));

describe("Studio business context projection", () => {
  it("separates confirmed copy facts from private design guidance without copying raw context", () => {
    const result = projectStudioBusinessContext(input());
    expect(result.status).toBe("available");
    expect(values(result.copyFacts)).toEqual({ publicName: "Test Studio", dbaName: "Test Studio Design", offers: "A practical service workshop", idealCustomer: "Independent service businesses", customerSegments: "Consultants", serviceArea: "Online" });
    expect(values(result.privateGuidance)).toEqual({ brandVoice: "Direct and considerate", doNotAssume: "Do not promise business results" });
    expect(result.copyFacts[0].source).toEqual({ kind: "setup", field: "publicName", revision: 7, confidence: "confirmed", confirmedAt: confirmed.confirmedAt });
    expect(result.source).toEqual({ kind: "setup", tenantId: tenant, revision: 7 });
    const serialized = JSON.stringify(result);
    for (const excluded of ["Private owner", "private-owner-id", "private@example.invalid", "managed@example.invalid", "Private Knowledge content", "private-vault-value", "owner_full"]) expect(serialized).not.toContain(excluded);
    expect(result).not.toHaveProperty("authorized");
    expect(result).not.toHaveProperty("publicationApproved");
  });

  it("requires both original owner-confirmed provenance markers and never invents a name fallback", () => {
    const row = context({ publicName: "", provenance: { offers: { source: "connection_sourced", confidence: "confirmed" }, idealCustomer: { source: "owner_confirmed", confidence: "observed" } } });
    const result = projectStudioBusinessContext(input({ context: row }));
    expect(result.copyFacts).toEqual([]);
    expect(result.privateGuidance).toEqual([]);
    expect(result.missingFields).toContain("publicName");
    expect(result.missingFields).toContain("offers");
    expect(JSON.stringify(result)).not.toContain("Unconfirmed fallback name");
  });

  it("rejects a different workspace before returning any saved context or brand", () => {
    const result = projectStudioBusinessContext(input({ context: { ...context(), tenantId: "test-tenant-studio-b" }, publicBrand: brand(), projectValues: { publicName: "Project choice" } }));
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("scope_mismatch");
    expect(result.copyFacts).toEqual([]);
    expect(result.privateGuidance).toEqual([]);
    expect(result.brandFacts).toEqual([]);
    expect(result.source).toBeNull();
    expect(result.projectValues).toEqual({ publicName: "Project choice" });
  });

  it.each([undefined, null, -1, 0.5, "7", Number.NaN, Number.MAX_SAFE_INTEGER + 1])("refuses missing or invalid current revision %s", (revision) => {
    const result = projectStudioBusinessContext(input({ context: { ...context(), contextRevision: revision } }));
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("invalid_revision");
    expect(result.copyFacts).toEqual([]);
  });

  it("accepts revision zero but refuses an expected-revision conflict", () => {
    expect(projectStudioBusinessContext(input({ context: { ...context(), contextRevision: 0 }, expectedRevision: 0 })).status).toBe("available");
    const result = projectStudioBusinessContext(input({ expectedRevision: 8, publicBrand: brand() }));
    expect(result.status).toBe("conflict");
    expect(result.reason).toBe("revision_changed");
    expect(result.copyFacts).toEqual([]);
    expect(result.brandFacts).toEqual([]);
  });

  it.each(["loading", "unavailable", "conflict"] as const)("does not reuse stale facts when the selected read is %s", (readStatus) => {
    const result = projectStudioBusinessContext(input({ readStatus, publicBrand: brand() }));
    expect(result.status).toBe(readStatus === "conflict" ? "conflict" : "unavailable");
    expect(result.copyFacts).toEqual([]);
    expect(result.brandFacts).toEqual([]);
    expect(result.source).toBeNull();
  });

  it.each(["client", "prospect", "custom"] as const)("never inherits workspace context for a %s target based on its label or ID", (kind) => {
    const result = projectStudioBusinessContext(input({ target: { kind, reference: "target-one", label: "Different brand" }, publicBrand: brand(), projectValues: { publicName: "Entered project brand", primaryColor: "#abcdef", primaryBusinessEmail: "private@example.invalid", vault: "private" } }));
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("target_unverified");
    expect(result.copyFacts).toEqual([]);
    expect(result.brandFacts).toEqual([]);
    expect(result.projectValues).toEqual({ publicName: "Entered project brand", primaryColor: "#abcdef" });
    expect(JSON.stringify(result)).not.toContain("Test Studio");
  });

  it.each([
    { callerVerified: false },
    { callerVerified: true, target: { kind: "client", reference: "different" } },
    { callerVerified: true, target: { kind: "custom", reference: "target-one" } },
    { callerVerified: true, context: { ...context(), tenantId: "test-tenant-studio-b" } },
  ])("refuses an unverified or mismatched selected-target envelope", (override) => {
    const target = { kind: "client", reference: "target-one" };
    const result = projectStudioBusinessContext(input({ target, targetContext: { callerVerified: true, target, readStatus: "available", context: context({ publicName: "Selected client brand" }), ...override } }));
    expect(result.status).not.toBe("available");
    expect(result.copyFacts).toEqual([]);
    expect(result.brandFacts).toEqual([]);
  });

  it("uses only a matching caller-verified selected-target projection and keeps project values separate", () => {
    const target = { kind: "custom", reference: "target-one", label: "Selected brand" };
    const result = projectStudioBusinessContext(input({ target, publicBrand: brand(), targetContext: { callerVerified: true, target, readStatus: "available", context: context({ publicName: "Selected brand", offers: "Selected offer" }) }, projectValues: { publicName: "Revised project name" } }));
    expect(result.status).toBe("available");
    expect(values(result.copyFacts).publicName).toBe("Selected brand");
    expect(values(result.copyFacts).offers).toBe("Selected offer");
    expect(result.brandFacts).toEqual([]);
    expect(result.source?.kind).toBe("target_context");
    expect(result.projectValues).toEqual({ publicName: "Revised project name" });
    expect(result).not.toHaveProperty("permission");
  });

  it("returns only explicitly scoped public brand fields, with observed rather than invented confirmed provenance", () => {
    const result = projectStudioBusinessContext(input({ publicBrand: brand() }));
    expect(values(result.brandFacts)).toEqual({ productName: "Test Studio", primaryColor: "#123456", accentColor: "#fedcba", font: "Schibsted Grotesk", logoUrl: "https://assets.example.invalid/public/logo.png", logoDarkUrl: "https://assets.example.invalid/public/logo-dark.png", tagline: "A clear next step" });
    expect(result.brandFacts[0].source).toEqual({ kind: "public_brand", field: "product_name", confidence: "observed", observedAt: "2026-11-13T10:00:00Z" });
    const serialized = JSON.stringify(result);
    for (const excluded of ["Private address", "Private phone", "private-brand-key", "private@example.invalid"]) expect(serialized).not.toContain(excluded);
  });

  it.each([
    { tenantId: "test-tenant-studio-b" },
    { target: { kind: "custom", reference: "other-brand" } },
    { readStatus: "unavailable" },
  ])("does not fall back to an unscoped or unavailable public brand", (override) => {
    const result = projectStudioBusinessContext(input({ publicBrand: brand(override) }));
    expect(result.brandFacts).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(values(result.copyFacts).publicName).toBe("Test Studio");
  });

  it("reports an explicit brand source conflict rather than choosing a brand", () => {
    const result = projectStudioBusinessContext(input({ publicBrand: brand({ readStatus: "conflict" }) }));
    expect(result.status).toBe("conflict");
    expect(result.reason).toBe("source_conflict");
    expect(result.copyFacts).toEqual([]);
    expect(result.brandFacts).toEqual([]);
  });

  it("omits blank, oversized, malformed and obvious credential-bearing values without echoing them", () => {
    const secret = "sk-test_abcdefghijklmnopqrstuvwxyz012345";
    const row = context({ publicName: "  ", offers: "x".repeat(4001), idealCustomer: `api_key=${secret}`, customerSegments: "someone@example.invalid", serviceArea: "Online\u0000private", brandVoice: `Bearer ${"a".repeat(32)}` });
    const result = projectStudioBusinessContext(input({ context: row, publicBrand: brand({ values: { primary_color: "red;position:fixed", logo_url: "https://assets.example.invalid/logo.png?token=private", font: "font;display:none" } }), projectValues: { offers: `password=${"a".repeat(20)}` } }));
    expect(result.copyFacts.map((fact) => fact.key)).toEqual(["dbaName"]);
    expect(result.privateGuidance.map((fact) => fact.key)).toEqual(["doNotAssume"]);
    expect(result.brandFacts).toEqual([]);
    expect(result.projectValues).toEqual({});
    expect(result.issues.some((issue) => issue.code === "sensitive_value")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("token=private");
    expect(JSON.stringify(result)).not.toContain("Online\\u0000private");
  });

  it("preserves only valid observed dates and never invents freshness policy or mutates its input", () => {
    const row = context({ provenance: { publicName: { ...confirmed, confirmedAt: "2001-01-01T00:00:00Z", sourceUrl: "https://private.example.invalid/?token=secret" }, offers: { ...confirmed, confirmedAt: "not-a-date" } } });
    const source = input({ context: row, publicBrand: brand({ observedAt: "not-a-date" }), projectValues: { publicName: "  Project choice  " } });
    const before = JSON.stringify(source);
    const result = projectStudioBusinessContext(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(result.copyFacts[0].source.confirmedAt).toBe("2001-01-01T00:00:00Z");
    expect(result.copyFacts.find((fact) => fact.key === "offers")?.source).not.toHaveProperty("confirmedAt");
    expect(result.brandFacts[0].source).not.toHaveProperty("observedAt");
    expect(result.projectValues.publicName).toBe("Project choice");
    expect(result).not.toHaveProperty("freshness");
    expect(JSON.stringify(result)).not.toContain("sourceUrl");
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("does not leak private annotations through parseable provenance timestamps", () => {
    const row = context({ provenance: { publicName: { ...confirmed, confirmedAt: "2026-11-13 (owner@example.invalid)" } } });
    const result = projectStudioBusinessContext(input({ context: row, publicBrand: brand({ observedAt: "2026-11-13 (api_key=private1234)" }) }));
    expect(result.copyFacts[0].source).not.toHaveProperty("confirmedAt");
    expect(result.brandFacts[0].source).not.toHaveProperty("observedAt");
    expect(JSON.stringify(result)).not.toContain("owner@example.invalid");
    expect(JSON.stringify(result)).not.toContain("private1234");
  });
});
