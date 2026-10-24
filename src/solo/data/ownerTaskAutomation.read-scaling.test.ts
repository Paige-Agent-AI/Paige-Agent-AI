// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnerTaskAutomations, type OwnerTaskCaller } from "./ownerTaskAutomation";

const scope = { actorId: "test-owner", tenantId: "test-tenant-a", epoch: 1 };
const process = (i: number) => ({ id: `process-${i}`, tenant_id: scope.tenantId, name: `Contact review ${i}`,
  category: "general", trigger_key: "contact.created", trigger_config: {}, conditions: [], created_by: scope.actorId,
  state: "draft", granted_lane: "confirm", owner_task_armed_at: null, updated_at: "2026-10-19T12:00:00Z" });
const act = (i: number) => ({ id: `act-${i}`, automation_id: `process-${i}`, position: 1,
  action_kind: "owner.task", tool_key: null, config: { title: `Review contact ${i}` } });

function nativeReadFixture(count: number, fault = "", stepsPerProcess = 1, serverCap = 200) {
  let now: typeof scope | null = { ...scope };
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const rpc = vi.fn(async (name: string) => {
    if (name !== "current_user_tenant_id") throw new Error("Unexpected mutation or RPC");
    return { data: scope.tenantId, error: null };
  });
  const caller = { auth: { getUser: async () => ({ data: { user: { id: scope.actorId } }, error: null }) }, rpc,
    from(table: string) {
      const filters: [string, unknown][] = []; queries.push({ table, filters });
      let from = 0, to = 199;
      const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        in: (k: string, v: unknown[]) => { filters.push([k, v]); return q; }, range: (start: number, end: number) => { from = start; to = end; return q; },
        order: () => q, limit: () => q, maybeSingle: () => q,
        then(yes: (v: unknown) => unknown, no: (e: unknown) => unknown) {
          const data = table === "tenant_members" ? { role: "owner", status: "active" }
            : table === "paige_automations" ? Array.from({ length: count }, (_, i) => process(i))
            : Array.from({ length: count }, (_, i) => Array.from({ length: stepsPerProcess }, (_, position) => ({ ...act(i),
              id: stepsPerProcess === 1 ? `act-${i}` : `act-${i}-${position}`, position: position + 1 }))).flat().filter(a => filters.every(([k, v]) =>
              k !== "automation_id" || (Array.isArray(v) ? v.includes(a.automation_id) : v === a.automation_id)));
          const reply = { data: table === "paige_automation_acts" ? (data as ReturnType<typeof act>[]).slice(from, Math.min(to + 1, from + serverCap)) : data,
            count: table === "paige_automation_acts" ? (data as unknown[]).length : null, error: null };
          if (table !== "paige_automation_acts") return Promise.resolve(reply).then(yes, no);
          return new Promise(resolve => setTimeout(() => {
            if (fault === "switch") now = { ...scope, tenantId: "test-tenant-b", epoch: 2 };
            if (fault === "foreign") { (reply.data as ReturnType<typeof act>[]).push({ ...act(100), automation_id: "foreign-process" }); reply.count!++; }
            if (fault === "missing-count") reply.count = null;
            if (fault === "fractional-count") reply.count = 1.5;
            if (fault === "count-drift" && from > 0) reply.count!++;
            if (fault === "incomplete") reply.data = [];
            if (fault === "repeated-page" && from > 0) reply.data = (data as ReturnType<typeof act>[]).slice(0, serverCap);
            if (fault === "malformed-position") (reply.data as ReturnType<typeof act>[])[0].position = 1.5;
            resolve(reply);
          }, 300)).then(yes, no);
        } };
      return q;
    } } as unknown as OwnerTaskCaller;
  return { caller, queries, rpc, current: () => now };
}

describe("bounded native owner-process inspection at the existing list limit", () => {
  afterEach(() => vi.useRealTimers());
  it("reads all fifty process configurations inside one overall deadline with one scoped act read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = nativeReadFixture(50), started = performance.now();
    let elapsed = -1;
    const pending = readOwnerTaskAutomations(scope, f.caller, f.current).then(result => { elapsed = performance.now() - started; return result; });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Valid native process list became unavailable");
    expect(result.items).toHaveLength(50);
    expect(result.items.map(item => item.id)).toEqual(Array.from({ length: 50 }, (_, i) => `process-${i}`));
    expect(result.items.every((item, i) => item.acts[0]?.id === `act-${i}`)).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
    expect(f.queries.filter(query => query.table === "paige_automation_acts")).toHaveLength(1);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["current_user_tenant_id", "current_user_tenant_id"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["foreign", "switch", "missing-count", "fractional-count", "incomplete", "malformed-position"])("refuses %s batch results without a mutation", async fault => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = nativeReadFixture(2, fault), pending = readOwnerTaskAutomations(scope, f.caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await pending).status).not.toBe("ready");
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["current_user_tenant_id"]);
  });
  it("does not read any acts when the canonical list is empty", async () => {
    const f = nativeReadFixture(0);
    expect(await readOwnerTaskAutomations(scope, f.caller, f.current)).toEqual({ status: "ready", items: [], hasMore: false });
    expect(f.queries.some(query => query.table === "paige_automation_acts")).toBe(false);
  });
  it.each([[2, 1, 1, 2], [50, 5, 200, 2]])("reads complete ordered steps with %i processes/%i acts and server cap%i", async (count, steps, cap, expectedPages) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = nativeReadFixture(count, "", steps, cap), pending = readOwnerTaskAutomations(scope, f.caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;
    if (result.status !== "ready") throw new Error("Incomplete inspection");
    expect(result.items).toHaveLength(count);
    expect(result.items.every(item => item.acts.length === steps)).toBe(true);
    expect(result.items.every(item => item.acts.map(a => a.position).join(",") === Array.from({ length: steps }, (_, i) => i + 1).join(","))).toBe(true);
    expect(f.queries.filter(query => query.table === "paige_automation_acts")).toHaveLength(expectedPages);
  });
  it.each(["count-drift", "repeated-page"])("never calls a %s result a complete inspection", async fault => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = nativeReadFixture(2, fault, 1, 1), pending = readOwnerTaskAutomations(scope, f.caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual({ status: "unavailable" });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["current_user_tenant_id"]);
  });
  it("keeps the fifty-parent boundary and separately reports additional processes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = nativeReadFixture(51), pending = readOwnerTaskAutomations(scope, f.caller, f.current);
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;
    if (result.status !== "ready") throw new Error("List unavailable");
    expect(result.items).toHaveLength(50); expect(result.hasMore).toBe(true);
    expect(result.items.some(item => item.id === "process-50")).toBe(false);
  });
});
