import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finishPlanningChatRead, planningReadRecordLinks } from "./read-record-links.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, plan: string | null = null) => ({ id: id(n), tenant_id: tenant, plan_id: plan,
  title: "Private source text must never enter a reference", status: "open" });
const link = (n: number) => ({ destination: "operations_work", record_id: id(n), record_kind: "planning_item" });
const reviewLink = { destination: "operations_weekly_plan", record_id: null };

describe("original caller-scoped Planning read navigation", () => {
  it("projects original items and a distinctly typed Plan container, never text or a URL", () => {
    const result = { plans: [{ id: id(9), tenant_id: tenant, items: [item(1, id(9))] }], loose_items: [item(2)] };
    assert.deepEqual(planningReadRecordLinks(tenant, result), [link(1), link(2), { destination: "operations_work", record_id: id(9), record_kind: "planning_plan" }, reviewLink]);
  });
  it("withholds foreign tenants and mismatched parent identities", () => {
    const result = { plans: [{ id: id(9), tenant_id: tenant,
      items: [item(1, id(8)), { ...item(2, id(9)), tenant_id: foreign }] },
      { id: id(8), tenant_id: foreign, items: [item(3, id(8))] }],
      loose_items: [{ ...item(4), tenant_id: foreign }, item(5, id(9)), item(6)] };
    assert.deepEqual(planningReadRecordLinks(tenant, result), [link(6), reviewLink]);
  });
  it("accepts only original UUIDs, deduplicates and preserves the existing six-link cap", () => {
    const result = { plans: [], loose_items: [item(1), item(1), { ...item(2), id: "https://example.invalid/" },
      ...Array.from({ length: 8 }, (_, n) => item(n + 2))] };
    assert.deepEqual(planningReadRecordLinks(tenant, result), [1, 2, 3, 4, 5, 6].map(link));
  });
  for (const result of [null, [], { success: false, plans: [], loose_items: [item(1)] },
    { plans: null, loose_items: [item(1)] }, { plans: [], loose_items: null }]) {
    it(`withholds malformed or refused results ${JSON.stringify(result)}`, () => {
      assert.deepEqual(planningReadRecordLinks(tenant, result), []);
    });
  }
  it("does not accept an absent or invalid server workspace", () => {
    assert.deepEqual(planningReadRecordLinks("", { plans: [], loose_items: [item(1)] }), []);
  });
});

describe("original Planning read receipt before model disclosure", () => {
  const runId = id(99);
  it("acknowledges the original receipt and preserves genuine source rows and typed references", async () => {
    const raw = { plans: [], loose_items: [item(1)] }; let calls = 0;
    const result = await finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, recordRead: async () => { calls++; return true; } }, raw);
    assert.equal(calls, 1); assert.equal(result.model.status, "available");
    assert.deepEqual(result.model.loose_items, raw.loose_items); assert.deepEqual(result.links, [link(1), reviewLink]);
    const receipt = result.model.read_receipt as { run_id: string; recorded: boolean; kind: string; observed_at: string };
    assert.equal(receipt.run_id, runId); assert.equal(receipt.recorded, true); assert.equal(receipt.kind, "read_only");
    assert.ok(Number.isFinite(Date.parse(receipt.observed_at)));
  });
  it("distinguishes an authoritative empty read from an unavailable lookup", async () => {
    const result = await finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, recordRead: async () => true }, { plans: [], loose_items: [] });
    assert.equal(result.model.status, "available"); assert.deepEqual(result.links, [reviewLink]);
    assert.deepEqual(result.model.plans, []); assert.deepEqual(result.model.loose_items, []);
  });
  for (const failure of [false, "unknown"] as const) it(`withholds facts and references on ${failure} receipt`, async () => {
    const result = await finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, recordRead: async () => {
      if (failure === "unknown") throw Error("response lost"); return false;
    } }, { plans: [], loose_items: [item(1)] });
    assert.equal(result.model.status, "unavailable"); assert.equal(result.model.success, false);
    assert.deepEqual(result.links, []); assert.equal("loose_items" in result.model, false);
    assert.equal("read_receipt" in result.model, false, "unknown is never reported as recorded");
  });
  for (const raw of [{ plans: [], loose_items: [{ ...item(1), tenant_id: foreign }] },
    { plans: [{ id: id(9), tenant_id: tenant, items: [item(1, id(8))] }], loose_items: [] },
    { plans: null, loose_items: [] }, { success: false, plans: [], loose_items: [] }]) {
    it("rejects scope/refusal/shape drift before recording or disclosing facts " + JSON.stringify(raw), async () => {
      let recorded = false;
      const result = await finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, recordRead: async () => { recorded = true; return true; } }, raw);
      assert.equal(recorded, false); assert.equal(result.model.status, "unavailable"); assert.deepEqual(result.links, []);
    });
  }
  it("does not start a receipt after the existing request budget or cancellation", async () => {
    for (const options of [{ receiptBudgetMs: 0 }, { signal: AbortSignal.abort() }]) {
      let called = false;
      const result = await finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, ...options,
        recordRead: async () => { called = true; return true; } }, { plans: [], loose_items: [] });
      assert.equal(called, false); assert.equal(result.model.status, "unavailable");
    }
  });
  it("does not release facts when a completed receipt arrives after interruption", async () => {
    const controller = new AbortController(); let release!: (value: boolean) => void;
    let started!: () => void; const receiptStarted = new Promise<void>(resolve => { started = resolve; });
    const pending = finishPlanningChatRead({ tenantId: tenant, runId, isCurrent: async () => true, signal: controller.signal,
      recordRead: () => new Promise<boolean>(resolve => { release = resolve; started(); }) }, { plans: [], loose_items: [item(1)] });
    await receiptStarted; controller.abort(); release(true);
    const result = await pending;
    assert.equal(result.model.status, "unavailable"); assert.deepEqual(result.links, []);
    assert.equal("loose_items" in result.model, false);
  });
  it("withholds an acknowledged read when the final currentness check throws", async () => {
    let checks = 0;
    const result = await finishPlanningChatRead({ tenantId: tenant, runId, recordRead: async () => true,
      isCurrent: async () => { if (++checks === 2) throw Error("authority response lost"); return true; } },
      { plans: [], loose_items: [item(1)] });
    assert.equal(checks, 2); assert.equal(result.model.status, "unavailable");
    assert.equal("loose_items" in result.model, false); assert.equal("read_receipt" in result.model, false);
    assert.deepEqual(result.links, []);
  });
});
