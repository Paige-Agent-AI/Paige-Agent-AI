import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static wiring evidence only. The pure policy suite proves transformation;
// authenticated native-reader/provider execution is separate runtime evidence.
const source = readFileSync("supabase/functions/growth-page-draft/index.ts", "utf8");
describe("original landing generator Studio wiring", () => {
  it("grounds optional Studio context in the caller-native project reader after original caller resolution", () => {
    expect(source.includes("studio_session_id")).toBe(true);
    expect(source.includes('rpc("studio_project_context"')).toBe(true);
    expect(source.indexOf('rpc("studio_project_context"')).toBeGreaterThan(source.indexOf("await resolveStudioCaller("));
    expect(source.includes('rpc("get_solo_business_context"')).toBe(true);
  });
  it("uses the canonical NEXUS context and Studio output policy instead of model-supplied context", () => {
    expect(source.includes("buildStudioNexusPersona")).toBe(true);
    expect(source.includes("normalizeStudioLandingBlocks")).toBe(true);
    expect(source).not.toContain("body.studio_context");
    expect(source).not.toContain("body.project_context");
  });
  it("uses the shared editorial recipe and separate project-first Studio theme", () => {
    expect(source.includes("buildNexusLandingTemplate")).toBe(true);
    expect(source.includes("buildStudioLandingTheme")).toBe(true);
  });
  it("reads a requested current page choice through the protected native reader before generation and after model output", () => {
    expect(source.includes("studio_page_id")).toBe(true);
    expect((source.match(/rpc\("studio_page_conversion"/g) ?? []).length).toBe(2);
    expect(source.includes("parseStudioPageConversionRead")).toBe(true);
    expect(source.includes("sameStudioPageConversionRead")).toBe(true);
  });
});
