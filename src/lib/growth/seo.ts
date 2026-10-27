// Published-page sharing/SEO truth (EXP06 PR8 — WEB-12, matrix row 12).
//
// What this is: the ONE place a published page's seo_json columns become what a visitor's
// browser (and any JS-executing crawler or link-unfurler) actually sees — the document title,
// a meta description, and Open Graph tags. What this is NOT: a ranking system, a server-side
// renderer, or a promise about search results. This is a client-rendered SPA: tags are applied
// after load, only from the PUBLISHED columns, and nothing here claims or measures placement.
//
// Safety posture: values are written through DOM property assignment (textContent /
// setAttribute) — never innerHTML — so a hostile description can at worst become visible text
// in an unfurled card, never markup. Non-string / oversized values are dropped, not guessed.

export interface PublishedSeo {
  title: string | null;
  description: string | null;
  /** An absolute https image URL chosen for link unfurls, or null. */
  ogImage: string | null;
  /** The page's own canonical address, when the caller knows it (it may not). */
  canonicalUrl: string | null;
}

/** Meta tags this module owns. Anything else in <head> was there before and stays. */
const MANAGED = [
  { attr: "name", key: "description" },
  { attr: "property", key: "og:title" },
  { attr: "property", key: "og:description" },
  { attr: "property", key: "og:image" },
  { attr: "property", key: "og:url" },
  { attr: "name", key: "twitter:card" },
] as const;

const trim = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? (v.trim().length > max ? `${v.trim().slice(0, max - 1)}…` : v.trim()) : null;

/** Only an absolute https URL is an image a foreign unfurler can FETCH — anything else is dropped. */
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  try { const u = new URL(v.trim()); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
};

/** The canonical is the page's OWN address — never fetched by anyone, so http(s) both count
 *  (local dev and test hosts run http; production is https). Anything non-absolute is dropped. */
const absoluteUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  try { const u = new URL(v.trim()); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null; } catch { return null; }
};

function upsertMeta(doc: Document, attr: string, key: string, content: string | null): void {
  let el = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === null) { el?.remove(); return; } // absent honestly beats a stale tag
  if (!el) {
    el = doc.createElement("meta");
    el.setAttribute(attr, key);
    doc.head.append(el);
  }
  el.setAttribute("content", content);
}

/**
 * Apply the PUBLISHED sharing truth to a document. Pure with respect to data (no fetching,
 * no storage): hand it what the published row says and it makes the head say the same thing.
 * Returns what it applied, so callers and tests can assert the truth instead of the DOM.
 */
export function applyPublishedSeo(doc: Document, seo: PublishedSeo): { title: string | null; description: string | null; ogImage: string | null } {
  const title = trim(seo.title, 300);
  const description = trim(seo.description, 400);
  const ogImage = httpsUrl(seo.ogImage);
  const canonicalUrl = absoluteUrl(seo.canonicalUrl);

  if (title !== null) doc.title = title; // absent/null keeps the app default — never blank
  upsertMeta(doc, "name", "description", description);
  upsertMeta(doc, "property", "og:title", title);
  upsertMeta(doc, "property", "og:description", description);
  upsertMeta(doc, "property", "og:image", ogImage);
  upsertMeta(doc, "property", "og:url", canonicalUrl);
  upsertMeta(doc, "name", "twitter:card", ogImage ? "summary_large_image" : description ? "summary" : null);

  return { title, description, ogImage };
}

/** Test/seam helper: the managed tag list, so a test can prove nothing else is touched. */
export const MANAGED_SEO_TAGS: readonly { attr: string; key: string }[] = MANAGED;
