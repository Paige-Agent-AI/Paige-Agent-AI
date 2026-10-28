// The ONE home for workspace brand fonts — app half. Everything pure (allowlist, pairing policy,
// stacks, @font-face CSS) lives in supabase/functions/_shared/growth/brand-fonts.core.ts so the
// Deno edge can use it too; this file re-exports it and keeps the browser-only loading half.
// Public API unchanged for every existing import.
export {
  BRAND_FONTS,
  BRAND_FONT_PAIRINGS,
  BRAND_FONT_CHARACTERS,
  lookupBrandFont,
  resolveBrandFontPair,
  brandFontPairing,
  brandFontStack,
  brandFontFaceCss,
} from "../../supabase/functions/_shared/growth/brand-fonts.core.ts";
export type {
  BrandFontCharacter,
  BrandFontFace,
  BrandFontPair,
  BrandFontPairingName,
} from "../../supabase/functions/_shared/growth/brand-fonts.core.ts";

import type { BrandFontFace } from "../../supabase/functions/_shared/growth/brand-fonts.core.ts";
import { brandFontFaceCss } from "../../supabase/functions/_shared/growth/brand-fonts.core.ts";

// ── loading into a document ─────────────────────────────────────────────────────────────────────
export const BRAND_FONT_STYLE_ATTR = "data-brand-font";
const pendingLoads = new WeakMap<Document, Promise<unknown>[]>();

function fontBase(): string {
  // Absolute, from the APP origin: the Studio canvas is an about:blank iframe written by script, and an
  // origin-relative URL in its stylesheet should not depend on how that document's base resolves.
  const origin = typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null" ? window.location.origin : "";
  return `${origin}/fonts/brand`;
}

/** Weights a page needs up front: body (400) and headings (600). A picker preview needs only 400. */
export const PAGE_FONT_WEIGHTS = ["400", "600"] as const;
export const PREVIEW_FONT_WEIGHTS = ["400"] as const;

/**
 * Inject @font-face for ONLY these faces into `doc`'s <head> (once per face per document) and start
 * loading the given cuts (latin; latin-ext loads only when a page uses those letters). Resolves when
 * those loads settle; a failed load is logged loudly and the text stays visible in the stack's
 * fallback (font-display: swap).
 */
export function ensureBrandFontFaces(
  doc: Document | null | undefined,
  faces: readonly (BrandFontFace | null | undefined)[],
  weights: readonly string[] = PAGE_FONT_WEIGHTS,
): Promise<void> {
  if (!doc?.head) return Promise.resolve();
  const unique = [...new Map(faces.filter((f): f is BrandFontFace => !!f).map((f) => [f.slug, f])).values()];
  const loads: Promise<unknown>[] = [];
  const base = fontBase();
  for (const face of unique) {
    if (!doc.head.querySelector(`style[${BRAND_FONT_STYLE_ATTR}="${face.slug}"]`)) {
      const style = doc.createElement("style");
      style.setAttribute(BRAND_FONT_STYLE_ATTR, face.slug);
      style.textContent = brandFontFaceCss(face, base);
      doc.head.appendChild(style);
    }
    const fontSet = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fontSet && typeof fontSet.load === "function") {
      const load = Promise.all(weights.map((w) => fontSet.load(`${w} 16px "${face.cssFamily}"`, "Aa"))).catch((err) => {
        console.error(`[brand-fonts] ${face.family} did not load; the page shows its fallback face.`, err);
      });
      loads.push(load);
    }
  }
  if (loads.length) pendingLoads.set(doc, [...(pendingLoads.get(doc) ?? []), ...loads]);
  return Promise.all(loads).then(() => undefined);
}

/** Resolves once every brand-font load started in `doc` has settled (used by /render-frame before ready). */
export function brandFontsSettled(doc: Document | null | undefined): Promise<void> {
  if (!doc) return Promise.resolve();
  return Promise.all(pendingLoads.get(doc) ?? []).then(() => undefined);
}
