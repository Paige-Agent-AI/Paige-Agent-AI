// When a public Paige page runs inside a business's own website (public/embed.js puts it in an
// <iframe>), tell the parent frame how tall the content is, on mount and on every change, so the
// loader can size the frame with no inner scrollbar. One home for the booking page and the hosted
// form; the loader accepts only its own message type, from its own origin and its own frame.
import { useEffect, type RefObject } from "react";

/** Is this page rendered inside a parent frame? Stable for the life of the page. */
export const isEmbedded = (): boolean => typeof window !== "undefined" && window.parent !== window;

/** A Paige form shown on a business's own website: framed by the loader (public/embed.js) or by the no-script
 *  frame, or asked for with ?embed=1. Paige's own product analytics stay off there: the visitors are the
 *  business's, not Paige's. Stable for the life of the page. */
export function isFormOnBusinessSite(): boolean {
  if (typeof window === "undefined" || !/^\/form\//.test(window.location.pathname)) return false;
  return isEmbedded() || new URLSearchParams(window.location.search).get("embed") === "1";
}

/**
 * The theme a form framed on a business's website is drawn in: what the embed code asked for (`data-theme` →
 * `?theme=`), light by default so a business's page never gets a dark box it didn't choose; "auto" follows the
 * visitor. Undefined everywhere else, so the app keeps its own theme. Forced (never stored), so an embedded
 * visit never changes the theme the owner picked in their own app.
 */
export function embeddedFormTheme(): "light" | "dark" | undefined {
  if (!isFormOnBusinessSite()) return undefined;
  const asked = new URLSearchParams(window.location.search).get("theme");
  return asked === "dark" ? "dark" : asked === "auto" ? undefined : "light";
}

/** The parent's origin from the embedding chain (Chromium / WebKit) or the referrer. Height is not
 *  sensitive, so "*" is the last resort when the browser hides both. */
export function parentOrigin(): string {
  try {
    const ao = (window.location as unknown as { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    // A sandboxed or opaque-origin parent reports "null", which postMessage refuses as a target.
    if (ao && ao.length > 0 && ao[0] && ao[0] !== "null") return ao[0];
  } catch { /* cross-origin access can throw; fall through */ }
  if (document.referrer) {
    try { const origin = new URL(document.referrer).origin; if (origin !== "null") return origin; } catch { /* malformed referrer */ }
  }
  return "*";
}

/**
 * Post `{ ...message, height }` to the parent whenever `ref`'s element changes height.
 * `deps` re-attaches the observer when the measured element is replaced (e.g. loading → loaded).
 */
export function useEmbedHeight(ref: RefObject<HTMLElement | null>, message: { type: string } & Record<string, unknown>, deps: readonly unknown[]): void {
  useEffect(() => {
    // Only speak to a parent frame — a stand-alone visit has none to size.
    if (!isEmbedded()) return;
    const el = ref.current;
    if (!el) return;
    const target = parentOrigin();
    let last = 0;
    let frame = 0;
    const post = () => {
      frame = 0;
      // Round up so sub-pixel growth never leaves a hairline scrollbar.
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (!height || Math.abs(height - last) < 1) return;
      last = height;
      window.parent.postMessage({ ...message, height }, target);
    };
    // Coalesce bursts (fonts, images, phase changes) into one post per frame.
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(post); };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("load", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("load", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // The message's fields are part of deps by the caller's choice; `ref` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
