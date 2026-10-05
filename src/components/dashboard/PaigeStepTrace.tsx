// "Watch Paige work" (#95) — the reasoning trace. Renders the steps Paige took this
// turn (streamed as paige_step frames) as an inline strip by default and, on desktop,
// a right-side rail. One <StepTimeline> feeds both surfaces and the mobile Sheet.
//
// Gold discipline (§6/§11): this is a WATCH surface — it spends ZERO gold. Running =
// indigo (--primary/--ring), done = --success, error = --destructive. The only gold in
// the chat region stays the existing Approve button (the act/approve moment). Token-only,
// theme-aware, motion guarded via Tailwind motion-safe/motion-reduce. Jargon-free copy
// comes pre-resolved from the server (§11) — this component renders labels verbatim.
import { useState } from "react";
import { Loader2, Check, AlertCircle, Circle, ListChecks, Users, UserRound, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard, EmptyState } from "@/components/ui/page";
import { normalizeStepStatus } from "@/lib/paige-stream";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type PaigeStep = {
  id: string;
  seq: number;
  round: number;
  // "thought" = Paige's one-line reasoning/narration for that round (what she's
  // about to do and why); "action" = a tool she actually ran. Defaults to action
  // for older frames that predate the field.
  kind?: "thought" | "action";
  label: string;
  group: "owner" | "client" | "shared";
  status: "running" | "done" | "error";
  detail?: string;
  ts?: number;
};

/**
 * A step frame as the stream sends it. An action may arrive first as "running" and close later on
 * the SAME id as "done", "error" or "withdrawn" (it started, but nothing it did is worth showing).
 * Frames from before that lifecycle carry no status at all, and those still mean done.
 */
export type PaigeStepFrame = Omit<PaigeStep, "status"> & { status?: unknown };

