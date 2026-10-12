import type { PlanItem } from "@/hooks/usePlanList";
import { presentNativeWork, projectNativeOperationsWork, type CrmWorkRecord } from "./operations-native-work";

/** Display-only executive ordering over the same native work used in Work. */
export function overviewNativeWork(tenantId: string, items: PlanItem[], tasks: CrmWorkRecord[], now = Date.now()) {
  const work = projectNativeOperationsWork(tenantId, items, tasks).map(presentNativeWork);
  const active = work.filter(item => item.status !== "done" && item.status !== "cancelled");
  const time = (item: typeof work[number]) => item.due_at ? Date.parse(item.due_at) : Number.NaN;
  const priority: Record<string, number> = { urgent: 4, P0: 4, high: 3, P1: 3, normal: 2, P2: 2, low: 1, P3: 1 };
  const dueOrder = (a: typeof work[number], b: typeof work[number]) =>
    (Number.isFinite(time(a)) ? time(a) : Infinity) - (Number.isFinite(time(b)) ? time(b) : Infinity) || a.title.localeCompare(b.title);
  return {
    attention: active.filter(item => item.status === "blocked" || time(item) < now).sort((a,b) =>
      (priority[b.priority ?? ""] ?? 0) - (priority[a.priority ?? ""] ?? 0) || Number(b.status === "blocked") - Number(a.status === "blocked") || dueOrder(a,b)),
    upcoming: active.filter(item => Number.isFinite(time(item)) && time(item) >= now).sort(dueOrder).slice(0,5),
  };
}
