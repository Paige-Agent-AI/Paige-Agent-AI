import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/hooks/usePlanList";
import type { CrmWorkRecord } from "./operations-native-work";
import { operationsWeek } from "./operations-week";

const tenant = "business-a";
const calendar = (date = "2026-10-21", zone = "America/New_York") => ({ kind: "configured" as const, date, zone });
const item = (id: string, due_at: string | null, patch: Partial<PlanItem> = {}): PlanItem => ({ id, tenant_id: tenant,
  plan_id: null, item_type: "task", assigned_to_user_id: null, contact_id: null, title: id, summary: null,
  status: "open", priority: "normal", due_at, remind_at: null, remind_target: null, reminded_at: null,
  created_by: null, linked_action_id: null, updated_at: "2026-10-21T00:00:00Z", ...patch });
const ready = (items: PlanItem[], day = calendar(), offset = 0, tasks: CrmWorkRecord[] = []) => {
  const result = operationsWeek(tenant, items, tasks, day, offset);
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("Expected a confirmed calendar");
  return result;
};

describe("original Work in the confirmed business-calendar week", () => {
  it("uses business midnight and retains the exact native record, without changing it", () => {
    const source = item("near-midnight", "2026-10-22T02:00:00Z");
    const before = structuredClone(source);
    const week = ready([source]);
    expect(week.days.map(day => day.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(week.days[2].deadlines[0].native.record).toBe(source);
    expect(week.days[3].deadlines).toEqual([]); expect(source).toEqual(before);
  });
  it("retains Sunday/weekend work across the year boundary", () => {
    const week = ready([item("sunday", "2027-01-04T03:00:00Z")], calendar("2027-01-03"));
    expect(week.days[0].date).toBe("2026-12-28"); expect(week.days[6].date).toBe("2027-01-03");
    expect(week.days[6].deadlines[0].id).toBe("planning:sunday");
  });
  it.each(["2026-03-08", "2026-11-01"])("keeps seven business dates across DST week %s", date => {
    const zone = calendar(date); const week = ready([], zone);
    expect(new Set(week.days.map(day => day.date)).size).toBe(7);
    expect(week.days[6].date).toBe(date);
  });
  it("places both repeated fall-back instants on Sunday in canonical instant order", () => {
    const week = ready([item("second", "2026-11-01T06:30:00Z"), item("first", "2026-11-01T05:30:00Z")], calendar("2026-11-01"));
    expect(week.days[6].deadlines.map(row => row.id)).toEqual(["planning:first", "planning:second"]);
  });
  it("uses another confirmed business zone rather than the computer's zone", () => {
    const week = ready([item("next-day", "2026-10-21T12:30:00Z")], calendar("2026-10-22", "Pacific/Auckland"));
    expect(week.days[3].deadlines[0].id).toBe("planning:next-day");
  });
  it("keeps reminder times separate from a misleading legacy due_at", () => {
    const reminder = item("reminder", "2026-10-19T12:00:00Z", { item_type: "reminder", remind_at: "2026-10-22T14:00:00Z" });
    const week = ready([reminder]);
    expect(week.days.flatMap(day => day.deadlines)).toEqual([]);
    expect(week.days[3].reminders[0].native.record).toBe(reminder);
  });
  it("separates missing, malformed, outside-week and completed work without inventing availability", () => {
    const week = ready([item("undated", null), item("unknown", "not-a-date"), item("ambiguous", "2026-10-21T10:00:00"),
      item("outside", "2026-10-27T12:00:00Z"), item("done", "2026-10-21T12:00:00Z", { status: "done" }),
      item("cancelled", "2026-10-21T12:00:00Z", { status: "cancelled" })]);
    expect(week.undated.map(row => row.id)).toEqual(["planning:undated"]);
    expect(week.unavailable.map(row => row.id)).toEqual(["planning:unknown", "planning:ambiguous"]);
    expect(week.outside.map(row => row.id)).toEqual(["planning:outside"]);
    expect(week.days.flatMap(day => day.deadlines)).toEqual([]);
  });
  it("changes the displayed week without changing the saved deadline", () => {
    const source = item("next", "2026-10-27T12:00:00Z"); const week = ready([source], calendar(), 1);
    expect(week.days[0].date).toBe("2026-10-26"); expect(week.days[1].deadlines[0].native.record).toBe(source);
    expect(source.due_at).toBe("2026-10-27T12:00:00Z");
  });
  it("retains the CRM identity and does not confuse equal IDs from different native stores", () => {
    const task: CrmWorkRecord = { id: "same", tenant_id: tenant, user_id: "owner", title: "CRM", description: null,
      status: "pending", due_date: "2026-10-21T12:00:00Z", updated_at: null, created_at: null, deal_id: null,
      biz_id: null, recorded_priority: null, estimated_minutes: null };
    const week = ready([item("same", task.due_date)], calendar(), 0, [task]);
    expect(week.days[2].deadlines.map(row => row.id)).toEqual(["crm:same", "planning:same"]);
    expect(week.days[2].deadlines[0].native.record).toBe(task);
  });
  it.each(["loading", "missing", "invalid", "refused", "unreadable", "no_workspace"] as const)("withholds the week when the original zone reader says %s", reason => {
    expect(operationsWeek(tenant, [], [], { kind: "withheld", reason, canSet: false })).toEqual({ kind: "withheld", reason });
  });
  it.each([calendar("2026-02-30"), calendar("2026-10-21", "Unrecognised/Zone")])("does not substitute a calendar for invalid settings", day => {
    expect(operationsWeek(tenant, [], [], day).kind).toBe("withheld");
  });
  it("rejects foreign records even when the calendar is unavailable", () => {
    const foreign = item("foreign", null, { tenant_id: "business-b" });
    expect(() => operationsWeek(tenant, [foreign], [], { kind: "withheld", reason: "missing", canSet: false })).toThrow("OPERATIONS_WORK_SCOPE_CHANGED");
  });
  it.each([Number.NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])("withholds invalid week offset %s without allocating or guessing dates", offset => {
    expect(operationsWeek(tenant, [], [], calendar(), offset)).toEqual({ kind: "withheld", reason: "invalid" });
  });
});
