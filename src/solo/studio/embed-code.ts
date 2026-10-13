// The one tag a business pastes into its own website to show a live Paige form there (Experience 03): the
// loader (public/embed.js) from this app's origin, the form's id, and its name as the frame's label.
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function embedSnippet(origin: string, formId: string, formName?: string | null): string {
  const title = formName?.trim() ? ` data-title="${attr(formName.trim())}"` : "";
  return `<script src="${origin}/embed.js" data-form="${formId}"${title} async></script>`;
}
