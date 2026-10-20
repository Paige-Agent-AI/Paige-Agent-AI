// @vitest-environment node
// Protected caller/transport ports, not browser Auth, production RLS or acceptance.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, FunctionsHttpError } from "@supabase/supabase-js";
import { readOwnerTaskHistoryList, readOwnerTaskOutcome, type OwnerTaskCaller, type OwnerTaskHistoryInvoker, type OwnerTaskScope } from "./ownerTaskAutomation";
import { ACT_OUTCOMES } from "../../../supabase/functions/_shared/paige-orchestration/outcomes";
import { createOwnerTaskHistoryHandler } from "../../../supabase/functions/_shared/paige-orchestration/owner-task-history-handler";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: OwnerTaskScope = { actorId: id(1), tenantId: id(2), epoch: 1 };
const selected = { processId: id(3), approvalId: id(4), occurrenceId: id(5) };
const instant = "2026-10-19T20:00:00.123456+00:00";
const approval = () => ({ id: selected.approvalId, tenant_id: scope.tenantId, source: "paige_orchestration", category: "owner.task", type: "other",
  status: "approved", updated_at: instant, metadata: { source: "paige_orchestration", capability_id: "owner.task", automation_id: selected.processId,
    act_execution_id: selected.occurrenceId, event_id: id(6), act_id: id(7) } });
const result = () => ({ status: "ready", ...selected, approvalStatus: "approved", recordedOutcome: "executed", decidedAt: instant,
  title: "Inspect the new contact", originalTask: { state: "verified", taskId: id(8), receiptId: id(9), runId: id(10) }, currentTask: { state: "not_read" } });
function fixture() {
  let now: OwnerTaskScope | null = { ...scope };
  const calls: { stage: string; args?: unknown }[] = [], queries: { table: string; filters: [string, unknown][]; columns?: string; limit?: number; orders: string[] }[] = [];
  const f = { user: scope.actorId, tenant: scope.tenantId, role: "owner", seat: "active", rows: [approval()] as unknown[], data: result() as unknown,
    error: null as unknown, listError: null as unknown, authError: null as unknown, on: (_stage: string): void => {},
    gate: null as Promise<unknown> | null, current: () => now, change: (value: OwnerTaskScope | null) => { now = value; }, calls, queries };
  const caller = {
    auth: { getUser: async () => { calls.push({ stage: "auth" }); f.on("auth"); return { data: { user: { id: f.user } }, error: f.authError }; } },
    rpc: async (name: string) => { calls.push({ stage: name }); f.on(name); return { data: f.tenant, error: null }; },
    from(table: string) {
      const query = { table, filters: [] as [string, unknown][], orders: [] as string[], columns: "", limit: 0 }; queries.push(query);
      const q = { select: (columns: string) => { query.columns = columns; return q; }, eq: (k: string, v: unknown) => { query.filters.push([k, v]); return q; },
        order: (key: string) => { query.orders.push(key); return q; }, limit: (n: number) => { query.limit = n; return q; }, maybeSingle: () => q,
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          calls.push({ stage: table }); f.on(table);
          const value = { data: table === "tenant_members" ? { role: f.role, status: f.seat } : structuredClone(f.rows), error: table === "tenant_members" ? null : f.listError };
          return Promise.resolve(table === "tenant_members" ? value : f.gate ?? value).then(resolve, reject);
        } };
      return q;
    },
  } as unknown as OwnerTaskCaller;
  const functions: OwnerTaskHistoryInvoker = { invoke: async (name, options) => {
    calls.push({ stage: name, args: options }); f.on(name);
    return await (f.gate ?? { data: structuredClone(f.data), error: f.error }) as { data: unknown; error: unknown };
  } };
  return { ...f, caller, functions, configure: f };
}
afterEach(() => { vi.useRealTimers(); });

