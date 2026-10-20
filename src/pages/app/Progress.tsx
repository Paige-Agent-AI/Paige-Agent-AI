/**
 * /app/progress — the work a business has shared with its customer (E09 Slice 3).
 *
 * Only what the business explicitly shared, item by item: the title, where it stands and when it is
 * due. Never a note, a priority, or who on the team is doing it. Open work sits under the shared
 * milestone it belongs to; work with no shared milestone sits under "Other work"; finished work
 * folds away under Done. The headline is how much is done, and "Next up" names the one to three
 * dated items that come first (past due, then due today, then soonest), so what's next is the first
 * thing read rather than a scan through every milestone.
 *
 * Read-only by design: the business updates this list, and the customer cannot mark anything done
 * here. Customer action items keep their own completion, on /app/actions, and are linked from here
 * when any are waiting.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, ArrowRight, Check, ChevronDown, CircleDashed, ClipboardList, Flag, Home, ListChecks, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_PROGRESS_LIMIT,
  groupOpenWork,
  isProgressPastDue as isPastDue,
  nextUpWork,
  progressDayKey as dayKey,
  progressDayLabel as dayLabel,
  useClientPortalProgress,
  viewerTimeZone,
  type PortalProgressItem,
  type PortalProgressState,
} from "@/hooks/useClientPortalProgress";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { useMyActions } from "@/hooks/useMyActions";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/**
 * The shared outline and ghost buttons hover-fill with --secondary, which is near-black in light
 * theme under a dark label. Every quiet control here hovers to muted with the label in foreground
 * instead, the same treatment as Sessions.
 */
