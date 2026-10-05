import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RenderFrame from "./RenderFrame";
import { BRAND_FONT_STYLE_ATTR } from "@/lib/brand-fonts";

/**
 * The REAL /render-frame with a library brand font must not say ready until that font has loaded —
 * otherwise paige-browser screenshots the fallback face. Regression for the review finding on P1: the
 * faces were injected in a second render, after the frame's settle had already read an empty load list.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) } }));

const PAYLOAD = {
  blocks: [{ type: "hero", title: "Advice that compounds", subtitle: "A planning studio.", cta_label: "Book", cta_href: "#b" }],
  theme: null,
  brand: { primary_color: "#1E3A34", accent_color: "#C8893B", font: "Literata" },
  tenant_name: "Harness workspace",
};

let container: HTMLDivElement;
let root: Root;
let release: () => void;
let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const gate = new Promise<void>((r) => { release = r; });
  load = vi.fn(() => gate.then(() => []));
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve(), load } });
  (window as Window & { __PAIGE_RENDER_PAYLOAD__?: unknown }).__PAIGE_RENDER_PAYLOAD__ = PAYLOAD;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, "fonts");
  delete (window as Window & { __PAIGE_RENDER_PAYLOAD__?: unknown }).__PAIGE_RENDER_PAYLOAD__;
  document.head.querySelectorAll(`style[${BRAND_FONT_STYLE_ATTR}]`).forEach((n) => n.remove());
});

const readyAttr = () => container.querySelector("[data-render-frame]")?.getAttribute("data-render-ready");
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("/render-frame with a library brand font", () => {
  it("is not ready until the brand face loads, then is", async () => {
    await act(async () => { root.render(<RenderFrame />); });
    expect(load).toHaveBeenCalledWith('400 16px "brand-literata"', "Aa");
    expect(document.head.querySelector(`style[${BRAND_FONT_STYLE_ATTR}="literata"]`)).not.toBeNull();
    await wait(300); // well past the settle's frames
    expect(readyAttr()).toBe("false");
    release();
    await wait(300);
    expect(readyAttr()).toBe("true");
  });
});
