// Shared types & helpers for the Growth OS / Vibe Coding Studio (pages, forms, funnels).
//
// This is the ONE type contract every studio surface keys off (WS-A ownership, per the
// build blueprint): the block union, form/questionnaire schema incl. branching logic,
// funnel model, and the data-driven on-submit automation registry. The public renderers,
// the studio preview, the server-side validators, and Paige's tools all conform to these
// shapes — so a block or field type is added here first, in lockstep with the validator
// and the renderer, never in only one place.
import { supabase } from "@/integrations/supabase/client";

// ────────────────────────────────────────────────────────────────────────────
// Forms & questionnaires
// ────────────────────────────────────────────────────────────────────────────

export type GrowthFieldType =
  | "text" | "email" | "tel" | "number" | "date"
  | "textarea" | "select" | "radio" | "checkbox" | "ssn4" | "currency";

/** A choice for select/radio/checkbox fields. A bare string is shorthand for {label,value}. */
export type GrowthFieldOption = string | { label: string; value: string };

/** Normalize a choice to its submitted value / its displayed label. */
export const growthOptionValue = (o: GrowthFieldOption): string => (typeof o === "string" ? o : o.value);
export const growthOptionLabel = (o: GrowthFieldOption): string => (typeof o === "string" ? o : o.label);

export type GrowthConditionOp =
  | "eq" | "neq" | "in" | "not_in" | "gt" | "lt" | "gte" | "lte"
  | "contains" | "answered" | "empty";

/** A single branching condition: "field <op> value". `answered`/`empty` ignore `value`. */
export interface GrowthCondition {
  field: string;               // an EARLIER field key (no forward/dangling references)
  op: GrowthConditionOp;
  value?: string | number | string[];
}

/** Show the field/section only when these conditions hold. `all` = AND, `any` = OR. */
export interface GrowthVisibleWhen {
  all?: GrowthCondition[];
  any?: GrowthCondition[];
}

export interface GrowthFieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;            // JS-safe regex source
}

export interface GrowthField {
  key: string;
  label: string;
  type: GrowthFieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: GrowthFieldOption[];
  default?: string;
  validation?: GrowthFieldValidation;
  /** Conditional visibility — hidden fields are not required and are stripped from the payload. */
  visible_when?: GrowthVisibleWhen;
  /** Optional path a submission writes into when processed.
   *  e.g. "clients.email", "businesses.legal_name", "clients.company". */
  maps_to?: string;
}

export interface GrowthFormSection {
  title: string;
  description?: string;
  fields: GrowthField[];
  /** Conditional visibility for the whole step/section. */
  visible_when?: GrowthVisibleWhen;
}

export interface GrowthFormSchema {
  sections: GrowthFormSection[];
  submit_label?: string;
}

/** What happens right after a visitor submits a form — the "deliverable" the brief promised
 *  actually lands here (§13/§15). `download_url`/`redirect_url` are either a REAL uploaded-asset
 *  URL / a real address the operator typed, or absent — never a placeholder string. Additive to
 *  the shape every published form already carries (`{type,message,redirect_url}`), so an older
 *  page with no `download_url` renders exactly as it always has. */