// Upsert by id, keep sorted by seq. A later frame for an id merges over the earlier one, so a
// "running" row becomes "done"/"error" in place; "withdrawn" removes the row. A status this client
// does not know is ignored rather than drawn — never shown as done (§13). The status rules live in
// the shared stream reader (normalizeStepStatus), so every client reads a frame the same way.
export function upsertStep(prev: PaigeStep[], step: PaigeStepFrame): PaigeStep[] {
  const status = normalizeStepStatus(step.status);
  if (status === null) return prev;
  const i = prev.findIndex((s) => s.id === step.id);
  if (status === "withdrawn") return i >= 0 ? prev.filter((s) => s.id !== step.id) : prev;
  const merged: PaigeStep = { ...step, status };
  const next = prev.slice();
  if (i >= 0) next[i] = { ...next[i], ...merged };
  else next.push(merged);
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

const DEPT_LABEL: Record<PaigeStep["group"], string> = {
  owner: "Owner Ops",
  client: "Client Experience",
  shared: "",
};

function StatusGlyph({ status }: { status: PaigeStep["status"] }) {
  if (status === "running") {
    return (
      <>
        <Loader2 className="hidden h-3.5 w-3.5 animate-spin text-[hsl(var(--ring))] motion-safe:block" aria-hidden />
        <Circle className="h-3.5 w-3.5 text-[hsl(var(--ring))] motion-safe:hidden" aria-hidden />
      </>
    );
  }
  if (status === "error") return <AlertCircle className="h-3.5 w-3.5 text-[hsl(var(--destructive))]" aria-hidden />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" aria-hidden />;
  // Not a status this client knows: draw nothing rather than claim it finished.
  return null;
}

/** The shared vertical list — used by the rail and the mobile Sheet. */
export function StepTimeline({ steps, loading }: { steps: PaigeStep[]; loading?: boolean }) {
  if (steps.length === 0 && loading) {
    return (
      <div className="space-y-2" aria-live="polite">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="h-6 w-6 shrink-0 animate-pulse rounded-lg bg-muted" />
            <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  if (steps.length === 0) {
    return <EmptyState icon={ListChecks} title="Nothing to show yet" description="When Paige works through a task, the steps appear here." />;
  }
  const lastRunningIdx = steps.map((s) => s.status).lastIndexOf("running");
  return (
    <ol className="space-y-2" aria-live="polite">
      {steps.map((s, i) => {
        // A "thought" is Paige narrating what she's about to do — render it as her
        // voice (a quiet reasoning line), distinct from the actions she then takes.
        if (s.kind === "thought") {
          return (
            <li key={s.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[hsl(var(--ring)/0.08)] ring-1 ring-inset ring-[hsl(var(--ring)/0.2)]">
                <MessageSquareText className="h-3.5 w-3.5 text-[hsl(var(--ring))]" aria-hidden />
              </span>
              <p className="min-w-0 flex-1 pt-0.5 text-sm italic leading-snug text-muted-foreground">
                <span className="sr-only">Reasoning: </span>{s.label}
              </p>
            </li>
          );
        }
        const active = i === lastRunningIdx || (lastRunningIdx === -1 && i === steps.length - 1);
        const dept = DEPT_LABEL[s.group];
        return (
          <li key={s.id} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                s.group === "shared"
                  ? "bg-muted ring-border"
                  : "bg-[hsl(var(--ring)/0.12)] ring-[hsl(var(--ring)/0.35)]",
              )}
            >
              <StatusGlyph status={s.status} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("text-sm leading-snug", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.label}
              </p>
              {(s.detail || dept) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dept && <span>{dept}</span>}
                  {dept && s.detail && <span className="mx-1">·</span>}
                  {s.detail && <span>{s.detail}</span>}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Inline strip — the default, and the only trace surface below lg. */
export function PaigeReasoningStrip({
  steps,
  loading,
  personaName,
}: {
  steps: PaigeStep[];
  loading?: boolean;
  personaName?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const name = personaName || "Paige";

  // At rest, the strip stays present as an "on watch" pill — never blanks (so the mobile
  // reasoning surface is always there, matching the desktop persistent deck).
  if (!loading && steps.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[hsl(var(--ring)/0.1)] ring-1 ring-inset ring-[hsl(var(--ring)/0.25)]">
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--ring))] motion-safe:cc-breathe" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{name} · on watch</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Ready when you are</p>
        </div>
      </div>
    );
  }

  // Stay "at work" while the answer is still streaming (isLoading), even after the step
  // burst lands — so "Done" only appears once the reply has settled.
  const running = loading || steps.some((s) => s.status === "running");
  const current =
    [...steps].reverse().find((s) => s.status === "running")?.label ??
    steps[steps.length - 1]?.label ??
    `${name} is thinking…`;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
          running ? "bg-[hsl(var(--ring)/0.12)] ring-[hsl(var(--ring)/0.35)]" : "bg-[hsl(var(--success)/0.12)] ring-[hsl(var(--success)/0.3)]",
        )}
      >
        {running ? (
          <>
            <Loader2 className="hidden h-4 w-4 animate-spin text-[hsl(var(--ring))] motion-safe:block" aria-hidden />
            <Circle className="h-4 w-4 text-[hsl(var(--ring))] motion-safe:hidden" aria-hidden />
          </>
        ) : (
          <Check className="h-4 w-4 text-[hsl(var(--success))]" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground motion-safe:transition-opacity" title={current}>
          {current}
        </p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {running ? `${name} at work` : "Done"}
        </p>
      </div>
      {steps.length > 0 && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
            {(() => {
              const n = steps.filter((s) => s.kind !== "thought").length;
              return n > 0 ? `${n} step${n === 1 ? "" : "s"}` : "Details";
            })()}
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
            <SheetHeader className="mb-3">
              <SheetTitle>{name} at work</SheetTitle>
            </SheetHeader>
            <StepTimeline steps={steps} loading={loading} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// ─── ReasoningDeck — the persistent "watch her work" cockpit ──────────────────
// Always visible (never returns null): two standing department lanes with a handoff
// heartbeat between them (§8 made literal), a live step timeline while Paige works, and a
// crafted "standing by" rest state. After a run the finished timeline persists until the
// next turn — that IS the rest memory. Zero gold — running --ring, done --success,
// error --destructive, department + heartbeat --ring.

function DepartmentLane({
  icon: Icon,
  name,
  remit,
  active,
  count,
}: {
  icon: typeof Users;
  name: string;
  remit: string;
  active: boolean;
  count?: number;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset transition-colors",
          active
            ? "bg-[hsl(var(--ring)/0.16)] ring-[hsl(var(--ring)/0.5)]"
            : "bg-[hsl(var(--ring)/0.08)] ring-[hsl(var(--ring)/0.2)]",
        )}
      >
        <Icon className={cn("h-4 w-4", active ? "text-[hsl(var(--ring))]" : "text-muted-foreground")} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={cn("truncate text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>{name}</p>
          {active && typeof count === "number" && count > 0 && (
            <span className="rounded-full bg-[hsl(var(--ring)/0.12)] px-1.5 text-[10px] font-semibold tabular-nums text-[hsl(var(--ring))]">{count}</span>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">{remit}</p>
      </div>
      {/* Working = indigo --ring (never done-green); ready = muted. Zero gold on this watch surface. */}
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          active ? "bg-[hsl(var(--ring)/0.15)] text-[hsl(var(--ring))]" : "bg-muted text-muted-foreground",
        )}
      >
        {active ? "working" : "ready"}
      </span>
    </div>
  );
}

/** The persistent reasoning cockpit for the workspace right column. */
export function ReasoningDeck({
  trace,
  personaName,
}: {
  trace: { steps: PaigeStep[]; loading?: boolean };
  personaName?: string;
}) {
  const name = personaName || "Paige";
  const steps = trace.steps;
  const working = trace.loading || steps.some((s) => s.status === "running");
  const finished = !working && steps.length > 0;

  const ownerActive = working && steps.some((s) => s.kind !== "thought" && s.group === "owner");
  const clientActive = working && steps.some((s) => s.kind !== "thought" && s.group === "client");
  const ownerCount = steps.filter((s) => s.kind !== "thought" && s.group === "owner").length;
  const clientCount = steps.filter((s) => s.kind !== "thought" && s.group === "client").length;
  const actionCount = steps.filter((s) => s.kind !== "thought").length;

  const title = working
    ? `${name} at work`
    : finished
      ? (actionCount > 0 ? `Done · ${actionCount} step${actionCount === 1 ? "" : "s"}` : "Done")
      : `${name} · ready`;

  // padded={false} + our own flex-col/min-h-0 chain: the scroll region's DIRECT parent must
  // be the bounded flex column, or SectionCard's block padding wrapper would break flex-1 and
  // clip long runs silently (crew catch). The card itself just clips the rounded corners.
  return (
    <SectionCard padded={false} className="overflow-hidden">
      <div className="flex max-h-[45vh] flex-col p-4">
        {/* Header — breathing dot at rest, spinner at work, success on finish */}
        <div className="flex items-center gap-2 px-1 pb-2.5" role="status" aria-live="polite">
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
              finished ? "bg-[hsl(var(--success)/0.12)] ring-[hsl(var(--success)/0.3)]" : "bg-[hsl(var(--ring)/0.1)] ring-[hsl(var(--ring)/0.25)]",
            )}
          >
            {working ? (
              <>
                <Loader2 className="hidden h-3.5 w-3.5 animate-spin text-[hsl(var(--ring))] motion-safe:block" aria-hidden />
                <Circle className="h-3.5 w-3.5 text-[hsl(var(--ring))] motion-safe:hidden" aria-hidden />
              </>
            ) : finished ? (
              <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" aria-hidden />
            ) : (
              <span className="h-2 w-2 rounded-full bg-[hsl(var(--ring))] motion-safe:cc-breathe" />
            )}
          </span>
          <span className="font-display text-sm font-semibold text-foreground">{title}</span>
        </div>

        {/* Two standing department lanes + handoff heartbeat between them */}
        <div className="relative space-y-3 px-1">
          <DepartmentLane icon={Users} name="Owner Ops" remit="Pipeline · follow-ups · retainers" active={ownerActive} count={ownerCount} />
          {/* handoff connector: a dot travels the hairline while the teams pass work between them */}
          <div className="ml-4 flex items-center gap-2 py-0.5" aria-hidden>
            <span className="relative block h-4 w-px bg-[hsl(var(--border))]">
              <span
                className={cn(
                  "absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[hsl(var(--ring))]",
                  working ? "motion-safe:cc-busflow" : "top-1/2 -translate-y-1/2 opacity-40",
                )}
              />
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">handoff</span>
          </div>
          <DepartmentLane icon={UserRound} name="Client Experience" remit="Onboarding · answers · nurture" active={clientActive} count={clientCount} />
        </div>

        {/* Working/just-finished → the timeline (the persisted run is the rest memory),
            which fills + scrolls. First load with no run → a compact standing-by block
            that stays its natural height so the deck doesn't hog the rail and squeeze
            the live feed below it. */}
        <div
          className={cn(
            "mt-3 border-t pt-3",
            working || finished ? "min-h-0 flex-1 overflow-y-auto" : "",
          )}
        >
          {working || finished ? (
            <StepTimeline steps={steps} loading={trace.loading} />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Standing by"
              description={`Give ${name} a task and watch her reason through it here — step by step, across both her teams.`}
              className="py-6"
            />
          )}
        </div>
      </div>
    </SectionCard>
  );
}
