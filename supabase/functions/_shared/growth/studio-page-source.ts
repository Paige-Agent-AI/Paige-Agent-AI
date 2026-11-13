import { NEXUS_LANDING_TEMPLATE_ID } from "./nexus-landing-template.ts";
import { STUDIO_BRAND_FIELDS, STUDIO_COPY_FIELDS, STUDIO_GUIDANCE_FIELDS, projectStudioBusinessContext, type StudioBusinessSource, type StudioEditableContextField } from "./studio-business-context.ts";
import { parseStudioPageConversionRead, type StudioSavedConversionBlock } from "./studio-landing-draft.ts";

export type StudioPageArtifactRef = {
  kind: "page" | "form" | "funnel" | "content";
  id: string;
  title: string;
  slug?: string | null;
  thumbnail_url?: string | null;
  added_at?: string;
};
export type StudioPageProjectContext = {
  target: { kind: "workspace"; label?: string } | { kind: "client" | "prospect" | "custom"; reference: string; label?: string };
  values?: Partial<Record<StudioEditableContextField, string>>;
  template_id?: typeof NEXUS_LANDING_TEMPLATE_ID;
  business_source?: StudioBusinessSource;
  business_name?: string;
};
/** Exact native JSON data for the original writer's source comparison. Never model input or authority. */
export type StudioPageSaveSource = {
  ok: true;
  tenant_id: string;
  session_id: string;
  artifact_refs: StudioPageArtifactRef[];
  project_context: StudioPageProjectContext;
  page_id: string | null;
  updated_at: string | null;
  conversion: StudioSavedConversionBlock | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- source data must not carry hidden controls
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FIELDS: readonly string[] = [...STUDIO_COPY_FIELDS, ...STUDIO_GUIDANCE_FIELDS, ...STUDIO_BRAND_FIELDS];
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const own = (value: Record<string, unknown>, key: string): unknown => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const sameId = (a: unknown, b: unknown): boolean => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
const boundedText = (value: unknown, limit = 4000): value is string => typeof value === "string" && value.length <= limit && !CONTROL.test(value);
function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  // Native JSON has data properties only. Do not execute getters on caller objects.
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable && "value" in Object.getOwnPropertyDescriptor(value, key)!) ? value as Record<string, unknown> : null;
}
function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, y, m, d, h, min, sec, , zh, zm] = parts;
  const year = Number(y); const month = Number(m); const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59 && (zh === undefined || (Number(zh) <= 23 && Number(zm) <= 59));
}
function validManifest(raw: unknown): raw is StudioPageArtifactRef[] {
  if (!Array.isArray(raw) || raw.length > 128) return false;
  const seen = new Set<string>();
  return raw.every((value) => {
    const item = record(value);
    if (!item || !keys(item, ["kind", "id", "title", "slug", "thumbnail_url", "added_at"]) || typeof own(item, "kind") !== "string" || !["page", "form", "funnel", "content"].includes(item.kind as string) || !uuid(own(item, "id")) || !boundedText(own(item, "title"))) return false;
    for (const key of ["slug", "thumbnail_url"]) {
      if (Object.prototype.hasOwnProperty.call(item, key) && own(item, key) !== null && !boundedText(own(item, key))) return false;
    }
    if (Object.prototype.hasOwnProperty.call(item, "added_at") && !isoTimestamp(own(item, "added_at"))) return false;
    const identity = `${item.kind}:${String(item.id).toLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
function validProjectContext(raw: unknown, tenantId: string): raw is StudioPageProjectContext {
  const context = record(raw);
  if (!context || !keys(context, ["target", "values", "template_id", "business_source", "business_name"])) return false;
  const target = record(own(context, "target"));
  if (!target || !keys(target, ["kind", "reference", "label"])) return false;
  const kind = own(target, "kind");
  if (typeof kind !== "string" || !["workspace", "client", "prospect", "custom"].includes(kind)) return false;
  if (kind === "workspace") { if (Object.prototype.hasOwnProperty.call(target, "reference")) return false; }
  else if (typeof own(target, "reference") !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(target.reference))) return false;
  if (Object.prototype.hasOwnProperty.call(target, "label") && (!boundedText(target.label, 200) || !target.label.trim() || /[\r\n\t]/.test(target.label))) return false;
  if (Object.prototype.hasOwnProperty.call(context, "business_source")) {
    const business = record(context.business_source);
    if ((kind !== "client" && kind !== "prospect") || !business || !keys(business, ["id", "updated_at"])
      || !sameId(business.id, target.reference) || !isoTimestamp(business.updated_at)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(context, "business_name") && (!Object.prototype.hasOwnProperty.call(context, "business_source")
    || !boundedText(context.business_name) || !context.business_name.trim())) return false;
  if (Object.prototype.hasOwnProperty.call(context, "template_id") && context.template_id !== NEXUS_LANDING_TEMPLATE_ID) return false;
  if (Object.prototype.hasOwnProperty.call(context, "values")) {
    const values = record(context.values);
    if (!values || !keys(values, FIELDS)) return false;
    const projected = projectStudioBusinessContext({ expectedTenantId: tenantId, target, readStatus: "unavailable", context: null, projectValues: values }).projectValues;
    for (const [key, value] of Object.entries(values)) {
      if (!boundedText(value) || (value.trim() && projected[key as StudioEditableContextField] !== value.trim())) return false;
      // Preserve explicit blanks, but honor the native color/logo formats.
      if ((key === "primaryColor" || key === "accentColor") && value !== "" && !/^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(value)) return false;
      if ((key === "logoUrl" || key === "logoDarkUrl") && value !== "" && !value.trim()) return false;
    }
  }
  return new TextEncoder().encode(JSON.stringify(context)).length <= 32768;
}

/**
 * Shape/partition admission for the original JWT-native getter, not access proof.
 * Unknown or malformed source data is refused, never repaired. Explicit blanks,
 * nullable source values and manifest order remain exact for native atomic CAS.
 */
export function parseStudioPageSaveSource(expectedTenant: unknown, sessionId: unknown, expectedPageId: unknown, raw: unknown): StudioPageSaveSource | null {
  if (!uuid(expectedTenant) || !uuid(sessionId) || (expectedPageId !== null && !uuid(expectedPageId))) return null;
  const row = record(raw);
  if (!row || !keys(row, ["ok", "tenant_id", "session_id", "artifact_refs", "project_context", "page_id", "updated_at", "conversion"]) || own(row, "ok") !== true || !sameId(own(row, "tenant_id"), expectedTenant) || !sameId(own(row, "session_id"), sessionId) || !validManifest(own(row, "artifact_refs")) || !validProjectContext(own(row, "project_context"), expectedTenant)) return null;
  if (expectedPageId === null) {
    if (own(row, "page_id") !== null || own(row, "updated_at") !== null || own(row, "conversion") !== null) return null;
  } else {
    if (!sameId(own(row, "page_id"), expectedPageId) || !isoTimestamp(own(row, "updated_at")) || !(row.artifact_refs as StudioPageArtifactRef[]).some((ref) => ref.kind === "page" && sameId(ref.id, expectedPageId))) return null;
    if (own(row, "conversion") !== null) {
      const block = record(own(row, "conversion"));
      if (!block || Object.values(block).some((value) => value === undefined)) return null;
      if (own(block, "type") === "conversion") {
        const destination = record(own(block, "destination"));
        if (!destination || Object.values(destination).some((value) => value === undefined)) return null;
      }
    }
    // Reuse the canonical saved-conversion admission. Keep exact admitted raw
    // JSON, including legacy cosmetic title, for CAS rather than its clean copy.
    const conversion = parseStudioPageConversionRead(expectedPageId, { ok: true, page_id: row.page_id, updated_at: row.updated_at, conversion: own(row, "conversion") });
    if (conversion.ok === false) return null;
  }
  return JSON.parse(JSON.stringify(row)) as StudioPageSaveSource;
}

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equalJson(value, b[index]));
  const left = record(a); const right = record(b);
  return !!left && !!right && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.prototype.hasOwnProperty.call(right, key) && equalJson(left[key], right[key]));
}
/** Detection before generation returns; the original native writer must still atomically CAS at save. */
export function sameStudioPageSaveSource(before: StudioPageSaveSource, after: StudioPageSaveSource): boolean {
  return equalJson(before, after);
}
