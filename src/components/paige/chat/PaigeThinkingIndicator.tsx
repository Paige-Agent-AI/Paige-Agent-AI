// #11 — the shared, surface-agnostic "Paige is thinking" indicator. PROMOTED from the Studio
// ReasoningPanel pattern (useElapsedMs + a live "Thinking… <s>s" tick + a collapsed-expandable
// "Thought process") into ONE component consumed by every Paige chat surface (§18 one home): the
// owner/platform "Your Paige" console, the client portal, the Vibe Studio session, the broker
// session, and the floating widget. No surface hand-rolls its own thinking affordance.
//
// The state machine is driven by props, with an internal wall-clock timer:
//   idle            — no turn in flight → renders nothing.
//   thinking        — a turn is streaming, no answer text yet → "Thinking… Ns".
//   still_thinking  — thinking for longer than `stillThinkingAfterMs` (~10s) → "Still thinking… Ns".
//   writing         — the first answer token arrived → "Writing… Ns".
//   done            — turn finished → renders nothing (the completed reply speaks for itself).
//
// The expandable "Thought process" renders the STREAMED reasoning thoughts passed in (the server's
// `paige_step` frames of kind "thought") — NEVER the verbatim `paige_thinking` channel, which is
// gated off server-side (STUDIO_THINKING_ENABLED=false). If no thoughts stream, the disclosure is
// simply absent — nothing is fabricated (§13).
//
// §11/§23: this is a WATCH surface — it spends ZERO gold; it is calm-power indigo (--ring/--primary),
// never anxious/red/loud. Token-only, AA in both themes, motion-safe: the pulse freezes and the live
// seconds tick stops under `prefers-reduced-motion` (a rapidly-updating counter is motion), falling
// back to a static label. §36: a non-technical coach reads "Paige is thinking / writing" at a glance.
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useElapsedMs } from "./useElapsedMs";

/** One streamed reasoning line to expose under "Thought process". `id` keeps the list stable. */
export interface ThinkingThought {
  id: string;
  label: string;
}

export function PaigeThinkingIndicator({
  active,
  writing = false,
  thoughts,
  personaName,
  stillThinkingAfterMs = 10_000,
  className,
}: {
  /** A turn is in flight (from stream open until [DONE]/error). Drives the whole indicator. */
  active: boolean;
  /** The first answer token has arrived — flips the label to "Writing…". */
  writing?: boolean;
  /** Streamed reasoning thoughts (server `paige_step` kind:"thought") for the expandable trace. */
  thoughts?: ThinkingThought[];
  /** The tenant's assistant name, for a native voice ("Paige is thinking"). Defaults to "Paige". */
  personaName?: string;
  /** How long before "Thinking…" becomes "Still thinking…". Default ~10s. */
  stillThinkingAfterMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Live seconds — only ticks when motion is allowed (a fast counter is motion). Under reduced
  // motion the timer never runs and the label stays static (no seconds).
  const elapsedMs = useElapsedMs(active && !reduce);
  // The "still thinking" flip is a single one-shot (not a fast counter), so it is motion-safe and
  // works even under reduced motion where `elapsedMs` stays 0.
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!active) {
      setPast(false);
      return;
    }
    setPast(false);
    const id = window.setTimeout(() => setPast(true), Math.max(0, stillThinkingAfterMs));
    return () => window.clearTimeout(id);
  }, [active, stillThinkingAfterMs]);

  // Collapse the disclosure whenever a fresh turn begins so it never carries a prior turn's open state.
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  // done → render nothing (the finished reply is the result; §11 no lingering chrome).
  if (!active) return null;

  const name = personaName?.trim() || "Your assistant";
  const secs = !reduce ? ` ${Math.floor(elapsedMs / 1000)}s` : "";
  // The PHASE word is what a screen reader should hear — it changes 2-3× per turn. The live
  // seconds are visual only and must NOT be announced (a per-second aria-live update is chatter).
  const phaseWord = writing ? "writing" : past ? "still thinking" : "thinking";
  const label = writing
    ? `Writing…${secs}`
    : past
      ? `Still thinking…${secs}`
      : `Thinking…${secs}`;
  const hasThoughts = !!thoughts && thoughts.length > 0;

  return (
    <div
      className={cn(
        "max-w-[85%] overflow-hidden rounded-xl border border-border bg-muted/20",
        className,
      )}
    >
      {/* a11y: announce ONLY the phase (updates a few times per turn), never the per-second tick. */}
      <span className="sr-only" role="status" aria-live="polite">
        {name} is {phaseWord}
      </span>
      <button
        type="button"
        onClick={hasThoughts ? () => setOpen((o) => !o) : undefined}
        aria-expanded={hasThoughts ? open : undefined}
        // Not a button-role affordance when there's nothing to expand — it's a plain status line.
        {...(hasThoughts ? {} : { tabIndex: -1, "aria-hidden": false })}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors motion-reduce:transition-none",
          hasThoughts
            ? "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] cursor-pointer"
            : "cursor-default",
        )}
      >
        {hasThoughts && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
        )}
        <Brain
          className="h-3 w-3 shrink-0 text-[hsl(var(--ring))] motion-safe:animate-pulse"
          aria-hidden
        />
        {/* Visual label with the live seconds — deliberately NOT in a live region (announced via
            the phase-only sr-only status above). aria-hidden so SR doesn't read the ticking counter. */}
        <span className="tabular-nums opacity-90" aria-hidden>
          {label}
        </span>
      </button>
      {hasThoughts && open && (
        <ol className="max-h-56 space-y-1 overflow-y-auto border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground/90">
          {thoughts!.map((t) => (
            <li key={t.id} className="flex gap-1.5">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--ring)/0.6)]" aria-hidden />
              <span className="min-w-0">{t.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default PaigeThinkingIndicator;
