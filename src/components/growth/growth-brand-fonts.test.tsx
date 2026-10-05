import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthBlocks } from "./GrowthBlocks";
import { buildGrowthBrandFloor, resolveGrowthFontPair, resolveGrowthTheme } from "./growth-theme";
import { BRAND_FONT_STYLE_ATTR } from "@/lib/brand-fonts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) } }));

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BLOCKS = [
  { type: "hero", title: "Advice that compounds", subtitle: "A planning studio for owners.", cta_label: "Book a call", cta_href: "#book" },
  { type: "feature_grid", title: "What we do", items: [{ title: "Plans", body: "Quarterly." }] },
] as never[];

describe("resolveGrowthTheme — brand font tokens", () => {
  it("a library brand font sets the body face from its pairing and the display face from the brand", () => {
    const vars = resolveGrowthTheme(null, buildGrowthBrandFloor({ font: "Literata" }));
    expect(vars["--gp-font"]).toMatch(/^"brand-public-sans", "Public Sans"/);
    expect(vars["--gp-font-display"]).toMatch(/^"brand-literata", "Literata"/);
  });

  it("the page's own theme font wins over the tenant brand font, like the colours", () => {
    const pair = resolveGrowthFontPair({ font: "Anton" }, buildGrowthBrandFloor({ font: "Literata" }));
    expect(pair?.display.family).toBe("Anton");
    expect(resolveGrowthTheme({ font: "Anton" }, buildGrowthBrandFloor({ font: "Literata" }))["--gp-font-display"]).toMatch(/^"brand-anton"/);
  });

  it("a null page font does not clobber the brand font (the generator writes font: null)", () => {
    expect(resolveGrowthFontPair({ font: null } as never, buildGrowthBrandFloor({ font: "Gloock" }))?.display.family).toBe("Gloock");
  });

  it("an unknown font keeps today's behaviour exactly: sanitised name in --gp-font, no display token", () => {
    const vars = resolveGrowthTheme(null, buildGrowthBrandFloor({ font: "Georgia" }));
    expect(vars["--gp-font"]).toBe('"Georgia", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(vars).not.toHaveProperty("--gp-font-display");
    expect(resolveGrowthFontPair(null, buildGrowthBrandFloor({ font: "Georgia" }))).toBeNull();
  });

  it("no brand font keeps the existing floor and no display token", () => {
    const vars = resolveGrowthTheme(null, buildGrowthBrandFloor(null));
    // (safeFont re-appends its fallback to the floor's own stack — pre-existing, harmless, left as is.)
    expect(vars["--gp-font"]).toBe('"Inter", system-ui, -apple-system, "Segoe UI", sans-serif, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(vars).not.toHaveProperty("--gp-font-display");
    expect(resolveGrowthFontPair(null, null)).toBeNull();
  });
});

describe("the scoped heading rule", () => {
  const rule = readFileSync(path.join(ROOT, "src", "components", "growth", "growth-brand-fonts.css"), "utf8");
  const indexCss = readFileSync(path.join(ROOT, "src", "index.css"), "utf8");
  const blocksSrc = readFileSync(path.join(ROOT, "src", "components", "growth", "GrowthBlocks.tsx"), "utf8");

  it("re-points headings only inside a branded workspace page, and GrowthBlocks ships it", () => {
    const rules = rule.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(rules).toBe(`[data-gp][data-gp-font="brand"] :is(h1, h2, h3, h4, .font-display) {
  font-family: var(--gp-font-display, var(--gp-font));
}`);
    expect(blocksSrc).toContain('import "./growth-brand-fonts.css";');
  });

  it("leaves the platform-wide heading rule and the body rule exactly as they were (the §28 landing shares them)", () => {
    expect(indexCss).toContain(`  h1, h2, h3, .font-display {
    font-family: "Bricolage Grotesque", "Inter", system-ui, sans-serif;
    letter-spacing: -0.01em;`);
    const bodyStack = /\n {2}body \{\s*font-family: ([^;]+);/.exec(indexCss)?.[1];
    expect(bodyStack?.split(", ")).toEqual(['"Inter"', "system-ui", "-apple-system", "sans-serif"]);
    expect(indexCss).not.toContain("--gp-font-display");
    expect(indexCss).not.toContain("data-gp");
  });
});

describe("<GrowthBlocks> brand font loading", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).forEach((n) => n.remove());
  });

  it("marks a branded page and loads ONLY its display and body faces", () => {
    act(() => root.render(<GrowthBlocks blocks={BLOCKS} brandFloor={buildGrowthBrandFloor({ font: "Bodoni Moda" })} />));
    const scope = container.querySelector("[data-gp]")!;
    expect(scope.getAttribute("data-gp-font")).toBe("brand");
    const injected = [...document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`)].map((s) => s.getAttribute(BRAND_FONT_STYLE_ATTR));
    expect(injected.sort()).toEqual(["bodoni-moda", "source-sans-3"]);
    // The heading still carries its classes; the scoped rule (not markup) decides its face.
    expect(container.querySelector("h1")?.className).toContain("font-display");
  });

  it("an unbranded or unknown-font page is not armed and loads nothing", () => {
    act(() => root.render(<GrowthBlocks blocks={BLOCKS} brandFloor={buildGrowthBrandFloor({ font: "Georgia" })} />));
    expect(container.querySelector("[data-gp]")!.hasAttribute("data-gp-font")).toBe(false);
    expect(document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(0);
  });

  it("inside the Studio canvas iframe, the faces land in the IFRAME's head (its styles were copied once)", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const frameDoc = frame.contentDocument!;
    act(() => root.render(createPortal(<GrowthBlocks blocks={BLOCKS} brandFloor={buildGrowthBrandFloor({ font: "Literata" })} />, frameDoc.body)));
    const inFrame = [...frameDoc.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`)].map((s) => s.getAttribute(BRAND_FONT_STYLE_ATTR));
    expect(inFrame.sort()).toEqual(["literata", "public-sans"]);
    expect(document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).length).toBe(0);
    act(() => root.render(<></>));
    frame.remove();
  });
});
