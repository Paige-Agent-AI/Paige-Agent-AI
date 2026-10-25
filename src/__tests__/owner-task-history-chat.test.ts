// @vitest-environment node
// Original domain reader with recording Auth/native ports, not real customer QA.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnerTaskHistoryForChat, type OwnerTaskHistoryChatDeps } from "../../supabase/functions/_shared/paige-orchestration/owner-task-history-chat";
import type { ContextIdentity } from "../../supabase/functions/_shared/paige-context/mod";
import path from "node:path";
import ts from "typescript";

it("retains the checked original history result for the actual Chat consumer", () => {
  const fixturePath = path.resolve("supabase/functions/_shared/paige-orchestration/history-chat-contract.fixture.ts");
  const source = `
    import { readOwnerTaskHistoryForChat } from "./owner-task-history-chat.ts";
    declare const result: Awaited<ReturnType<typeof readOwnerTaskHistoryForChat>>;
    if (result.status === "available") {
      const approval: string = result.original.approvalId;
      const readAt: string = result.read_at;
      const current: "not_read" = result.original.currentTask.state;
      if (result.original.originalTask.state === "verified") {
        const receipt: string = result.original.originalTask.receiptId;
        void receipt;
      }
      void [approval, readAt, current];
    }
  `;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
    noEmit: true, strict: true, skipLibCheck: true, types: [], lib: ["lib.es2020.d.ts", "lib.dom.d.ts"] };
  const host = ts.createCompilerHost(options), read = host.readFile, exists = host.fileExists;
  host.readFile = name => path.resolve(name) === fixturePath ? source : read(name);
  host.fileExists = name => path.resolve(name) === fixturePath || exists(name);
  const program = ts.createProgram([fixturePath], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, " ") }))).toEqual([]);
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const approvalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", stamp = "2026-10-19T12:00:00Z";
const actor = id(3), taskId = id(4), runId = id(5), event = id(6), act = id(7), occurrenceId = id(8), processId = id(9);
function fixture(tenantId = id(2)) {
  const identity: ContextIdentity = { actorId: actor, tenantId, workspaceId: tenantId,
    role: "owner", accountShape: "solo", actAsClientId: null, scopeEpoch: 1 };
  let current: ContextIdentity | null = { ...identity }, user = actor, tenant = tenantId, authorized = true;
  let scopeReady = true, step: ((name: string) => void) | undefined;
  const calls: { name: string; client: string; args?: unknown }[] = [];
  const touch = (name: string, client: string, args?: unknown) => { calls.push({ name, client, args }); step?.(name); };
  const approval = { id: approvalId, tenant_id: tenantId, source: "paige_orchestration", category: "owner.task", type: "other", status: "approved",
    updated_at: stamp, metadata: { source: "paige_orchestration", capability_id: "owner.task", event_id: event, act_id: act, act_execution_id: occurrenceId, automation_id: processId } };
  const occurrence = { id: occurrenceId, tenant_id: tenantId, event_id: event, act_id: act, automation_id: processId, adapter_kind: "native", capability_key: "owner.task", effective_lane: "confirm", outcome: "executed", correlation_ref: id(10), idempotency_key: id(10), decided_at: stamp, updated_at: stamp,
    detail: { approved_by: actor, approved_at: stamp, snapshot_args: { title: "Original protected task", description: "Original instructions" }, owner_task_source: { v: 1 }, owner_task_approval: { id: approvalId } } };
  const native = { state: "found", actor_id: actor, result: { ok: true, action: "task.create", outcome: "succeeded", receipt_recorded: true, correlation_id: runId,
    readback: { id: taskId, title: "Original protected task", description: "Original instructions", assignee_user_id: actor, external_effect: false, notification_sent: false } } };
  const receipt = { id: id(11), tenant_id: tenantId, actor_id: actor, source_kind: "capability_run", source_id: runId, source_revision: 0,
    capability_key: "crm_create_task", outcome: "capability_succeeded", occurred_at: stamp, detail: { action: "task.create", record_kind: "task", record_id: taskId } };
  const query = (table: string, client: string) => {
    const filters: unknown[][] = [];
    const q = { select(columns: string) { filters.push(["select", columns]); return q; },
      eq(key: string, value: unknown) { filters.push(["eq", key, value]); return q; },
      async maybeSingle() {
        touch(table, client, filters);
        const value = table === "paige_approval_queue_v" ? approval : table === "paige_act_executions" ? occurrence : table === "paige_workspace_events" ? receipt : null;
        if (!value) throw Error("Unexpected private table");
        return { data: structuredClone(value), error: null };
      } };
    return q;
  };
  const deps: OwnerTaskHistoryChatDeps = {
    caller: { auth: { async getUser() { touch("auth", "jwt"); return { data: { user: { id: user } }, error: null }; } },
      async rpc(name, args) {
        touch(name, "jwt", args);
        if (name === "current_user_tenant_id") return { data: tenant, error: null };
        if (name === "can_read_owner_task_approval") { expect(args).toEqual({ _approval_id: approvalId }); return { data: authorized, error: null }; }
        throw Error("Unexpected caller RPC");
      }, from(table) { expect(table).toBe("paige_approval_queue_v"); return query(table, "jwt"); } },
    service: { async rpc(name, args) {
      touch(name, "service", args); expect(name).toBe("read_owner_task_act");
      expect(args).toEqual({ _event_id: event, _act_id: act, _correlation: id(10) });
      return { data: structuredClone(native), error: null };
    }, from(table) { expect(["paige_act_executions", "paige_workspace_events"]).toContain(table); return query(table, "service"); } },
    currentIdentity: () => current,
    async revalidateScope(signal) { touch("server_scope", "server"); expect(signal).toBeInstanceOf(AbortSignal); return scopeReady; },
  };
  return { identity, deps, calls, approval, occurrence, native, receipt,
    at: (fn: (name: string) => void) => { step = fn; },
    setCurrent: (value: ContextIdentity | null) => { current = value; },
    setUser: (value: string) => { user = value; }, setTenant: (value: string) => { tenant = value; },
    revoke: () => { authorized = false; }, retireScope: () => { scopeReady = false; } };
}
const input = () => ({ approval_id: approvalId });
afterEach(() => vi.useRealTimers());

