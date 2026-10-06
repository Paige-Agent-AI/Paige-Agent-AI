import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * C4c — PAIGE's question, answered in place (frozen prototype frames c2 / c3 / c5 / c6,
 * docs/design-references/prototypes/paige-turn-states-c3.html).
 *
 * WHAT THIS IS. When PAIGE cannot continue a piece of work without a real fact or choice only the
 * person has, she pauses the SAME objective and asks. The question is her answer's body (her words);
 * this card is only the bounded choices under it — an inline radio group (or checkboxes, when she
 * allows several) with "Use this", and "Skip, use your best guess". The composer stays open for an
 * answer in the person's own words (it says so itself). When there are no choices there is no card:
 * the composer alone takes the answer.
 *
 * WHAT IT NEVER IS. An approval. "Use this" is INK, never gold — gold is spent only on approving an
 * act (§11); an answer supplies a fact and grants nothing, so it must not look like a yes to an
 * action. Nothing is pre-selected and "Use this" stays unavailable until something is picked, so a
 * stray Enter cannot answer for the person.
 *
 * Once answered — or moved past — the card freezes into a one-line record in place
 * (`PaigeAskRecord`): "Answered below", "You let PAIGE choose", or "Not answered". There is no
 * control left on a closed question to press a second time; the server refuses a second answer too.
 */

export type PaigeAskOption = { label: string; value: string; description?: string };

export type PaigeAskCardProps = {
  options: PaigeAskOption[];
  multi?: boolean;
  /** The question's own words, for the group's accessible name (they are drawn above as her body). */
  question: string;
  disabled?: boolean;
  /** Take focus on the first option when the question arrives, if nothing else holds it. */
  focusOnMount?: boolean;
  /** The picked option(s), in the words the person sees — sent as their reply. */
  onAnswer: (reply: string) => void;
  onSkip: () => void;
  className?: string;
};

/** What a picked option says as the person's reply: its label, and its one line when it has one —
 *  "Light start — intake form now, kickoff next month" (c3). */
export function askReplyText(picked: PaigeAskOption[]): string {
  return picked
    .map((o) => (o.description ? `${o.label} — ${o.description.charAt(0).toLowerCase()}${o.description.slice(1)}` : o.label))
    .join("; ");
}

export function PaigeAskCard({ options, multi = false, question, disabled, focusOnMount, onAnswer, onSkip, className }: PaigeAskCardProps) {
  const [picked, setPicked] = useState<number[]>([]);
  const groupId = useId();
  const needId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!focusOnMount) return;
    const active = document.activeElement;
    // Never pull someone who is already typing their own answer (or anywhere else) back here.
    if (!active || active === document.body) optionRefs.current[0]?.focus({ preventScroll: true });
  }, [focusOnMount]);

  if (options.length < 2) return null;

  const none = picked.length === 0;
  const toggle = (i: number) => {
    if (disabled) return;
    setPicked((prev) => (multi ? (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort((a, b) => a - b)) : [i]));
  };
  // Single choice is a radio group: one tab stop, arrows move AND select (WAI-ARIA radio pattern).
  const tabStop = multi ? -1 : picked[0] ?? 0;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (multi) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    toggle(next);
    optionRefs.current[next]?.focus();
  };
  const submit = () => {
    if (none || disabled) return;
    onAnswer(askReplyText(picked.map((i) => options[i])));
  };

  return (
    <section
      role="group"
      aria-labelledby={groupId}
      data-paige-ask
      className={cn(
        "mt-3 rounded-xl border border-border bg-muted/40 p-3",
        "animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none",
        className,
      )}
    >
      <p id={groupId} className="sr-only">{question}</p>
      <div role={multi ? "group" : "radiogroup"} aria-labelledby={groupId} className="grid gap-2">
        {options.map((o, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={`${i}:${o.value}`}
              ref={(el) => { optionRefs.current[i] = el; }}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={on}
              tabIndex={multi ? 0 : i === tabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => toggle(i)}
              onKeyDown={(e) => onKey(e, i)}
              data-paige-ask-option={o.value}
              className={cn(
                "flex min-h-11 w-full items-start gap-2.5 rounded-[10px] border bg-background px-3 py-2.5 text-left",
                "transition-[border-color,box-shadow,background-color] duration-150 ease-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-60",
                on
                  ? "border-foreground shadow-[shadow:inset_0_0_0_1px_hsl(var(--foreground))]"
                  : "border-border hover:border-[hsl(var(--border-strong,var(--border)))] hover:bg-muted/50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-[1.5px]",
                  multi ? "rounded-[4px]" : "rounded-full",
                  on ? "border-foreground" : "border-[hsl(var(--border-strong,var(--border)))]",
                )}
              >
                {on && (multi
                  ? <Check className="h-3 w-3 text-foreground" strokeWidth={3} />
                  : <span className="block h-2 w-2 rounded-full bg-foreground" />)}
              </span>
              <span className="min-w-0 break-words">
                <span className="block text-[13px] font-semibold leading-[18px] text-foreground">{o.label}</span>
                {o.description && <span className="mt-px block text-xs leading-4 text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          aria-disabled={none || disabled ? true : undefined}
          aria-describedby={none ? needId : undefined}
          disabled={disabled}
          data-paige-ask-submit
          className={cn(
            // Ink, not gold: an answer is not an approval (§11 gold budget).
            "bg-foreground text-background shadow-none hover:-translate-y-0 hover:bg-foreground/90 hover:shadow-none",
            none && "cursor-not-allowed opacity-55 hover:bg-foreground",
          )}
        >
          {multi ? "Use these" : "Use this"}
        </Button>
        {none && <span id={needId} className="sr-only">Pick an option first</span>}
        <Button type="button" size="sm" variant="ghost" onClick={onSkip} disabled={disabled} data-paige-ask-skip className="text-muted-foreground">
          Skip, use your best guess
        </Button>
      </div>
    </section>
  );
}

/** Where a closed question stands, frozen in place: no control left on it (c3 / c5 / c6). */
export function PaigeAskRecord({ standing, name = "PAIGE" }: { standing: "answered" | "skipped" | "unanswered"; name?: string }) {
  // A skipped question is resolved too (PAIGE chose), so it reads with the same settled glyph.
  const Icon = standing === "unanswered" ? CircleHelp : Check;
  const text = standing === "answered" ? "Answered below" : standing === "skipped" ? `You let ${name} choose` : "Not answered";
  return (
    <div data-paige-ask-record={standing} className="mt-2 flex items-center gap-2 text-[12.5px] leading-[18px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  );
}
