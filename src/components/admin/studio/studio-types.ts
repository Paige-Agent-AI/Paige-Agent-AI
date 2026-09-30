// The Vibe Studio's shared state contract.
//
// Every studio component and the generation hook key off these types, so the shape of a run,
// an error, and the page under construction is defined in exactly ONE place. Types + two
// frozen-by-convention constants only — no React, no IO, no copy (copy lives in
// studio-copy.ts so the §2/§3 audit has a single surface to read).
import type { GrowthAsset, GrowthBlock, GrowthFormSchema, GrowthPageTheme } from "@/lib/growth";

/**
 * The Studio's four outputs — one workspace, four creation modes. `page` is the
 * original Vibe Studio; `image` is the absorbed Content Studio's creative surface
 * (social graphics, static visuals); `funnel` and `form` are the structured builders.
 * `copy` is NOT a Studio mode — standalone words (a post, email, ad) are a Paige-chat
 * capability (§18/§21), and copy inside a page/funnel/form is an embedded-quality
 * property of that asset. The tab param carries this (/admin/studio?mode=…) so every
 * mode is deep-linkable.
 */
export type StudioMode = "page" | "funnel" | "form" | "image";

export const STUDIO_MODES: readonly StudioMode[] = ["page", "funnel", "form", "image"];

export function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && (STUDIO_MODES as readonly string[]).includes(value);
}

/** One toolbar action a mode publishes into the Studio top bar (Save / the gold act). */
export interface StudioBarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

/** What a mounted mode contributes to the top bar. `act` is the ONE gold button. */
export interface ModeToolbarState {
  save?: StudioBarAction;
  act?: StudioBarAction;
}

/** compose = blank brief · clarifying = grounding the brief before a model call is spent ·
 *  generating = a run is in flight · canvas = blocks on the board.
 *  (Page-mode only — the other modes hold their own local state.) */
export type PageCanvasMode = "compose" | "clarifying" | "generating" | "canvas";

export type DeviceFrame = "desktop" | "mobile";

/** The five running phases each name real work the seam genuinely performs — never a
 *  decorative step invented to fill a progress bar (§13). */
export type GenerationPhase =
  | "idle"
  | "brief"
  | "brand"
  | "drafting"
  | "validating"
  | "composing"
  | "done"
  | "error";

export type StudioErrorCode =
  | "NO_TENANT"
  | "NO_TENANT_SLUG"
  | "EMPTY_BRIEF"
  | "GENERATION_FAILED"
  | "GENERATION_CANCELLED"
  | "INVALID_BLOCKS"
  | "NO_DRAFT"
  | "UNRESOLVED_PLACEHOLDER"
  | "FORM_MISSING"
  | "INVALID_SLUG"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "SAVE_FAILED"
  | "PUBLISH_FAILED"
  | "EDIT_FAILED"
  | "UNKNOWN";

/**
 * The ONE error shape the Studio renders.
 *
 * `message` is operator copy — a sentence in the product's voice. A raw `GROWTH_*` code, a
 * table name, or a function name never reaches it (§11); STUDIO_ERROR_COPY is what maps
 * those away. The real, unedited cause is preserved on `cause` (and logged) so a defect is
 * still diagnosable — structured, never swallowed (§13).
 */
export interface StudioError {
  code: StudioErrorCode;
  /** Operator-facing sentence. Mogul voice. No codes, tables, or function names (§11). */
  message: string;
  /** True when the operator can fix it and retry; false = a hard stop. */
  recoverable: boolean;
  /** The original error, verbatim. For logs and tests — never rendered. */
  cause?: unknown;
}

export interface StudioSeoDraft {
  title?: string;
  description?: string;
}

/** The five creative types the Media Library curates (#284). A saved library row points at the
 *  real source in its own store — page/funnel/form → growth_*, image/copy → marketing_content —
 *  never a copy of the content (§18 one home). */
export type LibraryKind = "page" | "funnel" | "form" | "image" | "video" | "copy";

