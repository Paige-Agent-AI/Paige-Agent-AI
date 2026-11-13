import { validateBlock } from "../growth-blocks.ts";
import type { GrowthBlock } from "./types.ts";
import type { NexusLandingTemplateRecipe } from "./nexus-landing-template.ts";
import type { StudioBusinessContext, StudioEditableContextField } from "./studio-business-context.ts";

type SessionAdmission = { ok: true; sessionId: string | null } | { ok: false; status: 400 | 403; code: string; message: string };
const STUDIO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function admitStudioDraftSession(value: unknown, serviceRole: boolean): SessionAdmission {
  if (value === undefined) return { ok: true, sessionId: null };
  if (typeof value !== "string" || !STUDIO_UUID.test(value)) return { ok: false, status: 400, code: "INVALID_STUDIO_SESSION", message: "studio_session_id must name an original Studio session." };
  if (serviceRole) return { ok: false, status: 403, code: "FORBIDDEN", message: "A Studio project draft requires its original signed-in caller." };
  return { ok: true, sessionId: value.toLowerCase() };
}

type PageAdmission = { ok: true; pageId: string | null } | { ok: false; status: 400; code: "INVALID_STUDIO_PAGE"; message: string };
export function admitStudioDraftPage(value: unknown, sessionId: unknown): PageAdmission {
  if (value === undefined) return { ok: true, pageId: null };
  if (typeof sessionId !== "string" || !STUDIO_UUID.test(sessionId) || typeof value !== "string" || !STUDIO_UUID.test(value)) return { ok: false, status: 400, code: "INVALID_STUDIO_PAGE", message: "studio_page_id requires its original Studio session and a page UUID." };
  return { ok: true, pageId: value.toLowerCase() };
}

export type StudioSavedConversionBlock = Extract<GrowthBlock, { type: "conversion" | "embedded_form" }>;
export type StudioPageConversionRead = { ok: true; pageId: string; updatedAt: string; conversion: StudioSavedConversionBlock | null };
type ConversionRead = StudioPageConversionRead | { ok: false; code: "STUDIO_CONVERSION_UNAVAILABLE"; message: string };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const own = (value: Record<string, unknown>, key: string): unknown => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;

function savedConversionBlock(value: unknown): StudioSavedConversionBlock | null {
  const row = object(value);
  const type = row && own(row, "type");
  if (!row || (type !== "conversion" && type !== "embedded_form")) return null;
  const keys = type === "conversion" ? ["type", "destination", "title", "description", "label"] : ["type", "form_slug", "title"];
  if (Object.keys(row).some((key) => !keys.includes(key))) return null;
  for (const [field, limit] of [["title", 160], ["description", 400], ["label", 60]] as const) {
    const text = own(row, field);
    if (text !== undefined && (typeof text !== "string" || text.length > limit || CONTROL.test(text))) return null;
  }
  if (type === "conversion") {
    const destination = object(own(row, "destination"));
    if (!destination) return null;
    const kind = own(destination, "kind");
    if (kind !== "native_form" && kind !== "native_booking" && kind !== "external_form" && kind !== "external_booking") return null;
    const required = kind === "native_form" ? ["formId"] : kind === "native_booking" ? ["slug"] : ["mode", "url"];
    if (required.some((key) => typeof own(destination, key) !== "string")) return null;
    const destinationKeys = kind === "native_form" ? ["kind", "formId"] : kind === "native_booking" ? ["kind", "slug"] : ["kind", "mode", "url", "provider"];
    if (Object.keys(destination).some((key) => !destinationKeys.includes(key))) return null;
  }
  const clean = validateBlock(row) as StudioSavedConversionBlock | null;
  if (!clean) return null;
  // Never reinterpret an older form slug into a different form identity.
  if (clean.type === "embedded_form" && clean.form_slug !== own(row, "form_slug")) return null;
  if (clean.type === "conversion") {
    const destination = object(own(row, "destination"))!;
    const provider = own(destination, "provider");
    if (provider !== undefined && (!("provider" in clean.destination) || provider !== clean.destination.provider)) return null;
  }
  return clean;
}

/** Native response shape checks only. The JWT-native reader proves access and manifest binding. */
export function parseStudioPageConversionRead(requestedPageId: unknown, response: unknown): ConversionRead {
  const refused = (): ConversionRead => ({ ok: false, code: "STUDIO_CONVERSION_UNAVAILABLE", message: "The saved page conversion could not be confirmed. Reopen the current page before refining it." });
  const row = object(response);
  if (typeof requestedPageId !== "string" || !STUDIO_UUID.test(requestedPageId) || !row || own(row, "ok") !== true
    || Object.keys(row).some((key) => !["ok", "page_id", "updated_at", "conversion"].includes(key))) return refused();
  const pageId = own(row, "page_id");
  const updatedAt = own(row, "updated_at");
  if (typeof pageId !== "string" || !STUDIO_UUID.test(pageId) || pageId.toLowerCase() !== requestedPageId.toLowerCase()
    || typeof updatedAt !== "string" || updatedAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) return refused();
  const source = own(row, "conversion");
  if (source === null) return { ok: true, pageId: pageId.toLowerCase(), updatedAt, conversion: null };
  const conversion = savedConversionBlock(source);
  return conversion ? { ok: true, pageId: pageId.toLowerCase(), updatedAt, conversion } : refused();
}

/** A final read comparison is not an atomic save/CAS guarantee. */
export function sameStudioPageConversionRead(before: StudioPageConversionRead, after: StudioPageConversionRead): boolean {
  return before.pageId === after.pageId && before.updatedAt === after.updatedAt && JSON.stringify(before.conversion) === JSON.stringify(after.conversion);
}

