import type { PlanItem } from "@/hooks/usePlanList";
import type { BusinessCalendarDay } from "../data/useBusinessTimeZone";
import { localDateInZone } from "../../../supabase/functions/_shared/paige-context/snapshot";
import { presentNativeWork, projectNativeOperationsWork, type CrmWorkRecord } from "./operations-native-work";

/** Calendar presentation only: a deadline never reserves time or schedules work. */
export function operationsWeek(tenantId: string, items: PlanItem[], tasks: CrmWorkRecord[],
  calendar: BusinessCalendarDay, weekOffset = 0) {
  // Reuse the existing all-or-nothing tenant check before presenting any source.
  const active = projectNativeOperationsWork(tenantId, items, tasks).map(presentNativeWork)
    .filter(row => row.status !== "done" && row.status !== "cancelled");
  if (calendar.kind !== "configured") return { kind: "withheld" as const, reason: calendar.reason };
  const start = new Date(`${calendar.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendar.date) || !Number.isSafeInteger(weekOffset) || !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== calendar.date || !localDateInZone(start.getTime(), calendar.zone)) {
    return { kind: "withheld" as const, reason: "invalid" as const };
  }
  // These are calendar-date operations, not 24-hour increments across zoned DST.
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 + weekOffset * 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
    start.getUTCFullYear() < 0 || end.getUTCFullYear() > 9999) {
    return { kind: "withheld" as const, reason: "invalid" as const };
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), deadlines: [] as typeof active, reminders: [] as typeof active };
  });
  const undated: typeof active = [], unavailable: typeof active = [], outside: typeof active = [];
  for (const row of active) {
    // Legacy reminders may carry due_at; only their saved remind_at is displayed.
    const instant = row.item_type === "reminder" ? row.remind_at : row.due_at;
    if (instant === null) { undated.push(row); continue; }
    // Offset-free values are not canonical instants; never adopt the device zone.
    const date = typeof instant === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(instant)
      ? localDateInZone(Date.parse(instant), calendar.zone) : null;
    if (!date) { unavailable.push(row); continue; }
    const day = days.find(candidate => candidate.date === date);
    if (!day) { outside.push(row); continue; }
    (row.item_type === "reminder" ? day.reminders : day.deadlines).push(row);
  }
  const instant = (row: typeof active[number]) => Date.parse((row.item_type === "reminder" ? row.remind_at : row.due_at)!);
  for (const day of days) for (const rows of [day.deadlines, day.reminders]) {
    rows.sort((a, b) => instant(a) - instant(b) || a.native.key.localeCompare(b.native.key));
  }
  return { kind: "ready" as const, zone: calendar.zone, today: calendar.date, days, undated, unavailable, outside };
}
