// THE CALLABLE SEAM LAYER (§10).
//
// Every action the Vibe Studio can take lives here as a plain async function with explicit
// arguments: generate, save, publish, edit, load, preflight. No React, no hooks, no component
// state. The UI is ONE caller; Paige's headless tools are another; a test is a third. They all
// bottom out in the same edge functions and the same RPCs, so a page Paige builds from chat and
// a page an operator builds by clicking travel the identical path. There is no second
// implementation to drift.
//
// This is also the ONLY file under src/components/admin/studio/ that touches Supabase. The five
// components are pure presentation — that is what makes the seam real rather than aspirational.
//
// Three invariants are load-bearing, and each one is a silent catastrophe if broken:
//
//   1. loadBrandFloor() reproduces GrowthPageRenderer's brand-floor construction EXACTLY —
//      including the non-obvious line where `background` derives from primary_color. Get that
//      wrong and the canvas lies about what will publish, with no test to catch it.
//   2. Nothing here publishes. Going live is one governed act, run only by the publish door
//      (growth-publish-command), which the Studio panel and Paige's chat both call. A direct
//      `update … set status='published'` would skip every guard AND never copy draft → live.
//   3. A page is SAVED before it is published. The save is what auto-authors the form behind
//      the signup section, which is what makes publish's lead-capture guard pass.
import { supabase } from "@/integrations/supabase/client";
import { knowledgeIngestOutcome } from "@/lib/knowledge/ingest-outcome";
import type { GrowthAsset, GrowthAssetKind, GrowthBlock, GrowthField, GrowthFormSchema, GrowthPageTheme, GrowthSuccessAction } from "@/lib/growth";
import { detectGrowthAssetKind, growthUploadContentType, GROWTH_ASSET_MAX_BYTES } from "@/lib/growth";
import { GROWTH_BRAND_FLOOR, buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import { CLARIFYING_QUESTIONS, STUDIO_ERROR_COPY, briefFromKbDoc, kbChipLabel } from "./studio-copy";
import type {
  ArtifactVersion,
  IntentChip,
  LibraryItem,
  LibraryKind,
  SessionArtifactKind,
  SessionArtifactRef,
  StudioArtifactType,
  StudioDocBlock,
  StudioDocType,
  StudioDocument,
  StudioError,
  StudioErrorCode,
  StudioSeoDraft,
  StudioSessionCard,
  StudioSessionMeta,
  StudioSessionStatus,
  StudioSessionView,
} from "./studio-types";

import { parseStudioDocument } from "./studio-document";
export { parseStudioDocument };

// StudioShell and useGeneratePage read the error map through the seam, so a caller only ever
// needs one import to drive an action and speak about its failure.
export { STUDIO_ERROR_COPY };

// The session types are the seam's contract too — re-exported so a caller imports the function
// and the shape it returns from ONE place (the same convenience the growth types get).
export type {
  SessionArtifactKind,
  SessionArtifactRef,
  StudioArtifactType,
  StudioDocBlock,
  StudioDocType,
  StudioDocument,
  StudioSessionCard,
  StudioSessionMeta,
  StudioSessionStatus,
  StudioSessionView,
} from "./studio-types";

// ═══════════════════════════════════════════════════════════════════════════════════════
// Errors — structured, honest, and safe to show (§11/§13)
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Codes that are a hard stop for the operator right here: nothing to retry, nothing to fix
 *  inside this surface. Everything else offers a way forward. */
const HARD_STOP: ReadonlySet<StudioErrorCode> = new Set<StudioErrorCode>([
  "NO_TENANT",
  "NO_TENANT_SLUG",
  "NOT_FOUND",
  "FORBIDDEN",
]);

export function studioError(
  code: StudioErrorCode,
  cause?: unknown,
  message?: string,
): StudioError {
  return {
    code,
    message: message || STUDIO_ERROR_COPY[code],
    recoverable: !HARD_STOP.has(code),
    cause,
  };
}

export function isStudioError(err: unknown): err is StudioError {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err &&
    "recoverable" in err &&
    typeof (err as StudioError).message === "string"
  );
}

/** The server's own raise codes, mapped to operator-facing outcomes. Postgres delivers them as
 *  "GROWTH_NO_DRAFT: nothing to publish — save draft blocks first"; only the CODE survives the
 *  crossing, and the copy the operator reads is ours. */
const SEAM_CODES: Record<string, StudioErrorCode> = {
  GROWTH_FORBIDDEN: "FORBIDDEN",
  GROWTH_NO_TENANT: "NO_TENANT",
  GROWTH_NO_TENANT_SLUG: "NO_TENANT_SLUG",
  GROWTH_INVALID_SLUG: "INVALID_SLUG",
  GROWTH_INVALID_BLOCKS: "INVALID_BLOCKS",
  GROWTH_INVALID_OPS: "EDIT_FAILED",
  GROWTH_NOT_FOUND: "NOT_FOUND",
  GROWTH_NO_DRAFT: "NO_DRAFT",
  GROWTH_UNRESOLVED_PLACEHOLDER: "UNRESOLVED_PLACEHOLDER",
  GROWTH_FORM_MISSING: "FORM_MISSING",
  GROWTH_TENANT_MISMATCH: "NOT_FOUND",
  // Studio sessions seam (Slice 2). The studio_sessions RPCs raise STUDIO_* codes that map onto
  // the SAME operator-facing outcomes — so a session mutation fails as safely as a page one.
  STUDIO_FORBIDDEN: "FORBIDDEN",
  STUDIO_NO_TENANT: "NO_TENANT",
  STUDIO_NOT_FOUND: "NOT_FOUND",
  STUDIO_ARTIFACT_NOT_FOUND: "NOT_FOUND",
  STUDIO_INVALID_TITLE: "SAVE_FAILED",
  STUDIO_INVALID_STATUS: "SAVE_FAILED",
  STUDIO_INVALID_KIND: "SAVE_FAILED",
  STUDIO_INVALID_TRANSCRIPT: "SAVE_FAILED",
};

function errText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * A message is only shown verbatim when it is genuinely operator-safe. The edge functions
 * write real, useful sentences ("Admin access required.") and those beat any generic
 * we could invent — but a Postgres raise, a Rollup stack, or a driver string carries machinery
 * the operator must never read (§11). When in doubt, the mapped copy wins; the raw cause is
 * always preserved on the StudioError and logged.
 */
const JARGON =
  /GROWTH_[A-Z_]+|STUDIO_[A-Z_]+|growth_[a-z_]+|studio_[a-z_]+|supabase|postgrest|pgrst|jsonb|\bRPC\b|\bSQL\b|search_path|auth\.uid|null value|violates|constraint|relation "|function .*\(/i;

function operatorSafe(message: string): string | null {
  const m = message.trim();
  if (!m || m.length > 220 || JARGON.test(m)) return null;
  return m;
}

/** Turn anything a seam call can throw into the ONE error shape the Studio renders. */
export function toStudioError(err: unknown, fallback: StudioErrorCode): StudioError {
  if (isStudioError(err)) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return studioError("GENERATION_CANCELLED", err);
  }

  const raw = errText(err);
  const match = raw.match(/^\s*((?:GROWTH|STUDIO)_[A-Z_]+)\s*:/);
  const code = match ? SEAM_CODES[match[1]] ?? fallback : fallback;

  // We keep the real cause — swallowing it would make a production defect undiagnosable (§13).
  if (raw) console.error(`[studio] ${code}:`, err);

  // Only a message the server wrote FOR a human is echoed; a server raise never is.
  const safe = match ? null : operatorSafe(raw);
  return studioError(code, err, safe ?? undefined);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Plumbing
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Platform staff carry no active tenant (§9). Generating, saving, or publishing without one
 *  would write a tenant's page into an arbitrary workspace — so we refuse, loudly, first. */
function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) throw studioError("NO_TENANT");
  return tenantId;
}

/**
 * The growth authoring RPCs are SECURITY DEFINER functions introduced after the last refresh
 * of the generated `Database` types, so they are not in `Database["public"]["Functions"]` yet.
 * One narrow, documented cast lives here rather than an `as any` scattered across five call
 * sites; every caller below stays fully typed against its own declared result.
 */
type UntypedRpc = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

async function rpc<T>(fn: string, params: Record<string, unknown>, fallback: StudioErrorCode): Promise<T> {
  // Call on `supabase` directly (or bind) — do NOT detach the method into a bare `const`, or it
  // loses its `this` and throws before the request is ever sent (which surfaced as every session
  // read/write failing with the generic "try again" fallback).
  const call = supabase.rpc.bind(supabase) as unknown as UntypedRpc;
  const { data, error } = await call(fn, params);
  if (error) throw toStudioError(error, fallback);
  return data as T;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** The edge functions require the caller's own bearer token — they role-gate on it, and the
 *  draft function refuses outright without one. */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw studioError("FORBIDDEN", "no session", "Your session ended. Sign in again to keep building.");
  }
  return {
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    "Content-Type": "application/json",
  };
}

/** Both growth edge functions can answer with `{ error }` — and growth-page-draft does it at
 *  HTTP **200** on an internal failure. So the BODY is inspected before the status, always. A
 *  status-first read would paint a model outage onto the canvas as a successful, empty page. */
