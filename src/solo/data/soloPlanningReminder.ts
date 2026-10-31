import { readWeeklyPlanningSource } from "../operations/operations-weekly-source";
import type { PlanItem } from "@/hooks/usePlanList";

const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const keys = ["tenant_id", "plan_item_id", "plan_id", "source", "reminder_claimed_at",
  "scheduled_remind_at", "claim_source_version", "remind_target"];

// Occurrence equality must retain PostgreSQL microseconds and permit equivalent offsets.
// Date.parse alone rounds distinct occurrences and normalizes invalid calendar dates.
function instant(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59 || Number(m[10] ?? 0) > 23 || Number(m[11] ?? 0) > 59) return null;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const offset = (Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0)) * (m[9] === "-" ? -1 : 1);
  return BigInt(utc.getTime() - offset * 60_000) * 1000n + BigInt((m[7] ?? "").padEnd(6, "0"));
}

export type SoloPlanningReminderRead = { kind: "verified"; item: PlanItem } | { kind: "unavailable" };

/** Notification metadata is an address, never authority or a source of private prose.
 * The caller must separately admit the original notification recipient/read-state row.
 * This consumer creates no notification, scheduler, permission, task or read-state writer.
 */
export async function readSoloPlanningReminder(metadata: unknown,
  scope: { actorId: string; tenantId: string }, isCurrent: () => boolean): Promise<SoloPlanningReminderRead> {
  const unavailable: SoloPlanningReminderRead = { kind: "unavailable" };
  const origin = { ...scope };
  try {
    if (!uuid(origin.actorId) || !uuid(origin.tenantId) || !isCurrent()
      || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return unavailable;
    const data = metadata as Record<string, unknown>;
    if (Object.keys(data).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(data, key))
      || data.source !== "paige_planning" || !uuid(data.tenant_id) || !uuid(data.plan_item_id)
      || data.tenant_id.toLowerCase() !== origin.tenantId.toLowerCase()
      || (data.plan_id !== null && !uuid(data.plan_id)) || typeof data.remind_target !== "string"
      || !data.remind_target || instant(data.claim_source_version) === null) return unavailable;
    // Capture before awaiting: caller mutation cannot redirect a pending occurrence.
    const address = { tenant: data.tenant_id.toLowerCase(), item: data.plan_item_id.toLowerCase(),
      plan: typeof data.plan_id === "string" ? data.plan_id.toLowerCase() : null,
      claimed: instant(data.reminder_claimed_at), scheduled: instant(data.scheduled_remind_at), target: data.remind_target };
    if (address.claimed === null || address.scheduled === null) return unavailable;
    const result = await readWeeklyPlanningSource({ actorId: origin.actorId, tenantId: address.tenant, itemId: address.item }, isCurrent);
    if (!isCurrent() || result.kind !== "verified") return unavailable;
    const item = result.item;
    if (item.id !== address.item || item.tenant_id !== address.tenant || item.plan_id !== address.plan
      || item.status === "done" || item.status === "cancelled" || item.remind_target !== address.target
      || instant(item.reminded_at) !== address.claimed || instant(item.remind_at) !== address.scheduled) return unavailable;
    // claim_source_version is claim-stage only; later legitimate bookkeeping can change updated_at.
    // Private title/summary come exclusively from the original current authorized resource read.
    return { kind: "verified", item };
  } catch { return unavailable; }
}
