import type { PlanItem } from "@/hooks/usePlanList";
import { presentNativeWork, projectNativeOperationsWork, type CrmWorkRecord } from "./operations-native-work";

/** Display-only executive ordering over the same native work used in Work. */
export function overviewNativeWork(tenantId: string, items: PlanItem[], tasks: CrmWorkRecord[], now = Date.now()) {
  const work = projectNativeOperationsWork(tenantId, items, tasks).map(presentNativeWork);
  const active = work.filter(item => item.status !== "done" && item.status !== "cancelled");
  // Reminder time is not a work deadline, even if a legacy row also has due_at.
  const time = (item: typeof work[number]) => item.item_type !== "reminder" && item.due_at ? Date.parse(item.due_at) : Number.NaN;
  const priority: Record<string, number> = { urgent: 4, P0: 4, high: 3, P1: 3, normal: 2, P2: 2, low: 1, P3: 1 };
  const dueOrder = (a: typeof work[number], b: typeof work[number]) =>
    (Number.isFinite(time(a)) ? time(a) : Infinity) - (Number.isFinite(time(b)) ? time(b) : Infinity) || a.title.localeCompare(b.title);
  const operatingOrder = (a: typeof work[number], b: typeof work[number]) =>
    Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
    (priority[b.priority ?? ""] ?? 0) - (priority[a.priority ?? ""] ?? 0) || dueOrder(a,b);
  const currentWork = [...active].sort(operatingOrder);
  const reminderTime = (item: typeof work[number]) => item.remind_at ? Date.parse(item.remind_at) : Number.NaN;
  return {
    attention: active.filter(item => item.status === "blocked" || time(item) < now).sort((a,b) =>
      (priority[b.priority ?? ""] ?? 0) - (priority[a.priority ?? ""] ?? 0) || Number(b.status === "blocked") - Number(a.status === "blocked") || dueOrder(a,b)),
    upcoming: active.filter(item => Number.isFinite(time(item)) && time(item) >= now).sort(dueOrder).slice(0,5),
    active: currentWork,
    inProgress: currentWork.filter(item => item.status === "in_progress"),
    timingToConfirm: currentWork.filter(item => item.item_type !== "reminder" && !Number.isFinite(time(item))),
    reminders: currentWork.filter(item => item.item_type === "reminder").sort((a,b) =>
      (Number.isFinite(reminderTime(a)) ? reminderTime(a) : Infinity) -
      (Number.isFinite(reminderTime(b)) ? reminderTime(b) : Infinity) || a.title.localeCompare(b.title)),
  };
}
