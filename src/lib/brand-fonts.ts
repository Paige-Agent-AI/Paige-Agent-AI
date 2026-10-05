// The ONE home for workspace brand fonts (owner ruling 2026-10-04: a curated, self-hosted,
// open-licence WOFF2 library organised by character, with intentional pairings, and NO arbitrary
// remote font URLs).
//
// A tenant's brand font is a free string in `tenants.brand->>'font'` (written by set_tenant_brand,
// read by peek_tenant_portal_brand). This module is the allowlist that turns that string into real,
// loaded faces:
//
//   • lookupBrandFont(name)       — the exact family, case-insensitive, or null. NOTHING else.
//   • resolveBrandFontPair(name)  — { display, body }: the brand face always takes the display role
//                                    and brings its fixed body partner (GRAMMAR §19.6).
//   • brandFontStack(face)        — the CSS font-family stack, namespaced ("brand-<slug>") so loading a
//                                    tenant's "Inter" can never re-skin the app chrome, which also names
//                                    "Inter".
//   • ensureBrandFontFaces(doc,…) — injects @font-face for ONLY the given faces into THAT document's
//                                    <head> (the Studio canvas is an iframe with its own document), once
//                                    per document, and starts the loads.
//
// A string that is not in the map never becomes a URL: every URL below is built from a slug and a
// file name that come from the generated manifest (./brand-fonts.files.ts), never from tenant text.
// An unknown string keeps the renderer's existing behaviour (its sanitised family name, unloaded).
import { BRAND_FONT_FILES, type BrandFontFile } from "./brand-fonts.files";

export type BrandFontCharacter =
  | "editorial serif"
  | "premium serif"
  | "humanist sans"
  | "geometric sans"
  | "product sans"
  | "condensed display"
  | "expressive display"
  | "classic";

/** Picker order and labels. "Classic" holds the faces offered before the library (honoured, not promoted). */
export const BRAND_FONT_CHARACTERS: readonly { key: BrandFontCharacter; label: string }[] = [
  { key: "editorial serif", label: "Editorial serif" },
  { key: "premium serif", label: "Premium serif" },
  { key: "humanist sans", label: "Humanist sans" },
  { key: "geometric sans", label: "Geometric sans" },
  { key: "product sans", label: "Product sans" },
  { key: "condensed display", label: "Condensed display" },
  { key: "expressive display", label: "Expressive display" },
  { key: "classic", label: "Classic" },
];

type Category = "serif" | "sans";

const FALLBACK: Record<Category, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

interface BrandFontPolicy {
  character: BrandFontCharacter;
  category: Category;
  /** The body face this family brings when it is the brand (display) face. */
  partner: string;
}

// Policy, in picker order. The partner table is the approved one (GRAMMAR §19.6 / grammar.ts
// BRAND_PARTNER). Classic picks pair with themselves, so a page that already chose one keeps its whole
// look in that face — now actually loaded, headings included.
const POLICY: Record<string, BrandFontPolicy> = {
  "Source Serif 4": { character: "editorial serif", category: "serif", partner: "Source Sans 3" },
  Literata: { character: "editorial serif", category: "serif", partner: "Public Sans" },
  Spectral: { character: "editorial serif", category: "serif", partner: "Public Sans" },
  "Bodoni Moda": { character: "premium serif", category: "serif", partner: "Source Sans 3" },
  "Libre Caslon Display": { character: "premium serif", category: "serif", partner: "Public Sans" },
  Gloock: { character: "premium serif", category: "serif", partner: "Urbanist" },
  "Source Sans 3": { character: "humanist sans", category: "sans", partner: "Source Sans 3" },
  "Public Sans": { character: "humanist sans", category: "sans", partner: "Public Sans" },
  Urbanist: { character: "geometric sans", category: "sans", partner: "Source Sans 3" },
  Figtree: { character: "geometric sans", category: "sans", partner: "Figtree" },
  Onest: { character: "product sans", category: "sans", partner: "Onest" },
  Manrope: { character: "product sans", category: "sans", partner: "Manrope" },
  "Barlow Semi Condensed": { character: "condensed display", category: "sans", partner: "Public Sans" },
  Oswald: { character: "condensed display", category: "sans", partner: "Source Sans 3" },
  Anton: { character: "condensed display", category: "sans", partner: "Public Sans" },
  Unbounded: { character: "expressive display", category: "sans", partner: "Figtree" },
  Archivo: { character: "expressive display", category: "sans", partner: "Literata" },
  // Classic picks — today's FONT_OPTIONS (BrandControls.tsx), Source Serif 4 aside (it is in the library).
  Inter: { character: "classic", category: "sans", partner: "Inter" },
  "Plus Jakarta Sans": { character: "classic", category: "sans", partner: "Plus Jakarta Sans" },
  Poppins: { character: "classic", category: "sans", partner: "Poppins" },
  Montserrat: { character: "classic", category: "sans", partner: "Montserrat" },
  "Playfair Display": { character: "classic", category: "serif", partner: "Playfair Display" },
  Lora: { character: "classic", category: "serif", partner: "Lora" },
  "DM Sans": { character: "classic", category: "sans", partner: "DM Sans" },
  "Space Grotesk": { character: "classic", category: "sans", partner: "Space Grotesk" },
};