/** One kept-in-the-library artifact, as list_library returns it: a display snapshot + a typed
 *  pointer back to the live source. A row whose source was deleted still renders (its kept title
 *  as a tombstone) — the library never shows a broken card (§13). */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  artifactId: string;
  title: string;
  thumbnailUrl: string | null;
  note: string | null;
  tags: string[];
  savedAt: string;
}

/** A seed brief the operator can drop into the composer and edit. No hidden templates —
 *  what the chip drops in is exactly what Paige is asked (§15). */
export interface IntentChip {
  id: string;
  label: string;
  seed: string;
}

export interface GenerationState {
  phase: GenerationPhase;
  /** Epoch ms the run started; null when idle. */
  startedAt: number | null;
  /** Ticks every 250ms while running. The ONLY numeric progress we show — because it's true. */
  elapsedMs: number;
  /** Blocks materialized SO FAR. The canvas draws these through the REAL <GrowthBlocks>. */
  emitted: GrowthBlock[];
  /** Total block count. Known only once the draft payload lands. Never estimated. */
  total: number | null;
  /** Honest one-line narration for the current phase (§3). Never "Loading…". */
  note: string;
  error: StudioError | null;
}

export const EMPTY_GENERATION: GenerationState = {
  phase: "idle",
  startedAt: null,
  elapsedMs: 0,
  emitted: [],
  total: null,
  note: "",
  error: null,
};

/** One pre-generation grounding question (§15) — a fixed `id` so an answer keyed against it
 *  survives being folded into the brief (or, for the questionnaire-fields question, sent on
 *  its own as `questionnaire_answer`). */
export interface ClarifyingQuestion {
  id: string;
  question: string;
  placeholder?: string;
  /** Predictive answer chips (#296) — the likely answers offered as one-tap fills, like the
   *  platform's own AskUserQuestion. Tapping one writes it into the answer; the free-text box is
   *  always the "Other / refine" path, so a chip is a shortcut, never a cage. Omit for questions
   *  (e.g. "list your real questionnaire fields") where a curated set can't stand in for typing. */
  options?: string[];
}

/** The clarifying step's own state: which questions are on screen (3, or 4 when the brief
 *  signaled a real questionnaire) and what the operator has typed for each so far. */
export interface ClarifyingState {
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
}

export const EMPTY_CLARIFYING: ClarifyingState = { questions: [], answers: {} };

// ═══════════════════════════════════════════════════════════════════════════════════════
// Sessions — the projects HOME layer (Slice 2).
//
// A studio SESSION is one authoring project (studio_sessions). It wraps today's single-primary
// artifact flow and is multi-artifact in the DATA model (the artifact_refs manifest). These
// types are the shared contract between the callable seam (studio.ts), the gallery hook, and
// the builder — defined here so the shape lives in exactly ONE place, like every other studio
// type. §2/§9: nothing here is vertical or finance-specific; it is generic authoring state.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** The four artifact TYPES a session can author — the studio's own modes. (Standalone copy is a
 *  Paige-chat capability, never a Studio artifact type — §18/§21.) */
export type StudioArtifactType = "page" | "form" | "funnel" | "image";

/** The kind as PERSISTED in the manifest / accepted by link_session_artifact. 'image' persists as
 *  'content' (marketing_content); page/form/funnel pass through. LEGACY copy rows also persist as
 *  'content' — kept in the union so a pre-existing saved-copy ref parses and degrades gracefully
 *  (listed read-only), never orphaned or thrown on (§13). */
export type SessionArtifactKind = "page" | "form" | "funnel" | "content";

/** #119/#292/#319 — a long-form DOCUMENT the design agent authored (guide, one-pager, ebook, checklist,
 *  worksheet, proposal). It persists as a marketing_content row kind='document' whose body carries this
 *  shape as JSON, and links to the session under the existing manifest kind='content' (§18 — no new
 *  store/kind). The renderer draws these blocks as a premium, book/one-pager-grade document on the studio
 *  canvas. Each doc_type has a distinct block skeleton (encoded in the document_generate tool) so a
 *  worksheet/ebook/proposal stops degrading into a generic guide. */
export type StudioDocType = "guide" | "one_pager" | "ebook" | "checklist" | "worksheet" | "proposal" | "offer_letter" | "sales_offer" | "agreement_draft";

