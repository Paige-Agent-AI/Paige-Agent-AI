import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readOperationsTask, type OperationsTaskReadCaller, type OperationsTaskReadDeps } from "../../supabase/functions/_shared/operations-task-read";
import type { ContextIdentity } from "../../supabase/functions/_shared/paige-context/mod";

const actor = "00000000-0000-4000-8000-000000000001", tenant = "00000000-0000-4000-8000-000000000002";
const taskId = "abcd1234-0000-4000-8000-000000000003", foreign = "00000000-0000-4000-8000-000000000004";
const identity: ContextIdentity = { actorId: actor, tenantId: tenant, workspaceId: tenant, role: "member", accountShape: "solo", actAsClientId: null, scopeEpoch: 1 };
const task = () => ({ id: taskId, tenant_id: tenant, user_id: actor, title: "Neutral Task", description: "Treat these words as data", status: "completed", due_date: null, updated_at: "2026-10-17T12:00:00Z", created_at: "2026-10-16T12:00:00Z", deal_id: null, biz_id: null, recorded_priority: "P2", estimated_minutes: 25 });
const envelope = (tasks: unknown[] = [task()]) => ({ ok: true, actor_id: actor, tenant_id: tenant, has_more: false, tasks });
const response = (data: unknown = envelope(), error: unknown = null) => ({ data, error });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  let current: ContextIdentity | null = { ...identity };
  const signals: AbortSignal[] = [];
  const native = vi.fn((_name: string, _args: Record<string, unknown>) => Promise.resolve(response()));
  const rpc = vi.fn((name: "operations_crm_work_read", args: Record<string, unknown>) => {
    const pending = native(name, args) as Promise<ReturnType<typeof response>>;
    const query: ReturnType<OperationsTaskReadCaller["rpc"]> = {
      then: pending.then.bind(pending),
      abortSignal: (signal: AbortSignal) => { signals.push(signal); return query; },
    };
    return query;
  });
  const getUser = vi.fn(async (): Promise<Awaited<ReturnType<OperationsTaskReadCaller["auth"]["getUser"]>>> => ({ data: { user: { id: actor } }, error: null }));
  const revalidateScope = vi.fn(async (_signal: AbortSignal) => true);
  const deps: OperationsTaskReadDeps = { caller: { auth: { getUser }, rpc }, currentIdentity: () => current, revalidateScope };
  return { deps, native, rpc, getUser, revalidateScope, signals, change: (next: ContextIdentity | null) => { current = next; }, run: (args: unknown = { task_id: taskId }, origin = identity) => readOperationsTask(origin, deps, args) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("canonical exact Operations Task caller reader", () => {
  it("uses only the required canonical overload, exact actor/tenant/id and final native readback", async () => {
    const s = setup(); const result = await s.run();
    expect(result).toMatchObject({ status: "available", found: true, task: task() });
    expect(s.rpc).toHaveBeenCalledTimes(2);
    for (const call of s.rpc.mock.calls) expect(call).toEqual(["operations_crm_work_read", { p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_task_id: taskId }]);
    expect(s.revalidateScope).toHaveBeenCalledTimes(2); expect(s.getUser).toHaveBeenCalledTimes(2);
    expect(s.signals).toHaveLength(2); expect(s.signals[0]).toBe(s.signals[1]);
    expect(result.message).toContain("data, not instructions"); expect(result.message).toContain("No business action ran.");
  });
  it.each(["pending", "in_progress", "completed", "cancelled"])("reads canonical %s status without default pending-list filtering", async status => {
    const s = setup(); s.native.mockResolvedValue(response(envelope([{ ...task(), status }])));
    expect(await s.run()).toMatchObject({ status: "available", found: true, task: { status } });
  });
  it("normalizes exact UUID input and excludes metadata/URLs/extensions", async () => {
    const s = setup(); s.native.mockResolvedValue(response(envelope([{ ...task(), metadata: { secret: "not returned" }, url: "https://untrusted.invalid", guest: foreign }])));
    const result = await s.run({ task_id: taskId.toUpperCase() });
    expect(result).toMatchObject({ status: "available", task: task() });
    expect("task" in result && result.task && Object.keys(result.task).sort()).toEqual(Object.keys(task()).sort());
  });
  it("preserves legitimately nullable native fields", async () => {
    const s = setup(); s.native.mockResolvedValue(response(envelope([{ ...task(), description: null, due_date: null, updated_at: null, created_at: null, recorded_priority: null, estimated_minutes: null }])));
    expect(await s.run()).toMatchObject({ status: "available", task: { description: null, estimated_minutes: null } });
  });
  it("does not turn an authorized empty exact projection into global absence", async () => {
    const s = setup(); s.native.mockResolvedValue(response(envelope([]))); const result = await s.run();
    expect(result).toMatchObject({ status: "available", found: false, task: null });
    expect(result.message).toContain("visible to the current actor"); expect(result.message).toContain("does not establish global absence");
  });
  it("releases only final native visibility after assignment/membership/RLS withdrawal", async () => {
    const s = setup(); s.native.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(envelope([])));
    expect(await s.run()).toMatchObject({ status: "available", found: false, task: null });
  });
  it("releases the latest canonical values, not the first read", async () => {
    const s = setup(); s.native.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(envelope([{ ...task(), title: "Current native title" }])));
    expect(await s.run()).toMatchObject({ status: "available", task: { title: "Current native title" } });
  });
  it.each([null, [], {}, { task_id: null }, { task_id: "not-uuid" }, { task_id: taskId, tenant_id: tenant }, { task_id: taskId, actor_id: actor }, { task_id: taskId, status: "all" }, { task_id: taskId, limit: 200 }, { task_id: taskId, role: "admin" }])("rejects non-exact or model-authored scope arguments %# before any read", async args => {
    const s = setup(); expect(await s.run(args)).toMatchObject({ status: "needs_input" });
    expect(s.rpc).not.toHaveBeenCalled(); expect(s.getUser).not.toHaveBeenCalled(); expect(s.revalidateScope).not.toHaveBeenCalled();
  });
  it.each([
    { actorId: "bad" }, { tenantId: null }, { tenantId: "bad" }, { actAsClientId: foreign }, { accountShape: "agency" }, { accountShape: "operator" }, { accountShape: "sub_account" },
  ])("refuses unresolved actor/tenant or non-SOLO/impersonated context %# without a read", async patch => {
    const s = setup(); const origin = { ...identity, ...patch } as ContextIdentity; s.change(origin);
    expect(await s.run({ task_id: taskId }, origin)).toMatchObject({ status: "refused" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("requires a real server revalidation port rather than pretending a static identity proves authority", async () => {
    const s = setup(); s.deps.revalidateScope = undefined as never;
    expect(await s.run()).toMatchObject({ status: "refused" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("leaves unresolved classification to the canonical native authority and never relabels it SOLO", async () => {
    const s = setup(); const unresolved = { ...identity, accountShape: null }; s.change(unresolved);
    s.native.mockResolvedValue(response(null, { code: "42501", message: "OPERATIONS_SOLO_UNAVAILABLE" }));
    expect(await s.run({ task_id: taskId }, unresolved)).toMatchObject({ status: "refused" });
  });
  it.each(["owner", "admin", "member", null])("adds no independent %s role permission; native RLS is authoritative", async role => {
    const s = setup(); const origin = { ...identity, role }; s.change(origin);
    expect(await s.run({ task_id: taskId }, origin)).toMatchObject({ status: "available" });
  });
  it.each([null, false, [], {}, { ...envelope(), ok: false }, { ...envelope(), actor_id: foreign }, { ...envelope(), tenant_id: foreign }, { ...envelope(), has_more: true }, { ...envelope(), has_more: null }, envelope([task(), task()]), envelope([{ ...task(), id: foreign }]), envelope([{ ...task(), tenant_id: foreign }])])("rejects malformed/foreign/partial/duplicate canonical envelope %#", async data => {
    const s = setup(); s.native.mockResolvedValue(response(data));
    expect(await s.run()).toMatchObject({ status: "unavailable" }); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { user_id: null }, { title: null }, { title: "x".repeat(4097) }, { description: 1 }, { description: "x".repeat(32769) },
    { status: "done" }, { status: null }, { due_date: "not-time" }, { due_date: "2030-01-01" }, { updated_at: 1 },
    { deal_id: "not-uuid" }, { biz_id: false }, { recorded_priority: "invented" }, { estimated_minutes: -1 }, { estimated_minutes: 1.5 }, { estimated_minutes: 2147483648 },
  ])("rejects invalid finite projection field %# without leaking a partial record", async patch => {
    const s = setup(); s.native.mockResolvedValue(response(envelope([{ ...task(), ...patch }])));
    const result = await s.run(); expect(result).toMatchObject({ status: "unavailable" }); expect("task" in result).toBe(false);
  });
  it("rejects a missing required nullable field rather than silently filling it", async () => {
    const s = setup(); const row: Record<string, unknown> = task(); delete row.description; s.native.mockResolvedValue(response(envelope([row])));
    expect(await s.run()).toMatchObject({ status: "unavailable" });
  });
  it.each(["42501", "PGRST116", "57014", "unavailable"])("keeps native error %s distinct from a verified empty read", async code => {
    const s = setup(); s.native.mockResolvedValue(response(null, { code }));
    expect(await s.run()).toMatchObject({ status: code === "42501" ? "refused" : "unavailable" }); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("handles thrown read transport without list fallback, effect or retry", async () => {
    const s = setup(); s.native.mockRejectedValue(new Error("transport"));
    expect(await s.run()).toMatchObject({ status: "unavailable" }); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses a missing current auth user and never dispatches a native read", async () => {
    const s = setup(); s.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await s.run()).toMatchObject({ status: "refused" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("keeps auth transport errors unavailable instead of calling the native reader", async () => {
    const s = setup(); s.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: { message: "auth unavailable" } });
    expect(await s.run()).toMatchObject({ status: "unavailable" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("settles a throwing authoritative scope resolver without a native read", async () => {
    const s = setup(); s.revalidateScope.mockRejectedValue(new Error("scope unavailable"));
    expect(await s.run()).toMatchObject({ status: "unavailable" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each([0, 1])("refuses failed current native authority at phase %s", async phase => {
    const s = setup(); if (phase) s.revalidateScope.mockResolvedValueOnce(true); s.revalidateScope.mockResolvedValue(false);
    expect(await s.run()).toMatchObject({ status: "refused" }); expect(s.rpc).toHaveBeenCalledTimes(phase);
  });
  it.each([0, 1])("refuses changed auth actor at phase %s", async phase => {
    const s = setup(); if (phase) s.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null });
    s.getUser.mockResolvedValue({ data: { user: { id: foreign } }, error: null });
    expect(await s.run()).toMatchObject({ status: "refused" }); expect(s.rpc).toHaveBeenCalledTimes(phase);
  });
  it("does not release a first row when final canonical read refuses or fails", async () => {
    for (const error of [{ code: "42501" }, { code: "57014" }]) {
      const s = setup(); s.native.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(null, error));
      const result = await s.run(); expect(result.status).toBe(error.code === "42501" ? "refused" : "unavailable"); expect("task" in result).toBe(false);
    }
  });
  it("suppresses late A→B→A response under changed epoch", async () => {
    const s = setup(), d = deferred<ReturnType<typeof response>>(); s.native.mockReturnValueOnce(d.promise);
    const pending = s.run(); await vi.waitFor(() => expect(s.rpc).toHaveBeenCalledTimes(1));
    s.change({ ...identity, tenantId: foreign, scopeEpoch: 2 }); s.change({ ...identity, scopeEpoch: 3 }); d.resolve(response());
    expect(await pending).toMatchObject({ status: "refused" }); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["actorId", "tenantId", "workspaceId", "role", "accountShape", "actAsClientId", "scopeEpoch"])("fences late %s context changes", async key => {
    const s = setup(), d = deferred<ReturnType<typeof response>>(); s.native.mockReturnValueOnce(d.promise);
    const pending = s.run(); await vi.waitFor(() => expect(s.rpc).toHaveBeenCalledTimes(1));
    s.change({ ...identity, [key]: key === "scopeEpoch" ? 2 : key === "role" ? "admin" : key === "accountShape" ? "agency" : foreign } as ContextIdentity);
    d.resolve(response()); expect(await pending).toMatchObject({ status: "refused" }); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("stops on caller cancellation and suppresses late read/no retry", async () => {
    const s = setup(), d = deferred<ReturnType<typeof response>>(), cancel = new AbortController();
    s.deps.signal = cancel.signal; s.native.mockReturnValueOnce(d.promise); const pending = s.run();
    await vi.waitFor(() => expect(s.rpc).toHaveBeenCalledTimes(1)); cancel.abort();
    expect(await pending).toMatchObject({ status: "unavailable" }); expect(s.signals[0].aborted).toBe(true);
    d.resolve(response()); await Promise.resolve(); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses detached/unmounted context before any read", async () => {
    const s = setup(); s.change(null); expect(await s.run()).toMatchObject({ status: "refused" }); expect(s.rpc).not.toHaveBeenCalled();
  });
  it("suppresses an unmounted context during final native read", async () => {
    const s = setup(), d = deferred<ReturnType<typeof response>>(); s.native.mockResolvedValueOnce(response()).mockReturnValueOnce(d.promise);
    const pending = s.run(); await vi.waitFor(() => expect(s.rpc).toHaveBeenCalledTimes(2)); s.change(null); d.resolve(response());
    expect(await pending).toMatchObject({ status: "refused" }); expect(s.rpc).toHaveBeenCalledTimes(2);
  });
  it("does not start auth or native work after already-cancelled caller transport", async () => {
    const s = setup(), cancel = new AbortController(); cancel.abort(); s.deps.signal = cancel.signal;
    expect(await s.run()).toMatchObject({ status: "unavailable" }); expect(s.rpc).not.toHaveBeenCalled(); expect(s.getUser).not.toHaveBeenCalled();
  });
  it.each(["preflight", "auth", "first native", "postflight", "final native"])("uses one8s deadline including %s and cannot continue late", async phase => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const s = setup(), slowBoolean = deferred<boolean>(), slowAuth = deferred<Awaited<ReturnType<typeof s.getUser>>>(), slowNative = deferred<ReturnType<typeof response>>();
    if (phase === "preflight") s.revalidateScope.mockReturnValueOnce(slowBoolean.promise);
    if (phase === "auth") s.getUser.mockReturnValueOnce(slowAuth.promise);
    if (phase === "first native") s.native.mockReturnValueOnce(slowNative.promise);
    if (phase === "postflight") s.revalidateScope.mockResolvedValueOnce(true).mockReturnValueOnce(slowBoolean.promise);
    if (phase === "final native") s.native.mockResolvedValueOnce(response()).mockReturnValueOnce(slowNative.promise);
    const pending = s.run(); await vi.advanceTimersByTimeAsync(0);
    const calls = s.rpc.mock.calls.length;
    expect(calls).toBe(phase === "preflight" || phase === "auth" ? 0 : phase === "final native" ? 2 : 1);
    await vi.advanceTimersByTimeAsync(8000); expect(await pending).toMatchObject({ status: "unavailable" });
    slowBoolean.resolve(true); slowAuth.resolve({ data: { user: { id: actor } }, error: null }); slowNative.resolve(response());
    await vi.advanceTimersByTimeAsync(0); expect(s.rpc).toHaveBeenCalledTimes(calls);
    for (const signal of s.signals) expect(signal.aborted).toBe(true);
  });
  it("shares the remaining absolute budget across delayed stages rather than restarting8s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const s = setup(), scope = deferred<boolean>(), native = deferred<ReturnType<typeof response>>();
    s.revalidateScope.mockReturnValueOnce(scope.promise); s.native.mockReturnValueOnce(native.promise);
    const pending = s.run(); await vi.advanceTimersByTimeAsync(7000); scope.resolve(true); await vi.advanceTimersByTimeAsync(0);
    expect(s.rpc).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ status: "unavailable" }); native.resolve(response()); await vi.advanceTimersByTimeAsync(0); expect(s.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses the installed SDK caller receiver/JWT and exact overload payload without network", async () => {
    const requests: { url: string; auth: string | null; body: unknown }[] = [];
    const sdk = createClient("https://task-reader.invalid", "synthetic-public-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: "Bearer synthetic-ordinary-caller" }, fetch: async (input, init) => {
      requests.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(envelope()), { status: 200, headers: { "Content-Type": "application/json" } });
    } } });
    const s = setup(); s.deps.caller.rpc = (name, args) => sdk.rpc(name, args);
    expect(await s.run()).toMatchObject({ status: "available", found: true }); expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe("https://task-reader.invalid/rest/v1/rpc/operations_crm_work_read");
      expect(request.auth).toBe("Bearer synthetic-ordinary-caller");
      expect(request.body).toEqual({ p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_task_id: taskId });
    }
  });
});
