import { describe, expect, it } from "vitest";
import { projectStudioRequestIntent } from "./studio-request-intent";

describe("bounded original human request target proposal", () => {
  it.each([
    ["Create a landing page for my business.", "workspace"],
    ["Build this for our own company.", "workspace"],
    ["Create a page for this workspace.", "workspace"],
    ["Create a landing page for my client.", "client"],
    ["Build a form for an existing client.", "client"],
    ["Prepare a page for a prospect.", "prospect"],
    ["Create this for a different brand.", "custom"],
    ["Build a page for my custom brand.", "custom"],
  ])("projects only the explicit target in %s", (text, kind) => {
    expect(projectStudioRequestIntent(text)).toEqual({ kind, values: {} });
  });
  it.each([
    undefined, null, {}, "", "Build a great page.", "Northwind needs a page.",
    "Do not build this for my business.", "Don't create this for my client.",
    "Build for my business or for my client.", "Build for my client and for my prospect.",
    "Maybe make this for my business.", "If I asked for my client, what would it look like?",
    'They said "Build a page for my business".', "'Build a page for my client.'",
    'Example request: "Build a page for my business', "'Build a page for my client", 'Explain "Build for my client',
    "Example: build for my business.", "```text\nBuild for my business.\n```",
    "<div>Create a page for my business</div>", "x".repeat(10001),
  ])("leaves unclear, quoted, conditional or conflicting input unknown %#", text => {
    expect(projectStudioRequestIntent(text)).toBeNull();
  });
  it("keeps only clearly labelled safe project values, with no IDs, authority or inferred commercial claims", () => {
    const proposal = projectStudioRequestIntent("Build a page for my client.\nBusiness name: Northwind\nOffer: Editorial services\nAudience: Independent publishers\nPrimary color: #123456\nClient ID: supplied-id\nVerified: true\nEmail: private@example.invalid\nVault: private material");
    expect(proposal).toEqual({ kind: "client", values: { publicName: "Northwind", offers: "Editorial services", idealCustomer: "Independent publishers", primaryColor: "#123456" } });
    expect(JSON.stringify(proposal)).not.toMatch(/supplied-id|Verified|Email|Vault|private/);
  });
  it("excludes sensitive/invalid values through the canonical project sanitizer", () => {
    expect(projectStudioRequestIntent("Build a page for my prospect.\nBusiness name: api_key=synthetic-secret-value\nOffer: private@example.invalid\nPrimary color: blue\nAudience: Local shops")).toEqual({ kind: "prospect", values: { idealCustomer: "Local shops" } });
  });
  it("does not infer a business name or offer from surrounding prose", () => {
    expect(projectStudioRequestIntent("Build for my client Northwind and promise guaranteed growth.")).toEqual({ kind: "client", values: {} });
  });
  it("refuses conflicting labelled values instead of silently choosing one", () => {
    expect(projectStudioRequestIntent("Build for my client.\nBusiness name: Northwind\nBusiness name: Another brand")).toBeNull();
  });
});
