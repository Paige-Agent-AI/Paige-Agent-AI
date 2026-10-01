/**
 * OperatorShell — the operator console's geometry. Band above, three columns beneath.
 *
 * PORTED FROM THE PACK, not from what was here (§30 — strip, do not layer). The shell this
 * replaces was a two-column grid built for seventeen branches in two collapsible groups over a
 * three-level tree; none of that machinery survives contact with six flat slots, so none of it
 * was carried across. The pack's own geometry (`v3.dc.html` L71-L126, `shellStyle` L10728,
 * `canvasStyle` L11040):
 *
 *   root      height:100vh · flex column · overflow:hidden      ← the document never scrolls
 *   band      flex:none · min-height:36px                       ← spans all three columns
 *   shell     flex:1 · min-height:0 · display:grid
 *             216px | minmax(0,1fr) | minmax(340px,26vw)        ← at rest
 *              72px | minmax(0,1fr) | minmax(340px,26vw)        ← rail compact
 *             216px | minmax(0,1fr) | 0px                       ← spine collapsed
 *             transition: grid-template-columns 200ms cubic-bezier(.22,1,.36,1)
 *   canvas    grid-template-rows: 58px minmax(0,1fr)
 *             grid-template-columns: minmax(320px,1fr) minmax(0,52%)  ← a summon in `split`
 *
 * RULE 4 IS SYSTEMATIC HERE, NOT SPOT-CHECKED. Every grid and flex child carries an explicit
 * `min-w-0` (and `min-h-0` wherever it is a vertical child), because the browser's `auto`
 * minimum sizes a track by its CONTENT: one long tenant name, one unbroken canonical path, one
 * wide table and the track blows out at a width nobody tests. That defect landed six times
 * during design; the fix is a rule applied to every child, not to the ones that looked risky.
 *
 * THE COMMAND ROW IS THE COMMAND BAR'S HOME (L128-L159). The 58px band carries the bar, its
 * palette and the fold-spine control — the bar spans the row (`flex:1;min-width:0`, L129) and
 * the palette is a dropdown anchored to it, never a centred modal. See `CommandBar` for the
 * markup and `SummonedSurface` for what a palette row opens.
 *
 * §58 — WHAT THIS ROUND DOES NOT CARRY YET, said plainly rather than left to be discovered. The
 * seventeen-branch console's live surfaces (Fleet Console, Systems Check, History, Team Pulse,
 * Alert Rules, Trust Compass, Knowledge, and the panel-spec surfaces) are addressed
 * `/operator/{branch}/{subtab}` and have no address in the six-slot IA. Their modules are
 * untouched on disk and the shell that mounted them is preserved at
 * `src/operator/legacy/OperatorLegacyApp.tsx` — nothing was deleted — but while this shell owns
 * `/operator/*` they are NOT reachable. Wiring them into the slots is the next round's work.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlatformTrustProvider } from "@/operator/data/usePlatformTrust";
import { useReducedMotion } from "framer-motion";
import { AgentPresenceProvider, useAgentPresence } from "@/components/ui/paige";
import { OPERATOR_SLOTS } from "@/operator/ia/operatorIA";
import {
  canonicalPath, resolveOperatorAddress, slotPath, viewPath, type OperatorAddress,
} from "@/operator/shell/operatorAddress";
import CommandBar, { type CommandState } from "@/operator/shell/CommandBar";
import SummonedSurface, { type WsMode } from "@/operator/shell/SummonedSurface";
import { useCanvasWidth } from "@/operator/shell/useCanvasWidth";
import { isCapabilityId, type CapabilityId } from "@/operator/shell/commandPalette";
import ScopeBand from "@/operator/shell/ScopeBand";
import { PLATFORM_SCOPE } from "@/operator/shell/scopeStates";
import SlotRail from "@/operator/shell/SlotRail";
import OperatorSpine, { spineHasContent } from "@/operator/shell/OperatorSpine";
import { useOperatorChat } from "@/operator/data/useOperatorChat";
import SlotSurfaceBody from "@/operator/shell/SlotSurfaceBody";
import { performSignOut } from "@/lib/auth/signOut";
import { cn } from "@/lib/utils";

const RAIL_REST = "216px";
const RAIL_COMPACT = "72px";
const SPINE_OPEN = "minmax(340px,26vw)";
const SPINE_SHUT = "0px";

/**
 * RULING B (Claude Design, 2026-08-23) — THE COLLAPSE, IN ORDER.
 * "556px of chrome around a sliver at 640 isn't a layout."
 *
 * The order is fixed: the SPINE goes to 0 FIRST, THEN the rail compacts 216 → 72, and the band
 * is LAST — it thins and never disappears, because it is the thing that says what scope you are
 * in. The reference implementation is the harness fixture `fixtures/_shell.css` (spine → 0 at
 * ≤1200, rail → 72 + band thins at ≤900); these are the same two breakpoints.
 *
 * WHY `matchMedia` AND NOT A CSS MEDIA QUERY. The spine collapses two ways at once — the track
 * goes to 0 AND the panel unmounts (see `OperatorSpine`) — and a stylesheet can close a track
 * but cannot unmount React. Driving both from one boolean here keeps the two halves of the
 * collapse from drifting apart, which is the defect the pack's own note warns about.
 */
