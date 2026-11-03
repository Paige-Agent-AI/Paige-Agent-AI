/** A bounded review of permitted original work, not an authority check or scheduler.
 * Callers supply current authorized source records and owner-confirmed constraints.
 * Nothing here writes work, reserves Calendar time or authorizes execution.
 */
export interface WeeklyPlanWork {
  key: string;
  tenantId: string;
  ownerId: string | null;
  title: string;
  status: "open" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "urgent" | "high" | "normal" | "low" | null;
  dueAt: string | null;
  updatedAt: string;
  minutes: number | null;
}

export interface WeeklyPlanReviewInput {
  tenantId: string;
  startsOn: string;
  zone: string;
  goal: string;
  work: WeeklyPlanWork[];
  selected: string[];
  /** Explicit net capacity after existing commitments, not inferred availability. */
  capacities: Record<string, number>;
  /** Owner-confirmed prerequisites, referencing original source identities. */
  dependencies: Record<string, string[]>;
  priorityOrder: string[];
  /** Proposal estimates only; these never replace the source record's estimate. */
  estimates: Record<string, number | null>;
}

type HoldReason = "dependency_cycle" | "dependency_unavailable" | "dependency_held" | "source_blocked" | "effort_unknown" | "capacity_unknown";
type ReviewedWork = { work: WeeklyPlanWork; minutes: number; reasons: string[] };
type HeldWork = { work: WeeklyPlanWork; reason: HoldReason };
export type WeeklyPlanReview = { kind: "invalid" } | {
  kind: "review"; startsOn: string; endsOn: string; zone: string; goal: string;
  included: ReviewedWork[]; overflow: ReviewedWork[]; held: HeldWork[];
  usedMinutes: Record<string, number>; reservesTime: false;
};

