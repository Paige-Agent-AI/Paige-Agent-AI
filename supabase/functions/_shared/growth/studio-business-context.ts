/**
 * A pure, deliberately small projection for Studio's editable context summary.
 * Callers must obtain current data through the original authorized readers and
 * discard late reads on actor/workspace change. Matching an envelope here checks
 * data shape and partition only; it does not authorize a read, client access,
 * generation, publication, or a claim that the source is still current.
 *
 * Never pass a raw Setup/Knowledge/Vault response on to the model or public page.
 * The output keeps copy candidates, private design guidance, observed public
 * branding and explicit project choices separate. Publication still uses the
 * original page review and governed publish door.
 */

export const STUDIO_COPY_FIELDS = Object.freeze([
  "publicName", "dbaName", "offers", "idealCustomer", "customerSegments", "serviceArea",
] as const);
export const STUDIO_GUIDANCE_FIELDS = Object.freeze(["brandVoice", "doNotAssume"] as const);
export const STUDIO_BRAND_FIELDS = Object.freeze([
  "productName", "primaryColor", "accentColor", "font", "logoUrl", "logoDarkUrl", "tagline",
] as const);

export type StudioCopyField = (typeof STUDIO_COPY_FIELDS)[number];
export type StudioGuidanceField = (typeof STUDIO_GUIDANCE_FIELDS)[number];
export type StudioBrandField = (typeof STUDIO_BRAND_FIELDS)[number];
export type StudioBusinessField = StudioCopyField | StudioGuidanceField;
export type StudioEditableContextField = StudioBusinessField | StudioBrandField;
export type StudioContextReadStatus = "available" | "loading" | "unavailable" | "conflict";
export type StudioContextTarget =
  | { kind: "workspace" }
  | { kind: "client" | "prospect" | "custom"; reference: string; label?: string };
/** Expected identity revision only. Native callers independently prove access/currentness. */
export type StudioBusinessSource = { id: string; updated_at: string };

export type StudioContextFact = {
  key: StudioEditableContextField;
  label: string;
  value: string;
  source: {
    kind: "setup" | "target_context" | "public_brand";
    field: string;
    confidence: "confirmed" | "observed";
    revision?: number;
    confirmedAt?: string;
    observedAt?: string;
  };
};

export type StudioContextIssue = {
  code: "unconfirmed" | "invalid_value" | "sensitive_value" | "brand_unavailable" | "brand_scope_mismatch";
  source: "setup" | "target_context" | "public_brand" | "project";
  field?: StudioEditableContextField;
};

export type StudioBusinessContextInput = {
  expectedTenantId: unknown;
  target: unknown;
  readStatus: StudioContextReadStatus;
  context: unknown;
  /** When supplied, this is the selected source's current revision, not a guess. */
  expectedRevision?: unknown;
  /** A current public-brand reader projection, not raw private brand/Vault data:
   * { tenantId, target, readStatus, values, observedAt? }. `values` uses the
   * existing public row's product_name/primary_color/accent_color/font/logo_url/
   * logo_dark_url/tagline keys. No owner confirmation is invented for it. */
  publicBrand?: unknown;
  /** Only populate after a separate original reader verified access to this
   * exact target: { callerVerified:true, target, readStatus, context,
   * publicBrand? }. The tag is the caller's assertion, never permission proof
   * and must not be taken from a model or browser-supplied authorization claim. */
  targetContext?: unknown;
  /** Explicit values for this project only; never merged into saved defaults. */
  projectValues?: unknown;
};

export type StudioBusinessContext = {
  status: "available" | "unavailable" | "conflict";
  reason: "invalid_target" | "target_unverified" | "read_pending" | "read_unavailable" | "invalid_context" | "scope_mismatch" | "invalid_revision" | "revision_changed" | "source_conflict" | null;
  target: StudioContextTarget | null;
  source: { kind: "setup" | "target_context"; tenantId: string; revision: number } | null;
  copyFacts: StudioContextFact[];
  privateGuidance: StudioContextFact[];
  brandFacts: StudioContextFact[];
  missingFields: StudioBusinessField[];
  issues: StudioContextIssue[];
  projectValues: Partial<Record<StudioEditableContextField, string>>;
};

