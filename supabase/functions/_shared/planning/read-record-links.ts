// Presentation references from the ORIGINAL successful caller-JWT plan_list.
// No query, authority, source text, model content or execution receipt is added.
// Opening the existing Work inspector reauthorizes the original item normally.
import { readRecordLinks, type ReadRecordLink } from "../paige-turn/record-links.ts";
import { createWeeklyDraftDeadline } from "../paige-orchestration/weekly-draft-deadline.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown): string | null => typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;

export function planningReadRecordLinks(tenantId: string, result: unknown): ReadRecordLink[] {
  const tenant = uuid(tenantId), data = object(result);
  if (!tenant || !data || data.success === false || data.error !== undefined
    || !Array.isArray(data.plans) || !Array.isArray(data.loose_items)) return [];
  const links: ReadRecordLink[] = [];
  const add = (raw: unknown, parent: string | null) => {
    const item = object(raw), id = uuid(item?.id);
    if (!item || !id || uuid(item.tenant_id) !== tenant
      || (parent === null ? item.plan_id !== null : uuid(item.plan_id) !== parent)) return;
    links.push({ destination: "operations_work", record_id: id, record_kind: "planning_item" });
  };
  for (const raw of data.plans) {
    const plan = object(raw), id = uuid(plan?.id);
    if (!plan || !id || uuid(plan.tenant_id) !== tenant || !Array.isArray(plan.items)) continue;
    for (const item of plan.items) add(item, id);
  }
  for (const item of data.loose_items) add(item, null);
  return readRecordLinks(links);
}

/** Finish the existing RPC read, never query or authorize it. The existing
 * capability recorder must acknowledge the lookup before facts reach the model.
 * A read receipt is not a completed Task, reminder delivery or business action. */
export async function finishPlanningChatRead(context: {
  tenantId: string | null; runId: string; recordRead: () => Promise<boolean>; isCurrent: () => Promise<boolean>;
  receiptBudgetMs?: number; signal?: AbortSignal;
}, result: unknown): Promise<{ model: Record<string, unknown>; links: ReadRecordLink[] }> {
  const tenant = uuid(context.tenantId), data = object(result);
  const unavailable = (error: string) => ({ model: { status: "unavailable", success: false, error }, links: [] });
  if (!tenant || !uuid(context.runId) || !data || data.success === false || data.error !== undefined
    || !Array.isArray(data.plans) || !Array.isArray(data.loose_items)) {
    return unavailable("The Planning read could not be verified. Nothing was changed.");
  }
  const sameItem = (raw: unknown, parent: string | null) => {
    const item = object(raw);
    return !!item && !!uuid(item.id) && uuid(item.tenant_id) === tenant
      && (parent === null ? item.plan_id === null : uuid(item.plan_id) === parent);
  };
  if (!data.plans.every(raw => {
    const plan = object(raw), id = uuid(plan?.id);
    return !!plan && !!id && uuid(plan.tenant_id) === tenant && Array.isArray(plan.items)
      && plan.items.every(item => sameItem(item, id));
  }) || !data.loose_items.every(item => sameItem(item, null))) {
    return unavailable("The current Planning records could not be verified. Nothing was changed.");
  }
  const observedAt = new Date().toISOString();
  const budget = Math.min(2000, context.receiptBudgetMs ?? 2000);
  if (!Number.isFinite(budget) || budget <= 0 || context.signal?.aborted) {
    return unavailable("The Planning read could not finish in this request. Nothing was changed.");
  }
  let recorded = false;
  try {
    const within = createWeeklyDraftDeadline(budget, () => !context.signal?.aborted);
    if (await within(context.isCurrent) !== true) return unavailable("The current workspace could not be verified. Read Planning again in the intended workspace; nothing was changed.");
    recorded = await within(context.recordRead);
    if (recorded === true && await within(context.isCurrent) !== true) return unavailable("The current workspace changed or could not be verified. Read Planning again in the intended workspace; nothing was changed.");
  } catch { recorded = false; /* unknown/expired receipt or scope: withhold facts */ }
  if (recorded !== true) return unavailable("The Planning lookup returned, but its read receipt could not be confirmed. Try the read again later; nothing was changed.");
  return { model: { status: "available", success: true, plans: data.plans, loose_items: data.loose_items,
    read_receipt: { run_id: context.runId, recorded: true, observed_at: observedAt, kind: "read_only" } },
    links: planningReadRecordLinks(tenant, data) };
}
