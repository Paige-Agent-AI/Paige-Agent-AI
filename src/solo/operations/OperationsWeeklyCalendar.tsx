import { useMemo, useState } from "react";
import { useSoloCalendar } from "@/components/tenant-calendar/useSoloCalendar";
import { weeklyCalendarBookings, weeklyCalendarCursor } from "./operations-weekly-calendar";
import type { ReadyWorkWeek } from "./operations-weekly-workload";

type Props = { tenantId: string; ownerId: string; week: ReadyWorkWeek };

/** Mounted only after an explicit read request; caller keys the selected person/week. */
export function OperationsWeeklyCalendar(props: Props) {
  const cursor = useMemo(() => weeklyCalendarCursor(props.week), [props.week]);
  if (!cursor) return <p role="status">Calendar cannot cover this business week. Choose another week to review its appointments.</p>;
  return <CalendarRead {...props} cursor={cursor} />;
}

function CalendarRead({ tenantId, ownerId, week, cursor }: Props & { cursor: Date }) {
  const calendar = useSoloCalendar(tenantId, "agenda", cursor);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const confirmed = calendar.lastSyncedAt && Number.isFinite(calendar.lastSyncedAt.getTime());
  const ready = calendar.phase === "ready" && !calendar.stale && confirmed && !retryFailed;
  const review = ready ? weeklyCalendarBookings(week, ownerId, calendar.bookings) : null;
  const time = (instant: string | Date) => new Intl.DateTimeFormat("en-US", {
    timeZone: week.zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
  const retry = async () => {
    setRetrying(true); setRetryFailed(false);
    try { await calendar.retry(); } catch { setRetryFailed(true); }
    finally { setRetrying(false); }
  };
  return <section className="ops-week-calendar" aria-label="Calendar commitments">
    <header><h3>Calendar commitments</h3><button type="button" disabled={retrying || calendar.phase === "loading"}
      onClick={() => void retry()}>{retrying ? "Checking Calendar…" : "Refresh Calendar"}</button></header>
    <p role="status">{calendar.phase === "loading" ? "Reading Calendar for this business week…"
      : !ready ? "Calendar is unavailable or its freshness could not be confirmed. Appointments are withheld; this does not mean the week is free."
      : `${review!.rows.length} recorded ${review!.rows.length === 1 ? "appointment" : "appointments"} returned for this person in this week.`}</p>
    {review && <>
      <p className="ops-week-review-note">Read {time(calendar.lastSyncedAt!)} · {week.zone}</p>
      {review.conflicts.size > 0 && <p>{review.conflicts.size} appointments overlap. Review these commitments before placing more work.</p>}
      <ul className="ops-week-calendar-list">{review.rows.map(booking => <li key={booking.id}>
        <div><strong>{booking.title || "Untitled appointment"}</strong><span>{booking.status.replace(/_/g, " ")}{review.conflicts.has(booking.id) && " · Overlap"}</span></div>
        <span><time dateTime={booking.start_at}>{time(booking.start_at)}</time> – <time dateTime={booking.end_at}>{time(booking.end_at)}</time></span>
      </li>)}</ul>
      {review.unassigned > 0 && <p>{review.unassigned} {review.unassigned === 1 ? "appointment has" : "appointments have"} no recorded host and cannot be assigned to this person in this review.</p>}
      {review.unreadable > 0 && <p>{review.unreadable} {review.unreadable === 1 ? "appointment has" : "appointments have"} unreadable times and cannot be placed in this week.</p>}
    </>}
    <p className="ops-week-review-note">Native Calendar records only; connected-provider free/busy and working hours are not verified here. Your entered work capacity already excludes appointments and is unchanged. Dependencies still need review.</p>
  </section>;
}
