// @vitest-environment node
import { describe, expect, it } from "vitest";
import { presentCatalogueCoverage } from "./catalogue-coverage";

describe("public catalogue coverage presentation", () => {
  it.each([
    ["limited", "Limited", "partial"],
    ["coming_soon", "Coming Soon", "proposed"],
    ["unverified", "Unverified", "neutral"],
  ])("presents the declared %s coverage without granting runtime access", (state, label, tone) => {
    const result = presentCatalogueCoverage({ on: true, catalogueCoverage: { version: 1, state } });
    expect(result).toEqual({ label, tone });
    expect(result).not.toHaveProperty("available");
    expect(result).not.toHaveProperty("permission");
  });

  it.each(["live", "available", "approved", "connected", "LIMITED", "", true, 1])(
    "does not promote an unsupported metadata state %s", state => {
      expect(presentCatalogueCoverage({ on: true, catalogueCoverage: { version: 1, state } })).toBeNull();
    },
  );

  it("cannot reactivate an inactive row or infer a provider connection", () => {
    expect(presentCatalogueCoverage({ on: false, catalogueCoverage: { version: 1, state: "limited" } })).toBeNull();
    expect(presentCatalogueCoverage({ on: true, catalogueCoverage: { version: 1, providerReady: true } })).toBeNull();
  });

  it.each([undefined, null, [], "limited", { state: "limited" }, { version: 2, state: "limited" }])(
    "leaves missing, malformed or unsupported-version coverage unverified", catalogueCoverage => {
      expect(presentCatalogueCoverage({ on: true, catalogueCoverage })).toBeNull();
    },
  );

  it("does not turn inherited flags into published coverage", () => {
    expect(presentCatalogueCoverage({ on: true, catalogueCoverage: Object.create({ version: 1, state: "limited" }) })).toBeNull();
  });

  it("does not expose arbitrary metadata or mutate the declaration", () => {
    const declaration = Object.freeze({ version: 1, state: "limited", privateNote: "test-private-detail", actor: "test-actor" });
    const result = presentCatalogueCoverage({ on: true, catalogueCoverage: declaration });
    expect(result).toEqual({ label: "Limited", tone: "partial" });
    expect(JSON.stringify(result)).not.toMatch(/test-private-detail|test-actor/);
    expect(declaration).toEqual({ version: 1, state: "limited", privateNote: "test-private-detail", actor: "test-actor" });
  });
});
