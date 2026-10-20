import { expect, it } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { overviewNativeWork, operationsWorkSetRows } from "./operations-overview-work";

const tenant = "test-tenant-routing";
const now = Date.parse("2026-11-01T06:00:00Z");
const planning = (id: string, overrides: Partial<PlanItem> = {}) => ({ id, tenant_id: tenant,
  title: id, status: "open", priority: "normal", item_type: "task", due_at: null,
  ...overrides } as PlanItem);
const crm = (id: string, overrides: Partial<CrmWorkRecord> = {}) => ({ id, tenant_id: tenant,
  title: id, status: "pending", recorded_priority: null, due_date: null,
  ...overrides } as CrmWorkRecord);

it("opens every loaded upcoming deadline rather than only the five-row summary", () => {
  const items = Array.from({ length: 8 }, (_, i) => planning(`deadline-${i}`, {
    due_at: `2026-11-${String(i + 2).padStart(2, "0")}T13:00:00Z`,
  }));
  const work = overviewNativeWork(tenant, items, [], now);
  expect(work.upcoming).toHaveLength(5);
  const all = operationsWorkSetRows(work, "deadlines");
  expect(all).toHaveLength(8);
  expect(all.map(row => row.native.record)).toEqual(items);
  expect(all[7].native.record).toBe(items[7]);
});

it("preserves original source identities across blocked and overdue work", () => {
  const blocker = planning("same", { status: "blocked" });
  const late = crm("same", { due_date: "2026-11-01T01:30:00-04:00" });
  const later = crm("later", { due_date: "2026-11-01T01:30:00-05:00" });
  const work = overviewNativeWork(tenant, [blocker], [late, later,
    crm("finished", { status: "completed", due_date: late.due_date })], now);
  const attention = operationsWorkSetRows(work, "attention");
  expect(new Set(attention.map(row => row.id))).toEqual(new Set(["planning:same", "crm:same"]));
  expect(attention.find(row => row.id === "planning:same")?.native.record).toBe(blocker);
  expect(attention.find(row => row.id === "crm:same")?.native.record).toBe(late);
  expect(operationsWorkSetRows(work, "deadlines").map(row => row.native.record)).toEqual([later]);
});

it("separates undated active work and saved reminders without substituting a legacy due date", () => {
  const undated = crm("undated");
  const malformed = planning("invalid", { due_at: "invalid" });
  const reminder = planning("reminder", { item_type: "reminder", due_at: "2000-01-01T00:00:00Z",
    remind_at: "2099-01-01T13:00:00Z" });
  const work = overviewNativeWork(tenant, [malformed, reminder, planning("closed", { status: "done" })], [undated], now);
  expect(operationsWorkSetRows(work, "timing").map(row => row.native.record)).toEqual(expect.arrayContaining([undated, malformed]));
  expect(operationsWorkSetRows(work, "timing")).toHaveLength(2);
  expect(operationsWorkSetRows(work, "reminders").map(row => row.native.record)).toEqual([reminder]);
  expect(operationsWorkSetRows(work, "attention")).toEqual([]);
  expect(operationsWorkSetRows(work, "deadlines")).toEqual([]);
});

it("does not turn an empty loaded set into business-wide completion", () => {
  const work = overviewNativeWork(tenant, [], [], now);
  for (const group of ["attention", "deadlines", "timing", "reminders"] as const) {
    expect(operationsWorkSetRows(work, group)).toEqual([]);
  }
});

it("keeps the existing mixed-tenant refusal before any group can be presented", () => {
  expect(() => overviewNativeWork(tenant, [], [crm("foreign", { tenant_id: "test-tenant-foreign" })], now))
    .toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
});