export interface GrowthSuccessAction {
  type: string;
  message?: string;
  redirect_url?: string;
  /** A real, permanent public URL to a file the tenant uploaded to the growth-assets bucket
   *  (see GrowthAsset below). Never a model-invented or hand-typed string that isn't a real
   *  uploaded asset (§13/§15) — the Studio's delivery editor is the only writer of this field. */
  download_url?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Reference & lead-magnet attachments — real, permanent files a tenant uploads to the
// public-read `growth-assets` Storage bucket (tenant-scoped path `<tenant_id>/<uuid>-<name>`).
// Two uses: (1) multimodal reference material Paige reads while drafting a page, (2) the real
// deliverable behind a lead-magnet form's `download_url` above. One shared shape for both.
// ────────────────────────────────────────────────────────────────────────────

// image/document are the page-draft REFERENCE kinds (Claude reads them multimodally). `video` is
// the Media-Library-only kind (a tenant brings their own footage in) — it is deliberately NOT part
// of GROWTH_ASSET_ACCEPT below, so the page-draft composer never offers it; the media-library caller
// opts into it via uploadGrowthAsset's allowedKinds param.
export type GrowthAssetKind = "image" | "document" | "video";

/** Per-kind hard caps — images/PDF are Claude's real per-file vision/document input limits (§13),
 *  enforced client-side and again server-side in growth-page-draft. Video has no server-side
 *  re-check, so its cap is the true ceiling and is kept EQUAL to the bucket's file_size_limit
 *  (see 20260718040000_media_library_video.sql) so the enforced limit is honest (§13). */
export const GROWTH_ASSET_MAX_BYTES: Record<GrowthAssetKind, number> = {
  image: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

const GROWTH_ASSET_MIME: Record<GrowthAssetKind, string[]> = {
  image: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  document: ["application/pdf"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};

/** `<input accept>` string for the page-draft REFERENCE composer — image + document ONLY.
 *  Video is intentionally excluded here (it is not a page-draft reference kind); the Media
 *  Library uses its own accept string. */
export const GROWTH_ASSET_ACCEPT = [...GROWTH_ASSET_MIME.image, ...GROWTH_ASSET_MIME.document].join(",");

/** `<input accept>` for the Media Library upload — image + video (the tenant's own media). */
export const GROWTH_MEDIA_ACCEPT = [...GROWTH_ASSET_MIME.image, ...GROWTH_ASSET_MIME.video].join(",");

/** Studio brief composer + growth-page-draft both cap attachments at 3 (§13 — a runaway
 *  attachment list is a cost/latency problem, not a feature). */
export const GROWTH_ASSET_MAX_COUNT = 3;

/** Fallback MIME per kind when a file reports none. Video is refined per-extension in
 *  growthUploadContentType (a .mov is QuickTime, not mp4). */
const GROWTH_ASSET_FALLBACK_MIME: Record<GrowthAssetKind, string> = {
  image: "image/png",
  document: "application/pdf",
  video: "video/mp4",
};

/** The contentType to send Storage: the file's own MIME, or a kind+extension-derived fallback when
 *  it's empty/unreliable (common for .mov/.webm) — so Storage never infers application/octet-stream
 *  and rejects the upload against the bucket's allowed_mime_types (§13: a file the UI accepted must
 *  not 400 at Storage). A .mov resolves to video/quicktime, not a mislabeled video/mp4. */
export function growthUploadContentType(kind: GrowthAssetKind, name: string, fileType: string | null | undefined): string {
  if (fileType) return fileType;
  if (kind === "video") {
    if (/\.webm$/i.test(name)) return "video/webm";
    if (/\.mov$/i.test(name)) return "video/quicktime";
    return "video/mp4";
  }
  return GROWTH_ASSET_FALLBACK_MIME[kind];
}

export function detectGrowthAssetKind(mimeType: string | null | undefined, name: string): GrowthAssetKind | null {
  const m = (mimeType || "").toLowerCase();
  if (GROWTH_ASSET_MIME.image.includes(m)) return "image";
  if (GROWTH_ASSET_MIME.document.includes(m)) return "document";
  if (GROWTH_ASSET_MIME.video.includes(m)) return "video";
  // Some browsers/servers report an empty or generic mime — fall back to the extension.
  if (/\.pdf$/i.test(name)) return "document";
  if (/\.(jpe?g|png|webp)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov)$/i.test(name)) return "video";
  return null;
}

/** One uploaded reference/deliverable file, with its REAL permanent public Storage URL. */
export interface GrowthAsset {
  url: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  kind: GrowthAssetKind;
}

// ────────────────────────────────────────────────────────────────────────────
// Landing-page blocks (the 19-type union — kept in lockstep with the server-side
// validator in growth_page_upsert and the shared GrowthBlocks renderer)
// ────────────────────────────────────────────────────────────────────────────

export interface GrowthCtaRef { cta_label?: string; cta_href?: string }

export type GrowthBlock =
  // — original six —
  | { type: "hero"; eyebrow?: string; title: string; subtitle?: string;
      cta_label?: string; cta_href?: string; image_url?: string;
      image_position?: "full" | "split"; quote?: string }
  // Animated brand-toned hero (#240) — same copy fields as hero, but the visual is a
  // motion-safe aurora scene instead of an image (no image_url). For a premium, tech-forward
  // opener when the brief has no hero photo to lean on.
  | { type: "hero_scene"; eyebrow?: string; title: string; subtitle?: string;
      cta_label?: string; cta_href?: string }
  | { type: "phase_cards"; title?: string;
      cards: { phase: string; title: string; body: string; outcome?: string }[] }
  | { type: "feature_grid"; title?: string; items: { title: string; body: string; icon?: string }[] }
  | { type: "cta"; title: string; body?: string; cta_label: string; cta_href: string }
  | { type: "rich_text"; html: string }
  | { type: "embedded_form"; form_slug: string; title?: string }
  // — expansion (Framer/Webflow-class landing surfaces) —
  | { type: "social_proof"; title?: string; logos: { name: string; image_url?: string }[] }
  | { type: "testimonial";
      items: { quote: string; author?: string; role?: string; avatar_url?: string; rating?: number }[] }
  | { type: "pricing"; title?: string;
      tiers: { name: string; price: string; period?: string; features: string[];
               cta_label?: string; cta_href?: string; featured?: boolean }[] }
  | { type: "faq"; title?: string; items: { question: string; answer: string }[] }
  | { type: "media"; provider: "youtube" | "vimeo" | "loom" | "mp4"; url: string;
      title?: string; caption?: string }
  | { type: "stats"; title?: string; items: { value: string; label: string }[] }
  | { type: "countdown"; title?: string; ends_at: string; subtitle?: string; expired_text?: string }
  | { type: "two_column"; heading?: string; body?: string; image_url?: string;
      image_side?: "left" | "right"; cta_label?: string; cta_href?: string }
  | { type: "image"; url: string; alt?: string; caption?: string }
  | { type: "gallery"; title?: string; images: { url: string; alt?: string; caption?: string }[] }
  | { type: "steps"; title?: string; items: { number?: string; title: string; body: string }[] }
  // — the tenant's own Paige, inline on the published site (per-site chatbot). tenant_id is
  //   NOT stored on the block — it's threaded via GrowthBlocks' `tenantId` prop, and the public
  //   endpoint resolves the tenant server-side from the page's public slug (never a stored id). —
  | { type: "chatbot"; title?: string; greeting?: string; placeholder?: string };

export type GrowthBlockType = GrowthBlock["type"];

/** Blocks that carry an outbound/media URL — the generator omits these entirely when it
 *  has no real https URL (never emitted with placeholder tokens), and the server validates
 *  the URL. Kept here so the UI, generator, and validator agree on the set. */
export const URL_BEARING_BLOCKS: readonly GrowthBlockType[] = [
  "media", "image", "gallery",
] as const;

export interface GrowthPageTheme {
  primary?: string;     // hex
  accent?: string;      // hex
  background?: string;  // hex
  text?: string;        // hex
  font?: string;
  logo_url?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Funnels (page → form → booking/payment → thankyou)
// ────────────────────────────────────────────────────────────────────────────

export type GrowthFunnelStepType = "page" | "form" | "payment" | "booking" | "thankyou";

/** Per-step-type extras. The page/form links are real FK columns, not config. */
export type GrowthFunnelStepConfig =
  | { cta_label?: string; advance?: "cta" | "auto" }              // page
  | { prefill_from_session?: boolean }                            // form
  | { provider: "cal" | "calendly" | "internal"; embed_url?: string }  // booking (roadmap)
  | { provider: "stripe"; mode?: "payment" | "subscription"; price_ref?: string } // payment (roadmap)
  | { headline?: string; message?: string; redirect_url?: string }; // thankyou

export interface GrowthFunnelStep {
  id?: string;
  order_index: number;
  step_type: GrowthFunnelStepType;
  page_id?: string | null;
  form_id?: string | null;
  /** Authoring-time slug refs the upsert RPC resolves to page_id/form_id server-side. */
  page_slug?: string;
  form_slug?: string;
  config_json?: GrowthFunnelStepConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// On-submit automation registry (config-as-data: a new target is a new row, not code)
// ────────────────────────────────────────────────────────────────────────────

export type GrowthAutomationExecutor =
  | "contact_upsert"      // create/update the contact from the submission
  | "pipeline_attach"     // drop them on a pipeline stage (opt. create a deal)
  | "paige_action"        // file a Paige follow-up on the action bus
  | "surface_to_client"   // surface a next-step card in the client portal
  | "client_rail_event"   // emit onto the client events rail
  | "n8n_workflow"         // fire a connected workflow
  | "outbound_webhook"    // POST to a connected endpoint
  | "notify_team";        // notify tenant members

export type GrowthAutonomyLane = "auto" | "confirm" | "off";

/** Platform catalog row (no tenant_id, §9) — one per executor branch the processor knows. */
export interface GrowthAutomationTarget {
  slug: string;
  label: string;
  description: string;
  executor: GrowthAutomationExecutor;
  config_schema?: Record<string, unknown>;
  enabled: boolean;
  display_order: number;
}

/** Tenant config row — which targets a form fires, ordered, with per-row config.
 *  config_json holds references only (ids/slugs) — never URLs or secrets. */
export interface GrowthFormAutomation {
  id: string;
  tenant_id: string;
  form_id: string;
  target_slug: string;
  order_index: number;
  enabled: boolean;
  /** Optional OVERRIDE of the action kind's default lane; null = use the kind default. */
  autonomy_lane?: GrowthAutonomyLane | null;
  config_json: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** What a visitor may see of a form: exactly what growth_public_form() returns — never the
 *  business, pipeline, alert address or author. Only an ACTIVE form of a live business is found. */
export interface PublicGrowthForm {
  id: string;
  slug: string;
  name: string;
  schema_json: GrowthFormSchema;
  success_action_json: GrowthSuccessAction;
}

/** Read one public form, by id or by (business, slug). Null when it isn't available. */
export async function loadPublicGrowthForm(
  by: { formId: string } | { tenantId: string; slug: string },
): Promise<PublicGrowthForm | null> {
  const args = "formId" in by
    ? { p_form_id: by.formId }
    : { p_tenant_id: by.tenantId, p_slug: by.slug };
  const { data, error } = await supabase.rpc("growth_public_form" as never, args as never);
  if (error) {
    console.error("growth_public_form failed", error.message);
    return null;
  }
  const rows = data as unknown as PublicGrowthForm[] | null;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export type GrowthSubmitOutcome =
  | { ok: true; submissionId: string }
  | { ok: false; reason: "invalid"; missing: string[]; invalid: string[] }
  | { ok: false; reason: "rate_limited" | "unavailable" | "failed" };

/** Every real form waits at least this long before sending, so a person who fills a one-field
 *  form in an instant is never mistaken for a bot (the server drops faster submissions). */
const MIN_ELAPSED_MS = 1600;

/** Send a visitor's answers through growth-public-submit — the one way a submission is saved.
 *  The server derives the business from the form, keeps only the form's own fields, and applies
 *  the bot trap and rate limits; `trap` is the hidden field's value and `startedAt` when the form
 *  was shown. Success means a submission id came back — nothing less. */
export async function submitGrowthForm(opts: {
  formId: string;
  answers: Record<string, unknown>;
  utm?: Record<string, string>;
  trap: string;
  startedAt: number;
}): Promise<GrowthSubmitOutcome> {
  const wait = MIN_ELAPSED_MS - (Date.now() - opts.startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const { data, error } = await supabase.functions.invoke("growth-public-submit", {
    body: {
      form_id: opts.formId,
      answers: opts.answers,
      utm: opts.utm ?? {},
      hp: opts.trap,
      elapsed_ms: Date.now() - opts.startedAt,
    },
  });
  if (error) {
    // A non-2xx carries the endpoint's own JSON in error.context (a one-shot Response).
    let status = 0;
    let body: { error?: string; missing_required?: string[]; invalid?: string[] } = {};
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      status = ctx.status;
      try { body = await ctx.json(); } catch { /* not JSON */ }
    }
    if (status === 422 && body.error === "invalid_answers") {
      return { ok: false, reason: "invalid", missing: body.missing_required ?? [], invalid: body.invalid ?? [] };
    }
    if (status === 429) return { ok: false, reason: "rate_limited" };
    if (status === 404) return { ok: false, reason: "unavailable" };
    console.error("growth-public-submit failed", status, body.error ?? error.message);
    return { ok: false, reason: "failed" };
  }
  const id = (data as { submission_id?: unknown } | null)?.submission_id;
  if (typeof id === "string" && id) return { ok: true, submissionId: id };
  console.error("growth-public-submit returned no submission id");
  return { ok: false, reason: "failed" };
}

export function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ref","gclid","fbclid"].forEach((k) => {
    const v = p.get(k);
    if (v) out[k] = v;
  });
  return out;
}
