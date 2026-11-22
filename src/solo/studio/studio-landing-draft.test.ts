import { describe, expect, it } from "vitest";
import { admitStudioDraftPage, admitStudioDraftSession, buildStudioLandingTheme, normalizeStudioLandingBlocks, parseStudioPageConversionRead, safeStudioKnowledgeChunks, sameStudioPageConversionRead, studioPublicBrand } from "../../../supabase/functions/_shared/growth/studio-landing-draft";
import { projectStudioBusinessContext } from "./business-context";
import { validateBlock } from "../../../supabase/functions/_shared/growth-blocks";

const tenant = "test-tenant-landing";
const confirmed = { source: "owner_confirmed", confidence: "confirmed" };
function context(target: unknown = { kind: "workspace" }, values: Record<string, unknown> = {}) {
  return projectStudioBusinessContext({ expectedTenantId: tenant, target, readStatus: "available", context: { tenantId: tenant, contextRevision: 1, brief: { publicName: "Test Brand", provenance: { publicName: confirmed } } }, publicBrand: studioPublicBrand(tenant, { primary_color: "#123456", accent_color: "#abcdef", font: "Test Sans", logo_url: "https://assets.example.invalid/logo.png", address: "PRIVATE_ADDRESS", support_email: "private@example.invalid" }), projectValues: values });
}
describe("Studio landing draft policy", () => {
  it("requires a valid original session ID and refuses service-role session impersonation", () => {
    expect(admitStudioDraftSession(undefined, true)).toEqual({ ok: true, sessionId: null });
    expect(admitStudioDraftSession("00000000-0000-4000-8000-000000000001", false)).toEqual({ ok: true, sessionId: "00000000-0000-4000-8000-000000000001" });
    expect(admitStudioDraftSession("client-label", false).ok).toBe(false);
    expect(admitStudioDraftSession(null, false).ok).toBe(false);
    expect(admitStudioDraftSession("00000000-0000-4000-8000-000000000001", true)).toMatchObject({ ok: false, status: 403 });
  });
  it("projects only observed public brand keys and prefers admitted project choices", () => {
    const brand = studioPublicBrand(tenant, { primary_color: "#123456", phone: "PRIVATE_PHONE", support_email: "private@example.invalid", api_key: "PRIVATE_KEY" });
    expect(JSON.stringify(brand)).not.toContain("PRIVATE");
    expect(JSON.stringify(brand)).not.toContain("private@example.invalid");
    const result = buildStudioLandingTheme(context({ kind: "workspace" }, { primaryColor: "#fedcba", font: "Project Sans" }), { primaryColor: "#fedcba", font: "Project Sans" });
    expect(result).toMatchObject({ primary: "#fedcba", accent: "#abcdef", font: "Project Sans", logo_url: "https://assets.example.invalid/logo.png" });
  });
  it.each(["client", "prospect", "custom"])("does not inherit a workspace theme for %s", (kind) => {
    const result = buildStudioLandingTheme(context({ kind, reference: "selected-brand" }));
    expect(result).toMatchObject({ primary: "#202024", accent: "#202024", font: null, logo_url: null });
    expect(JSON.stringify(result)).not.toContain("#123456");
    expect(JSON.stringify(result)).not.toContain("Test Sans");
    expect(buildStudioLandingTheme(context({ kind, reference: "selected-brand" }, { primaryColor: "#998877" })).primary).toBe("#998877");
  });
  it("does not reinstate observed colors after an invalid or cleared explicit edit", () => {
    expect(buildStudioLandingTheme(context(), { primaryColor: "", logoUrl: "invalid" })).toMatchObject({ primary: "#202024", logo_url: null });
  });
  it("returns a genuine draft without manufacturing form, CTA or destination", () => {
    const result = normalizeStudioLandingBlocks([
      { type: "two_column", heading: "The offer", body: "A planning workshop" },
      { type: "hero", title: "Test workshop", cta_label: "Save your spot", cta_href: "#apply" },
      { type: "embedded_form", form_slug: "invented-form" },
      { type: "conversion", destination: { kind: "native_booking", slug: "invented-booking" }, label: "Book now" },
      { type: "cta", title: "Act now", cta_label: "Go", cta_href: "https://unrequested.example.com" },
      { type: "pricing", tiers: [{ name: "Supplied offer", price: "Supplied price", features: [], cta_label: "Buy", cta_href: "https://unrequested.example.com" }] },
      { type: "rich_text", html: '<p>Read this</p><a href="https://unrequested.example.com">Book now</a>' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks[0]).toEqual({ type: "hero", title: "Test workshop" });
    expect(JSON.stringify(result.blocks)).not.toMatch(/invented-form|invented-booking|unrequested|cta_href|cta_label/);
    expect(result.blocks.every((block) => validateBlock(block))).toBe(true);
  });
  it("never invents an opening to disguise empty or incomplete model output", () => {
    expect(normalizeStudioLandingBlocks([]).ok).toBe(false);
    expect(normalizeStudioLandingBlocks([{ type: "unknown" }]).ok).toBe(false);
    expect(normalizeStudioLandingBlocks([{ type: "two_column", heading: "Only supporting copy" }])).toMatchObject({ ok: false, code: "MISSING_STUDIO_OPENING" });
  });
  it("accepts an explicitly original conversion through the canonical validator, including native forms", () => {
    const conversion = { ctaLabel: "Open application", destination: { kind: "native_form", formId: "00000000-0000-4000-8000-000000000002" } } as const;
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Test workshop" }, { type: "conversion", label: "Untrusted", destination: { kind: "native_booking", slug: "wrong" } }], conversion);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks[result.blocks.length - 1]).toEqual({ type: "conversion", label: "Open application", destination: conversion.destination });
    expect(JSON.stringify(result.blocks)).not.toContain("wrong");
  });
  it("keeps scoped Knowledge only for workspace authoring and drops obvious secrets and unknown metadata", () => {
    const chunks = [{ content: "A public workshop outline", similarity: .8, title: "Workshop", privateRaw: "PRIVATE_RAW" }, { content: "api_key=private1234", similarity: .9 }, { content: "owner@example.invalid", similarity: .9 }];
    expect(safeStudioKnowledgeChunks(false, chunks)).toEqual([]);
    expect(safeStudioKnowledgeChunks(true, chunks)).toEqual([{ content: "A public workshop outline", similarity: .8, title: "Workshop" }]);
  });
  it("does not allow a generated rich-text input to bypass missing conversion selection", () => {
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Test workshop" }, { type: "rich_text", html: '<p>Apply</p><input type="email" name="email">' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.blocks)).not.toContain("input");
  });
  it("drops a recognizable bearer credential from otherwise unlabelled Knowledge prose", () => {
    const credential = "eyJabcdefghijk.abcdefghijk.abcdefghijk";
    expect(safeStudioKnowledgeChunks(true, [{ content: credential, similarity: .9 }])).toEqual([]);
  });
  it("preserves the actual saved conversion when NEXUS refines the rest of the page", () => {
    const source = { type: "conversion", label: "Book a conversation", destination: { kind: "native_booking", slug: "selected-booking" } } as const;
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Refined workshop" }, { type: "conversion", label: "Wrong", destination: { kind: "native_booking", slug: "model-invention" } }], null, source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks[result.blocks.length - 1]).toEqual(source);
  });
  it("preserves the original saved embedded form instead of generating a replacement slug", () => {
    const source = { type: "embedded_form", form_slug: "original-application" } as const;
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Refined workshop" }, { type: "embedded_form", form_slug: "model-invention" }], null, source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks[result.blocks.length - 1]).toEqual(source);
  });
  it("does not resurrect a conversion when the actual saved draft cleared it", () => {
    const oldRecipeChoice = { ctaLabel: "Old choice", destination: { kind: "native_booking", slug: "old-booking" } } as const;
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Refined workshop" }], oldRecipeChoice, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blocks).toEqual([{ type: "hero", title: "Refined workshop" }]);
  });
  it("admits an optional page pointer only with an original admitted session", () => {
    const page = "00000000-0000-4000-8000-000000000010";
    expect(admitStudioDraftPage(undefined, null)).toEqual({ ok: true, pageId: null });
    expect(admitStudioDraftPage(page, null).ok).toBe(false);
    expect(admitStudioDraftPage(page, "not-a-session").ok).toBe(false);
    expect(admitStudioDraftPage(null, "00000000-0000-4000-8000-000000000001").ok).toBe(false);
    expect(admitStudioDraftPage("page-label", "00000000-0000-4000-8000-000000000001").ok).toBe(false);
    expect(admitStudioDraftPage(page, "00000000-0000-4000-8000-000000000001")).toEqual({ ok: true, pageId: page });
  });
  it("parses only the matching successful native saved choice and its observed source timestamp", () => {
    const page = "00000000-0000-4000-8000-000000000010";
    const source = { type: "conversion", label: "Open application", destination: { kind: "native_form", formId: "00000000-0000-4000-8000-000000000002" } };
    const raw = { ok: true, conversion: source, page_id: page, updated_at: "2026-11-13T17:00:00+00:00" };
    const before = JSON.stringify(raw);
    expect(parseStudioPageConversionRead(page, raw)).toEqual({ ok: true, conversion: source, pageId: page, updatedAt: raw.updated_at });
    expect(parseStudioPageConversionRead(page, { ...raw, conversion: null })).toMatchObject({ ok: true, conversion: null });
    expect(JSON.stringify(raw)).toBe(before);
  });
  it.each([
    null,
    { ok: false, code: "scope_changed" },
    { ok: true, conversion: null, page_id: "00000000-0000-4000-8000-000000000011", updated_at: "2026-11-13T17:00:00Z" },
    { ok: true, conversion: null, page_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-11-13 (private@example.invalid)" },
    { ok: true, page_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-11-13T17:00:00Z" },
    { ok: true, conversion: { type: "hero", title: "Not a conversion" }, page_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-11-13T17:00:00Z" },
    { ok: true, conversion: { type: "embedded_form", form_slug: "wrong form slug" }, page_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-11-13T17:00:00Z" },
    { ok: true, conversion: { type: "conversion", destination: { kind: "native_booking", slug: "chosen", token: "PRIVATE_SOURCE_VALUE" } }, page_id: "00000000-0000-4000-8000-000000000010", updated_at: "2026-11-13T17:00:00Z" },
  ])("refuses missing, foreign, failed or malformed native readback without a fallback source", (response) => {
    const result = parseStudioPageConversionRead("00000000-0000-4000-8000-000000000010", response);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("conversion");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SOURCE_VALUE");
    expect(JSON.stringify(result)).not.toContain("private@example.invalid");
  });
  it("refuses a malformed supplied source rather than falling back to an old recipe destination", () => {
    const oldRecipeChoice = { ctaLabel: "Old choice", destination: { kind: "native_booking", slug: "old-booking" } } as const;
    const result = normalizeStudioLandingBlocks([{ type: "hero", title: "Refined workshop" }], oldRecipeChoice, { type: "embedded_form", form_slug: "not canonical" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STUDIO_CONVERSION" });
  });
  it("detects changed source versions or choices after generation", () => {
    const source = { ok: true, pageId: "00000000-0000-4000-8000-000000000010", updatedAt: "2026-11-13T17:00:00Z", conversion: { type: "embedded_form", form_slug: "original-form" } } as const;
    expect(sameStudioPageConversionRead(source, { ...source })).toBe(true);
    expect(sameStudioPageConversionRead(source, { ...source, updatedAt: "2026-11-13T17:00:01Z" })).toBe(false);
    expect(sameStudioPageConversionRead(source, { ...source, conversion: null })).toBe(false);
    expect(sameStudioPageConversionRead(source, { ...source, pageId: "00000000-0000-4000-8000-000000000011" })).toBe(false);
  });
});
