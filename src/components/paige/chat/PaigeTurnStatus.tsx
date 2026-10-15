// C3a — the status line on a PAIGE answer, the inline "What PAIGE did", and the outcome footer.
//
// Approved design: docs/design-references/prototypes/paige-turn-states-c3.html (owner-approved 2026-10-05, §28
// frozen). This component DRAWS a TurnView; it decides nothing. What the line says comes from
// `deriveLiveTurnView` / `deriveSnapshotView` (src/lib/paige-stream/turn-view.ts), which reads turn
// state and step frames only — never PAIGE's prose.
//
// One line of chrome per answer: a 14px glyph, one plain sentence, quiet meta in tabular numbers,
// and — when there were steps — the whole row is the disclosure for "What PAIGE did". The hairline
// under it carries the state: a slow indigo sweep while she works, solid when it is your move,
// soft when she is done. No gold anywhere here (§11): gold is the act, and this is a watch surface.
import "./paige-turn-status.css";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, ChevronRight, CircleHelp, Clock, Hand, Lock, PauseCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { deriveLiveTurnView, formatElapsed, type LiveTurnInput, type TurnFooterAction, type TurnGlyph, type TurnRow, type TurnView } from "@/lib/paige-stream";

const MAX_ROWS = 8;
/** Collapse only when it hides at least two rows — "Show all 9 steps" to reveal one is noise. */
const collapses = (n: number) => n > MAX_ROWS + 1;
const DEPT: Record<TurnRow["group"], string> = { owner: "Owner Ops", client: "Client Experience", shared: "" };

function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, [query]);
  return matches;
}

function Glyph({ glyph }: { glyph: TurnGlyph }) {
  switch (glyph) {
    case "dot": return <span className="ptl-dot" aria-hidden />;
    case "check": return <Check className="ptl-settle" aria-hidden />;
    case "hand": return <Hand className="ptl-settle" aria-hidden />;
    // C4c — a question PAIGE asked (c2 "Your call", c5 "Question not answered").
    case "help": return <CircleHelp className="ptl-settle" aria-hidden />;
    case "triangle": return <AlertTriangle className="ptl-settle" aria-hidden />;
    case "pause": return <PauseCircle className="ptl-settle" aria-hidden />;
    case "lock": return <Lock aria-hidden />;
    case "clock": return <Clock aria-hidden />;
    default: return null;
  }
}

function StepGlyph({ status }: { status: TurnRow["status"] }) {
  if (status === "running") return <span className="ptl-dot" aria-hidden />;
  if (status === "done") return <Check aria-hidden />;
  if (status === "error") return <AlertCircle aria-hidden />;
  return <PauseCircle aria-hidden />;
}

const STATUS_WORD: Record<TurnRow["status"], string> = { running: "In progress: ", done: "Done: ", error: "Problem: ", stopped: "Stopped: " };

