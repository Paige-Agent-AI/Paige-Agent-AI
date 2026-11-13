import { projectStudioBusinessContext, type StudioBusinessContext, type StudioContextTarget, type StudioEditableContextField } from "./business-context";

export type StudioRequestIntent = { kind: StudioContextTarget["kind"]; values: StudioBusinessContext["projectValues"] };
const LABELS: Readonly<Record<string, StudioEditableContextField>> = {
  "business name": "publicName", "public business name": "publicName", offer: "offers", audience: "idealCustomer",
  "brand voice": "brandVoice", "primary color": "primaryColor", "accent color": "accentColor",
};
const CUES: ReadonlyArray<readonly [StudioContextTarget["kind"], RegExp]> = [
  ["workspace", /\bfor\s+(?:(?:my|our)\s+(?:own\s+)?(?:business|company|workspace)|this\s+(?:business|company|workspace)|the\s+current\s+workspace)\b/i],
  ["client", /\bfor\s+(?:my|our|a|an|the)\s+(?:existing\s+)?client\b/i],
  ["prospect", /\bfor\s+(?:my|our|a|the)\s+(?:new\s+)?prospect\b/i],
  ["custom", /\bfor\s+(?:(?:my|our|a|the)\s+)?(?:different|another|custom|new)\s+(?:brand|business|project)\b/i],
];
/**
 * Editable proposal data from ORIGINAL human request text only. Callers must
 * never substitute a model brief, assistant reply, document or history search.
 * This deliberately recognizes a small explicit grammar, not general intent.
 * It returns no IDs, source assertions, CRM matches, permission or saved state.
 */
export function projectStudioRequestIntent(originalRequestText: unknown): StudioRequestIntent | null {
  if (typeof originalRequestText !== "string" || !originalRequestText.trim() || originalRequestText.length > 10000
    || /[`<>{}]/.test(originalRequestText)) return null;
  // eslint-disable-next-line no-control-regex -- exclude hidden controls in original request text
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(originalRequestText)) return null;
  const values: StudioBusinessContext["projectValues"] = {};
  const prose: string[] = [];
  for (const line of originalRequestText.split(/\r?\n/)) {
    const labelled = /^\s*([a-z ]{1,40}):\s*(.*?)\s*$/i.exec(line);
    if (!labelled) { prose.push(line); continue; }
    const key = LABELS[labelled[1].trim().toLowerCase()];
    if (!key || !labelled[2]) continue;
    if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== labelled[2]) return null;
    values[key] = labelled[2];
  }
  const request = prose.join("\n").replace(/"[^"\r\n]*(?:"|$)|“[^”\r\n]*(?:”|$)|‘[^’\r\n]*(?:’|$)|(?:^|\s)'[^'\r\n]*(?:'|$)/gm, " ");
  if (/\b(?:not|never|don['’]t|doesn['’]t|instead|maybe|if|whether|either|or|example|quote|said|says)\b/i.test(request)) return null;
  const matches = CUES.filter(([, cue]) => cue.test(request));
  if (matches.length !== 1) return null;
  const kind = matches[0][0];
  // Use the one existing project-value sanitizer; these neutral placeholders
  // validate text only and are never returned or used to read any source.
  const safe = projectStudioBusinessContext({ expectedTenantId: "request-input", target: { kind: "custom", reference: "request-input" }, readStatus: "unavailable", context: null, projectValues: values }).projectValues;
  return { kind, values: safe };
}
