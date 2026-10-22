import type { PaigeBusinessPlanScope } from "./paigeClientScope";

/** Deterministic UI relevance only; actual row authority remains in the original RLS read. */
export function planningWorkRelevant({ otherScope, plan, onPlanPage, threadId, hasOwnerMessages }: {
  otherScope: boolean; plan: PaigeBusinessPlanScope | null; onPlanPage: boolean;
  threadId: string | null; hasOwnerMessages: boolean;
}): boolean {
  if (otherScope) return false;
  if (plan) return plan.businessMissionId === null;
  return onPlanPage && !threadId && !hasOwnerMessages;
}