const LABELS: Record<StudioEditableContextField, string> = {
  publicName: "Public business name", dbaName: "Doing business as", offers: "Offers and services",
  idealCustomer: "Ideal customer", customerSegments: "Customer segments", serviceArea: "Service area",
  brandVoice: "Brand voice", doNotAssume: "Do not assume", productName: "Product or portal name",
  primaryColor: "Primary color", accentColor: "Accent color", font: "Typeface",
  logoUrl: "Logo", logoDarkUrl: "Logo for dark backgrounds", tagline: "Tagline",
};
const BRAND_KEYS: Record<StudioBrandField, string> = {
  productName: "product_name", primaryColor: "primary_color", accentColor: "accent_color", font: "font",
  logoUrl: "logo_url", logoDarkUrl: "logo_dark_url", tagline: "tagline",
};
const BUSINESS_FIELDS = [...STUDIO_COPY_FIELDS, ...STUDIO_GUIDANCE_FIELDS];
const EDITABLE_FIELDS = [...BUSINESS_FIELDS, ...STUDIO_BRAND_FIELDS];
const RECORD_LIMIT = 4000; // Matches the existing reviewed Setup fact value bound.
// eslint-disable-next-line no-control-regex -- reject control characters in sourced/project fact values
const CONTROL_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Same sensitive key vocabulary as capability-record's existing denylist. It is
// applied only to obvious credential assignments here, not to ordinary prose.
const CREDENTIAL_ASSIGNMENT = /(?:secret|token|password|passwd|credential|cookie|authorization|api[_ -]?key|private[_ -]?key|refresh)\s*(?::|=|\bis\b)\s*\S{4,}/i;
const TOKEN_VALUE = /\b(?:sk-|sk_live_|pk_live_|ghp_|github_pat_|xox[baprs]-)[a-z0-9_-]{16,}\b|\bBearer\s+[a-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i;
const EMAIL_VALUE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const CREDENTIAL_QUERY_KEY = /secret|token|password|passwd|credential|cookie|authorization|api[_-]?key|private[_-]?key|refresh|signature|^sig$|^x-amz-|^x-goog-/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function own(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim() && /^[a-z0-9][a-z0-9._:-]*$/i.test(value);
}
function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function date(value: unknown): string | undefined {
  // Date.parse accepts free-form comments; retaining those could echo private
  // notes under a metadata key. Preserve only an observed ISO timestamp.
  return typeof value === "string" && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : undefined;
}
function sensitive(value: string): boolean {
  return CREDENTIAL_ASSIGNMENT.test(value) || TOKEN_VALUE.test(value) || EMAIL_VALUE.test(value);
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= RECORD_LIMIT && !CONTROL_CHAR.test(value) ? value.trim() : null;
}

function targetOf(value: unknown): StudioContextTarget | null {
  const row = record(value);
  if (!row) return null;
  if (own(row, "kind") === "workspace") return { kind: "workspace" };
  const kind = own(row, "kind");
  const reference = own(row, "reference");
  if ((kind !== "client" && kind !== "prospect" && kind !== "custom") || !identifier(reference)) return null;
  const rawLabel = text(own(row, "label"));
  const label = rawLabel && rawLabel.length <= 200 && !sensitive(rawLabel) ? rawLabel : undefined;
  return { kind, reference, ...(label ? { label } : {}) };
}
function sameTarget(a: StudioContextTarget | null, b: StudioContextTarget): boolean {
  return a?.kind === b.kind && (a.kind === "workspace" || (b.kind !== "workspace" && a.reference === b.reference));
}

/** Value hygiene only. This does not fetch an image or prove public reachability. */
function assetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !host.includes(".")
      || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
      || host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host)
      || /\/storage\/v1\/object\/sign\//i.test(url.pathname)
      || [...url.searchParams.keys()].some((key) => CREDENTIAL_QUERY_KEY.test(key))) return null;
    return url.href;
  } catch { return null; }
}

