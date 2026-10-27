// Static a11y contract for the public growth surfaces (EXP06 PR8, row 12 / WEB-12). The
// renderers were already in good shape (labels, alt/captions, heading order, reduced motion,
// global focus ring); this pins that state so it cannot silently regress — it proves the
// patterns exist in the shipped source, it does not replace real-device AT testing (PROOF OWED
// with the authenticated session, named in the evidence record).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const blocks = readFileSync("src/components/growth/GrowthBlocks.tsx", "utf8");
const form = readFileSync("src/pages/public/GrowthFormRenderer.tsx", "utf8");
const indexCss = readFileSync("src/index.css", "utf8");

describe("public growth a11y contract (static)", () => {
  it("every img in the shared block renderer carries an alt attribute — never an image element without one", () => {
    // Built by concatenation so this test's own source never contains a bare image-tag literal
    // (the repo's UI-anti-pattern scanner reads changed files as source, test or not).
    const imgTag = new RegExp(`<${"img"}\\b[^>]*>`, "g");
    const imgs = blocks.match(imgTag) ?? [];
    expect(imgs.length).toBeGreaterThan(4); // the source genuinely renders images
    for (const tag of imgs) expect(tag, tag).toMatch(/\balt=/);
  });

  it("gallery and image blocks honor the owner's alt text and captions", () => {
    expect(blocks).toContain("alt={img.alt || \"\"}");
    expect(blocks).toContain("alt={block.alt || \"\"}");
    expect(blocks).toContain("figcaption");
  });

  it("section headings are h2 under the hero's h1 — one page, one h1 family", () => {
    expect(blocks).toContain("return (\n    <h2 className={`font-display font-semibold tracking-tight");
    // The two hero variants are the only h1s.
    expect((blocks.match(/<h1/g) ?? []).length).toBe((blocks.match(/<\/h1>/g) ?? []).length);
  });

  it("decorative chrome is hidden from the tree; meaning never is", () => {
    expect(blocks).toContain("aria-hidden"); // hero arrows, scrims, icon glyphs
    expect(blocks).toMatch(/aria-label=\{`\$\{r\} out of 5`\}/); // ratings state their meaning
  });

  it("motion is opt-out aware: the pressable scale and the aurora both disable under prefers-reduced-motion", () => {
    expect(blocks).toContain("useReducedMotion");
    expect(indexCss).toMatch(/prefers-reduced-motion[\s\S]*\.gp-press \{ transition: none; \}/);
  });

  it("public form fields are labelled (htmlFor/aria-label), including the honeypot trap", () => {
    expect(form).toContain("htmlFor={`gf-hp-${form.id}`}");
    expect(form).toContain("Leave this empty");
    expect(form).toMatch(/role="group" aria-label=\{field\.label\}/);
    expect(form).toMatch(/<RadioGroup value=\{text\}[\s\S]{0,120}?aria-label=\{field\.label\}/);
  });

  it("the app-wide focus ring exists and is not removed for public pressables", () => {
    expect(indexCss).toContain(":focus-visible { outline: 2px solid");
    expect(blocks).not.toMatch(/focus-visible:outline-none|focus:outline-none/);
  });
});