/** Only an observed public-brand projection; no whole brand object crosses the boundary. */
export function studioPublicBrand(tenantId: string, raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const key of ["product_name", "primary_color", "accent_color", "font", "logo_url", "logo_dark_url", "tagline"]) {
    if (Object.prototype.hasOwnProperty.call(row, key)) values[key] = row[key];
  }
  return { tenantId, target: { kind: "workspace" }, readStatus: "available", values };
}

/** Neutral structure is not a business-brand claim; project edits take precedence. */
export function buildStudioLandingTheme(context: StudioBusinessContext, rawValues: unknown = context.projectValues) {
  const raw = rawValues && typeof rawValues === "object" && !Array.isArray(rawValues) ? rawValues as Record<string, unknown> : {};
  const observed = new Map(context.target?.kind === "workspace" && context.status === "available" ? context.brandFacts.map((fact) => [fact.key, fact.value]) : []);
  const value = (key: StudioEditableContextField) => {
    const entered = context.projectValues[key];
    if (Object.prototype.hasOwnProperty.call(raw, key)) return typeof raw[key] === "string" && entered === (raw[key] as string).trim() ? entered : undefined;
    return entered ?? observed.get(key);
  };
  return { primary: value("primaryColor") || "#202024", accent: value("accentColor") || "#202024", font: value("font") || null, logo_url: value("logoUrl") || null, background: "#ffffff", text: "#202024" };
}

type DraftBlocks = { ok: true; blocks: GrowthBlock[] } | { ok: false; code: "NO_VALID_BLOCKS" | "MISSING_STUDIO_OPENING" | "INVALID_STUDIO_CONVERSION"; message: string };
/** Keep genuine validated sections; never synthesize a hero, form or model-selected CTA. */
export function normalizeStudioLandingBlocks(candidates: unknown, originalConversion: NexusLandingTemplateRecipe["conversion"] = null, actualSavedSource?: unknown): DraftBlocks {
  const saved = actualSavedSource === undefined ? undefined : actualSavedSource === null ? null : savedConversionBlock(actualSavedSource);
  if (actualSavedSource !== undefined && actualSavedSource !== null && !saved) return { ok: false, code: "INVALID_STUDIO_CONVERSION", message: "The saved page conversion is unavailable. Reopen the page before refining it." };
  const blocks: GrowthBlock[] = [];
  for (const candidate of (Array.isArray(candidates) ? candidates : []).slice(0, 12)) {
    const clean = validateBlock(candidate) as GrowthBlock | null;
    if (!clean || clean.type === "embedded_form" || clean.type === "conversion" || clean.type === "cta") continue;
    const block = { ...clean } as GrowthBlock & { cta_label?: string; cta_href?: string };
    delete block.cta_label; delete block.cta_href;
    if (block.type === "pricing") block.tiers = block.tiers.map((tier) => {
      const result = { ...tier }; delete result.cta_label; delete result.cta_href; return result;
    });
    // Rich text remains supported, but cannot bypass the selected conversion
    // boundary with a model-invented link or interactive markup.
    if (block.type === "rich_text" && /<\s*(?:a|form|iframe|button|input|select|textarea|script|object|embed)\b|\bhref\s*=/i.test(block.html)) continue;
    blocks.push(block);
  }
  if (!blocks.length) return { ok: false, code: "NO_VALID_BLOCKS", message: "The draft did not contain a usable section. Try the same request again." };
  const hero = blocks.findIndex((block) => block.type === "hero" || block.type === "hero_scene");
  if (hero < 0) return { ok: false, code: "MISSING_STUDIO_OPENING", message: "The draft did not include an opening section. Try the same request again." };
  if (hero > 0) blocks.unshift(...blocks.splice(hero, 1));
  // A protected native null is authoritative absence, including draft[]. It
  // must never fall back to an older recipe or model-selected destination.
  let chosen: GrowthBlock | null | undefined = saved;
  if (saved === undefined && originalConversion && originalConversion.ctaLabel.trim().length > 0 && originalConversion.ctaLabel.trim().length <= 60) chosen = validateBlock({ type: "conversion", label: originalConversion.ctaLabel, destination: originalConversion.destination }) as GrowthBlock | null;
  if (chosen) { if (blocks.length >= 12) blocks.pop(); blocks.push(chosen); }
  return { ok: true, blocks };
}

// A conservative obvious-secret exclusion for the original scoped Knowledge
// reader. This is not complete DLP or permission to read Vault/source metadata.
// eslint-disable-next-line no-control-regex -- exclude hidden controls from quoted source material
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SENSITIVE = /(?:secret|token|password|passwd|credential|cookie|authorization|api[_ -]?key|private[_ -]?key|refresh)\s*(?::|=|\bis\b)\s*\S{4,}|\b(?:sk-|sk_live_|pk_live_|ghp_|github_pat_|xox[baprs]-)[a-z0-9_-]{16,}\b|\bBearer\s+\S{16,}|\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
export function safeStudioKnowledgeChunks(workspaceTarget: boolean, raw: unknown): { content: string; similarity: number; title?: string; studioOrigin?: boolean }[] {
  if (!workspaceTarget || !Array.isArray(raw)) return [];
  return raw.slice(0, 5).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.content !== "string" || !row.content.trim() || row.content.length > 4000 || CONTROL.test(row.content) || SENSITIVE.test(row.content) || typeof row.similarity !== "number" || !Number.isFinite(row.similarity)) return [];
    if (row.title !== undefined && (typeof row.title !== "string" || row.title.length > 200 || CONTROL.test(row.title) || SENSITIVE.test(row.title))) return [];
    return [{ content: row.content, similarity: row.similarity, ...(typeof row.title === "string" ? { title: row.title } : {}), ...(row.studioOrigin === true ? { studioOrigin: true } : {}) }];
  });
}
