import { describe, expect, it } from "vitest";
import { GROWTH_BLOCK_TYPES, validateBlock } from "../../../supabase/functions/_shared/growth-blocks";
import type { ConversionDestination } from "../../../supabase/functions/_shared/growth/conversion-destination";
import { buildPortableExport, type PortablePageSource } from "./exportPortable";
import type { GrowthBlock } from "../growth";
import { strictRichText } from "../../../supabase/functions/_shared/growth/export-portable";

const FORM_ID = "df2fd426-a23b-4b91-9dc8-123456789abc";
const JOTFORM = "https://form.jotform.com/123456789012345";
const block = (destination: ConversionDestination, copy = {}) => ({ type: "conversion", destination, ...copy }) as GrowthBlock;
function exported(destination: ConversionDestination, copy = {}) {
  const page: PortablePageSource = {
    status: "published", tenantSlug: "test-tenant-studio", tenantName: null,
    pageId: "test-page", pageSlug: "intake", pageTitle: "Intake", publishedAt: "2026-11-13T00:00:00Z",
    blocks: [block(destination, copy)], theme: null, brandFloor: {}, seo: null,
  };
  return buildPortableExport(page, { origin: "https://paigeagent.ai", exportedAt: "2026-11-13T01:00:00Z" });
}

describe("canonical conversion block validation", () => {
  it("adds exactly one block type and preserves the original nineteen", () => {
    expect(GROWTH_BLOCK_TYPES).toContain("conversion");
    expect(GROWTH_BLOCK_TYPES).toHaveLength(20);
    expect(new Set(GROWTH_BLOCK_TYPES).size).toBe(20);
  });
  it("normalizes destinations and retains bounded copy only", () => {
    expect(validateBlock({ type: "conversion", destination: { kind: "native_form", formId: FORM_ID.toUpperCase(), html: "<script>bad()</script>" }, title: "  Intake  ", description: "Your details", label: "Start", html: "<iframe>" }))
      .toEqual({ type: "conversion", destination: { kind: "native_form", formId: FORM_ID }, title: "Intake", description: "Your details", label: "Start" });
    const cleaned = validateBlock({ type: "conversion", destination: { kind: "native_booking", slug: "discovery" }, title: "a".repeat(200), description: "b".repeat(500), label: "c".repeat(100) });
    expect(cleaned.title).toHaveLength(160);
    expect(cleaned.description).toHaveLength(400);
    expect(cleaned.label).toHaveLength(60);
  });
  it.each([
    {}, { kind: "native_form", formId: "not-a-uuid" }, { kind: "native_booking", slug: "../private" },
    { kind: "external_form", mode: "embed", url: "https://example.com/form" },
    { kind: "external_form", mode: "link", url: "https://user:secret@example.com/form" },
    { kind: "external_form", mode: "link", url: JOTFORM + "?token=secret" },
  ])("rejects invalid destinations instead of persisting them: %j", (destination) => {
    expect(validateBlock({ type: "conversion", destination })).toBeNull();
  });
});

describe("portable conversion export", () => {
  it.each(["link", "embed"] as const)("exports external %s as an explicit safe link without running a widget", (mode) => {
    const result = exported({ kind: "external_form", mode, url: JOTFORM, provider: "jotform" }, { title: "Tell us more", label: "Open intake" });
    expect(result.html).toContain(`href="${JOTFORM}"`);
    expect(result.html).toContain("Open intake");
    expect(result.html).not.toMatch(/<(?:iframe|script|form)\b/i);
    expect(result.manifest.notes.some((note) => note.includes("conversion"))).toBe(true);
  });
  it("uses the original native public routes", () => {
    expect(exported({ kind: "native_form", formId: FORM_ID }).html).toContain(`href="https://paigeagent.ai/form/${FORM_ID}"`);
    expect(exported({ kind: "native_booking", slug: "discovery" }).html).toContain('href="https://paigeagent.ai/book/discovery"');
  });
  it("escapes all tenant-authored conversion copy", () => {
    const result = exported({ kind: "external_form", mode: "link", url: JOTFORM, provider: "jotform" }, { title: '<img src=x onerror="bad()">', description: "You & us", label: '<script>bad()</script>' });
    expect(result.html).toContain("&lt;img");
    expect(result.html).toContain("You &amp; us");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toMatch(/<script\b/i);
  });
  it.each([
    { kind: "external_form", mode: "embed", url: "https://example.com/form", provider: "jotform" },
    { kind: "external_form", mode: "link", url: JOTFORM + "?token=private-value", provider: "jotform" },
  ])("fails closed even if a caller bypassed block validation", (destination) => {
    const result = exported(destination as ConversionDestination);
    expect(result.html).toContain("This destination is unavailable.");
    expect(result.html).not.toContain('href="https://example.com/form"');
    expect(result.html).not.toContain("private-value");
    expect(result.manifest.notes.join(" ")).not.toContain("private-value");
  });
  it("keeps scripts, forms and arbitrary iframes stripped from rich text", () => {
    const result = buildPortableExport({ status: "published", tenantSlug: "test-tenant-studio", tenantName: null, pageId: "test-page", pageSlug: "intake", pageTitle: "Intake", publishedAt: null, blocks: [{ type: "rich_text", html: '<p>Copy</p><form><input></form><script>bad()</script><iframe src="https://example.com"></iframe>' }], theme: null, seo: null, brandFloor: {} }, { origin: "https://paigeagent.ai", exportedAt: "2026-11-13T00:00:00Z" });
    expect(result.html).toContain("Copy");
    expect(result.html).not.toMatch(/<(?:script|iframe|form)\b/i);
  });
  it("preserves the same forbidden-tag boundary in the pure server export sanitizer", () => {
    expect(strictRichText('<p>Copy</p><script>bad()</script><form><input></form><iframe src="https://example.com"></iframe>'))
      .not.toMatch(/<(?:script|form|iframe)\b/i);
  });
});
