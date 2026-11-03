import assert from "node:assert/strict";
// Original Planning-reference suite is explicitly hosted; retain Chat's joined
// producer/receipt/collector/history regression in that same owning suite.
import "../planning/read-record-links.test.ts";
import "../planning/read-record-links.integration.test.ts";
import { describe, it } from "node:test";
import { captureZionPlanningSource, zionPlanningRecordLinks } from "./zion-planning-source.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const VERSION = "2026-11-01T00:00:00.123456+00:00";
const scope = { tenantId: TENANT, storedTools: ["crm_list_tasks", "plan_list"] };
const source = () => ({ plans: [{ id: PLAN, tenant_id: TENANT, updated_at: VERSION,
  title: "Private source text", items: [{ id: ITEM, tenant_id: TENANT, plan_id: PLAN, updated_at: VERSION,
    description: "Never copy this into the attestation" }] }], loose_items: [] });

describe("ZION's closed original Planning source binding", () => {
  it("preserves exact source versions and original query without copying private source text or authority", () => {
    const raw = source();
    const result = captureZionPlanningSource(scope, { horizon: "week", limit: 200, status: "cancelled" }, raw)!;
    assert.equal(result.tool, "plan_list"); assert.equal(result.version, 1);
    assert.equal(result.arguments.limit, 30); assert.equal(result.arguments.include_cancelled, true);
    assert.deepEqual(result.source.plans, [{ id: PLAN, updated_at: VERSION, items: [{ id: ITEM, updated_at: VERSION }] }]);
    assert.deepEqual(result.roster_tools, scope.storedTools);
    assert.ok(!JSON.stringify(result).includes("Private source text"));
    assert.ok(!JSON.stringify(result).includes(TENANT));
    raw.plans[0].updated_at = "2026-11-01T00:00:00.123457+00:00";
    scope.storedTools.push("unrelated");
    assert.equal(result.source.plans[0].updated_at, VERSION);
    assert.deepEqual(result.roster_tools, ["crm_list_tasks", "plan_list"]);
    assert.deepEqual(zionPlanningRecordLinks(result), [{ destination: "operations_work", record_id: ITEM, record_kind: "planning_item" },
      { destination: "operations_work", record_id: PLAN, record_kind: "planning_plan" }, { destination: "operations_weekly_plan", record_id: null }]);
    scope.storedTools.pop();
  });

  it("accepts a genuine empty source and the original bounded loose-item presentation", () => {
    assert.deepEqual(captureZionPlanningSource(scope, {}, { plans: [], loose_items: [] })!.source,
      { plans: [], loose_items: [] });
    const loose = Array.from({ length: 31 }, (_, i) => ({ id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
      tenant_id: TENANT, plan_id: null, updated_at: VERSION }));
    const bound = captureZionPlanningSource(scope, {}, { plans: [], loose_items: loose })!;
    assert.equal(bound.source.loose_items.length, 30);
    assert.equal(zionPlanningRecordLinks(bound).length, 6);
  });

  for (const mutation of [
    (raw: ReturnType<typeof source>) => { raw.plans[0].tenant_id = PLAN; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].items[0].tenant_id = PLAN; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].items[0].plan_id = ITEM; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].updated_at = "2026-11-01"; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].updated_at = "2026-11-01T00:00:00.1234567Z"; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].items[0].updated_at = "invalid"; },
    (raw: ReturnType<typeof source>) => { raw.plans[0].items.push({ ...raw.plans[0].items[0] }); },
    (raw: ReturnType<typeof source>) => { raw.plans.push({ ...raw.plans[0] }); },
  ]) it("refuses a foreign, malformed or duplicate source before native staging", () => {
    const raw = source(); mutation(raw);
    assert.equal(captureZionPlanningSource(scope, {}, raw), null);
  });

  it("refuses missing source versions, incomplete shapes and unsupported query/roster arguments", () => {
    for (const raw of [null, {}, { plans: [], loose_items: null }, { plans: [{ id: PLAN, items: [] }], loose_items: [] }]) {
      assert.equal(captureZionPlanningSource(scope, {}, raw), null);
    }
    assert.equal(captureZionPlanningSource(scope, { tenant_id: TENANT }, source()), null);
    assert.equal(captureZionPlanningSource({ ...scope, storedTools: [] }, {}, source()), null);
    assert.equal(captureZionPlanningSource({ ...scope, storedTools: ["plan_list", "plan_list"] }, {}, source()), null);
  });

  it("bounds nested source references before exposure rather than silently dropping evidence", () => {
    const raw = source();
    raw.plans[0].items = Array.from({ length: 120 }, (_, i) => ({ ...raw.plans[0].items[0],
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}` }));
    assert.equal(captureZionPlanningSource(scope, {}, raw), null);
    raw.plans[0].items.pop();
    assert.equal(captureZionPlanningSource(scope, {}, raw)!.source.plans[0].items.length, 119);
  });

  it("refuses source accessors and non-data objects without invoking them", () => {
    let invoked = false;
    const raw = source();
    Object.defineProperty(raw.plans[0], "updated_at", { get() { invoked = true; return VERSION; } });
    assert.equal(captureZionPlanningSource(scope, {}, raw), null);
    assert.equal(invoked, false);
    assert.equal(captureZionPlanningSource(scope, {}, new Date()), null);
  });
});