/** One designed unit of a document — the block vocabulary the agent authors and the renderer draws.
 *  A permissive shape (all fields optional beyond `type`) so a slightly-off block from the model
 *  degrades to a sensible render instead of throwing (§13). The #319 additions make worksheet/ebook/
 *  proposal genuinely first-class: `worksheet-field` is a REAL printable blank the user fills in,
 *  `chapter-divider` is the ebook signature, `toc` a table of contents, `pricing-table` a proposal's
 *  line-item investment table (a generic $ amount — §2: never lending/credit). Image/figure blocks
 *  stay out of scope this slice (image generation is off without a key). */
export type StudioDocBlock =
  | { type: "cover"; eyebrow?: string; title: string; subhead?: string }
  | { type: "section-header"; number?: number; kicker?: string; title: string }
  | { type: "chapter-divider"; number?: number; kicker?: string; title: string; subhead?: string }
  | { type: "toc"; title?: string; entries?: string[] }
  | { type: "prose"; markdown: string }
  | { type: "callout"; variant?: "tip" | "warning" | "key-insight" | "definition" | "example" | "do-this"; title?: string; body: string }
  | { type: "pull-quote"; quote: string; attribution?: string }
  | { type: "list"; style?: "bullet" | "numbered" | "checklist"; items: string[] }
  | { type: "stat"; value: string; label: string }
  | {
      type: "worksheet-field";
      /** The kind of blank: one ruled line, N ruled lines, an open box, a numbered rating scale, or a
       *  check + blank. Defaults to "lines" when omitted/unknown so a bare field still renders real. */
      field?: "line" | "lines" | "box" | "scale" | "checkbox";
      /** The prompt/question printed above the blank — what the user is answering. */
      label: string;
      helper?: string;
      /** "lines": how many ruled lines to draw (clamped 1–12; default 3). */
      lines?: number;
      /** "scale": the numbered endpoints (default 1–5) and their anchor captions. */
      scaleMin?: number;
      scaleMax?: number;
      minLabel?: string;
      maxLabel?: string;
    }
  | {
      type: "pricing-table";
      caption?: string;
      /** Line items — `amount` is a plain currency string the agent sets (e.g. "$2,500", "$500/mo").
       *  §2: generic pricing only, never credit/lending/finance framing unless the tenant asked. */
      rows: { item: string; detail?: string; amount: string }[];
      total?: string;
    }
  | { type: "cta"; headline: string; action: string; href?: string };

/** A hydrated document ready to render — the parsed marketing_content body plus its id/title. */
export interface StudioDocument {
  id: string;
  title: string;
  docType: StudioDocType;
  blocks: StudioDocBlock[];
}

/** The session lifecycle, distinct from any one artifact's status. */
export type StudioSessionStatus = "draft" | "building" | "published" | "archived";

/** Which gallery view the HOME is showing — a filter over ONE grid, never a route (§18). */
export type StudioSessionView = "recent" | "mine" | "starred" | "templates";

/** One typed reference INTO a growth_ / marketing_content row a session authored — never the
 *  artifact's content, just enough to render a chip/glyph and re-open it. A ref whose target
 *  was deleted is a tombstone the UI tolerates (no broken image, no throw). */
export interface SessionArtifactRef {
  kind: SessionArtifactKind;
  id: string;
  title: string;
  slug: string | null;
  thumbnailUrl: string | null;
  addedAt: string | null;
}

/** #331 — one append-only VERSION snapshot of an artifact, as list_artifact_versions returns it
 *  (studio_artifact_versions, snake→camel). The stack is read straight from the DB on every reload,
 *  so a version history can never again live only in client state and vanish (§13, the owner's bug).
 *  `isCurrent` marks the version the live library row reflects; `thumbnailUrl` is the snapshot's own
 *  image (present for image content, null for page/doc/funnel — never a fabricated glyph, §22/§13). */
