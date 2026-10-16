import type { PlanItem, PlanItemStatus } from "@/hooks/usePlanList";

export type CrmWorkStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type CrmWorkRecord = {
  id: string; tenant_id: string; user_id: string; title: string;
  description: string | null; status: CrmWorkStatus; due_date: string | null;
  updated_at: string | null; created_at: string | null;
  deal_id: string | null; biz_id: string | null;
  recorded_priority: string | null; estimated_minutes: number | null;
};
/** Display projection only. Every mutation retains its native record and writer. */
export type NativeOperationsWork =
  | { source: "planning"; key: string; record: PlanItem }
  | { source: "crm"; key: string; record: CrmWorkRecord };

export function projectNativeOperationsWork(tenantId: string, planning: PlanItem[], crm: CrmWorkRecord[]): NativeOperationsWork[] {
  // A malformed scope invalidates the read rather than silently hiding foreign rows.
  if (!tenantId || planning.some(row => row.tenant_id !== tenantId) || crm.some(row => row.tenant_id !== tenantId)) {
    throw new Error("OPERATIONS_WORK_SCOPE_CHANGED");
  }
  return [...planning.map(record => ({ source: "planning" as const, key: `planning:${record.id}`, record })),
    ...crm.map(record => ({ source: "crm" as const, key: `crm:${record.id}`, record }))];
}

export function nativeWorkStage(work: NativeOperationsWork): PlanItemStatus {
  if (work.source === "planning") return work.record.status;
  return ({ pending: "open", in_progress: "in_progress", completed: "done", cancelled: "cancelled" } as const)[work.record.status];
}

/** Read-only presentation fields. `native.record` is the sole mutation identity. */
export function presentNativeWork(native: NativeOperationsWork) {
  const row = native.record;
  if (native.source === "planning") return { native, id:native.key, title:native.record.title,
    summary:native.record.summary, status:native.record.status, priority:native.record.priority,
    item_type:native.record.item_type, assigned_to_user_id:native.record.assigned_to_user_id,
    plan_id:native.record.plan_id, due_at:native.record.due_at, remind_at:native.record.remind_at, updated_at:native.record.updated_at,
    linked_action_id:native.record.linked_action_id };
  return { native, id:native.key, title:row.title, summary:native.record.description,
    status:nativeWorkStage(native), priority:native.record.recorded_priority,
    item_type:"task", assigned_to_user_id:native.record.user_id, plan_id:null,
    due_at:native.record.due_date, remind_at:null, updated_at:native.record.updated_at ?? native.record.created_at,
    linked_action_id:null };
}

/** Recorded effort is an estimate of work, never a person's available hours. */
export function summarizeNativeWorkload(work: NativeOperationsWork[], userId: string) {
  const assignments = work.filter(native => {
    const owner = native.source === "planning" ? native.record.assigned_to_user_id : native.record.user_id;
    return owner === userId && !["done", "cancelled"].includes(nativeWorkStage(native));
  });
  const estimates = assignments.map(native => native.source === "crm" ? native.record.estimated_minutes : null);
  const recorded = estimates.filter((value): value is number => value !== null);
  return {
    assignments,
    recordedMinutes: recorded.length ? recorded.reduce((sum,value) => sum + value,0) : null,
    unknownEffortCount: estimates.filter(value => value === null).length,
    blockedCount: assignments.filter(native => nativeWorkStage(native) === "blocked").length,
  };
}

/** CRM has no blocked/review state in its canonical status enum. Never fake one. */
export function crmActionForStage(record: CrmWorkRecord, stage: PlanItemStatus): "task.complete" | "task.reopen" | "task.update" | null {
  const version = record.updated_at ?? record.created_at;
  if (!version || !Number.isFinite(Date.parse(version))) return null;
  if (stage === nativeWorkStage({ source: "crm", key: `crm:${record.id}`, record })) return null;
  if (stage === "done") return "task.complete";
  if (stage === "open") return "task.reopen";
  if (stage === "in_progress" && record.status === "pending") return "task.update";
  // Cancellation requires its separate consequential preview/approval flow.
  return null;
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown): value is string | null => value === null || typeof value === "string";
const priorities = new Set(["P0", "P1", "P2", "P3", "low", "normal", "high", "urgent"]);
/** Reject a foreign/malformed read as a whole; never reinterpret it as empty work. */
export function normalizeCrmWorkRead(value: unknown, actorId: string, tenantId: string): { tasks: CrmWorkRecord[]; hasMore: boolean } | null {
  if (!object(value) || value.ok !== true || value.actor_id !== actorId || value.tenant_id !== tenantId ||
      !Array.isArray(value.tasks) || value.tasks.length > 200 || typeof value.has_more !== "boolean") return null;
  const ids = new Set<string>(); const tasks: CrmWorkRecord[] = [];
  for (const row of value.tasks) {
    if (!object(row) || typeof row.id !== "string" || !row.id || ids.has(row.id) || row.tenant_id !== tenantId ||
        typeof row.user_id !== "string" || !row.user_id || typeof row.title !== "string" ||
        typeof row.status !== "string" || !["pending", "in_progress", "completed", "cancelled"].includes(row.status) ||
        ![row.description,row.due_date,row.updated_at,row.created_at,row.deal_id,row.biz_id].every(nullableText) ||
        !(row.recorded_priority === null || typeof row.recorded_priority === "string" && priorities.has(row.recorded_priority)) ||
        !(row.estimated_minutes === null || typeof row.estimated_minutes === "number" && Number.isSafeInteger(row.estimated_minutes) && row.estimated_minutes >= 0 && row.estimated_minutes <= 2147483647)) return null;
    ids.add(row.id);
    tasks.push({id:row.id,tenant_id:tenantId,user_id:row.user_id,title:row.title,description:row.description as string|null,
      status:row.status as CrmWorkStatus,due_date:row.due_date as string|null,updated_at:row.updated_at as string|null,
      created_at:row.created_at as string|null,deal_id:row.deal_id as string|null,biz_id:row.biz_id as string|null,
      recorded_priority:row.recorded_priority as string|null,estimated_minutes:row.estimated_minutes as number|null});
  }
  return { tasks, hasMore:value.has_more };
}
