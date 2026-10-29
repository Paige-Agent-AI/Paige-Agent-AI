import type { operationsWeek } from "./operations-week";
import { localDateInZone } from "../../../supabase/functions/_shared/paige-context/snapshot";

export type ReadyWorkWeek = Extract<ReturnType<typeof operationsWeek>, { kind: "ready" }>;

/** A review of the original dated work, never a schedule or availability source. */
export function weeklyWorkload(week: ReadyWorkWeek, ownerId: string, hours: string,
  estimates: Readonly<Record<string, string>> = {}) {
  const enteredHours = hours.trim();
  const hoursValue = /^\d{1,3}(?:\.\d{1,2})?$/.test(enteredHours) ? Number(enteredHours) : NaN;
  const capacityMinutes = Number.isFinite(hoursValue) && hoursValue >= 0 && hoursValue <= 168 && Number.isInteger(hoursValue * 4)
    ? hoursValue * 60 : null;
  const rows = week.days.flatMap(day => day.deadlines)
    .filter(work => Boolean(ownerId) && work.assigned_to_user_id === ownerId)
    .map(work => {
      const revised = Object.prototype.hasOwnProperty.call(estimates, work.id);
      const saved = work.native.source === "crm" ? work.native.record.estimated_minutes : null;
      const text = revised ? estimates[work.id].trim() : saved === null ? "" : String(saved);
      const value = /^\d+$/.test(text) ? Number(text) : NaN;
      const minutes = Number.isSafeInteger(value) && value >= 0 && value <= 2147483647 ? value : null;
      return { work, text, minutes, revised, invalid: text !== "" && minutes === null };
    });
  const knownMinutes = rows.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
  const missing = rows.filter(row => row.minutes === null).length;
  const blocked = rows.filter(row => row.work.status === "blocked").length;
  const undated = week.undated.filter(work => work.assigned_to_user_id === ownerId && work.item_type !== "reminder").length;
  const unreadable = week.unavailable.filter(work => work.assigned_to_user_id === ownerId && work.item_type !== "reminder").length;
  const earlier = week.outside.filter(work => work.assigned_to_user_id === ownerId && work.item_type !== "reminder" &&
    (localDateInZone(Date.parse(work.due_at!), week.zone) ?? "9999") < week.days[0].date).length;
  return { rows, knownMinutes, capacityMinutes, missing, blocked, undated, unreadable, earlier,
    invalidCapacity: enteredHours !== "" && capacityMinutes === null,
    overBy: capacityMinutes === null ? null : Math.max(0, knownMinutes - capacityMinutes) };
}
