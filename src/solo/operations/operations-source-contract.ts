import type { Plan, PlanItem } from "@/hooks/usePlanList";

/** Reject the entire bundle on mismatch; never present a partially foreign portfolio. */
export function operationsBundleMatchesTenant(plans: Plan[], items: PlanItem[], tenantId: string) {
  return plans.every((plan) => plan.tenant_id === tenantId &&
    plan.items.every((item) => item.tenant_id === tenantId && item.plan_id === plan.id)) &&
    items.every((item) => item.tenant_id === tenantId);
}

export function operationsOpenItems(items: PlanItem[]) {
  return items.filter((item) => item.status !== "done" && item.status !== "cancelled");
}

/** Counts are recorded assignments, never a claim about hours or utilization. */
export function operationsAssignmentCounts(items: PlanItem[], userId: string) {
  const assigned = operationsOpenItems(items).filter((item) => item.assigned_to_user_id === userId);
  return { assigned, blocked: assigned.filter((item) => item.status === "blocked").length };
}
