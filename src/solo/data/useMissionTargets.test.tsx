import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMissionTargets } from "./useMissionTargets";
import type { TargetCaller } from "../mission-target-client";
import type { TargetAttempt } from "../mission-target-recovery";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222", mission = "33333333-3333-4333-8333-333333333333";
const targetId = "44444444-4444-4444-8444-444444444444", request = "55555555-5555-4555-8555-555555555555", receipt = "66666666-6666-4666-8666-666666666666";
const attempt: TargetAttempt = { version: 1, scope: { actorId: actor, tenantId: tenant, missionId: mission }, tool: "mission_target_transition",
  args: { request_key: request, mission_id: mission, expected_mission_revision: 3, target_id: targetId, expected_target_revision: 1, to_state: "paused", reason: "Review strategy" } };
const target = { id: targetId, tenant_id: tenant, mission_id: mission, revision: 2, state: "paused", title: "Grow clients", metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "quarter", semantics: "current_snapshot", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "10", upper_value: null };
const settled = { success: true, verified: true, railRecorded: true, target, receipt: { id: receipt, requestKey: request, revision: 2, operation: "target_transition" } };
let host: HTMLDivElement, root: Root, model: ReturnType<typeof useMissionTargets>;
function fixture() {
  const values = new Map<string, string>();
  let authenticated = true, current = tenant;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, value: string) => { values.set(k, value); }, removeItem: (k: string) => { values.delete(k); } };
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: authenticated ? { id: actor } : null }, error: null })) },
    rpc: vi.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => name === "current_user_tenant_id" ? { data: current, error: null }
      : name === "list_business_mission_targets" ? { data: { resolved_tenant_id: current, targets: [], total_count: 0, has_more: false }, error: null }
      : { data: null, error: { code: "42501" } }),
    functions: { invoke: vi.fn(async (_name: string, _options: { body: unknown }): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: new Error("Lost response") })) } };
  return { storage, caller, values, auth: (v: boolean) => { authenticated = v; }, workspace: (v: string) => { current = v; } };
}
function Probe({ ports, workspace = tenant }: { ports: { caller: TargetCaller; storage: Storage }; workspace?: string }) {
  model = useMissionTargets(actor, workspace, mission, ports); return <div>{model.list.kind}</div>;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
describe("mounted native target recovery continuity", () => {
  it("retains original key/CAS across response loss, unmount/reload and Auth refusal until canonical completion", async () => {
    const h = fixture(), ports = { caller: h.caller as TargetCaller, storage: h.storage as Storage };
    await act(async () => { root.render(<Probe ports={ports} />); await flush(); });
    expect(model.list.kind).toBe("ready");
    await act(async () => { await model.run(attempt); });
    expect(model.pending?.args).toEqual(attempt.args); expect(h.values.size).toBe(1);
    await act(async () => { root.unmount(); }); root = createRoot(host);
    await act(async () => { root.render(<Probe ports={ports} />); await flush(); });
    expect(model.pending?.args).toEqual(attempt.args);
    h.auth(false);
    await act(async () => { await model.reconcile(); });
    expect(h.values.size).toBe(1); expect(h.caller.functions.invoke).toHaveBeenCalledTimes(1);
    expect(model.list.kind).toBe("refused");
    h.auth(true);
    await act(async () => { await model.refresh(); });
    expect(model.pending?.args).toEqual(attempt.args);
    h.caller.functions.invoke.mockResolvedValue({ data: settled, error: null });
    await act(async () => { await model.reconcile(); });
    expect(h.caller.functions.invoke.mock.calls[1][1]).toEqual({ body: { tool: attempt.tool, args: attempt.args } });
    expect(h.values.size).toBe(0); expect(model.receipt?.requestKey).toBe(request);
  });
  it("keeps a verified saved revision separate from an unconfirmed activity record", async () => {
    const h = fixture(), ports = { caller: h.caller as TargetCaller, storage: h.storage as Storage };
    await act(async () => { root.render(<Probe ports={ports} />); await flush(); });
    h.caller.functions.invoke.mockResolvedValue({ data: { ...settled, railRecorded: false }, error: null });
    await act(async () => { await model.run(attempt); });
    expect(model.receipt?.revision).toBe(2); expect(model.railRecorded).toBe(false);
    expect(model.pending?.args).toEqual(attempt.args); expect(h.values.size).toBe(1);
  });
  it("drops a late private list through an A-B-A workspace incarnation", async () => {
    const h = fixture(), ports = { caller: h.caller as TargetCaller, storage: h.storage as Storage };
    let complete!: (value: { data: unknown; error: null }) => void;
    let first = true;
    h.caller.rpc.mockImplementation(async name => {
      if (name === "current_user_tenant_id") return { data: tenant, error: null };
      if (name === "list_business_mission_targets" && first) { first = false; return new Promise(resolve => { complete = resolve; }); }
      return { data: { resolved_tenant_id: tenant, targets: [], total_count: 0, has_more: false }, error: null };
    });
    await act(async () => { root.render(<Probe ports={ports} />); await flush(); });
    await act(async () => { root.render(<Probe ports={ports} workspace={receipt} />); await flush(); });
    await act(async () => { root.render(<Probe ports={ports} />); await flush(); });
    await act(async () => { complete({ data: { resolved_tenant_id: tenant, targets: [target], total_count: 1, has_more: false }, error: null }); await flush(); });
    expect(model.list).toMatchObject({ kind: "ready", targets: [] });
  });
});
