// Comms C-1.5 — shared merge-variable helpers for Signatures + Snippets.
// One home (§18): both tabs detect {{tokens}} and render previews the SAME way,
// and the §13 honesty rule lives here — an unknown token resolves to "" so a raw
// {{token}} is NEVER shipped into a sent signature/snippet.
import DOMPurify from "dompurify";

/** Review-only structural projection, never the HTML supplied to a sender.
 * Reuses the original Comms sanitizer. No styles/resources/forms/active links
 * enter the live page; destinations are ordinary text, not navigation targets.
 * Already-resolved customer content must not go through merge expansion again.
 */
export function renderEmailReviewHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "div", "span", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "blockquote", "pre", "code", "a", "hr"],
    ALLOWED_ATTR: ["href"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const anchor of fragment.querySelectorAll("a")) {
    const replacement = fragment.ownerDocument.createElement("span");
    while (anchor.firstChild) replacement.appendChild(anchor.firstChild);
    const destination = anchor.getAttribute("href");
    if (destination) replacement.appendChild(fragment.ownerDocument.createTextNode(` (${destination})`));
    anchor.replaceWith(replacement);
  }
  // Even allowed attributes belong only to the temporary parsing step above.
  for (const element of fragment.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  }
  const container = fragment.ownerDocument.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}

const TOKEN_RE = /\{\{\s*[\w.]+\s*\}\}/g;

/** Every unique {{token}} present in the text, in first-seen order. */
export function detectTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const raw of text.match(TOKEN_RE) ?? []) {
    // normalize inner whitespace so "{{ title }}" and "{{title}}" are one key
    seen.add(`{{${raw.replace(/[{}\s]/g, "")}}}`);
  }
  return [...seen];
}

/**
 * Resolve merge tokens against the provided defaults. §13: any token the map
 * doesn't cover collapses to "" — we never leave a literal {{token}} behind.
 */
export function resolveMergeVars(
  text: string,
  variables: Record<string, string> | null | undefined,
): string {
  const vars = variables ?? {};
  return text.replace(TOKEN_RE, (raw) => {
    const key = `{{${raw.replace(/[{}\s]/g, "")}}}`;
    return vars[key] ?? "";
  });
}

/** Sanitized, merge-resolved HTML ready for dangerouslySetInnerHTML preview. */
export function renderSignaturePreview(
  html: string,
  variables: Record<string, string> | null | undefined,
): string {
  const resolved = resolveMergeVars(html, variables);
  return DOMPurify.sanitize(resolved, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
}

/** Postgres unique-violation — surfaced as a crafted inline error, never raw. */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "23505";
}
