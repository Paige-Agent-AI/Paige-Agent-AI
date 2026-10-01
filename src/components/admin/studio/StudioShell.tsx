// The Studio — THE creation surface, one immersive workspace, five outputs.
//
// Dark chrome wrapping a light rendered canvas — the root carries the `dark` token scope,
// so every descendant re-resolves to the dark theme with ZERO hardcoded colors, while the
// LivePreview iframe clones document.documentElement's class (not this wrapper's), so the
// rendered page inside the frame stays in the app's theme + the page's own brand scope.
// Dark studio, light page — and the preview never lies about what publishes.
//
// One studio, four modes: Page (the original Vibe Studio machinery, verbatim), Funnel,
// Form, and the absorbed Content Studio's creative surface — Image. Mode state is kept mounted
// for the session, so switching modes never eats work in progress. (Standalone copy is NOT a
// Studio mode — it's a Paige-chat capability, §18/§21; copy inside a page/funnel/form is an
// embedded-quality property of that asset, not a separate artifact.)
//
// This is the ONLY file in the Studio that drives the page seam layer end-to-end. The
// mode components own their own narrow seams (content-draft, generate-image, the
// form/funnel functions in studio.ts) — every action here is also a function Paige can
// call headlessly (§10).
//
// GOLD (§11): one gold act per mode — the Publish trigger in the top bar (page), Publish
// funnel, Create form — plus the confirm inside
// PublishDialog. Image carries gold ONLY on its manual Save-to-library retry, and only
// when the server's own auto-file didn't happen (§13) — the ordinary path (auto-filed,
// confirmed by a real content_id) shows a plain success StatePill, no button to click.
// Not on Generate, not on Save, not on a chip, not on the selection outline (that's
// indigo `--ring`).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Send, Sparkles, Wand2 } from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useGeneratePage } from "@/hooks/useGeneratePage";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { GrowthAsset, GrowthBlock, GrowthFormSchema } from "@/lib/growth";
import { Button } from "@/components/ui/button";
import {
  ArtifactPreview,
  EmptyState,
  PageShell,
  SectionCard,
  type FormSectionPreview,
} from "@/components/ui/page";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BuildProgress } from "./BuildProgress";
import { ClarifyingQuestions } from "./ClarifyingQuestions";
import { DeliveryEditor } from "./DeliveryEditor";
import { GenerationExperience } from "./GenerationExperience";
import { LivePreview } from "./LivePreview";
import { capturePageThumbnailBlob } from "./page-thumbnail";
import { PromptComposer } from "./PromptComposer";
import { PublishDialog, kebabSlug } from "./PublishDialog";
import { StudioTopBar } from "./StudioTopBar";
import { StudioRailHeading, StudioSplit } from "./StudioChrome";
import { StudioChat, type StudioChatArtifact } from "./StudioChat";
import { DocumentPreview } from "./DocumentPreview";
import { StudioBuildingScreen, useElapsedMs, type StudioBuildStep } from "./StudioBuildingScreen";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { GP_SHIMMER } from "@/components/growth/growth-motion";
import { AnimatePresence, motion } from "framer-motion";
import { useStudioImmersion } from "./StudioImmersion";
import {
  STUDIO_THEME_STORAGE_KEY,
  readStudioDark,
  useStudioTheme,
  useStudioReducedMotion,
} from "./StudioTheme";
import { ImageMode } from "./modes/ImageMode";
import { FormMode } from "./modes/FormMode";
import { FunnelFlow } from "./modes/FunnelFlow";
import { LibraryPanel } from "./modes/content-shared";
import { SessionImageCanvas } from "./SessionImageCanvas";
import { VersionBar } from "./VersionStrip";
import {
  STUDIO_ERROR_COPY,
  buildFunnelFromDraft,
  classifyStudioIntent,
  composeBrief,
  draftFormSchema,
  draftFunnel,
  editBlocks,
  isFunnelPublishError,
  isStudioError,
  learnFromArtifact,
  linkSessionArtifact,
  listArtifactVersions,
  restoreArtifactVersion,
  loadBrandFloor,
  loadContent,
  loadDocument,
  loadFormBySlug,
  loadFunnel,
  loadPageDraft,
  loadSession,
  openSessionArtifact,
  preflightPublish,
  publishFunnelCascade,
  publishPage,
  saveToLibrary,
  renameSessionArtifactRef,
  renameStudioSession,
  deriveProjectName,
  reviseBlock,
  savePageDraft,
  setSessionStatus,
  setSessionThumbnail,
  shouldClarify,
  uniqueGrowthPageSlug,
  uploadGrowthAsset,
  uploadPageThumbnail,
  type BuiltFunnel,
  type OpenedArtifact,
  type PublishPageResult,
  type StudioCopy,
  type StudioDocument,
} from "./studio";
import {
  clearPageDraftSnapshot,
  loadPageDraftSnapshot,
  savePageDraftSnapshot,
  studioDraftKey,
  type PageDraftSnapshot,
} from "./studio-draft";
import {
  BLOCK_LABELS,
  CLARIFYING_QUESTIONS,
  CLARIFYING_RAIL,
  INTENT_CHIPS,
  MODE_EMPTY,
  MODE_RAIL,
  QUESTIONNAIRE_FIELDS_QUESTION,
  QUESTIONNAIRE_FIELDS_QUESTION_ID,
} from "./studio-copy";
import {
  EMPTY_CLARIFYING,
  type ModeToolbarState,
  type LibraryKind,
  type StudioArtifactType,
  type StudioError,
  type StudioErrorCode,
  type StudioMode,
  type ArtifactVersion,
  type SessionArtifactKind,
  type SessionArtifactRef,
  type StudioSeoDraft,
  type StudioSessionMeta,
  type StudioState,
} from "./studio-types";

/** A session whose title is still the platform default has never been auto-named — an image/doc
 *  chat build links its artifact server-side, so the client rename that pages run never fired and
 *  the project sat as "Untitled project" in the grid (#292). This is the once-idempotent gate that
 *  lets the on-load + first-artifact rename claim the name exactly once. */
function isUnnamedProject(title: string | null | undefined): boolean {
  const s = (title ?? "").trim().toLowerCase();
  return s === "" || s === "untitled project" || s === "untitled";
}

/** #331 — map a canvas artifact's FRAME kind to the MANIFEST kind the version RPCs key on. A document
 *  streams frameKind 'document' but persists (and versions) under 'content' (marketing_content); image
 *  is already 'content'; page/funnel pass through. Copy/form have no in-canvas version strip here. */
function versionKindForCanvas(kind: StudioChatArtifact["kind"] | null | undefined): SessionArtifactKind | null {
  switch (kind) {
    case "page":
      return "page";
    case "funnel":
      return "funnel";
    case "content":
    case "document":
      return "content";
    default:
      return null;
  }
}

/** Project a real form schema down to the ArtifactPreview structural-mini shape (§13 real data —
 *  labels/types/option-counts are the tenant's actual fields, never invented). Null when empty. */
function formSectionsForPreview(schema: GrowthFormSchema | null | undefined): FormSectionPreview[] | null {
  if (!schema?.sections?.length) return null;
  return schema.sections.map((s) => ({
    title: s.title,
    fields: (s.fields ?? []).map((f) => ({
      // §13 degrade: a legacy/imported/agent-edited field row may lack `label` (schema_json is a raw
      // blind-cast); coerce to "" so the structural mini never derefs undefined and crashes the canvas.
      label: f.label ?? "",
      type: f.type,
      required: f.required,
      optionCount: f.options?.length ?? 0,
    })),
  }));
}

/**
 * The premium "Paige is creating" layer for a FOLLOW-UP turn — the prior artifact STAYS on the
 * stage underneath (§21) while this lays an ALIVE, ambient building treatment over it, never an
 * opaque cover. Replaces the bare pulsing scan-line (#292): a living Command Mark ribbon + the real
 * streamed note + an honest elapsed clock, an indeterminate indigo build beam, and the shipped
 * token/white shooting-star field (§12/§18 reuse — NOT the gold nebula/comet). Every animation is
 * reduce-gated here → a calm static ribbon (no stars, no pulse, static beam) under reduce (§11).
 * Gold is reserved for the act: nothing here is gold except PaigeMark's own inherent mark.
 */
function SessionBuildingOverlay({
  note,
  elapsedMs,
  reduce,
}: {
  note: string | null;
  elapsedMs: number;
  reduce: boolean;
}) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  // Indigo halo (never gold) tinted off the app --primary token; the keyframe is the shipped
  // .paige-halo-pulse (also used by StudioBuildingScreen's LivingMark), the color is inline.
  const haloBg =
    "radial-gradient(circle at 50% 50%, color-mix(in srgb, hsl(var(--primary)) 42%, transparent), transparent 70%)";
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      role="status"
      aria-label="Paige is creating"
    >
      {/* Ambient dim so the ribbon reads over any artifact WITHOUT hiding the work — the top of the
          canvas stays clear, the scrim only deepens toward the ribbon at the bottom (§11). */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, hsl(var(--studio-canvas) / 0.60) 0%, hsl(var(--studio-canvas) / 0.10) 42%, transparent 72%)",
        }}
      />
      {/* Occasional token/white shooting streaks — the shipped cosmic field, NOT gold. Hidden under
          reduce (the CSS holds the streaks at opacity 0 there too — belt and suspenders). */}
      {!reduce && <div aria-hidden className="studio-shooting" />}
      {/* Top indeterminate build beam — an indigo shimmer, not a dead hairline. Static fill under
          reduce so the "something's happening" cue survives without motion. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/15">
        {reduce ? (
          <div className="h-full w-full bg-primary/40" />
        ) : (
          <div className={cn("h-full w-full rounded-full", GP_SHIMMER)} />
        )}
      </div>
      {/* The living ribbon — a compact glass pill with a small animated Command Mark + the real note. */}
      <div className="absolute inset-x-0 bottom-5 flex justify-center px-4">
        <div className="flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full border border-[hsl(var(--studio-chrome-border)/0.6)] bg-[hsl(var(--studio-canvas)/0.86)] px-4 py-2 shadow-lg backdrop-blur">
          <span className="relative grid h-7 w-7 shrink-0 place-items-center">
            <span
              aria-hidden
              className={cn("absolute inset-[-45%] rounded-full", !reduce && "paige-halo-pulse")}
              style={{ background: haloBg, transformOrigin: "center" }}
            />
            <PaigeCommandMark plated={false} animated={!reduce} className="relative h-7 w-7" />
          </span>
          <span className="min-w-0 truncate font-display text-sm font-medium text-foreground">
            {note?.trim() || "Paige is creating…"}
          </span>
          <span className="ml-1 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground tabular-nums">
            {seconds}s
          </span>
        </div>
      </div>
    </div>
  );
}

export interface StudioShellProps {
  /** Tenant scope. Falls back to the active tenant when omitted. */
  tenantId?: string;
  /** Tenant public web address — needed for the brand floor and for publish. */
  tenantSlug?: string;
  /** The owning authoring session (Slice 2). When present, the shell touches recency on mount,
   *  hydrates the session's primary artifact, seeds the brief from its durable seed_brief, and
   *  links each saved artifact back to it. Absent on the legacy ?pageId deep-link path. */
  sessionId?: string;
  /** The seed brief the HOME composer passed on navigation — a fast-path seed only; the durable
   *  brief is the session's own seed_brief, read from the row (blocking #4). */
  initialBrief?: string;
  /** The Home composer already "sent" this brief (Defect 1): fire the build ONCE on arrival —
   *  straight into runGenerate's brand/clarify gate — instead of waiting for a second submit.
   *  Only fires on a fresh (zero-artifact), non-restored session with a non-empty brief; a
   *  deep-link/resume never carries it, so a cold entry stays a normal single-submit. */
  autostart?: boolean;
  /** Open an existing page's DRAFT instead of a blank composer (page mode). */
  pageId?: string;
  /** Which output the workspace is building. The hub owns the ?mode= param. */
  mode?: StudioMode;
  onModeChange?: (mode: StudioMode) => void;
  /** Rendered inside a hub that already owns the masthead — suppress our own header. */
  embedded?: boolean;
  onPublished?: (result: PublishPageResult) => void;
  onSaved?: (page: { id: string; slug: string }) => void;
  /** A funnel shipped from funnel mode — the hub jumps to the Funnels library. */
  onFunnelCreated?: () => void;
  /** A form was created in form mode — the hub jumps to the Forms library. */
  onFormCreated?: () => void;
  /** The session's artifact manifest changed (link / rename). The shared active-session bundle
   *  (StudioLayout) passes its `applyMeta` here so the project navigator in the rail re-renders
   *  from the same row the stage just wrote — one source of truth, no split (Slice 1b). */
  onManifestChange?: (meta: StudioSessionMeta) => void;
  /** #290 — reopen a SAVED artifact from the project rail onto THIS session canvas (§21). The rail
   *  sets ?open=<kind>:<id>; the shell resolves it to the same canvas states a fresh build produces. */
  openRef?: { kind: SessionArtifactKind; id: string };
  /** The shell finished with the current ?open (resolved it, or a build superseded it) — the parent
   *  clears the param so it's a one-shot command, never a stale "what's open" lie after the canvas
   *  moves on (#290). */
  onReopenConsumed?: () => void;
  className?: string;
}

/** Generation lives in useGeneratePage (the abort path + the honest ticker belong together);
 *  the shell owns everything else in StudioState verbatim. */
type ShellState = Omit<StudioState, "generation">;

/** The first real image URL a page's blocks carry — used as the library card's thumbnail so a kept
 *  page shows an actual preview, not a glyph (§22). Scans the image-bearing fields across block
 *  shapes; returns null when the page has no image (the card falls back to a page glyph). */
function firstBlockImageUrl(blocks: GrowthBlock[]): string | null {
  const KEYS = ["image_url", "url", "src", "background_image", "image", "cover_image"];
  const isUrl = (v: unknown): v is string =>
    typeof v === "string" && /^https?:\/\//.test(v) && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(v);
  for (const raw of blocks ?? []) {
    const b = raw as unknown as Record<string, unknown>;
    for (const k of KEYS) if (isUrl(b?.[k])) return b[k] as string;
    const imgs = b?.images;
    if (Array.isArray(imgs)) {
      for (const im of imgs as Record<string, unknown>[]) {
        for (const k of KEYS) if (isUrl(im?.[k])) return im[k] as string;
      }
    }
  }
  return null;
}

const EMPTY_SHELL: ShellState = {
  tenantId: null,
  tenantSlug: null,
  pageId: null,
  sessionId: null,
  artifacts: [],
  activeArtifactId: null,
  activeArtifactType: null,
  title: "",
  slug: "",
  slugTouched: false,
  status: "draft",
  blocks: [],
  theme: null,
  brandFloor: null,
  seo: null,
  formSchema: null,
  attachments: [],
  suggestedDeliveryAssetUrl: null,
  brief: "",
  composerValue: "",
  instruction: "",
  mode: "compose",
  clarifying: EMPTY_CLARIFYING,
  device: "desktop",
  selectedIndex: null,
  dirty: false,
  saving: false,
  publishing: false,
  editing: false,
  publishOpen: false,
  publishedUrl: null,
  error: null,
};

/** Anything the seam throws arrives here and leaves as a sentence the operator can act on.
 *  A raw error code, table name, or function name never reaches the screen (§11). */
function asStudioError(err: unknown, fallback: StudioErrorCode): StudioError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as StudioError;
    if (typeof e.message === "string" && e.message.length > 0) return e;
  }
  return { code: fallback, message: STUDIO_ERROR_COPY[fallback], recoverable: true };
}

