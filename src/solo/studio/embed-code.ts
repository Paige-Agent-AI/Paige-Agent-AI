// The one tag a business pastes into its own website to show a live Paige form there (Experience 03): the
// loader (public/embed.js) from this app's origin, the form's id, and its name as the frame's label.
import { MARKETING_HOST } from "@/lib/hostRouting";

/** Where the loader is served from: this Paige host when it is one (the public intake only accepts answers from
 *  paigeagent.ai and its subdomains), otherwise the canonical public host, so code copied from a preview or a
 *  local build still works on a business's site. */
export function embedOrigin(location: { protocol: string; host: string; hostname: string }): string {
  const paige = location.hostname === MARKETING_HOST || location.hostname.endsWith(`.${MARKETING_HOST}`);
  return paige && location.protocol === "https:" ? `https://${location.host}` : `https://${MARKETING_HOST}`;
}

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function embedSnippet(origin: string, formId: string, formName?: string | null): string {
  const title = formName?.trim() ? ` data-title="${attr(formName.trim())}"` : "";
  return `<script src="${origin}/embed.js" data-form="${formId}"${title} async></script>`;
}