export interface BrandFontFace {
  family: string;
  slug: string;
  character: BrandFontCharacter;
  category: Category;
  /** The family name used in @font-face and stacks: "brand-<slug>". */
  cssFamily: string;
  /** Body partner family name (always another entry in this map). */
  partner: string;
  /** latin + latin-ext files; each carries its own unicode-range, so latin-ext downloads only when used. */
  files: readonly BrandFontFile[];
  license: string;
}

const slugOf = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every offered face, in picker order. A family is listed only when its files were fetched. */
export const BRAND_FONTS: readonly BrandFontFace[] = Object.entries(POLICY).flatMap(([family, p]) => {
  const slug = slugOf(family);
  const set = BRAND_FONT_FILES[slug];
  if (!set || set.files.length === 0) return [];
  return [{
    family,
    slug,
    character: p.character,
    category: p.category,
    cssFamily: `brand-${slug}`,
    partner: p.partner,
    files: set.files,
    license: set.license,
  }];
});

const BY_KEY = new Map(BRAND_FONTS.map((f) => [f.family.toLowerCase(), f] as const));

/**
 * Intentional display → body pairings (GRAMMAR §19.6), for the page direction that picks a pairing when
 * a business has NO brand font (a later slice). Every face named here is in the library.
 */
export const BRAND_FONT_PAIRINGS = {
  broadsheet: { display: "Archivo", body: "Literata" },
  quiet_authority: { display: "Source Serif 4", body: "Source Sans 3" },
  couture: { display: "Bodoni Moda", body: "Source Sans 3" },
  gallery: { display: "Libre Caslon Display", body: "Public Sans" },
  literary: { display: "Spectral", body: "Public Sans" },
  statement_serif: { display: "Gloock", body: "Urbanist" },
  product: { display: "Onest", body: "Onest" },
  product_round: { display: "Manrope", body: "Manrope" },
  club: { display: "Unbounded", body: "Figtree" },
  modern: { display: "Urbanist", body: "Source Sans 3" },
  trade: { display: "Barlow Semi Condensed", body: "Public Sans" },
  signage: { display: "Oswald", body: "Source Sans 3" },
  poster: { display: "Anton", body: "Public Sans" },
  neutral: { display: "Public Sans", body: "Public Sans" },
} as const satisfies Record<string, { display: string; body: string }>;

export type BrandFontPairingName = keyof typeof BRAND_FONT_PAIRINGS;

/** The library face for a stored brand-font string — exact family match, case-insensitive — or null. */
export function lookupBrandFont(name: unknown): BrandFontFace | null {
  if (typeof name !== "string") return null;
  const key = name.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

export interface BrandFontPair {
  display: BrandFontFace;
  body: BrandFontFace;
}

/** Brand face → { display: the brand face, body: its partner }. Null for an unknown or empty string. */
export function resolveBrandFontPair(name: unknown): BrandFontPair | null {
  const display = lookupBrandFont(name);
  if (!display) return null;
  return { display, body: lookupBrandFont(display.partner) ?? display };
}

/** A named pairing → its faces. */
export function brandFontPairing(name: BrandFontPairingName): BrandFontPair {
  const p = BRAND_FONT_PAIRINGS[name];
  return { display: lookupBrandFont(p.display)!, body: lookupBrandFont(p.body)! };
}

/** The CSS font-family stack for a face: the self-hosted namespaced face, the real name, then a fallback. */
export function brandFontStack(face: BrandFontFace): string {
  return `"${face.cssFamily}", "${face.family}", ${FALLBACK[face.category]}`;
}

/** @font-face rules for one face (one per file: each subset × cut). A static face with a single cut
 *  declares the whole weight range so a semibold heading uses the real (only) cut instead of a
 *  synthesised faux bold. */
export function brandFontFaceCss(face: BrandFontFace, base = "/fonts/brand"): string {
  const single = face.files.every((f) => f.axes.length === 0) && new Set(face.files.map((f) => f.weight)).size === 1;
  return face.files.map((f) => [
    "@font-face{",
    `font-family:"${face.cssFamily}";`,
    `font-style:${f.style};`,
    `font-weight:${single ? "1 1000" : f.weight};`,
    f.stretch ? `font-stretch:${f.stretch};` : "",
    "font-display:swap;",
    `src:url("${base}/${face.slug}/${f.file}") format("woff2");`,
    `unicode-range:${f.unicodeRange};`,
    "}",
  ].join("")).join("\n");
}

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