describe("original owner-task history Chat adapter", () => {
  it.each([id(2), id(72)])("uses one shared contract for an eligible context %s", async tenant => {
    const f = fixture(tenant), r = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(r).toMatchObject({ status: "available", original: { approvalId, occurrenceId, processId,
      originalTask: { state: "verified", taskId, receiptId: id(11), runId }, currentTask: { state: "not_read" } } });
    expect("read_at" in r && Number.isFinite(Date.parse(String(r.read_at)))).toBe(true);
    expect(f.calls.filter(c => c.client === "service").every(c => ["paige_act_executions", "read_owner_task_act", "paige_workspace_events"].includes(c.name))).toBe(true);
    expect(f.calls.filter(c => /execute|reconcile|approve_act|record_capability|insert|update/.test(c.name))).toEqual([]);
  });
  it("normalizes only the original UUID address, never scope", async () => {
    const f = fixture(); expect((await readOwnerTaskHistoryForChat(f.identity, f.deps, { approval_id: approvalId.toUpperCase() })).status).toBe("available");
  });
  it.each(["current_request", id(32)])("accepts the original Chat request epoch %s", async scopeEpoch => {
    const f = fixture(), context = { ...f.identity, scopeEpoch }; f.setCurrent(context);
    expect((await readOwnerTaskHistoryForChat(context, f.deps, input())).status).toBe("available");
  });
  it.each([null, {}, [], { approval_id: "invalid" }, { approval_id: approvalId, tenant_id: id(91) }, { approval_id: approvalId, actor_id: actor }])("rejects invalid/model scope input before reads %j", async args => {
    const f = fixture(); expect((await readOwnerTaskHistoryForChat(f.identity, f.deps, args)).status).toBe("needs_input"); expect(f.calls).toEqual([]);
  });
  it.each([{ role: "member" }, { role: "operator" }, { accountShape: "platform_operator" }, { accountShape: null },
    { actAsClientId: id(20) }, { actorId: null }, { workspaceId: id(91) }])("refuses an ineligible server context %j", async change => {
    const f = fixture(), context = { ...f.identity, ...change } as ContextIdentity; f.setCurrent(context);
    expect((await readOwnerTaskHistoryForChat(context, f.deps, input())).status).toBe("refused"); expect(f.calls).toEqual([]);
  });
  it("binds the original request actor before any privileged lookup", async () => {
    const f = fixture(); f.setUser(id(91));
    expect((await readOwnerTaskHistoryForChat(f.identity, f.deps, input())).status).toBe("refused");
    expect(f.calls.some(c => c.name === "paige_act_executions")).toBe(false);
  });
  it("keeps a later authorized administrator distinct from the original approver", async () => {
    const f = fixture(), viewer = { ...f.identity, actorId: id(90), role: "admin" }; f.setUser(viewer.actorId); f.setCurrent(viewer);
    expect(await readOwnerTaskHistoryForChat(viewer, f.deps, input())).toMatchObject({ status: "available", original: { originalTask: { state: "verified", taskId } } });
  });
  it.each(["server_scope", "paige_approval_queue_v", "paige_act_executions", "read_owner_task_act", "paige_workspace_events"])("withholds all private output after context retirement at %s", async stage => {
    const f = fixture(); f.at(name => { if (name === stage) f.setCurrent({ ...f.identity, tenantId: id(91), scopeEpoch: 2 }); });
    const r = await readOwnerTaskHistoryForChat(f.identity, f.deps, input()); expect(r.status).toBe("refused"); expect(JSON.stringify(r)).not.toContain("Original protected task");
  });
  it("refuses unavailable server scope before the original history reader", async () => {
    const f = fixture(); f.retireScope(); expect((await readOwnerTaskHistoryForChat(f.identity, f.deps, input())).status).toBe("refused");
    expect(f.calls.map(c => c.name)).toEqual(["server_scope"]);
  });
  it("retains native tenant and approval refusal", async () => {
    for (const mode of ["tenant", "approval"]) { const f = fixture(); if (mode === "tenant") f.setTenant(id(91)); else f.revoke();
      expect((await readOwnerTaskHistoryForChat(f.identity, f.deps, input())).status).toBe("refused"); expect(f.calls.some(c => c.client === "service")).toBe(false); }
  });
  it("does not turn an executed ledger state into missing creation evidence", async () => {
    const f = fixture(); f.native.state = "unknown";
    expect(await readOwnerTaskHistoryForChat(f.identity, f.deps, input())).toMatchObject({ status: "available", original: { recordedOutcome: "executed", originalTask: { state: "unconfirmed" }, currentTask: { state: "not_read" } } });
  });
  it("never replays or issues a replacement receipt on repeated reads", async () => {
    const f = fixture(); await readOwnerTaskHistoryForChat(f.identity, f.deps, input()); await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(f.calls.filter(c => c.name === "read_owner_task_act")).toHaveLength(2);
    expect(f.calls.filter(c => /execute|reconcile|approve_act|record_capability|insert|update/.test(c.name))).toEqual([]);
  });
  it("bounds a stalled preflight and never resumes into a private read", async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (ready: boolean) => void;
    f.deps.revalidateScope = () => new Promise<boolean>(yes => { resolve = yes; });
    const pending = readOwnerTaskHistoryForChat(f.identity, f.deps, input()); await vi.advanceTimersByTimeAsync(8_001);
    expect((await pending).status).toBe("unavailable"); resolve(true); await vi.advanceTimersByTimeAsync(1); expect(f.calls).toEqual([]);
  });
  it("withholds a withdrawn final server scope", async () => {
    const f = fixture(); let checks = 0;
    f.deps.revalidateScope = async () => ++checks === 1;
    const r = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(r.status).toBe("refused"); expect(JSON.stringify(r)).not.toContain("Original protected task");
  });
  it("cancels a stalled original native read without starting another lookup", async () => {
    const f = fixture(), abort = new AbortController(); f.deps.signal = abort.signal;
    let finish!: (value: { data: unknown; error: unknown }) => void;
    const original = f.deps.service.rpc;
    f.deps.service.rpc = (name, args) => {
      expect(name).toBe("read_owner_task_act");
      void original(name, args);
      return new Promise(yes => { finish = yes; abort.abort(); });
    };
    const r = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(r.status).toBe("unavailable");
    const count = f.calls.length; finish({ data: f.native, error: null }); await Promise.resolve(); await Promise.resolve();
    expect(f.calls).toHaveLength(count); expect(f.calls.some(c => c.name === "paige_workspace_events")).toBe(false);
  });
  it("contains raw errors and respects an already cancelled request", async () => {
    const f = fixture(); f.deps.revalidateScope = async () => { throw Error("private fixture payload"); };
    const r = await readOwnerTaskHistoryForChat(f.identity, f.deps, input()); expect(r.status).toBe("unavailable"); expect(JSON.stringify(r)).not.toContain("private fixture payload");
    const g = fixture(), abort = new AbortController(); abort.abort(); g.deps.signal = abort.signal;
    expect((await readOwnerTaskHistoryForChat(g.identity, g.deps, input())).status).toBe("unavailable"); expect(g.calls).toEqual([]);
  });
});


