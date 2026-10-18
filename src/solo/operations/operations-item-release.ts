import type { PlanItem } from "@/hooks/usePlanList";

/** E09 Slice 4 (4B): a work item can carry a client release only when it is client work inside a project, with a row version. */
export type ReleaseItem = Pick<PlanItem, "id" | "plan_id" | "contact_id" | "updated_at">;

export function canReleaseItem(item: ReleaseItem | null | undefined): item is ReleaseItem & { plan_id: string; contact_id: string; updated_at: string } {
  return Boolean(item?.plan_id && item.contact_id && item.updated_at && Number.isFinite(Date.parse(item.updated_at)));
}
