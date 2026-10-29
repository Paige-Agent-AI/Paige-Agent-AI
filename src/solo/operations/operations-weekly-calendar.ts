import { findConflicts, rangeFor, type SoloBooking } from "@/components/tenant-calendar/useSoloCalendar";
import { localDateInZone } from "../../../supabase/functions/_shared/paige-context/snapshot";
import type { ReadyWorkWeek } from "./operations-weekly-workload";

/** Consume the original fourteen-day agenda, with margin for device/business zones. */
export function weeklyCalendarCursor(week: ReadyWorkWeek): Date | null {
  const cursor = new Date(`${week.days[0].date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 3);
  if (!Number.isFinite(cursor.getTime()) || cursor.getUTCFullYear() < 0 || cursor.getUTCFullYear() > 9999) return null;
  const [from, to] = rangeFor("agenda", cursor);
  const first = localDateInZone(from.getTime(), week.zone);
  const last = localDateInZone(to.getTime() - 1, week.zone);
  return first && last && first < week.days[0].date && last > week.days[6].date ? cursor : null;
}

/** Presentation of already-authorized, class-folded Calendar results; never availability. */
export function weeklyCalendarBookings(week: ReadyWorkWeek, ownerId: string, bookings: SoloBooking[]) {
  let unassigned = 0, unreadable = 0;
  const rows: SoloBooking[] = [];
  for (const booking of bookings) {
    if (booking.status === "cancelled" || booking.status === "no_show") continue;
    if (booking.host_user_id && booking.host_user_id !== ownerId) continue;
    const start = /(?:Z|[+-]\d{2}:\d{2})$/i.test(booking.start_at) ? Date.parse(booking.start_at) : NaN;
    const end = /(?:Z|[+-]\d{2}:\d{2})$/i.test(booking.end_at) ? Date.parse(booking.end_at) : NaN;
    const first = localDateInZone(start, week.zone), last = localDateInZone(end - 1, week.zone);
    if (!first || !last || end <= start) { unreadable++; continue; }
    if (first > week.days[6].date || last < week.days[0].date) continue;
    if (!booking.host_user_id) { unassigned++; continue; }
    rows.push(booking);
  }
  rows.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id));
  return { rows, unassigned, unreadable, conflicts: findConflicts(rows) };
}
