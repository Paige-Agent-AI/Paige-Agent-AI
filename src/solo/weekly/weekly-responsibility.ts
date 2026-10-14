import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import type { WeeklySchedule } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";

export type PlanningItemTarget = { kind: "planning_item"; id: string };
export function planningItemHref(path: string, target: PlanningItemTarget): string | null {
  const root = tenantRoutePrefixForPath(path);
  return root && target.kind === "planning_item" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(target.id)
    ? `${root}/operations/work?weeklySource=planning_item&item=${target.id}` : null;
}
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function reviewWeeklyProposal(weekday: number, local_time: string, timezone: string): WeeklySchedule | null {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(local_time) ||
    timezone.length > 80 || !/^(UTC|[A-Za-z]+\/[A-Za-z0-9_+/-]+)$/.test(timezone)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0); } catch { return null; }
  return { weekday, local_time, timezone };
}
export function weeklyStateLabel(state: string): string {
  return ({ requested: "Awaiting approval", needs_approval: "Awaiting approval", scheduled: "Scheduled", running: "Processing",
    completed: "Completed check", failed: "Failed", unknown: "Awaiting attention", paused: "Paused", cancelled: "Cancelled",
    held: "Held", refused: "Unavailable", skipped: "Skipped" } as Record<string, string>)[state] ?? "Unavailable";
}
export function weeklyInstantLabel(instant: string | null, timezone: string | null): string {
  if (!instant) return "Not available";
  try { return new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? "UTC", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(instant)); } catch { return "Not available"; }
}
