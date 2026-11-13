import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static wiring evidence only. The pure policy suite proves transformation;
// authenticated native-reader/provider execution is separate runtime evidence.
const source = readFileSync("supabase/functions/growth-page-draft/index.ts", "utf8");
describe("original landing generator Studio wiring", () => {
  it("grounds optional Studio context in the complete caller-native save source after original caller resolution", () => {
    expect(source.includes("studio_session_id")).toBe(true);
    expect(source.includes('rpc("studio_page_save_source"')).toBe(true);
    expect(source.indexOf('rpc("studio_page_save_source"')).toBeGreaterThan(source.indexOf("await resolveStudioCaller("));
    expect(source).toContain("studioSavedSource.project_context");
    expect(source).not.toContain('rpc("studio_project_context"');
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
  it("reads the complete protected source for new and existing pages before generation and after model output", () => {
    expect(source.includes("studio_page_id")).toBe(true);
    expect((source.match(/rpc\("studio_page_save_source"/g) ?? []).length).toBe(2);
    expect(source.includes("parseStudioPageSaveSource(tenantId, studioSessionId, studioPageId, saved)")).toBe(true);
    expect(source.includes("sameStudioPageSaveSource(studioSavedSource, current)")).toBe(true);
    expect(source).not.toContain('rpc("studio_page_conversion"');
    const finalRead = source.lastIndexOf('rpc("studio_page_save_source"');
    expect(finalRead).toBeGreaterThan(source.indexOf("extractJson(raw)"));
    expect(finalRead).toBeLessThan(source.indexOf("const normalized = normalizeStudioLandingBlocks"));
    expect(source.slice(source.lastIndexOf("// Revalidate"), finalRead)).toContain("if (studioSessionId)");
  });
  it("returns the admitted source separately for Studio and never accepts a model/browser source snapshot", () => {
    expect(source).toContain("...(studioSavedSource ? { studio_source: studioSavedSource } : {})");
    expect(source).toContain("normalizeStudioLandingBlocks(blocks, null, studioSavedSource?.conversion)");
    expect(source).not.toContain("body.studio_source");
    expect(source).not.toContain("parsed.studio_source");
    expect(source).toContain('fail(409, "STUDIO_PAGE_CHANGED"');
  });
});
