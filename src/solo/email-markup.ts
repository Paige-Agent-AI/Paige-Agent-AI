// Marketing email writing: a few plain-text marks become email-safe HTML, and the preview is the email
// exactly as the dispatcher sends it (renderCampaignEmail mirrors supabase/functions/email-campaign-worker/
// logic.ts; email-markup.test.ts proves they produce the same HTML).
//
// The writing marks themselves live in supabase/functions/_shared/email-markup.ts, which PAIGE's chat tools
// use too, so a campaign she drafts reopens here as editable words.

import { escapeHtml } from "../../supabase/functions/_shared/email-markup.ts";

export { escapeHtml, safeUrl, markupToHtml, sourceOf } from "../../supabase/functions/_shared/email-markup.ts";

// Elements whose content is not shown as text (or that would take over the page) go with everything
// inside them, including one left open to the end, which would otherwise swallow the footer.
const HIDDEN_ELEMENTS = /<(script|style|textarea|title|xmp|plaintext|template|noscript|iframe|noembed|noframes|object)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const STRAY_CLOSERS = /<\/(?:script|style|textarea|title|xmp|plaintext|template|noscript|iframe|noembed|noframes|object)\s*>/gi;
const DOCUMENT_TAGS = /<\/?(?:link|meta|base|frame|frameset)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "param", "source", "track", "wbr"]);

/** The body as it is sent: no comments, no hidden or document-level elements, a stray "<" written out as
 *  text, and every element it opens closed, so the footer (postal address, unsubscribe) always shows. */
export function sanitizeBody(html: string): string {
  const s = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(HIDDEN_ELEMENTS, "").replace(STRAY_CLOSERS, "").replace(DOCUMENT_TAGS, "");
  const open: string[] = [];
  let out = "";
  let last = 0;
  for (const m of s.matchAll(TAG)) {
    out += s.slice(last, m.index).replace(/</g, "&lt;");
    last = (m.index ?? 0) + m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue; // closes nothing that is open
      for (const inner of open.splice(at).reverse()) out += `</${inner}>`;
    } else {
      out += m[0];
      if (!VOID_ELEMENTS.has(name) && !m[3].trim().endsWith("/")) open.push(name);
    }
  }
  out += s.slice(last).replace(/</g, "&lt;");
  for (const name of open.reverse()) out += `</${name}>`;
  return out;
}

/** Mirror of renderCampaignEmail in supabase/functions/email-campaign-worker/logic.ts. Keep identical. */
export function renderCampaignEmail(input: { bodyHtml: string; preheader?: string | null; businessName?: string | null; postalAddress: string }): string {
  const preheader = (input.preheader ?? "").trim();
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`
    : "";
  const body = sanitizeBody(input.bodyHtml);
  const who = [input.businessName?.trim(), input.postalAddress.trim()].filter(Boolean).map((v) => escapeHtml(String(v)));
  const footer =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;line-height:1.5;color:#6b6b6b">` +
    `${who.join("<br>")}<br>` +
    `<a href="{{unsubscribe_url}}" style="color:#6b6b6b">Unsubscribe</a> from these emails.` +
    `</div>`;
  return `${hidden}${body}${footer}`;
}

/** The preview document: the sent email inside a plain reading frame. Shown in a sandboxed frame with no scripts. */
export function previewDocument(emailHtml: string): string {
  const shown = emailHtml.replace(/\{\{unsubscribe_url\}\}/g, "#unsubscribe-preview");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"></head>`
    + `<body style="margin:0;padding:24px 16px;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`
    + `<div style="max-width:600px;margin:0 auto;padding:32px 28px;background:#ffffff;border-radius:10px">${shown}</div></body></html>`;
}
