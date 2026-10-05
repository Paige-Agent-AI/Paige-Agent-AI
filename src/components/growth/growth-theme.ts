// The ONE theme resolver for every Growth surface — the public landing page AND the
// Studio live preview both call this, so a page themes identically in preview and after
// publish (preview == published, the keystone promise). It turns a tenant's
// GrowthPageTheme (hex brand colors, over a brand floor) into a flat map of `--gp-*`
// CSS custom properties. Components read ONLY these vars — zero hardcoded hex lives in a
// component. The only hex in the system is the on-brand fallback floor here.
//
// It also computes the two contrast-critical tokens by hand so text-on-brand always
// passes WCAG AA:
//   --gp-accent-foreground : ink to place ON an accent fill (accent button label)
//   --gp-accent-ink        : an AA-clamped accent, safe to use AS text on the background
import type { GrowthPageTheme } from "@/lib/growth";
import { brandFontStack, resolveBrandFontPair, type BrandFontPair } from "@/lib/brand-fonts";

// On-brand fallback floor (§6/§11) — Paige indigo ink + Paige gold. Never the old
// #0b1220/#cfae70. Any token the tenant theme + brand peek both leave blank lands here.
export const GROWTH_BRAND_FLOOR: Required<Pick<GrowthPageTheme, "primary" | "accent" | "background" | "text">> & { font: string } = {
  primary: "#150C31",
  accent: "#EBB94C",
  background: "#150C31",
  text: "#F8F5EE",
  font: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

/**
 * The tenant's brand floor, built from the anon-safe `peek_tenant_portal_brand` row.
 *
 * THIS MUST EXIST IN EXACTLY ONE PLACE. The published page (GrowthPageRenderer), the funnel
 * step (GrowthFunnelRenderer), and the Studio canvas (studio.ts → LivePreview) all render the
 * same page and must all resolve the same floor — if any one of them re-derives it by hand, the
 * Studio's preview silently stops matching what publishes, and no test catches it because both
 * halves still "work".
 *
 * The non-obvious part, and the reason a hand-copy goes wrong: `background` DERIVES FROM
 * `primary_color`. There is no background column on the brand row. And `text` is ALWAYS the
 * floor's — a tenant never overrides it, because the floor's ink is what guarantees AA contrast
 * against the brand background.
 */
export interface GrowthBrandRow {
  primary_color?: string | null;
  accent_color?: string | null;
  font?: string | null;
  logo_url?: string | null;
}

export function buildGrowthBrandFloor(brand: GrowthBrandRow | null | undefined): GrowthPageTheme {
  return {
    primary: brand?.primary_color || GROWTH_BRAND_FLOOR.primary,
    accent: brand?.accent_color || GROWTH_BRAND_FLOOR.accent,
    background: brand?.primary_color || GROWTH_BRAND_FLOOR.background,
    text: GROWTH_BRAND_FLOOR.text,
    ...(brand?.font ? { font: brand.font } : {}),
    ...(brand?.logo_url ? { logo_url: brand.logo_url } : {}),
  };
}

// ── color math (all self-contained, no deps) ────────────────────────────────
interface RGB { r: number; g: number; b: number }

function parseHex(hex?: string | null): RGB | null {
  if (!hex || typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(c: RGB): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}

function channelLum(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(c: RGB): number {
  return 0.2126 * channelLum(c.r) + 0.7152 * channelLum(c.g) + 0.0722 * channelLum(c.b);
}
function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const BLACK: RGB = { r: 12, g: 10, b: 20 };   // near-black brand ink (not pure #000)
const WHITE: RGB = { r: 255, g: 255, b: 255 };

/** Pick the ink (dark or light) with the best contrast to sit ON a filled swatch. */
function inkOn(fill: RGB): RGB {
  return contrast(fill, BLACK) >= contrast(fill, WHITE) ? BLACK : WHITE;
}

/** Nudge `color` toward black (on light bg) or white (on dark bg) until it clears the
 *  target ratio against `bg` — the minimal shift that reaches AA, so brand hue survives. */
function clampToContrast(color: RGB, bg: RGB, target = 4.5): RGB {
  if (contrast(color, bg) >= target) return color;
  const towards = luminance(bg) > 0.5 ? BLACK : WHITE;
  let lo = 0;
  let hi = 1;
  let best = mix(color, towards, 1);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const c = mix(color, towards, mid);
    if (contrast(c, bg) >= target) { best = c; hi = mid; } else { lo = mid; }
  }
  return best;
}

// Only allow characters that can legally appear in a CSS font-family value, so a tenant
// font string can never break out of the inline style into arbitrary declarations.
function safeFont(font?: string): string | null {
  if (!font || typeof font !== "string") return null;
  const cleaned = font.replace(/[^a-zA-Z0-9 ,"'-]/g, "").trim();
  if (!cleaned) return null;
  // If the tenant gave a bare family, quote it and append a resilient fallback stack.
  const stack = /,/.test(cleaned) ? cleaned : `"${cleaned.replace(/["']/g, "")}"`;
  return `${stack}, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`;
}

export type GrowthThemeVars = Record<string, string>;

/**
 * Layer theme objects floor → most-specific WITHOUT letting a null/undefined/"" in a higher
 * layer clobber a real value below it.
 *
 * A plain `{ ...floor, ...theme }` spread does NOT skip nulls — so an explicit `font: null` in a
 * page's theme_json overwrites the tenant's brand font with nothing. The generator emits
 * `font: null` / `logo_url: null` for every tenant that hasn't set them (most of them), and the
 * public renderer feeds its raw theme_json straight in. The Studio normalizes at its seam, but
 * this merge is the ONE point both surfaces pass through, so guarding it here is what makes the
 * canvas and the published page provably resolve the same tokens (§1/§6/§13) — no caller can
 * reintroduce the clobber.
 */
function layerThemes(...layers: (GrowthPageTheme | null | undefined)[]): GrowthPageTheme {
  const out: GrowthPageTheme = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/**
 * Resolve a page theme (over an optional brand floor) into the `--gp-*` variable map.
 * Layering: hard floor → tenant brand floor → the page's own theme_json (most specific).
 * Returns a plain object spreadable into a React `style` prop.
 */
/**
 * The brand font pair a page resolves to, with the same floor → brand → page layering as the colours:
 * the page's own theme_json.font wins, then the tenant brand font. Null when that string is not in the
 * self-hosted library (src/lib/brand-fonts.ts) — the page then keeps today's behaviour exactly: its
 * sanitised family name in --gp-font, and no --gp-font-display.
 */
export function resolveGrowthFontPair(theme?: GrowthPageTheme | null, brandFloor?: GrowthPageTheme | null): BrandFontPair | null {
  return resolveBrandFontPair(layerThemes(brandFloor, theme).font);
}

export function resolveGrowthTheme(theme?: GrowthPageTheme | null, brandFloor?: GrowthPageTheme | null): GrowthThemeVars {
  const t: GrowthPageTheme = layerThemes(GROWTH_BRAND_FLOOR, brandFloor, theme);
  // A library brand font → the real self-hosted faces: the brand face for display, its partner for body.
  const fontPair = resolveBrandFontPair(t.font);

  const primary = parseHex(t.primary) || parseHex(GROWTH_BRAND_FLOOR.primary)!;
  const accent = parseHex(t.accent) || parseHex(GROWTH_BRAND_FLOOR.accent)!;
  const bg = parseHex(t.background) || primary;
  // Body text: honor the tenant's choice but never ship it below AA on the background.
  const textRaw = parseHex(t.text) || (luminance(bg) > 0.5 ? BLACK : WHITE);
  const text = clampToContrast(textRaw, bg, 4.5);

  const accentForeground = inkOn(accent);        // ink ON an accent fill
  const primaryForeground = inkOn(primary);      // ink ON a primary fill (e.g. a filled bubble/button)
  const accentInk = clampToContrast(accent, bg); // accent AS text on the background

  // A muted text token (AA-clamped to ~3:1 for large/secondary copy) and a hairline
  // border, both derived — components never invent their own opacity hacks.
  const muted = clampToContrast(mix(text, bg, 0.32), bg, 3);

  // ── Band variants (§11 rhythm): three section tones so a page is never one flat brand color
  // head-to-toe. A section wrapper REBINDS the base --gp-* vars to one of these sets, so every
  // block body (which only ever reads --gp-*) re-themes automatically — zero per-block changes,
  // all AA-clamped by the same helpers used above.
  const bgIsDark = luminance(bg) <= 0.5;

  // DEEP band — a darker brand tone anchored on PRIMARY (not bg) so it is genuinely dark even
  // when a tenant picks a pale primary. Light ink; gold numbers/eyebrows glow on it.
  const deepBg = mix(primary, BLACK, 0.3);
  const deepText = inkOn(deepBg);
  const deepMuted = clampToContrast(mix(deepText, deepBg, 0.32), deepBg, 3);
  const deepAccentInk = clampToContrast(accent, deepBg, 4.5);
  const deepSurface = mix(deepBg, deepText, 0.08);

  // CONTRAST band — the OPPOSITE luminance pole from bg. On the common dark brand it is a
  // near-white panel (cards pop, dark ink); on a pale brand it falls back to the deep tone so it
  // still contrasts. The single biggest rhythm lever.
  const contrastBg = bgIsDark ? mix(WHITE, primary, 0.05) : deepBg;
  const contrastText = inkOn(contrastBg);
  const contrastMuted = clampToContrast(mix(contrastText, contrastBg, 0.35), contrastBg, 3);
  const contrastAccentInk = clampToContrast(accent, contrastBg, 4.5);
  const contrastSurface = mix(contrastBg, contrastText, 0.05);

  return {
    "--gp-primary": toHex(primary),
    "--gp-accent": toHex(accent),
    "--gp-bg": toHex(bg),
    "--gp-surface": toHex(mix(bg, text, luminance(bg) > 0.5 ? 0.04 : 0.06)),
    "--gp-text": toHex(text),
    "--gp-muted": toHex(muted),
    "--gp-accent-foreground": toHex(accentForeground),
    "--gp-primary-foreground": toHex(primaryForeground),
    "--gp-accent-ink": toHex(accentInk),
    "--gp-font": fontPair ? brandFontStack(fontPair.body) : (safeFont(t.font) || GROWTH_BRAND_FLOOR.font),
    ...(fontPair ? { "--gp-font-display": brandFontStack(fontPair.display) } : {}),
    // Band variants — a section wrapper rebinds the base --gp-* to one of these for rhythm.
    "--gp-deep-bg": toHex(deepBg),
    "--gp-deep-text": toHex(deepText),
    "--gp-deep-muted": toHex(deepMuted),
    "--gp-deep-accent-ink": toHex(deepAccentInk),
    "--gp-deep-surface": toHex(deepSurface),
    "--gp-contrast-bg": toHex(contrastBg),
    "--gp-contrast-text": toHex(contrastText),
    "--gp-contrast-muted": toHex(contrastMuted),
    "--gp-contrast-accent-ink": toHex(contrastAccentInk),
    "--gp-contrast-surface": toHex(contrastSurface),
  };
}