function readFnError(body: unknown): { code?: string; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  if (!e) return null;
  if (typeof e === "string") return { message: e };
  if (typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    return {
      code: typeof o.code === "string" ? o.code : undefined,
      message: typeof o.message === "string" ? o.message : "",
    };
  }
  return { message: "" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Theme — the canvas == published keystone
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Strip null / undefined / "" out of a theme, ONCE, before it is either previewed or saved.
 *
 * resolveGrowthTheme layers `{ ...FLOOR, ...brandFloor, ...theme }`. A JavaScript spread does
 * NOT skip nulls — so an explicit `font: null` in theme_json overwrites the tenant's brand font
 * with nothing. The generator emits `font: null` / `logo_url: null` for every tenant that hasn't
 * set them, which is most of them. Normalizing here, at the seam, means the object the operator
 * previews and the object we persist are the SAME object, and the page cannot change appearance
 * between the canvas and the publish.
 */
export function normalizeGrowthTheme(theme: GrowthPageTheme | null | undefined): GrowthPageTheme {
  const out: GrowthPageTheme = {};
  if (!theme || typeof theme !== "object") return out;
  for (const [key, value] of Object.entries(theme)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The anon-safe brand row, exactly as rpc peek_tenant_portal_brand returns it. */
export interface PortalBrandRow {
  primary_color: string | null;
  accent_color: string | null;
  font: string | null;
  logo_url: string | null;
}

/**
 * THE brand floor — re-exported from the ONE definition in growth-theme.ts, which the published
 * page and the funnel step also use. Do not re-derive it here: the moment the Studio builds its
 * own floor, the canvas stops matching what publishes and nothing catches it.
 */
export { buildGrowthBrandFloor };

/**
 * Resolve the tenant's brand floor through the SAME RPC the published page uses —
 * peek_tenant_portal_brand(_slug), keyed by slug, granted to anon. NOT resolve_tenant_brand:
 * the two differ in their logo COALESCE, and a Studio that resolved the brand differently from
 * the renderer would be a preview of a page that doesn't exist.
 *
 * A brand miss is NOT a failure. The floor IS the fallback, and it is on-brand — so this never
 * rejects and never blocks the canvas.
 */
export async function loadBrandFloor(tenantSlug: string): Promise<GrowthPageTheme> {
  if (!tenantSlug) return buildGrowthBrandFloor(null);
  try {
    const call = supabase.rpc.bind(supabase) as unknown as UntypedRpc;
    const { data, error } = await call("peek_tenant_portal_brand", { _slug: tenantSlug });
    if (error) throw error;
    const row = Array.isArray(data)
      ? (data[0] as PortalBrandRow | undefined)
      : (data as PortalBrandRow | null);
    return buildGrowthBrandFloor(row ?? null);
  } catch (err) {
    console.error("[studio] brand floor fell through to the default:", err);
    return buildGrowthBrandFloor(null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// The clarifying gate (§15) — probe before Paige builds, never guess a placeholder-riddled
// draft. Deterministic text heuristics only: word count + a signal regex, NOT an LLM job
// (§7) — this never touches JobKind or the model router at all.
// ═══════════════════════════════════════════════════════════════════════════════════════

const THIN_BRIEF_WORDS = 30;

/** Loose signal that the operator wants a REAL questionnaire, not the generic name/email
 *  default — matched as prose, since a brief is a sentence, not a keyword field. */
export const FORM_SIGNAL_RE = /\b(questionnaire|survey|intake form|application (?:form|process)|qualify|screen(?:ing)?)\b/i;

export interface ClarifyDecision {
  needed: boolean;
  /** Whether the brief itself asked for a real questionnaire — gates the 4th question. */
  formSignal: boolean;
}

/** Whole-page briefs only — a section instruction never gates. */
export function shouldClarify(brief: string): ClarifyDecision {
  const trimmed = (brief ?? "").trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const formSignal = FORM_SIGNAL_RE.test(trimmed);
  return { needed: wordCount < THIN_BRIEF_WORDS || formSignal, formSignal };
}

/**
 * Fold the offer/audience/action answers into the brief as prose. The questionnaire-fields
 * answer is deliberately NOT folded in here — it travels separately as `questionnaireAnswer`
 * so the model reads it once, in its own turn (§4).
 *
 * An empty `answers` map — the gate was skipped, or a fresh page has never populated it —
 * returns `brief` UNCHANGED: the exact string `generate({ brief })` received before this
 * feature existed. Zero behavior change on the happy path for an already-good brief.
 */
const CLARIFYING_FOLD_LABEL: Record<string, string> = {
  offer: "Offer & result",
  audience: "Audience",
  action: "Action",
};

export function composeBrief(brief: string, answers: Record<string, string>): string {
  const extra = CLARIFYING_QUESTIONS.map((q) => {
    const answer = (answers[q.id] ?? "").trim();
    if (!answer) return "";
    const label = CLARIFYING_FOLD_LABEL[q.id];
    return label ? `${label}: ${answer}` : answer;
  }).filter(Boolean);
  return extra.length > 0 ? `${brief.trim()}\n\n${extra.join("\n")}` : brief;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Reference & lead-magnet attachments — Storage upload seam (§10/§13).
//
// This stays the ONLY file under src/components/admin/studio/ that touches Supabase (see
// header) — so the upload itself lives here rather than in a bespoke hook, even though it is
// conceptually closer to useBrandKit's uploadAsset than to the rest of the seam layer above.
// Real, permanent public URLs — never ephemeral — because a download_url built from one has to
// keep working long after the Studio tab that generated it is closed (§13).
// ═══════════════════════════════════════════════════════════════════════════════════════

const GROWTH_ASSETS_BUCKET = "growth-assets";

/** Upload one reference/deliverable file to the tenant-scoped, public-read growth-assets
 *  bucket and return its REAL public URL. Path convention matches every other tenant-scoped
 *  bucket in this codebase: <tenant_id>/<uuid>-<filename>. */
/** Upload one file to the tenant-scoped growth-assets bucket. `allowedKinds` is the runtime gate
 *  (NOT the <input accept>, which drag-drop bypasses): the default ['image','document'] keeps every
 *  existing caller — the page-draft reference composer, DeliveryEditor — unchanged and rejects video;
 *  the Media Library caller passes ['image','video']. */
export async function uploadGrowthAsset(
  tenantId: string,
  file: File,
  allowedKinds: readonly GrowthAssetKind[] = ["image", "document"],
): Promise<GrowthAsset> {
  const tid = requireTenant(tenantId);
  const kind: GrowthAssetKind | null = detectGrowthAssetKind(file.type, file.name);
  if (!kind || !allowedKinds.includes(kind)) {
    // §13: name only the kinds THIS caller actually accepts.
    const label = allowedKinds.includes("video")
      ? "JPG, PNG, WEBP, MP4, WEBM, and MOV files"
      : "JPG, PNG, WEBP, and PDF files";
    throw studioError("SAVE_FAILED", null, `Paige can attach ${label}.`);
  }
  if (file.size > GROWTH_ASSET_MAX_BYTES[kind]) {
    const capMb = GROWTH_ASSET_MAX_BYTES[kind] / (1024 * 1024);
    const noun = kind === "image" ? "images" : kind === "video" ? "videos" : "PDFs";
    throw studioError("SAVE_FAILED", null, `That file is too large — the limit is ${capMb}MB for ${noun}.`);
  }
  const safeName = file.name.replace(/[^\w.-]/g, "_").slice(0, 120);
  const path = `${tid}/${crypto.randomUUID()}-${safeName}`;
  // Send an explicit contentType so Storage never infers application/octet-stream (which the bucket's
  // allowed_mime_types would reject) for a file whose own MIME is empty/unreliable — common for .mov.
  const contentType = growthUploadContentType(kind, file.name, file.type);
  const { error } = await supabase.storage
    .from(GROWTH_ASSETS_BUCKET)
    .upload(path, file, { upsert: false, cacheControl: "3600", contentType });
  if (error) throw toStudioError(error, "SAVE_FAILED");
  const { data } = supabase.storage.from(GROWTH_ASSETS_BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    path,
    name: file.name,
    mimeType: contentType,
    size: file.size,
    kind,
  };
}

/** Upload a captured page-preview thumbnail (a small JPEG blob) to the tenant-scoped
 *  growth-assets bucket and return its public URL — the gallery cover for a page project
 *  (Studio Task #295). Separate from uploadGrowthAsset because this is a machine-made cover,
 *  not an operator upload: no kind/size gate, and ONE stable object per session
 *  (`<tid>/studio-thumbs/<sessionId>.jpg`, `upsert:true`) so a page regenerated N times leaves
 *  exactly one cover, never N orphans (§12 — self-organizing AND self-pruning). A per-capture
 *  cache-bust token on the returned URL defeats the CDN serving a stale copy of the overwritten
 *  object. Best-effort: returns null on failure (§13). */
export async function uploadPageThumbnail(
  tenantId: string,
  sessionId: string,
  blob: Blob,
): Promise<string | null> {
  const tid = requireTenant(tenantId);
  const path = `${tid}/studio-thumbs/${sessionId}.jpg`;
  const { error } = await supabase.storage
    .from(GROWTH_ASSETS_BUCKET)
    .upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
  if (error) {
    console.warn("[studio] page thumbnail upload failed (non-fatal):", error);
    return null;
  }
  const { data } = supabase.storage.from(GROWTH_ASSETS_BUCKET).getPublicUrl(path);
  // Cache-bust: the stable path is overwritten in place, so append a fresh token to force the
  // card (and CDN) to fetch the new cover instead of the previous one.
  return `${data.publicUrl}?v=${crypto.randomUUID().slice(0, 8)}`;
}

/** List everything this tenant has ever uploaded to growth-assets — the picker for the
 *  post-submit delivery editor (§10/§15: pick a REAL uploaded asset, never type a URL). */
export async function listGrowthAssets(tenantId: string): Promise<GrowthAsset[]> {
  const tid = requireTenant(tenantId);
  const { data, error } = await supabase.storage
    .from(GROWTH_ASSETS_BUCKET)
    .list(tid, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw toStudioError(error, "SAVE_FAILED");
  return (data ?? [])
    .filter((f) => !!f.name && f.id) // Storage lists placeholder "folder" rows with id=null
    .map((f) => {
      const path = `${tid}/${f.name}`;
      const { data: pub } = supabase.storage.from(GROWTH_ASSETS_BUCKET).getPublicUrl(path);
      const mimeType = (f.metadata as { mimetype?: string } | null)?.mimetype || "";
      const kind = detectGrowthAssetKind(mimeType, f.name) ?? "document";
      return {
        url: pub.publicUrl,
        path,
        name: f.name.replace(/^[0-9a-f-]{36}-/, ""), // strip the <uuid>- prefix for display
        mimeType,
        size: (f.metadata as { size?: number } | null)?.size ?? 0,
        kind,
      } satisfies GrowthAsset;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Generate — supabase/functions/growth-page-draft
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface DraftPageInput {
  tenantId: string;
  brief: string;
  tone?: string;
  /** The operator's own free-text answer to "what should the questionnaire ask" (§15),
   *  collected by the clarifying step. Sent through untouched — the server derives a real
   *  form_schema_json from it in the SAME model call, no new spend (§7). */
  questionnaireAnswer?: string;
  /** Up to 3 REAL uploaded reference/deliverable files (§13). Sent as public Storage URLs —
   *  never raw base64 — growth-page-draft fetches and base64-encodes them server-side. */
  attachments?: { url: string; mediaType: string; kind: GrowthAssetKind }[];
  signal?: AbortSignal;
  /** Fires as blocks materialize. TODAY: once, with the full validated array — the function
   *  returns a single JSON payload, there is no token stream. If it ever streams, this fires
   *  per block and the UI above changes by ZERO lines. */
  onBlocks?: (blocks: GrowthBlock[]) => void;
  /** Honest phase pings. Each one names real work performed at the moment it fires. */
  onPhase?: (phase: "brief" | "brand" | "drafting" | "validating", note: string) => void;
}

export interface DraftPageResult {
  blocks: GrowthBlock[];
  theme: GrowthPageTheme;
  seo: StudioSeoDraft;
  /** Present ONLY when questionnaireAnswer was supplied and the model's proposal survived
   *  the server's cleanFormSchema() with at least one field. Absent => the save path falls
   *  back to growth_page_upsert's generic 3-field synthesis, unchanged from today. */
  formSchema?: GrowthFormSchema;
  /** Present ONLY when the model judged one SUPPLIED attachment is the brief's promised
   *  deliverable. `assetIndex` always indexes into the SAME `attachments` array this call was
   *  given (validated against it below) — never a fabricated reference (§13/§15). The caller
   *  decides whether/how to write it into a form's success_action_json.download_url; this
   *  function only ever surfaces the suggestion. */
  suggestedDelivery?: { assetIndex: number };
}

interface DraftPageBody {
  blocks?: unknown;
  theme_json?: GrowthPageTheme | null;
  seo_json?: { title?: unknown; description?: unknown } | null;
  form_schema_json?: unknown;
  suggested_delivery?: { type?: unknown; asset_index?: unknown } | null;
}

function isBlockArray(value: unknown): value is GrowthBlock[] {
  return (
    Array.isArray(value) &&
    value.every(
      (b) => !!b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string",
    )
  );
}

/** Shallow shape-check only — same discipline as isBlockArray. The server's cleanFormSchema()
 *  is what guarantees the deep shape; this just refuses to trust something that isn't even a
 *  sections/fields tree before handing it to the canvas or the save seam. */
function isFormSchemaShape(value: unknown): value is GrowthFormSchema {
  if (!value || typeof value !== "object") return false;
  const sections = (value as { sections?: unknown }).sections;
  return (
    Array.isArray(sections) &&
    sections.length > 0 &&
    sections.every((s) => !!s && typeof s === "object" && Array.isArray((s as { fields?: unknown }).fields))
  );
}

/**
 * Draft a whole page from one brief.
 *
 * THE TRAP: growth-page-draft's catch block answers **HTTP 200 with `{ error }`** (index.ts:
 * the final catch). `res.ok` is TRUE on a model outage, on unparseable JSON, on a failed brand
 * read. So the body is checked for `error` BEFORE the status is ever consulted — otherwise a
 * dead model paints an empty canvas and reports success, which is the exact class of lie §13
 * exists to forbid.
 */
export async function draftPage(input: DraftPageInput): Promise<DraftPageResult> {
  const tenantId = requireTenant(input.tenantId);
  const { signal, onBlocks, onPhase } = input;

  // 1. brief — validate what we were given before spending a model call.
  onPhase?.("brief", "");
  const brief = (input.brief ?? "").trim();
  if (brief.length < 5) throw studioError("EMPTY_BRIEF");

  // 2. brand — resolve the caller's session and attach the tenant scope, which is what makes
  //    the server seed theme_json from this tenant's real brand cascade instead of a generic
  //    floor. Real work, in true order — not a decorative step.
  onPhase?.("brand", "");
  const headers = await authHeaders();

  // 3. drafting — the model call. The long, genuinely indeterminate wait.
  onPhase?.("drafting", "");
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/growth-page-draft`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brief,
        tone: input.tone,
        tenant_id: tenantId,
        questionnaire_answer: input.questionnaireAnswer,
        attachments: input.attachments
          ?.slice(0, 3)
          .map((a) => ({ url: a.url, media_type: a.mediaType, kind: a.kind })),
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw studioError("GENERATION_CANCELLED", err);
    throw toStudioError(err, "GENERATION_FAILED");
  }

  let body: DraftPageBody;
  try {
    body = (await res.json()) as DraftPageBody;
  } catch (err) {
    if (signal?.aborted) throw studioError("GENERATION_CANCELLED", err);
    throw studioError("GENERATION_FAILED", err);
  }

  // 4. validating — body FIRST (the 200-with-error trap), then the status, then the payload.
  onPhase?.("validating", "");

  const fnError = readFnError(body);
  if (fnError) {
    const code: StudioErrorCode =
      res.status === 403 || res.status === 401
        ? "FORBIDDEN"
        : res.status === 400
          ? "EMPTY_BRIEF"
          : "GENERATION_FAILED";
    console.error("[studio] growth-page-draft failed:", res.status, fnError.message);
    throw studioError(code, fnError, operatorSafe(fnError.message) ?? undefined);
  }
  if (!res.ok) throw studioError("GENERATION_FAILED", `HTTP ${res.status}`);

  if (!isBlockArray(body.blocks) || body.blocks.length === 0) {
    throw studioError("GENERATION_FAILED", body);
  }

  const blocks = body.blocks;
  const seoRaw = body.seo_json ?? {};
  const seo: StudioSeoDraft = {};
  if (typeof seoRaw.title === "string" && seoRaw.title.trim()) seo.title = seoRaw.title.trim();
  if (typeof seoRaw.description === "string" && seoRaw.description.trim()) {
    seo.description = seoRaw.description.trim();
  }

  // The theme is normalized exactly ONCE, here — so the object the canvas previews is the
  // object that gets persisted, and `font: null` can never clobber the tenant's brand font.
  const theme = normalizeGrowthTheme(body.theme_json);
  const formSchema = isFormSchemaShape(body.form_schema_json) ? body.form_schema_json : undefined;

  // suggested_delivery: only ever trusted when it indexes a REAL attachment THIS call supplied
  // (§13/§15) — the edge function already validates this against what it actually fetched, but
  // the index must ALSO be in range of what the caller sent, since a stale/mismatched call
  // could otherwise let a number through that means nothing on this end.
  const rawIdx = body.suggested_delivery?.asset_index;
  const suggestedDelivery =
    typeof rawIdx === "number" &&
    Number.isInteger(rawIdx) &&
    !!input.attachments &&
    rawIdx >= 0 &&
    rawIdx < input.attachments.length
      ? { assetIndex: rawIdx }
      : undefined;

  onBlocks?.(blocks);
  return { blocks, theme, seo, ...(formSchema ? { formSchema } : {}), ...(suggestedDelivery ? { suggestedDelivery } : {}) };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Studio Phase 1 — the single entry point (§18: "a creation surface must not force the
// operator to pre-select an artifact type before describing what they want"). One brief
// typed at the always-present composer classifies BEFORE the operator ever has to click a
// mode chip, then routes to whichever artifact's own draft seam applies.
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface StudioIntentResult {
  artifact: "page" | "funnel" | "form" | "image";
  /** One short sentence from the classifier — surfaced only if a caller wants to show it. */
  reasoning: string;
}

/** The load-bearing coercion guard: `"copy"` is no longer an accepted Studio artifact type, so a
 *  stale server reply of `{ artifact: "copy" }` fails this check and classifyStudioIntent falls
 *  back to `"page"`. That makes the frontend safe even BEFORE the growth-studio-route edge
 *  function is redeployed — no dead copy artifact can ever be routed to (§13/§18). */
function isStudioArtifactValue(v: unknown): v is StudioIntentResult["artifact"] {
  return v === "page" || v === "funnel" || v === "form" || v === "image";
}

/**
 * Classify a fresh brief into which artifact the operator is actually asking for.
 *
 * ALWAYS resolves to a real artifact, never throws for a classification miss — this mirrors
 * growth-studio-route's own discipline (§13: never fail closed on a legitimate brief). A
 * genuine auth/session problem is swallowed the same way: the downstream draft call
 * (runGenerate/draftFormSchema/draftCopy/draftImage) authenticates again and surfaces the
 * REAL error honestly at that point, so nothing is silently hidden — this function just never
 * blocks the operator's very first keystroke on a routing hiccup.
 */
export async function classifyStudioIntent(brief: string): Promise<StudioIntentResult> {
  const trimmed = (brief ?? "").trim();
  if (trimmed.length < 5) return { artifact: "page", reasoning: "" };

  try {
    const headers = await authHeaders();
    const res = await fetch(`${FUNCTIONS_URL}/growth-studio-route`, {
      method: "POST",
      headers,
      body: JSON.stringify({ brief: trimmed }),
    });
    const body = (await res.json()) as { artifact?: unknown; reasoning?: unknown; error?: unknown };
    const fnError = readFnError(body);
    if (fnError || !res.ok || !isStudioArtifactValue(body.artifact)) {
      if (fnError) console.warn("[studio] growth-studio-route failed, defaulting to page:", res.status, fnError.message);
      return { artifact: "page", reasoning: "" };
    }
    return { artifact: body.artifact, reasoning: typeof body.reasoning === "string" ? body.reasoning : "" };
  } catch (err) {
    console.warn("[studio] classifyStudioIntent transport failure, defaulting to page:", err);
    return { artifact: "page", reasoning: "" };
  }
}

/** The server's CleanFormSchema shape (sections[].title is OPTIONAL there) adapted to the
 *  frontend's GrowthFormSchema (sections[].title is a required string) — never a shape
 *  mismatch reaching FormMode's state. */
function cleanSchemaToGrowthFormSchema(schema: {
  submit_label?: string;
  sections: { title?: string; fields: unknown[] }[];
}): GrowthFormSchema {
  return {
    submit_label: schema.submit_label,
    sections: schema.sections.map((s) => ({
      title: s.title ?? "",
      fields: s.fields as GrowthField[],
    })),
  };
}

/**
 * Derive a real GrowthFormSchema from one brief — the form-mode mirror of draftPage(), for
 * JUST a form schema (no page, no blocks, no theme). Unlike classifyStudioIntent, a failure
 * here is real and the caller should show it — FormMode falls back to its own template
 * picker on a thrown StudioError (NO_VALID_SCHEMA from the server surfaces as
 * GENERATION_FAILED here, same as any other generation miss).
 */
export async function draftFormSchema(brief: string): Promise<GrowthFormSchema> {
  const trimmed = (brief ?? "").trim();
  if (trimmed.length < 5) throw studioError("EMPTY_BRIEF");

  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/growth-form-draft`, {
      method: "POST",
      headers,
      body: JSON.stringify({ brief: trimmed }),
    });
  } catch (err) {
    throw toStudioError(err, "GENERATION_FAILED");
  }

  let body: { schema?: unknown; error?: unknown };
  try {
    body = (await res.json()) as { schema?: unknown; error?: unknown };
  } catch (err) {
    throw studioError("GENERATION_FAILED", err);
  }

  const fnError = readFnError(body);
  if (fnError) {
    const code: StudioErrorCode =
      res.status === 403 || res.status === 401
        ? "FORBIDDEN"
        : res.status === 400
          ? "EMPTY_BRIEF"
          : "GENERATION_FAILED";
    console.error("[studio] growth-form-draft failed:", res.status, fnError.message);
    throw studioError(code, fnError, operatorSafe(fnError.message) ?? undefined);
  }
  if (!res.ok) throw studioError("GENERATION_FAILED", `HTTP ${res.status}`);

  const raw = body.schema as { submit_label?: string; sections?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw studioError("GENERATION_FAILED", body);
  }
  return cleanSchemaToGrowthFormSchema(raw as { submit_label?: string; sections: { title?: string; fields: unknown[] }[] });
}

export interface DraftCopyInput {
  tenantId: string;
  brief: string;
  channel?: string;
  tone?: string;
  variations?: number;
}

export interface DraftCopyResult {
  channel: string;
  drafts: { title: string; content: string }[];
}

/**
 * Draft marketing copy — the callable seam over `content-draft` (§10: the UI is one caller,
 * Paige's headless tools are another). Copy is a CHAT capability, no longer a Studio mode
 * (§18/§21) — its one home is Paige's conversation, and this is the rail she drives to draft it.
 * It is intentionally kept (not deleted with the CopyMode surface): removing the standalone
 * ARTIFACT TYPE does not remove Paige's headless copy rail. Same payload/response shape as before.
 */
export async function draftCopy(input: DraftCopyInput): Promise<DraftCopyResult> {
  const tenantId = requireTenant(input.tenantId);
  const brief = (input.brief ?? "").trim();
  if (brief.length < 5) {
    throw studioError("EMPTY_BRIEF", null, "Give Paige a brief: what's the content about?");
  }
  const { data, error } = await supabase.functions.invoke("content-draft", {
    body: {
      channel: input.channel ?? "social_post",
      brief,
      tone: input.tone ?? "",
      variations: input.variations ?? 2,
      tenant_id: tenantId,
    },
  });
  if (error) throw toStudioError(error, "GENERATION_FAILED");
  if ((data as { error?: unknown } | null)?.error) {
    throw studioError("GENERATION_FAILED", data, operatorSafe(String((data as { error?: unknown }).error)) ?? undefined);
  }
  const drafts = ((data as { drafts?: { title: string; content: string }[] } | null)?.drafts ?? []);
  if (!drafts.length) {
    throw studioError("GENERATION_FAILED", data, "Paige didn't return a draft. Try adding more detail.");
  }
  return { channel: (data as { channel?: string } | null)?.channel ?? input.channel ?? "social_post", drafts };
}

export interface DraftImageInput {
  tenantId: string;
  prompt: string;
  size?: string;
  provider?: string;
}

export interface DraftImageResult {
  url: string;
  path?: string;
  size: string;
  provider?: string;
  content_id?: string;
  /** True when image generation isn't switched on for this tenant — an honest non-error
   *  result (§13), not a thrown failure; the caller renders its existing needs_config gate. */
  needsConfig?: boolean;
}

/**
 * Generate an image — relocated verbatim from ImageMode's own direct `generate-image` invoke
 * (§10). Preserves the needs_config gate as a returned, honest result rather than a thrown
 * error — image generation being off for a tenant is a real, expected state, not a defect.
 */
export async function draftImage(input: DraftImageInput): Promise<DraftImageResult> {
  const tenantId = requireTenant(input.tenantId);
  const prompt = (input.prompt ?? "").trim();
  if (prompt.length < 4) {
    throw studioError("EMPTY_BRIEF", null, "Describe the image you want.");
  }
  const { data, error } = await supabase.functions.invoke("generate-image", {
    body: {
      prompt,
      size: input.size ?? "square",
      tenant_id: tenantId,
      ...(input.provider ? { provider: input.provider } : {}),
    },
  });
  if (error) throw toStudioError(error, "GENERATION_FAILED");
  const body = data as { needs_config?: boolean; error?: unknown; url?: string; path?: string; size?: string; provider?: string; content_id?: string } | null;
  if (body?.needs_config) {
    return { url: "", size: input.size ?? "square", needsConfig: true };
  }
  if (body?.error) {
    throw studioError("GENERATION_FAILED", data, operatorSafe(String(body.error)) ?? undefined);
  }
  if (!body?.url) {
    throw studioError("GENERATION_FAILED", data, "No image came back. Try again.");
  }
  return {
    url: body.url,
    path: body.path,
    size: body.size || input.size || "square",
    provider: body.provider,
    content_id: body.content_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Save copy / image — rpc save_marketing_content. The Copy/Image "publish" pipeline.
//
// CHECKED FIRST (§13 — don't bolt on a toggle the data model doesn't have): marketing_content
// (20260711120000_marketing_content_library.sql) carries `status text CHECK (status IN
// ('draft','archived'))` — draft/archived is a housekeeping flag (nothing here ever sets
// 'archived'), NOT a draft/live publish state the way growth_pages has one. There is no
// second, "live" copy of a piece of marketing text or a generated image for anything to
// flip a page's status column between. So there is no publish RPC to add here — filing the
// item into the tenant's library via save_marketing_content IS the whole act, same as it
// already is for generate-image's server-side auto-file below. The "test" step these two
// modes get instead is a real one: copy-to-clipboard for text (it's inert until pasted
// somewhere real) and a copyable hosted URL for an image (it's already live on the public
// paige-generated bucket the moment it's generated) — both wired in the mode components,
// not invented here.
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface SaveCopyInput {
  tenantId: string;
  title: string;
  content: string;
  channel: string;
  /** The brief that produced this draft — stored for reference, same as growth_page_upsert
   *  never invents provenance it wasn't given. */
  brief?: string;
  /** PASS THIS ON A REPEAT SAVE of the SAME draft (the caller's own saved id from a prior
   *  saveCopy() call). Without it, save_marketing_content always INSERTs — a second "Save
   *  again" click would silently fork a duplicate library row instead of updating the one
   *  already there, same class of bug SavePageInput.pageId's own doc comment guards against. */
  id?: string | null;
}

export interface SavedContent {
  /** The marketing_content row's real id, straight off the RPC — never fabricated (§13).
   *  Lets a caller show "Saved" only once this resolves, and point "View in library" at a
   *  row that genuinely exists. */
  id: string;
}

/**
 * File one drafted copy variation into the tenant's content library.
 *
 * The save seam over `save_marketing_content` (§10/§18). Copy is a CHAT capability, no longer a
 * Studio mode (§18/§21) — Paige drafts copy in the conversation via draftCopy() above and files
 * it with this. Kept alongside draftCopy for the same reason: the standalone Copy artifact TYPE
 * is gone, but Paige's headless draft→save copy rail is not.
 */
export async function saveCopy(input: SaveCopyInput): Promise<SavedContent> {
  const tenantId = requireTenant(input.tenantId);
  const content = (input.content ?? "").trim();
  if (!content) throw studioError("SAVE_FAILED", null, "There's nothing to save yet.");
  const title = (input.title ?? "").trim() || "Untitled";

  const id = await rpc<string | null>(
    "save_marketing_content",
    {
      p_kind: "text",
      p_title: title,
      p_body: content,
      p_channel: input.channel || null,
      p_brief: input.brief?.trim() || null,
      p_tenant_id: tenantId,
      p_id: input.id ?? null,
    },
    "SAVE_FAILED",
  );

  if (!id) throw studioError("SAVE_FAILED", id);
  return { id };
}

export interface SaveImageInput {
  tenantId: string;
  title: string;
  /** The REAL hosted URL draftImage() returned — never a client-invented string. */
  url: string;
  path?: string | null;
  size: string;
  brief?: string;
}

/**
 * Manual fallback save for a generated image into the tenant's content library.
 *
 * draftImage()'s own generate-image call already auto-files every successful generation
 * into marketing_content SERVER-side (surfaced as `content_id` on its result) — but that
 * insert is explicitly best-effort there ("never fail the generation because the library
 * insert hiccuped"). So a genuine, successful generation can still come back with no
 * content_id. This is the one path that lets the operator complete JUST the save, instead
 * of ImageMode ever reporting "Saved to library" for a write that didn't actually happen.
 */
export async function saveImageToLibrary(input: SaveImageInput): Promise<SavedContent> {
  const tenantId = requireTenant(input.tenantId);
  const url = (input.url ?? "").trim();
  if (!url) throw studioError("SAVE_FAILED", null, "There's no image to save yet.");
  const title = (input.title ?? "").trim() || "Untitled";

  const id = await rpc<string | null>(
    "save_marketing_content",
    {
      p_kind: "image",
      p_title: title,
      p_image_url: url,
      p_image_path: input.path ?? null,
      p_size: input.size,
      p_brief: input.brief?.trim() || null,
      p_tenant_id: tenantId,
    },
    "SAVE_FAILED",
  );

  if (!id) throw studioError("SAVE_FAILED", id);
  return { id };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Media Library — the curation-of-winners layer (#284, §10/§12/§18)
//   A thin membership over the real stores: page/funnel/form live in growth_*, image/copy in
//   marketing_content. save_to_library/remove_from_library/list_library are the Paige-callable
//   seams (§10) so she can keep/unkeep/list a tenant's saved work by voice, not only by click.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Keep one artifact in the tenant's media library (idempotent — re-keeping refreshes it). The
 *  title/thumbnail snapshot is what the library card shows; the pointer (kind+artifactId) resolves
 *  the live source. Returns the membership row id. */
export async function saveToLibrary(input: {
  tenantId: string;
  kind: LibraryKind;
  artifactId: string;
  title?: string;
  thumbnailUrl?: string | null;
  note?: string | null;
}): Promise<{ id: string }> {
  const tenantId = requireTenant(input.tenantId);
  if (!input.artifactId) throw studioError("SAVE_FAILED", null, "There's nothing to save yet.");
  const id = await rpc<string | null>(
    "save_to_library",
    {
      p_kind: input.kind,
      p_artifact_id: input.artifactId,
      p_title: input.title?.trim() || null,
      p_thumbnail_url: input.thumbnailUrl ?? null,
      p_note: input.note ?? null,
      p_tenant_id: tenantId,
    },
    "SAVE_FAILED",
  );
  if (!id) throw studioError("SAVE_FAILED", id);
  return { id };
}

/** Drop one artifact from the library — by membership id, or by kind+artifactId (so a Save button
 *  can toggle without tracking the membership id). */
export async function removeFromLibrary(input: {
  id?: string;
  kind?: LibraryKind;
  artifactId?: string;
}): Promise<boolean> {
  const ok = await rpc<boolean | null>(
    "remove_from_library",
    { p_id: input.id ?? null, p_kind: input.kind ?? null, p_artifact_id: input.artifactId ?? null },
    "SAVE_FAILED",
  );
  return ok === true;
}

/** Bring an OUTSIDE artifact into the tenant's media library (owner ask 2026-07-18): upload the
 *  file through the ONE existing upload seam (uploadGrowthAsset → tenant-scoped growth-assets
 *  bucket, MIME/size-validated), file it into the tenant's content store (marketing_content), then
 *  KEEP it in the library. No new bucket, no new upload path (§18). Images AND videos in v1 — a
 *  document needs a library 'file' kind (tracked, #315 follow-up). No learn fires here: an uploaded
 *  external asset is not the tenant's authored voice (unlike a Studio-generated image, whose prompt
 *  IS signal). The marketing_content row kind and the studio_library_items artifact_kind are ALWAYS
 *  the SAME value (the asset's kind), so the two stores never disagree on what the artifact is (§13). */
export async function uploadToLibrary(tenantId: string, file: File): Promise<LibraryItem> {
  const tid = requireTenant(tenantId);
  // image + video only (NOT document — that awaits a library 'file' kind). uploadGrowthAsset enforces
  // MIME/size and rejects anything else with an honest message (§13).
  const asset = await uploadGrowthAsset(tid, file, ["image", "video"]);
  const kind: LibraryKind = asset.kind === "video" ? "video" : "image";
  const title = (file.name || "Upload").replace(/\.[^.]+$/, "").slice(0, 80) || "Upload";
  // File it into marketing_content directly with p_kind = the asset's kind (NOT saveImageToLibrary,
  // which hardcodes 'image'). image_url carries the media URL for both image and video.
  const savedId = await rpc<string | null>(
    "save_marketing_content",
    {
      p_kind: kind,
      p_title: title,
      p_image_url: asset.url,
      p_image_path: asset.path,
      p_size: kind === "image" ? "square" : null, // size is meaningless on a video
      p_brief: title,
      p_tenant_id: tid,
    },
    "SAVE_FAILED",
  );
  if (!savedId) throw studioError("SAVE_FAILED", savedId);
  const artifactId = String(savedId);
  // The keep is a 2nd non-atomic write. If it fails, roll the content row back so no orphan shows in
  // the tenant's store while the caller was truthfully told the upload failed (§13 — no partial pretend).
  let id: string | null;
  try {
    id = await rpc<string | null>(
      "save_to_library",
      { p_kind: kind, p_artifact_id: artifactId, p_title: title, p_thumbnail_url: asset.url, p_tenant_id: tid },
      "SAVE_FAILED",
    );
    if (!id) throw studioError("SAVE_FAILED", id);
  } catch (err) {
    // Best-effort compensating delete; swallow its own failure so the original error surfaces.
    try { await rpc<boolean>("delete_marketing_content", { p_id: artifactId }, "SAVE_FAILED"); } catch { /* orphan cleanup is best-effort */ }
    throw err;
  }
  return { id: String(id), kind, artifactId, title, thumbnailUrl: asset.url, note: null, tags: [], savedAt: new Date().toISOString() };
}

/** List the tenant's kept artifacts (newest first), optionally filtered to one kind. */
export async function listLibrary(input: {
  tenantId: string;
  kind?: LibraryKind;
  limit?: number;
}): Promise<LibraryItem[]> {
  const tenantId = requireTenant(input.tenantId);
  const rows = await rpc<Record<string, unknown>[] | null>(
    "list_library",
    { p_kind: input.kind ?? null, p_limit: input.limit ?? 200, p_tenant_id: tenantId },
    "UNKNOWN",
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id),
    kind: r.artifact_kind as LibraryKind,
    artifactId: String(r.artifact_id),
    title: typeof r.title === "string" ? r.title : "Untitled",
    thumbnailUrl: typeof r.thumbnail_url === "string" ? r.thumbnail_url : null,
    note: typeof r.note === "string" ? r.note : null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    savedAt: typeof r.saved_at === "string" ? r.saved_at : "",
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Save — rpc growth_page_upsert
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface SavePageInput {
  tenantId: string;
  /** PASS THIS WHEN EDITING. Without it the upsert's ON CONFLICT (tenant_id, slug) will
   *  silently overwrite a DIFFERENT page that happens to hold the same slug. */
  pageId?: string | null;
  slug: string;
  title: string;
  blocks: GrowthBlock[];
  theme?: GrowthPageTheme | null;
  seo?: StudioSeoDraft | null;
  /** The REAL questionnaire schema derived from the clarifying step's questionnaire_answer
   *  (§4/§15). Replaces growth_page_upsert's generic 3-field synthesis for this page's
   *  embedded_form on first save — never overwrites an operator's later manual edit
   *  (ON CONFLICT DO NOTHING on growth_forms, server-side). Omit/null on every other save. */
  formSchema?: GrowthFormSchema | null;
}

export interface SavedPage {
  id: string;
  slug: string;
  title: string;
  status: string;
}

/**
 * Write the DRAFT columns (draft_blocks_json / draft_theme_json / draft_seo_json). Never the
 * live ones — the live columns only ever change inside growth_page_publish.
 *
 * SIDE EFFECT WE DEPEND ON: the RPC idempotently auto-authors an ACTIVE backing form for every
 * embedded_form block. That is what makes the canvas's signup section a real signup section,
 * and it is the reason publish's lead-capture guard passes. Which is why a page is always
 * saved before the publish door is asked to put it live.
 */
export async function savePageDraft(input: SavePageInput): Promise<SavedPage> {
  const tenantId = requireTenant(input.tenantId);
  const slug = (input.slug ?? "").trim();
  if (!slug) throw studioError("INVALID_SLUG");
  if (!Array.isArray(input.blocks) || input.blocks.length === 0) throw studioError("NO_DRAFT");

  // Normalization is idempotent, so applying it again here costs nothing and protects the
  // headless caller (Paige) who may hand us a raw generator payload full of nulls.
  const theme = input.theme ? normalizeGrowthTheme(input.theme) : null;
  const themeJson = theme && Object.keys(theme).length > 0 ? theme : null;
  const seoJson = input.seo && Object.keys(input.seo).length > 0 ? input.seo : null;

  const row = await rpc<SavedPage | null>(
    "growth_page_upsert",
    {
      p_tenant_id: tenantId,
      p_slug: slug,
      p_title: (input.title ?? "").trim() || "Untitled",
      p_blocks_json: input.blocks,
      p_theme_json: themeJson,
      p_seo_json: seoJson,
      p_id: input.pageId ?? null,
      p_form_schema_json: input.formSchema ?? null,
    },
    "SAVE_FAILED",
  );

  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return { id: row.id, slug: row.slug, title: row.title, status: row.status };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// The brain's LEARN direction — studio-learn-from-artifact (#310, §7/§8/§15)
// ═══════════════════════════════════════════════════════════════════════════════════════

/** The outcomes of asking Paige to learn from a published artifact. Mirrors the
 *  edge function's documented 200 shapes 1:1 so the caller can be truthful (§13):
 *   - learned      → it was actually saved to the tenant's KB (report the win)
 *   - needs_confirm → §15: the tenant must say yes first (default autonomy is 'confirm')
 *   - blocked      → the tenant turned learning off; say nothing
 *   - partial / uncertain → review Knowledge; never imply full learning or retry automatically
 *   - error        → learning did not complete; publication is independent. */
export type LearnResult =
  | { kind: "learned"; docId?: string; chunkCount?: number; message: string }
  | { kind: "partial" | "uncertain"; docId?: string; message: string }
  | { kind: "needs_confirm"; proposal: string }
  | { kind: "blocked" }
  | { kind: "error" };

/**
 * Feed a just-published page/funnel back into THIS tenant's own knowledge base so the next draft
 * is grounded in what they've already shipped (the WRITE half of the Studio brain; studio-brain.ts
 * is the READ half). This is BEST-EFFORT by construction (§13): the tenant already published — a
 * KB hiccup must NEVER surface as a publish failure, so every path resolves to a LearnResult and
 * this function never throws. The tenant is resolved server-side FROM the artifact row (§9), so we
 * send ONLY artifact_type/artifact_id/confirmed — never a tenant_id in the body. §15 lives in the
 * edge function: the default 'confirm' autonomy comes back as needs_confirm, and the caller re-calls
 * with confirmed:true once the tenant agrees.
 */
export async function learnFromArtifact(input: {
  tenantId: string;
  artifactType: LibraryKind;
  artifactId: string;
  confirmed?: boolean;
  signal?: AbortSignal;
}): Promise<LearnResult> {
  try {
    requireTenant(input.tenantId); // caller-side guard only; the function re-resolves from the row (§9)
    if (!input.artifactId) return { kind: "error" };
    const headers = await authHeaders();
    const res = await fetch(`${FUNCTIONS_URL}/studio-learn-from-artifact`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        artifact_type: input.artifactType,
        artifact_id: input.artifactId,
        confirmed: input.confirmed === true,
      }),
      signal: input.signal,
    });
    const body = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          learned?: boolean;
          embedded?: boolean;
          partial?: boolean;
          error?: unknown;
          needs_confirm?: boolean;
          blocked?: boolean;
          proposal?: unknown;
          message?: unknown;
          doc_id?: unknown;
          chunk_count?: unknown;
        }
      | null;
    if (!body || typeof body !== "object") return { kind: "uncertain", message: "Learning could not be verified. Check your knowledge before retrying." };

    if (res.ok && body.needs_confirm === true && typeof body.proposal === "string") {
      return { kind: "needs_confirm", proposal: body.proposal };
    }
    if (res.ok && body.blocked === true) return { kind: "blocked" };
    if (res.ok && body.ok === false && (body.error === "not_published" || body.error === "no_content")) return { kind: "error" };
    const outcome = knowledgeIngestOutcome(body);
    if (res.ok && outcome.kind === "complete" && body.learned === true && body.partial !== true && !body.error) {
      return {
        kind: "learned",
        docId: outcome.docId,
        chunkCount: outcome.chunkCount,
        message: typeof body.message === "string" ? body.message : "Saved to your Paige's knowledge.",
      };
    }
    if (res.ok && (outcome.kind === "partial" || (outcome.kind === "complete" && body.partial === true))) return { kind: "partial", docId: outcome.docId, message: typeof body.message === "string" ? body.message : outcome.message };
    if (outcome.kind === "failed") return { kind: "error" };
    return { kind: "uncertain", docId: outcome.docId, message: typeof body.message === "string" ? body.message : "Learning could not be verified. Check your knowledge before retrying." };
  } catch {
    // A lost acknowledgement can follow a committed write. Keep publication
    // independent while asking the owner to inspect Knowledge before retrying.
    return { kind: "uncertain", message: "Learning could not be verified. Check your knowledge before retrying." };
  }
}

/**
 * The brain's READ direction, surfaced as suggestion chips (#310 Slice C): turn the tenant's OWN
 * knowledge base into a few "start here" briefs on the Studio home composer, so building opens
 * already tuned to THEIR offers instead of a generic template. Best-effort (§13): any problem — no
 * tenant, an empty KB, a read error — resolves to [] so the caller falls back to the static
 * STUDIO_HOME_CHIPS. The brief each chip drops in is REAL and editable (§15) — no hidden template.
 * Scoped to the caller's tenant explicitly (§9 defense-in-depth) on top of RLS.
 */
export async function loadKbSuggestionChips(
  tenantId: string,
  opts?: { limit?: number },
): Promise<IntentChip[]> {
  try {
    const tid = requireTenant(tenantId);
    const { data, error } = await supabase
      .from("tenant_knowledge_docs" as never)
      .select("id, title, summary, category, tags")
      .eq("tenant_id", tid)
      // Seed suggestions from the tenant's AUTHORED source material only — never from the brain's
      // OWN learned echoes (the LEARN seam writes category='studio' rows titled 'Studio — …'). Those
      // are the freshest rows, so without this they'd sort first and turn the chips self-referential
      // ("A landing page for Studio — My Page") and leak the 'Studio —' provenance prefix (§11/§13).
      .neq("category", "studio")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(opts?.limit ?? 4, 1), 8));
    if (error || !Array.isArray(data)) return [];
    const chips: IntentChip[] = [];
    for (const raw of data as Record<string, unknown>[]) {
      const title = typeof raw?.title === "string" ? raw.title.trim() : "";
      if (!title) continue;
      const summary = typeof raw?.summary === "string" ? raw.summary : null;
      const category = typeof raw?.category === "string" ? raw.category : null;
      const seed = briefFromKbDoc({ title, summary, category });
      if (!seed) continue;
      chips.push({ id: `kb-${String(raw?.id ?? title)}`, label: kbChipLabel({ title, category }), seed });
    }
    return chips;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Structural block edits — rpc growth_page_edit_blocks
// ═══════════════════════════════════════════════════════════════════════════════════════

export type BlockEditOp =
  | { op: "set"; blocks: GrowthBlock[] }
  | { op: "append"; block: GrowthBlock }
  | { op: "insert"; index: number; block: GrowthBlock }
  | { op: "update"; index: number; block: GrowthBlock }
  | { op: "remove"; index: number }
  | { op: "move"; from: number; to: number };

/**
 * Apply index-based edits to the draft blocks and get the FULL new array back.
 *
 * The caller reconciles state from what the server RETURNS, never from an optimistic local
 * mutation — the same page can be edited from Paige's chat at the same moment, and the server's
 * array is the only one that is true. The RPC re-runs the same 17-type validator the upsert
 * uses, so an edit can never persist a block the save path would have rejected.
 */
export async function editBlocks(input: {
  tenantId: string;
  pageId: string;
  ops: BlockEditOp[];
}): Promise<GrowthBlock[]> {
  const tenantId = requireTenant(input.tenantId);
  if (!input.pageId) throw studioError("NO_DRAFT");
  if (!Array.isArray(input.ops) || input.ops.length === 0) return [];

  const blocks = await rpc<unknown>(
    "growth_page_edit_blocks",
    { p_tenant_id: tenantId, p_id: input.pageId, p_ops: input.ops },
    "EDIT_FAILED",
  );

  if (!isBlockArray(blocks)) throw studioError("EDIT_FAILED", blocks);
  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Conversational section edit — supabase/functions/growth-block-edit
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface ReviseBlockInput {
  tenantId: string;
  index: number;
  block: GrowthBlock;
  /** The operator's sentence: "punchier headline", "add a third card". */
  instruction: string;
  signal?: AbortSignal;
}

/**
 * Rewrite ONE section from a sentence, and return the revised block — nothing is persisted here.
 * The caller then commits it through editBlocks({ ops: [{ op: "update", index, block }] }), so a
 * revision travels the same validated write path as every other change.
 *
 * The function role-gates the caller, resolves the tenant SERVER-side for a JWT caller (it does
 * not trust a tenant_id from the browser), reuses the draft function's validator, and is
 * contractually bound to return the same block.type it was given.
 */
export async function reviseBlock(input: ReviseBlockInput): Promise<GrowthBlock> {
  const tenantId = requireTenant(input.tenantId);
  const instruction = (input.instruction ?? "").trim();
  if (instruction.length < 3) throw studioError("EDIT_FAILED");
  if (!input.block || typeof input.block !== "object") throw studioError("EDIT_FAILED");

  const headers = await authHeaders();

  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/growth-block-edit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        block: input.block,
        instruction,
        block_index: input.index,
        // For a JWT caller it must be the session's own workspace or the function refuses (it pins
        // the tenant itself); read as the tenant only when Paige calls headlessly with the service role.
        tenant_id: tenantId,
      }),
      signal: input.signal,
    });
  } catch (err) {
    if (input.signal?.aborted) throw studioError("GENERATION_CANCELLED", err);
    throw toStudioError(err, "EDIT_FAILED");
  }

  let body: { block?: unknown; error?: unknown };
  try {
    body = (await res.json()) as { block?: unknown; error?: unknown };
  } catch (err) {
    throw studioError("EDIT_FAILED", err);
  }

  // Same discipline as the draft seam: read the body's error before trusting the status.
  const fnError = readFnError(body);
  if (fnError) {
    const code: StudioErrorCode =
      fnError.code === "FORBIDDEN" || fnError.code === "UNAUTHENTICATED" ? "FORBIDDEN" : "EDIT_FAILED";
    console.error("[studio] growth-block-edit failed:", res.status, fnError.code, fnError.message);
    throw studioError(code, fnError, operatorSafe(fnError.message) ?? undefined);
  }
  if (!res.ok) throw studioError("EDIT_FAILED", `HTTP ${res.status}`);

  const revised = body.block;
  if (!revised || typeof revised !== "object" || typeof (revised as GrowthBlock).type !== "string") {
    throw studioError("EDIT_FAILED", body);
  }
  return revised as GrowthBlock;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Load
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface LoadedPageDraft {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  blocks: GrowthBlock[];
  theme: GrowthPageTheme | null;
  seo: StudioSeoDraft | null;
}

/** The draft columns post-date the generated types, so the row is read whole and narrowed here
 *  — the shape below is the contract, not an assumption. */
interface GrowthPageRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  blocks_json: unknown;
  theme_json: unknown;
  seo_json: unknown;
  draft_blocks_json: unknown;
  draft_theme_json: unknown;
  draft_seo_json: unknown;
}

/**
 * Open an existing page's DRAFT in the Studio.
 *
 * Falls back to the LIVE columns when the draft ones are NULL — a page published before the
 * draft columns existed has never been drafted, and opening it must show what is actually on
 * the internet right now, not an empty canvas. This is the same fallback the edit RPC makes,
 * deliberately: the Studio and the server agree on what "the current page" means.
 */
export async function loadPageDraft(input: {
  tenantId: string;
  pageId: string;
}): Promise<LoadedPageDraft> {
  const tenantId = requireTenant(input.tenantId);
  if (!input.pageId) throw studioError("NOT_FOUND");

  const { data, error } = await supabase
    .from("growth_pages")
    .select("*")
    .eq("id", input.pageId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw toStudioError(error, "NOT_FOUND");
  if (!data) throw studioError("NOT_FOUND");

  const row = data as unknown as GrowthPageRow;
  const blocks = isBlockArray(row.draft_blocks_json)
    ? row.draft_blocks_json
    : isBlockArray(row.blocks_json)
      ? row.blocks_json
      : [];

  const themeRaw = (row.draft_theme_json ?? row.theme_json) as GrowthPageTheme | null;
  const theme = themeRaw ? normalizeGrowthTheme(themeRaw) : null;

  const seoRaw = (row.draft_seo_json ?? row.seo_json) as StudioSeoDraft | null;
  const seo = seoRaw && typeof seoRaw === "object" ? seoRaw : null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status === "published" ? "published" : "draft",
    blocks,
    theme: theme && Object.keys(theme).length > 0 ? theme : null,
    seo,
  };
}

/**
 * growth_page_upsert does ON CONFLICT (tenant_id, slug) DO UPDATE. With p_id = null, a colliding
 * slug SILENTLY OVERWRITES another page's draft. Every NEW page runs through here first.
 */
export async function uniqueGrowthPageSlug(tenantId: string, desired: string): Promise<string> {
  const tid = requireTenant(tenantId);
  const base = kebab(desired) || "page";

  const { data, error } = await supabase
    .from("growth_pages")
    .select("slug")
    .eq("tenant_id", tid)
    .like("slug", `${base}%`);

  if (error) throw toStudioError(error, "SAVE_FAILED");

  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 200; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function kebab(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** The same collision-avoidance as uniqueGrowthPageSlug, for any (tenant_id, slug) table
 *  the funnel builder creates rows in (growth_forms, growth_funnels). A NEW row's slug must
 *  not silently collide with an existing one — the funnel builder creates several rows in a
 *  row, so it can't lean on the picker's "these already exist" list the way FunnelMode does. */
async function uniqueGrowthSlug(
  table: "growth_forms" | "growth_funnels",
  tenantId: string,
  desired: string,
): Promise<string> {
  const tid = requireTenant(tenantId);
  const base = kebab(desired) || (table === "growth_funnels" ? "funnel" : "form");
  const { data, error } = await supabase
    .from(table)
    .select("slug")
    .eq("tenant_id", tid)
    .like("slug", `${base}%`);
  if (error) throw toStudioError(error, "SAVE_FAILED");
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 200; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Forms & funnels — the Studio's form/funnel modes drive the SAME SECURITY DEFINER rails
// the Growth libraries and Paige write on (§10). Same house style as the page seams:
// plain async, structured StudioError, no React. p_tenant_id is passed as null on purpose —
// the RPCs pin a JWT caller to their own tenant server-side (IDOR-safe); requireTenant()
// still gates the call so platform staff with no active tenant fail loudly first (§9).
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface SaveFormInput {
  tenantId: string;
  slug: string;
  name: string;
  schema: GrowthFormSchema;
  /** What happens right after a visitor submits (§13). Omit to keep growth_form_upsert's own
   *  default ({"type":"thank_you", message}) — never overwrites an existing form's action with
   *  null; only an explicit value here ever changes it. */
  successAction?: GrowthSuccessAction | null;
  /** PASS THIS TO UPDATE an existing form in place (the funnel rebuild path). Without it the
   *  upsert INSERTs a new row — which is what would strand orphan forms on every rebuild. */
  id?: string | null;
}

export interface SavedForm {
  id: string;
  slug: string;
}

/** Create (or update) a form through growth_form_upsert — schema validated server-side,
 *  atomic, tenant-pinned. The exact payload shape the Forms library used. */
export async function saveForm(input: SaveFormInput): Promise<SavedForm> {
  requireTenant(input.tenantId);
  const slug = kebab(input.slug);
  if (!slug) throw studioError("INVALID_SLUG");
  const name = (input.name ?? "").trim();
  if (!name) throw studioError("SAVE_FAILED", null, "Give the form a name first.");

  const row = await rpc<{ id?: string; slug?: string } | null>(
    "growth_form_upsert",
    {
      p_tenant_id: null,
      p_slug: slug,
      p_name: name,
      p_schema_json: input.schema,
      p_success_action_json: input.successAction ?? null,
      p_auto_create_contact: true,
      p_pipeline_id: null,
      p_stage_id: null,
      p_id: input.id ?? null,
    },
    "SAVE_FAILED",
  );

  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return { id: row.id, slug: row.slug ?? slug };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Post-submit delivery editor — closes the gap where every Page-mode form's
// success_action_json was hardcoded and never editable (§13/§15). Reads/writes the SAME
// growth_form_upsert rail as saveForm() above — one write seam, no fork.
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface FormDeliveryRecord {
  id: string;
  slug: string;
  name: string;
  schema: GrowthFormSchema;
  successAction: GrowthSuccessAction | null;
}

/** Load a tenant's form by its slug (the embedded_form block's own form_slug) so the Studio can
 *  show/edit its CURRENT post-submit behavior. Returns null if the form hasn't been
 *  auto-authored yet (the page has never been saved). */
export async function loadFormBySlug(tenantId: string, slug: string): Promise<FormDeliveryRecord | null> {
  const tid = requireTenant(tenantId);
  const cleanSlug = (slug ?? "").trim();
  if (!cleanSlug) return null;
  const { data, error } = await supabase
    .from("growth_forms")
    .select("id,slug,name,schema_json,success_action_json")
    .eq("tenant_id", tid)
    .eq("slug", cleanSlug)
    .maybeSingle();
  if (error) throw toStudioError(error, "NOT_FOUND");
  if (!data) return null;
  const row = data as unknown as {
    id: string; slug: string; name: string; schema_json: GrowthFormSchema; success_action_json: GrowthSuccessAction | null;
  };
  return { id: row.id, slug: row.slug, name: row.name, schema: row.schema_json, successAction: row.success_action_json ?? null };
}

/** Reload a persisted funnel into the BuiltFunnel shape for the read-only canvas preview (#319).
 *  Reads growth_funnels + its ordered growth_funnel_steps and joins each page/form step's real
 *  title + status, so the filmstrip renders the tenant's REAL sequence — never a fabricated one
 *  (§13). Tenant-scoped (explicit tenant filter + RLS, §9); read-only, no mutation (§10 seam:
 *  Paige can call this to reason about a funnel without opening the UI). Returns null when the
 *  funnel row is gone (tombstoned), so the canvas falls back to the honest EmptyState. Only
 *  page/form/thankyou steps are surfaced (payment/booking are roadmap and never built here). */
export async function loadFunnel(tenantId: string, funnelId: string): Promise<BuiltFunnel | null> {
  const tid = requireTenant(tenantId);
  if (!funnelId) return null;

  const { data: f, error: fe } = await supabase
    .from("growth_funnels")
    .select("id,slug,name,goal,status,entry_page_id")
    .eq("id", funnelId)
    .eq("tenant_id", tid)
    .maybeSingle();
  if (fe) throw toStudioError(fe, "NOT_FOUND");
  if (!f) return null;
  const funnelRow = f as unknown as {
    id: string; slug: string; name: string; goal: string | null; status: string; entry_page_id: string | null;
  };

  const { data: stepRows, error: se } = await supabase
    .from("growth_funnel_steps")
    .select("order_index,step_type,page_id,form_id")
    .eq("funnel_id", funnelId)
    .eq("tenant_id", tid)
    .order("order_index", { ascending: true });
  if (se) throw toStudioError(se, "NOT_FOUND");
  const rows = (stepRows ?? []) as { order_index: number; step_type: string; page_id: string | null; form_id: string | null }[];

  // Resolve real page/form titles + status in one round-trip each (never N+1).
  const pageIds = [...new Set(rows.filter((r) => r.page_id).map((r) => r.page_id!))];
  const formIds = [...new Set(rows.filter((r) => r.form_id).map((r) => r.form_id!))];
  const pageById = new Map<string, { title: string; status: string; slug: string }>();
  const formById = new Map<string, { name: string; status: string; slug: string }>();
  if (pageIds.length) {
    const { data: pages } = await supabase
      .from("growth_pages").select("id,title,status,slug").eq("tenant_id", tid).in("id", pageIds);
    for (const p of (pages ?? []) as { id: string; title: string | null; status: string; slug: string }[]) {
      pageById.set(p.id, { title: p.title?.trim() || "Landing page", status: p.status, slug: p.slug });
    }
  }
  if (formIds.length) {
    const { data: forms } = await supabase
      .from("growth_forms").select("id,name,status,slug").eq("tenant_id", tid).in("id", formIds);
    for (const fm of (forms ?? []) as { id: string; name: string | null; status: string; slug: string }[]) {
      formById.set(fm.id, { name: fm.name?.trim() || "Intake form", status: fm.status, slug: fm.slug });
    }
  }

  const steps: BuiltFunnelStep[] = [];
  let entryPageId: string | null = funnelRow.entry_page_id;
  let entryPageStatus: "draft" | "published" = "draft";
  let entryPageSlug = "";
  let formId: string | null = null;
  let formSlug: string | null = null;
  for (const r of rows) {
    if (r.step_type === "page" && r.page_id) {
      const pg = pageById.get(r.page_id);
      const published = pg?.status === "published";
      steps.push({ kind: "page", title: pg?.title ?? "Landing page", refId: r.page_id, status: published ? "published" : "draft" });
      if (!entryPageId || entryPageId === r.page_id) {
        entryPageId = r.page_id; entryPageStatus = published ? "published" : "draft"; entryPageSlug = pg?.slug ?? "";
      }
    } else if (r.step_type === "form" && r.form_id) {
      const fm = formById.get(r.form_id);
      steps.push({ kind: "form", title: fm?.name ?? "Intake form", refId: r.form_id, status: fm?.status === "active" ? "active" : "draft" });
      formId = r.form_id; formSlug = fm?.slug ?? null;
    } else if (r.step_type === "thankyou") {
      steps.push({ kind: "thankyou", title: "Thank you", refId: null, status: "included" });
    }
    // payment/booking: roadmap step types — never built by buildFunnelFromDraft, skipped here.
  }

  return {
    funnelId: funnelRow.id,
    funnelSlug: funnelRow.slug,
    name: funnelRow.name,
    goal: funnelRow.goal,
    pageId: entryPageId ?? "",
    pageSlug: entryPageSlug,
    pageStatus: entryPageStatus,
    formId,
    formSlug,
    // A reopened preview doesn't re-run the page-blank preflight (that's a build-time publish gate);
    // it's a read-only view, so no blanks are surfaced here (§13 — never invented).
    pageBlanks: [],
    steps,
  };
}

export interface SaveFormDeliveryInput {
  tenantId: string;
  formId: string;
  slug: string;
  name: string;
  /** The form's CURRENT schema, unchanged — growth_form_upsert sets schema_json unconditionally
   *  (unlike success_action_json's COALESCE), so an update MUST resend the existing schema or it
   *  would be silently wiped. Always pass through what loadFormBySlug returned. */
  schema: GrowthFormSchema;
  successAction: GrowthSuccessAction;
}

/** Write a REAL, caller-verified success_action_json — a message, a redirect the operator typed,
 *  or a download_url that is a REAL uploaded growth-asset URL (never a model-invented string,
 *  §13/§15). This is the ONLY place that turns a Studio suggestion or operator choice into a
 *  live, persisted post-submit action. */
export async function saveFormDelivery(input: SaveFormDeliveryInput): Promise<SavedForm> {
  requireTenant(input.tenantId);
  if (!input.formId) throw studioError("SAVE_FAILED", null, "That form hasn't been created yet — save the page first.");
  const slug = kebab(input.slug);
  if (!slug) throw studioError("INVALID_SLUG");
  const name = (input.name ?? "").trim();
  if (!name) throw studioError("SAVE_FAILED", null, "That form is missing a name.");

  const row = await rpc<{ id?: string; slug?: string } | null>(
    "growth_form_upsert",
    {
      p_tenant_id: null,
      p_slug: slug,
      p_name: name,
      p_schema_json: input.schema,
      p_success_action_json: input.successAction,
      p_auto_create_contact: true,
      p_pipeline_id: null,
      p_stage_id: null,
      p_id: input.formId,
    },
    "SAVE_FAILED",
  );

  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return { id: row.id, slug: row.slug ?? slug };
}

export interface FunnelStepInput {
  step_type: "page" | "form" | "thankyou";
  order_index: number;
  page_id?: string;
  form_id?: string;
}

export interface SaveFunnelInput {
  tenantId: string;
  slug: string;
  name: string;
  /** The RPC's own jsonb shape — no funnel_id/tenant_id; the function pins both. */
  steps: FunnelStepInput[];
  entryPageId?: string | null;
  /** Pass when re-saving — the upsert full-replaces the step list atomically. */
  id?: string | null;
}

export interface SavedFunnel {
  id: string;
  slug: string;
}

/** Create (or update) a funnel through growth_funnel_upsert — ONE atomic write; the RPC
 *  resolves every page/form reference server-side and refuses cross-tenant references. */
export async function saveFunnel(input: SaveFunnelInput): Promise<SavedFunnel> {
  const tenantId = requireTenant(input.tenantId);
  const slug = kebab(input.slug);
  if (!slug) throw studioError("INVALID_SLUG");
  const name = (input.name ?? "").trim();
  if (!name) throw studioError("SAVE_FAILED", null, "Give the funnel a name first.");
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw studioError("SAVE_FAILED", null, "Pick an entry page or a form step — a funnel needs at least one.");
  }

  const row = await rpc<{ id?: string } | null>(
    "growth_funnel_upsert",
    {
      p_tenant_id: null,
      p_slug: slug,
      p_name: name,
      p_goal: null,
      p_steps: input.steps,
      p_entry_page_id: input.entryPageId || null,
      p_success_page_id: null,
      p_id: input.id ?? null,
    },
    "SAVE_FAILED",
  );

  // Some upsert rails return the row, some return void — resolve the id by (tenant, slug)
  // when it isn't handed back, so a publish always has a real target (§13: never
  // report a save we can't point at).
  let id = row && typeof row === "object" && typeof row.id === "string" ? row.id : null;
  if (!id) {
    const { data, error } = await supabase
      .from("growth_funnels")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw toStudioError(error, "SAVE_FAILED");
    id = (data as { id?: string } | null)?.id ?? null;
  }
  if (!id) throw studioError("SAVE_FAILED", row);
  return { id, slug };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// AI funnel — the conversational funnel seam (§18/§19). A funnel is born from the SAME
// composer as everything else: classifyStudioIntent → "funnel" → draftFunnel() plans and
// drafts the whole thing (via growth-funnel-draft, which reuses the page + form drafters) →
// buildFunnelFromDraft() persists the real page/form/funnel rows; going live is the publish
// door's act (growth-publish-command). There is NO separate Funnel tab; this is the AI path
// FunnelMode never had, wired straight into the one Studio surface.
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface FunnelDraft {
  name: string;
  goal: string | null;
  /** The entry landing page, drafted by growth-page-draft — persisted with savePageDraft. */
  page: {
    title: string;
    brief: string;
    blocks: GrowthBlock[];
    theme: GrowthPageTheme | null;
    seo: StudioSeoDraft | null;
  };
  /** The intake form step, drafted by growth-form-draft — or null for a bare opt-in funnel. */
  form: {
    name: string;
    brief: string;
    schema: GrowthFormSchema;
  } | null;
}

/** One brief in, a complete drafted funnel out (§19). PURE DRAFT — writes nothing; the caller
 *  persists via buildFunnelFromDraft(). Unlike classifyStudioIntent this THROWS a structured
 *  StudioError on a real failure, so the shell surfaces the honest cause (§13), same as
 *  draftFormSchema/loadPageDraft. */
export async function draftFunnel(brief: string): Promise<FunnelDraft> {
  const trimmed = (brief ?? "").trim();
  if (trimmed.length < 5) throw studioError("EMPTY_BRIEF", null, "Give a brief: what's the funnel for, and who's it for?");

  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/growth-funnel-draft`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ brief: trimmed }),
    });
  } catch (err) {
    throw toStudioError(err, "GENERATION_FAILED");
  }

  const body = (await res.json().catch(() => null)) as
    | {
        name?: string;
        goal?: string | null;
        page?: Record<string, unknown>;
        form?: Record<string, unknown>;
        error?: unknown;
      }
    | null;
  const fnError = readFnError(body);
  if (fnError || !res.ok) {
    throw studioError("GENERATION_FAILED", fnError, fnError?.message ?? "Couldn't draft that funnel. Try again.");
  }

  const page = body?.page ?? {};
  if (!Array.isArray(page.blocks) || page.blocks.length === 0) {
    throw studioError("GENERATION_FAILED", body, "That didn't produce a usable funnel. Try giving the brief a bit more to work with.");
  }

  return {
    name: (typeof body?.name === "string" && body.name.trim()) || "New funnel",
    goal: typeof body?.goal === "string" && body.goal.trim() ? body.goal.trim() : null,
    page: {
      title: (typeof page.title === "string" && page.title.trim()) || "Landing page",
      brief: typeof page.brief === "string" ? page.brief : trimmed,
      blocks: page.blocks as GrowthBlock[],
      theme: (page.theme_json ?? null) as GrowthPageTheme | null,
      seo: (page.seo_json ?? null) as StudioSeoDraft | null,
    },
    form:
      body?.form && body.form.schema
        ? {
            name: (typeof body.form.name === "string" && body.form.name.trim()) || "Intake form",
            brief: typeof body.form.brief === "string" ? body.form.brief : "",
            schema: body.form.schema as GrowthFormSchema,
          }
        : null,
  };
}

export interface BuiltFunnelStep {
  kind: "page" | "form" | "thankyou";
  /** Display label for the flow card. */
  title: string;
  /** The persisted row id (page/form steps); null for the thank-you step. */
  refId: string | null;
  /** Live-readiness of this step, as the publish guard will judge it. */
  status: "draft" | "published" | "active" | "included";
}

export interface BuiltFunnel {
  funnelId: string;
  funnelSlug: string;
  name: string;
  goal: string | null;
  /** The entry page's real row — the cascade publishes this before the funnel. */
  pageId: string;
  pageSlug: string;
  pageStatus: "draft" | "published";
  formId: string | null;
  /** The intake form's slug — carried so a rebuild updates the SAME form row in place. */
  formSlug: string | null;
  /** Unresolved [ADD_…] blanks the generator left in the entry page (§15). While non-empty
   *  the funnel CANNOT publish — the publish guard hard-refuses these — so the caller must
   *  gate the act and tell the operator what to add, never arm a gold button that will fail. */
  pageBlanks: string[];
  steps: BuiltFunnelStep[];
}

/** The publish guard's two placeholder shapes (_growth_page_go_live). They are tested against each
 *  piece of text on its own, never against the serialized page: run over the whole JSON, the
 *  page's own brackets plus an ordinary word like "your" read as a blank. */
const PLACEHOLDER_TOKEN = /\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]/g;
const PLACEHOLDER_PROMPT = /\[[^\]]*\b(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\b[^\]]*\]/gi;

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}

/** The [ADD_…] / prompt-style blanks the page generator leaves when the brief lacked a real
 *  fact (§15) — exactly what the publish guard will refuse, so the funnel never arms a publish
 *  that will fail. */
function collectPlaceholders(value: unknown): string[] {
  const found = new Set<string>();
  for (const text of stringLeaves(value)) {
    for (const re of [PLACEHOLDER_TOKEN, PLACEHOLDER_PROMPT]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        found.add(m[0]);
        if (found.size >= 8) return [...found];
      }
    }
  }
  return [...found];
}

/** Persist a drafted funnel into REAL rows — the entry page (draft), the intake form (active),
 *  and the funnel itself with its wired steps. Returns the built funnel with honest per-step
 *  status so the canvas never claims a step is live before the publish door ships it.
 *
 *  Pass `existing` to REBUILD in place (the refine-by-re-briefing path): the same page/form/
 *  funnel rows are updated instead of INSERTing a fresh set — otherwise every refinement would
 *  strand orphan pages/forms/funnels in the tenant's libraries (§12). */
export async function buildFunnelFromDraft(input: {
  tenantId: string;
  draft: FunnelDraft;
  existing?: BuiltFunnel | null;
}): Promise<BuiltFunnel> {
  const tenantId = requireTenant(input.tenantId);
  const { draft, existing } = input;

  // 1. Entry page — a draft row (its own embedded signup form is auto-authored by the upsert).
  //    On rebuild, update the SAME row (keep its id + slug) rather than mint a new one.
  const pageSlug = existing?.pageSlug ?? (await uniqueGrowthPageSlug(tenantId, draft.page.title || draft.name));
  const page = await savePageDraft({
    tenantId,
    pageId: existing?.pageId ?? null,
    slug: pageSlug,
    title: draft.page.title || draft.name,
    blocks: draft.page.blocks,
    theme: draft.page.theme,
    seo: draft.page.seo,
  });

  // 2. Intake form step — created ACTIVE by growth_form_upsert (never a draft), so the only
  //    thing standing between the funnel and live is publishing the entry page. Reuse the
  //    existing form row on rebuild; only mint a new slug when the funnel gains a form.
  let formId: string | null = null;
  let formSlug: string | null = null;
  let formTitle = "";
  if (draft.form) {
    formSlug = existing?.formSlug ?? (await uniqueGrowthSlug("growth_forms", tenantId, draft.form.name));
    const form = await saveForm({
      tenantId,
      id: existing?.formId ?? null,
      slug: formSlug,
      name: draft.form.name,
      schema: draft.form.schema,
    });
    formId = form.id;
    formSlug = form.slug;
    formTitle = draft.form.name;
  }

  // 3. Wire the funnel — entry page → (form) → thank-you, the same three-step shape the
  //    manual FunnelMode builds, so an AI funnel and a hand-built one are one object.
  const steps: FunnelStepInput[] = [{ step_type: "page", order_index: 0, page_id: page.id }];
  if (formId) steps.push({ step_type: "form", order_index: steps.length, form_id: formId });
  steps.push({ step_type: "thankyou", order_index: steps.length });

  const funnelSlug = existing?.funnelSlug ?? (await uniqueGrowthSlug("growth_funnels", tenantId, draft.name));
  const funnel = await saveFunnel({
    tenantId,
    id: existing?.funnelId ?? null,
    slug: funnelSlug,
    name: draft.name,
    steps,
    entryPageId: page.id,
  });

  // Any [ADD_…] blank in the drafted page is a hard publish blocker (§15) — surface it, don't
  // arm a publish that the server will refuse.
  const pageBlanks = collectPlaceholders(draft.page.blocks).concat(collectPlaceholders(draft.page.seo));
  const uniqueBlanks = [...new Set(pageBlanks)].slice(0, 8);

  const builtSteps: BuiltFunnelStep[] = [
    { kind: "page", title: page.title || draft.page.title, refId: page.id, status: "draft" },
  ];
  if (formId) builtSteps.push({ kind: "form", title: formTitle, refId: formId, status: "active" });
  builtSteps.push({ kind: "thankyou", title: "Thank you", refId: null, status: "included" });

  return {
    funnelId: funnel.id,
    funnelSlug: funnel.slug,
    name: draft.name,
    goal: draft.goal,
    pageId: page.id,
    pageSlug: page.slug,
    pageStatus: "draft",
    formId,
    formSlug,
    pageBlanks: uniqueBlanks,
    steps: builtSteps,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Sessions — the projects HOME lifecycle (§10 Paige-callable, Slice 2).
//
// A studio SESSION (studio_sessions) is one authoring project the operator returns to. This is
// the seam the gallery, the builder, and Paige all drive: create → list → resume (touch +
// hydrate) → rename/star/status → link an artifact on save. Every function wraps ONE of the
// SECURITY DEFINER RPCs through the same rpc<T>() helper the page seam uses; p_tenant_id is
// always passed null so the server pins a JWT caller to their own tenant (IDOR-safe, §9), while
// requireTenant() still fails platform staff with no active workspace loudly first.
//
// A session never stores artifact CONTENT — only typed refs into growth_*/marketing_content
// (§18: HOME lists sessions, GrowthHub lists the artifact rows; they never list the same
// object). copy/image both persist as the 'content' kind; page/form/funnel pass through.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** The studio_sessions row exactly as the RPCs return it (snake_case, pre-generated-types). */
interface StudioSessionRow {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  title: string;
  seed_brief: string | null;
  status: string;
  starred: boolean;
  thumbnail_url: string | null;
  transcript: unknown;
  artifact_refs: unknown;
  is_template: boolean;
  last_opened_at: string;
  created_at: string;
  updated_at: string;
}

/** studio 'image' persists as the marketing_content 'content' kind; the rest pass through. This
 *  is the ONE place the mode→manifest mapping lives (§18). Standalone copy is no longer a Studio
 *  artifact type (§18/§21), so it isn't a key here — legacy saved-copy rows still persist as
 *  'content' and are handled read-only on the read path (studioTypeFromRef below). */
const SESSION_KIND_FROM_TYPE: Record<StudioArtifactType, SessionArtifactKind> = {
  page: "page",
  form: "form",
  funnel: "funnel",
  image: "content",
};

/** A persisted ref's kind → the studio type used for glyphs. 'content' is now backed only by the
 *  image type (copy is no longer a Studio artifact), so every 'content' ref reads as an image —
 *  a LEGACY thumbnail-less copy row therefore shows an image glyph on its gallery card. This is
 *  decorative-only (cosmetic, never load-bearing), documented, and the graceful degrade for the
 *  handful of pre-existing copy rows that may exist pre-launch (§13). */
function studioTypeFromRef(ref: SessionArtifactRef): StudioArtifactType {
  switch (ref.kind) {
    case "page":
      return "page";
    case "form":
      return "form";
    case "funnel":
      return "funnel";
    case "content":
    default:
      return "image";
  }
}

const SESSION_ARTIFACT_KINDS: readonly SessionArtifactKind[] = ["page", "form", "funnel", "content"];

/** Narrow one jsonb artifact_refs element into a typed ref, or null if it isn't one — a
 *  tombstoned/garbled entry is skipped, never thrown on (§13, compliance: tolerate bad refs). */
function parseArtifactRef(value: unknown): SessionArtifactRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  const id = v.id;
  if (typeof id !== "string" || typeof kind !== "string") return null;
  if (!SESSION_ARTIFACT_KINDS.includes(kind as SessionArtifactKind)) return null;
  return {
    kind: kind as SessionArtifactKind,
    id,
    title: typeof v.title === "string" ? v.title : "",
    slug: typeof v.slug === "string" ? v.slug : null,
    thumbnailUrl: typeof v.thumbnail_url === "string" ? v.thumbnail_url : null,
    addedAt: typeof v.added_at === "string" ? v.added_at : null,
  };
}

function parseArtifactRefs(value: unknown): SessionArtifactRef[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseArtifactRef).filter((r): r is SessionArtifactRef => r !== null);
}

const SESSION_STATUSES: readonly StudioSessionStatus[] = ["draft", "building", "published", "archived"];

function toSessionStatus(value: string): StudioSessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value)
    ? (value as StudioSessionStatus)
    : "draft";
}

/** The one row→meta projection every session function returns through. */
function rowToSessionMeta(row: StudioSessionRow): StudioSessionMeta {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id ?? null,
    title: row.title || "Untitled project",
    seedBrief: row.seed_brief ?? null,
    status: toSessionStatus(row.status),
    starred: !!row.starred,
    thumbnailUrl: row.thumbnail_url ?? null,
    isTemplate: !!row.is_template,
    transcript: Array.isArray(row.transcript) ? row.transcript : [],
    artifacts: parseArtifactRefs(row.artifact_refs),
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The gallery card projection — the multi-artifact glyph row + cover glyph, computed once. */
function rowToSessionCard(row: StudioSessionRow): StudioSessionCard {
  const artifacts = parseArtifactRefs(row.artifact_refs);
  const kinds: StudioArtifactType[] = [];
  for (const ref of artifacts) {
    const t = studioTypeFromRef(ref);
    if (!kinds.includes(t)) kinds.push(t);
  }
  // Cover resolution (#7): prefer the session's own captured cover, then fall back to the first
  // artifact ref that carries a real asset (an image/content ref seeds thumbnail_url from
  // marketing_content.image_url; a page ref can carry a preview). `find` walks refs in order, so
  // the PRIMARY ref (artifacts[0]) wins, then any later ref — the projection no longer drops a
  // real image on the floor and renders a glyph over it. Genuinely-empty sessions stay null and
  // get the premium branded placeholder in ProjectCard.
  const coverFromRef = artifacts.find((a) => a.thumbnailUrl)?.thumbnailUrl ?? null;
  return {
    id: row.id,
    title: row.title || "Untitled project",
    seedBrief: row.seed_brief ?? null,
    starred: !!row.starred,
    status: toSessionStatus(row.status),
    isTemplate: !!row.is_template,
    thumbnailUrl: row.thumbnail_url ?? coverFromRef,
    primaryKind: artifacts.length > 0 ? studioTypeFromRef(artifacts[0]) : null,
    artifactKinds: kinds,
    lastEditedAt: row.updated_at,
  };
}

/** Spin up a fresh project — the home composer's "new". Persists seed_brief server-side so the
 *  brief survives a reload (durable resume, §19). Returns the row so the caller routes into the
 *  builder at /admin/studio/:id. */
export async function createStudioSession(input: {
  tenantId: string;
  title?: string;
  seedBrief?: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "create_studio_session",
    {
      p_title: input.title?.trim() || null,
      p_seed_brief: input.seedBrief?.trim() || null,
      p_transcript: [],
      p_is_template: false,
      p_tenant_id: null,
      p_owner_user_id: null,
    },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** The gallery feed — one grid under four filter views (recent|mine|starred|templates). */
export async function listStudioSessions(input: {
  tenantId: string;
  view: StudioSessionView;
  limit?: number;
}): Promise<StudioSessionCard[]> {
  requireTenant(input.tenantId);
  const rows = await rpc<StudioSessionRow[] | null>(
    "list_studio_sessions",
    { p_filter: input.view, p_tenant_id: null, p_limit: input.limit ?? 60 },
    "UNKNOWN",
  );
  return (rows ?? []).map(rowToSessionCard);
}

/** The resumable session payload — the session meta, its manifest, and the hydrated PRIMARY
 *  artifact (a page, delegated to loadPageDraft — never reimplemented). */
export interface LoadedSession {
  session: StudioSessionMeta;
  artifacts: SessionArtifactRef[];
  /** The hydrated primary when it is a PAGE; null for a zero-artifact session or a non-page
   *  primary (v1 hydrates only pages into the canvas; other kinds resolve in a later slice). */
  primary: LoadedPageDraft | null;
  primaryType: StudioArtifactType | null;
}

/**
 * Open a session in the builder (§10/§19). Stamps recency (touch_studio_session, server-side so
 * a read can't spoof it) and returns the row, then hydrates the primary artifact by DELEGATING
 * to loadPageDraft for a page — loadPageDraft stays the artifact-level primitive; loadSession
 * composes it. A tombstoned/unresolvable primary ref is tolerated (primary stays null, no
 * throw). Throws NOT_FOUND (hard stop) on a missing/cross-tenant session, exactly like
 * loadPageDraft, so the builder renders the operator-safe "couldn't find that project" gate.
 */
export async function loadSession(input: {
  tenantId: string;
  sessionId: string;
}): Promise<LoadedSession> {
  const tenantId = requireTenant(input.tenantId);
  if (!input.sessionId) throw studioError("NOT_FOUND");

  // touch RETURNS the row — recency stamp + read in one guarded call.
  const row = await rpc<StudioSessionRow | null>(
    "touch_studio_session",
    { p_id: input.sessionId, p_tenant_id: null },
    "NOT_FOUND",
  );
  if (!row?.id) throw studioError("NOT_FOUND");
  const session = rowToSessionMeta(row);

  const primaryRef = session.artifacts[0] ?? null;
  let primary: LoadedPageDraft | null = null;
  let primaryType: StudioArtifactType | null = null;
  if (primaryRef) {
    primaryType = studioTypeFromRef(primaryRef);
    if (primaryRef.kind === "page") {
      try {
        primary = await loadPageDraft({ tenantId, pageId: primaryRef.id });
      } catch (err) {
        // The underlying page was deleted from its library — a tombstoned ref. The session
        // still opens (to its composer), it just can't hydrate a page that no longer exists.
        console.warn("[studio] session primary page ref no longer resolvable:", err);
        primary = null;
      }
    }
  }
  return { session, artifacts: session.artifacts, primary, primaryType };
}

/** Standalone recency bump — loadSession also touches; this is the headless/Paige resume path. */
export async function touchStudioSession(input: {
  tenantId: string;
  sessionId: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "touch_studio_session",
    { p_id: input.sessionId, p_tenant_id: null },
    "NOT_FOUND",
  );
  if (!row?.id) throw studioError("NOT_FOUND");
  return rowToSessionMeta(row);
}

/**
 * Derive a human project name from what a generation actually produced — so a Studio project is
 * never left as "Untitled" the moment it has real content (#294). Preference order, best first:
 *   1. the generated page's own SEO/hero title (`seo.title`) — already a crafted, specific line;
 *   2. failing that, the operator's brief, trimmed to its first clause and sentence-cased — a
 *      real signal of intent, not a placeholder.
 * Returns "" when there is genuinely nothing real to name from (empty, or punctuation-only with no
 * word character) — the caller then SKIPS the rename and the row keeps its "Untitled" display
 * fallback, rather than persisting a junk title. All paths collapse whitespace and cap the length
 * on a word + code-point boundary (never mid-word, never a split astral char) so a runaway title
 * can't bloat the rail or the gallery card, and a trailing emoji can't become a mojibake glyph.
 */
export function deriveProjectName(
  seoTitle: string | null | undefined,
  brief: string | null | undefined,
): string {
  const clean = (s: string | null | undefined) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);
  // Cap to `max` characters counting by code point (Array.from splits astral chars whole), and
  // prefer to end on a whole word — trim back to the last space unless that throws away most of
  // the string (a single very long word still gets a clean hard cut).
  const capLen = (s: string, max: number) => {
    const chars = Array.from(s);
    if (chars.length <= max) return s;
    const sliced = chars.slice(0, max).join("");
    const lastSpace = sliced.lastIndexOf(" ");
    return (lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim();
  };

  const seo = clean(seoTitle);
  if (seo && hasWord(seo)) return capLen(seo, 80);

  const b = clean(brief);
  if (b && hasWord(b)) {
    // First clause/sentence of the brief — a real title beats echoing the whole prompt.
    const firstClause = b.split(/[.!?\n]/)[0].trim();
    return cap(capLen(firstClause || b, 60));
  }
  return "";
}

/** Retitle the project — called on first artifact save to name it from the real artifact. */
export async function renameStudioSession(input: {
  tenantId: string;
  sessionId: string;
  title: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "rename_studio_session",
    { p_id: input.sessionId, p_title: input.title, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Flip the gallery star (owner's per-project flag — NOT a gold act, §11). */
export async function setSessionStarred(input: {
  tenantId: string;
  sessionId: string;
  starred: boolean;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "set_studio_session_starred",
    { p_id: input.sessionId, p_starred: input.starred, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Set the project's gallery cover directly (§10 Paige-callable seam — Studio Task #295).
 *  Unlike link_session_artifact's COALESCE(thumbnail_url, _thumb) derivation — which seeds a
 *  cover ONCE and never overwrites it — this SETs the column outright, so a rebuilt page
 *  refreshes its preview. Tenant-scoped + owner/admin-gated server-side, same as the sibling
 *  session mutations. */
export async function setSessionThumbnail(input: {
  tenantId: string;
  sessionId: string;
  thumbnailUrl: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "set_studio_session_thumbnail",
    { p_id: input.sessionId, p_thumbnail_url: input.thumbnailUrl, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Lifecycle (archive/restore) — the reversible "retire this project" path. */
export async function setSessionStatus(input: {
  tenantId: string;
  sessionId: string;
  status: StudioSessionStatus;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "set_studio_session_status",
    { p_id: input.sessionId, p_status: input.status, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/**
 * Permanently delete a project (§10 Paige-callable, hard delete).
 *
 * Two delete tiers exist on ONE seam, both tenant-scoped + owner/admin-gated + audited
 * server-side (§9/§13), so there is no second, unfenced write path:
 *   • RECOVERABLE (preferred) — setSessionStatus(…, 'archived'): the project drops out of
 *     every gallery view (list_studio_sessions filters status <> 'archived') and can be
 *     restored. This is what the gallery's "Delete" wires to, so an accidental delete is
 *     never a data loss.
 *   • PERMANENT (this) — delete_studio_session: the row is GONE, no restore. Exposed for the
 *     explicit "delete permanently" act (and for Paige to call headlessly). Returns the
 *     deleted id so a caller only reports success on a delete that actually happened (§13).
 *
 * p_tenant_id is null on purpose — the RPC pins a JWT caller to their own tenant server-side
 * (IDOR-safe), while requireTenant() still fails platform staff with no active workspace loudly.
 */
export async function deleteStudioSession(input: {
  tenantId: string;
  sessionId: string;
}): Promise<string> {
  requireTenant(input.tenantId);
  if (!input.sessionId) throw studioError("NOT_FOUND");
  const id = await rpc<string | null>(
    "delete_studio_session",
    { p_id: input.sessionId, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!id) throw studioError("SAVE_FAILED", id);
  return id;
}

/** Persist the composer transcript (§19). The RPC ships in v1; per-turn UI wiring is a later
 *  slice — this exposes the durable seam now so Paige/headless callers can already use it. */
export async function setSessionTranscript(input: {
  tenantId: string;
  sessionId: string;
  transcript: unknown[];
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "set_studio_session_transcript",
    { p_id: input.sessionId, p_transcript: input.transcript ?? [], p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Attach a saved artifact to the session at SAVE time (idempotent, dedups on kind+id, derives
 *  the session cover). IDOR-safe server-side (the artifact must live in the same tenant). */
export async function linkSessionArtifact(input: {
  tenantId: string;
  sessionId: string;
  artifactType: StudioArtifactType;
  artifactId: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "link_session_artifact",
    {
      p_session_id: input.sessionId,
      p_kind: SESSION_KIND_FROM_TYPE[input.artifactType],
      p_artifact_id: input.artifactId,
      p_tenant_id: null,
    },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** The ?pageId deep-link shim (blocking #5): returns the caller's existing session wrapping this
 *  artifact, else mints + links + renames one. Idempotent — repeated "Edit in Studio" clicks
 *  resolve to the SAME session. Lets legacy deep-links open in the builder, not the gallery. */
export async function ensureSessionForArtifact(input: {
  tenantId: string;
  kind: StudioArtifactType;
  artifactId: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "ensure_studio_session_for_artifact",
    {
      p_kind: SESSION_KIND_FROM_TYPE[input.kind],
      p_artifact_id: input.artifactId,
      p_tenant_id: null,
    },
    "NOT_FOUND",
  );
  if (!row?.id) throw studioError("NOT_FOUND", row);
  return rowToSessionMeta(row);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// The artifact-MANIFEST seam (Slice 1 of the multi-page redesign).
//
// A project (session) holds MANY artifacts in its artifact_refs manifest. These functions are
// how the UI — and Paige (§10) — open ANY of them onto the stage and manage the manifest:
// open one, mint a blank one, remove one from the project (never from its library, §9), reorder,
// or relabel it project-locally. The four mutations bottom out in the DEFINER RPCs from the
// studio_manifest_ops migration (studio_role_ok-gated, tenant-pinned, owner-or-admin, audited);
// each RETURNs the fresh row so the caller can hand it to useActiveStudioSession.applyMeta and
// the rail + stage re-render in lockstep — no split source of truth.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** ONE artifact hydrated for the editor stage. Page + form resolve their real content here;
 *  funnel + content (and a slug-less form) open their mode carrying just the ref — the mode
 *  component runs its own loader. A tombstoned ref (underlying row gone) resolves to
 *  `{ …, missing: true }`, so the editor shows an honest "no longer available" state, never a
 *  throw (§13). `studioTypeFromRef` supplies the glyph/type. */
export type OpenedArtifact =
  | { kind: "page"; type: StudioArtifactType; ref: SessionArtifactRef; page: LoadedPageDraft }
  | { kind: "form"; type: StudioArtifactType; ref: SessionArtifactRef; form: FormDeliveryRecord }
  | { kind: SessionArtifactKind; type: StudioArtifactType; ref: SessionArtifactRef; missing?: boolean };

/** Hydrate one artifact ref onto the stage. Generalizes loadSession's single-primary-page
 *  hydrate into a kind→loader dispatch, so the editor can open ANY artifact in the project, not
 *  just the first page. Reads are RLS-scoped; no mutation. */
export async function openSessionArtifact(input: {
  tenantId: string;
  ref: SessionArtifactRef;
}): Promise<OpenedArtifact> {
  const tenantId = requireTenant(input.tenantId);
  const ref = input.ref;
  const type = studioTypeFromRef(ref);
  try {
    if (ref.kind === "page") {
      const page = await loadPageDraft({ tenantId, pageId: ref.id });
      return { kind: "page", type, ref, page };
    }
    if (ref.kind === "form" && ref.slug) {
      const form = await loadFormBySlug(tenantId, ref.slug);
      if (form) return { kind: "form", type, ref, form };
    }
  } catch (err) {
    // The underlying library row was deleted — a tombstoned ref. Open to an honest empty state.
    console.warn("[studio] artifact ref no longer resolvable:", err);
    return { kind: ref.kind, type, ref, missing: true };
  }
  // funnel / content (or a form with no slug) — the mode component hydrates from the ref itself.
  return { kind: ref.kind, type, ref };
}

/** Hydrate a DOCUMENT (#119/#292) for the canvas — fetch the marketing_content row (kind='document')
 *  and parse its structured block JSON. Tenant-scoped (explicit filter + RLS, §9). Returns null if the
 *  row is gone or isn't a document (never throws — the canvas falls back to an honest empty, §13). */
export async function loadDocument(tenantId: string, contentId: string): Promise<StudioDocument | null> {
  const tid = requireTenant(tenantId);
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; title: string | null; body: string | null; kind: string } | null; error: unknown }> } } };
    };
  })
    .from("marketing_content")
    .select("id, title, body, kind")
    .eq("id", contentId)
    .eq("tenant_id", tid)
    .maybeSingle();
  if (error || !data || data.kind !== "document") return null;
  return parseStudioDocument(data.id, data.title, data.body);
}


/** A reopened COPY/text artifact — the plain saved words for a read-only in-session view (#290).
 *  Copy is a chat deliverable (§21), not a designed canvas asset, so the canvas renders its REAL text
 *  and never a fabricated "preview" (§13). */
export interface StudioCopy { id: string; title: string; body: string }

/** Hydrate a COPY (marketing_content kind='text') for a read-only in-session view. Tenant-scoped
 *  (explicit filter + RLS, §9). The `kind='text'` filter is load-bearing: it's only reached after
 *  loadDocument returned null + the ref carries no thumbnail, but loadDocument ALSO returns null for a
 *  document row with corrupt blocks — without this filter that row's raw block JSON would render
 *  mislabeled as "Copy" (§11 no-raw-JSON / §13). Null on miss/empty → the canvas leaves the stage
 *  as-is, never throws. */
export async function loadContent(tenantId: string, contentId: string): Promise<StudioCopy | null> {
  const tid = requireTenant(tenantId);
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; title: string | null; body: string | null } | null; error: unknown }> } } } };
    };
  })
    .from("marketing_content")
    .select("id, title, body")
    .eq("id", contentId)
    .eq("tenant_id", tid)
    .eq("kind", "text")
    .maybeSingle();
  if (error || !data || !data.body?.trim()) return null;
  return { id: data.id, title: data.title || "Untitled copy", body: data.body };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Version stacking (#331) — the append-only history seam (§10 Paige-callable, §9 tenant-pinned).
// list/restore travel the SECURITY DEFINER RPCs; save runs server-side in the edge fn on every
// session-bound write, so the client never has to author a snapshot.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** The studio_artifact_versions row exactly as the RPCs return it (snake_case). `snapshot` is the
 *  self-contained content payload — never rendered client-side (revert replays it server-side), so
 *  it's left as `unknown` and not mapped onto the camel type. */
interface StudioArtifactVersionRow {
  id: string;
  tenant_id: string;
  session_id: string;
  kind: string;
  lineage_id: string;
  version_no: number;
  is_current: boolean;
  snapshot: unknown;
  title: string | null;
  thumbnail_url: string | null;
  created_by: string | null;
  created_at: string;
}

function rowToArtifactVersion(row: StudioArtifactVersionRow): ArtifactVersion {
  return {
    id: row.id,
    versionNo: row.version_no,
    isCurrent: !!row.is_current,
    kind: (["page", "form", "funnel", "content"].includes(row.kind) ? row.kind : "content") as SessionArtifactKind,
    lineageId: row.lineage_id,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    createdAt: row.created_at,
  };
}

/** The version stack for one artifact inside one session, newest first (as the RPC orders it).
 *  Tenant-pinned + RLS-gated (§9). Returns [] on any miss — the strip simply doesn't render a
 *  history it can't prove (§13 — never a fabricated version). */
export async function listArtifactVersions(input: {
  tenantId: string;
  sessionId: string;
  kind: SessionArtifactKind;
  artifactId: string;
}): Promise<ArtifactVersion[]> {
  const tenantId = requireTenant(input.tenantId);
  if (!input.sessionId || !input.artifactId) return [];
  try {
    const rows = await rpc<StudioArtifactVersionRow[] | null>(
      "list_artifact_versions",
      { p_session_id: input.sessionId, p_kind: input.kind, p_artifact_id: input.artifactId, p_tenant_id: tenantId },
      "NOT_FOUND",
    );
    return (rows ?? []).map(rowToArtifactVersion);
  } catch (err) {
    console.warn("[studio] list versions failed (non-fatal):", err);
    return [];
  }
}

/** Restore a past version: replays its snapshot back into the live library row and moves the
 *  is_current pointer to it (append-only — no history is deleted, §13). §13-HONEST boolean: resolves
 *  true ONLY on a real server persist; a forbidden/unsupported/miss returns false so the UI never
 *  claims a revert that didn't happen. (page + content restore ship now; funnel/form is a tracked
 *  follow-up and returns false with a logged reason, §19.) */
export async function restoreArtifactVersion(input: {
  tenantId: string;
  versionId: string;
}): Promise<boolean> {
  requireTenant(input.tenantId);
  if (!input.versionId) return false;
  try {
    const row = await rpc<StudioArtifactVersionRow | null>(
      "restore_artifact_version",
      { p_version_id: input.versionId, p_tenant_id: input.tenantId },
      "EDIT_FAILED",
    );
    return !!row?.id;
  } catch (err) {
    console.warn("[studio] restore version failed (non-fatal):", err);
    return false;
  }
}

/** Remove an artifact from THIS project's manifest. Never deletes the underlying library row
 *  (§9) — the artifact stays in its growth_ or marketing_content library. RETURNs the session. */
export async function unlinkSessionArtifact(input: {
  tenantId: string;
  sessionId: string;
  kind: SessionArtifactKind;
  artifactId: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "unlink_session_artifact",
    { p_session_id: input.sessionId, p_kind: input.kind, p_artifact_id: input.artifactId, p_tenant_id: null },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Reorder the project's manifest. `order` names the desired sequence; refs it omits keep their
 *  order at the end, and ids that aren't already linked are ignored (no injection). */
export async function reorderSessionArtifacts(input: {
  tenantId: string;
  sessionId: string;
  order: { kind: SessionArtifactKind; id: string }[];
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "reorder_session_artifacts",
    {
      p_session_id: input.sessionId,
      p_ordered_refs: input.order.map((o) => ({ kind: o.kind, id: o.id })),
      p_tenant_id: null,
    },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Mint a blank artifact of `type` in the tenant's library AND link it to the project in one
 *  atomic call (§10 — Paige: "add a page to this project"). The composer's classify→draft→link
 *  path is still the DEFAULT way to add (§18: one conversation, no type picker); this is the
 *  explicit programmatic mint for a blank start. */
export async function createSessionArtifact(input: {
  tenantId: string;
  sessionId: string;
  type: StudioArtifactType;
  title?: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "create_session_artifact",
    {
      p_session_id: input.sessionId,
      p_kind: SESSION_KIND_FROM_TYPE[input.type],
      p_seed: input.title?.trim() ? { title: input.title.trim() } : {},
      p_tenant_id: null,
    },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}

/** Set a PROJECT-LOCAL label on one artifact ref (its name as it appears in this project). Does
 *  not rename the underlying library row (§9). */
export async function renameSessionArtifactRef(input: {
  tenantId: string;
  sessionId: string;
  kind: SessionArtifactKind;
  artifactId: string;
  label: string;
}): Promise<StudioSessionMeta> {
  requireTenant(input.tenantId);
  const row = await rpc<StudioSessionRow | null>(
    "rename_session_artifact_ref",
    {
      p_session_id: input.sessionId,
      p_kind: input.kind,
      p_artifact_id: input.artifactId,
      p_label: input.label,
      p_tenant_id: null,
    },
    "SAVE_FAILED",
  );
  if (!row?.id) throw studioError("SAVE_FAILED", row);
  return rowToSessionMeta(row);
}
