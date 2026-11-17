import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityMinutesFromHours, reviewWeeklyPlan, type WeeklyPlanReviewInput, type WeeklyPlanWork } from "./weekly-plan-review.ts";

const id = (n: number) => `e5020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), owner = id(2), other = id(3);
const work = (n: number, extra: Partial<WeeklyPlanWork> = {}): WeeklyPlanWork => ({
  key: `crm:${id(n)}`, tenantId: tenant, ownerId: owner, title: `Original task ${n}`,
  status: "open", priority: "normal", dueAt: null, updatedAt: "2026-11-03T12:00:00Z", minutes: 60, ...extra,
});
const input = (rows: WeeklyPlanWork[], extra: Partial<WeeklyPlanReviewInput> = {}): WeeklyPlanReviewInput => ({
  tenantId: tenant, startsOn: "2026-11-02", zone: "America/New_York", goal: "Finish the agreed client readiness work",
  work: rows, selected: rows.filter(r => r.status !== "done" && r.status !== "cancelled").map(r => r.key),
  capacities: { [owner]: 120 }, dependencies: {}, priorityOrder: [], estimates: {}, ...extra,
});

test("uses confirmed capacity and original urgency; never changes or schedules a record", () => {
  const rows = [work(10), work(11, { dueAt: "2026-11-03T16:00:00Z" }), work(12, { dueAt: "2026-11-06T16:00:00Z" })];
  const before = structuredClone(rows), result = reviewWeeklyPlan(input(rows));
  assert.equal(result.kind, "review");
  if (result.kind !== "review") return;
  assert.deepEqual(result.included.map(r => r.work.key), [rows[1].key, rows[2].key]);
  assert.deepEqual(result.overflow.map(r => r.work.key), [rows[0].key]);
  assert.equal(result.usedMinutes[owner], 120);
  assert.ok(result.included[0].reasons.some(r => r.includes("2026-11-03")));
  assert.equal(result.reservesTime, false); assert.deepEqual(rows, before);
});

test("orders actual selected dependencies before owner-ranked work and holds dependent overflow", () => {
  const a = work(10), b = work(11), c = work(12);
  const result = reviewWeeklyPlan(input([c, b, a], {
    priorityOrder: [c.key, b.key, a.key], dependencies: { [b.key]: [a.key], [c.key]: [b.key] },
  }));
  assert.equal(result.kind, "review"); if (result.kind !== "review") return;
  assert.deepEqual(result.included.map(r => r.work.key), [a.key, b.key]);
  assert.deepEqual(result.overflow.map(r => r.work.key), [c.key]);
  assert.equal(result.usedMinutes[owner], 120);
});

test("never assumes unknown effort, unknown availability or another person's capacity", () => {
  const a = work(10, { minutes: null }), b = work(11, { ownerId: other }), c = work(12);
  const result = reviewWeeklyPlan(input([a, b, c], { dependencies: { [c.key]: [a.key] } }));
  assert.equal(result.kind, "review"); if (result.kind !== "review") return;
  assert.equal(result.included.length, 0);
  assert.equal(result.held.find(r => r.work.key === a.key)?.reason, "effort_unknown");
  assert.equal(result.held.find(r => r.work.key === b.key)?.reason, "capacity_unknown");
  assert.equal(result.held.find(r => r.work.key === c.key)?.reason, "dependency_held");
});

test("handles verified completed prerequisites, blocked records, missing dependencies and cycles honestly", () => {
  const done = work(10, { status: "done" }), a = work(11), b = work(12), c = work(13, { status: "blocked" });
  const result = reviewWeeklyPlan(input([done, a, b, c], { dependencies: { [a.key]: [done.key], [b.key]: [`crm:${id(99)}`] } }));
  assert.equal(result.kind, "review"); if (result.kind !== "review") return;
  assert.deepEqual(result.included.map(r => r.work.key), [a.key]);
  assert.equal(result.held.find(r => r.work.key === b.key)?.reason, "dependency_unavailable");
  assert.equal(result.held.find(r => r.work.key === c.key)?.reason, "source_blocked");
  const cycle = reviewWeeklyPlan(input([a, b], { dependencies: { [a.key]: [b.key], [b.key]: [a.key] } }));
  assert.equal(cycle.kind, "review"); if (cycle.kind === "review") {
    assert.equal(cycle.included.length, 0); assert.ok(cycle.held.every(r => r.reason === "dependency_cycle"));
  }
});

test("owner corrections produce a different review while preserving source versions and independent per-owner budgets", () => {
  const a = work(10), b = work(11), c = work(12, { ownerId: other });
  const initial = input([a, b, c], { capacities: { [owner]: 60, [other]: 30 } });
  const before = structuredClone(initial), result = reviewWeeklyPlan({ ...initial, estimates: { [b.key]: 30, [c.key]: 30 }, priorityOrder: [b.key] });
  assert.equal(result.kind, "review"); if (result.kind !== "review") return;
  assert.deepEqual(result.included.map(r => r.work.key), [b.key, c.key]);
  assert.equal(result.usedMinutes[owner], 30); assert.equal(result.usedMinutes[other], 30);
  assert.equal(result.included[0].work.updatedAt, b.updatedAt); assert.deepEqual(initial, before);
  assert.notDeepEqual(reviewWeeklyPlan(initial), result);
});

test("rejects foreign/mixed, duplicate and stale-shaped source input before exposing a plan", () => {
  const a = work(10);
  for (const rows of [[a, work(11, { tenantId: id(99) })], [a, a], [work(10, { updatedAt: "yesterday" })], [work(10, { dueAt: "2026-11-03T12:00" })]]) {
    assert.equal(reviewWeeklyPlan(input(rows)).kind, "invalid");
  }
  for (const patch of [{ selected: [a.key, a.key] }, { selected: [`crm:${id(99)}`] }, { startsOn: "2026-11-03" }, { zone: "Not/AZone" },
    { capacities: { [owner]: -1 } }, { estimates: { [a.key]: 1.5 } }, { priorityOrder: [a.key, a.key] }]) {
    assert.equal(reviewWeeklyPlan(input([a], patch)).kind, "invalid");
  }
});

test("keeps zero estimates distinct, clips no obligations silently, and retains the civil week across DST", () => {
  const a = work(10, { minutes: 0 }), b = work(11, { dueAt: "2026-11-09T04:30:00Z" });
  const result = reviewWeeklyPlan(input([a, b], { capacities: { [owner]: 0 } }));
  assert.equal(result.kind, "review"); if (result.kind !== "review") return;
  assert.deepEqual(result.included.map(r => r.work.key), [a.key]);
  assert.equal(result.endsOn, "2026-11-08"); assert.equal(result.zone, "America/New_York");
  assert.equal(result.overflow.length, 1);
});

test("shares the original explicit quarter-hour capacity rule without inventing working hours", () => {
  for (const hours of ["", "-1", "169", "0.1", "1e2", "NaN"]) assert.equal(capacityMinutesFromHours(hours), null);
  for (const hours of ["0", "0.25", "1.5", "168"]) assert.equal(capacityMinutesFromHours(hours), Number(hours) * 60);
});