describe("Chat read receipt remains separate from original Task proof", () => {
  it.each([true, false])("reports the read receipt truthfully without replacing the original %s", async recorded => {
    const f = fixture(), record = vi.fn(async (signal: AbortSignal) => { expect(signal.aborted).toBe(false); return recorded; });
    f.deps.recordRead = record;
    const result = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(record).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "available", read_receipt: recorded ? "recorded" : "unverified",
      original: { originalTask: { state: "verified", receiptId: id(11), runId } } });
  });
  it("withholds the original result after context withdrawal during the read receipt", async () => {
    const f = fixture(); f.deps.recordRead = async () => { f.setCurrent(null); return true; };
    const result = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(result.status).toBe("refused"); expect(result).not.toHaveProperty("original");
  });
  it("revalidates server authority after the read receipt", async () => {
    const f = fixture(); f.deps.recordRead = async () => { f.retireScope(); return true; };
    const result = await readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    expect(result.status).toBe("refused"); expect(result).not.toHaveProperty("original");
  });
  it("bounds a receipt that never acknowledges within the original total deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = fixture(); let release: ((v: boolean) => void) | undefined;
    f.deps.recordRead = () => new Promise<boolean>(resolve => { release = resolve; });
    const pending = readOwnerTaskHistoryForChat(f.identity, f.deps, input());
    await vi.advanceTimersByTimeAsync(8001);
    const result = await pending;
    expect(result.status).toBe("unavailable"); expect(result).not.toHaveProperty("original");
    const count = f.calls.length; release?.(true); await Promise.resolve();
    expect(f.calls).toHaveLength(count);
  });
});