/** Same explicit quarter-hour input used by the original workload review. */
export function capacityMinutesFromHours(hours: string): number | null {
  const value = hours.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n <= 168 && Number.isInteger(n * 4) ? n * 60 : null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourceKey = /^(crm|planning):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const minutes = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2_147_483_647;
const unique = (keys: string[]) => new Set(keys).size === keys.length;
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export function reviewWeeklyPlan(input: WeeklyPlanReviewInput): WeeklyPlanReview {
  const invalid: WeeklyPlanReview = { kind: "invalid" };
  if (!input || !uuid.test(input.tenantId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 2000) return invalid;
  const start = new Date(`${input.startsOn}T12:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== input.startsOn || start.getUTCDay() !== 1) return invalid;
  let civilDate: Intl.DateTimeFormat;
  try { civilDate = new Intl.DateTimeFormat("en-CA", { timeZone: input.zone, year: "numeric", month: "2-digit", day: "2-digit" }); } catch { return invalid; }
  if (typeof input.zone !== "string" || !input.zone.trim() || !Array.isArray(input.work) || input.work.length > 400 || !Array.isArray(input.selected) || !Array.isArray(input.priorityOrder) || !plain(input.capacities) || !plain(input.dependencies) || !plain(input.estimates)) return invalid;
  const records = new Map<string, WeeklyPlanWork>();
  for (const row of input.work) {
    if (!row || !sourceKey.test(row.key) || row.tenantId !== input.tenantId || records.has(row.key) || (row.ownerId !== null && !uuid.test(row.ownerId)) || typeof row.title !== "string" || !row.title.trim() || row.title.length > 2000 || !["open", "in_progress", "blocked", "done", "cancelled"].includes(row.status) || (row.priority !== null && !["urgent", "high", "normal", "low"].includes(row.priority)) || !instant(row.updatedAt) || (row.dueAt !== null && !instant(row.dueAt)) || (row.minutes !== null && !minutes(row.minutes))) return invalid;
    records.set(row.key, row);
  }
  if (!unique(input.selected) || !unique(input.priorityOrder) || input.selected.some(k => typeof k !== "string" || !records.has(k) || ["done", "cancelled"].includes(records.get(k)!.status)) || input.priorityOrder.some(k => !input.selected.includes(k))) return invalid;
  const selected = new Set(input.selected);
  if (Object.entries(input.capacities).some(([k, v]) => !uuid.test(k) || !minutes(v) || v > 10080 || v % 15 !== 0) || Object.entries(input.estimates).some(([k, v]) => !selected.has(k) || v !== null && !minutes(v)) || Object.entries(input.dependencies).some(([k, v]) => !selected.has(k) || !Array.isArray(v) || v.length > 400 || !unique(v) || v.some(x => typeof x !== "string" || !sourceKey.test(x)))) return invalid;

  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const result: Extract<WeeklyPlanReview, { kind: "review" }> = {
    kind: "review", startsOn: input.startsOn, endsOn: end.toISOString().slice(0, 10), zone: input.zone, goal: input.goal.trim(),
    included: [], overflow: [], held: [], usedMinutes: {}, reservesTime: false,
  };
  // Detect cycles separately: downstream work is held for its prerequisite, not
  // falsely described as part of the cycle itself.
  const visiting = new Set<string>(), visited = new Set<string>(), cycles = new Set<string>(), stack: string[] = [];
  const detect = (key: string) => {
    if (visiting.has(key)) { for (const k of stack.slice(stack.indexOf(key))) cycles.add(k); return; }
    if (visited.has(key)) return;
    visiting.add(key); stack.push(key);
    for (const dep of input.dependencies[key] ?? []) if (selected.has(dep)) detect(dep);
    stack.pop(); visiting.delete(key); visited.add(key);
  };
  for (const key of selected) detect(key);
  const rank = new Map(input.priorityOrder.map((k, i) => [k, i]));
  const priorities = { urgent: 0, high: 1, normal: 2, low: 3 };
  const ordered = [...selected].sort((a, b) => {
    const x = records.get(a)!, y = records.get(b)!;
    return (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
      (x.dueAt ? Date.parse(x.dueAt) : Infinity) - (y.dueAt ? Date.parse(y.dueAt) : Infinity) ||
      (x.priority ? priorities[x.priority] : 4) - (y.priority ? priorities[y.priority] : 4) || a.localeCompare(b);
  });
  const disposition = new Map<string, "included" | "overflow" | "held">();
  const review = (key: string): void => {
    if (disposition.has(key)) return;
    const row = records.get(key)!;
    const hold = (reason: HoldReason) => { disposition.set(key, "held"); result.held.push({ work: { ...row }, reason }); };
    if (cycles.has(key)) return hold("dependency_cycle");
    if (row.status === "blocked") return hold("source_blocked");
    for (const dep of input.dependencies[key] ?? []) {
      const source = records.get(dep);
      if (source?.status === "done") continue;
      if (!source || !selected.has(dep) || source.status === "cancelled") return hold("dependency_unavailable");
      review(dep);
      if (disposition.get(dep) !== "included") return hold("dependency_held");
    }
    const estimate = owns(input.estimates, key) ? input.estimates[key] : row.minutes;
    if (estimate === null) return hold("effort_unknown");
    if (!row.ownerId || !owns(input.capacities, row.ownerId)) return hold("capacity_unknown");
    const reasons = [rank.has(key) ? "Owner-confirmed priority" : "Original work priority"];
    if (row.dueAt) reasons.push(`Original deadline ${civilDate.format(new Date(row.dueAt))} (${input.zone})`);
    if ((input.dependencies[key] ?? []).length) reasons.push("Confirmed prerequisites reviewed first");
    reasons.push(owns(input.estimates, key) ? "Owner-confirmed proposal estimate" : "Original recorded effort");
    const entry = { work: { ...row }, minutes: estimate, reasons };
    const used = result.usedMinutes[row.ownerId] ?? 0;
    if (used + estimate > input.capacities[row.ownerId]) { disposition.set(key, "overflow"); result.overflow.push(entry); return; }
    result.usedMinutes[row.ownerId] = used + estimate;
    disposition.set(key, "included"); result.included.push(entry);
  };
  for (const key of ordered) review(key);
  return result;
}
