import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, PanelRightClose, Command, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { PresenceDot, EmptyState } from "@/components/ui/page";
import { useAgentPresence } from "./AgentPresenceContext";
import type { AgentAccountType, AgentPersona } from "./persona";

/**
 * AgentRail — the persistent Paige presence rail (Wave 4 Slice 4a.1).
 *
 * The docked, collapsible right-rail CONTAINER + mount points from the
 * agent-ui-placement spec (§4/§5 "Persistent right rail on platform surfaces").
 * This is CHROME, not the chat's internal design (spec §11 non-goal): it owns the
 * dock/collapse/motion and provides slots — a persona-aware header, an optional
 * agency scope-switcher slot, a `children` BODY seam where the shared Paige chat
 * mounts, and a footer. The VP persona is a prop, never hardcoded (see persona.ts).
 *
 * PLACEMENT: fixed to the right edge so it never restructures the host's flow
 * layout. The host reserves the COLLAPSED gutter ({@link AGENT_RAIL_COLLAPSED_REM})
 * so the idle presence tab pushes content, not covers it (spec §3.5 "non-intrusive
 * when idle"). On EXPAND the 22rem panel OVERLAYS the work surface — the host does
 * NOT reserve the expanded width (a defensible slice-1 call: the rail is on-demand
 * and the overlay + soft shadow read as a layer above the work). The push-resize on
 * expand (reserve the expanded gutter / reflow) is owed-work #6. Desktop-only chrome
 * (`hidden md:flex`): the platform right-rail is the DESKTOP pattern (spec §5);
 * mobile/portal use a different surface (floating avatar, later slice), and ⌘K stays
 * universal.
 *
 * TOP OFFSET (`topRem`): the rail docks BELOW the host's top bar, not under it. The
 * host passes its header height so the expanded panel's persona header sits fully
 * below the top bar with no overlap and no z-fight (the rail stays z-30, under the
 * host header's z-40 — never bumped over it, which would cover the top bar's own
 * controls). Default 0 = full-height dock for a host with no top bar.
 *
 * §11/§22/§23/§25: token-only (zero hex), layered depth (raised `--card` over the
 * work surface + a hairline `--border` seam + soft shadow), AA in both themes, gold
 * reserved for the act moment — the operator identity hint reuses the shell's exact
 * accent-bordered "Operator" chip, never a gold fill. Motion is an Apple-style
 * spring, fully guarded by `useReducedMotion` (reduced → instant width, no fade).
 */

/**
 * Rail width when collapsed to the presence tab (rem). The host reserves THIS gutter
 * (see AdminLayout's `md:pr-[3.25rem]` — keep the two in sync; Tailwind can't read
 * this JS const inside an arbitrary value, so they're cross-linked by comment, N1/§39).
 */
export const AGENT_RAIL_COLLAPSED_REM = 3.25;
/**
 * Rail width when EXPANDED to the chat panel (rem). The host does NOT reserve this —
 * the expanded panel OVERLAYS the work surface (slice-1 call; push-resize is owed-work
 * #6). Not a reserved gutter — see the file header's PLACEMENT note.
 */
export const AGENT_RAIL_EXPANDED_REM = 22;

export interface AgentRailProps {
  /** Resolved persona identity (see persona.ts). Host passes tenant-authored persona or the default. */
  persona: AgentPersona;
  /** Presentation-only account classification (spec §5a). Drives header treatment. */
  accountType: AgentAccountType;
  /**
   * Agency scope-switcher slot (spec §5a agency, owed-work #7). Rendered under the
   * header ONLY when provided (agency-parent operator). Left as a slot so the actual
   * switcher wires in a later slice without touching the rail.
   */
  scopeSwitcher?: ReactNode;
  /**
   * The chat BODY seam — the shared Paige chat surface mounts here. When absent the
   * rail renders a crafted presence placeholder (never a raw blank, §11/§25).
   */
  children?: ReactNode;
  /** Optional footer slot (defaults to the ⌘K hint). */
  footer?: ReactNode;
  /**
   * Host top-bar height in rem. The rail docks below it (top offset + reduced height)
   * so its header never paints behind the host header (§39 S1). Default 0 = full-height.
   */
  topRem?: number;
  className?: string;
}

export function AgentRail({
  persona,
  accountType,
  scopeSwitcher,
  children,
  footer,
  topRem = 0,
  className,
}: AgentRailProps) {
  const reduce = useReducedMotion();
  const { railExpanded, expandRail, collapseRail, openLauncher } = useAgentPresence();

  const spring = reduce
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const);

  // Enter/exit for the hide-when-idle mount (driven by the host's <AnimatePresence>,
  // AgentPresence). Subtle fade + small slide-from-right. The transform lives HERE on
  // the fixed aside — never on a wrapping ancestor, which would establish a containing
  // block and break `position: fixed`. Reduced motion → no enter (snap in) and an
  // instant, fade-only exit (§22 per-primitive reduced-motion, matching the existing
  // width spring's guard). Width stays out of `initial` so it never animates from 0 on
  // mount (identical to the prior `initial={false}` behavior).
  const presenceInitial = reduce ? false : { opacity: 0, x: 16 };
  const presenceExit = reduce ? { opacity: 0 } : { opacity: 0, x: 16 };

  const widthRem = railExpanded ? AGENT_RAIL_EXPANDED_REM : AGENT_RAIL_COLLAPSED_REM;

  return (
    <motion.aside
      // Fixed dock on the right edge, BELOW the host top bar (topRem). `hidden md:flex`:
      // desktop-only presence rail. z-30 stays UNDER the host header's z-40 (no z-fight,
      // never covers the top bar's controls) — the top offset is what clears it, not z.
      className={cn(
        "fixed right-0 z-30 hidden flex-col overflow-hidden md:flex",
        "border-l border-border bg-card text-card-foreground shadow-[shadow:-8px_0_24px_-16px_hsl(var(--foreground)/0.25)]",
        className,
      )}
      initial={presenceInitial}
      animate={{ width: `${widthRem}rem`, opacity: 1, x: 0 }}
      exit={presenceExit}
      transition={spring}
      style={{ top: `${topRem}rem`, height: `calc(100dvh - ${topRem}rem)` }}
      aria-label={`${persona.label} presence rail`}
    >
      {railExpanded ? (
        <ExpandedPanel
          persona={persona}
          accountType={accountType}
          scopeSwitcher={scopeSwitcher}
          onCollapse={collapseRail}
          onOpenLauncher={openLauncher}
          footer={footer}
          reduce={!!reduce}
        >
          {children}
        </ExpandedPanel>
      ) : (
        <CollapsedTab persona={persona} onExpand={expandRail} reduce={!!reduce} />
      )}
    </motion.aside>
  );
}

