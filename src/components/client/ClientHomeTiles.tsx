import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyTile } from "@/components/client/EmptyTile";
import { supabase } from "@/integrations/supabase/client";
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { sessionTiming, useNextPortalSession, type PortalSession } from "@/hooks/useClientPortalSessions";
import {
  Target,
  TrendingUp,
  DollarSign,
  FileText,
  MessageSquare,
  ListChecks,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  Lock,
} from "lucide-react";

/**
 * The shared outline/ghost buttons hover-fill with --secondary, near-black in light theme under a
 * dark label (1.01:1). These hover to muted with the label in foreground instead (pinned in the test).
 */
const TILE_QUIET_HOVER = "hover:bg-muted hover:text-foreground";
/**
 * The neighbouring tiles' buttons are 36px (size sm). These match that height and keep a 44px touch
 * target with an invisible extension above and below.
 */
const TILE_BUTTON = `relative h-9 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] ${TILE_QUIET_HOVER}`;

type Counts = {
  goals: number | null;
  creditPulls: number | null;
  applications: number | null;
  documents: number | null;
  messages: number | null;
  nextSteps: number | null;
};

const EMPTY: Counts = {
  goals: null,
  creditPulls: null,
  applications: null,
  documents: null,
  messages: null,
  nextSteps: null,
};

/**
 * Client-view home tiles. Zero seeded content — each tile renders real counts
 * or a single-action EmptyTile CTA that routes to the flow that produces
 * the missing data. Six tiles: Goals, Credit, Funding, Documents, Messages,
 * Next Steps.
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
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    (async () => {
      setLoading(true);
      const headOnly = { count: "exact" as const, head: true };
      const [goals, credit, apps, docs, msgs, tasks] = await Promise.all([
        supabase.from("client_goals" as any).select("id", headOnly).eq("user_id", userId),
        supabase.from("credit_report_uploads" as any).select("id", headOnly).eq("user_id", userId),
        supabase.from("funding_journey_applications" as any).select("id", headOnly).eq("user_id", userId),
        supabase.from("documents" as any).select("id", headOnly).eq("user_id", userId),
        supabase.from("chat_messages" as any).select("id", headOnly).eq("user_id", userId),
        supabase
          .from("tasks" as any)
          .select("id", headOnly)
          .eq("assigned_to", userId)
          .neq("status", "completed"),
      ]);
      if (cancelled) return;
      setCounts({
        goals: goals.count ?? 0,
        creditPulls: credit.count ?? 0,
        applications: apps.count ?? 0,
        documents: docs.count ?? 0,
        messages: msgs.count ?? 0,
        nextSteps: tasks.count ?? 0,
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

      {/* 2. Progress (coaching) — credit tile only when the client has credit data */}
      {hasCredit ? (
        <FilledTile
          icon={<TrendingUp className="w-4 h-4" />}
          title="Credit"
          count={counts.creditPulls as number}
          label="reports on file"
          onClick={() => navigate("/app/credit")}
        />
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

      {/* 4. Documents */}
      {counts.documents && counts.documents > 0 ? (
        <FilledTile
          icon={<FileText className="w-4 h-4" />}
          title="Documents"
          count={counts.documents}
          label="uploaded"
          onClick={() => navigate("/app/business")}
        />
      ) : (
        <EmptyTile
          icon={<FileText className="w-6 h-6" />}
          title="No documents yet"
          description={`Keep your important files in one place so ${coachName} can reference them when you need them.`}
          actionLabel="Upload your first document"
          onAction={() => navigate("/app/business")}
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

      {/* 6. Next Steps — already dynamic via tasks table */}
      {counts.nextSteps && counts.nextSteps > 0 ? (
        <FilledTile
          icon={<ListChecks className="w-4 h-4" />}
          title="Your next steps"
          count={counts.nextSteps}
          label="open"
          onClick={() => askPaige(nextStepsPrompt)}
        />
      ) : (
        <EmptyTile
          icon={<ListChecks className="w-6 h-6" />}
          title="Your next steps"
          description={`Your action list fills in as ${coachName} assigns coached tasks.`}
          actionLabel={`Ask ${coachName} what's next`}
          onAction={() => askPaige(nextStepsPrompt)}
        />
      )}
    </div>
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
