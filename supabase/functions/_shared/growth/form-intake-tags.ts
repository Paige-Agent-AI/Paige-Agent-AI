/** Pure setting validation; it grants no contact access or marketing consent. */
export type FormFutureTags = { ok: true; tags: string[] } | { ok: false; message: string };
// eslint-disable-next-line no-control-regex -- tags cannot contain hidden controls
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const trim = (value: string) => value.replace(/^ +| +$/g, ""); // Native btrim(text), preserving case and punctuation.
export function normalizeFormFutureTags(value: unknown): FormFutureTags {
  if (!Array.isArray(value)) return { ok: false, message: "Enter tags as a list." };
  const tags: string[] = [], seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || CONTROL.test(raw)) return { ok: false, message: "Tags cannot contain control characters. Remove them and try again." };
    const tag = trim(raw);
    if (!tag || [...tag].length > 80) return { ok: false, message: "Use 1–80 characters for each tag." };
    if (!seen.has(tag)) { tags.push(tag); seen.add(tag); }
    if (tags.length > 50) return { ok: false, message: "Use no more than 50 different tags." };
  }
  return { ok: true, tags };
}
export function parseFormFutureTagsInput(value: string): FormFutureTags {
  if (value.length > 8050) return { ok: false, message: "Use no more than 50 tags, with up to 80 characters each." };
  return normalizeFormFutureTags(value.split(/\r?\n/).filter(tag => trim(tag) !== ""));
}
