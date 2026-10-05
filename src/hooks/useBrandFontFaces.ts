import { useLayoutEffect } from "react";
import { ensureBrandFontFaces, type BrandFontFace } from "@/lib/brand-fonts";

/**
 * Load brand faces into the document that actually holds `node`.
 *
 * The node — not the global `document` — decides where @font-face goes: the Studio canvas portals the
 * page into a same-origin iframe whose <head> was copied from the app ONCE, so a face injected into the
 * app document would never reach it. Pass the node via a callback ref held in state, so a remount into
 * a fresh frame document (the canvas reload) re-runs this. Layout effect: the faces are requested
 * before the browser paints and before any parent effect (such as /render-frame's settle) runs.
 */
export function useBrandFontFaces(node: HTMLElement | null, faces: readonly (BrandFontFace | null | undefined)[]): void {
  const key = faces.filter(Boolean).map((f) => (f as BrandFontFace).slug).join("|");
  useLayoutEffect(() => {
    if (!node || !key) return;
    void ensureBrandFontFaces(node.ownerDocument, faces);
    // `faces` is represented by `key` (their slugs); re-running on identity alone would re-query the DOM every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, key]);
}
