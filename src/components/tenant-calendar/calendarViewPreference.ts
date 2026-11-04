import type { ViewMode } from "./useSoloCalendar";

const validView = (value: unknown): value is ViewMode =>
  value === "month" || value === "week" || value === "agenda";

/** Display preference only. Never an identity or calendar authorization source. */
export function calendarViewPreferenceKey(userId: string | null | undefined, tenantId: string): string | null {
  return userId && tenantId ? `paige.calendar.defaultView:${JSON.stringify([userId, tenantId])}` : null;
}

export function readCalendarDefaultView(userId: string | null | undefined, tenantId: string): ViewMode {
  const key = calendarViewPreferenceKey(userId, tenantId);
  try {
    const value = key ? window.localStorage.getItem(key) : null;
    return validView(value) ? value : "month";
  } catch {
    return "month";
  }
}

export function saveCalendarDefaultView(userId: string | null | undefined, tenantId: string, view: ViewMode): boolean {
  const key = calendarViewPreferenceKey(userId, tenantId);
  if (!key || !validView(view)) return false;
  try {
    window.localStorage.setItem(key, view);
    return true;
  } catch {
    return false;
  }
}