/** The dark-chrome frame every state of the Studio renders inside — including the
 *  skeleton and the tenant gate, so the surface never flashes between shells.
 *
 *  Below lg this is a normal flowing block — the surrounding page scrolls, nothing here
 *  clips. At lg+ it becomes the fixed-height, self-contained workspace (StudioSplit's rail
 *  body / footer / canvas each own their own internal scroll) — `h-full`/`overflow-hidden`
 *  only apply there. Getting this backwards (unconditional `overflow-hidden`) is exactly
 *  what silently ate the composer's submit button once the textarea grew past the frame's
 *  resolved height, with no scrollbar anywhere to reach it — never repeat that. */
function StudioFrame({
  children,
  className,
  dark = true,
}: {
  children: ReactNode;
  className?: string;
  /** Studio-local only — never the platform's next-themes state (see StudioTopBar's doc
   *  comment). Defaults dark to match the look every prior version of this frame had; only
   *  the main authenticated session (where the toggle actually lives) ever passes `false`. */
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        dark && "dark",
        // shadow-xl is the single biggest "this is a serious workspace" cue this frame was
        // missing (§11) — the hairline border alone was doing 100% of the separation work
        // against whatever sits behind it. Softened to /60 now that the shadow, not the
        // border, carries the edge — full-strength border + full-strength shadow reads
        // busy, not premium (the same "carry it with one, not both" rule applies below).
        // The base slab is the committed indigo studio canvas (was platform bg-background, the
        // flat near-black/near-white that made the whole session read gray in both themes). Every
        // region inside (masthead, rail, dock, well) sits on this one deep-indigo field (§6/§11).
        "flex w-full flex-col rounded-xl border border-[hsl(var(--studio-chrome-border)/0.6)] bg-[hsl(var(--studio-canvas))] text-foreground shadow-xl lg:h-full lg:min-h-[620px] lg:overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StudioShell({
  tenantId: tenantIdProp,
  tenantSlug: tenantSlugProp,
  sessionId,
  initialBrief,
  autostart = false,
  pageId: pageIdProp,
  openRef,
  onReopenConsumed,
  mode = "page",
  onModeChange,
  embedded = false,
  onPublished,
  onSaved,
  onFunnelCreated,
  onFormCreated,
  onManifestChange,
  className,
}: StudioShellProps) {
  const { activeTenantId, activeTenant, loading: tenantLoading } = useTenantContext();
  const { toast } = useToast();
  const navigate = useNavigate();

  const tenantId = tenantIdProp ?? activeTenantId ?? null;
  const tenantSlug = tenantSlugProp ?? activeTenant?.slug ?? null;

  // HOME hands off any composer-uploaded attachments on nav state (same channel as brief/autostart).
  // Seed them into the INITIAL shell state (render 0) so every generateWholePage closure — including
  // the autostart-fired one, which runs only after loadSession's round-trip — reads them. Present
  // from the first render means no stale-closure timing risk. (Ephemeral: a hard reload during the
  // build loses them, like an unsent brief — durable carry would need a schema change, out of scope.)
  const location = useLocation();
  const initialAttachments = (location.state as { attachments?: GrowthAsset[] } | null)?.attachments;
  const [state, setState] = useState<ShellState>(() =>
    initialAttachments?.length ? { ...EMPTY_SHELL, attachments: initialAttachments } : EMPTY_SHELL,
  );
  const { generation, isGenerating, generate, cancel, reset } = useGeneratePage(tenantId);
  useBeforeUnloadGuard(state.dirty || isGenerating);

  // Studio-local dark/light — completely separate from the platform's own next-themes state, and
  // NEVER the global `<html>` class (see StudioTheme.ts / StudioTopBar's doc comment). The signal
  // is OWNED by StudioLayout (it themes the `.studio-surface` root so the rail + gallery flip in
  // lockstep) and shared down here via context, so the top-bar toggle drives the SAME signal.
  // When EMBEDDED (no StudioThemeProvider above), fall back to local state keyed to the same
  // localStorage slot — the safe no-provider default (StudioImmersion uses the same pattern).
  const studioTheme = useStudioTheme();
  const [localDark, setLocalDark] = useState(readStudioDark);
  const toggleLocalTheme = useCallback(() => {
    setLocalDark((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STUDIO_THEME_STORAGE_KEY, next ? "dark" : "light");
      } catch {
        // Storage can be unavailable (private browsing, quota) — the toggle still works for the
        // session, it just won't survive a reload. Not worth failing the click over.
      }
      return next;
    });
  }, []);
  const studioDark = studioTheme.scoped ? studioTheme.studioDark : localDark;
  const toggleStudioTheme = studioTheme.scoped ? studioTheme.toggleStudioTheme : toggleLocalTheme;

  // The Lovable/Replit "watch it build full-width" moment. FIRST build ONLY, and ONLY on the
  // page/funnel surface: gated on `isGenerating` (RUNNING_PHASES.has(generation.phase)) — NOT
  // state.mode==="generating", which stays stuck after a FAILED run (the error lives in
  // generation.phase, not state.mode) and would strand both rails retracted+inert forever (crew
  // catch). isGenerating clears the instant a run ends (done OR error), so the rails always slide
  // back. blocks.length===0 keeps a REGENERATE in the normal split; the (page|funnel) gate keeps a
  // Form/Image surface from ever retracting the rail with no immersive canvas showing. Reads
  // reactive state, never the non-reactive blocksBeforeRun ref. Published up to StudioLayout so the
  // OUTER project rail retracts too; the inner rail gets the same flag via StudioSplit below.
  const { setImmersive } = useStudioImmersion();
  // Mirrors an Image auto-run build in flight — extends firstBuildGenerating so BOTH rails
  // retract for the full-frame cutscene, exactly as the page path does on its first build.
  const [imageBuilding, setImageBuilding] = useState(false);
  // The full-screen "watch it build" cutscene is the DASHBOARD HANDOFF moment ONLY (owner
  // 2026-07-17: "this does not load up inside of the project session"). It fires when a brand-new
  // session is opened from the gallery WITH a brief (autostart) and NEVER for a build triggered
  // while already inside a session — an in-session brief or a rebuild renders the SMALLER inline
  // GenerationExperience in the normal split instead of retracting both rails full-frame. This
  // flag is armed the instant the autostart build is fired (see the session-load effect below) and
  // disarmed the moment that first build actually finishes, so a later in-session build stays inline.
  const [autostartBuild, setAutostartBuild] = useState(false);
  // Disarm once the handoff build has actually run and ended. `genActiveRef` guards the arm→run gap:
  // autostartBuild is set true BEFORE isGenerating flips (the fire routes through an async classify),
  // so we only clear it after a build has genuinely been active and then stopped — never in that gap.
  const genActiveRef = useRef(false);
  useEffect(() => {
    const active = isGenerating || imageBuilding;
    if (active) genActiveRef.current = true;
    else if (genActiveRef.current) {
      genActiveRef.current = false;
      setAutostartBuild(false);
    }
  }, [isGenerating, imageBuilding]);
  const firstBuildGenerating =
    autostartBuild &&
    ((isGenerating && (mode === "page" || mode === "funnel")) ||
      // Image gets the same full-frame moment while its autostart draft is in flight. Gated to
      // the active mode so a hidden mode's stale build flag can never retract the visible surface.
      (imageBuilding && mode === "image"));
  useEffect(() => {
    setImmersive(firstBuildGenerating);
    // Clear on unmount so leaving a mid-build project never reopens the gallery with a hidden rail
    // (§13 — the UI never lies about state); the layout's !onProject effect is the extra backstop.
    return () => setImmersive(false);
  }, [firstBuildGenerating, setImmersive]);

  // Modes stay mounted once visited, so switching outputs never eats in-progress work.
  const [visited, setVisited] = useState<ReadonlySet<StudioMode>>(() => new Set([mode]));
  useEffect(() => {
    setVisited((prev) => (prev.has(mode) ? prev : new Set(prev).add(mode)));
  }, [mode]);

  // Form mode publishes its Save/act buttons into the top bar through here. (Funnel no longer
  // does — the AI funnel act is driven directly from the shell's funnel state, not a modeBar.)
  const [modeBars, setModeBars] = useState<Partial<Record<StudioMode, ModeToolbarState>>>({});
  const onFormToolbar = useCallback(
    (s: ModeToolbarState) => setModeBars((prev) => ({ ...prev, form: s })),
    [],
  );

  // The content library, one Sheet — the same LibraryPanel the Content Studio shipped.
  const [libraryOpen, setLibraryOpen] = useState(false);

  // ── #292 conversational session — the LIVE design canvas ─────────────────────────────
  // The customer only talks: the chat rail (left) drives everything, and the right-hand canvas
  // RENDERS what the conversation produced (chat-left / live-canvas-right — the standard vibe-studio
  // layout). `canvasArtifact` is the exact artifact the SERVER said it built this turn (from the
  // paige_artifact frame — never a guessed index, §13). `openedPage` hydrates a page's real blocks;
  // an image rides its own url; a funnel shows an honest "open it to edit" state (loader is #319).
  const [sessionSeedBrief, setSessionSeedBrief] = useState<string | null>(null);
  const [canvasArtifact, setCanvasArtifact] = useState<StudioChatArtifact | null>(null);
  const [openedPage, setOpenedPage] = useState<OpenedArtifact | null>(null);
  const [pageHydrating, setPageHydrating] = useState(false);
  const [openedDocument, setOpenedDocument] = useState<StudioDocument | null>(null);
  const [docHydrating, setDocHydrating] = useState(false);
  // #331 — the append-only VERSION stack of whatever artifact is on the canvas, loaded from the DB so
  // it survives reload (the owner's bug). Read-through: the linkage RPC in paige-ai-chat appends a
  // version server-side on every session-bound write; this effect just re-lists them for the canvas.
  const [canvasVersions, setCanvasVersions] = useState<ArtifactVersion[]>([]);
  const [reverting, setReverting] = useState(false);
  // #290 — reopen states the build pipeline never puts on the canvas: a form has no in-Studio
  // renderer yet (honest "built" state), copy is a chat deliverable shown read-only. Cleared the
  // instant a real build lands (handleCanvasArtifact).
  const [reopened, setReopened] = useState<
    | { kind: "form"; title: string; schema: GrowthFormSchema | null }
    | { kind: "copy"; copy: StudioCopy }
    | null
  >(null);
  const reopenResolvedRef = useRef<string | null>(null);
  // The content-reopen probe (document/copy) currently in flight, by key. A ref, not a per-run flag,
  // so it survives unrelated effect re-runs; a newer reopen or a build clears/overwrites it and the
  // stale probe's results are dropped (verify fast-follow).
  const reopenInFlightRef = useRef<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatNote, setChatNote] = useState<string | null>(null);
  // The accumulating REAL step trace for the in-flight turn (§13) — drives the split cutscene's
  // streamed beats. Reset by the chat at the start of each turn; never fabricated.
  const [chatSteps, setChatSteps] = useState<StudioBuildStep[]>([]);
  const chatElapsedMs = useElapsedMs(chatBusy);
  // The Studio-LOCAL motion gate (owner 2026-07-19): the build cutscene — the marquee "video-game"
  // moment (§22) with its living, named-agent LivingMark — plays by DEFAULT even when the OS asks to
  // reduce motion, and freezes only on the explicit "Reduced" choice. Falls back to the OS flag when
  // StudioShell is rendered embedded with no StudioThemeProvider (see useStudioReducedMotion).
  const reduceMotion = useStudioReducedMotion();

  // The chat hands up EXACTLY what it built this turn (null = a chat-only/copy turn → keep the
  // current stage, never blank a good canvas, §13/verify #2). A real build SUPERSEDES any reopen:
  // clear the reopen-only state and consume a still-pending ?open so the URL/rail never lie about
  // what's on the canvas once a build moves on (#290 blocking fix).
  const handleCanvasArtifact = useCallback((a: StudioChatArtifact | null) => {
    if (!a) return;
    setReopened(null);
    reopenInFlightRef.current = null; // a build supersedes any in-flight content-reopen probe (drop its result)
    setCanvasArtifact(a);
    if (openRef) { reopenResolvedRef.current = `${a.kind}:${a.id}`; onReopenConsumed?.(); }
    // Auto-name a still-untitled session from its FIRST streamed artifact (#292). Image/document
    // chat builds link server-side and never run the page path's rename, so they sat as "Untitled
    // project" in the grid — this makes them findable the instant the first piece lands. Best-effort,
    // once per session (autoNamedRef), never blocks the canvas (§13); flags restore on failure so a
    // later build (or the first save) can reclaim the name.
    if (tenantId && sessionId && !autoNamedRef.current) {
      const derived = deriveProjectName(a.title, null);
      if (derived) {
        autoNamedRef.current = true;
        firstLinkRef.current = false;
        void renameStudioSession({ tenantId, sessionId, title: derived })
          .then((renamed) => onManifestChange?.(renamed))
          .catch((err) => {
            autoNamedRef.current = false;
            firstLinkRef.current = true;
            console.warn("[studio] auto-name on first streamed artifact failed (non-fatal):", err);
          });
      }
    }
  }, [openRef, onReopenConsumed, tenantId, sessionId, onManifestChange]);

  // Hydrate a page artifact's real blocks for LivePreview; images/funnels need no load.
  useEffect(() => {
    if (!tenantId || !canvasArtifact || canvasArtifact.kind !== "page") { setOpenedPage(null); setPageHydrating(false); return; }
    let live = true;
    setPageHydrating(true);
    const ref: SessionArtifactRef = { kind: "page", id: canvasArtifact.id, title: canvasArtifact.title, slug: null, thumbnailUrl: null, addedAt: null };
    void openSessionArtifact({ tenantId, ref })
      .then((opened) => { if (live) { setOpenedPage(opened); setPageHydrating(false); } })
      .catch(() => { if (live) setPageHydrating(false); });
    return () => { live = false; };
  }, [tenantId, canvasArtifact]);

  // Hydrate a document artifact's blocks for DocumentPreview (#119/#292). The paige_artifact frame
  // carries just {kind:'document', id: content_id}; the blocks live in the marketing_content row.
  useEffect(() => {
    if (!tenantId || !canvasArtifact || canvasArtifact.kind !== "document") { setOpenedDocument(null); setDocHydrating(false); return; }
    let live = true;
    setDocHydrating(true);
    void loadDocument(tenantId, canvasArtifact.id)
      .then((doc) => { if (live) { setOpenedDocument(doc); setDocHydrating(false); } })
      .catch(() => { if (live) setDocHydrating(false); });
    return () => { live = false; };
  }, [tenantId, canvasArtifact]);

  // Load the VERSION stack for whatever artifact is on the canvas (#331) — mirrors the openedDocument
  // effect above. Read straight from the DB so a version history is durable across reload. A
  // single-version (or version-less) artifact yields <2 rows and the strips render nothing (§13).
  useEffect(() => {
    const kind = versionKindForCanvas(canvasArtifact?.kind);
    if (!tenantId || !sessionId || !canvasArtifact || !kind) { setCanvasVersions([]); return; }
    let live = true;
    void listArtifactVersions({ tenantId, sessionId, kind, artifactId: canvasArtifact.id })
      .then((vs) => { if (live) setCanvasVersions(vs); })
      .catch(() => { if (live) setCanvasVersions([]); });
    return () => { live = false; };
  }, [tenantId, sessionId, canvasArtifact]);

  // Restore a prior version to live (#331). Replays the snapshot into the live library row server-side,
  // then re-lists the stack (so is_current tracks the reverted head) and re-hydrates the on-canvas
  // artifact so the stage reflects the reverted content — never a stale view (§13). Returns the honest
  // boolean the strips report on.
  const handleRevertVersion = useCallback(async (versionId: string): Promise<boolean> => {
    if (!tenantId) return false;
    setReverting(true);
    const ok = await restoreArtifactVersion({ tenantId, versionId });
    setReverting(false);
    if (!ok) return false;
    const art = canvasArtifact;
    const kind = versionKindForCanvas(art?.kind);
    if (sessionId && art && kind) {
      try {
        const vs = await listArtifactVersions({ tenantId, sessionId, kind, artifactId: art.id });
        setCanvasVersions(vs);
        const reverted = vs.find((v) => v.id === versionId) ?? null;
        // Reflect the reverted content on the stage per artifact type.
        if (art.kind === "content" && reverted?.thumbnailUrl) {
          setCanvasArtifact((prev) => (prev && prev.id === art.id ? { ...prev, url: reverted.thumbnailUrl } : prev));
        } else if (art.kind === "document") {
          const doc = await loadDocument(tenantId, art.id);
          if (doc) setOpenedDocument(doc);
        } else if (art.kind === "page") {
          const ref: SessionArtifactRef = { kind: "page", id: art.id, title: art.title, slug: null, thumbnailUrl: null, addedAt: null };
          const opened = await openSessionArtifact({ tenantId, ref });
          setOpenedPage(opened);
        }
      } catch (err) {
        console.warn("[studio] post-revert refresh failed (non-fatal):", err);
      }
    }
    return true;
  }, [tenantId, sessionId, canvasArtifact]);

  // Reopen a SAVED artifact from the project rail onto THIS canvas (#290/§21). Resolves the one-shot
  // ?open ref to the SAME canvas states a fresh build uses, then reports back so the parent clears the
  // param — it never lingers to lie about "what's open" after a build moves the canvas on. A manifest
  // kind='content' ref is image | document | copy: thumbnail→image; else loadDocument→document; else
  // loadContent→copy (§13 — a genuinely deleted/unknown id simply never opens, never a fake).
  useEffect(() => {
    if (!openRef) { reopenResolvedRef.current = null; reopenInFlightRef.current = null; return; } // param cleared → a later re-open of the same id resolves afresh
    if (!tenantId) return;
    const key = `${openRef.kind}:${openRef.id}`;
    // Already resolved, or the async probe for THIS exact key is still in flight → do nothing. The
    // in-flight guard is a ref (not a per-run `live` flag), so an unrelated ?param write (mode/device)
    // that re-runs this effect mid-load neither tears the fetch down nor starts a duplicate — it just
    // early-returns and lets the original probe settle (verify fast-follow: the dropped-resolve fix).
    if (reopenResolvedRef.current === key || reopenInFlightRef.current === key) return;
    const ref = state.artifacts.find((a) => a.id === openRef.id);

    // page / funnel resolve immediately — the ref only supplies a cosmetic title; the existing page
    // branch (+ hydration effect) and funnel EmptyState render them.
    if (openRef.kind === "page" || openRef.kind === "funnel") {
      reopenResolvedRef.current = key;
      setReopened(null);
      setCanvasArtifact({ kind: openRef.kind, id: openRef.id, title: ref?.title ?? "", url: null });
      onReopenConsumed?.();
      return;
    }
    // form — hydrate the REAL schema (like the document branch) so the canvas renders the tenant's
    // actual questions, not an EmptyState (#290/Slice B). The manifest ref carries the slug, so WAIT
    // for it (state.artifacts is a dep → this retries when it fills). A slug-less/tombstoned form
    // resolves with schema:null and the canvas keeps the honest "built" fallback (§13 — never faked).
    if (openRef.kind === "form") {
      if (!ref) return;
      const slug = ref.slug?.trim();
      if (!slug) {
        reopenResolvedRef.current = key;
        setCanvasArtifact(null);
        setReopened({ kind: "form", title: ref.title ?? "", schema: null });
        onReopenConsumed?.();
        return;
      }
      reopenInFlightRef.current = key;
      void loadFormBySlug(tenantId, slug)
        .then((form) => {
          if (reopenInFlightRef.current !== key) return; // superseded by a newer reopen/build
          setCanvasArtifact(null);
          setReopened({ kind: "form", title: form?.name?.trim() || ref.title || "", schema: form?.schema ?? null });
        })
        .catch(() => {
          if (reopenInFlightRef.current !== key) return;
          setCanvasArtifact(null);
          setReopened({ kind: "form", title: ref.title ?? "", schema: null });
        })
        .finally(() => {
          if (reopenInFlightRef.current === key) { reopenInFlightRef.current = null; reopenResolvedRef.current = key; onReopenConsumed?.(); }
        });
      return;
    }
    // content — thumbnailUrl is load-bearing (image vs document/copy), so WAIT for the manifest ref;
    // don't touch the guards until it's in (state.artifacts is a dep, so this retries when it fills).
    if (!ref) return;
    if (ref.thumbnailUrl) {
      reopenResolvedRef.current = key;
      setReopened(null);
      setCanvasArtifact({ kind: "content", id: openRef.id, title: ref.title, url: ref.thumbnailUrl });
      onReopenConsumed?.();
      return;
    }
    // no thumbnail → document or copy. Mark the key IN-FLIGHT (not resolved) so a re-render doesn't
    // restart it; a NEWER openRef supersedes it (the ref no longer equals `key` → results are dropped).
    reopenInFlightRef.current = key;
    void loadDocument(tenantId, openRef.id)
      .then((doc) => {
        if (reopenInFlightRef.current !== key) return null; // superseded by a newer reopen/build
        if (doc) { setReopened(null); setCanvasArtifact({ kind: "document", id: openRef.id, title: doc.title || ref.title, url: null }); return null; }
        return loadContent(tenantId, openRef.id);
      })
      .then((copy) => { if (reopenInFlightRef.current === key && copy) { setCanvasArtifact(null); setReopened({ kind: "copy", copy }); } })
      .catch(() => { /* miss → leave the canvas as-is; the row just doesn't open (§13, never a fake) */ })
      .finally(() => {
        if (reopenInFlightRef.current === key) { reopenInFlightRef.current = null; reopenResolvedRef.current = key; onReopenConsumed?.(); }
      });
  }, [tenantId, openRef, state.artifacts, onReopenConsumed]);

  // ── Studio Phase 1 — the single entry point (§18) ─────────────────────────────────
  // `classifiedOnceRef` flips true the moment the FIRST brief this session is submitted from
  // the still-on-page-mode default composer, whatever it resolves to — every submission
  // after that (including a Regenerate) is already committed to a mode and never reclassified.
  const classifiedOnceRef = useRef(false);
  const [classifying, setClassifying] = useState(false);
  // Artifacts Paige already drafted from the classified brief, handed to the mode they
  // route into on its first mount. Null/undefined = that mode's own manual entry (a
  // template pick, a hand-typed brief) — never overwritten by a stale value from a
  // different session's classify run.
  const [draftedFormSchema, setDraftedFormSchema] = useState<GrowthFormSchema | null>(null);
  const [draftedImagePrompt, setDraftedImagePrompt] = useState<string | undefined>(undefined);
  // Explicit auto-run flag (§18): true ONLY when the classify step routed a brief into Image, so
  // that mode fires its generation on mount for the "submit → cutscene → land with the result"
  // page-parity flow. Kept separate from the drafted-prompt value so a future non-classifier caller
  // of initialPrompt never accidentally triggers a paid model call (§13).
  const [autoRunImage, setAutoRunImage] = useState(false);

  // ── AI funnel (§18/§19) — lives IN the page surface, never a separate tab ──────────
  // A funnel classified from the one composer is drafted + persisted into real rows and
  // rendered right here (FunnelFlow in the page canvas), refined by the same composer, and
  // shipped by the top bar's gold act. `funnel` holds the built funnel; null = ordinary page.
  const [funnel, setFunnel] = useState<BuiltFunnel | null>(null);
  const [funnelBuilding, setFunnelBuilding] = useState(false);
  const funnelElapsedMs = useElapsedMs(funnelBuilding);
  const [funnelPublishing, setFunnelPublishing] = useState(false);
  const [funnelUrl, setFunnelUrl] = useState<string | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  // The session committed to building a funnel — set when the classifier says "funnel" OR when
  // the operator entered via the funnel intent (mode="funnel"). Load-bearing on RETRY: if a
  // funnel build fails (funnel stays null), a resubmit must rebuild a FUNNEL, never silently
  // fall through to runGenerate and build a lone page (§13/§18).
  const funnelIntendedRef = useRef(mode === "funnel");
  // Entering the funnel intent (e.g. the Funnels library's "New funnel" flips the URL to
  // mode="funnel" after mount) must arm the ref too, so the very first brief — and any retry
  // after a failed build — routes to buildFunnel, never a lone page (§18).
  useEffect(() => {
    if (mode === "funnel") funnelIntendedRef.current = true;
  }, [mode]);

  // ── funnel canvas hydration (#319 / Slice B) ─────────────────────────────────────────
  // The session-canvas funnel branch renders the REAL step filmstrip. When a funnel lands on the
  // canvas (fresh build or a rail reopen → canvasArtifact.kind==="funnel"), resolve its real steps:
  // reuse the fresh in-memory `funnel` when it IS this funnel (no redundant fetch), else loadFunnel.
  // A hydrate miss (tombstoned row) leaves openedFunnel null → the branch keeps the honest EmptyState.
  const [openedFunnel, setOpenedFunnel] = useState<BuiltFunnel | null>(null);
  const [funnelHydrating, setFunnelHydrating] = useState(false);
  useEffect(() => {
    if (!tenantId || !canvasArtifact || canvasArtifact.kind !== "funnel") {
      setOpenedFunnel(null);
      setFunnelHydrating(false);
      return;
    }
    if (funnel && funnel.funnelId === canvasArtifact.id) {
      setOpenedFunnel(funnel);
      setFunnelHydrating(false);
      return;
    }
    let live = true;
    setFunnelHydrating(true);
    void loadFunnel(tenantId, canvasArtifact.id)
      .then((f) => { if (live) { setOpenedFunnel(f); setFunnelHydrating(false); } })
      .catch(() => { if (live) { setOpenedFunnel(null); setFunnelHydrating(false); } });
    return () => { live = false; };
  }, [tenantId, canvasArtifact, funnel]);

  // The blocks we hold when a run starts — restored verbatim if the operator stops it, so a
  // cancelled run never leaves a half-painted canvas.
  const blocksBeforeRun = useRef<GrowthBlock[]>([]);

  const patch = useCallback((next: Partial<ShellState>) => setState((s) => ({ ...s, ...next })), []);

  // ── session (Slice 2) ───────────────────────────────────────────────────────────────
  // A loadSession that throws NOT_FOUND is a hard stop (§11): the operator opened a session id
  // that isn't in their workspace. We render the operator-safe "couldn't find that project"
  // gate, never a raw code.
  const [sessionNotFound, setSessionNotFound] = useState(false);
  // True until the session's FIRST artifact is linked — the save that flips it names the project
  // from the real artifact. A resumed session that already has artifacts starts false.
  const firstLinkRef = useRef(true);
  // True once this session has been auto-named (#294) — from the first generation's real title,
  // so the rail + gallery never show "Untitled" while there's real content. A resumed session that
  // already has artifacts is an established, likely-already-named project; it starts true so a
  // regeneration never silently overwrites a name the operator (or the first build) already set.
  const autoNamedRef = useRef(false);

  // ── gallery thumbnail capture (#295) ────────────────────────────────────────────────
  // The settled LivePreview <body> lives here (fed by its onFrameSettled) so the capture reads
  // the pixel-accurate, styled render — never an unstyled early frame. The timer defers capture
  // past the final layout/font settle and is cleared on unmount so a late fire can't touch a
  // torn-down frame.
  const settledFrameBodyRef = useRef<HTMLElement | null>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set on a successful build; consumed the moment the fresh canvas frame SETTLES, so capture is
  // driven by the real "styles are in" edge (§13) instead of racing a fixed delay in prod.
  const thumbnailPendingRef = useRef(false);

  /** Snapshot the settled preview → upload → set the project cover → reflect it in the rail/
   *  gallery via onManifestChange (§10/§19). Fully best-effort (§13): any miss leaves
   *  thumbnail_url null and ProjectCard keeps its glyph — it never stores a blank as a preview. */
  const capturePageThumbnail = useCallback(async () => {
    if (!tenantId || !sessionId) return;
    const body = settledFrameBodyRef.current;
    if (!body?.isConnected) return;
    try {
      const blob = await capturePageThumbnailBlob(body);
      if (!blob) return; // capture failed → keep the glyph
      const url = await uploadPageThumbnail(tenantId, sessionId, blob);
      if (!url) return; // upload failed → keep the glyph
      const meta = await setSessionThumbnail({ tenantId, sessionId, thumbnailUrl: url });
      onManifestChange?.(meta);
    } catch (err) {
      console.warn("[studio] page thumbnail persist failed (non-fatal):", err);
    }
  }, [tenantId, sessionId, onManifestChange]);

  /** Defer a capture past the final block/font/image settle (LivePreview re-measures at ~400ms;
   *  we wait a touch longer). Coalesces rapid regenerations to a single trailing snapshot. */
  const scheduleThumbnailCapture = useCallback(() => {
    if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = setTimeout(() => {
      thumbnailTimerRef.current = null;
      void capturePageThumbnail();
    }, 700);
  }, [capturePageThumbnail]);

  useEffect(
    () => () => {
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    },
    [],
  );

  /** LivePreview's settled-body signal. Stashes the body for the capture, and — if a build just
   *  finished — arms the deferred snapshot on this exact "styles are in" edge. Gating on the
   *  pending flag keeps ordinary reloads/device toggles from re-snapshotting. */
  const handleFrameSettled = useCallback(
    (body: HTMLElement | null) => {
      settledFrameBodyRef.current = body;
      if (body && thumbnailPendingRef.current) {
        thumbnailPendingRef.current = false;
        scheduleThumbnailCapture();
      }
    },
    [scheduleThumbnailCapture],
  );

  /** Attach a saved artifact to the owning session and reflect it in state (§10/§19). Best-effort
   *  and non-fatal: a link hiccup must never fail the save the operator just performed (§13). On
   *  the FIRST link it also titles the project from the real artifact. */
  const linkPrimaryArtifact = useCallback(
    async (artifactType: StudioArtifactType, artifactId: string, title?: string) => {
      if (!tenantId || !sessionId || !artifactId) return;
      const isFirst = firstLinkRef.current;
      firstLinkRef.current = false;
      try {
        const meta = await linkSessionArtifact({ tenantId, sessionId, artifactType, artifactId });
        let latest = meta;
        const cleanTitle = (title ?? "").trim();
        // Keep the project-local chip label in sync with the artifact's real title. link is
        // idempotent and only titles a ref on FIRST insert, so a ref that pre-existed with a
        // stale label — e.g. an "Add a page" mint titled "Untitled page" the operator has since
        // named on save, or a page renamed across saves — would otherwise show the old label.
        if (cleanTitle) {
          const ref = latest.artifacts.find((a) => a.id === artifactId);
          if (ref && ref.title !== cleanTitle) {
            try {
              latest = await renameSessionArtifactRef({
                tenantId,
                sessionId,
                kind: ref.kind,
                artifactId,
                label: cleanTitle,
              });
            } catch (err) {
              console.warn("[studio] artifact ref label sync failed (non-fatal):", err);
            }
          }
        }
        setState((s) => ({
          ...s,
          artifacts: latest.artifacts,
          activeArtifactId: artifactId,
          activeArtifactType: artifactType,
        }));
        // Push the fresh manifest to the shared bundle so the rail's project navigator re-renders
        // with the new piece the instant it's linked (no refetch, no split source of truth).
        onManifestChange?.(latest);
        if (isFirst && cleanTitle) {
          try {
            const renamed = await renameStudioSession({ tenantId, sessionId, title: cleanTitle });
            onManifestChange?.(renamed);
          } catch (err) {
            console.warn("[studio] rename-on-first-save failed (non-fatal):", err);
          }
        }
      } catch (err) {
        // Don't undo the first-link flag on failure — a later save retries the link anyway, and
        // re-titling on a much later save would be surprising. Just log; the artifact is saved.
        console.warn("[studio] linkSessionArtifact failed (non-fatal):", err);
      }
    },
    [tenantId, sessionId, onManifestChange],
  );

  // Every non-page mode attaches its saved artifact to the owning project too, so ALL four
  // types land in the manifest — the project navigator shows the whole project, not just its
  // pages and funnels (§19: no artifact type is a second-class citizen). Each is best-effort
  // and non-fatal, same as the page/funnel path; the original per-mode "created" hooks (which
  // the embedded Campaigns hub used to jump libraries) still fire underneath.
  const handleFormCreated = useCallback(
    (created?: { id: string; title: string }) => {
      if (created?.id) void linkPrimaryArtifact("form", created.id, created.title);
      onFormCreated?.();
    },
    [linkPrimaryArtifact, onFormCreated],
  );
  const handleImageSaved = useCallback(
    (saved: { id: string; title: string }) => void linkPrimaryArtifact("image", saved.id, saved.title),
    [linkPrimaryArtifact],
  );

  // ── scope ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    patch({ tenantId, tenantSlug });
  }, [tenantId, tenantSlug, patch]);

  // ── the brand floor: resolved ONCE per tenant, by the SAME construction the published
  //    page uses. A brand miss is not a failure — the resolver floors it. ────────────────
  useEffect(() => {
    if (!tenantSlug) return;
    let live = true;
    loadBrandFloor(tenantSlug)
      .then((floor) => {
        if (live) patch({ brandFloor: floor });
      })
      .catch(() => {
        /* the floor is the fallback — a brand miss must never block the canvas */
      });
    return () => {
      live = false;
    };
  }, [tenantSlug, patch]);

  // ── recover an in-progress client-side draft (no DB write) ────────────────────────
  // Restores brief/blocks/theme/seo/formSchema (plus the composer/canvas state around
  // them) from localStorage before anything else falls back to EMPTY_SHELL — this is the
  // fix for "navigate away and the in-progress build vanishes with zero warning." Tenant-
  // AND page-scoped (§9): the key always carries tenantId, and a page that already has a
  // DB row gets its own key distinct from the tenant's blank-composer slot, so opening a
  // different page can never resurrect a stray draft written against a different one.
  const draftRestoreRef = useRef<{ key: string | null; applied: boolean }>({ key: null, applied: false });
  useEffect(() => {
    if (!tenantId) return;
    // Session-scoped when the builder is opened FOR a session (Slice 2), else page-scoped for
    // the legacy ?pageId path (behavior unchanged there).
    const key = studioDraftKey(tenantId, sessionId ?? null, pageIdProp ?? null);
    if (draftRestoreRef.current.key === key) return; // already resolved this exact draft once
    const snapshot = loadPageDraftSnapshot(key);
    draftRestoreRef.current = { key, applied: !!snapshot };
    if (!snapshot) return;
    setState((s) => ({
      ...s,
      pageId: snapshot.pageId,
      // Session scope (Slice 2) — prefer the live sessionId prop; fall back to whatever the
      // snapshot carried so an older, pre-session snapshot still restores cleanly.
      sessionId: sessionId ?? snapshot.sessionId ?? s.sessionId,
      artifacts: snapshot.artifacts ?? s.artifacts,
      activeArtifactId: snapshot.activeArtifactId ?? s.activeArtifactId,
      activeArtifactType: snapshot.activeArtifactType ?? s.activeArtifactType,
      title: snapshot.title,
      slug: snapshot.slug,
      slugTouched: snapshot.slugTouched,
      blocks: snapshot.blocks,
      theme: snapshot.theme,
      seo: snapshot.seo,
      formSchema: snapshot.formSchema,
      brief: snapshot.brief,
      composerValue: snapshot.composerValue ?? "",
      mode: snapshot.mode,
      clarifying: snapshot.clarifying,
      selectedIndex: snapshot.selectedIndex,
      // Recovered content hasn't been confirmed by a real Save from this mount's point of
      // view — mark it dirty so the top bar's Save affordance reads honestly, not silently.
      dirty: true,
      error: null,
    }));
    // A restored snapshot with artifacts already reflects a session past its first save — don't
    // re-title on the next link.
    if ((snapshot.artifacts?.length ?? 0) > 0) {
      firstLinkRef.current = false;
      autoNamedRef.current = true;
    }
    toast({
      title: "Draft restored",
      description: "Picked up right where you left off — hit Save to make it permanent.",
    });
  }, [tenantId, sessionId, pageIdProp, toast]);

  // ── open an existing draft ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || !pageIdProp) return;
    // A local client-side draft for this EXACT page was just restored above — it already
    // reflects everything the DB has, plus whatever wasn't saved yet, so re-fetching here
    // would clobber unsaved edits with the older saved row (the very bug this mechanism
    // exists to close).
    if (
      draftRestoreRef.current.key === studioDraftKey(tenantId, sessionId ?? null, pageIdProp) &&
      draftRestoreRef.current.applied
    ) {
      return;
    }
    let live = true;
    loadPageDraft({ tenantId, pageId: pageIdProp })
      .then((page) => {
        if (!live) return;
        patch({
          pageId: page.id,
          title: page.title,
          slug: page.slug,
          slugTouched: true,
          status: page.status,
          blocks: page.blocks,
          theme: page.theme,
          seo: page.seo,
          formSchema: null,
          mode: page.blocks.length > 0 ? "canvas" : "compose",
          clarifying: EMPTY_CLARIFYING,
          dirty: false,
          publishedUrl: null,
          error: null,
        });
      })
      .catch((err) => {
        if (live) patch({ error: asStudioError(err, "NOT_FOUND") });
      });
    return () => {
      live = false;
    };
  }, [tenantId, sessionId, pageIdProp, patch]);

  // ── open a SESSION (Slice 2) ──────────────────────────────────────────────────────
  // Sits ALONGSIDE the pageId-open effect above (which stays for the legacy ?pageId deep-link).
  // On mount with a sessionId: loadSession stamps recency (§10) and hydrates the primary page
  // artifact (delegating to loadPageDraft). A zero-artifact session seeds the composer brief from
  // the DURABLE seed_brief (blocking #4), never from ephemeral router state alone. A restored
  // local snapshot for this session ran first, so unsaved work WINS over the DB row — we still
  // adopt the session identity + manifest, but never clobber restored content.
  const sessionLoadRef = useRef<string | null>(null);
  // Bridge to handleBriefSubmit for the autostart fire (Defect 1). MUST be handleBriefSubmit, NOT
  // runGenerate: handleBriefSubmit is the ONE entry that runs classifyStudioIntent, so the Home
  // brief decides its own shape (page/funnel/form/image) exactly like a manual first submit
  // (§18/§19). Firing runGenerate directly would hardwire every Home build to a lone page.
  // handleBriefSubmit is declared LATER, so the session-load effect can't take it as a dependency
  // without a TDZ at the deps-array eval. A ref kept pointed at the live callback (synced in an
  // effect below, after handleBriefSubmit exists) lets the async loadSession .then() invoke the
  // current one — the same indirection latestDraftWriteRef already uses for the unmount flush.
  const briefSubmitRef = useRef<(brief: string) => void>(() => {});
  // Guards the autostart fire to EXACTLY ONCE per session (R1) — mirrors sessionLoadRef/
  // autoNamedRef. Claimed (set to the sessionId) BEFORE firing, so a re-entered effect (a dep
  // change, StrictMode's setup→cleanup→setup) can never fire runGenerate a second time.
  const autostartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tenantId || !sessionId) return;
    if (sessionLoadRef.current === sessionId) return; // resolved this session once
    sessionLoadRef.current = sessionId;
    setSessionNotFound(false);

    const key = studioDraftKey(tenantId, sessionId, null);
    const restored = draftRestoreRef.current.key === key && draftRestoreRef.current.applied;
    // Seed the brief instantly from the navigation state so the composer isn't blank for a beat
    // (loadSession then confirms it from the durable seed_brief). Skipped on autostart: the brief
    // is a SENT turn, not text waiting to be sent — the box stays empty while the build fires.
    if (initialBrief && !restored && !autostart) patch({ composerValue: initialBrief });

    let live = true;
    loadSession({ tenantId, sessionId })
      .then((loaded) => {
        if (!live) return;
        firstLinkRef.current = loaded.artifacts.length === 0;
        // A session that already has artifacts AND a real (non-default) title is named — don't
        // re-title it on a later regeneration. But an image/document chat build links its artifact
        // server-side and never ran the client rename, so it can have artifacts yet still read
        // "Untitled project" (#292): those stay eligible to auto-name (on-load rename just below,
        // and the first streamed artifact). A fresh/empty resumed session is likewise eligible.
        autoNamedRef.current = loaded.artifacts.length > 0 && !isUnnamedProject(loaded.session.title);

        // Autostart decision (Defect 1). A fresh session opened WITH build intent from Home fires
        // the build ONCE, straight into runGenerate's brand/clarify gate. Computed OUTSIDE the
        // setState updater (updaters must stay pure — StrictMode double-invokes them) and gated so
        // it never fires over: a restored snapshot (R4), a built page (R5 has a primary), a
        // non-page-primary session (R5 — artifacts present), an empty brief / cold deep-link (R6),
        // or a second time for the same session (R1, autostartRef).
        const isZeroArtifact = !loaded.primary && loaded.artifacts.length === 0;
        const autostartSeed = (loaded.session.seedBrief ?? initialBrief ?? "").trim();
        // #292 — the SESSION's first build now runs through the design CHAT (StudioChat fires the
        // brief once), NOT the legacy composer. A fresh session with a brief hands that brief to the
        // chat; the legacy autostart generation stays OFF so the two engines never double-drive the
        // canvas (§13). `chatSeed` is what the chat auto-sends; `willAutostart` is retired here.
        const chatSeed =
          (autostart && !restored && isZeroArtifact && autostartSeed.length > 0 && autostartRef.current !== sessionId)
            ? autostartSeed : null;
        const willAutostart = false;

        setState((s) => {
          // Always adopt the session's identity + manifest.
          const base: ShellState = { ...s, sessionId, artifacts: loaded.artifacts };
          // Unsaved local work already restored — keep it; just carry the session scope.
          if (restored) return base;
          if (loaded.primary) {
            return {
              ...base,
              pageId: loaded.primary.id,
              activeArtifactId: loaded.primary.id,
              activeArtifactType: loaded.primaryType,
              title: loaded.primary.title,
              slug: loaded.primary.slug,
              slugTouched: true,
              status: loaded.primary.status,
              blocks: loaded.primary.blocks,
              theme: loaded.primary.theme,
              seo: loaded.primary.seo,
              mode: loaded.primary.blocks.length > 0 ? "canvas" : "compose",
              dirty: false,
              // A RETURN to an already-built project opens a CLEAN composer — the old brief never
              // sticks in the box (owner: "no sticky words"). `brief` is left as `base`'s "" here;
              // Rebuild stays disabled until a fresh brief is submitted, which is correct.
              composerValue: "",
              publishedUrl: null,
              error: null,
            };
          }
          // Zero-artifact (fresh) session. On autostart the brief becomes a SENT turn (fired just
          // below) — keep the box empty for the cutscene. Otherwise seed the LIVE composer from the
          // navigation brief only; the DURABLE seed_brief is deliberately NOT a fallback here
          // (Defect 2), so a resume — where initialBrief is undefined — shows a clean box for EVERY
          // artifact type, not the old sticky prompt. Rebuild reads `brief`, written by runGenerate.
          return {
            ...base,
            composerValue: willAutostart ? "" : s.composerValue || initialBrief || "",
            mode: "compose",
            error: null,
          };
        });

        // Fire OUTSIDE the updater, once. Claim the guard BEFORE firing (R1) so nothing re-fires.
        // Routes through handleBriefSubmit → classifyStudioIntent, so the Home brief builds the
        // RIGHT artifact type (§18/§19), not a forced page.
        if (chatSeed) {
          // Hand the dashboard→session brief to the design chat, which fires it once as the first
          // turn. Claim the guard so a re-entered effect never re-seeds (#292 / verify #3).
          autostartRef.current = sessionId;
          setSessionSeedBrief(chatSeed);
        }
        void willAutostart; // legacy composer autostart retired for the session chat surface

        // ── #292 Fix B — REHYDRATE the session canvas on return ────────────────────────────
        // The session view reads `canvasArtifact`, and NOTHING seeded it on load: loadSession only
        // hydrates a PAGE primary into legacy state, so a returning image/page/funnel project fell
        // through to the first-run "Tell your designer what to make" empty even though its work is
        // saved. Seed the canvas from the most-recent RENDERABLE artifact — preferring the latest
        // image (a content ref carrying a thumbnail, which draws synchronously), then a page primary,
        // then a page/funnel/document. Guards (§13): skip a fresh build about to autostart (`chatSeed`),
        // an explicit rail ?open (the reopen resolver owns it), and restored unsaved local work; and
        // NEVER clobber a canvas already set (functional `prev ?? seed`) so a live stream/reopen wins.
        if (!restored && !openRef && !chatSeed) {
          // artifact_refs are appended newest-LAST (studio_manifest_ops); reverse → newest-first.
          const newestFirst = [...loaded.artifacts].reverse();
          const latestImage = newestFirst.find((a) => a.kind === "content" && !!a.thumbnailUrl);
          if (latestImage) {
            setCanvasArtifact((prev) => prev ?? { kind: "content", id: latestImage.id, title: latestImage.title, url: latestImage.thumbnailUrl });
          } else if (loaded.primary) {
            // The page primary is already in legacy state above; mirror it into the SESSION canvas
            // (the hydration effect then draws its real blocks via LivePreview).
            const p = loaded.primary;
            setCanvasArtifact((prev) => prev ?? { kind: "page", id: p.id, title: p.title, url: null });
          } else {
            const newest = newestFirst[0];
            if (newest?.kind === "page") {
              setCanvasArtifact((prev) => prev ?? { kind: "page", id: newest.id, title: newest.title, url: null });
            } else if (newest?.kind === "funnel") {
              setCanvasArtifact((prev) => prev ?? { kind: "funnel", id: newest.id, title: newest.title, url: null });
            } else if (newest?.kind === "content") {
              // A thumbnail-less content ref is a document or a standalone copy — resolve it the SAME
              // way the rail-reopen does (loadDocument → seed a document sheet). A copy is a chat
              // deliverable (§21), left to the rail; a genuine miss simply never seeds (§13, no fake).
              void loadDocument(tenantId, newest.id)
                .then((doc) => { if (live && doc) setCanvasArtifact((prev) => prev ?? { kind: "document", id: newest.id, title: doc.title || newest.title, url: null }); })
                .catch(() => { /* unresolved → leave the first-run empty; the rail still opens it */ });
            }
          }
        }

        // ── #292 Fix B — AUTO-NAME an existing untitled project on load ────────────────────
        // An image/document chat build links server-side, so its project can carry real artifacts yet
        // still read "Untitled project" in the grid. Derive a name from the first/primary artifact (its
        // title is a real, crafted signal; the seed brief is the fallback) and rename via the same seam
        // first-save uses. Idempotent (autoNamedRef, set above) and best-effort — a rename miss never
        // blocks the canvas (§13); the flags restore so a later build can reclaim the name.
        if (tenantId && sessionId && loaded.artifacts.length > 0 && !autoNamedRef.current) {
          const primaryRef = loaded.artifacts[0];
          const derived = deriveProjectName(primaryRef?.title, loaded.session.seedBrief ?? initialBrief);
          if (derived) {
            autoNamedRef.current = true;
            firstLinkRef.current = false;
            void renameStudioSession({ tenantId, sessionId, title: derived })
              .then((renamed) => { if (live) onManifestChange?.(renamed); })
              .catch((err) => {
                autoNamedRef.current = false;
                firstLinkRef.current = true;
                console.warn("[studio] auto-name on load (untitled resume) failed (non-fatal):", err);
              });
          }
        }
      })
      .catch((err) => {
        if (!live) return;
        if (isStudioError(err) && err.code === "NOT_FOUND") {
          setSessionNotFound(true);
        } else {
          patch({ error: asStudioError(err, "NOT_FOUND") });
        }
      });
    return () => {
      live = false;
    };
    // openRef + onManifestChange are read inside (seed guard / rename report). The whole effect is
    // guarded to run ONCE per session (sessionLoadRef), so a later openRef change just re-enters and
    // early-returns — adding them keeps the closure honest without re-seeding.
  }, [tenantId, sessionId, initialBrief, autostart, patch, openRef, onManifestChange]);

  // ── derived ───────────────────────────────────────────────────────────────────────
  const canvasBlocks = state.mode === "generating" ? generation.emitted : state.blocks;

  const selectedBlock =
    state.selectedIndex != null ? state.blocks[state.selectedIndex] ?? null : null;

  const target = selectedBlock
    ? {
        index: state.selectedIndex as number,
        blockType: selectedBlock.type,
        label: BLOCK_LABELS[selectedBlock.type],
      }
    : null;

  // The CURRENT page's own signup form, if this brief has one — DeliveryEditor needs its slug
  // to look up the (already auto-authored, on first save) growth_forms row.
  const embeddedFormSlug = useMemo(() => {
    const block = state.blocks.find(
      (b): b is Extract<GrowthBlock, { type: "embedded_form" }> => b.type === "embedded_form",
    );
    return block?.form_slug ?? null;
  }, [state.blocks]);

  const checks = useMemo(
    () =>
      preflightPublish({
        blocks: state.blocks,
        seo: state.seo,
        slug: state.slug,
        tenantSlug,
      }),
    [state.blocks, state.seo, state.slug, tenantSlug],
  );

  // ── the mode-tab strip (§18) — never an upfront 5-way picker ───────────────────────
  // `visited` (above) only proves a mode was MOUNTED, not that anything real lives there —
  // a fresh session mounts "page" the instant StudioShell renders, before the operator has
  // typed a word. The tab strip needs a STRICTER signal: does this mode actually hold an
  // §21 (owner 2026-07-17): there is NO artifact-type strip in the top bar — not an upfront
  // picker, and not a content-derived "switch what you built" tab row either. Everything a tenant
  // makes streams in this ONE session; the persistent navigator is the project rail
  // (ProjectNavigator), which lists artifacts by name. So the shell no longer computes a
  // per-type "visibleModes" set — the classifier still routes the brief to the right surface, but
  // the human never sees or clicks a type. See StudioTopBar.tsx for the matching removal.

  const setTitle = useCallback((title: string) => {
    setState((s) => ({
      ...s,
      title,
      slug: s.slugTouched ? s.slug : kebabSlug(title),
      dirty: true,
    }));
  }, []);

  const setSlug = useCallback((slug: string) => {
    setState((s) => ({ ...s, slug, slugTouched: true, dirty: true }));
  }, []);

  // ── reference/deliverable attachments (§10/§13) ────────────────────────────────────
  // Real uploads, tenant-scoped, real permanent URLs — never a File held only in memory.
  // The upload itself goes through studio.ts (the one file that touches Supabase); this is
  // just the shell absorbing the result into state, same discipline as every other action here.
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (!tenantId) {
        toast({ title: "Pick a workspace first", description: STUDIO_ERROR_COPY.NO_TENANT, variant: "destructive" });
        return;
      }
      setAttachmentsBusy(true);
      try {
        for (const file of files) {
          try {
            const asset = await uploadGrowthAsset(tenantId, file);
            setState((s) => ({ ...s, attachments: [...s.attachments, asset] }));
          } catch (err) {
            toast({
              title: "Couldn't attach that file",
              description: isStudioError(err) ? err.message : "Try a different file.",
              variant: "destructive",
            });
          }
        }
      } finally {
        setAttachmentsBusy(false);
      }
    },
    [tenantId, toast],
  );

  const handleRemoveAttachment = useCallback((index: number) => {
    setState((s) => ({ ...s, attachments: s.attachments.filter((_, i) => i !== index) }));
  }, []);

  // ── generate (whole page) ─────────────────────────────────────────────────────────
  // The actual run: capture the pre-run blocks (for a clean cancel), flip to "generating",
  // call the seam, absorb the result. Shared by both the direct path (gate said "skip it")
  // and the clarifying rail's own submit — one generate call site, no fork.
  const generateWholePage = useCallback(
    async (compiledBrief: string, questionnaireAnswer?: string) => {
      blocksBeforeRun.current = state.blocks;
      const attachmentsForCall = state.attachments;
      setState((s) => ({
        ...s,
        mode: "generating",
        selectedIndex: null,
        instruction: "",
        error: null,
        publishedUrl: null,
      }));

      const result = await generate({
        brief: compiledBrief,
        questionnaireAnswer,
        attachments: attachmentsForCall.map((a) => ({ url: a.url, mediaType: a.mimeType, kind: a.kind })),
      });
      // A failure stays on the canvas and narrates itself inside GenerationExperience (with
      // a Retry). A cancel is handled by handleCancel, which restores the previous blocks.
      if (!result) return;

      const seo: StudioSeoDraft = result.seo ?? {};
      // Resolve the model's suggested_delivery index back to a REAL uploaded asset URL —
      // purely a proposal DeliveryEditor surfaces (§15); nothing here writes to a form.
      const suggestedUrl =
        result.suggestedDelivery != null
          ? attachmentsForCall[result.suggestedDelivery.assetIndex]?.url ?? null
          : null;
      setState((s) => ({
        ...s,
        blocks: result.blocks,
        theme: result.theme,
        seo,
        formSchema: result.formSchema ?? null,
        suggestedDeliveryAssetUrl: suggestedUrl,
        title: seo.title ?? s.title,
        slug: s.slugTouched ? s.slug : kebabSlug(seo.title ?? s.title),
        mode: "canvas",
        dirty: true,
        error: null,
      }));
      reset();

      // Auto-name the project the instant it has real content (#294) — best-effort, once per
      // session. Named from the generated page's own title (falling back to the brief) via the
      // same rename seam first-save uses, so the rail + gallery stop showing "Untitled" without
      // waiting for a save. Non-fatal: a rename failure never blocks the canvas.
      if (tenantId && sessionId && !autoNamedRef.current) {
        const derived = deriveProjectName(seo.title, compiledBrief);
        if (derived) {
          // Claim BOTH naming flags synchronously, BEFORE awaiting the rename — otherwise a save
          // landing during the RPC round trip sees firstLinkRef still true and fires a SECOND,
          // competing rename that races this one (and could disagree on a long title). Both are
          // restored on failure so a later build (or the first save) can reclaim the naming.
          autoNamedRef.current = true;
          firstLinkRef.current = false;
          void renameStudioSession({ tenantId, sessionId, title: derived })
            .then((renamed) => onManifestChange?.(renamed))
            .catch((err) => {
              autoNamedRef.current = false; // let a later build retry the name
              firstLinkRef.current = true; // and let the first save reclaim the naming
              console.warn("[studio] auto-name on first generate failed (non-fatal):", err);
            });
        }
      }

      // Capture a real gallery cover of the freshly-built page (#295): arm it now, let the
      // canvas frame's settle edge fire it (handleFrameSettled). Best-effort, page-only (this is
      // the whole-page path), never blocks the canvas (§13). If a build somehow yields zero
      // blocks (no LivePreview mounts, no settle edge), the flag simply stays armed and the next
      // successful build captures its own page — harmless, self-correcting.
      if (tenantId && sessionId) thumbnailPendingRef.current = true;
    },
    [state.blocks, state.attachments, generate, reset, tenantId, sessionId, onManifestChange],
  );

  // ── the clarifying gate (§15) — a thin or questionnaire-signaling brief is grounded in a
  //    few real specifics BEFORE a model call is spent, instead of Paige guessing them.
  //    Takes the raw (not-yet-committed) brief directly, rather than reading it back off
  //    `state` a tick later, so the fast path below never races React's setState batching. ──
  const runGenerate = useCallback(
    (brief: string) => {
      if (!tenantId) {
        patch({ error: { code: "NO_TENANT", message: STUDIO_ERROR_COPY.NO_TENANT, recoverable: false } });
        return;
      }
      const decision = shouldClarify(brief);
      if (!decision.needed) {
        setState((s) => ({ ...s, brief, clarifying: EMPTY_CLARIFYING }));
        void generateWholePage(brief);
        return;
      }
      setState((s) => ({
        ...s,
        brief,
        mode: "clarifying",
        clarifying: {
          questions: decision.formSignal
            ? [...CLARIFYING_QUESTIONS, QUESTIONNAIRE_FIELDS_QUESTION]
            : CLARIFYING_QUESTIONS,
          // Carry forward any answers already on hand (e.g. a Regenerate/Retry re-entering
          // this gate) — never wipe a previously-answered questionnaire back to blank, or a
          // second pass could silently fall back to the generic filler the operator already
          // fixed once.
          answers: s.clarifying.answers,
        },
        error: null,
      }));
    },
    [tenantId, patch, generateWholePage],
  );

  // Every rendered question must be answered before the gate lets the operator through —
  // otherwise "Build the page" is one click away from reproducing the exact generic-filler
  // behavior this step exists to close (composeBrief with empty answers is a no-op).
  const clarifyingAnswered = state.clarifying.questions.every(
    (q) => (state.clarifying.answers[q.id] ?? "").trim().length > 0,
  );

  // The clarifying rail's own submit. Gated on clarifyingAnswered above — reachable only once
  // every question has a real answer, so composeBrief never runs against an empty answer map.
  const proceedToGenerate = useCallback(() => {
    const compiled = composeBrief(state.brief, state.clarifying.answers);
    const questionnaireAnswer = state.clarifying.answers[QUESTIONNAIRE_FIELDS_QUESTION_ID]?.trim() || undefined;
    void generateWholePage(compiled, questionnaireAnswer);
  }, [state.brief, state.clarifying, generateWholePage]);

  const setClarifyingAnswer = useCallback((id: string, value: string) => {
    setState((s) => ({ ...s, clarifying: { ...s.clarifying, answers: { ...s.clarifying.answers, [id]: value } } }));
  }, []);

  const backToCompose = useCallback(() => {
    patch({ mode: "compose", clarifying: EMPTY_CLARIFYING });
  }, [patch]);

  const handleCancel = useCallback(() => {
    cancel();
    setState((s) => ({
      ...s,
      mode: blocksBeforeRun.current.length > 0 ? "canvas" : "compose",
      blocks: blocksBeforeRun.current,
    }));
  }, [cancel]);

  // ── save the draft ────────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (): Promise<{ id: string; slug: string } | null> => {
    if (!tenantId) {
      patch({ error: { code: "NO_TENANT", message: STUDIO_ERROR_COPY.NO_TENANT, recoverable: false } });
      return null;
    }
    if (state.blocks.length === 0) {
      patch({ error: { code: "NO_DRAFT", message: STUDIO_ERROR_COPY.NO_DRAFT, recoverable: true } });
      return null;
    }
    const desiredSlug = state.slug || kebabSlug(state.title) || kebabSlug(state.seo?.title ?? "");
    if (!desiredSlug) {
      patch({ error: { code: "INVALID_SLUG", message: STUDIO_ERROR_COPY.INVALID_SLUG, recoverable: true } });
      return null;
    }

    patch({ saving: true, error: null });
    try {
      // Creating (no pageId) must claim a slug nobody else owns. growth_page_upsert does
      // ON CONFLICT (tenant_id, slug) DO UPDATE — so saving a NEW page onto an existing
      // page's slug would silently overwrite that page's draft. Editing keeps its own slug.
      const slug = state.pageId ? desiredSlug : await uniqueGrowthPageSlug(tenantId, desiredSlug);

      const row = await savePageDraft({
        tenantId,
        pageId: state.pageId,
        slug,
        title: state.title || state.seo?.title || "Untitled",
        blocks: state.blocks,
        theme: state.theme,
        seo: state.seo,
        formSchema: state.formSchema,
      });
      setState((s) => ({
        ...s,
        pageId: row.id,
        slug: row.slug,
        title: row.title || s.title,
        status: row.status === "published" ? "published" : "draft",
        saving: false,
        dirty: false,
      }));
      // A real DB row backs this content now — the client-side recovery draft has done
      // its job and must not linger stale past the point the operator actually committed
      // (this fires for the explicit Save button, Publish's save-first step, and the
      // section-edit path's implicit save — every one of them means a DB row now exists).
      clearPageDraftSnapshot(studioDraftKey(tenantId, sessionId ?? null, state.pageId));
      // Wire the saved page into its owning session (Slice 2) — idempotent, non-fatal, and it
      // titles the project from the real page on the first save (§19). No-op without a session.
      void linkPrimaryArtifact("page", row.id, row.title || state.title);
      onSaved?.({ id: row.id, slug: row.slug });
      return { id: row.id, slug: row.slug };
    } catch (err) {
      const e = asStudioError(err, "SAVE_FAILED");
      patch({ saving: false, error: e });
      return null;
    }
  }, [tenantId, sessionId, state.blocks, state.slug, state.title, state.seo, state.pageId, state.theme, state.formSchema, onSaved, patch, linkPrimaryArtifact]);

  const handleSave = useCallback(async () => {
    const saved = await saveDraft();
    if (saved) toast({ title: "Draft saved", description: "Your page is safe. Publish it when you're ready." });
  }, [saveDraft, toast]);

  // ── publish (save FIRST, then publish — always, in that order) ─────────────────────
  // ── the brain's LEARN direction, fired AFTER a successful publish (#310, §15) ───────────────
  // Best-effort by construction (§13): the artifact already went live, so this can never surface as
  // a publish failure — learnFromArtifact swallows everything to a LearnResult. Default autonomy is
  // 'confirm', so the common path is needs_confirm → a transient toast that asks first (§15) and
  // only saves on the tenant's explicit click. 'learned' reports the real win; 'blocked'/'error'
  // say nothing (never claim a save that didn't happen).
  const learnWorkspace = useRef({ tenantId });
  if (learnWorkspace.current.tenantId !== tenantId) learnWorkspace.current = { tenantId };
  const runLearn = useCallback(
    async (artifactType: LibraryKind, artifactId: string, confirmed = false) => {
      if (!tenantId || !artifactId) return;
      const submittedWorkspace = learnWorkspace.current;
      const res = await learnFromArtifact({ tenantId, artifactType, artifactId, confirmed });
      if (learnWorkspace.current !== submittedWorkspace) return;
      if (res.kind === "learned") {
        toast({ title: "Paige learned from this", description: res.message });
      } else if (res.kind === "partial" || res.kind === "uncertain") {
        toast({ title: res.kind === "partial" ? "Knowledge partially indexed" : "Review knowledge", description: res.message });
      } else if (res.kind === "needs_confirm") {
        toast({
          title: "Teach your Paige from this?",
          description: res.proposal,
          action: (
            <ToastAction altText="Save to knowledge base" onClick={() => void runLearn(artifactType, artifactId, true)}>
              Save
            </ToastAction>
          ),
        });
      }
      // blocked / error → silent (§13)
    },
    [tenantId, toast],
  );

  // ── deliberate keep: promote ONE artifact into the Saved media library (#284/#314) ──────────────
  // The winner-curation act (distinct from publish), shared by every keepable surface: the page
  // top-bar keep, and the Assets panel's per-item keep for images and copy (#314). Keeps via the
  // save_to_library seam, then fires the confirm-gated learn — a deliberate keep is a strong voice
  // signal (§7/§15). Honest (§13): returns true only on a keep that actually persisted; owns no busy
  // state so each caller can drive its own spinner/feedback.
  const keepInLibrary = useCallback(
    async (kind: LibraryKind, artifactId: string, title: string, thumbnailUrl?: string | null): Promise<boolean> => {
      if (!tenantId || !artifactId) return false;
      try {
        await saveToLibrary({ tenantId, kind, artifactId, title, thumbnailUrl: thumbnailUrl ?? null });
        // Name the destination exactly as the tenant sees it in the nav ("Saved library"), never the
        // internal #284 codename "media library" (§6/§13 continuity).
        toast({ title: "Kept in your library", description: "Added to your Saved library." });
        void runLearn(kind, artifactId); // best-effort; never blocks or fails the keep (§13)
        return true;
      } catch (err) {
        toast({
          title: "Couldn't save to your library",
          description: isStudioError(err) ? err.message : "Try again in a moment.",
          variant: "destructive",
        });
        return false;
      }
    },
    [tenantId, runLearn, toast],
  );

  // The page keep: ensure the page is saved first (a library row must point at a real growth_pages
  // id), give the board a REAL preview thumbnail (§22), then keep it.
  const handleSaveToLibrary = useCallback(async () => {
    if (!tenantId) return;
    setSavingToLibrary(true);
    try {
      const saved = await saveDraft();
      const pageId = saved?.id ?? state.pageId;
      if (!pageId) {
        toast({ title: "Nothing to save yet", description: "Build a little more first.", variant: "destructive" });
        return;
      }
      await keepInLibrary("page", pageId, state.title || "Untitled page", firstBlockImageUrl(state.blocks));
    } finally {
      setSavingToLibrary(false);
    }
  }, [tenantId, saveDraft, state.pageId, state.title, state.blocks, keepInLibrary, toast]);

  // The Assets-panel keep (#314): promote an image or a piece of copy (marketing_content) into the
  // Saved library. An image carries its URL as the board thumbnail; copy has none (a copy glyph).
  const handleKeepContent = useCallback(
    (item: { id: string; kind: "text" | "image"; title: string; imageUrl: string | null }): Promise<boolean> =>
      keepInLibrary(item.kind === "image" ? "image" : "copy", item.id, item.title || "Untitled", item.imageUrl),
    [keepInLibrary],
  );

  const handlePublish = useCallback(async () => {
    patch({ publishing: true, error: null });
    try {
      const saved = await saveDraft();
      if (!saved) {
        patch({ publishing: false });
        return;
      }
      if (!tenantId) {
        patch({ publishing: false, error: { code: "NO_TENANT", message: STUDIO_ERROR_COPY.NO_TENANT, recoverable: false } });
        return;
      }

      const result = await publishPage({ tenantId, pageId: saved.id });
      setState((s) => ({
        ...s,
        publishing: false,
        status: "published",
        publishedUrl: result.url,
        dirty: false,
        error: null,
      }));
      onPublished?.(result);
      // Feed the just-published page into the tenant's brain (never blocks publish, §13).
      void runLearn("page", result.id);
    } catch (err) {
      patch({ publishing: false, error: asStudioError(err, "PUBLISH_FAILED") });
    }
  }, [saveDraft, tenantId, onPublished, patch, runLearn]);

  // ── delete THIS project (session-level, all modes) ─────────────────────────────────
  // The in-session mirror of the gallery's card ⋯ Delete. Wired to the RECOVERABLE tier
  // (archive): the project drops out of every gallery view and can be restored, so an accidental
  // delete is never data loss (§13). We navigate back to the gallery ONLY after the archive
  // actually succeeds — never optimistically leave for a delete that didn't happen. The confirm
  // AlertDialog lives in StudioTopBar; this only runs on the operator's explicit confirm.
  const handleDeleteProject = useCallback(async () => {
    if (!tenantId || !sessionId) return;
    try {
      await setSessionStatus({ tenantId, sessionId, status: "archived" });
      navigate("/choose-account");
    } catch (err) {
      patch({ error: asStudioError(err, "SAVE_FAILED") });
      toast({
        title: "Couldn't delete this project",
        description: isStudioError(err) ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [tenantId, sessionId, navigate, patch, toast]);

  // ── build a whole funnel from one brief (§19) ──────────────────────────────────────
  // draftFunnel plans + drafts (reusing the page/form drafters server-side); then we persist
  // the real page/form/funnel rows. It renders in this same page surface — no navigation, no
  // tab. A fresh brief while a funnel is already up rebuilds it (refine-by-re-briefing, v1).
  const buildFunnel = useCallback(
    async (brief: string) => {
      if (!tenantId) {
        patch({ error: { code: "NO_TENANT", message: STUDIO_ERROR_COPY.NO_TENANT, recoverable: false } });
        return;
      }
      funnelIntendedRef.current = true; // committed — a failed build retries as a funnel, not a page
      setFunnelBuilding(true);
      setFunnelUrl(null);
      patch({ error: null });
      try {
        const draft = await draftFunnel(brief);
        // Rebuild in place when a funnel is already up (refine-by-re-briefing) — updates the
        // same page/form/funnel rows instead of stranding orphans in the libraries (§12).
        const built = await buildFunnelFromDraft({ tenantId, draft, existing: funnel });
        setFunnel(built);
        // Wire the built funnel into its owning session (Slice 2) — the funnel is the session's
        // primary artifact; idempotent + non-fatal, and titles the project on first build (§19).
        void linkPrimaryArtifact("funnel", built.funnelId, built.name);
        toast({
          title: "Funnel drafted",
          description: built.pageBlanks.length
            ? "Almost there — the entry page has a few blanks to fill before it can go live."
            : "Review the steps, then Publish funnel to take the whole sequence live.",
        });
      } catch (err) {
        patch({ error: asStudioError(err, "GENERATION_FAILED") });
      } finally {
        setFunnelBuilding(false);
      }
    },
    [tenantId, funnel, patch, toast, linkPrimaryArtifact],
  );

  // Leave the funnel and return to a blank composer (§13 — never trap the operator in one
  // artifact with no way out). Clears the built funnel and lets classification run fresh.
  const exitFunnel = useCallback(() => {
    setFunnel(null);
    setFunnelUrl(null);
    setFunnelBuilding(false);
    funnelIntendedRef.current = false;
    classifiedOnceRef.current = false;
    patch({ brief: "", composerValue: "", error: null });
    if (mode === "funnel") onModeChange?.("page");
  }, [mode, onModeChange, patch]);

  // Ship the whole funnel in one act (§19) — the cascade publishes the entry page then the
  // funnel, and reports the REAL url (§13). Reflect each step going live in the flow view.
  const handlePublishFunnel = useCallback(async () => {
    if (!tenantId || !funnel) return;
    if (funnel.pageBlanks.length > 0) return; // guarded — the page would be refused server-side
    setFunnelPublishing(true);
    patch({ error: null });
    // Mark the entry page published in the flow (used on both success AND partial-failure).
    const markPagePublished = () =>
      setFunnel((f) =>
        f
          ? {
              ...f,
              pageStatus: "published",
              steps: f.steps.map((s) => (s.kind === "page" ? { ...s, status: "published" } : s)),
            }
          : f,
      );
    try {
      const { url } = await publishFunnelCascade({ tenantId, funnel });
      markPagePublished();
      setFunnelUrl(url);
      toast({ title: "Funnel is live", description: url ? `Live at ${url}` : "Your funnel is published." });
      onFunnelCreated?.();
      // A published funnel is a keeper — file it in the media library, then teach the brain from it
      // (both best-effort, never block the publish, §13).
      void saveToLibrary({ tenantId, kind: "funnel", artifactId: funnel.funnelId, title: funnel.name })
        .then(() => runLearn("funnel", funnel.funnelId))
        .catch(() => runLearn("funnel", funnel.funnelId));
    } catch (err) {
      // §13: if the entry page went live before the funnel step failed, say so — don't let the
      // flow keep showing the page as a draft when it is actually on the internet.
      if (isFunnelPublishError(err)) {
        if (err.pagePublished) markPagePublished();
        patch({ error: asStudioError(err.cause, "PUBLISH_FAILED") });
      } else {
        patch({ error: asStudioError(err, "PUBLISH_FAILED") });
      }
    } finally {
      setFunnelPublishing(false);
    }
  }, [tenantId, funnel, patch, toast, onFunnelCreated, runLearn]);

  // ── the conversational per-section edit ───────────────────────────────────────────
  const handleSectionEdit = useCallback(
    async (instruction: string) => {
      const index = state.selectedIndex;
      const block = index != null ? state.blocks[index] : null;
      if (!tenantId || index == null || !block) return;

      patch({ editing: true, error: null });
      try {
        // The page must exist before a structural edit can be persisted against it.
        const pageId = state.pageId ?? (await saveDraft())?.id ?? null;
        if (!pageId) {
          patch({ editing: false });
          return;
        }

        const revised = await reviseBlock({ tenantId, index, block, instruction });
        // Reconcile from the array the server RETURNS, never from an optimistic local
        // mutation — the same page can be edited from Paige's chat at the same time.
        const next = await editBlocks({
          tenantId,
          pageId,
          ops: [{ op: "update", index, block: revised }],
        });
        setState((s) => ({
          ...s,
          blocks: next,
          instruction: "",
          editing: false,
          dirty: false,
          error: null,
        }));
        toast({ title: `Section ${index + 1} updated`, description: "The canvas shows exactly what will publish." });
      } catch (err) {
        patch({ editing: false, error: asStudioError(err, "EDIT_FAILED") });
      }
    },
    [tenantId, state.selectedIndex, state.blocks, state.pageId, saveDraft, patch, toast],
  );

  // ── the single entry point's routing decision (§18) ────────────────────────────────
  // Every submission from the page-mode composer lands here first. A section edit always
  // behaves exactly as before. Everything else classifies EXACTLY ONCE per session — the
  // first submission this session — and every submission after that (including the same
  // brief resubmitted via Rebuild it) is already committed to whatever mode it landed in.
  const handleBriefSubmit = useCallback(
    (value: string) => {
      if (target) {
        void handleSectionEdit(value);
        return;
      }
      // Clear the LIVE composer the instant we submit — `value` is already captured, so the build
      // is unaffected, and returning to this project shows a clean box (no sticky words). The
      // durable `brief` (Rebuild's source) is written separately by runGenerate.
      patch({ composerValue: "" });
      // Committed to a funnel this session (built, building, entered via funnel intent, or a
      // prior funnel build that failed) — a new brief (re)builds the funnel in this same
      // surface (§19), and a post-failure retry stays a funnel instead of falling through to
      // a lone page build (§13/§18). Checked BEFORE classifiedOnceRef, which is already true.
      if (funnel || funnelBuilding || funnelIntendedRef.current) {
        void buildFunnel(value);
        return;
      }
      if (classifiedOnceRef.current) {
        void runGenerate(value);
        return;
      }
      classifiedOnceRef.current = true;
      setClassifying(true);
      void (async () => {
        try {
          const { artifact } = await classifyStudioIntent(value);
          switch (artifact) {
            case "funnel":
              // The whole funnel builds right here — no tab, no navigation (§18/§19).
              void buildFunnel(value);
              break;
            case "form": {
              // A form draft never enters a generation cutscene (page/image do; form's own
              // building-screen parity is separate, #300). So disarm the dashboard-handoff cutscene
              // flag here — otherwise it stays armed (no isGenerating/imageBuilding cycle to
              // clear it) and would wrongly full-screen the NEXT in-session build (verifier catch).
              setAutostartBuild(false);
              onModeChange?.("form");
              try {
                const schema = await draftFormSchema(value);
                setDraftedFormSchema(schema);
              } catch (err) {
                // The classify step already spent a call getting this far — an honest miss
                // here still lands the operator in Form mode with its normal template picker,
                // never a dead end (§13).
                toast({
                  title: "Couldn't draft that form",
                  description: isStudioError(err) ? err.message : "Pick a template below to keep going.",
                  variant: "destructive",
                });
              }
              break;
            }
            case "image":
              setDraftedImagePrompt(value);
              setAutoRunImage(true);
              onModeChange?.("image");
              break;
            case "page":
            default:
              void runGenerate(value);
              break;
          }
        } catch (err) {
          // classifyStudioIntent defaults to "page" on transport failure rather than throwing, so
          // this is a defensive backstop: if the classify path ever throws, don't leave the handoff
          // cutscene armed for the next in-session build, and surface an honest miss instead of a
          // silent unhandled rejection (§13).
          setAutostartBuild(false);
          toast({
            title: "Couldn't read that brief",
            description: isStudioError(err) ? err.message : "Try describing what you want again.",
            variant: "destructive",
          });
        } finally {
          setClassifying(false);
        }
      })();
    },
    [target, funnel, funnelBuilding, buildFunnel, runGenerate, handleSectionEdit, onModeChange, toast],
  );

  // Keep the autostart bridge pointed at the live handleBriefSubmit (declared just above, so this
  // sync must live AFTER it to avoid a TDZ on the deps array). loadSession is real async IO, so its
  // .then() always runs after this effect has set the ref — the autostart fire never sees the no-op
  // placeholder, and it always classifies the Home brief into the right artifact type (§18/§19).
  useEffect(() => {
    briefSubmitRef.current = handleBriefSubmit;
  }, [handleBriefSubmit]);

  // ── persist the client-side draft (no DB write) ───────────────────────────────────
  // The Studio holds the in-progress design ONLY in this component's state until an
  // explicit Save/Publish — route-swapping to any other admin section unmounts this whole
  // tree and, without this, silently destroys whatever wasn't saved. Debounced so typing a
  // brief doesn't hammer localStorage on every keystroke; only the fields needed to recover
  // (never saving/publishing/editing/error/dirty — those reset fresh on rehydrate).
  const latestDraftWriteRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!tenantId) return;
    // Nothing worth protecting yet (a blank composer, or right after Cancel/backToCompose
    // restored an empty canvas) — skip the write entirely rather than stamp an empty
    // snapshot over whatever's already stored, which would otherwise surface a hollow
    // "Draft restored" toast on the next mount for content that was never really there.
    const hasContent =
      state.blocks.length > 0 ||
      state.brief.trim().length > 0 ||
      state.composerValue.trim().length > 0 ||
      state.title.trim().length > 0;
    if (!hasContent) return;
    const key = studioDraftKey(tenantId, sessionId ?? null, state.pageId);
    const snapshot: PageDraftSnapshot = {
      pageId: state.pageId,
      sessionId: state.sessionId,
      artifacts: state.artifacts,
      activeArtifactId: state.activeArtifactId,
      activeArtifactType: state.activeArtifactType,
      title: state.title,
      slug: state.slug,
      slugTouched: state.slugTouched,
      blocks: state.blocks,
      theme: state.theme,
      seo: state.seo,
      formSchema: state.formSchema,
      brief: state.brief,
      composerValue: state.composerValue,
      mode: state.mode,
      clarifying: state.clarifying,
      selectedIndex: state.selectedIndex,
    };
    const write = () => savePageDraftSnapshot(key, snapshot);
    latestDraftWriteRef.current = write;
    const id = window.setTimeout(write, 400);
    return () => window.clearTimeout(id);
  }, [
    tenantId,
    sessionId,
    state.pageId,
    state.sessionId,
    state.artifacts,
    state.activeArtifactId,
    state.activeArtifactType,
    state.title,
    state.slug,
    state.slugTouched,
    state.blocks,
    state.theme,
    state.seo,
    state.formSchema,
    state.brief,
    state.composerValue,
    state.mode,
    state.clarifying,
    state.selectedIndex,
  ]);

  // A true unmount (the route swap that eats in-progress work today) flushes whatever the
  // debounce hadn't gotten to yet — the one moment this bug actually bites, so it's the one
  // moment the timer is never allowed to lose the race against navigation.
  useEffect(() => {
    return () => {
      latestDraftWriteRef.current();
    };
  }, []);

  // ── the page canvas ───────────────────────────────────────────────────────────────
  const busy = isGenerating || state.editing;

  // A funnel — classified from this composer, OR entered via the funnel intent (mode="funnel",
  // e.g. the Funnels library's "New funnel") — renders IN this same page surface (§18/§19):
  // FunnelFlow replaces the page canvas, the composer builds/refines it, the top bar ships it.
  // There is no separate funnel mode/tab; funnelIntent just primes this same surface.
  const funnelIntent = mode === "funnel";
  const funnelActive = (mode === "page" || funnelIntent) && (funnel != null || funnelBuilding || funnelIntent);

  let pageCanvas: ReactNode;
  if (funnelActive) {
    if (funnel) {
      pageCanvas = <FunnelFlow funnel={funnel} url={funnelUrl} />;
    } else if (funnelBuilding) {
      // Building state — Paige's team drafting the whole funnel (page + form) at once. Routes through
      // the SAME branded §22 cutscene the page/document build path uses (#292 Fix C) — a living
      // PaigeMark on the brand aurora field, not a bare gray-card spinner. Indeterminate: the funnel
      // draft is one server call with no client-measurable phases (§13, honest), so it runs the
      // ambient regime + an honest elapsed clock. Gold lives only in PaigeMark (§11).
      pageCanvas = (
        <StudioBuildingScreen
          indeterminate
          note="Building your funnel"
          detail="Drafting the landing page and the intake form, then wiring them together."
          agent="Design agent"
          elapsedMs={funnelElapsedMs}
          reduce={!!reduceMotion}
          ariaLabel="Paige is building your funnel"
        />
      );
    } else {
      // Funnel intent, nothing built yet — a crafted prompt to describe the funnel (never a
      // blank or a stray "loading"). The composer below is the one way in (§18).
      pageCanvas = (
        <div className="grid h-full place-items-center">
          <SectionCard className="max-w-md">
            <EmptyState
              icon={Wand2}
              tone="brand"
              title="Describe your funnel"
              description="Tell Paige what the funnel is for and who it's for — she'll build the whole sequence: a landing page, an intake form, and a thank-you, wired together and ready to publish."
            />
          </SectionCard>
        </div>
      );
    }
  } else if (state.mode === "generating") {
    pageCanvas = (
      <GenerationExperience
        generation={generation}
        theme={state.theme}
        brandFloor={state.brandFloor}
        tenantId={tenantId ?? undefined}
        device={state.device}
        onRetry={() => void runGenerate(state.brief)}
      />
    );
  } else if ((state.mode === "canvas" || state.mode === "clarifying") && canvasBlocks.length > 0) {
    // "clarifying" is included here so a REGENERATE of an already-built page (existing
    // blocks) never blanks the canvas while the operator answers a few more questions —
    // only a genuinely fresh page (no blocks yet) falls through to the empty state below.
    pageCanvas = (
      <LivePreview
        blocks={canvasBlocks}
        theme={state.theme}
        brandFloor={state.brandFloor}
        tenantId={tenantId ?? undefined}
        device={state.device}
        interactive
        selectedIndex={state.selectedIndex}
        onSelectBlock={(index) => patch({ selectedIndex: index, instruction: "" })}
        onFrameSettled={handleFrameSettled}
      />
    );
  } else {
    // The empty state sits on a real elevated SectionCard (the reference-bar primitive —
    // bg-card + border + shadow-card) centered on the drafting-surface well, so it reads as a
    // crafted card floating on the working surface instead of bare text top-anchored in a dead
    // expanse. `grid h-full place-items-center` fixes EmptyState's own py-12 top-anchoring;
    // wrapping EmptyState in SectionCard is the exact pattern the no-workspace gate below
    // already uses (§11 primitive reuse, in-file precedent). EmptyState stays unforked.
    pageCanvas = (
      <div className="grid h-full place-items-center">
        <SectionCard className="max-w-md">
          <EmptyState
            icon={Wand2}
            tone="brand"
            title={MODE_EMPTY.page.title}
            description={MODE_EMPTY.page.description}
          />
        </SectionCard>
      </div>
    );
  }

  // h-full on PageShell gives the inner h-full a definite parent to resolve against — the
  // immersive StudioLayout outlet is definite-height, but PageShell's own root is auto-height,
  // so without this the builder collapsed to StudioFrame's 620px floor with dead space below.
  const wrap = (node: ReactNode) =>
    embedded ? (
      <>{node}</>
    ) : (
      <PageShell width="full" className={cn("h-full min-h-0", className)}>
        <div className="h-full min-h-0 lg:h-full">{node}</div>
      </PageShell>
    );

  // ── still resolving the workspace: a themed skeleton, never a live-but-inert composer.
  //    Platform staff carry no active tenant (§9), so we wait for the resolve to settle
  //    before deciding between the Studio and the hard gate — a composer that can't write
  //    anywhere must never render as if it can. ───────────────────────────────────────
  if (tenantLoading && !tenantId) {
    return wrap(
      <StudioFrame className={embedded ? className : undefined} dark={studioDark}>
        {/* Skeleton parity (StudioFrame's own "never flashes between shells" contract): the
            loading strip/rail/well must carry the SAME masthead wash, top-lit rail gradient,
            and drafting-surface texture the live Studio now has, or the surface visibly
            flattens for a beat and then pops richer once the workspace resolves. */}
        <div className="h-14 shrink-0 border-b border-border/60 bg-gradient-to-b from-card to-muted/20 shadow-sm" />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="border-b border-border/60 bg-gradient-to-b from-card to-background p-4 lg:w-[380px] lg:shrink-0 lg:border-b-0 lg:border-r">
            <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" />
          </div>
          <div className="studio-drafting-grid flex-1 p-4 md:p-6">
            <div className="h-full min-h-[16rem] animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" />
          </div>
        </div>
      </StudioFrame>,
    );
  }

  // ── no workspace: a hard gate, not a broken surface ───────────────────────────────
  if (!tenantLoading && !tenantId) {
    return wrap(
      <StudioFrame className={embedded ? className : undefined} dark={studioDark}>
        <div className="flex h-14 shrink-0 items-center border-b border-border/60 bg-gradient-to-b from-card to-muted/20 px-4 shadow-sm">
          <span className="font-display text-sm font-semibold text-foreground">Studio</span>
        </div>
        <div className="grid flex-1 place-items-center p-6">
          <SectionCard className="max-w-lg">
            <EmptyState
              icon={Sparkles}
              tone="brand"
              title="Pick a workspace to build in"
              description="Everything here is built inside a workspace so it carries its brand and its signups. Choose one from the switcher up top and the Studio opens."
            />
          </SectionCard>
        </div>
      </StudioFrame>,
    );
  }

  // ── session not found: a hard stop, never a raw code (§11) ─────────────────────────
  if (sessionNotFound) {
    return wrap(
      <StudioFrame className={embedded ? className : undefined} dark={studioDark}>
        <div className="flex h-14 shrink-0 items-center border-b border-border/60 bg-gradient-to-b from-card to-muted/20 px-4 shadow-sm">
          <span className="font-display text-sm font-semibold text-foreground">Studio</span>
        </div>
        <div className="grid flex-1 place-items-center p-6">
          <SectionCard className="max-w-lg">
            <EmptyState
              icon={Wand2}
              tone="brand"
              title="We couldn't find that project"
              description="It may have been removed, or it belongs to another workspace. Head back to the Studio to pick up another one — or start something new."
              action={
                <Button asChild variant="default">
                  <Link to="/choose-account">Back to the Studio</Link>
                </Button>
              }
            />
          </SectionCard>
        </div>
      </StudioFrame>,
    );
  }

  // ── #292 — the conversational session's live canvas (chat-left / canvas-right) ─────────
  // Order: first-build cutscene → open artifact by kind → honest empties. Never reads state.mode
  // (that's the legacy composer engine); reads chatBusy + canvasArtifact only (§13, verify RISK B).
  const sessionPageOpen =
    canvasArtifact?.kind === "page" && openedPage && openedPage.kind === "page" && !("missing" in openedPage && openedPage.missing)
      ? openedPage : null;
  let sessionCanvas: ReactNode;
  if (chatBusy && !canvasArtifact) {
    // First build, nothing on the stage yet → the honest SPLIT cutscene (Slice C): the living
    // PaigeMark + the REAL streamed beats (chatSteps, captured 1:1 from the server) beside a
    // progressive artifact skeleton. Indeterminate — the build runs server-side, there is no client
    // GenerationState to fake (§13). The kind isn't classified yet on a first build, so the skeleton
    // is neutral (artifactKind null → no guessed shape). Gold lives only in PaigeMark.
    sessionCanvas = (
      <StudioBuildingScreen
        indeterminate
        split
        steps={chatSteps}
        artifactKind={null}
        note={chatNote ?? "Getting to work…"}
        agent="Design agent"
        elapsedMs={chatElapsedMs}
        reduce={!!reduceMotion}
        ariaLabel="Your design agent is building"
      />
    );
  } else if (sessionPageOpen) {
    sessionCanvas = (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <LivePreview
            blocks={sessionPageOpen.page.blocks}
            theme={sessionPageOpen.page.theme}
            brandFloor={state.brandFloor}
            tenantId={tenantId ?? undefined}
            device={state.device}
          />
        </div>
        {/* #331 — version history + revert for the page. Compact bar, never a banner (§11). Only
            renders when the page was genuinely iterated (>1 version). */}
        {canvasVersions.length > 1 && (
          <div className="shrink-0 border-t border-border/50 px-2 py-2">
            <VersionBar versions={canvasVersions} onRevert={(v) => void handleRevertVersion(v.id)} reduceMotion={!!reduceMotion} reverting={reverting} />
          </div>
        )}
      </div>
    );
  } else if (canvasArtifact?.kind === "page" && pageHydrating) {
    // Page linked, blocks still loading — hold the building state, don't flash the empty (verify #5).
    sessionCanvas = (
      <StudioBuildingScreen indeterminate note="Bringing your page onto the canvas…" agent="Design agent" elapsedMs={chatElapsedMs} reduce={!!reduceMotion} ariaLabel="Loading your page" />
    );
  } else if (canvasArtifact?.kind === "document") {
    // Document (guide/one-pager/ebook…) — hold the building state until its blocks hydrate, then draw
    // the premium document sheet. A hydrate miss (row gone/corrupt) falls to an honest empty (§13).
    sessionCanvas = docHydrating ? (
      <StudioBuildingScreen indeterminate note="Laying out your document…" agent="Design agent" elapsedMs={chatElapsedMs} reduce={!!reduceMotion} ariaLabel="Loading your document" />
    ) : openedDocument ? (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <DocumentPreview document={openedDocument} />
        </div>
        {/* #331 — version history + revert for the document. Compact bar, never a banner (§11). Only
            renders when the document was genuinely iterated (>1 version). */}
        {canvasVersions.length > 1 && (
          <div className="shrink-0 border-t border-border/50 px-2 py-2">
            <VersionBar versions={canvasVersions} onRevert={(v) => void handleRevertVersion(v.id)} reduceMotion={!!reduceMotion} reverting={reverting} />
          </div>
        )}
      </div>
    ) : (
      <div className="grid h-full place-items-center">
        <SectionCard className="max-w-md">
          <EmptyState icon={Wand2} tone="brand" title="Your document is saved"
            description="It’s filed to this project. Ask your design agent to change any section and it rebuilds it here." />
        </SectionCard>
      </div>
    );
  } else if (canvasArtifact?.kind === "content" && canvasArtifact.url) {
    // Image → the real asset, letterboxed WHOLE (§13/§22). A design turn can file MANY images to one
    // session (the server streams only the last as the live artifact), so the canvas is the SET viewer:
    // it flips through every content ref that carries a thumbnail, with download/copy/save on each
    // (§18/§21 — navigates WITHIN the set, never an artifact-type tab strip). One image → no chrome.
    sessionCanvas = (
      <SessionImageCanvas
        current={{ id: canvasArtifact.id, title: canvasArtifact.title, url: canvasArtifact.url }}
        images={state.artifacts.filter((a) => a.kind === "content" && !!a.thumbnailUrl)}
        onSelect={(next) => setCanvasArtifact({ kind: "content", id: next.id, title: next.title, url: next.url })}
        onSave={handleKeepContent}
        reduceMotion={!!reduceMotion}
        // A follow-up render on an image stage does NOT get the scrim overlay below — the canvas owns
        // its own tuck→render→pop handoff (owner 2026-07-18): the current creative recedes toward the
        // strip and the cleared stage renders the next round (§22). It's driven by these three props.
        busy={chatBusy}
        buildNote={chatNote}
        buildElapsedMs={chatElapsedMs}
        // #331 — the image's own version history (a SECOND strip inside the canvas, distinct from the
        // image-SET carousel). Only shows when this image was genuinely iterated (>1 version).
        versions={canvasVersions}
        onRevertVersion={handleRevertVersion}
        reverting={reverting}
      />
    );
  } else if (canvasArtifact?.kind === "funnel") {
    // Funnel — the REAL landing→form→thank-you filmstrip (Slice B, #319), hydrated from the
    // persisted steps via loadFunnel. Held on the building screen while it loads; a hydrate miss
    // (tombstoned row) falls to the honest EmptyState — never a fabricated sequence (§13/§19).
    // Rendered through the EXISTING FunnelFlow renderer (§18 — one home for funnel-steps; the same
    // visual language a hand-built funnel uses, so an AI funnel and a manual one read as one object).
    // Stays IN the session (no navigate-away, §21).
    sessionCanvas = funnelHydrating ? (
      <StudioBuildingScreen indeterminate note="Bringing your funnel onto the canvas…" agent="Design agent" elapsedMs={chatElapsedMs} reduce={!!reduceMotion} ariaLabel="Loading your funnel" />
    ) : openedFunnel ? (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <FunnelFlow funnel={openedFunnel} url={null} />
      </div>
    ) : (
      <div className="grid h-full place-items-center">
        <SectionCard className="max-w-md">
          <EmptyState icon={Wand2} tone="brand" title="Your funnel is built"
            description="The whole sequence — landing page, intake form, and thank-you — is saved to this project. Ask your design agent to change any step and it rebuilds it here." />
        </SectionCard>
      </div>
    );
  } else if (reopened?.kind === "copy") {
    // Reopened COPY (#290) — a chat deliverable (§21) shown read-only as its REAL saved words, never
    // dressed up as a designed asset (§13). Promoted to a DOCUMENT-GRADE sheet via the shared
    // ArtifactPreview primitive (§12/§18): the paper SHEET_CLS + a real reading measure, so read-only
    // copy presents like a real deliverable instead of a plain text dump. Editing happens in the chat.
    sessionCanvas = (
      <div className="grid h-full place-items-center p-4 md:p-6">
        <div className="flex max-h-full w-full max-w-2xl flex-col gap-3">
          <ArtifactPreview
            variant="sheet"
            kind="copy"
            title={reopened.copy.title}
            copyText={reopened.copy.body}
            className="min-h-0"
          />
          <p className="text-center text-xs text-muted-foreground">
            Ask your design agent in the chat to rewrite or repurpose this.
          </p>
        </div>
      </div>
    );
  } else if (reopened?.kind === "form") {
    // Reopened FORM (#290 / Slice B) — the REAL structural preview of the tenant's actual questions,
    // hydrated via loadFormBySlug and rendered THROUGH the shared ArtifactPreview primitive (§12/§18)
    // as a document-grade form sheet. When the schema wasn't hydratable (slug-less/tombstoned) the
    // sheet shows its own honest built-state copy — never a fabricated form (§13). Editing is in chat.
    sessionCanvas = (
      <div className="grid h-full place-items-center p-4 md:p-6">
        <div className="flex max-h-full w-full max-w-2xl flex-col gap-3">
          <ArtifactPreview
            variant="sheet"
            kind="form"
            title={reopened.title}
            formSections={formSectionsForPreview(reopened.schema)}
            formSubmitLabel={reopened.schema?.submit_label}
            className="min-h-0"
          />
          <p className="text-center text-xs text-muted-foreground">
            Ask your design agent in the chat to change any question and it updates here.
          </p>
        </div>
      </div>
    );
  } else {
    // First-run: a calm canvas that points at the chat (the starter prompts live in the transcript).
    sessionCanvas = (
      <div className="grid h-full place-items-center">
        <SectionCard className="max-w-md">
          <EmptyState icon={Sparkles} tone="brand" title="Tell your designer what to make"
            description="Describe it in the chat — a landing page, an image, a form, a funnel. It appears right here the moment it’s ready." />
        </SectionCard>
      </div>
    );
  }

  // The whole session surface: lean top bar + chat-left / live-canvas-right. No composer, no mode
  // tabs, no type picker — the customer only talks (§18/§21).
  const renderSession = (): ReactNode => (
    <StudioFrame className={embedded ? className : undefined} dark={studioDark}>
      <StudioTopBar
        sessionChrome
        mode="page"
        studioDark={studioDark}
        onToggleStudioTheme={toggleStudioTheme}
        title={state.title}
        device={state.device}
        onDeviceChange={(device) => patch({ device })}
        // The device toggle only drives a page/funnel (LivePreview) render — gate it to those canvas
        // states so it's never an inert control on an image/document/copy/form canvas (§25).
        deviceApplicable={canvasArtifact?.kind === "page"}
        onOpenLibrary={() => setLibraryOpen(true)}
        onDeleteProject={() => void handleDeleteProject()}
        projectTitle={state.title}
      />
      <StudioSplit
        railBare
        canvasFirstOnMobile
        railBody={
          <StudioChat
            sessionId={sessionId}
            tenantId={tenantId}
            seedBrief={sessionSeedBrief}
            canvasArtifact={canvasArtifact}
            onBusy={setChatBusy}
            onNote={setChatNote}
            onSteps={setChatSteps}
            onArtifact={handleCanvasArtifact}
          />
        }
        canvas={
          <div className="relative h-full">
            {/* §22 — the cutscene RESOLVES INTO the session, it never hard-cuts or dead-spins away.
                A keyed AnimatePresence hand-off: the build stage springs out as the real artifact
                springs onto the canvas. Keyed COARSELY by build-vs-kind so the marquee first-build →
                first-artifact moment animates once, while in-set image navigation / same-kind
                iterations stay put (those own their own in-place choreography). Under reduce it's an
                instant swap (no scale/fade) — a reduced-motion user gets the cut, honestly. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={
                  chatBusy && !canvasArtifact
                    ? "building"
                    : canvasArtifact
                      ? `art:${canvasArtifact.kind}`
                      : reopened
                        ? `reopen:${reopened.kind}`
                        : "empty"
                }
                className="h-full"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
                animate={reduceMotion ? {} : { opacity: 1, scale: 1 }}
                exit={reduceMotion ? {} : { opacity: 0, scale: 1.012 }}
                transition={{ type: "spring", stiffness: 240, damping: 30 }}
              >
                {sessionCanvas}
              </motion.div>
            </AnimatePresence>
            {/* In-flight FOLLOW-UP on a NON-image stage (page/doc/funnel/copy/form): the prior artifact
                stays on stage; lay the premium branded "Paige is creating" layer over it (#292 Fix C) —
                a living PaigeMark ribbon + the real streamed note + shooting-star field. Ambient, never
                an opaque cover; reduce-safe; §11 gold reserved for the act. Clears on onBusy(false).
                The IMAGE stage is EXCLUDED here: it owns a different choreography (owner 2026-07-18) —
                the current creative tucks toward the strip and the cleared stage renders the next round,
                driven inside SessionImageCanvas — so a scrim over a frozen image would be exactly the
                behavior we're replacing. */}
            {chatBusy && canvasArtifact && !(canvasArtifact.kind === "content" && canvasArtifact.url) && (
              <SessionBuildingOverlay note={chatNote} elapsedMs={chatElapsedMs} reduce={!!reduceMotion} />
            )}
          </div>
        }
      />
    </StudioFrame>
  );

  if (sessionId) {
    return wrap(
      <>
        {renderSession()}
        {/* The saved library — the same Assets Sheet the legacy surface uses. */}
        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent className={cn(studioDark ? "dark" : "studio-surface", "w-full overflow-y-auto border-border bg-background text-foreground sm:max-w-2xl")}>
            <SheetHeader>
              <SheetTitle>Assets</SheetTitle>
              <SheetDescription>
                Every image and piece of copy you've made here — the full working set. Hit
                <span className="font-medium text-foreground"> Keep</span> on the winners to promote them
                to your Saved library.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <LibraryPanel tenantId={tenantId} active={libraryOpen} onKeep={handleKeepContent} />
            </div>
          </SheetContent>
        </Sheet>
      </>,
    );
  }

  return wrap(
    <>
      <StudioFrame className={embedded ? className : undefined} dark={studioDark}>
        <StudioTopBar
          mode={mode}
          studioDark={studioDark}
          onToggleStudioTheme={toggleStudioTheme}
          title={state.title}
          onTitleChange={setTitle}
          device={state.device}
          onDeviceChange={(device) => patch({ device })}
          status={state.status}
          dirty={state.dirty}
          onSave={() => void handleSave()}
          saving={state.saving}
          saveDisabled={state.saving || state.publishing || busy || state.blocks.length === 0}
          onPublish={() => patch({ publishOpen: true, publishedUrl: null, error: null })}
          publishing={state.publishing}
          publishDisabled={state.publishing || busy || state.blocks.length === 0}
          onSaveToLibrary={state.blocks.length > 0 ? () => void handleSaveToLibrary() : undefined}
          savingToLibrary={savingToLibrary}
          onOpenLibrary={() => setLibraryOpen(true)}
          modeBar={modeBars[mode] ?? null}
          funnelActive={funnelActive}
          funnelLive={funnelUrl != null}
          onPublishFunnel={() => void handlePublishFunnel()}
          funnelPublishing={funnelPublishing}
          publishFunnelDisabled={
            !funnel || funnelBuilding || funnelPublishing || (funnel?.pageBlanks.length ?? 0) > 0
          }
          onExitFunnel={funnel || funnelBuilding ? exitFunnel : undefined}
          onDeleteProject={sessionId ? () => void handleDeleteProject() : undefined}
          projectTitle={state.title}
        />

        {/* ── page mode (and the funnel surface, which lives inside it) — the original Vibe
             Studio, re-skinned onto the same state machine. Shown for "page" AND "funnel";
             hidden only for the form/image modes that own their own surface. ── */}
        <StudioSplit
          className={mode === "page" || mode === "funnel" ? undefined : "hidden"}
          immersive={firstBuildGenerating}
          railHeader={
            funnelActive ? (
              <StudioRailHeading
                heading="Your funnel"
                description="Paige built the whole sequence — a landing page, an intake form, and a thank-you. Review the steps and publish when it's ready."
                teamLine
              />
            ) : state.mode === "clarifying" ? (
              <StudioRailHeading heading={CLARIFYING_RAIL.heading} description={CLARIFYING_RAIL.description} />
            ) : (
              <StudioRailHeading
                heading={state.selectedIndex != null ? "Change one section" : MODE_RAIL.page.heading}
                description={
                  state.selectedIndex != null
                    ? "Same conversation — Paige rewrites the section you picked."
                    : MODE_RAIL.page.description
                }
                teamLine={state.selectedIndex == null}
              />
            )
          }
          railBody={
            funnelActive ? (
              <>
                {funnel?.goal && (
                  <p className="text-xs text-muted-foreground">{funnel.goal}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Want to change it? Describe the funnel differently below and Paige rebuilds it.
                </p>
                {state.error && (
                  <SectionCard className="border-destructive/40">
                    <div className="space-y-3">
                      <p className="text-sm text-foreground">{state.error.message}</p>
                      {state.error.recoverable && (
                        <Button variant="outline" size="sm" onClick={() => patch({ error: null })}>
                          Got it
                        </Button>
                      )}
                    </div>
                  </SectionCard>
                )}
              </>
            ) : state.mode === "clarifying" ? (
              <ClarifyingQuestions
                brief={state.brief}
                questions={state.clarifying.questions}
                answers={state.clarifying.answers}
                onAnswerChange={setClarifyingAnswer}
                onBack={backToCompose}
              />
            ) : (
              <>
                {/* Post-submit delivery — only once the page has been saved at least once
                    (the embedded_form's backing row only exists after that first save). */}
                {state.selectedIndex == null && tenantId && state.pageId && embeddedFormSlug && (
                  <DeliveryEditor
                    tenantId={tenantId}
                    formSlug={embeddedFormSlug}
                    suggestedAssetUrl={state.suggestedDeliveryAssetUrl}
                  />
                )}

                {/* Paige's team, working — the build progress lives in the conversation. */}
                {state.mode === "generating" && (
                  <BuildProgress generation={generation} onCancel={handleCancel} />
                )}

                {state.error && (
                  <SectionCard className="border-destructive/40">
                    <div className="space-y-3">
                      <p className="text-sm text-foreground">{state.error.message}</p>
                      {state.error.recoverable && (
                        <Button variant="outline" size="sm" onClick={() => patch({ error: null })}>
                          Got it
                        </Button>
                      )}
                    </div>
                  </SectionCard>
                )}
              </>
            )
          }
          railFooter={
            state.mode === "clarifying" ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={backToCompose}>
                    Back
                  </Button>
                  {/* Indigo, deliberately — same discipline as PromptComposer's own submit
                      (§11): gold is spent only on Publish. Disabled until every question has
                      a real answer — see clarifyingAnswered above. */}
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => proceedToGenerate()}
                    disabled={!clarifyingAnswered}
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    Build the page
                  </Button>
                </div>
                {!clarifyingAnswered && (
                  <p className="text-xs text-muted-foreground">Answer each question to continue.</p>
                )}
              </div>
            ) : (
              <PromptComposer
                mode={target ? "section" : "page"}
                value={target ? state.instruction : state.composerValue}
                onChange={(value) => patch(target ? { instruction: value } : { composerValue: value })}
                onSubmit={(value) => handleBriefSubmit(value)}
                busy={busy || classifying || funnelBuilding}
                busyLabel={
                  funnelBuilding
                    ? "Building your funnel…"
                    : classifying
                      ? "Figuring out what to build…"
                      : undefined
                }
                disabled={state.saving || state.publishing || funnelPublishing}
                target={target}
                onClearTarget={() => patch({ selectedIndex: null, instruction: "" })}
                onRegenerate={() => void runGenerate(state.brief)}
                canRegenerate={state.blocks.length > 0 && state.brief.trim().length >= 5}
                attachments={state.attachments}
                onFilesSelected={(files) => void handleFilesSelected(files)}
                onRemoveAttachment={handleRemoveAttachment}
                attachmentsBusy={attachmentsBusy}
                chips={INTENT_CHIPS}
                sendShape="circle"
                chipPlacement="dock"
                minRows={1}
              />
            )
          }
          canvas={pageCanvas}
        />

        {/* ── the other outputs — mounted once visited, kept alive across switches ──
             Funnel is NOT here: it has no separate mode/surface anymore. An AI funnel builds
             and renders IN the page surface above (funnelActive), reached only conversationally
             or via the funnel intent (mode="funnel"). The old manual FunnelMode is retired. */}
        {visited.has("form") && (
          <FormMode
            className={mode !== "form" ? "hidden" : undefined}
            tenantId={tenantId}
            onToolbar={onFormToolbar}
            onCreated={handleFormCreated}
            initialSchema={draftedFormSchema}
          />
        )}
        {visited.has("image") && (
          <ImageMode
            className={mode !== "image" ? "hidden" : undefined}
            tenantId={tenantId}
            initialPrompt={draftedImagePrompt}
            autoRun={autoRunImage}
            onGeneratingChange={setImageBuilding}
            onOpenLibrary={() => setLibraryOpen(true)}
            onSaved={handleImageSaved}
          />
        )}
      </StudioFrame>

      {/* The saved library — the Content Studio's third panel, one Sheet away. */}
      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        {/* The library Sheet is portalled OUT of `.studio-surface`, so the root theme class can't
            reach it via the cascade — drive its `dark` scope from studioDark directly so it flips
            with the Studio instead of being forced dark (owner 2026-07-17: no surface hardcoded). */}
        <SheetContent className={cn(studioDark ? "dark" : "studio-surface", "w-full overflow-y-auto border-border bg-background text-foreground sm:max-w-2xl")}>
          <SheetHeader>
            <SheetTitle>Assets</SheetTitle>
            <SheetDescription>
              Every image and piece of copy you've made here — the full working set. Hit
              <span className="font-medium text-foreground"> Keep</span> on the winners to promote them
              to your Saved library.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <LibraryPanel tenantId={tenantId} active={libraryOpen} onKeep={handleKeepContent} />
          </div>
        </SheetContent>
      </Sheet>

      <PublishDialog
        open={state.publishOpen}
        onOpenChange={(open) => patch({ publishOpen: open, ...(open ? {} : { publishedUrl: null }) })}
        title={state.title}
        onTitleChange={setTitle}
        slug={state.slug}
        onSlugChange={setSlug}
        status={state.status}
        tenantSlug={tenantSlug}
        checks={checks}
        onConfirm={handlePublish}
        publishing={state.publishing}
        onFixBlock={(index) => patch({ selectedIndex: index, instruction: "", mode: "canvas" })}
        publishedUrl={state.publishedUrl}
        error={state.error}
      />
    </>,
  );
}

export default StudioShell;
