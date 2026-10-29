// Source/API composition tests, not authenticated tenant/native-publication proof.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLANNING_READ_TOOLS } from "../paige-spine/domains/planning.ts";
import { readZionPlans, zionPlanReadTools, type ZionPlanningDeps, type ZionPlanningScope } from "./zion-planning-read.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const PLAN = "55555555-5555-4555-8555-555555555555";
const scope = (): ZionPlanningScope => ({ agent: "zion", where: "agent_dm", tenantId: TENANT, actorId: ACTOR, storedTools: ["plan_list"] });
function ports(over: Partial<ZionPlanningDeps> = {}) {
  const events: string[] = [], rpcArgs: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const deps: { -readonly [K in keyof ZionPlanningDeps]: ZionPlanningDeps[K] } = {
    caller: { rpc: async (name, args) => {
      events.push(`rpc:${name}`); rpcArgs.push({ name, args });
      return { data: name === "current_user_tenant_id" ? TENANT : { plans: [{ id: PLAN, title: "Prepare launch", items: [] }], loose_items: [] }, error: null };
    } },
    isCurrent: async captured => { events.push("scope"); return captured.tenantId === TENANT && captured.actorId === ACTOR; },
    takeRead: () => { events.push("budget"); return true; },
    recordRead: async tool => { assert.equal(tool, "plan_list"); events.push("receipt"); return true; },
    stageReadContext: async captured => { events.push("stage"); return captured.tenantId === TENANT; },
    ...over,
  };
  return { deps, events, rpcArgs };
}
const privateRows = (value: { model: Record<string, unknown> }) => "plans" in value.model || "loose_items" in value.model;