const QUIET_HOVER = "hover:bg-muted hover:text-foreground";
const LINK_BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium ${QUIET_HOVER} ${FOCUS}`;
const MESSAGE_HREF = "/app/messages?topic=progress";

const STATE_LABEL: Record<PortalProgressState, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };

/**
 * Filled reads as under way, hollow as waiting: In progress carries a quiet tint, Not started is plain
 * muted text. Below `sm` the pill column is dropped and the state leads the due line instead, so a
 * short title never wraps beside a 170px pill on a phone.
 */
function StatePill({ state }: { state: PortalProgressState }) {
  const cls = state === "done"
    ? "border-success/40 bg-success/10 text-foreground"
    : state === "in_progress" ? "border-transparent bg-primary/10 text-foreground" : "border-transparent text-muted-foreground";
  return (
    <span
      data-testid="state-pill"
      className={`hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline-flex ${cls}`}
    >
      {state === "done" && <Check aria-hidden="true" className="h-3 w-3 text-success" />}
      {state === "in_progress" && <CircleDashed aria-hidden="true" className="h-3 w-3" />}
      {STATE_LABEL[state]}
    </span>
  );
}

function DueLine({ item, tz, nowMs }: { item: PortalProgressItem; tz: string; nowMs: number }) {
  if (item.state === "done") {
    return item.completed_at
      ? <span className="text-muted-foreground">Finished <time dateTime={item.completed_at}>{dayLabel(item.completed_at, tz, nowMs)}</time></span>
      : <span className="text-muted-foreground">Finished</span>;
  }
  if (!item.due_at) return <span className="text-muted-foreground">No due date</span>;
  if (isPastDue(item, nowMs)) {
    return (
      // Inline, not inline-flex: the state before it and the milestone after it share its baseline.
      <span data-testid="past-due" className="font-medium text-foreground">
        <AlertCircle aria-hidden="true" className="mr-1 inline-block h-3.5 w-3.5 align-[-0.125em] text-destructive" />
        Past due · <time dateTime={item.due_at}>{dayLabel(item.due_at, tz, nowMs)}</time>
      </span>
    );
  }
  const today = dayKey(Date.parse(item.due_at), tz) === dayKey(nowMs, tz);
  return (
    <span className="text-muted-foreground">
      {today ? "Due today" : <>Due <time dateTime={item.due_at}>{dayLabel(item.due_at, tz, nowMs)}</time></>}
    </span>
  );
}

/**
 * One shared item. A milestone carries the flag and heads its group; a task is a plain row, indented
 * under its milestone, so the hierarchy reads from position rather than from a repeated icon. From
 * `sm` up the pill keeps a fixed right column and the title wraps beside it, so the pills line up.
 */
function ItemRow({ item, tz, nowMs, heading = false, gutter = false, showState = true, context, testId = "progress-item" }: {
  item: PortalProgressItem; tz: string; nowMs: number; heading?: boolean;
  /** In a mixed flat list (Done), tasks keep the flag's column so every title starts on one edge. */
  gutter?: boolean;
  /** Done rows say "Finished <date>"; a Done pill beside that would say it twice. */
  showState?: boolean;
  /** Quiet context after the due line, e.g. the milestone a Next up item belongs to. */
  context?: string;
  testId?: string;
}) {
  const Title = heading ? "h3" : "p";
  const flagged = item.kind === "milestone";
  const inlineState = showState && item.state !== "done";
  return (
    <div data-testid={testId} data-item-id={item.id} className="flex items-start gap-3 py-3">
      {flagged
        ? <Flag aria-hidden="true" className={`mt-1 h-4 w-4 shrink-0 ${heading ? "text-foreground" : "text-muted-foreground"}`} />
        : gutter && <span aria-hidden="true" className="w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <Title className={`break-words [text-wrap:pretty] ${heading ? "text-base font-semibold" : "text-sm font-medium"}`}>
          {flagged && <span className="sr-only">Milestone: </span>}
          {item.title}
        </Title>
        <p className="mt-0.5 text-sm">
          {inlineState && (
            <span data-testid="state-inline" className="text-muted-foreground sm:hidden">{STATE_LABEL[item.state]} · </span>
          )}
          <DueLine item={item} tz={tz} nowMs={nowMs} />
          {context && <span className="text-muted-foreground"> · <span data-testid="next-context" className="inline-block">in {context}</span></span>}
        </p>
      </div>
      {showState && <StatePill state={item.state} />}
    </div>
  );
}

function GroupCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <li className="rounded-xl border border-border bg-card px-4" aria-label={label}>
      {children}
    </li>
  );
}

/** The first read: two cards the size of real ones, so nothing jumps when they land. */
function ProgressSkeleton() {
  return (
    <div role="status" data-testid="progress-skeleton" className="space-y-3">
      <span className="sr-only">Loading your progress…</span>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card px-4">
          {[0, 1].map((j) => (
            <div key={j} className="flex gap-3 border-b border-border py-3 last:border-b-0">
              <Skeleton className="h-4 w-4 shrink-0 rounded motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-1/4 motion-reduce:animate-none" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One empty-state treatment for an empty list and for an account that cannot use the page. */
function ProgressEmpty(props: { icon: LucideIcon; title: string; description: ReactNode; action: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <EmptyState icon={props.icon} title={props.title} description={<span className="[text-wrap:balance]">{props.description}</span>} action={props.action} className="py-10" />
    </div>
  );
}

function BackHome() {
  return (
    <Link to="/app" className={LINK_BUTTON}>
      <Home aria-hidden="true" className="h-4 w-4" /> Back to Home
    </Link>
  );
}

/**
 * The customer's own action items, when any are waiting. Their completion lives on /app/actions,
 * read through the same hook that page uses, unchanged.
 */
function ActionItemsWaiting() {
  const { open } = useMyActions();
  const n = open.length;
  if (n === 0) return null;
  return (
    <Link
      to="/app/actions"
      data-testid="action-items-waiting"
      className={`mb-6 flex min-h-[44px] items-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm ${QUIET_HOVER} ${FOCUS}`}
    >
      <ClipboardList aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 font-medium">You have {n} action item{n === 1 ? "" : "s"} waiting</span>
      <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
    </Link>
  );
}

/** Why some finished work is missing from Done: the page holds 100 items and lists open work first. */
function DoneUnlistedNote({ count }: { count: number }) {
  return (
    <p data-testid="done-unlisted" className="pt-2 text-sm text-muted-foreground">
      {count} finished item{count === 1 ? " isn't" : "s aren't"} listed here. This page shows up to {PORTAL_PROGRESS_LIMIT} items, open work first.
    </p>
  );
}

export default function Progress() {
  const progress = useClientPortalProgress();
  const brand = useClientPortalBrand();
  const businessName = brand?.tenant_name?.trim() || "your team";
  const tz = useMemo(viewerTimeZone, []);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  // The list re-reads on a poll; keep "now" in step with each fresh read.
  useEffect(() => { setNowMs(Date.now()); }, [progress.items]);

  const doneId = useId();
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  // The open Done list belongs to the signed-in identity.
  useEffect(() => { setDoneOpen(null); }, [progress.scopeEpoch]);

  const { groups, other } = useMemo(() => groupOpenWork(progress.items), [progress.items]);
  const done = useMemo(() => progress.items.filter((i) => i.state === "done"), [progress.items]);
  const hasOpen = groups.length > 0 || other.length > 0;
  const openCount = useMemo(() => progress.items.filter((i) => i.state !== "done").length, [progress.items]);
  // Next up summarises a longer list; when every open item would be in it, it is only a repeat.
  const nextUp = useMemo(() => {
    const picked = nextUpWork(progress.items);
    return picked.length < openCount ? picked : [];
  }, [progress.items, openCount]);
  // The milestone a Next up item sits under, so a lone task title still says where it belongs.
  const milestoneOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const i of g.open) m.set(i.id, g.milestone.title);
    return m;
  }, [groups]);
  // With nothing left open, the finished work is the page: show it unfolded.
  const showDone = doneOpen ?? !hasOpen;

  const summary = progress.summary;
  const blocked = progress.unavailable || progress.multipleBusinesses;
  const firstLoad = progress.loading && !summary;
  const empty = !!summary && summary.shared === 0;
  const allDone = !!summary && summary.shared > 0 && summary.open === 0;
  // Open work is listed first, so past the 100-item page some finished work can't be.
  const doneUnlisted = summary ? Math.max(0, summary.done - done.length) : 0;

  return (
    <section
      aria-labelledby="progress-title"
      aria-busy={progress.loading}
      className="mx-auto max-w-2xl [&_button]:min-h-[44px]"
    >
      <header className="space-y-1 pb-4">
        <h1 id="progress-title" className="text-2xl font-semibold tracking-tight">Progress</h1>
        {!blocked && summary && summary.shared > 0 && (
          <div data-testid="progress-summary" className="pt-1">
            {allDone ? (
              // The end state is the moment worth landing: one strong line, not a count and a sentence.
              <p data-testid="all-done" className="inline-flex items-start gap-2 text-xl font-semibold tracking-tight [text-wrap:balance]">
                <Check aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-success" />
                Everything {businessName} has shared with you is done.
              </p>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-semibold tracking-tight tabular-nums">{summary.done} of {summary.shared} done</span>
                {summary.overdue > 0 && (
                  <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
                    <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 self-center text-destructive" /> {summary.overdue} past due
                  </span>
                )}
              </p>
            )}
          </div>
        )}
        {!blocked && !allDone && <p className="text-sm text-muted-foreground">The work {businessName} is sharing with you.</p>}
      </header>

      {progress.error && !blocked && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {progress.error}
          </p>
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => void progress.refresh()}>Try again</Button>
        </div>
      )}

      {!blocked && <ActionItemsWaiting />}

      {progress.multipleBusinesses ? (
        <ProgressEmpty
          icon={ListChecks}
          title="Progress for more than one business isn't available yet"
          description={(
            <>
              Your account is connected to more than one business. Progress here works with one business at a time
              for now. For help in the meantime, use{" "}
              <Link to="/app/support" className={`font-medium text-foreground underline underline-offset-4 ${FOCUS}`}>Support</Link>.
            </>
          )}
          action={<BackHome />}
        />
      ) : progress.unavailable ? (
        <ProgressEmpty
          icon={ListChecks}
          title="Progress isn't available on this account"
          description="The work your business shares with you shows here once your account is connected to it. Sign in with the email your business invited."
          action={<BackHome />}
        />
      ) : firstLoad ? (
        <ProgressSkeleton />
      ) : !summary ? null : empty ? (
        <ProgressEmpty
          icon={ListChecks}
          title={`${businessName} hasn't shared any progress with you yet`}
          description={`When ${businessName} shares work with you, you'll see what's done, what's in progress and when it's due.`}
          action={(
            <Link to={MESSAGE_HREF} className={LINK_BUTTON}>
              <MessageSquare aria-hidden="true" className="h-4 w-4" /> Message {businessName}
            </Link>
          )}
        />
      ) : (
        <div className="space-y-8">
          {nextUp.length > 0 && (
            <section aria-labelledby="progress-next" data-testid="next-up" className="rounded-xl border border-border bg-card px-4">
              <h2 id="progress-next" className="pt-3 text-sm font-semibold">Next up</h2>
              <ol className="divide-y divide-border">
                {nextUp.map((i) => (
                  <li key={i.id}>
                    <ItemRow item={i} tz={tz} nowMs={nowMs} context={milestoneOf.get(i.id)} testId="next-up-item" />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {hasOpen && (
            <section aria-labelledby="progress-open">
              <h2 id="progress-open" className="mb-3 text-sm font-semibold text-muted-foreground">Open</h2>
              <ol className="space-y-3">
                {groups.map((g) => (
                  <GroupCard key={g.milestone.id} label={g.milestone.title}>
                    <ItemRow item={g.milestone} tz={tz} nowMs={nowMs} heading />
                    {g.open.length > 0 && (
                      <ol className="ml-4 divide-y divide-border border-t border-border sm:ml-7">
                        {g.open.map((i) => <li key={i.id}><ItemRow item={i} tz={tz} nowMs={nowMs} /></li>)}
                      </ol>
                    )}
                  </GroupCard>
                ))}
                {other.length > 0 && (
                  <GroupCard label="Other work">
                    <h3 className="pb-1 pt-3 text-base font-semibold">Other work</h3>
                    <ol className="divide-y divide-border">
                      {other.map((i) => <li key={i.id}><ItemRow item={i} tz={tz} nowMs={nowMs} /></li>)}
                    </ol>
                  </GroupCard>
                )}
              </ol>
            </section>
          )}

          {done.length === 0 && doneUnlisted > 0 && (
            <section aria-labelledby={`${doneId}-heading`}>
              <h2 id={`${doneId}-heading`} className="text-sm font-semibold text-muted-foreground">
                Done <span className="tabular-nums">({summary.done})</span>
              </h2>
              <DoneUnlistedNote count={doneUnlisted} />
            </section>
          )}

          {done.length > 0 && (
            <section aria-labelledby={`${doneId}-heading`}>
              <h2 id={`${doneId}-heading`} className="text-sm font-semibold text-muted-foreground">
                <button
                  type="button"
                  aria-expanded={showDone}
                  aria-controls={doneId}
                  onClick={() => setDoneOpen(!showDone)}
                  className={`-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 hover:text-foreground ${FOCUS}`}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform motion-reduce:transition-none ${showDone ? "rotate-180" : ""}`}
                  />
                  Done <span className="tabular-nums">({summary.done})</span>
                </button>
              </h2>
              <div id={doneId} hidden={!showDone} className="pt-1">
                <ol className="divide-y divide-border">
                  {done.map((i) => (
                    <li key={i.id}>
                      <ItemRow item={i} tz={tz} nowMs={nowMs} showState={false} gutter={done.some((d) => d.kind === "milestone")} />
                    </li>
                  ))}
                </ol>
                {doneUnlisted > 0 && <DoneUnlistedNote count={doneUnlisted} />}
              </div>
            </section>
          )}

          {progress.hasMore && (
            <p className="text-sm text-muted-foreground">
              Showing the first {progress.items.length} of {summary.shared} shared items.
            </p>
          )}
        </div>
      )}

      {!blocked && summary && !empty && (
        <footer className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-1">
            <span>{businessName} updates this list. Questions?</span>
            <Link
              to={MESSAGE_HREF}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium text-foreground underline underline-offset-4 ${FOCUS}`}
            >
              Message {businessName}
            </Link>
          </p>
        </footer>
      )}
    </section>
  );
}