describe("actual history handler and standard SDK refusal transport", () => {
  it.each(["handler-403", "handler-401", "http-400", "http-404", "http-409", "http-500", "fetch-error", "relay-error",
    "plain-error-native-response", "genuine-error-fake-response", "retired-scope", "revoked-role"])("keeps authority and uncertainty distinct: %s", async scenario => {
    const f = fixture();
    let invocations = 0, privateReads = 0, httpCalls = 0;
    let response: globalThis.Response | undefined, sdkError: unknown;
    const handler = createOwnerTaskHistoryHandler({
      caller: () => ({
        auth: { getUser: async () => ({ data: { user: scenario === "handler-401" ? null : { id: scope.actorId } }, error: null }) },
        rpc: async name => ({ data: name === "current_user_tenant_id" ? scope.tenantId : false, error: null }),
        from: () => { throw Error("exact native predicate must refuse before reading the original row"); },
      }),
      service: () => ({
        from: () => { privateReads++; throw Error("private reads forbidden"); },
        rpc: async () => { privateReads++; throw Error("private reads forbidden"); },
      }),
    });
    const sdk = createClient("https://unit-test.invalid", "synthetic-nonsecret-fixture", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer ordinary-synthetic-fixture" }, fetch: async (url, init) => {
        httpCalls++;
        if (scenario === "fetch-error") throw Error("synthetic offline failure");
        response = scenario.startsWith("http-") ? new Response("ignored private body", { status: Number(scenario.slice(5)) })
          : scenario === "relay-error" ? new Response("ignored private body", { status: 403, headers: { "x-relay-error": "true" } })
          : await handler(new Request(url, init));
        return response;
      } },
    });
    const functions: OwnerTaskHistoryInvoker = { invoke: async (name, options) => {
      invocations++;
      if (scenario === "plain-error-native-response") return { data: null, error: { name: "FunctionsHttpError", context: new Response(null, { status: 403 }) } };
      if (scenario === "genuine-error-fake-response") return { data: null, error: new FunctionsHttpError({ status: 403 }) };
      const received = await sdk.functions.invoke(name, options); sdkError = received.error;
      if (scenario === "retired-scope") f.change({ ...scope, epoch: 2 });
      if (scenario === "revoked-role") f.configure.role = "member";
      return received;
    } };
    const refused = ["handler-403", "handler-401", "retired-scope", "revoked-role"].includes(scenario);
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, functions, f.current)).toEqual({ status: refused ? "refused" : "unavailable" });
    expect(invocations).toBe(1); expect(privateReads).toBe(0);
    expect(f.calls.every(x => ["auth", "current_user_tenant_id", "tenant_members"].includes(x.stage))).toBe(true);
    if (response) {
      expect(response.bodyUsed).toBe(false);
      if (scenario !== "relay-error") {
        expect(sdkError).toBeInstanceOf(FunctionsHttpError);
        expect((sdkError as FunctionsHttpError).context).toBe(response);
      }
    }
    expect(httpCalls).toBe(scenario === "plain-error-native-response" || scenario === "genuine-error-fake-response" ? 0 : 1);
    if (scenario === "handler-403") expect(await response!.clone().json()).toEqual({ status: "refused" });
  });
});

