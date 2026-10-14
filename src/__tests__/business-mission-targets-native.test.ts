// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeVerifiedMissionTargetMutation } from "../../supabase/functions/_shared/business-mission-targets/native";
import type { MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";

const tenant = "11111111-1111-4111-8111-111111111111";
const mission = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const request = "44444444-4444-4444-8444-444444444444";
const id = "55555555-5555-4555-8555-555555555555";
const receiptId = "66666666-6666-4666-8666-666666666666";
const definition = {
  title: "Increase active clients", metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "quarter", semantics: "current_snapshot", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "10", upper_value: null,
};
const args = { request_key: request, mission_id: mission, expected_mission_revision: 1, target_id: null, expected_target_revision: null, definition, metric_evidence_ref: "aneb_v1_" + "c".repeat(64), reason: "Reviewed strategy" };
const target = { ...definition, id, tenant_id: tenant, mission_id: mission, revision: 1, state: "active" } as MissionTarget;
type Reply = { data: unknown; error: { message?: string } | null };
function setup(options: { scopes?: string[]; read?: unknown; write?: Reply | Error; rail?: boolean | Error; receipt?: unknown } = {}) {
  const scopes = options.scopes ? [...options.scopes] : [tenant, tenant, tenant, tenant];
  const caller = { rpc: vi.fn(async (name: string): Promise<Reply> => {
    if (name === "current_user_tenant_id") return { data: scopes.shift(), error: null };
    if (name === "get_business_mission") return { data: { mission: { id: mission } }, error: null };
    if (name === "save_business_mission_target" || name === "transition_business_mission_target") {
      if (options.write instanceof Error) throw options.write;
      return options.write ?? { data: { ok: true, target_id: id, mission_id: mission, revision: 1, state: "active", receipt_id: receiptId, request_key: request, replayed: false }, error: null };
    }
    if (name === "get_business_mission_target_receipt") {
      const r = (options.read ?? target) as MissionTarget;
      return { data: options.receipt ?? { id: receiptId, request_key: request, mission_id: mission,
        operation: r.state === "paused" ? "target_transition" : "target_create",
        result: { target_id: id, revision: r.revision, state: r.state, receipt_id: receiptId, request_key: request } }, error: null };
    }
    if (name === "get_business_mission_target_revision") return { data: options.read ?? target, error: null };
    throw new Error("Unexpected RPC: " + name);
  }) };
  const recordRun = vi.fn(async () => { if (options.rail instanceof Error) throw options.rail; return options.rail ?? true; });
  const run = (patch: Partial<Parameters<typeof executeVerifiedMissionTargetMutation>[0]> = {}) => executeVerifiedMissionTargetMutation({ caller, expectedTenantId: tenant, actorId: actor, tool: "mission_target_save", args, recordRun, ...patch });
  return { caller, recordRun, run };
}

describe("mission target native boundary verifies committed canonical revisions", () => {
  it("reads caller scope, selected Play, canonical write, exact revision and scope before Rail", async () => {
    const h = setup();
    expect(await h.run()).toMatchObject({ success: true, verified: true, replayed: false, railRecorded: true, receipt: { requestKey: request, revision: 1 } });
    expect(h.caller.rpc.mock.calls.map(c => c[0])).toEqual(["current_user_tenant_id", "get_business_mission", "current_user_tenant_id", "save_business_mission_target", "current_user_tenant_id", "get_business_mission_target_revision", "get_business_mission_target_receipt", "current_user_tenant_id"]);
    expect(h.recordRun).toHaveBeenCalledOnce();
    expect(h.recordRun).toHaveBeenCalledWith({ tenantId: tenant, actorId: actor, capabilityKey: "mission_target_save", outcome: "capability_succeeded", runId: request });
  });
  it.each([{ tenant_id: tenant }, { target_id: "bad" }, { target_id: id, expected_target_revision: null }, { definition: null }, { metric_evidence_ref: "forged" }, { reason: "" }])("refuses malformed or extra client authority before any RPC: %j", patch => {
    const h = setup();
    return h.run({ args: { ...args, ...patch } }).then(r => { expect(r).toMatchObject({ success: false, mutationMayHavePersisted: false }); expect(h.caller.rpc).not.toHaveBeenCalled(); });
  });
  it.each([0, 1])("stops a workspace change at pre-write boundary %s", async boundary => {
    const scopes = [tenant, tenant]; scopes[boundary] = id;
    const h = setup({ scopes });
    expect(await h.run()).toMatchObject({ success: false, code: "ACTIVE_ACCOUNT_CHANGED", mutationMayHavePersisted: false });
    expect(h.caller.rpc.mock.calls.some(c => c[0] === "save_business_mission_target")).toBe(false);
    expect(h.recordRun).not.toHaveBeenCalled();
  });
  it.each([2, 3])("holds uncertain committed result when scope changes at post-write boundary %s", async boundary => {
    const scopes = [tenant, tenant, tenant, tenant]; scopes[boundary] = id;
    const h = setup({ scopes });
    expect(await h.run()).toMatchObject({ success: false, code: "ACTIVE_ACCOUNT_CHANGED", mutationMayHavePersisted: true });
    expect(h.recordRun).not.toHaveBeenCalled();
  });
  it("distinguishes unknown transport from a definite SQL refusal", async () => {
    const unknown = setup({ write: new Error("connection lost") });
    expect(await unknown.run()).toMatchObject({ success: false, code: "MISSION_TARGET_WRITE_OUTCOME_UNKNOWN", mutationMayHavePersisted: true });
    const refused = setup({ write: { data: null, error: { message: "MISSION_TARGET_REVISION_CONFLICT" } } });
    expect(await refused.run()).toMatchObject({ success: false, code: "MISSION_TARGET_REVISION_CONFLICT", mutationMayHavePersisted: false });
    expect(unknown.recordRun).not.toHaveBeenCalled(); expect(refused.recordRun).not.toHaveBeenCalled();
  });
  it.each([{ desired_value: "999" }, { tenant_id: id }, { mission_id: id }, { revision: 2 }, { state: "paused" }])("never records unverified readback %j", async patch => {
    const h = setup({ read: { ...target, ...patch } });
    expect(await h.run()).toMatchObject({ success: false, code: "MISSION_TARGET_READBACK_MISMATCH", mutationMayHavePersisted: true });
    expect(h.recordRun).not.toHaveBeenCalled();
  });
  it("reconciles an exact immutable old revision rather than mistakenly demanding latest state", async () => {
    const h = setup({ write: { data: { ok: true, target_id: id, mission_id: mission, revision: 1, state: "active", receipt_id: receiptId, request_key: request, replayed: true }, error: null } });
    expect(await h.run()).toMatchObject({ success: true, verified: true, replayed: true });
    expect(h.caller.rpc).toHaveBeenCalledWith("get_business_mission_target_revision", { p_target_id: id, p_revision: 1 });
  });
  it("does not invite a second write when only the existing Rail recorder is unavailable", async () => {
    const h = setup({ rail: new Error("activity unavailable") });
    expect(await h.run()).toMatchObject({ success: true, verified: true, railRecorded: false });
    expect(h.caller.rpc.mock.calls.filter(c => c[0] === "save_business_mission_target")).toHaveLength(1);
  });
  it("verifies lifecycle state in the exact new immutable revision", async () => {
    const h = setup({ read: { ...target, revision: 3, state: "paused" }, write: { data: { ok: true, target_id: id, mission_id: mission, revision: 3, state: "paused", receipt_id: receiptId, request_key: request, replayed: false }, error: null } });
    const { definition: _d, metric_evidence_ref: _e, ...common } = args;
    expect(await h.run({ tool: "mission_target_transition", args: { ...common, target_id: id, expected_target_revision: 2, to_state: "paused" } })).toMatchObject({ success: true, target: { state: "paused", revision: 3 } });
  });
  it("withholds completion and Rail if the canonical receipt cannot be verified", async () => {
    const h = setup({ receipt: { id: receiptId, request_key: request, mission_id: id, operation: "target_create", result: {} } });
    expect(await h.run()).toMatchObject({ success: false, code: "MISSION_TARGET_RECEIPT_UNVERIFIED", mutationMayHavePersisted: true });
    expect(h.recordRun).not.toHaveBeenCalled();
  });
});
