// Marketing email writing marks, shared by the editor (src/solo/email-markup.ts) and PAIGE's chat tools
// (_shared/email-campaign-chat.ts), so a campaign PAIGE drafts reopens in the editor as editable words.
//
// Marks (one per line):  "# Heading"  ·  "- item"  ·  "[[Button text|https://…]]"  ·  [link text](https://…)
// A blank line starts a new paragraph. Anything else is plain text, escaped.
//
// The words are kept inside the email as an HTML comment, so the editor can reopen them. The dispatcher
// strips every comment before sending, so the comment never reaches anyone.

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SOURCE_OPEN = "<!--paige-src:";
const SOURCE_CLOSE = "-->";

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/** Only http(s) and mailto links survive; anything else is written out as text. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch { return null; }
}

const LINK = "color:#4b3bc4;text-decoration:underline";
const P = "margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f1d2b";

function inline(text: string): string {
  let out = "";
  let last = 0;
  const pattern = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    out += escapeHtml(text.slice(last, m.index));
    const href = safeUrl(m[2]);
    out += href ? `<a href="${escapeHtml(href)}" style="${LINK}">${escapeHtml(m[1])}</a>` : escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/** The owner's marks as email HTML, with the marks kept in a comment for editing. */
export function markupToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) blocks.push(`<p style="${P}">${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list.length) blocks.push(`<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:#1f1d2b">${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`); list = []; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^#\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    const button = /^\[\[([^|\]\n]{1,80})\|([^\]\s]{1,2000})\]\]$/.exec(line.trim());
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (heading) { flushPara(); flushList(); blocks.push(`<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#1f1d2b">${inline(heading[1])}</h2>`); continue; }
    if (item) { flushPara(); list.push(item[1]); continue; }
    if (button) {
      flushPara(); flushList();
      const href = safeUrl(button[2]);
      blocks.push(href
        ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#1f1d2b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(button[1])}</a></p>`
        : `<p style="${P}">${escapeHtml(line)}</p>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  const body = blocks.join("\n");
  return source.trim() ? `${SOURCE_OPEN}${toBase64(source)}${SOURCE_CLOSE}\n${body}` : "";
}

/** The marks an email was written from, or null when it was written as HTML (by PAIGE, or pasted). */
export function sourceOf(bodyHtml: string): string | null {
  if (!bodyHtml.startsWith(SOURCE_OPEN)) return bodyHtml.trim() ? null : "";
  const end = bodyHtml.indexOf(SOURCE_CLOSE, SOURCE_OPEN.length);
  if (end < 0) return null;
  try { return fromBase64(bodyHtml.slice(SOURCE_OPEN.length, end)); } catch { return null; }
}
