/**
 * /app/sessions — the customer's sessions with their business (E09 Slice 2).
 *
 * Only the customer's own sessions, never anyone else's, and never who the host is. A session can
 * be moved or cancelled here only while its calendar's notice window is open; the change itself is
 * made by the business's own booking engine, which re-checks the window and the open times and
 * sends the business's notifications. A change shows as done only once that engine answered.
 * There is no new booking from here: a customer who wants a time messages the business.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, ArrowRight, CalendarClock, Check, CalendarX2, ChevronDown, Clock, Home, Loader2, Lock, MapPin, MessageSquare,
  Phone, RotateCw, Video, type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DAY_MS,
  dayKeyIn,
  fetchRescheduleSlots,
  portalSessionChangeCopy,
  refusalWayOut,
  sessionTiming,
  untilLabel,
  useClientPortalSessions,
  type PortalLocationKind,
  type PortalSession,
  type SessionChange,
} from "@/hooks/useClientPortalSessions";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { readableTextOn } from "@/lib/brand/contrast";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

type Accent = CSSProperties | undefined;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/**
 * The shared outline and ghost buttons hover-fill with --secondary, which is near-black in light
 * theme under a dark label (1.01:1). Every quiet button here hovers to muted instead, with the
 * label in foreground: 15.95:1 light, 15.77:1 dark (pinned in Sessions.test.tsx).
 */
const QUIET_HOVER = "hover:bg-muted hover:text-foreground";
const LINK_BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium ${QUIET_HOVER} ${FOCUS}`;
/** Picker choices: the chosen one in inverse fill (ink on canvas), which reads in both themes. */
const SELECTED = "border-foreground bg-foreground text-background";
const UNSELECTED = "border-border hover:bg-muted";

function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function safeZone(tz: string): string {
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; }
}

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: safeZone(tz), ...opts }).format(new Date(iso));
}

const dayLabel = (iso: string, tz: string) => fmt(iso, tz, { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (iso: string, tz: string) => fmt(iso, tz, { hour: "numeric", minute: "2-digit" });
const zoneLabel = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: safeZone(tz), timeZoneName: "short" })
    .formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? tz;

/** "2:00 – 3:00 PM EDT" in the given zone. */
function timeRange(start: string, end: string, tz: string): string {
  return `${timeLabel(start, tz)} – ${timeLabel(end, tz)} ${zoneLabel(start, tz)}`;
}

function whenLabel(iso: string, tz: string): string {
  return `${dayLabel(iso, tz)}, ${timeLabel(iso, tz)}`;
}

/** "Mon 9:00 AM". */
const shortWhen = (iso: string, tz: string) => `${fmt(iso, tz, { weekday: "short" })} ${timeLabel(iso, tz)}`;

/** A city-like name for an IANA zone: "America/New_York" → "New York". */
function placeOf(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

/** The booking's own time, only when it reads differently from the viewer's. */
function otherZoneLine(s: PortalSession, viewerTz: string): string | null {
  if (!s.timezone || s.timezone === viewerTz) return null;
  const mine = `${dayLabel(s.start_at, viewerTz)} ${timeRange(s.start_at, s.end_at, viewerTz)}`;
  const theirs = `${dayLabel(s.start_at, s.timezone)} ${timeRange(s.start_at, s.end_at, s.timezone)}`;
  if (mine === theirs) return null;
  const day = dayLabel(s.start_at, s.timezone) !== dayLabel(s.start_at, viewerTz) ? `${dayLabel(s.start_at, s.timezone)}, ` : "";
  return `${day}${timeRange(s.start_at, s.end_at, s.timezone)} in ${placeOf(s.timezone)} time`;
}

const dayKey = dayKeyIn;

type Pill = { label: string; tone: "live" | "plain" | "muted" };

/** Past sessions say how they ended. */
function pastPill(s: PortalSession, nowMs: number): Pill {
  if (s.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (s.status === "no_show") return { label: "Missed", tone: "muted" };
  if (s.status === "done" || s.status === "completed") return { label: "Completed", tone: "plain" };
  if (Date.parse(s.end_at) < nowMs) return { label: "Ended", tone: "plain" };
  return { label: "Scheduled", tone: "plain" };
}

/** Upcoming sessions carry a pill only when time makes it worth reading: now, today, tomorrow (same wording as the home tile). */
const upcomingPill = (s: PortalSession, nowMs: number, tz: string): Pill | null => sessionTiming(s, nowMs, tz);

function StatusPill({ pill }: { pill: Pill }) {
  const { label, tone } = pill;
  const cls = tone === "live"
    ? "border-success/40 bg-success/10 text-foreground"
    : tone === "muted" ? "border-border text-muted-foreground" : "border-border text-foreground";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {tone === "live" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />}
      {label}
    </span>
  );
}

const LOCATION_ICON: Record<NonNullable<PortalLocationKind>, LucideIcon> = {
  video: Video, phone: Phone, in_person: MapPin, tbd: MapPin,
};

/** The first read: the Upcoming heading and two cards the size of real ones, so nothing jumps when they land. */
function UpcomingSkeleton() {
  return (
    <div role="status" data-testid="sessions-skeleton">
      <span className="sr-only">Loading your sessions…</span>
      <p aria-hidden="true" className="mb-3 text-sm font-semibold text-muted-foreground">Upcoming</p>
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} data-testid="session-skeleton-card" className="rounded-xl border border-border bg-card p-4">
            <div className="flex gap-4">
              <Skeleton className="h-16 w-14 shrink-0 rounded-lg motion-reduce:animate-none" />
              <div className="flex-1 space-y-2 pt-0.5">
                <Skeleton className="h-5 w-1/2 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-1/4 motion-reduce:animate-none" />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
              <Skeleton className="h-11 w-full rounded-md motion-reduce:animate-none sm:w-52" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Past sessions load as compact rows, matching what replaces them. */
function PastSkeleton() {
  return (
    <div role="status" className="divide-y divide-border border-y border-border">
      <span className="sr-only">Loading past sessions…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function MessageLink({ businessName, children, className = "" }: { businessName: string; children?: string; className?: string }) {
  return (
    <Link to="/app/messages" className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium underline underline-offset-4 ${FOCUS} ${className}`}>
      <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" /> {children ?? `Message ${businessName}`}
    </Link>
  );
}

