// The one document parser: a marketing_content document row's structured block JSON, read the same way by
// the Studio canvas (loadDocument in studio.ts) and the Marketing library. Kept apart from studio.ts so a
// page that only shows documents does not load the whole Studio seam.
import type { StudioDocBlock, StudioDocType, StudioDocument } from "./studio-types";

/** Parse a document row's structured block JSON (the one parser: the Studio canvas and the Marketing
 *  library both read documents through it). Null when the body is empty, corrupt or has no blocks —
 *  never throws (§13). */
export function parseStudioDocument(id: string, title: string | null, body: string | null): StudioDocument | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { docType?: string; title?: string; blocks?: unknown };
    const blocks = Array.isArray(parsed.blocks) ? (parsed.blocks as StudioDocBlock[]) : [];
    if (!blocks.length) return null;
    const docType = (["guide", "one_pager", "ebook", "checklist", "worksheet", "proposal", "offer_letter", "sales_offer", "agreement_draft"].includes(String(parsed.docType))
      ? parsed.docType : "guide") as StudioDocType;
    return { id, title: title || parsed.title || "Untitled document", docType, blocks };
  } catch {
    return null; // corrupt body — degrade to empty, never throw (§13)
  }
}

/** Print / Save as PDF for a rendered document: the browser's own dialog over a print-scoped view of
 *  just the sheet ([data-paige-doc-sheet]; the rules are in index.css). A safety timeout clears the class
 *  in case `afterprint` never fires (headless or print-to-file). */
export function printStudioDocument(): void {
  const root = window.document.documentElement;
  root.classList.add("paige-doc-printing");
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    root.classList.remove("paige-doc-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 60_000);
  window.print();
}