function fieldValue(field: StudioEditableContextField, value: unknown): { value: string | null; issue: "invalid_value" | "sensitive_value" } {
  const cleaned = text(value);
  if (!cleaned) return { value: null, issue: "invalid_value" };
  if (sensitive(cleaned)) return { value: null, issue: "sensitive_value" };
  if ((field === "primaryColor" || field === "accentColor") && !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(cleaned)) return { value: null, issue: "invalid_value" };
  if (field === "font" && (cleaned.length > 256 || !/^[a-z0-9 ,"'-]+$/i.test(cleaned))) return { value: null, issue: "invalid_value" };
  if (field === "logoUrl" || field === "logoDarkUrl") return { value: assetUrl(cleaned), issue: "invalid_value" };
  return { value: cleaned, issue: "invalid_value" };
}

export function projectStudioBusinessContext(input: StudioBusinessContextInput): StudioBusinessContext {
  const target = targetOf(input.target);
  const issues: StudioContextIssue[] = [];
  const projectValues: StudioBusinessContext["projectValues"] = {};
  const entered = record(input.projectValues);
  if (entered) for (const field of EDITABLE_FIELDS) {
    const raw = own(entered, field);
    if (raw === undefined) continue;
    const cleaned = fieldValue(field, raw);
    if (cleaned.value !== null) projectValues[field] = cleaned.value;
    else issues.push({ code: cleaned.issue, source: "project", field });
  }
  const empty = (status: StudioBusinessContext["status"], reason: StudioBusinessContext["reason"]): StudioBusinessContext => ({
    status, reason, target, source: null, copyFacts: [], privateGuidance: [], brandFacts: [], missingFields: [...BUSINESS_FIELDS], issues, projectValues,
  });
  if (!target) return empty("unavailable", "invalid_target");
  if (!identifier(input.expectedTenantId)) return empty("unavailable", "scope_mismatch");

  let selectedContext = input.context;
  let readStatus: unknown = input.readStatus;
  let selectedBrand = input.publicBrand;
  let sourceKind: "setup" | "target_context" = "setup";
  if (target.kind !== "workspace") {
    const selected = record(input.targetContext);
    if (!selected || own(selected, "callerVerified") !== true || !sameTarget(targetOf(own(selected, "target")), target)) return empty("unavailable", "target_unverified");
    selectedContext = own(selected, "context");
    readStatus = own(selected, "readStatus");
    selectedBrand = own(selected, "publicBrand");
    sourceKind = "target_context";
  }
  if (readStatus === "conflict") return empty("conflict", "source_conflict");
  if (readStatus === "loading") return empty("unavailable", "read_pending");
  if (readStatus !== "available") return empty("unavailable", "read_unavailable");
  const context = record(selectedContext);
  if (!context) return empty("unavailable", "invalid_context");
  if (own(context, "tenantId") !== input.expectedTenantId) return empty("unavailable", "scope_mismatch");
  const currentRevision = own(context, "contextRevision");
  if (!revision(currentRevision) || (input.expectedRevision !== undefined && !revision(input.expectedRevision))) return empty("unavailable", "invalid_revision");
  if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) return empty("conflict", "revision_changed");
  const brief = record(own(context, "brief"));
  if (!brief) return empty("unavailable", "invalid_context");
  const provenance = record(own(brief, "provenance"));
  const copyFacts: StudioContextFact[] = [];
  const privateGuidance: StudioContextFact[] = [];
  for (const field of BUSINESS_FIELDS) {
    const raw = own(brief, field);
    const proof = provenance && record(own(provenance, field));
    if (!proof || own(proof, "source") !== "owner_confirmed" || own(proof, "confidence") !== "confirmed") {
      if (raw !== undefined && raw !== "") issues.push({ code: "unconfirmed", source: sourceKind, field });
      continue;
    }
    const cleaned = fieldValue(field, raw);
    if (cleaned.value === null) { issues.push({ code: cleaned.issue, source: sourceKind, field }); continue; }
    const confirmedAt = date(own(proof, "confirmedAt"));
    const fact: StudioContextFact = { key: field, label: LABELS[field], value: cleaned.value,
      source: { kind: sourceKind, field, revision: currentRevision, confidence: "confirmed", ...(confirmedAt ? { confirmedAt } : {}) } };
    if ((STUDIO_GUIDANCE_FIELDS as readonly string[]).includes(field)) privateGuidance.push(fact);
    else copyFacts.push(fact);
  }

  const brandFacts: StudioContextFact[] = [];
  if (selectedBrand !== undefined && selectedBrand !== null) {
    const brand = record(selectedBrand);
    if (brand && own(brand, "readStatus") === "conflict") return empty("conflict", "source_conflict");
    if (!brand || own(brand, "readStatus") !== "available") issues.push({ code: "brand_unavailable", source: "public_brand" });
    else if (own(brand, "tenantId") !== input.expectedTenantId || !sameTarget(targetOf(own(brand, "target")), target)) issues.push({ code: "brand_scope_mismatch", source: "public_brand" });
    else {
      const values = record(own(brand, "values"));
      const observedAt = date(own(brand, "observedAt"));
      if (!values) issues.push({ code: "brand_unavailable", source: "public_brand" });
      else for (const field of STUDIO_BRAND_FIELDS) {
        const fieldKey = BRAND_KEYS[field];
        const raw = own(values, fieldKey);
        if (raw === undefined || raw === null || raw === "") continue;
        const cleaned = fieldValue(field, raw);
        if (cleaned.value === null) { issues.push({ code: cleaned.issue, source: "public_brand", field }); continue; }
        brandFacts.push({ key: field, label: LABELS[field], value: cleaned.value,
          source: { kind: "public_brand", field: fieldKey, confidence: "observed", ...(observedAt ? { observedAt } : {}) } });
      }
    }
  }
  const present = new Set([...copyFacts, ...privateGuidance].map((fact) => fact.key));
  return { status: "available", reason: null, target, source: { kind: sourceKind, tenantId: input.expectedTenantId, revision: currentRevision },
    copyFacts, privateGuidance, brandFacts, missingFields: BUSINESS_FIELDS.filter((field) => !present.has(field)), issues, projectValues };
}