describe("existing process history caller projection (unmounted)", () => {
  it("reads settled locators through the existing caller view without treating them as execution", async () => {
    const f = fixture();
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "ready", hasMore: false,
      items: [{ approvalId: selected.approvalId, occurrenceId: selected.occurrenceId, updatedAt: instant, approvalStatus: "approved" }] });
    const query = f.queries.find(x => x.table === "paige_approval_queue_v")!;
    expect(query.filters).toEqual([["tenant_id", scope.tenantId], ["source", "paige_orchestration"], ["category", "owner.task"], ["metadata->>automation_id", selected.processId]]);
    expect(query.limit).toBe(26); expect(query.orders).toEqual(["updated_at", "id"]);
    expect(query.filters.some(([k]) => k === "status")).toBe(false);
    expect(f.calls.filter(x => x.stage === "auth")).toHaveLength(2);
    expect(f.calls.every(x => ["auth", "current_user_tenant_id", "tenant_members", "paige_approval_queue_v"].includes(x.stage))).toBe(true);
  });
  it.each(["pending", "approved", "rejected"])("retains original %s approval locators", async status => {
    const f = fixture(); f.configure.rows = [{ ...approval(), status }];
    const r = await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current);
    expect(r.status === "ready" && r.items[0].approvalStatus).toBe(status);
  });
  it("reports the bounded page honestly and validates the overflow row", async () => {
    const f = fixture(); f.configure.rows = Array.from({ length: 26 }, (_, i) => ({ ...approval(), id: id(100 + i), metadata: { ...approval().metadata, act_execution_id: id(200 + i) } }));
    const r = await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current);
    expect(r.status === "ready" && r.items.length).toBe(25); expect(r.status === "ready" && r.hasMore).toBe(true);
    (f.configure.rows[25] as Record<string, unknown>).tenant_id = id(999);
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "unavailable" });
  });
  it.each(["foreign", "process", "source", "kind", "duplicate", "duplicate-occurrence", "version", "cross-domain", "status", "overflow", "error"])("refuses malformed/incomplete history: %s", async fault => {
    const f = fixture(), row = approval();
    if (fault === "foreign") row.tenant_id = id(999);
    if (fault === "process") row.metadata.automation_id = id(999);
    if (fault === "source") row.metadata.source = "other";
    if (fault === "kind") row.category = "email";
    if (fault === "version") row.updated_at = "invalid";
    if (fault === "status") row.status = "done";
    if (fault === "cross-domain") Object.assign(row.metadata, { governed_send: null });
    f.configure.rows = fault === "duplicate" ? [row, row] : fault === "duplicate-occurrence" ? [row, { ...row, id: id(99) }]
      : fault === "overflow" ? Array(27).fill(row) : [row];
    if (fault === "error") f.configure.listError = { message: "private provider detail" };
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "unavailable" });
  });
  it("separates a genuinely empty list from a failed read", async () => {
    const f = fixture(); f.configure.rows = [];
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "ready", items: [], hasMore: false });
  });
  it("requests only the original approval and stale-workspace guard, with no token or action arguments", async () => {
    const f = fixture(); expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual(result());
    expect(f.calls.filter(x => x.stage === "paige-owner-task-history")).toEqual([{ stage: "paige-owner-task-history", args: {
      method: "POST", body: { approvalId: selected.approvalId, tenantId: scope.tenantId } } }]);
  });
  it.each(ACT_OUTCOMES)("never upgrades recorded %s into native execution proof", async recordedOutcome => {
    const f = fixture(); f.configure.data = { ...result(), recordedOutcome, originalTask: { state: "unconfirmed", taskId: id(999) } };
    const r = await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current);
    expect(r.status === "ready" && r.originalTask).toEqual({ state: "unconfirmed" });
  });
  it.each(["process", "approval", "occurrence", "receipt", "task", "run", "outcome", "title", "current", "decision", "missing"])("never displays mismatched proof: %s", async fault => {
    const f = fixture(), data = result();
    if (fault === "process") data.processId = id(999);
    if (fault === "approval") data.approvalId = id(999);
    if (fault === "occurrence") data.occurrenceId = id(999);
    if (fault === "receipt") data.originalTask.receiptId = "bad";
    if (fault === "task") data.originalTask.taskId = "bad";
    if (fault === "run") data.originalTask.runId = "bad";
    if (fault === "outcome") data.recordedOutcome = "success";
    if (fault === "title") data.title = " ";
    if (fault === "current") data.currentTask.state = "completed";
    if (fault === "decision") data.approvalStatus = "pending";
    f.configure.data = fault === "missing" ? null : data;
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status: "unavailable" });
  });
  it("redacts extra transport fields and never copies alleged current Task data", async () => {
    const f = fixture(); f.configure.data = { ...result(), secret: "private", currentTask: { state: "not_read", title: "invented current Task" },
      originalTask: { ...result().originalTask, secret: "private" } };
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual(result());
  });
  it.each(["approvalStatus", "recordedOutcome"])("rejects coercible non-string %s at the actual receiver", async field => {
    const f = fixture(), data = { ...result(), originalTask: { state: "unconfirmed" } };
    f.configure.data = { ...data, [field]: [data[field as "approvalStatus" | "recordedOutcome"]] };
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status: "unavailable" });
    expect(f.calls.filter(x => x.stage === "paige-owner-task-history")).toHaveLength(1);
  });
  it("rejects a coercible approval status in the original locator list", async () => {
    const f = fixture(); f.configure.rows = [{ ...approval(), status: ["approved"] }];
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "unavailable" });
  });
  it.each(["refused", "unavailable"])("preserves finite server %s without replay", async status => {
    const f = fixture(); f.configure.data = { status, error: "private" };
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status });
    expect(f.calls.filter(x => x.stage === "paige-owner-task-history")).toHaveLength(1);
  });
  it("never retries a transport failure or returns its raw detail", async () => {
    const f = fixture(); f.configure.error = { message: "private" };
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status: "unavailable" });
    expect(f.calls.filter(x => x.stage === "paige-owner-task-history")).toHaveLength(1);
  });
  it.each(["wrong-user", "wrong-tenant", "member", "inactive"])("requires ordinary live workspace authority before reads: %s", async fault => {
    const f = fixture();
    if (fault === "wrong-user") f.configure.user = id(999);
    if (fault === "wrong-tenant") f.configure.tenant = id(999);
    if (fault === "member") f.configure.role = "member";
    if (fault === "inactive") f.configure.seat = "inactive";
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status: "refused" });
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "refused" });
    expect(f.calls.some(x => ["paige-owner-task-history", "paige_approval_queue_v"].includes(x.stage))).toBe(false);
  });
  it.each(["epoch", "logout", "member", "tenant"])("refuses late history after %s", async fault => {
    const f = fixture(); f.configure.on = stage => { if (stage !== "paige-owner-task-history") return;
      if (fault === "epoch") f.change({ ...scope, epoch: 3 });
      if (fault === "logout") f.change(null);
      if (fault === "member") f.configure.role = "member";
      if (fault === "tenant") f.configure.tenant = id(999);
    };
    expect(await readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current)).toEqual({ status: "refused" });
  });
  it("does not revive a captured A request after A-to-B-to-A", async () => {
    const f = fixture(); f.configure.on = stage => { if (stage === "paige_approval_queue_v") { f.change({ ...scope, tenantId: id(99), epoch: 2 }); f.change({ ...scope, epoch: 3 }); } };
    expect(await readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)).toEqual({ status: "refused" });
  });
  it("freezes selection before the first await", async () => {
    const f = fixture(), selection = { ...selected };
    f.configure.on = stage => { if (stage === "auth") selection.approvalId = id(999); };
    expect(await readOwnerTaskOutcome(scope, selection, f.caller, f.functions, f.current)).toEqual(result());
  });
  it.each(["list", "outcome"])("bounds an interrupted %s and ignores late continuation without replay", async kind => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (value: unknown) => void;
    f.configure.gate = new Promise(yes => { resolve = yes; });
    const pending = kind === "list" ? readOwnerTaskHistoryList(scope, selected.processId, f.caller, f.current)
      : readOwnerTaskOutcome(scope, selected, f.caller, f.functions, f.current);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toEqual({ status: "unavailable" });
    const count = f.calls.length; resolve({ data: kind === "list" ? [approval()] : result(), error: null });
    await vi.advanceTimersByTimeAsync(1); expect(f.calls).toHaveLength(count);
  });
});