const SPINE_COLLAPSE_AT = "(max-width: 1200px)";
const RAIL_COMPACT_AT = "(max-width: 900px)";

/** `matchMedia`, guarded: jsdom does not implement it and SSR has no window at all. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const read = () => setMatches(mql.matches);
    read();
    mql.addEventListener("change", read);
    return () => mql.removeEventListener("change", read);
  }, [query]);
  return matches;
}

/**
 * ⌘K HAS EXACTLY ONE OWNER PLATFORM-WIDE, AND THIS IS NOT A SECOND ONE (§18).
 *
 * The owner is `AgentPresenceProvider` (`src/components/ui/paige/AgentPresenceContext.tsx`),
 * whose effect is the only `keydown` listener on the platform that claims ⌘K. It was mounted
 * solely in `AdminLayout`, a tree `/operator/*` never enters — so the operator console had no
 * ⌘K at all, and the previous round deliberately left the shortcut unbound rather than register
 * a rival listener here.
 *
 * The route taken: MOUNT THE EXISTING PROVIDER over the operator subtree and let its shared
 * `launcherOpen` state drive the pack's palette. The keydown registration, the toggle semantics
 * and the state all stay in the one shared home; what differs per shell is only WHAT the open
 * state renders — `CommandLauncher` under `AdminLayout`, the pack's dropdown here. No second
 * listener, no second palette implementation, no fork of the context.
 *
 * The alternative — lifting the launcher itself into a shared module — would have meant editing
 * `src/components/ui/paige/**`, which is outside this change's file scope; it is also the larger
 * change, since `CommandLauncher` is a Radix `CommandDialog` and the pack's palette is a
 * dropdown anchored to the bar. Nothing here forecloses it: this shell reads the context, so a
 * later lift changes where the state lives without touching the operator surfaces.
 */
export default function OperatorShell() {
  return (
    <AgentPresenceProvider launcherEnabled hasChatBody={false}>
      {/* ONE read of the Trust Compass ceiling for the whole console (§18). It sits here, above
          both the spine and the surface region, because those two are exactly what drifted:
          each held its own copy, the operator moved the rung from the spine, and Systems Check
          went on rendering the ceiling it had read at mount — two governance ceilings asserted
          on one screen. With one source they cannot disagree, and a move from anywhere updates
          everywhere. */}
      <PlatformTrustProvider>
        <OperatorShellBody />
      </PlatformTrustProvider>
    </AgentPresenceProvider>
  );
}

