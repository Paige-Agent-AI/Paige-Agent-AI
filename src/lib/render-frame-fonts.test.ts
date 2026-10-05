import { afterEach, describe, expect, it, vi } from "vitest";
import { settleRenderFrame } from "./render-frame";
import { BRAND_FONT_STYLE_ATTR, ensureBrandFontFaces, lookupBrandFont } from "./brand-fonts";

/**
 * /render-frame must not say "ready" while the page's brand faces are still downloading: paige-browser
 * would screenshot the fallback face and the critic would judge type the visitor never sees.
 */
describe("settleRenderFrame waits for the injected brand faces", () => {
  afterEach(() => {
    document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).forEach((n) => n.remove());
    Reflect.deleteProperty(document, "fonts");
  });

  it("does not resolve until the brand face loads settle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), load: vi.fn(() => gate.then(() => [])) },
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    void ensureBrandFontFaces(document, [lookupBrandFont("Literata")]);

    let ready = false;
    const settled = settleRenderFrame(root, 5000).then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 250)); // well past the two settle frames
    expect(ready).toBe(false);
    release();
    await settled;
    expect(ready).toBe(true);
    root.remove();
  });

  it("is still capped: a face that never loads cannot hold the frame forever", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), load: vi.fn(() => new Promise(() => {})) },
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    void ensureBrandFontFaces(document, [lookupBrandFont("Anton")]);
    await expect(settleRenderFrame(root, 40)).resolves.toBeUndefined();
    root.remove();
  });
});
