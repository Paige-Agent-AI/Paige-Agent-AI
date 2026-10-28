// The app-side binding of the portable export. The BUILDER lives in ONE place —
// supabase/functions/_shared/growth/export-portable.ts — so the Studio's download and the
// hosting door's deployed bytes can never drift apart. This wrapper exists for the app's
// DOMPurify seam: the browser binds DOMPurify's rich_text sanitizer (the exact behavior the
// export shipped with); the Deno side uses the core's strict default (same documented
// posture). Public API unchanged for every existing import.
import DOMPurify from "dompurify";
import {
  buildPortableExport as buildPortableExportCore,
  PortableExportRefused,
  type PortableExport,
  type PortableExportAsset,
  type PortableExportManifest,
  type PortablePageSource,
  type RichTextSanitizer,
} from "../../../supabase/functions/_shared/growth/export-portable.ts";

export { PortableExportRefused };
export type { PortableExport, PortableExportAsset, PortableExportManifest, PortablePageSource, RichTextSanitizer };

const domPurifyRichText: RichTextSanitizer = (html) =>
  DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"],
  });

export function buildPortableExport(
  src: PortablePageSource,
  opts: { origin: string; exportedAt: string },
): PortableExport {
  return buildPortableExportCore(src, { ...opts, sanitizeRichText: domPurifyRichText });
}
