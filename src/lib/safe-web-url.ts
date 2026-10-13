// A stored link a public page follows or renders (a form's redirect or download, a booking redirect) is
// used only when it is an absolute http(s) address. The database refuses anything else on save
// (public.is_safe_web_url, migration 20271027100000, #2090); this is the browser's own check on top, so a
// row written before that rule, or by a path that slipped it, still cannot run script on Paige's origin.
export function safeWebUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}