/** One empty-state treatment for an empty list and for an account that cannot use the page. */
function SessionsEmpty(props: { icon: LucideIcon; title: string; description: ReactNode; action: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <EmptyState icon={props.icon} title={props.title} description={<span className="[text-wrap:balance]">{props.description}</span>} action={props.action} className="py-10" />
    </div>
  );
}

/** A refusal's words beside its icon; a wrapped line starts under the words, not under the icon. */
function RefusalText({ children }: { children: ReactNode }) {
  return (
    <p data-testid="refusal-text" className="flex items-start gap-1.5 text-sm [text-wrap:pretty]">
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ChangeNotice({
  change, session, businessName, viewerTz, onRetry, onDismiss, onPickAnother,
}: {
  change: SessionChange;
  session: PortalSession;
  businessName: string;
  viewerTz: string;
  onRetry: () => void;
  onDismiss: () => void;
  onPickAnother: () => void;
}) {
  if (change.status === "sending") {
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {change.action === "cancel"
          ? "Cancelling…"
          : `Moving to ${change.start ? whenLabel(change.start, viewerTz) : "the new time"}…`}
      </p>
    );
  }
  const failed = change.status === "failed";
  const wayOut = failed ? refusalWayOut(change.error) : "retry";
  return (
    <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 px-3 py-2.5">
      <RefusalText>
        {failed
          ? portalSessionChangeCopy(change.error)
          : `We couldn't confirm ${change.action === "cancel" ? "the cancellation" : "the new time"}. Retrying won't change it twice.`}
      </RefusalText>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[22px]">
        {wayOut === "retry" ? (
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={onRetry}>
            <RotateCw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> {failed ? "Try again" : "Retry"}
          </Button>
        ) : wayOut === "pick" && session.change.can_reschedule ? (
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={onPickAnother}>Pick another time</Button>
        ) : wayOut === "message" ? (
          <MessageLink businessName={businessName} />
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className={`min-h-[44px] rounded-md px-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${FOCUS}`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * "You can change this until Mon, Oct 19, 8:00 AM", or within a day "Changes close in 3 hrs". Beside
 * three actions on a wide screen it says "Change until …" so it stays on one line.
 */
function DeadlineLine({ deadline, nowMs, viewerTz, cancelOnly, compact }: {
  deadline: string; nowMs: number; viewerTz: string; cancelOnly: boolean; compact: boolean;
}) {
  const left = Date.parse(deadline) - nowMs;
  const absolute = whenLabel(deadline, viewerTz);
  const text = left <= 0
    ? "Changes close any moment now"
    : left < DAY_MS ? `Changes close in ${untilLabel(left)}` : null;
  return (
    <p className="text-sm text-foreground sm:min-w-0 sm:flex-1">
      <time dateTime={deadline} title={absolute}>
        {text ?? (
          // Break before the date, never inside it.
          <>
            {compact ? (
              <>
                <span className="sm:hidden">You can {cancelOnly ? "cancel" : "change"} this until </span>
                <span data-testid="deadline-short" className="hidden sm:inline">{cancelOnly ? "Cancel" : "Change"} until </span>
              </>
            ) : <>You can {cancelOnly ? "cancel" : "change"} this until </>}
            <span className="whitespace-nowrap">{absolute}</span>
          </>
        )}
      </time>
    </p>
  );
}

/** One line, lock first: why this session can't be changed here, and the way out on the same row. */
function ClosedLine({ session, nowMs, viewerTz, businessName }: { session: PortalSession; nowMs: number; viewerTz: string; businessName: string }) {
  const { deadline, reason } = session.change;
  let text: string;
  if (reason === "WINDOW_CLOSED") {
    text = !deadline
      ? "Changes are closed"
      : dayKey(Date.parse(deadline), viewerTz) === dayKey(nowMs, viewerTz)
        ? `Changes closed at ${timeLabel(deadline, viewerTz)}`
        : `Changes closed ${whenLabel(deadline, viewerTz)}`;
  } else {
    text = "This session can't be changed here";
  }
  return (
    // One unit: on a phone the link sits directly under the words, indented past the lock, with no
    // second 44px row of air between them; on a wide screen both share one line.
    <div data-testid="closed-line" className="flex flex-col items-start text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <p className="inline-flex items-center gap-1.5 pt-1 text-foreground sm:min-h-[44px] sm:pt-0">
        <Lock aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        {deadline && reason === "WINDOW_CLOSED" ? <time dateTime={deadline}>{text}</time> : text}
      </p>
      <MessageLink businessName={businessName} className="-mt-1.5 ml-[22px] sm:mt-0 sm:ml-0" />
    </div>
  );
}

function SessionRow({
  session, change, businessName, viewerTz, nowMs, accent, onReschedule, onCancel, onRetry, onDismiss,
}: {
  session: PortalSession;
  change: SessionChange | undefined;
  businessName: string;
  viewerTz: string;
  nowMs: number;
  accent: Accent;
  onReschedule: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const s = session;
  const titleId = useId();
  const busy = change?.status === "sending";
  const scheduled = s.status === "scheduled";
  const other = otherZoneLine(s, viewerTz);
  const pill = upcomingPill(s, nowMs, viewerTz);
  // A refusal whose way out is a message hides this session's own changes until it is dismissed or the list re-reads.
  const held = change?.status === "failed" && change.actionsHeld === true;
  const showJoin = scheduled && !!s.location.join_url;
  // Join leads only when it is the thing to do now: an online session that is today or under way.
  const joinLeads = showJoin && (pill?.tone === "live" || (pill?.label.startsWith("Today") ?? false));
  const canReschedule = scheduled && s.change.can_reschedule && !held;
  const canCancel = scheduled && s.change.can_cancel && !held;
  const reason = scheduled && !held ? s.change.reason : null;
  const closed = reason === "WINDOW_CLOSED" || reason === "NO_CALENDAR";
  const LocationIcon = LOCATION_ICON[s.location.kind ?? "tbd"];
  const dateParts = {
    weekday: fmt(s.start_at, viewerTz, { weekday: "short" }),
    day: fmt(s.start_at, viewerTz, { day: "numeric" }),
    month: fmt(s.start_at, viewerTz, { month: "short" }),
  };

  const info = closed
    ? <ClosedLine session={s} nowMs={nowMs} viewerTz={viewerTz} businessName={businessName} />
    : (canCancel || canReschedule) && s.change.deadline
      ? (
        <DeadlineLine
          deadline={s.change.deadline}
          nowMs={nowMs}
          viewerTz={viewerTz}
          cancelOnly={!canReschedule}
          compact
        />
      )
      : null;
  // Below 640px the actions sit on a two-column grid; Cancel takes a row of its own, on the same left edge.
  const actions = [
    showJoin && (
      <a
        key="join"
        href={s.location.join_url!}
        target="_blank"
        rel="noopener noreferrer"
        style={joinLeads ? accent : undefined}
        className={joinLeads
          ? cn(buttonVariants({ variant: "default" }), "min-h-[44px] motion-reduce:transform-none motion-reduce:transition-none", accent && "dark:ring-1 dark:ring-foreground/30")
          : LINK_BUTTON}
      >
        <Video aria-hidden="true" className="h-4 w-4" /> Join<span className="sr-only"> {s.title} (opens in a new tab)</span>
      </a>
    ),
    canReschedule && (
      <Button key="reschedule" variant="outline" className={QUIET_HOVER} onClick={onReschedule} disabled={busy} aria-describedby={titleId}>
        <CalendarClock aria-hidden="true" className="mr-1.5 h-4 w-4" /> Reschedule
      </Button>
    ),
    canCancel && (
      <Button
        key="cancel"
        variant="ghost"
        onClick={onCancel}
        disabled={busy}
        aria-describedby={titleId}
        className={`col-span-2 justify-start px-0 sm:px-4 ${QUIET_HOVER}`}
      >
        <CalendarX2 aria-hidden="true" className="mr-1.5 h-4 w-4" /> Cancel
      </Button>
    ),
    reason === "CALENDAR_UNAVAILABLE" && (
      <MessageLink key="message" businessName={businessName} className="col-span-2" />
    ),
  ].filter(Boolean);
  const primaries = (showJoin ? 1 : 0) + (canReschedule ? 1 : 0);

  return (
    <li aria-labelledby={titleId} className="rounded-xl border border-border bg-card p-4" aria-busy={busy || undefined}>
      <div className="flex gap-4">
        <time
          dateTime={s.start_at}
          className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-border"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dateParts.weekday}</span>
          <span className="text-xl font-semibold leading-tight tabular-nums">{dateParts.day}</span>
          <span className="text-xs text-muted-foreground">{dateParts.month}</span>
        </time>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id={titleId} className="text-base font-semibold leading-snug">{s.title}</h3>
            {pill && <StatusPill pill={pill} />}
          </div>
          <p className="text-sm font-medium tabular-nums">
            <span className="sr-only">{dayLabel(s.start_at, viewerTz)}, </span>
            {timeRange(s.start_at, s.end_at, viewerTz)}
          </p>
          {other && <p className="text-xs text-muted-foreground">{other}</p>}
          <p className="inline-flex items-start gap-1.5 text-sm text-muted-foreground">
            <LocationIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 [text-wrap:pretty]">{s.location.label}</span>
          </p>
        </div>
      </div>

      {scheduled && (change || info || actions.length > 0) && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {change && (
            <ChangeNotice
              change={change}
              session={s}
              businessName={businessName}
              viewerTz={viewerTz}
              onRetry={onRetry}
              onDismiss={onDismiss}
              onPickAnother={onReschedule}
            />
          )}
          {(info || actions.length > 0) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {info}
              {actions.length > 0 && (
                <div
                  data-testid="session-actions"
                  className={`grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center ${primaries === 1 ? "[&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1" : ""}`}
                >
                  {actions}
                </div>
              )}
            </div>
          )}
          {reason === "CALENDAR_UNAVAILABLE" && (
            <p className="text-sm text-muted-foreground">Online rescheduling is off for this session. To move it, let {businessName} know.</p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A past session as one compact row: date · title over where it was · time · how it ended. The place is
 * the server's settled wording (place only, never "to follow"); the pill sits in a fixed-width column
 * so every row's time ends on the same edge.
 */
function PastRow({ session: s, viewerTz, nowMs }: { session: PortalSession; viewerTz: string; nowMs: number }) {
  const titleId = useId();
  const LocationIcon = LOCATION_ICON[s.location.kind ?? "tbd"];
  const day = dayLabel(s.start_at, viewerTz);
  return (
    <li aria-labelledby={titleId} className="flex items-center gap-3 py-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <time dateTime={s.start_at} className="hidden tabular-nums text-muted-foreground sm:block sm:w-28 sm:shrink-0">{day}</time>
        <div className="min-w-0 sm:flex-1">
          <span id={titleId} className={`block truncate font-medium ${s.status === "cancelled" ? "text-muted-foreground line-through decoration-1" : ""}`}>
            {s.title}
          </span>
          <span data-testid="past-location" className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <LocationIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{s.location.label}</span>
          </span>
        </div>
        <span className="tabular-nums text-muted-foreground sm:shrink-0">
          <time dateTime={s.start_at} className="sm:hidden">{day}</time>
          <span aria-hidden="true" className="sm:hidden"> · </span>
          {timeRange(s.start_at, s.end_at, viewerTz)}
        </span>
      </div>
      <span data-testid="past-pill" className="flex w-24 shrink-0 justify-end">
        <StatusPill pill={pastPill(s, nowMs)} />
      </span>
    </li>
  );
}

function RescheduleSheet({
  session, open, onOpenChange, viewerTz, businessName, accent, change, onConfirm,
}: {
  session: PortalSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerTz: string;
  businessName: string;
  accent: Accent;
  change: SessionChange | undefined;
  onConfirm: (start: string) => Promise<boolean>;
}) {
  const [slots, setSlots] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sessionId = session?.id ?? null;

  const load = useCallback(async () => {
    if (!session) return;
    setState("loading");
    try {
      const result = await fetchRescheduleSlots(session);
      setSlots(result.slots);
      setState("ready");
    } catch {
      setState("error");
    }
  // The session's identity and calendar decide the slots; nothing else does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.calendar?.slug, session?.calendar?.appointment_type_id]);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setDay(null);
    void load();
  }, [open, load]);

  const days = useMemo(() => {
    const groups: { key: string; label: string; weekday: string; date: string; times: string[] }[] = [];
    for (const s of slots) {
      const key = fmt(s, viewerTz, { year: "numeric", month: "2-digit", day: "2-digit" });
      const g = groups.find((x) => x.key === key);
      if (g) g.times.push(s);
      else {
        groups.push({
          key, label: dayLabel(s, viewerTz), times: [s],
          weekday: fmt(s, viewerTz, { weekday: "short" }), date: fmt(s, viewerTz, { month: "short", day: "numeric" }),
        });
      }
    }
    return groups;
  }, [slots, viewerTz]);
  const activeDay = days.find((d) => d.key === day) ?? days[0] ?? null;

  const confirm = async () => {
    if (!picked) return;
    setSubmitting(true);
    const ok = await onConfirm(picked);
    setSubmitting(false);
    if (ok) { onOpenChange(false); return; }
    // The time may have been taken meanwhile: show what is open now.
    setPicked(null);
    void load();
  };

  const failure = change && change.action === "reschedule" && change.status !== "sending"
    ? (change.status === "failed" ? portalSessionChangeCopy(change.error) : "We couldn't confirm the new time. Retrying won't change it twice.")
    : null;
  const busy = submitting || change?.status === "sending";

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md motion-reduce:animate-none motion-reduce:transition-none [&>button]:flex [&>button]:h-[44px] [&>button]:w-[44px] [&>button]:items-center [&>button]:justify-center [&>button]:top-2 [&>button]:right-2"
      >
        <SheetHeader className="border-b border-border px-5 pb-4 pr-14 pt-5 text-left">
          <SheetTitle>Reschedule {session?.title ?? "session"}</SheetTitle>
          <SheetDescription>
            {session ? `Now ${whenLabel(session.start_at, viewerTz)}. Pick a new time and it updates on ${businessName}'s calendar.` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 [&_button]:min-h-[44px]">
          {failure && (
            <div role="alert" className="mb-4 rounded-lg border border-destructive/40 px-3 py-2.5">
              <RefusalText>{failure}</RefusalText>
            </div>
          )}
          {state === "loading" ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">Loading open times…</span>
              <div className="flex gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-24 rounded-lg motion-reduce:animate-none" />)}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 rounded-lg motion-reduce:animate-none" />)}</div>
            </div>
          ) : state === "error" ? (
            <div role="alert" className="space-y-3 text-sm">
              <p>We couldn't load open times. Check your connection and try again.</p>
              <Button variant="outline" className={QUIET_HOVER} onClick={() => void load()}>Try again</Button>
            </div>
          ) : days.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">No open times right now</p>
              <p className="text-muted-foreground">{businessName} has no other times open. Send them a message to find one.</p>
              <MessageLink businessName={businessName} />
            </div>
          ) : (
            <div className="space-y-4">
              <div role="group" aria-label="Day" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {days.map((d) => {
                  const selected = d.key === activeDay?.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      aria-pressed={selected}
                      aria-label={d.label}
                      onClick={() => { setDay(d.key); setPicked(null); }}
                      className={`flex flex-col items-center justify-center rounded-lg border px-2 py-1.5 ${FOCUS} ${selected ? SELECTED : UNSELECTED}`}
                    >
                      <span className={`text-xs font-medium uppercase tracking-wide ${selected ? "" : "text-muted-foreground"}`}>{d.weekday}</span>
                      <span className="text-sm font-semibold tabular-nums">{d.date}</span>
                    </button>
                  );
                })}
              </div>
              {activeDay && (
                <div role="group" aria-label={`Times on ${activeDay.label} (${zoneLabel(activeDay.times[0], viewerTz)})`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {activeDay.times.map((t) => {
                    const selected = t === picked;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPicked(t)}
                        className={`rounded-lg border px-3 text-sm tabular-nums ${FOCUS} ${selected ? `${SELECTED} font-semibold` : UNSELECTED}`}
                      >
                        {timeLabel(t, viewerTz)}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Times are shown in your time zone ({zoneLabel(slots[0], viewerTz)}).</p>
            </div>
          )}
        </div>
        <div className="border-t border-border px-5 py-4">
          {picked && session && (
            <p data-testid="reschedule-summary" className="mb-3 flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
              <span className="sr-only">From </span>
              <span className="text-muted-foreground">{shortWhen(session.start_at, viewerTz)}</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span className="sr-only"> to </span>
              <span className="font-medium">{shortWhen(picked, viewerTz)}</span>
            </p>
          )}
          <Button
            className={`w-full min-h-[44px] ${accent ? "dark:ring-1 dark:ring-foreground/30" : ""}`}
            style={accent}
            disabled={!picked || busy}
            onClick={() => void confirm()}
          >
            {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {/* The from → to summary above carries the times; the button names the act once. */}
            {picked ? "Move session" : "Pick a new time"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Sessions() {
  const sessions = useClientPortalSessions();
  const brand = useClientPortalBrand();
  const businessName = brand?.tenant_name?.trim() || "your team";
  const { agentName } = useCustomerIdentity();
  const accent = brand?.tenant_id && brand.tenant_id === sessions.tenantId ? brand.primary_color : null;
  const accentStyle: Accent = accent ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined;
  const viewerTz = useMemo(viewerTimeZone, []);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  // The list re-reads on a poll; keep "now" in step with each fresh read.
  useEffect(() => { setNowMs(Date.now()); }, [sessions.upcoming]);

  const [pastOpen, setPastOpen] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** What the engine confirmed last, so a session leaving the list never just vanishes. */
  const [done, setDone] = useState<string | null>(null);
  const pastId = useId();

  // Dialogs, the open past list and the last confirmation belong to the signed-in identity.
  useEffect(() => { setMoving(null); setCancelling(null); setPastOpen(false); setDone(null); }, [sessions.scopeEpoch]);

  const all = [...sessions.upcoming, ...sessions.past];
  // Titles of every session this page has shown, so a refusal outlives its session leaving the list.
  const titles = useRef<Record<string, string>>({});
  for (const s of all) titles.current[s.id] = s.title;
  // A refused or unconfirmed change whose session the re-read took out of Upcoming (it was cancelled
  // or completed elsewhere) has no card to show on; it is shown at the top instead, never dropped.
  const orphans = Object.values(sessions.changes).filter((c) =>
    c.status !== "sending" && !sessions.upcoming.some((s) => s.id === c.sessionId));
  const movingSession = moving ? all.find((s) => s.id === moving) ?? null : null;
  const cancelSession = cancelling ? all.find((s) => s.id === cancelling) ?? null : null;

  const togglePast = () => {
    const next = !pastOpen;
    setPastOpen(next);
    if (next) void sessions.loadPast();
  };

  const confirmCancel = async () => {
    if (!cancelSession) return;
    const { title, start_at } = cancelSession;
    setConfirmingCancel(true);
    const ok = await sessions.cancel(cancelSession.id);
    setConfirmingCancel(false);
    if (ok) setDone(`Cancelled ${title} on ${whenLabel(start_at, viewerTz)}. It's off ${businessName}'s calendar.`);
    // The outcome — done, refused or unknown — is shown on the session itself.
    setCancelling(null);
  };

  const blocked = sessions.unavailable || sessions.multipleBusinesses;
  const firstLoad = sessions.loading && sessions.upcoming.length === 0;

  const rowProps = (s: PortalSession) => ({
    session: s,
    change: sessions.changes[s.id],
    businessName,
    viewerTz,
    nowMs,
    accent: accentStyle,
    onReschedule: () => setMoving(s.id),
    onCancel: () => setCancelling(s.id),
    onRetry: () => void sessions.retryChange(s.id),
    onDismiss: () => sessions.dismissChange(s.id),
  });

  return (
    <section
      aria-labelledby="sessions-title"
      aria-busy={sessions.loading}
      className="mx-auto max-w-2xl [&_button]:min-h-[44px]"
    >
      <header className="space-y-1 pb-4">
        <h1 id="sessions-title" className="text-2xl font-semibold tracking-tight">Sessions</h1>
        {!blocked && <p className="text-sm text-muted-foreground">Your sessions with {businessName}.</p>}
      </header>

      {sessions.error && !blocked && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {sessions.error}
          </p>
          <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => void sessions.refresh()}>Try again</Button>
        </div>
      )}

      {!blocked && orphans.map((c) => (
        <div key={c.sessionId} role="alert" data-testid="orphan-change" className="mb-4 space-y-1 rounded-lg border border-destructive/40 px-4 py-3">
          <RefusalText>
            <span className="font-medium">{titles.current[c.sessionId] ?? "A session"}:</span>{" "}
            {c.status === "failed"
              ? portalSessionChangeCopy(c.error)
              : `We couldn't confirm ${c.action === "cancel" ? "the cancellation" : "the new time"}. Retrying won't change it twice.`}
          </RefusalText>
          <div className="flex flex-wrap items-center gap-x-4 pl-[22px]">
            {c.status === "unconfirmed" && (
              <Button size="sm" variant="outline" className={QUIET_HOVER} onClick={() => void sessions.retryChange(c.sessionId)}>
                <RotateCw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> Retry
              </Button>
            )}
            <button
              type="button"
              onClick={() => sessions.dismissChange(c.sessionId)}
              className={`min-h-[44px] rounded-md px-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${FOCUS}`}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}

      {done && !blocked && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-success" /> {done}
          </p>
          <Button size="sm" variant="ghost" className={QUIET_HOVER} onClick={() => setDone(null)}>Dismiss</Button>
        </div>
      )}

      {sessions.multipleBusinesses ? (
        <SessionsEmpty
          icon={CalendarClock}
          title="Sessions for more than one business aren't available yet"
          description={(
            <>
              Your account is connected to more than one business. Sessions here work with one business at a time
              for now. For help in the meantime, use{" "}
              <Link to="/app/support" className={`font-medium text-foreground underline underline-offset-4 ${FOCUS}`}>Support</Link>.
            </>
          )}
          action={<BackHome />}
        />
      ) : sessions.unavailable ? (
        <SessionsEmpty
          icon={CalendarClock}
          title="Sessions aren't available on this account"
          description="Your sessions show here once your account is connected to a business. Sign in with the email your business invited."
          action={<BackHome />}
        />
      ) : firstLoad ? (
        <UpcomingSkeleton />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="sessions-upcoming">
            <h2 id="sessions-upcoming" className="mb-3 text-sm font-semibold text-muted-foreground">Upcoming</h2>
            {sessions.upcoming.length === 0 && !sessions.error ? (
              <SessionsEmpty
                icon={CalendarClock}
                title="No upcoming sessions"
                description={`When ${businessName} books a time with you, it shows up here. Want to set one up? Send them a message.`}
                action={(
                  <Link to="/app/messages" className={LINK_BUTTON}>
                    <MessageSquare aria-hidden="true" className="h-4 w-4" /> Message {businessName}
                  </Link>
                )}
              />
            ) : (
              <ol className="space-y-3">
                {sessions.upcoming.map((s) => <SessionRow key={s.id} {...rowProps(s)} />)}
              </ol>
            )}
            {sessions.hasMoreUpcoming && (
              <div className="flex justify-center pt-3">
                <Button variant="ghost" className={QUIET_HOVER} onClick={() => void sessions.loadMore("upcoming")} disabled={sessions.loadingMore}>
                  {sessions.loadingMore && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                  Show more upcoming
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby={`${pastId}-heading`}>
            <h2 id={`${pastId}-heading`} className="text-sm font-semibold text-muted-foreground">
              <button
                type="button"
                aria-expanded={pastOpen}
                aria-controls={pastId}
                onClick={togglePast}
                className={`-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 hover:text-foreground ${FOCUS}`}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform motion-reduce:transition-none ${pastOpen ? "rotate-180" : ""}`}
                />
                Past sessions
              </button>
            </h2>
            <div id={pastId} hidden={!pastOpen} className="pt-3">
              {pastOpen && (sessions.pastLoading && !sessions.pastLoaded ? (
                <PastSkeleton />
              ) : sessions.past.length === 0 ? (
                <p className="text-sm text-muted-foreground">{sessions.pastLoaded ? "No past sessions yet." : ""}</p>
              ) : (
                <ol className="divide-y divide-border border-y border-border">
                  {sessions.past.map((s) => <PastRow key={s.id} session={s} viewerTz={viewerTz} nowMs={nowMs} />)}
                </ol>
              ))}
              {pastOpen && sessions.hasMorePast && (
                <div className="flex justify-center pt-3">
                  <Button variant="ghost" className={QUIET_HOVER} onClick={() => void sessions.loadMore("past")} disabled={sessions.loadingMore}>
                    {sessions.loadingMore && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                    Show earlier sessions
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <RescheduleSheet
        session={movingSession}
        open={!!movingSession}
        onOpenChange={(open) => { if (!open) setMoving(null); }}
        viewerTz={viewerTz}
        businessName={businessName}
        accent={accentStyle}
        change={movingSession ? sessions.changes[movingSession.id] : undefined}
        onConfirm={async (start) => {
          if (!movingSession) return false;
          const { title } = movingSession;
          const ok = await sessions.reschedule(movingSession.id, start);
          if (ok) setDone(`Moved ${title} to ${whenLabel(start, viewerTz)}. ${businessName}'s calendar is updated.`);
          return ok;
        }}
      />

      <AlertDialog open={!!cancelSession} onOpenChange={(open) => { if (!open && !confirmingCancel) setCancelling(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-xl sm:rounded-xl [&_button]:min-h-[44px] motion-reduce:animate-none motion-reduce:transition-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelSession?.title ?? "this session"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelSession
                ? `${dayLabel(cancelSession.start_at, viewerTz)}, ${timeRange(cancelSession.start_at, cancelSession.end_at, viewerTz)}. It comes off ${businessName}'s calendar. To book again, message them or ask ${agentName}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmingCancel}>Keep session</AlertDialogCancel>
            <Button
              variant="destructive"
              className="motion-reduce:transform-none motion-reduce:transition-none"
              disabled={confirmingCancel}
              onClick={() => void confirmCancel()}
            >
              {confirmingCancel && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" />}
              Cancel session
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** The way out of a page that cannot be used on this account. */
function BackHome() {
  return (
    <Link to="/app" className={LINK_BUTTON}>
      <Home aria-hidden="true" className="h-4 w-4" /> Back to Home
    </Link>
  );
}