/* ── Collapsed presence tab ─────────────────────────────────────────────────── */

function CollapsedTab({
  persona,
  onExpand,
  reduce,
}: {
  persona: AgentPersona;
  onExpand: () => void;
  reduce: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        "group flex h-full w-full flex-col items-center gap-3 py-4 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "transition-colors hover:bg-muted/40",
      )}
      aria-label={`Open ${persona.label}`}
      aria-expanded={false}
    >
      <span className="relative grid place-items-center">
        {/* ONE living signal on this always-visible 52px strip (§25): the breathing
            The Command Mark is the presence cue. The dot renders as a STATIC success ring
            (pulse={false}) so we don't stack a second perpetual pulse next to it. */}
        <PaigeCommandMark plated={false} className="h-8 w-8" animated={!reduce} />
        <PresenceDot
          status="online"
          size="sm"
          pulse={false}
          className="absolute -bottom-0.5 -right-0.5"
        />
      </span>
      {/* Vertical wordmark — the persona name reads down the tab. */}
      <span
        className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground"
        style={{ writingMode: "vertical-rl" }}
      >
        {persona.label}
      </span>
      <span className="mt-auto text-muted-foreground/60 transition-colors group-hover:text-foreground">
        <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
      </span>
    </button>
  );
}

/* ── Expanded chat panel ────────────────────────────────────────────────────── */

function ExpandedPanel({
  persona,
  accountType,
  scopeSwitcher,
  onCollapse,
  onOpenLauncher,
  footer,
  reduce,
  children,
}: {
  persona: AgentPersona;
  accountType: AgentAccountType;
  scopeSwitcher?: ReactNode;
  onCollapse: () => void;
  onOpenLauncher: () => void;
  footer?: ReactNode;
  reduce: boolean;
  children?: ReactNode;
}) {
  const content = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — persona identity + operator hint + collapse. Elevated tier over
          the body via a hairline seam (§27 definition). */}
      <header className="flex shrink-0 items-start gap-2.5 border-b border-border px-4 py-3">
        <span className="relative mt-0.5 grid shrink-0 place-items-center">
          <PaigeCommandMark plated={false} className="h-7 w-7" animated={!reduce} />
          <PresenceDot status="online" size="sm" className="absolute -bottom-0.5 -right-0.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate font-display text-sm font-semibold text-foreground">
              {persona.label}
            </h2>
            {persona.operator && (
              // Operator identity hint — mirrors the shell's exact accent-bordered
              // chip (spec §5a "never confused with the tenant experience"). Accent
              // marks the elevated operator mode, consistent with AdminLayout; not a
              // gold fill (§11).
              <span className="inline-flex items-center rounded-full border border-accent/40 bg-transparent px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent">
                Operator
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{persona.tagline}</p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className={cn(
            "-mr-1 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground",
            "outline-none transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
          aria-label={`Collapse ${persona.label}`}
        >
          <PanelRightClose className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {/* Agency scope-switcher slot (spec §5a) — rendered only when the host injects
          it (agency-parent operator). Seam for owed-work #7. */}
      {scopeSwitcher && (
        <div className="shrink-0 border-b border-border px-3 py-2" data-testid="agent-rail-scope-slot">
          {scopeSwitcher}
        </div>
      )}

      {/* BODY seam — the shared Paige chat mounts here (spec §11 non-goal: this slice
          is placement, not the chat). A crafted placeholder stands in when absent. */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-rail-body">
        {children ?? (
          <EmptyState
            icon={MessagesSquare}
            title="Your Paige team is on call"
            description={
              accountType === "platform_operator"
                ? "Ask about the fleet, or press ⌘K from anywhere to start."
                : "Ask her anything — she'll pull in the right teammate. Press ⌘K from anywhere."
            }
            tone="brand"
            className="h-full justify-center"
          />
        )}
      </div>

      {/* Footer — the universal-launcher hint by default. */}
      <footer className="shrink-0 border-t border-border px-3 py-2">
        {footer ?? (
          <button
            type="button"
            onClick={onOpenLauncher}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground",
              "outline-none transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            )}
          >
            <Command className="h-3.5 w-3.5" aria-hidden />
            <span>
              Ask from anywhere <kbd className="font-sans font-medium">⌘K</kbd>
            </span>
          </button>
        )}
      </footer>
    </div>
  );

  if (reduce) return content;

  return (
    <motion.div
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {content}
    </motion.div>
  );
}