function OperatorShellBody() {
  const params = useParams();
  const navigate = useNavigate();
  const address = resolveOperatorAddress(params.section, params["*"] ?? "");
  const [search] = useSearchParams();

  const reduce = useReducedMotion();

  /**
   * HER CHAT, CONNECTED. Found 2026-08-24 from the owner's CD side-by-side: the spine is a fully
   * ported chat surface with nothing behind it. `OperatorSpine` deliberately owns no engine (§18
   * — the platform already has one) and takes `transcript`/`onSend` as props; nothing in the
   * operator console ever passed them, so the composer looked live and did nothing — the exact
   * §13/§36 dead end the doctrine names.
   *
   * The hook is the CALLER, not a second engine: it POSTs the deployed `paige-ai-chat` seam with
   * the operator's own JWT, and §52's operator briefing is composed SERVER-side off that verified
   * token — so she opens already knowing who she is talking to, with no client-supplied identity
   * to forge (§588).
   */
  const chat = useOperatorChat();

  // Ruling B — the viewport's own say in the collapse, read once and shared by the track, the
  // spine's mount and the band's height so all three move in the ruled order.
  const narrowForSpine = useMediaQuery(SPINE_COLLAPSE_AT);
  const narrowForRail = useMediaQuery(RAIL_COMPACT_AT);

  // Ruling C — the spine's track is reserved on whether PAIGE has anything to show, never on a
  // flag. `spineHasContent()` reads the regions `OperatorSpine` actually renders.
  const spineHasPaige = spineHasContent();

  const [railFolded, setRailFolded] = useState(false);
  // What the OPERATOR asked for. What is actually open is that AND a spine with content AND a
  // viewport wide enough — so ⌘\ keeps working at every width and can never open an empty spine.
  const [spineRequested, setSpineRequested] = useState(true);

  const railCompact = railFolded || narrowForRail;
  const spineOpen = spineHasPaige && spineRequested && !narrowForSpine;
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  // The palette's open state is the shared launcher state — see the note on this file's default
  // export. `command` and `mark` are the bar's own presentation of it (`cmd` L10633, `markState`).
  const { launcherOpen: paletteOpen, setLauncherOpen: setPaletteOpen } = useAgentPresence();
  const [command, setCommand] = useState<CommandState>("rest");
  const [mark, setMark] = useState<"dormant" | "charged">("dormant");

  const [summon, setSummon] = useState<CapabilityId | null>(null);
  const [wsMode, setWsMode] = useState<WsMode>("split");
  const [detachBlocked, setDetachBlocked] = useState(false);

  /**
   * The two triggers set the bar differently, and the pack is explicit about it.
   * `togglePalette` (L10725) returns `command`/`mark` to rest when it CLOSES; the ⌘K branch
   * (L4352) sets `focus`/`charged` on BOTH halves of its toggle. The provider owns the keydown,
   * so the two paths are told apart by which one ran: the bar's own click marks itself first.
   */
  const fromBar = useRef(false);
  // Compared against the PREVIOUS value rather than a mounted-yet flag: StrictMode re-runs this
  // effect on a remount with `paletteOpen` unchanged, and a mounted-flag guard let that re-run
  // through — which put the bar in `focus` on a console nobody had touched. Found by driving it,
  // not by reading it (§32).
  const lastOpen = useRef(paletteOpen);
  useEffect(() => {
    if (lastOpen.current === paletteOpen) return;
    lastOpen.current = paletteOpen;
    if (fromBar.current) { fromBar.current = false; return; }
    setCommand("focus");
    setMark("charged");
  }, [paletteOpen]);

  const togglePalette = useCallback(() => {
    fromBar.current = true;
    setPaletteOpen(!paletteOpen);
    setCommand(paletteOpen ? "rest" : "focus");
    setMark(paletteOpen ? "dormant" : "charged");
  }, [paletteOpen, setPaletteOpen]);

  /** `openSummon` — L4414. Closes the palette and forces `split`. */
  const openSummon = useCallback((id: CapabilityId) => {
    setSummon(id);
    fromBar.current = true;
    setPaletteOpen(false);
    setWsMode("split");
    setCommand("rest");
    setMark("dormant");
  }, [setPaletteOpen]);

  /** `closeSummon` — L4415. */
  const closeSummon = useCallback(() => {
    setSummon(null);
    setWsMode("split");
    setDetachBlocked(false);
  }, []);

  /** `detachSummon` — L4417-L4427. A real window, and the pack's own in-place fallback. */
  const detachSummon = useCallback(() => {
    if (wsMode === "detached") { setWsMode("split"); setDetachBlocked(false); return; }
    const url = location.pathname + "?surface=" + encodeURIComponent(summon ?? "sweep");
    let w: Window | null = null;
    try { w = window.open(url, "paige-" + summon, "width=820,height=640"); } catch { w = null; }
    setWsMode("detached");
    setDetachBlocked(!w);
  }, [wsMode, summon]);

  /** Deep link — L4348-L4349. `?surface=<id>` opens that summon detached on load. */
  useEffect(() => {
    const id = search.get("surface");
    if (!id || !isCapabilityId(id)) return;
    setSummon(id);
    setWsMode("detached");
    setRailFolded(true);
    setSpineRequested(false);
    // Read once, on the address the shell mounted at; a later change of the query string is a
    // navigation, not a re-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One theme mechanism for the whole app (§18) — the console never invents a second. */
  const toggleTheme = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setIsDark(next);
  }, []);

  /**
   * The pack's two shell shortcuts: ⌘\ folds the spine, ⌥⌘\ collapses the rail (L4354). ⌘K is
   * NOT here — it belongs to `AgentPresenceProvider`, which this shell now mounts, and a second
   * listener for it would be the §18 collision that ownership exists to prevent.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "\\") return;
      e.preventDefault();
      if (e.altKey) setRailFolded((v) => !v);
      else setSpineRequested((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A URL naming a view that does not exist is rewritten to the address of what is actually on
  // screen, rather than rendering one view while the address bar names another. An unknown SLOT
  // is a different failure and is NOT redirected — see the 404 below.
  if (address.kind === "resolved" && address.stale) {
    return <Navigate to={canonicalPath(address)} replace />;
  }

  const columns = [
    railCompact ? RAIL_COMPACT : RAIL_REST,
    "minmax(0,1fr)",
    spineOpen ? SPINE_OPEN : SPINE_SHUT,
  ].join(" ");

  return (
    <div
      // `data-pg` is what scopes CD's installed design system to this subtree (index.css), and
      // it carries the THEME rather than a class — the pack authors both themes separately,
      // because champagne inverts role between them and neither is a filter of the other.
      // `data-shell-root` paints `--pg-env`, the ground the depth ladder sits on.
      data-pg={isDark ? "dark" : "light"}
      data-shell-root
      className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden"
    >
      {/* Ruling B — the band is the LAST thing to change: it thins, it never goes. */}
      <ScopeBand {...PLATFORM_SCOPE} compact={narrowForRail} />

      <div
        data-shell-grid
        className="grid min-h-0 min-w-0 flex-1"
        style={{
          gridTemplateColumns: columns,
          transition: reduce ? undefined : "grid-template-columns 200ms cubic-bezier(.22,1,.36,1)",
        }}
      >
        <SlotRail
          compact={railCompact}
          onToggleCompact={() => setRailFolded((v) => !v)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onSignOut={() => void performSignOut({ redirectTo: "/operator/login" })}
        />

        <OperatorCanvas
          address={address}
          spineOpen={spineOpen}
          onToggleSpine={() => setSpineRequested((v) => !v)}
          paletteOpen={paletteOpen}
          onTogglePalette={togglePalette}
          command={command}
          mark={mark}
          onSummon={openSummon}
          summon={summon}
          wsMode={wsMode}
          onWsMode={setWsMode}
          onDetach={detachSummon}
          onCloseSummon={closeSummon}
          detachBlocked={detachBlocked}
        />

        {/* Both collapse mechanisms, as the pack has them: the track goes to 0px AND the panel
            unmounts. Either alone is a visible defect. */}
        {spineOpen && (
          <OperatorSpine
            /* `openTrust` (L4620). Routing is the shell's job — the spine takes a callback so it
               stays mountable outside a router (the detached window, and every spine test). */
            onOpenCompass={() => navigate("/operator/analytics/autonomy")}
            turns={chat.transcript}
            onSend={chat.send}
            /* THE EXECUTION STRIP, GIVEN A REAL STATE. The pack computes `busy` from what is
               actually running ('On the call' · 'Sweeping the fleet' · 'Requesting a runtime',
               L10824-10828); a turn in flight is one of those, and `chat.busy` had been returned
               by the hook and consumed by nothing. It matters more now that the approval plate
               exists: `run` refuses while a turn is in flight, so without this the operator could
               click Approve during a stream and see nothing happen at all. NOT `readOnly` — that
               is the pack's authority state (`s.scope === 1`), not an in-flight one. */
            busy={chat.busy ? ["Answering"] : []}
            /**
             * THE FOLD, WIRED. Owner, live, 2026-08-24: *"I cannot fold Paige's chat in."*
             *
             * He was right and the cause was here: the spine header draws both window controls
             * and each is `disabled={!handler}`, so with no `onFold` passed the control rendered
             * permanently dead. The state it needed has existed the whole time —
             * `setSpineRequested` is the same setter the topbar's Summon PAIGE button drives —
             * so the console could OPEN the spine and had no way to shut it. A one-way door.
             *
             * Measured, not assumed: a Chromium render of this shell reported
             * `disabled: true` on `[aria-label="Fold the conversation"]`.
             *
             * `onDetach` stays unpassed and the control stays honestly disabled: a second window
             * needs the multi-window seams that are their own scope (task #215), and a control
             * that looks live and silently does nothing is the defect this console is judged on.
             */
            onFold={() => setSpineRequested(false)}
          />
        )}
      </div>
    </div>
  );
}

