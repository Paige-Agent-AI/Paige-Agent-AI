import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRAND_FONTS,
  BRAND_FONT_PAIRINGS,
  BRAND_FONT_STYLE_ATTR,
  brandFontFaceCss,
  brandFontPairing,
  brandFontStack,
  brandFontsSettled,
  ensureBrandFontFaces,
  PREVIEW_FONT_WEIGHTS,
  lookupBrandFont,
  resolveBrandFontPair,
  type BrandFontPairingName,
} from "./brand-fonts";
import { BRAND_FONT_FILES } from "./brand-fonts.files";
import { FONT_OPTIONS } from "@/components/ui/page/BrandControls";

const ROOT = path.resolve(__dirname, "..", "..");

describe("brand font allowlist", () => {
  it("resolves every value the old picker could have stored (the classic picks keep working)", () => {
    for (const name of FONT_OPTIONS.filter((f) => f !== "System default")) {
      const face = lookupBrandFont(name);
      expect(face, name).not.toBeNull();
      expect(face!.family).toBe(name);
    }
  });

  it("matches the exact family only — case and surrounding quotes forgiven, nothing else", () => {
    expect(lookupBrandFont("  literata ")?.family).toBe("Literata");
    expect(lookupBrandFont('"Source Serif 4"')?.family).toBe("Source Serif 4");
    expect(lookupBrandFont("Literata, serif")).toBeNull();
    expect(lookupBrandFont("Lit")).toBeNull();
  });

  it("returns null for empty, non-string and unknown values — the 'System default' and legacy-free paths", () => {
    for (const v of ["", "   ", null, undefined, 42, {}, "Georgia", "Comic Sans MS", "System default"]) {
      expect(lookupBrandFont(v), String(v)).toBeNull();
      expect(resolveBrandFontPair(v), String(v)).toBeNull();
    }
  });

  it("an unknown font string never becomes a URL: nothing is injected and no CSS names it", () => {
    const doc = document.implementation.createHTMLDocument("x");
    const hostile = 'x"); src:url("https://evil.test/f.woff2';
    void ensureBrandFontFaces(doc, [lookupBrandFont(hostile), lookupBrandFont("Georgia")]);
    expect(doc.head.querySelectorAll("style").length).toBe(0);
    const allCss = BRAND_FONTS.map((f) => brandFontFaceCss(f)).join("\n");
    expect(allCss).not.toContain("evil.test");
    expect(allCss).not.toMatch(/https?:/);
  });

  it("builds every URL from a slug and a manifest file name only, under /fonts/brand/", () => {
    for (const face of BRAND_FONTS) {
      for (const url of brandFontFaceCss(face).match(/url\("[^"]+"\)/g) ?? []) {
        expect(url).toMatch(/^url\("\/fonts\/brand\/[a-z0-9-]+\/[a-z0-9-]+\.woff2"\)$/);
      }
    }
  });

  it("pairs the brand face with its approved body partner", () => {
    expect(resolveBrandFontPair("Bodoni Moda")).toMatchObject({ display: { family: "Bodoni Moda" }, body: { family: "Source Sans 3" } });
    expect(resolveBrandFontPair("Literata")).toMatchObject({ display: { family: "Literata" }, body: { family: "Public Sans" } });
    expect(resolveBrandFontPair("Archivo")).toMatchObject({ display: { family: "Archivo" }, body: { family: "Literata" } });
    // A classic pick keeps its whole page in one face, as it rendered before.
    expect(resolveBrandFontPair("Poppins")).toMatchObject({ display: { family: "Poppins" }, body: { family: "Poppins" } });
  });

  it("every partner and every named pairing resolves to a library face", () => {
    for (const face of BRAND_FONTS) expect(lookupBrandFont(face.partner), `${face.family} → ${face.partner}`).not.toBeNull();
    for (const name of Object.keys(BRAND_FONT_PAIRINGS) as BrandFontPairingName[]) {
      const pair = brandFontPairing(name);
      expect(pair.display, name).toBeTruthy();
      expect(pair.body, name).toBeTruthy();
      expect(pair.display.character, name).not.toBe("classic");
    }
    expect(Object.keys(BRAND_FONT_PAIRINGS)).toHaveLength(14);
  });

  it("offers the 17 library families plus the classic picks, each with self-hosted files", () => {
    expect(BRAND_FONTS.filter((f) => f.character !== "classic")).toHaveLength(17);
    expect(BRAND_FONTS.filter((f) => f.character === "classic").map((f) => f.family).sort()).toEqual(
      ["DM Sans", "Inter", "Lora", "Montserrat", "Playfair Display", "Plus Jakarta Sans", "Poppins", "Space Grotesk"],
    );
    // The manifest and the policy agree: nothing fetched is unoffered, nothing offered is unfetched.
    expect(Object.keys(BRAND_FONT_FILES).sort()).toEqual(BRAND_FONTS.map((f) => f.slug).sort());
  });

  it("ships every declared file and the OFL beside it", () => {
    for (const face of BRAND_FONTS) {
      expect(face.license).toBe("OFL");
      const dir = path.join(ROOT, "public", "fonts", "brand", face.slug);
      expect(existsSync(path.join(dir, "OFL.txt")), `${face.slug}/OFL.txt`).toBe(true);
      expect(readFileSync(path.join(dir, "OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
      for (const f of face.files) {
        const buf = readFileSync(path.join(dir, f.file));
        expect(buf.toString("latin1", 0, 4), f.file).toBe("wOF2");
        expect(buf.length, f.file).toBe(f.bytes);
      }
    }
  });

  it("Bodoni Moda ships a variable file with a LIVE optical-size axis (GRAMMAR §19.17), or not at all", () => {
    const bodoni = lookupBrandFont("Bodoni Moda");
    expect(bodoni).not.toBeNull();
    expect(bodoni!.files.map((f) => f.subset).sort()).toEqual(["latin", "latin-ext"]);
    for (const f of bodoni!.files) expect(f.axes.some((a) => a.startsWith("opsz")), f.file).toBe(true);
  });

  it("dedupes variable files — one file per subset for a variable family, not one per weight", () => {
    for (const face of BRAND_FONTS) {
      if (face.files.some((f) => f.axes.length > 0)) expect(face.files.map((f) => f.subset).sort(), face.family).toEqual(["latin", "latin-ext"]);
    }
  });

  it("ships latin and latin-ext for every face, each @font-face scoped by its own unicode-range", () => {
    for (const face of BRAND_FONTS) {
      expect(new Set(face.files.map((f) => f.subset)), face.family).toEqual(new Set(["latin", "latin-ext"]));
      const css = brandFontFaceCss(face);
      for (const f of face.files) expect(css, f.file).toContain(`/${f.file}") format("woff2");unicode-range:${f.unicodeRange};`);
    }
    // latin-ext (e.g. Ł, ő, ğ) is a separate file the browser fetches only for a page that uses it.
    const latinExt = lookupBrandFont("Literata")!.files.find((f) => f.subset === "latin-ext")!;
    expect(latinExt.unicodeRange).toMatch(/U\+0100-02BA/);
  });

  it("declares a single-cut static face across the weight range so headings never fake-bold it", () => {
    expect(brandFontFaceCss(lookupBrandFont("Anton")!)).toContain("font-weight:1 1000;");
    expect(brandFontFaceCss(lookupBrandFont("Spectral")!)).toContain("font-weight:600;");
    expect(brandFontFaceCss(lookupBrandFont("Archivo")!)).toContain("font-stretch:62% 125%;");
  });

  it("namespaces the face so a tenant's 'Inter' can never re-skin the app chrome that also names Inter", () => {
    const inter = lookupBrandFont("Inter")!;
    expect(brandFontFaceCss(inter)).toContain('font-family:"brand-inter";');
    // The only family any of its @font-face rules declares is the namespaced one.
    expect(new Set(brandFontFaceCss(inter).match(/font-family:"[^"]+"/g))).toEqual(new Set(['font-family:"brand-inter"']));
    expect(brandFontStack(inter)).toBe('"brand-inter", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(brandFontStack(lookupBrandFont("Literata")!)).toMatch(/^"brand-literata", "Literata", Georgia/);
  });
});

describe("ensureBrandFontFaces — loading into the right document", () => {
  afterEach(() => {
    document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).forEach((n) => n.remove());
    vi.restoreAllMocks();
  });

  it("injects into the GIVEN document's head (the Studio canvas iframe), not the app document", () => {
    const frameDoc = document.implementation.createHTMLDocument("canvas");
    const pair = resolveBrandFontPair("Literata")!;
    void ensureBrandFontFaces(frameDoc, [pair.display, pair.body]);
    const injected = [...frameDoc.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`)].map((s) => s.getAttribute(BRAND_FONT_STYLE_ATTR));
    expect(injected).toEqual(["literata", "public-sans"]);
    expect(document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(0);
    expect(frameDoc.head.textContent).toContain("font-display:swap;");
  });

  it("injects only the faces asked for, and each face once per document", () => {
    const doc = document.implementation.createHTMLDocument("x");
    const lit = lookupBrandFont("Literata")!;
    void ensureBrandFontFaces(doc, [lit, lit]);
    void ensureBrandFontFaces(doc, [lit]);
    expect(doc.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(1);
    // A different document gets its own copy.
    const other = document.implementation.createHTMLDocument("y");
    void ensureBrandFontFaces(other, [lit]);
    expect(other.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(1);
  });

  it("starts the regular and semibold loads and brandFontsSettled waits for them", async () => {
    const doc = document.implementation.createHTMLDocument("x");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const load = vi.fn(() => gate.then(() => []));
    Object.defineProperty(doc, "fonts", { value: { load }, configurable: true });
    void ensureBrandFontFaces(doc, [lookupBrandFont("Gloock")!]);
    expect(load).toHaveBeenCalledWith('400 16px "brand-gloock"', "Aa");
    expect(load).toHaveBeenCalledWith('600 16px "brand-gloock"', "Aa");
    let settled = false;
    const done = brandFontsSettled(doc).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await done;
    expect(settled).toBe(true);
  });

  it("a picker preview loads only the regular cut", () => {
    const doc = document.implementation.createHTMLDocument("x");
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(doc, "fonts", { value: { load }, configurable: true });
    void ensureBrandFontFaces(doc, [lookupBrandFont("Spectral")!], PREVIEW_FONT_WEIGHTS);
    expect(load.mock.calls).toEqual([['400 16px "brand-spectral"', "Aa"]]);
  });

  it("a failed load is logged loudly and still settles — the page stays visible in its fallback", async () => {
    const doc = document.implementation.createHTMLDocument("x");
    Object.defineProperty(doc, "fonts", { value: { load: vi.fn(() => Promise.reject(new Error("404"))) }, configurable: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await ensureBrandFontFaces(doc, [lookupBrandFont("Anton")!]);
    await brandFontsSettled(doc);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Anton did not load"), expect.any(Error));
  });

  it("does nothing without a document", async () => {
    await expect(ensureBrandFontFaces(null, [lookupBrandFont("Anton")!])).resolves.toBeUndefined();
    await expect(brandFontsSettled(undefined)).resolves.toBeUndefined();
  });
});
