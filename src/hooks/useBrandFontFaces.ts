import { useLayoutEffect, type RefObject } from "react";
import { ensureBrandFontFaces, PAGE_FONT_WEIGHTS, type BrandFontFace } from "@/lib/brand-fonts";

/**
 * Load brand faces into the document that actually holds `ref.current`.
 *
 * The node, not the global `document`, decides where @font-face goes. The Studio canvas portals the
 * page into a same-origin iframe whose <head> was copied from the app ONCE, so a face injected into
 * the app document would never reach it. A move into a fresh frame document (the canvas reload)
 * remounts the tree, so this runs again there.
 *
 * TIMING IS PART OF THE CONTRACT. A plain ref is attached before the SAME commit's layout effects run,
 * so the faces are injected and their loads registered in the first commit, before any parent's
 * passive effect, such as /render-frame's settle, reads them. (A callback ref held in state would
 * inject only in a second render, after React has already flushed the parent's passive effects. That
 * was the bug: the frame could say "ready" before a single @font-face existed.)
 */
export function useBrandFontFaces(
  ref: RefObject<HTMLElement | null>,
  faces: readonly (BrandFontFace | null | undefined)[],
  weights: readonly string[] = PAGE_FONT_WEIGHTS,
): void {
  const key = `${faces.filter(Boolean).map((f) => (f as BrandFontFace).slug).join("|")}@${weights.join(",")}`;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !faces.some(Boolean)) return;
    void ensureBrandFontFaces(node.ownerDocument, faces, weights);
    // `faces` and `weights` are represented by `key`; the ref is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