/** Column 2: a 58px command row over a scrolling surface region. */
function OperatorCanvas({
  address, spineOpen, onToggleSpine,
  paletteOpen, onTogglePalette, command, mark, onSummon,
  summon, wsMode, onWsMode, onDetach, onCloseSummon, detachBlocked,
}: {
  address: OperatorAddress;
  spineOpen: boolean;
  onToggleSpine: () => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
  command: CommandState;
  mark: "dormant" | "charged";
  onSummon: (id: CapabilityId) => void;
  summon: CapabilityId | null;
  wsMode: WsMode;
  onWsMode: (m: WsMode) => void;
  onDetach: () => void;
  onCloseSummon: () => void;
  detachBlocked: boolean;
}) {
  const [canvasRef, canvasW] = useCanvasWidth<HTMLDivElement>();
  const reduce = useReducedMotion();

  // `canvasStyle` L11040 — a summon in `split` opens the second track; every other geometry
  // floats over the one column.
  const split = summon !== null && wsMode === "split";

  return (
    <div
      ref={canvasRef}
      className="relative grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] bg-[var(--pg-canvas)]"
      style={{
        gridTemplateColumns: split ? "minmax(320px,1fr) minmax(0,52%)" : "minmax(0,1fr)",
        transition: reduce ? undefined : "grid-template-columns 240ms cubic-bezier(.22,1,.36,1)",
      }}
    >
      {/* Row 1 — the command row. L128, verbatim: 58px, `--pg-spine`, a `--pg-line-soft` bottom
          rule, `--pg-e1`, `padding:0 20px`, `gap:14px`. The 58px is load-bearing three ways at
          once — this row track, the canvas grid row, and the slide-over's `top` offset — and they
          drift apart the moment one is guessed.

          THE ONE VALUE THAT IS NOT THE PACK'S, AND WHY. The pack sets this row `z-index:6`
          (L128) and the palette it hosts `z-index:8` (L142), while `viewRowStyle` sets the
          sub-tab row `z-index:12` (L10803) with the comment "Raised above any summoned panel."
          Those two cannot both hold: this row carries `z-index`, so it opens a stacking context
          and the palette's 8 is CLAMPED inside it — an OPAQUE `--pg-raised` dropdown at 6 that
          the view row paints straight over at 12. MEASURED, before this change:
          `elementFromPoint` at the centre of the "Run a sequence" row returned
          `<nav class="relative z-[12] …">`, not the palette button, in both themes, while the
          palette's own computed background was `rgb(33,29,39)` / `rgb(255,253,248)` at
          `opacity: 1`. It was never transparency; it was paint order.

          Claude Design ruled the conflict (2026-08-23): "nothing behind a summoned layer should
          be readable through it" — the summoned layer sits ABOVE the view row. The pack's own
          ladder is row(6) < summoned(8) < view row(12); it is preserved and shifted over the
          view row: this row 13, `SummonedSurface` 14. The palette keeps the pack's `z-index:8`
          inside this row, because raising it alone could never have escaped a context 6 sets. */}
      <div className="relative z-[13] col-span-full row-start-1 flex min-h-0 min-w-0 items-center gap-[14px] border-b border-[var(--pg-line-soft)] bg-[var(--pg-spine)] px-5 shadow-[shadow:var(--pg-e1)]">
        <CommandBar
          open={paletteOpen}
          onToggle={onTogglePalette}
          command={command}
          mark={mark}
          onSummon={onSummon}
        />
        {/* L166-L177 (rev 11) — SUMMON PAIGE, and it exists ONLY while she is away.
            The topbar control and the one in her own header are the same act from two places,
            so both rendering at once put two identical controls on screen. Now the topbar one
            shows only in the collapsed state, where it reads as "summon her" rather than as a
            toggle, and its chevron points LEFT — the way the panel travels when it arrives.
            Closing her stays in her own header beside the detach: put it away, or put it on
            another monitor. `⌘\` still does both, so the keyboard path is unchanged. */}
        {!spineOpen && (
          <button
            type="button"
            onClick={onToggleSpine}
            aria-label="Summon PAIGE"
            aria-expanded={false}
            title="Summon PAIGE · ⌘\\"
            className={cn(
              "relative grid h-[34px] w-[34px] flex-none place-items-center rounded-[var(--pg-r-chip)]",
              "border border-[var(--pg-line)] bg-[var(--pg-raised)] text-[var(--pg-muted)] shadow-[shadow:var(--pg-lift-1)]",
              "transition-colors hover:text-[var(--pg-gold-deep)] active:shadow-[shadow:var(--pg-inset)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] min-w-0" aria-hidden>
              <rect x="10.5" y="3.5" width="2.9" height="9" fill="currentColor" opacity=".13" />
              <path d="M2.6 3.5h10.8v9H2.6z M10.5 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
              <path d="M7.6 6.2L5.7 8 7.6 9.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Row 2 — the surface. The ONLY scroller in this column. */}
      <main className="relative col-start-1 row-start-2 min-h-0 min-w-0 overflow-auto bg-[var(--pg-workspace)]">
        <div className="mx-auto w-[min(100%,1080px)] min-w-0 px-[clamp(24px,3vw,44px)] pb-[72px] pt-8">
          {address.kind === "unknown" ? (
            <UnknownSection section={address.section} />
          ) : (
            <SlotSurface address={address} />
          )}
        </div>
      </main>

      {summon && (
        <SummonedSurface
          id={summon}
          mode={wsMode}
          onMode={onWsMode}
          onDetach={onDetach}
          onClose={onCloseSummon}
          detachBlocked={detachBlocked}
          canvasW={canvasW}
        />
      )}
    </div>
  );
}

function SlotSurface({ address }: { address: Extract<OperatorAddress, { kind: "resolved" }> }) {
  const { slot, view } = address;
  return (
    <>
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-8 border-b border-border pb-5">
        <h1 className="min-w-0 truncate text-[21px] font-medium leading-[1.1] tracking-[-0.022em] text-foreground">
          {slot.label}
        </h1>
        <code className="hidden flex-none font-mono text-[11px] text-muted-foreground md:block">
          {canonicalPath(address)}
        </code>
      </header>

      {/* The view row. `z-12` is the pack's own value (`viewRowStyle` L10803) and it stays. What
          changed is what sits above it: the pack's comment there claims the row is "Raised above
          any summoned panel," which contradicts the palette (L142) and the summoned surface
          (L11005-L11064) being drawn opaque over the canvas. CD resolved it the other way — a
          summoned layer is read through by nothing — so the command row (13) and
          `SummonedSurface` (14) now clear this 12. It scrolls sideways within itself and never
          widens the column (min-w-0 + overflow-x). */}
      {slot.views.length > 0 && (
        <nav
          aria-label={`${slot.label} views`}
          className="relative z-[12] my-2.5 flex min-w-0 flex-none flex-nowrap gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slot.views.map((name) => (
            <NavLink
              key={name}
              to={viewPath(slot.id, name)}
              data-view={name}
              aria-current={name === view ? "page" : undefined}
              className={cn(
                "relative flex-none whitespace-nowrap rounded-t-[6px] px-3 py-2 text-[13px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                name === view
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {name}
              {name === view && (
                <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-cd-gold" />
              )}
            </NavLink>
          ))}
        </nav>
      )}

      {/* The surface region. `SlotSurfaceBody` resolves the view to the feature that already
          ships — a bespoke component, its ported CD panels, or the absence that names what is
          missing. A header over an empty section is the blank-screen failure this console has
          been rejected for twice; no path here renders nothing. */}
      <section data-surface-slot={slot.id} data-surface-view={view ?? undefined} className="min-w-0 pt-1">
        <SlotSurfaceBody slot={slot} view={view} />
      </section>
    </>
  );
}

/**
 * An address no slot answers to.
 *
 * It renders IN the shell — rail, band and spine intact — because the operator is not lost, one
 * segment is. And it does NOT redirect: the shell this replaces sent every unknown section to
 * Fleet with `replace`, which showed a surface the operator never asked for AND destroyed the
 * address that would have revealed the mistake. A wrong link should say it is wrong.
 */
function UnknownSection({ section }: { section: string }) {
  return (
    <div className="min-w-0 max-w-[68ch]">
      <h1 className="min-w-0 text-[21px] font-medium leading-[1.1] tracking-[-0.022em] text-foreground">
        No slot answers to this address
      </h1>
      <p className="mt-2 min-w-0 text-[13px] leading-[1.6] text-muted-foreground">
        <code className="font-mono text-[13px] text-foreground">/operator/{section}</code> does not
        resolve. The console has six slots:
      </p>
      <ul className="mt-4 grid min-w-0 gap-1">
        {OPERATOR_SLOTS.map((slot) => (
          <li key={slot.id} className="min-w-0">
            <NavLink
              to={slotPath(slot.id)}
              className="inline-block min-w-0 truncate text-[13px] text-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {slot.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
