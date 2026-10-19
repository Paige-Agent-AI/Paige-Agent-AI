import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyTile } from "@/components/client/EmptyTile";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { sessionTiming, useNextPortalSession, type PortalSession } from "@/hooks/useClientPortalSessions";
import {
  isProgressPastDue,
  progressDayKey,
  progressDayLabel,
  usePortalProgressGlance,
  viewerTimeZone,
  type PortalProgressItem,
  type PortalProgressSummary,
} from "@/hooks/useClientPortalProgress";
import { useMyActions } from "@/hooks/useMyActions";
import { usePortalDocumentsGlance, type PortalDocumentsGlance } from "@/hooks/usePortalDocumentsGlance";
import { AgreementsWaitingLine } from "@/components/client/AgreementsWaitingLine";
import {
  Target,
  TrendingUp,
  DollarSign,
  FileText,
  MessageSquare,
  ListChecks,
  ClipboardList,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  Lock,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

// Some of these tables are not in the generated types; count them through an untyped view of the same client.
const untypedDb = supabase as unknown as SupabaseClient;

/**
 * The shared outline/ghost buttons hover-fill with --secondary, near-black in light theme under a
 * dark label (1.01:1). These hover to muted with the label in foreground instead (pinned in the test).
 */
const TILE_QUIET_HOVER = "hover:bg-muted hover:text-foreground";
/**
 * The neighbouring tiles' buttons are 36px (size sm). These match that height and keep a 44px touch
 * target with an invisible extension above and below.
 */
const TILE_BUTTON = `relative h-9 after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-[''] ${TILE_QUIET_HOVER}`;

type Counts = {
  goals: number | null;
  creditPulls: number | null;
  applications: number | null;
  messages: number | null;
};

const EMPTY: Counts = {
  goals: null,
  creditPulls: null,
  applications: null,
  messages: null,
};

/**
 * Client-view home tiles. Zero seeded content — each tile renders real counts
 * or a single-action EmptyTile CTA that routes to the flow that produces
 * the missing data. Six tiles: Goals, Progress (or Credit), Sessions (or Funding),
 * Documents, Messages, Next Steps.
 */
export function ClientHomeTiles({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const pb = usePlaybook();
  // The business this customer belongs to (one business only; several is Slice 8). Its name, never
  // "your coach" — the audience is every client-based business, not coaching alone (§2).
  const { brand, loading: brandLoading, error: brandError, multipleBusinesses } = useClientPortalBrandState();
  const isCustomer = !brandLoading && !brandError && !!brand?.tenant_id && !multipleBusinesses;
  const businessName = brand?.tenant_name?.trim() || "your team";
  const next = useNextPortalSession(isCustomer);
  const progress = usePortalProgressGlance(isCustomer);
  const documents = usePortalDocumentsGlance(isCustomer);
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    (async () => {
      setLoading(true);
      const headOnly = { count: "exact" as const, head: true };
      // Documents are counted from the customer's own Documents read (usePortalDocumentsGlance), not here.
      const [goals, credit, apps, msgs] = await Promise.all([
        untypedDb.from("client_goals").select("id", headOnly).eq("user_id", userId),
        untypedDb.from("credit_report_uploads").select("id", headOnly).eq("user_id", userId),
        untypedDb.from("funding_journey_applications").select("id", headOnly).eq("user_id", userId),
        untypedDb.from("chat_messages").select("id", headOnly).eq("user_id", userId),
      ]);
      if (cancelled) return;
      setCounts({
        goals: goals.count ?? 0,
        creditPulls: credit.count ?? 0,
        applications: apps.count ?? 0,
        messages: msgs.count ?? 0,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const askPaige = (prompt: string) => {
    window.dispatchEvent(new CustomEvent("paige:prefill", { detail: { prompt } }));
  };

  // Coaching default shows coaching-only tiles. The credit/funding tiles render
  // ONLY when the client actually has that data on file (the query-result signal
  // already loaded above) — a coaching client never sees credit/funding copy.
  const coachName = pb.persona.name;
  const nextStepsPrompt = pb.quickActions[0]?.prompt ?? "What should I focus on next?";
  const bookPrompt = pb.quickActions[1]?.prompt ?? "Help me schedule my next session";
  const progressPrompt = pb.quickActions[2]?.prompt ?? "Show me how I'm progressing toward my goals";
  const hasCredit = (counts.creditPulls ?? 0) > 0;
  const hasFunding = (counts.applications ?? 0) > 0;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* E09 Slice A — one quiet line, only while an agreement waits for this customer's signature (D-A5). */}
      <AgreementsWaitingLine enabled={isCustomer} />
      {/* 1. Goals */}
      {counts.goals && counts.goals > 0 ? (
        <FilledTile
          icon={<Target className="w-4 h-4" />}
          title="Your Goals"
          count={counts.goals}
          label="active"
          onClick={() => navigate("/app/settings")}
        />
      ) : (
        <EmptyTile
          icon={<Target className="w-6 h-6" />}
          title="Set your first goal"
          description="Tell Paige what you're building toward and she'll map the path."
          actionLabel="Set your first goal"
          onAction={() => askPaige("Help me set my first goal.")}
        />
      )}

      {/* 2. Progress — the work the business shared; the credit tile only when the client has credit data */}
      {hasCredit ? (
        <FilledTile
          icon={<TrendingUp className="w-4 h-4" />}
          title="Credit"
          count={counts.creditPulls as number}
          label="reports on file"
          onClick={() => navigate("/app/credit")}
        />
      ) : isCustomer && progress.state !== "unavailable" ? (
        <ProgressTile glance={progress} businessName={businessName} />
      ) : (
        <EmptyTile
          icon={<TrendingUp className="w-6 h-6" />}
          title="Your progress"
          description={`See how you're tracking toward your goals — ask ${coachName} for a snapshot.`}
          actionLabel="Show my progress"
          onAction={() => askPaige(progressPrompt)}
        />
      )}

      {/* 3. Sessions — funding tile only when the client has applications */}
      {hasFunding ? (
        <FilledTile
          icon={<DollarSign className="w-4 h-4" />}
          title="Funding"
          count={counts.applications as number}
          label="applications"
          onClick={() => navigate("/app/funding-journey")}
        />
      ) : next.state === "session" ? (
        // The tile this replaced asked Paige to book a session; that stays, as the second action (§58).
        <NextSessionTile session={next.session} onBook={() => askPaige(bookPrompt)} />
      ) : next.state === "none" ? (
        <NoSessionTile
          businessName={businessName}
          onMessage={() => navigate("/app/messages")}
          onBook={() => askPaige(bookPrompt)}
        />
      ) : next.state === "loading" && isCustomer ? (
        <div className="h-32 rounded-lg bg-muted/30 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <EmptyTile
          icon={<CalendarCheck className="w-6 h-6" />}
          title="Book a session"
          description={`Grab a time with ${businessName} and keep your momentum going.`}
          actionLabel="Book a session"
          onAction={() => askPaige(bookPrompt)}
        />
      )}

      {/* 4. Documents — the same reads as /app/documents (E09 Slice 4) */}
      {isCustomer && documents.state !== "unavailable" ? (
        <DocumentsTile glance={documents} businessName={businessName} />
      ) : (
        <EmptyTile
          icon={<FileText className="w-6 h-6" />}
          title="No documents yet"
          description={`Files ${businessName} shares with you, and documents you send them, live in Documents.`}
          actionLabel="Open documents"
          onAction={() => navigate("/app/documents")}
        />
      )}

      {/* 5. Messages */}
      {counts.messages && counts.messages > 0 ? (
        <FilledTile
          icon={<MessageSquare className="w-4 h-4" />}
          title={`Message ${coachName}`}
          count={counts.messages}
          label="in your thread"
          onClick={() => askPaige("Show me my recent messages.")}
        />
      ) : (
        <EmptyTile
          icon={<MessageSquare className="w-6 h-6" />}
          title={`Message ${coachName}`}
          // The action puts a question in Paige's own chat; it does not message the business (that is Messages).
          description={`Ask ${coachName} a question anytime.`}
          actionLabel="Send your first message"
          onAction={() => askPaige(`Hi ${coachName} — I'd like to introduce myself.`)}
        />
      )}

      {/* 6. Next Steps — the customer's open action items from their business */}
      {isCustomer ? (
        <NextStepsTile
          businessName={businessName}
          onAsk={() => askPaige(nextStepsPrompt)}
          askLabel={`Ask ${coachName} what's next`}
        />
      ) : (
        <EmptyTile
          icon={<ClipboardList className="w-6 h-6" />}
          title="Your next steps"
          description={`Your action list fills in as ${businessName} sends you action items.`}
          actionLabel={`Ask ${coachName} what's next`}
          onAction={() => askPaige(nextStepsPrompt)}
        />
      )}
    </div>
  );
}

/**
 * A tile that is one link: the whole card opens `to`, so it is reachable and operable by keyboard.
 * Data reads top-down — the headline is the reading, the detail line says what it means, an optional
 * line names what comes next — and the "Open …" row is anchored to the bottom edge, so it lines up
 * with its neighbour's in the same row whatever each tile holds.
 */
function LinkTile({ to, testId, icon, title, headline, detail, next, openLabel, failed = false, quiet = false, dashed = false }: {
  to: string; testId: string; icon: React.ReactNode; title: string; headline: React.ReactNode; detail: React.ReactNode;
  next?: React.ReactNode; openLabel: string;
  /** A failed read: the headline says so at a smaller step, so it never reads as a figure. */
  failed?: boolean;
  /** Nothing to count yet: a sentence, not a figure, so it never outweighs real data. */
  quiet?: boolean; dashed?: boolean;
}) {
  return (
    <Card className={`flex h-full flex-col transition-colors hover:border-foreground/30 motion-reduce:transition-none ${dashed ? "border-dashed" : ""}`}>
      <Link
        to={to}
        data-testid={testId}
        className="group flex min-h-[44px] flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col pb-4">
          <div
            data-testid={`${testId}-headline`}
            className={failed || quiet ? "text-lg font-semibold tracking-tight" : "text-2xl font-bold tracking-tight tabular-nums"}
          >
            {headline}
          </div>
          <div data-testid={`${testId}-detail`} className="mt-1 text-sm text-muted-foreground">{detail}</div>
          {next && <div data-testid={`${testId}-next`} className="mt-3 text-sm text-muted-foreground">{next}</div>}
          <span
            data-testid={`${testId}-open`}
            className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-foreground underline-offset-4 group-hover:underline"
          >
            {openLabel}
            <ArrowRight
              className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              aria-hidden="true"
            />
          </span>
        </CardContent>
      </Link>
    </Card>
  );
}

/** "Next: Review the moodboard · due today", in the viewer's own zone. */
function NextLine({ item }: { item: PortalProgressItem }) {
  const nowMs = Date.now();
  const tz = viewerTimeZone();
  const due = item.due_at as string;
  const when = isProgressPastDue(item, nowMs)
    ? "past due"
    : progressDayKey(Date.parse(due), tz) === progressDayKey(nowMs, tz) ? "due today" : `due ${progressDayLabel(due, tz, nowMs)}`;
  return (
    <span className="line-clamp-2 break-words">
      Next: <span className="font-medium text-foreground">{item.title}</span> · {when}
    </span>
  );
}

function TileSkeleton({ testId }: { testId: string }) {
  return <div data-testid={testId} className="h-32 rounded-lg bg-muted/30 animate-pulse motion-reduce:animate-none" aria-hidden="true" />;
}

type ProgressGlance = Exclude<ReturnType<typeof usePortalProgressGlance>, { state: "unavailable" }>;

/**
 * How much of the work the business shared is done, from the same read as /app/progress; opens it.
 * Nothing shared yet says so plainly. A failed read never shows as zero.
 */
function ProgressTile({ glance, businessName }: { glance: ProgressGlance; businessName: string }) {
  if (glance.state === "loading") return <TileSkeleton testId="progress-tile-loading" />;
  const summary: PortalProgressSummary | null = glance.state === "ready" ? glance.summary : null;
  const next = glance.state === "ready" ? glance.next : null;
  const none = summary?.shared === 0;
  return (
    <LinkTile
      to="/app/progress"
      testId="progress-tile"
      icon={<ListChecks className="w-4 h-4" aria-hidden="true" />}
      title="Your progress"
      dashed={none}
      failed={!summary}
      quiet={none}
      openLabel="Open progress"
      headline={!summary ? "Couldn't check right now" : none ? "Nothing shared yet" : `${summary.done} of ${summary.shared} done`}
      next={next ? <NextLine item={next} /> : undefined}
      detail={!summary
        ? "Open Progress to try again."
        : none
          ? `When ${businessName} shares work with you, you'll see where it stands here.`
          : summary.overdue > 0
            ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />{summary.overdue} past due
              </span>
            )
            : summary.open > 0 ? `${summary.open} still open` : "Everything shared is done"}
    />
  );
}

type DocumentsGlance = Exclude<PortalDocumentsGlance, { state: "unavailable" }>;

/**
 * What is in the customer's Documents: work waiting for their review leads, then files shared with them
 * and their own uploads. Opens /app/documents. A failed read never shows as zero.
 */
function DocumentsTile({ glance, businessName }: { glance: DocumentsGlance; businessName: string }) {
  if (glance.state === "loading") return <TileSkeleton testId="documents-tile-loading" />;
  const ready = glance.state === "ready" ? glance : null;
  const none = ready ? ready.shared + ready.fromYou + ready.awaitingReview === 0 : false;
  const files = ready ? ready.shared + ready.fromYou : 0;
  return (
    <LinkTile
      to="/app/documents"
      testId="documents-tile"
      icon={<FileText className="w-4 h-4" aria-hidden="true" />}
      title="Documents"
      dashed={none}
      failed={!ready}
      quiet={none}
      openLabel="Open documents"
      headline={!ready ? "Couldn't check right now"
        : none ? "Nothing here yet"
          : ready.awaitingReview > 0 ? `${ready.awaitingReview}${ready.awaitingReviewMore ? "+" : ""} awaiting your review`
            : `${files} ${files === 1 ? "file" : "files"}`}
      detail={!ready
        ? "Open Documents to try again."
        : none
          ? `Files ${businessName} shares with you will appear here. You can upload documents for them too.`
          : [ready.shared > 0 ? `${ready.shared} shared by ${businessName}` : null, ready.fromYou > 0 ? `${ready.fromYou} from you` : null]
            .filter(Boolean).join(" · ") || "No files yet"}
    />
  );
}

/**
 * The customer's open action items from their business, from the same read as /app/actions (unchanged).
 * Asking Paige what's next stays, as the old tile offered it (§58). A failed read never shows as zero.
 */
function NextStepsTile({ businessName, onAsk, askLabel }: { businessName: string; onAsk: () => void; askLabel: string }) {
  const { open, loading, error } = useMyActions();
  if (loading && open.length === 0) return <TileSkeleton testId="next-steps-loading" />;
  if (open.length > 0 || error) {
    const n = open.length;
    return (
      <LinkTile
        to="/app/actions"
        testId="next-steps-tile"
        icon={<ClipboardList className="w-4 h-4" aria-hidden="true" />}
        title="Your next steps"
        failed={error !== null && n === 0}
        openLabel="Open action items"
        headline={error && n === 0 ? "Couldn't check right now" : `${n} waiting`}
        detail={error && n === 0
          ? "Open your action items to try again."
          : `${n === 1 ? "An action item" : "Action items"} from ${businessName}`}
      />
    );
  }
  return (
    <EmptyTile
      icon={<ClipboardList className="w-6 h-6" />}
      title="Your next steps"
      description={`When ${businessName} sends you an action item, it shows up here.`}
      actionLabel={askLabel}
      onAction={onAsk}
    />
  );
}

/** "Book a session" as the tile it came from offered it: Paige is asked to set up a time. */
function BookAction({ onBook }: { onBook: () => void }) {
  return (
    <Button size="sm" variant="ghost" className={TILE_BUTTON} onClick={onBook}>
      <CalendarCheck className="mr-1.5 h-4 w-4" aria-hidden="true" /> Book a session
    </Button>
  );
}

function viewerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/**
 * The soonest upcoming session, in the viewer's own time zone; opens Sessions. Booking stays one tap away.
 * The headline is how near it is, in the Sessions page's own words (Happening now · Today · in 45 min ·
 * Tomorrow), and the date when it is further out; it says when changes have closed.
 */
function NextSessionTile({ session, onBook }: { session: PortalSession; onBook: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const when = new Date(session.start_at);
  const day = when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const timing = sessionTiming(session, nowMs, viewerZone());
  const relative = timing && timing.label !== "Ended" ? timing : null;
  const closed = session.status === "scheduled" && session.change.reason === "WINDOW_CLOSED";
  return (
    <Card className="flex h-full flex-col transition-colors hover:border-foreground/30 motion-reduce:transition-none">
      <Link
        to="/app/sessions"
        className="group block min-h-[44px] flex-1 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="w-4 h-4" aria-hidden="true" />
            Next session
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div data-testid="next-session-headline" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {relative?.tone === "live" && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />}
            <time dateTime={session.start_at}>{relative ? relative.label : day}</time>
          </div>
          {/* A relative headline already says the day, so the detail is the time alone and the
              title gets a line of its own: on a phone it must never be cut off. */}
          <div className="mt-1 flex items-start justify-between gap-2 text-sm text-muted-foreground">
            <span className="min-w-0">
              <span data-testid="next-session-when" className="block">{relative ? time : `${day}, ${time}`}</span>
              <span data-testid="next-session-title" className="block line-clamp-2 text-foreground">{session.title}</span>
            </span>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </div>
          {closed && (
            <p data-testid="next-session-closed" className="mt-1 inline-flex items-center gap-1.5 text-sm text-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> Changes closed
            </p>
          )}
        </CardContent>
      </Link>
      {/* px-3 + the button's own 12px puts its icon on the card's 24px content edge. */}
      <div data-testid="next-session-footer" className="border-t border-border px-3 py-1">
        <BookAction onBook={onBook} />
      </div>
    </Card>
  );
}

/** Nothing booked yet: message the business, or ask Paige to book a time, as the old tile did. */
function NoSessionTile({ businessName, onMessage, onBook }: { businessName: string; onMessage: () => void; onBook: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center text-center py-8 px-6">
        <div className="mb-3 text-muted-foreground/70"><CalendarClock className="w-6 h-6" aria-hidden="true" /></div>
        <div className="text-sm font-medium">No upcoming sessions</div>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          When {businessName} books a time with you, it shows up in Sessions.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" className={TILE_BUTTON} onClick={onMessage}>Message {businessName}</Button>
          <BookAction onBook={onBook} />
        </div>
      </CardContent>
    </Card>
  );
}

function FilledTile({
  icon,
  title,
  count,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:border-accent/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{count}</span>
          <Badge variant="outline" className="text-xs">
            {label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
