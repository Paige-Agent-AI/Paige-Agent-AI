import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, ShieldQuestion, Loader2, AlertTriangle, CircleHelp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The approve/deny card Paige shows before she commits a change (#120).
 *
 * WHAT CHANGED, AND WHY IT IS A STRUCTURAL FIX RATHER THAN A RESTYLE
 * ------------------------------------------------------------------
 * The previous version took `fingerprints?: string[]` — optional — and said so in its own comment:
 * "Optional so a caller that has not adopted the binding still renders; that caller's approvals
 * simply will not open the gate." That is a fully live-looking Approve button that CANNOT execute,
 * and it is exactly what the Solo shell shipped: the owner pressed Approve, the rail ticked, and
 * the chat gate — which only ever honours an echoed fingerprint — was still waiting. Measured on
 * production: 21 of 36 proposals in 30 days were never acted on.
 *
 * So the binding is no longer optional-and-hoped-for. Each action carries its OWN fingerprint, and
 * an action with none cannot render an approve affordance at all — it renders the honest refusal
 * (`cannotApproveHere`) that names where the decision can actually be made. A dead Approve button
 * is now unrepresentable rather than merely discouraged (§13/§70).
 *
 * THE INDEX BUG THIS ALSO CLOSES. The old caller built two parallel arrays and filtered one of
 * them — `items.map(c => c.summary)` beside `fingerprints.map(c => c.fingerprint).filter(Boolean)`.
 * Any action missing a fingerprint shifted every later summary onto the wrong fingerprint, so an
 * approval could be spent on a neighbouring call. Pairing summary and fingerprint in ONE object
 * makes that misalignment impossible to express.
 *
 * Gold discipline (§11): container, icon and headings are neutral; gold is spent only on the
 * Approve act. Focus rings are indigo. One elevation declaration — a hairline border on a tinted
 * surface, never a border under a shadow.
 *
 * Owner-surface only: the client portal never renders operator-approval framing (§6/§9).
 *
 * TWO MODES, ONE CARD (owner-approved recovery design, 2026-09-26). `decide` is the card above:
 * Needs your OK, Approve, Not now. `report` is the same card on the turn that ran the approval: it
 * says Running…, then what became of each action — Done, Didn't run, or Couldn't confirm — in the
 * sentence the server wrote, with the one next step that exists. It never renders an approve
 * control: pressing Approve twice must be impossible, not merely discouraged.
 */

export type ConfirmActionState = "pending" | "working" | "done" | "failed" | "unconfirmed";

/** The card's own state. `mixed` exists only at card level: some actions ran and some did not. */
type CardState = ConfirmActionState | "mixed";

export type ConfirmAction = {
  /** The server-authored sentence describing the exact call. Never model prose re-rendered. */
  summary: string;
  /**
   * The fingerprint of the EXACT stored call this summary describes. Approve echoes it back in the
   * request body — a place the model cannot write to — and the server runs the call it stored under
   * that fingerprint. An action with no fingerprint is NOT approvable on this surface, and the card
   * refuses rather than offering a control that would do nothing.
   */
  fingerprint?: string;
  state?: ConfirmActionState;
  /** Why it failed, or what it produced. Shown verbatim; the server owns this sentence. */
  note?: string;
};

/**
 * Settled rows earn an icon because the icon carries the outcome. A PENDING row does not: repeating
 * the header's shield on every line is noise, and in a mixed batch it actively misleads — an
 * approvable row and an unapprovable one rendered identically while behaving differently. Pending
 * rows use a typographic marker instead, and the two kinds differ at a glance: a filled dot for one
 * this card can act on, a dash for one it cannot.
 */
const ROW_ICON: Partial<Record<ConfirmActionState, typeof Check>> = {
  working: Loader2,
  done: Check,
  failed: AlertTriangle,
  unconfirmed: CircleHelp,
};

/** What each row's icon says, for someone who cannot see it. */
const ROW_WORD: Partial<Record<ConfirmActionState, string>> = {
  working: "Running",
  done: "Done",
  failed: "Didn't run",
  unconfirmed: "Couldn't confirm",
};

/** The seal carries the card's outcome; a mixed batch is a failure until the person acts on it. */
const SEAL_ICON: Record<CardState, typeof Check> = {
  pending: ShieldQuestion,
  working: Loader2,
  done: Check,
  failed: AlertTriangle,
  mixed: AlertTriangle,
  unconfirmed: CircleHelp,
};

/** Tone per state. `pending` stays neutral — a decision is not a status. Amber is "may have gone
 *  through": not the red of a failure, because it may have worked. */
const TONE: Record<CardState, string> = {
  pending: "text-muted-foreground",
  working: "text-muted-foreground",
  done: "text-[hsl(var(--success))]",
  failed: "text-destructive",
  mixed: "text-destructive",
  unconfirmed: "text-[hsl(var(--warning))]",
};

function headingFor(state: CardState, actions: ConfirmAction[]): string {
  const n = actions.length;
  switch (state) {
    case "pending": return n > 1 ? `Needs your OK · ${n} actions` : "Needs your OK";
    case "working": return "Running…";
    case "done": return n > 1 ? `${n} done` : "Done";
    case "mixed": {
      const done = actions.filter((a) => a.state === "done").length;
      return `${done} done · ${n - done} didn't run`;
    }
    case "failed": return "Didn't run";
    case "unconfirmed": return "Couldn't confirm";
  }
}

/** The card's state is the strongest signal among its rows. Work in progress outranks everything,
 *  because that is what a person is waiting on; "may have gone through" outranks a clean verdict,
 *  because it is the one they must act on before asking again. */
function cardStateOf(actions: ConfirmAction[]): CardState {
  const states = actions.map((a) => a.state ?? "pending");
  if (states.includes("working")) return "working";
  if (!states.every((s) => s === "done" || s === "failed" || s === "unconfirmed")) return "pending";
  if (states.includes("unconfirmed")) return "unconfirmed";
  if (!states.includes("failed")) return "done";
  return states.includes("done") ? "mixed" : "failed";
}

type SharedProps = {
  actions: ConfirmAction[];
  className?: string;
  /**
   * Take focus when the card appears, if nothing else holds it — the button that led here (Approve,
   * or Ask Paige again) is gone. The CARD takes it, never the Approve inside it: a stray Enter must
   * not approve something the person has not yet read.
   */
  focusOnMount?: boolean;
};

type DecideProps = SharedProps & {
  mode?: "decide";
  onApprove: (fingerprints: string[]) => void;
  onDeny: (fingerprints: string[]) => void;
  disabled?: boolean;
  /**
   * Shown INSTEAD of the approve controls when this surface holds no binding for any action —
   * name where the decision can be completed. Omit it and the card still refuses; it simply says
   * less. Never render an approve control in this state.
   */
  cannotApproveHere?: string;
};

type ReportProps = SharedProps & {
  mode: "report";
  /** One sentence for the whole card, read with the heading. The server writes it. */
  note?: string;
  /** The one next step where something didn't run: ask Paige again for just those. */
  recovery?: { onPress: () => void; disabled?: boolean };
  /** Where to check, when something may have gone through. Rendered by the caller (router-owned). */
  check?: ReactNode;
};

export type PaigeConfirmCardProps = DecideProps | ReportProps;

export function PaigeConfirmCard(props: PaigeConfirmCardProps) {
  const { actions } = props;
  const report = props.mode === "report";
  const noteId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const focusOnMount = props.focusOnMount === true;
  useEffect(() => {
    if (!focusOnMount) return;
    // Only when focus was lost with the card that went away. Someone who has already moved on —
    // typing in the composer, reading elsewhere — is never pulled back.
    const active = document.activeElement;
    if (!active || active === document.body) cardRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  if (!actions.length) return null;

  const approvable = actions.filter((a) => typeof a.fingerprint === "string" && a.fingerprint !== "");
  const fingerprints = approvable.map((a) => a.fingerprint as string);
  const canApprove = !report && fingerprints.length > 0;

  const cardState = cardStateOf(actions);
  const anyWorking = cardState === "working";
  const heading = headingFor(cardState, actions);
  const note = report ? props.note : undefined;

  const multi = actions.length > 1;
  const decided = cardState !== "pending" && cardState !== "working";
  const controlsDisabled = (!report && props.disabled) || anyWorking;
  const SealIcon = SEAL_ICON[cardState];
  const recovery = report && (cardState === "failed" || cardState === "mixed") ? props.recovery : undefined;
  const check = report && cardState === "unconfirmed" ? props.check : undefined;
  // One authored moment: the report card rises in when Approve is pressed, and its seal settles
  // when the answer lands. Nothing else moves, and reduced motion keeps both still.
  const settleMotion = report && "animate-in fade-in-0 zoom-in-90 duration-200 ease-out motion-reduce:animate-none";

  return (
    <div
      ref={cardRef}
      role="group"
      tabIndex={report || focusOnMount ? -1 : undefined}
      aria-label={heading}
      aria-describedby={note ? noteId : undefined}
      data-state={cardState}
      data-card-mode={report ? "report" : "decide"}
      className={cn(
        "mt-2 rounded-xl border p-3.5 transition-colors motion-reduce:transition-none",
        report
          ? "duration-200 animate-in fade-in-0 slide-in-from-bottom-1 ease-out motion-reduce:animate-none"
          : "duration-300",
        cardState === "failed" || cardState === "mixed"
          ? "border-destructive/30 bg-destructive/[0.04]"
          : cardState === "done"
            ? "border-[hsl(var(--success)/0.28)] bg-[hsl(var(--success)/0.04)]"
            : cardState === "unconfirmed"
              ? "border-[hsl(var(--warning)/0.34)] bg-[hsl(var(--warning)/0.05)]"
              : "border-border bg-muted/40",
        props.className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border/70 bg-background/70",
            TONE[cardState],
          )}
        >
          {anyWorking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <SealIcon key={cardState} className={cn("h-3.5 w-3.5", settleMotion)} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {/* A real heading, not an uppercase eyebrow. It states the decision, and it changes
              with the outcome so the card reports what happened instead of silently vanishing.
              On a report the heading and its sentence are ONE live region, so the reason is
              announced with the verdict rather than left for someone to go looking for. */}
          <div aria-live={report ? "polite" : undefined} aria-atomic={report ? true : undefined}>
            <p
              className="text-[13px] font-semibold leading-[18px] tracking-[-0.012em] text-foreground"
              aria-live={report ? undefined : "polite"}
            >
              {heading}
            </p>
            {note && (
              <p
                id={noteId}
                className="mt-0.5 max-w-[64ch] text-[13px] leading-[18px] text-[color:var(--pg-ink-2,hsl(var(--muted-foreground)))]"
              >
                {note}
              </p>
            )}
          </div>

          <ul className={cn("mt-1.5 space-y-1.5", !multi && "space-y-0")}>
            {actions.map((action, i) => {
              const state = action.state ?? "pending";
              const RowIcon = ROW_ICON[state];
              const settled = state === "done" || state === "failed" || state === "unconfirmed";
              const bound = typeof action.fingerprint === "string" && action.fingerprint !== "";
              return (
                <li
                  key={action.fingerprint ?? `${i}-${action.summary.slice(0, 24)}`}
                  className="flex items-start gap-2 text-sm leading-5 text-foreground"
                >
                  {multi &&
                    (RowIcon ? (
                      <RowIcon
                        key={state}
                        aria-hidden
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          TONE[state],
                          state === "working" ? "animate-spin motion-reduce:animate-none" : settleMotion,
                        )}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="mt-[7px] h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      >
                        {bound ? (
                          <span className="block h-1 w-1 rounded-full bg-current" />
                        ) : (
                          <span className="block h-px w-2.5 bg-current opacity-60" />
                        )}
                      </span>
                    ))}
                  {/* A summary can carry a recipient's address, one unbroken word: it breaks rather
                      than running off the card at side-panel width. */}
                  <span className="min-w-0 break-words">
                    <span className={cn((settled || (!bound && multi)) && "text-muted-foreground")}>
                      {/* The icon beside a row is hidden from assistive tech, so its state is said
                          in words: in a mixed card the heading cannot tell which one ran. */}
                      {multi && ROW_WORD[state] && <span className="sr-only">{ROW_WORD[state]}: </span>}
                      {action.summary}
                    </span>
                    {action.note && (
                      <span
                        className={cn(
                          "mt-0.5 block text-xs leading-4",
                          state === "failed" ? "text-destructive"
                            // Amber, deepened toward ink: at 12px on the amber-tinted card the plain
                            // token measured 4.56:1 in light (render-results.json), too thin a margin.
                            : state === "unconfirmed" ? "text-[color-mix(in_oklab,hsl(var(--warning))_78%,hsl(var(--foreground)))]"
                            : "text-muted-foreground",
                        )}
                      >
                        {action.note}
                      </span>
                    )}
                    {/* Only worth saying per ROW when the card can still act on something else.
                        When nothing is approvable the card-level line below says it once, and
                        saying it twice reads as a system repeating itself. */}
                    {!bound && !settled && canApprove && (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        Can&rsquo;t be approved from this chat.
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* THE REFUSAL. No binding means no approve control — not a disabled one, not a
              hopeful one. The person is told where the decision can actually be made. A report
              has nothing to decide, so it never says this. */}
          {!report && !canApprove && !decided ? (
            <p className="mt-2.5 text-xs leading-4 text-muted-foreground">
              {props.cannotApproveHere ??
                "This conversation can’t complete approvals, so nothing has changed. Ask for it again where Paige can show you an approval control."}
            </p>
          ) : null}

          {!report && canApprove && !decided && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="gold"
                onClick={() => props.onApprove(fingerprints)}
                disabled={controlsDisabled}
              >
                {anyWorking ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {anyWorking ? "Running…" : multi ? `Approve ${fingerprints.length}` : "Approve"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => props.onDeny(fingerprints)}
                disabled={controlsDisabled}
                className="text-muted-foreground"
              >
                <X className="mr-1.5 h-4 w-4" /> Not now
              </Button>
              {approvable.length < actions.length && (
                <span className="text-xs leading-4 text-muted-foreground">
                  {actions.length - approvable.length} of {actions.length} can&rsquo;t be approved here.
                </span>
              )}
            </div>
          )}

          {/* THE ONE NEXT STEP. Where something didn't run, asking again is the recovery the
              interface really offers — never "approve it again": this card has no Approve, and
              the one that asked is gone. Where something MAY have gone through, the step is to
              check first, so asking again cannot make it happen twice. */}
          {(recovery || check) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {recovery && (
                <>
                  {/* Its label may wrap: at 320px reflow the text column is narrower than the
                      button, and a control that runs off the card is one a person cannot see. */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={recovery.onPress}
                    disabled={recovery.disabled}
                    className="h-auto min-h-9 max-w-full whitespace-normal py-1.5 text-left"
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4 shrink-0" aria-hidden />
                    Ask Paige again
                  </Button>
                  {cardState === "mixed" && (
                    <span className="text-xs leading-4 text-muted-foreground">
                      {actions.filter((a) => a.state === "failed").length > 1
                        ? "Only the ones that didn’t run."
                        : "Only the one that didn’t run."}
                    </span>
                  )}
                </>
              )}
              {check}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Where the card was, once the person has decided. The proposal settles into this quiet record in
 * place, so the transcript still shows what was asked and what the answer was — and there is no
 * button left on it to press a second time.
 */
export function PaigeConfirmRecord({ decision, count }: { decision: "approved" | "declined"; count: number }) {
  const approved = decision === "approved";
  const Icon = approved ? Check : X;
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs leading-4 text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {approved ? (count > 1 ? `Approved · ${count} actions` : "Approved") : "Skipped · nothing changed"}
    </div>
  );
}
