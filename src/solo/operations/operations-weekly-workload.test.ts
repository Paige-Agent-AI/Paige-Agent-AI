import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { operationsWeek } from "./operations-week";
import { weeklyWorkload } from "./operations-weekly-workload";

const planning = { id: "same-id", tenant_id: "test-tenant", title: "Review delivery", item_type: "task", status: "blocked",
  assigned_to_user_id: "owner-a", due_at: "2026-11-01T06:30:00Z", remind_at: null, updated_at: "2026-10-28T12:00:00Z" } as PlanItem;
const task = { id: "same-id", tenant_id: "test-tenant", user_id: "owner-a", title: "Prepare workshop", status: "pending",
  due_date: "2026-10-30T14:00:00Z", estimated_minutes: 90, updated_at: "2026-10-28T12:00:00Z" } as CrmWorkRecord;
const week = (items = [planning], tasks = [task]) => {
  const value = operationsWeek("test-tenant", items, tasks, { kind: "configured", date: "2026-10-29", zone: "America/New_York" });
  if (value.kind !== "ready") throw new Error("Expected the original business week");
  return value;
};
describe("weekly workload as a bounded review of original Work", () => {
  it("requires explicit capacity and keeps absent Planning effort unknown", () => {
    const result = weeklyWorkload(week(), "owner-a", "");
    expect(result.knownMinutes).toBe(90); expect(result.capacityMinutes).toBeNull();
    expect(result.missing).toBe(1); expect(result.blocked).toBe(1); expect(result.overBy).toBeNull();
  });
  it("corrects a what-if estimate without touching saved records or mixing native identities", () => {
    const before = structuredClone([planning, task]);
    const value = weeklyWorkload(week(), "owner-a", "2", { "planning:same-id": "45", "crm:same-id": "60" });
    expect(value.knownMinutes).toBe(105); expect(value.overBy).toBe(0); expect(value.missing).toBe(0);
    expect(value.rows.find(row => row.work.native.source === "crm")!.work.native.record).toBe(task);
    expect([planning, task]).toEqual(before);
    expect(weeklyWorkload(week(), "owner-a", "2").knownMinutes).toBe(90);
  });
  it("reports excess known effort even while other effort is unknown", () => {
    const value = weeklyWorkload(week(), "owner-a", "1");
    expect(value.overBy).toBe(30); expect(value.missing).toBe(1);
  });
  it("never borrows another person's work or a reminder as workload", () => {
    const value = week([{ ...planning, item_type: "reminder", remind_at: planning.due_at }, { ...planning, id: "foreign-owner", assigned_to_user_id: "owner-b" }]);
    expect(weeklyWorkload(value, "owner-a", "0").rows.map(row => row.work.native.source)).toEqual(["crm"]);
    expect(weeklyWorkload(value, "", "10").rows).toEqual([]);
    expect(weeklyWorkload(value, "owner-b", "1").rows).toHaveLength(1);
  });
  it("exposes earlier, undated and unreadable work without pretending it fits this week", () => {
    const value = week([{ ...planning, id: "undated", due_at: null }, { ...planning, id: "bad", due_at: "2026-10-29T09:00" },
      { ...planning, id: "earlier", due_at: "2026-10-24T14:00:00Z" }, { ...planning, id: "future", due_at: "2026-11-04T14:00:00Z" }]);
    expect(weeklyWorkload(value, "owner-a", "1")).toMatchObject({ earlier: 1, undated: 1, unreadable: 1 });
    expect(weeklyWorkload(value, "owner-a", "1").rows).toHaveLength(1);
  });
  it("retains original tenant and DST boundaries and excludes completed work", () => {
    const value = week([planning, { ...planning, id: "finished", status: "done" }], [{ ...task, id: "cancelled", status: "cancelled" }]);
    expect(weeklyWorkload(value, "owner-a", "1").rows.map(row => row.work.title)).toEqual([planning.title]);
    expect(() => week([{ ...planning, tenant_id: "other-tenant" }])).toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
  });
  it.each(["-1", "169", "0.1", "1e2", "NaN", "Infinity", "", "   "])("withholds invalid or absent hours %j", hours => {
    const value = weeklyWorkload(week(), "owner-a", hours);
    expect(value.capacityMinutes).toBeNull(); expect(value.overBy).toBeNull();
    expect(value.invalidCapacity).toBe(hours.trim() !== "");
  });
  it.each(["0", "0.25", "1.5", "168"])("accepts explicit quarter hours %s", hours => {
    expect(weeklyWorkload(week(), "owner-a", hours).capacityMinutes).toBe(Number(hours) * 60);
  });
  it.each(["-1", "1.5", "1e2", "2147483648"])("refuses a malformed revised estimate %s", text => {
    expect(weeklyWorkload(week(), "owner-a", "2", { "crm:same-id": text }).rows[0]).toMatchObject({ minutes: null, invalid: true });
  });
  it("distinguishes a deliberate zero from clearing an original saved estimate", () => {
    expect(weeklyWorkload(week(), "owner-a", "0", { "crm:same-id": "0" }).rows[0].minutes).toBe(0);
    expect(weeklyWorkload(week(), "owner-a", "1", { "crm:same-id": "" }).rows[0]).toMatchObject({ minutes: null, invalid: false, revised: true });
    expect(task.estimated_minutes).toBe(90);
  });
});