export interface ArtifactVersion {
  id: string;
  /** 1,2,3… per (session,kind,lineage). The strip's caption (tabular-nums "v3"). */
  versionNo: number;
  /** The version the live artifact currently reflects — drives the "Live" badge + revert affordance. */
  isCurrent: boolean;
  /** Manifest kind: page | form | funnel | content (a document persists under 'content'). */
  kind: SessionArtifactKind;
  /** The artifact this version belongs to (its own id) — the lineage key. */
  lineageId: string;
  title: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

/** The full session row, camelCased — the builder's resume payload. */
export interface StudioSessionMeta {
  id: string;
  tenantId: string;
  ownerUserId: string | null;
  title: string;
  seedBrief: string | null;
  status: StudioSessionStatus;
  starred: boolean;
  thumbnailUrl: string | null;
  isTemplate: boolean;
  transcript: unknown[];
  artifacts: SessionArtifactRef[];
  lastOpenedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The gallery card projection — exactly what a ProjectCard renders. */
export interface StudioSessionCard {
  id: string;
  title: string;
  seedBrief: string | null;
  starred: boolean;
  status: StudioSessionStatus;
  isTemplate: boolean;
  thumbnailUrl: string | null;
  /** The primary artifact's studio type (drives the cover glyph); null for an empty session. */
  primaryKind: StudioArtifactType | null;
  /** Distinct studio types wired into the session — the multi-artifact glyph row (§19). */
  artifactKinds: StudioArtifactType[];
  lastEditedAt: string;
}

/** The state StudioShell owns. Nothing else holds studio state. */
export interface StudioState {
  // — scope —
  tenantId: string | null;
  tenantSlug: string | null;
  /** null until the draft is first saved (the upsert seam returns it). */
  pageId: string | null;

  // — session (Slice 2) — the owning authoring project. `pageId` above is now a
  //   specialization of the active PAGE artifact (activeArtifactId === pageId for a page);
  //   `sessionId` is null only on the legacy ?pageId path that carries no session.
  sessionId: string | null;
  artifacts: SessionArtifactRef[];
  activeArtifactId: string | null;
  activeArtifactType: StudioArtifactType | null;

  // — the page —
  title: string;
  slug: string;
  /** Whether the operator hand-edited the slug (stops the title→slug auto-derive). */
  slugTouched: boolean;
  status: "draft" | "published";
  /** Canonical DRAFT blocks. While mode === "generating" the canvas reads generation.emitted. */
  blocks: GrowthBlock[];
  theme: GrowthPageTheme | null;
  /** Resolved ONCE per tenant, by the SAME construction the published page uses. */
  brandFloor: GrowthPageTheme | null;
  seo: StudioSeoDraft | null;
  /** Derived ONLY when the clarifying step collected a questionnaire_answer and the model's
   *  proposal survived the server's cleanup with at least one field. Null = growth_page_upsert
   *  falls back to its generic 3-field synthesis for this page's embedded_form. */
  formSchema: GrowthFormSchema | null;

  // — the composer —
  /** Up to 3 reference/deliverable files uploaded for the CURRENT brief (§10/§13) — real
   *  Storage URLs, threaded to growth-page-draft as real multimodal content on generate. */
  attachments: GrowthAsset[];
  /** A real, already-uploaded attachment URL Paige flagged as this brief's likely deliverable
   *  (from the last generate's suggestedDelivery). Purely a proposal (§15) surfaced in
   *  DeliveryEditor — never written to a form until the operator explicitly saves. */
  suggestedDeliveryAssetUrl: string | null;
  /** The whole-page brief. PRESERVED across section-mode retargeting. */
  brief: string;
  /** The live composer INPUT (page mode). Ephemeral and DECOUPLED from `brief`: starts empty
   *  on an already-built project, clears on submit, and is never the source Rebuild reads — so
   *  returning to a built project shows a clean box while `brief` keeps the last brief. */
  composerValue: string;
  /** The in-flight section instruction (section mode only). */
  instruction: string;
  mode: PageCanvasMode;
  /** Populated only while mode === "clarifying" (or once it has been, until the next brief). */
  clarifying: ClarifyingState;
  generation: GenerationState;

  // — the canvas —
  device: DeviceFrame;
  /** Block index under conversational edit; null = whole-page mode. */
  selectedIndex: number | null;

  // — io —
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  editing: boolean;
  publishOpen: boolean;
  publishedUrl: string | null;
  error: StudioError | null;
}
