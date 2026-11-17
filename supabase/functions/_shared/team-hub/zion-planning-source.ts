// A version/reference projection of the ORIGINAL caller-JWT plan_list result.
// This grants no authority and reads no database. Native staging binds it to the
// accepted turn and verifies the canonical rows before any model disclosure.
import { MENTOR_PLAN_MAX_ROWS, planReadArgumentsFor, type MentorPlanScope } from "./mentor-plan-read.ts";
import { boundedPlanningNavigation, type ReadRecordLink } from "../paige-turn/record-links.ts";

type Version = Readonly<{ id: string; updated_at: string }>;
export type ZionPlanningSource = Readonly<{
  tool: "plan_list"; version: 1;
  arguments: Readonly<Record<string, unknown>>;
  roster_tools: readonly string[];
  source: Readonly<{ plans: readonly (Version & { items: readonly Version[] })[]; loose_items: readonly Version[] }>;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
function dataObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(d => !("value" in d))
    ? null : value as Record<string, unknown>;
}

/** Existing source identities; Plan containers never masquerade as Work items. */
export function zionPlanningRecordLinks(source: ZionPlanningSource): ReadRecordLink[] {
  const links: ReadRecordLink[] = [...source.source.plans.flatMap(p => p.items), ...source.source.loose_items]
    .map(item => ({ destination: "operations_work", record_id: item.id, record_kind: "planning_item" }));
  links.push(...source.source.plans.map(plan => ({ destination: "operations_work" as const, record_id: plan.id, record_kind: "planning_plan" as const })));
  links.push({ destination: "operations_weekly_plan", record_id: null });
  return boundedPlanningNavigation(links);
}
function dataArray(value: unknown): unknown[] | null {
  return Array.isArray(value) && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => "value" in d)
    ? value : null;
}

export function captureZionPlanningSource(scope: Pick<MentorPlanScope, "tenantId" | "storedTools">,
  input: unknown, raw: unknown): ZionPlanningSource | null {
  try {
    const args = dataObject(input) && planReadArgumentsFor(input);
    const data = dataObject(raw), plans = dataArray(data?.plans), loose = dataArray(data?.loose_items);
    if (!args || !data || !plans || !loose || !UUID.test(scope.tenantId)
      || !dataArray(scope.storedTools) || scope.storedTools.length > 64 || !scope.storedTools.includes("plan_list")
      || scope.storedTools.some(t => typeof t !== "string" || !/^[a-z][a-z0-9_]{0,95}$/.test(t))
      || new Set(scope.storedTools).size !== scope.storedTools.length) return null;
    const seen = new Set<string>();
    const version = (value: unknown, parent?: string | null): Version | null => {
      const row = dataObject(value);
      if (!row || typeof row.id !== "string" || !UUID.test(row.id) || seen.has(row.id) || seen.size >= 120
        || row.tenant_id !== scope.tenantId || (parent !== undefined && row.plan_id !== parent)
        || typeof row.updated_at !== "string" || !TIME.test(row.updated_at) || !Number.isFinite(Date.parse(row.updated_at))) return null;
      seen.add(row.id);
      return Object.freeze({ id: row.id, updated_at: row.updated_at });
    };
    const boundPlans: Array<Version & { items: readonly Version[] }> = [];
    for (const row of plans.slice(0, MENTOR_PLAN_MAX_ROWS)) {
      const plan = dataObject(row), ref = version(plan), items = dataArray(plan?.items);
      if (!ref || !items) return null;
      const refs: Version[] = [];
      for (const item of items) { const refItem = version(item, ref.id); if (!refItem) return null; refs.push(refItem); }
      boundPlans.push(Object.freeze({ ...ref, items: Object.freeze(refs) }));
    }
    const boundLoose: Version[] = [];
    for (const row of loose.slice(0, MENTOR_PLAN_MAX_ROWS)) {
      const ref = version(row, null); if (!ref) return null; boundLoose.push(ref);
    }
    return Object.freeze({ tool: "plan_list", version: 1,
      arguments: Object.freeze({ ...args, limit: Math.min(args.limit as number, MENTOR_PLAN_MAX_ROWS),
        include_cancelled: args.include_cancelled === true || args.status === "cancelled" }),
      roster_tools: Object.freeze([...scope.storedTools]),
      source: Object.freeze({ plans: Object.freeze(boundPlans), loose_items: Object.freeze(boundLoose) }),
    });
  } catch { return null; }
}