describe("ZION reuses the original Planning reader behind current native publication", () => {
  it("offers the original canonical definition only to the current ZION private DM scope", async () => {
    const p = ports();
    const offered = await zionPlanReadTools(scope(), p.deps);
    assert.equal(offered.length, 1);
    assert.equal(offered[0], PLANNING_READ_TOOLS[0], "never copy or redefine the canonical tool");
    for (const bad of [
      { ...scope(), agent: "mentor" }, { ...scope(), where: "channel" },
      { ...scope(), tenantId: "invalid" }, { ...scope(), storedTools: [] },
    ]) assert.deepEqual(await zionPlanReadTools(bad as ZionPlanningScope, p.deps), []);
    assert.deepEqual(await zionPlanReadTools(scope(), ports({ isCurrent: async () => false }).deps), []);
    assert.equal(p.rpcArgs.length, 0, "offering never reads plans or stages a result");
  });

  it("runs the original caller-JWT read and stages the same scope before exposing its model result", async () => {
    const p = ports();
    const read = await readZionPlans(scope(), p.deps, "plan_list", { horizon: "week" });
    assert.equal(read.model.success, true);
    assert.equal(privateRows(read), true);
    assert.deepEqual(p.rpcArgs.map(r => r.name), ["plan_list", "current_user_tenant_id"]);
    assert.equal(p.rpcArgs[0].args?.p_tenant_id, TENANT);
    assert.equal(p.rpcArgs[0].args?.p_limit, 30, "retain the original canonical reader cap");
    assert.ok(p.events.indexOf("receipt") < p.events.indexOf("rpc:plan_list"));
    assert.ok(p.events.indexOf("stage") > p.events.indexOf("rpc:current_user_tenant_id"));
    assert.equal(await read.revalidate(), true);
  });

  it("withholds all plan rows on a refused or uncertain native stage, without replay", async () => {
    for (const failure of [false, new Error("stage response unavailable")]) {
      let attempts = 0;
      const p = ports({ stageReadContext: async () => { attempts++; if (failure instanceof Error) throw failure; return failure; } });
      const read = await readZionPlans(scope(), p.deps, "plan_list", {});
      assert.equal(privateRows(read), false);
      assert.equal(read.model.status, "unavailable");
      assert.equal(await read.revalidate(), false);
      assert.equal(attempts, 1);
      assert.equal(p.rpcArgs.filter(r => r.name === "plan_list").length, 1);
    }
  });

  it("does not treat an unrecognized truthy staging reply as verified native publication", async () => {
    const p = ports({ stageReadContext: async () => ({ ok: true }) as unknown as boolean });
    const read = await readZionPlans(scope(), p.deps, "plan_list", {});
    assert.equal(privateRows(read), false);
    assert.equal(await read.revalidate(), false);
  });

  it("keeps the original receipt refusal ahead of the domain RPC", async () => {
    const p = ports({ recordRead: async () => false });
    const read = await readZionPlans(scope(), p.deps, "plan_list", {});
    assert.equal(privateRows(read), false);
    assert.deepEqual(p.rpcArgs, []);
    assert.ok(!p.events.includes("stage"));
  });

  it("rechecks the exact captured scope after the canonical read and after native staging", async () => {
    for (const stop of ["rpc:current_user_tenant_id", "stage"]) {
      const p = ports();
      p.deps.isCurrent = async () => !p.events.includes(stop);
      const read = await readZionPlans(scope(), p.deps, "plan_list", {});
      assert.equal(privateRows(read), false, stop);
      assert.equal(await read.revalidate(), false, stop);
    }
  });

  it("a result's later publication check re-resolves current authority", async () => {
    let current = true;
    const p = ports({ isCurrent: async () => current });
    const read = await readZionPlans(scope(), p.deps, "plan_list", {});
    assert.equal(read.model.success, true);
    current = false;
    assert.equal(await read.revalidate(), false);
    assert.equal(p.rpcArgs.length, 2, "revalidation is scope proof, not another plan read");
  });

  it("snapshots arguments and scope before waiting, preserving original requested history semantics", async () => {
    const original = { ...scope(), storedTools: ["plan_list"] }, input = { plan_id: PLAN, status: "cancelled" };
    let first = true;
    const p = ports({ isCurrent: async captured => {
      if (first) { first = false; original.tenantId = "99999999-9999-4999-8999-999999999999"; original.storedTools.length = 0; input.plan_id = "66666666-6666-4666-8666-666666666666"; }
      return captured.tenantId === TENANT && captured.storedTools.includes("plan_list");
    } });
    const read = await readZionPlans(original, p.deps, "plan_list", input);
    assert.equal(read.model.success, true);
    assert.equal(p.rpcArgs[0].args?.p_plan_id, PLAN);
    assert.equal(p.rpcArgs[0].args?.p_include_cancelled, true);
    assert.equal(p.rpcArgs[0].args?.p_tenant_id, TENANT);
  });

  it("uses the host's shared private-read budget, rather than resetting it for each call", async () => {
    let left = 3;
    const p = ports({ takeRead: () => left-- > 0 });
    const reads: Awaited<ReturnType<typeof readZionPlans>>[] = [];
    for (let i = 0; i < 4; i++) reads.push(await readZionPlans(scope(), p.deps, "plan_list", {}));
    assert.equal(reads.filter(privateRows).length, 3);
    assert.equal(p.rpcArgs.filter(r => r.name === "plan_list").length, 3);
    assert.equal(reads[3].model.status, "unavailable");
  });

  it("rejects unsupported tools, foreign argument keys and invalid input before any effect", async () => {
    for (const [name, input] of [["plan_create", {}], ["plan_list", { tenant_id: TENANT }], ["plan_list", { limit: 201 }], ["plan_list", null]] as const) {
      const p = ports();
      const read = await readZionPlans(scope(), p.deps, name, input);
      assert.equal(privateRows(read), false);
      assert.deepEqual(p.rpcArgs, []);
      assert.ok(!p.events.includes("receipt") && !p.events.includes("stage"));
    }
  });

  it("honors cancellation before a read and before native staging", async () => {
    const early = new AbortController(); early.abort();
    const p = ports({ signal: early.signal });
    assert.equal(privateRows(await readZionPlans(scope(), p.deps, "plan_list", {})), false);
    assert.deepEqual(p.rpcArgs, []);
    const late = new AbortController(), q = ports({ signal: late.signal });
    const rpc = q.deps.caller.rpc;
    q.deps.caller = { rpc: async (name, args) => { const r = await rpc(name, args); if (name === "current_user_tenant_id") late.abort(); return r; } };
    assert.equal(privateRows(await readZionPlans(scope(), q.deps, "plan_list", {})), false);
    assert.ok(!q.events.includes("stage"));
  });

  it("retires a timed-out original read so a late response cannot begin another RPC or native stage", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let resolveRead!: (v: { data: unknown; error: null }) => void;
    let began!: () => void;
    const begun = new Promise<void>(resolve => { began = resolve; });
    const p = ports();
    p.deps.caller = { rpc: async (name, args) => {
      p.rpcArgs.push({ name, args });
      if (name === "plan_list") { began(); return await new Promise(resolve => { resolveRead = resolve; }); }
      throw Error("Late continuation must not make another RPC");
    } };
    const pending = readZionPlans(scope(), p.deps, "plan_list", {});
    await begun;
    t.mock.timers.tick(5001);
    const read = await pending;
    assert.equal(privateRows(read), false);
    resolveRead({ data: { plans: [], loose_items: [] }, error: null });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(p.rpcArgs.map(r => r.name), ["plan_list"]);
    assert.ok(!p.events.includes("stage"));
    t.mock.timers.reset();
  });

  it("a late read-marker acknowledgement cannot start the original domain read", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let release!: (v: boolean) => void, begin!: () => void;
    const begun = new Promise<void>(resolve => { begin = resolve; });
    const p = ports({ recordRead: async () => { begin(); return await new Promise<boolean>(resolve => { release = resolve; }); } });
    const pending = readZionPlans(scope(), p.deps, "plan_list", {});
    await begun;
    t.mock.timers.tick(5001);
    const read = await pending;
    release(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(privateRows(read), false);
    assert.deepEqual(p.rpcArgs, []);
    assert.ok(!p.events.includes("stage"));
    t.mock.timers.reset();
  });

  it("never releases private rows when native staging acknowledgement arrives after its deadline", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let release!: (v: boolean) => void, begin!: () => void;
    const begun = new Promise<void>(resolve => { begin = resolve; });
    const p = ports({ stageReadContext: async () => { begin(); return await new Promise<boolean>(resolve => { release = resolve; }); } });
    const pending = readZionPlans(scope(), p.deps, "plan_list", {});
    await begun;
    t.mock.timers.tick(5001);
    const read = await pending;
    release(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(privateRows(read), false);
    assert.equal(await read.revalidate(), false);
    assert.equal(p.rpcArgs.length, 2, "no replay while resolving an unknown staging outcome");
    t.mock.timers.reset();
  });
});