function StepList({ rows, all }: { rows: TurnRow[]; all: boolean }) {
  const shown = all || !collapses(rows.length) ? rows : rows.slice(0, MAX_ROWS);
  return (
    <ol className="ptl-steps">
      {shown.map((r) => {
        const meta = [DEPT[r.group], r.detail].filter(Boolean).join(" · ");
        return (
          <li key={r.id} className="ptl-step" data-paige-turn-step data-status={r.status}>
            <span className="ptl-step-glyph"><StepGlyph status={r.status} /></span>
            <span className="ptl-step-text">
              <span className="sr-only">{STATUS_WORD[r.status]}</span>
              {r.label}
              {meta && <span className="ptl-step-meta">{meta}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface PaigeTurnStatusProps {
  view: TurnView;
  /** Unique per answer, for aria-controls. */
  idBase: string;
  /** When the turn started (client clock) — drives a "live" elapsed meta. */
  startedAt?: number;
  /** Only the answer being read right now speaks to a screen reader. */
  announce?: boolean;
  defaultOpen?: boolean;
  /** Controlled open state (the Stop footer's "See what finished" opens it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The person is about to open or close "What PAIGE did". Called with the line BEFORE it grows,
   *  so the transcript can hold the line where it is instead of following the bottom. */
  onTraceToggle?: (line: HTMLElement) => void;
  personaName?: string;
  /** A shared clock (ms). When given, this line keeps no clock of its own. */
  now?: number;
}

export function PaigeTurnStatus({ view, idBase, startedAt, announce = false, defaultOpen = false, open: openProp, onOpenChange, onTraceToggle, personaName, now: nowProp }: PaigeTurnStatusProps) {
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const phone = useMediaQuery("(max-width: 639px)");
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => { if (openProp === undefined) setOpenState(next); onOpenChange?.(next); };
  const [all, setAll] = useState(false);
  const live = view.elapsed === "live";
  const ownClock = live && nowProp === undefined;
  const [ownNow, setNow] = useState(() => Date.now());
  const now = nowProp ?? ownNow;
  useEffect(() => {
    if (!ownClock) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ownClock]);

  // Pause the sweep when it cannot be seen: scrolled away, or the tab is hidden.
  const ref = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const sweeping = !reduce && (view.kind === "work" || view.kind === "think");
  useEffect(() => {
    if (!sweeping) return;
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function" && ref.current) {
      io = new IntersectionObserver((entries) => setOffscreen(!entries[0]?.isIntersecting));
      io.observe(ref.current);
    }
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
  }, [sweeping]);

  // One announcement per change of state — never per step, never per second.
  const [said, setSaid] = useState("");
  const lastKind = useRef<string | null>(null);
  useEffect(() => {
    if (!announce) return;
    const key = `${view.kind}:${view.announce}`;
    if (lastKind.current === key) return;
    lastKind.current = key;
    setSaid("");
    const id = window.setTimeout(() => setSaid(view.announce), 30);
    return () => window.clearTimeout(id);
  }, [announce, view.kind, view.announce]);

  const elapsedText = view.elapsed === "live"
    ? (reduce || startedAt === undefined ? null : formatElapsed(now - startedAt))
    : typeof view.elapsed === "number" ? formatElapsed(view.elapsed) : null;
  const stepsText = view.steps ? `${view.steps} ${view.steps === 1 ? "step" : "steps"}` : null;
  const meta = [elapsedText, stepsText].filter(Boolean).join(" · ");
  const hasTrace = view.rows.length > 0;
  const traceId = `${idBase}-trace`;
  const name = (personaName && personaName.trim()) || "PAIGE";
  const toggle = (next: boolean) => {
    if (ref.current) onTraceToggle?.(ref.current);
    setOpen(next);
  };
  // The phone sheet is portaled to <body>, outside the PAIGE shell. It carries the shell's own theme
  // scope (the precedent SoloBusinessContextSetup sets for its portaled drawer), so its tokens,
  // type and focus ring are the shell's, not the generic sheet's.
  const [sheetTheme, setSheetTheme] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!phone || !open) return;
    setSheetTheme(ref.current?.closest("[data-pg]")?.getAttribute("data-pg") ?? undefined);
  }, [phone, open]);

  const inner = (
    <>
      <span className="ptl-glyph"><Glyph glyph={view.glyph} /></span>
      {/* Keyed on the words: a new label fades in over 120 ms (none under reduced motion). */}
      <span key={view.text} className="ptl-text">{view.text}</span>
      {meta && <><span className="sr-only">, </span><span className="ptl-meta">{meta}</span></>}
      {hasTrace && <><span className="sr-only">. What {name} did</span><ChevronRight className="ptl-chev" aria-hidden /></>}
    </>
  );

  return (
    <div
      ref={ref}
      className="ptl"
      data-paige-turn-line
      data-kind={view.kind}
      data-motion={reduce ? "reduce" : "full"}
      data-paused={offscreen || hidden ? "true" : "false"}
    >
      {hasTrace ? (
        phone ? (
          // No aria-controls here: the sheet's content exists only while it is open.
          <button type="button" className="ptl-row" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{inner}</button>
        ) : (
          <button type="button" className="ptl-row" aria-expanded={open} aria-controls={traceId} onClick={() => toggle(!open)}>{inner}</button>
        )
      ) : (
        <div className="ptl-row">{inner}</div>
      )}
      <div className="ptl-rule" aria-hidden>{sweeping && <span className="ptl-sweep" data-sweep />}</div>
      {hasTrace && !phone && (
        <div className="ptl-trace" id={traceId} data-open={open ? "true" : "false"}>
          <div className="ptl-trace-in">
            <StepList rows={view.rows} all={all} />
            {collapses(view.rows.length) && !all && (
              <button type="button" className="ptl-showall" onClick={() => setAll(true)}>Show all {view.rows.length} steps</button>
            )}
          </div>
        </div>
      )}
      {hasTrace && phone && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" id={traceId} data-pg={sheetTheme} className="ptl-sheet max-h-[72vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="text-left"><SheetTitle className="ptl-sheet-title">What {name} did</SheetTitle></SheetHeader>
            <StepList rows={view.rows} all />
          </SheetContent>
        </Sheet>
      )}
      {announce && <span className="sr-only" role="status" aria-live="polite" data-paige-turn-announcer>{said}</span>}
    </div>
  );
}

/**
 * The answer being read right now. Derives its view on its own clock, so the line can move from
 * "Thinking" to the 10 s research expectation without re-rendering the whole transcript.
 */
export function PaigeLiveTurnStatus({ input, ...rest }: Omit<PaigeTurnStatusProps, "view" | "startedAt"> & { input: Omit<LiveTurnInput, "now"> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!input.streaming) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [input.streaming]);
  const clock = Math.max(now, input.startedAt);
  const view = deriveLiveTurnView({ ...input, now: clock });
  if (!view) return null;
  // One clock per live line: this one, passed down.
  return <PaigeTurnStatus view={view} startedAt={input.startedAt} now={input.streaming ? clock : undefined} {...rest} />;
}

export interface PaigeTurnFooterProps {
  footer: { text: string; actions: TurnFooterAction[] };
  onAskAgain?: () => void;
  onSee?: () => void;
  /** After Stop, keyboard focus lands here so a keyboard user keeps their place. */
  focusOnMount?: boolean;
  /** Ghost (secondary) Ask again — used after Stop, where "See what finished" leads. */
  quietAskAgain?: boolean;
  disabled?: boolean;
}

export function PaigeTurnFooter({ footer, onAskAgain, onSee, focusOnMount = false, quietAskAgain = false, disabled = false }: PaigeTurnFooterProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: true });
  }, [focusOnMount]);
  const see = footer.actions.includes("see") && onSee;
  const again = footer.actions.includes("askAgain") && onAskAgain;
  if (!footer.text && !see && !again) return null;
  return (
    <div ref={ref} className="ptl-foot" data-paige-turn-footer tabIndex={-1}>
      {footer.text && <p>{footer.text}</p>}
      {see && (
        <Button type="button" variant="outline" size="sm" className="ptl-foot-btn" onClick={onSee}>
          <ChevronRight className="h-4 w-4" aria-hidden />See what finished
        </Button>
      )}
      {again && (
        <Button type="button" variant={quietAskAgain ? "ghost" : "outline"} size="sm" className="ptl-foot-btn" disabled={disabled} onClick={onAskAgain}>
          <RotateCcw className="h-4 w-4" aria-hidden />Ask again
        </Button>
      )}
    </div>
  );
}
