// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readMissionTargets, mutateMissionTarget, readMissionTargetActual, readMissionTargetHistory } from "./mission-target-client";

const actor = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const mission = "33333333-3333-4333-8333-333333333333";
const targetId = "44444444-4444-4444-8444-444444444444";
const requestKey = "55555555-5555-4555-8555-555555555555";
const receiptId = "66666666-6666-4666-8666-666666666666";
const now = Date.parse("2026-10-14T12:00:00Z");
const target = { id: targetId, tenant_id: tenant, mission_id: mission, revision: 1, state: "active" as const, title: "Grow active clients",
  metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count" as const, currency: null, dimensions: {}, range_key: "quarter" as const, semantics: "current_snapshot" as const, business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least" as const, desired_value: "10", upper_value: null };
const args = { request_key: requestKey, mission_id: mission, expected_mission_revision: 1, target_id: null, expected_target_revision: null, definition: { title: target.title, metric: target.metric, period: target.period, comparison: target.comparison, desired_value: target.desired_value, upper_value: null }, metric_evidence_ref: "aneb_v1_" + "c".repeat(64), reason: "Reviewed owner target" };
const success = { success: true, verified: true, railRecorded: true, target, receipt: { id: receiptId, requestKey, revision: 1, operation: "target_create" } };
function harness() {
  let live = true;
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor } }, error: null })) },
    rpc: vi.fn(async (name: string): Promise<{ data: unknown; error: null }> => name === "current_user_tenant_id"
      ? { data: tenant, error: null } : { data: { resolved_tenant_id: tenant, targets: [target], total_count: 1, has_more: false }, error: null }),
    functions: { invoke: vi.fn(async () => ({ data: success as unknown, error: null as unknown })) } };
  const scope = { actorId: actor, tenantId: tenant, missionId: mission, current: () => live };
  return { caller, scope, retire: () => { live = false; } };
}
describe("native target consumer scopes and truthful outcomes", () => {
  function historyHarness(receipt: unknown = { id: receiptId, request_key: requestKey, mission_id: mission, target_id: targetId, revision: 1, state: "active", operation: "target_create" }) {
    const h = harness();
    h.caller.rpc.mockImplementation(async name => ({ data: name === "current_user_tenant_id" ? tenant : name === "get_business_mission_target" ? target
      : { resolved_tenant_id: tenant, target_id: targetId, total_count: 1, has_more: false, versions: [{ revision: 1, state: "active", definition: args.definition, created_at: "2026-10-14T12:00:00Z", revision_reason: "Owner reason", receipt }] }, error: null }));
    return h;
  }
  it("retrieves the same canonical revision and durable receipt on independent later reads", async () => {
    const h = historyHarness();
    const expected = { kind: "ready", totalCount: 1, hasMore: false, versions: [{ target, reason: "Owner reason", at: "2026-10-14T12:00:00Z", receipt: { id: receiptId, requestKey, operation: "target_create" } }] };
    expect(await readMissionTargetHistory(h.caller, h.scope, targetId)).toEqual(expected);
    expect(await readMissionTargetHistory(h.caller, h.scope, targetId)).toEqual(expected);
    expect(h.caller.functions.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { id: receiptId, request_key: requestKey, mission_id: actor, target_id: targetId, revision: 1, state: "active", operation: "target_create" },
    { id: receiptId, request_key: requestKey, mission_id: mission, target_id: actor, revision: 1, state: "active", operation: "target_create" },
    { id: receiptId, request_key: requestKey, mission_id: mission, target_id: targetId, revision: 2, state: "active", operation: "target_create" },
  ])("withholds an incorrectly bound historical receipt: %j", async receipt => {
    const h = historyHarness(receipt);
    expect(await readMissionTargetHistory(h.caller, h.scope, targetId)).toEqual({ kind: "unavailable" });
  });
  it("keeps a missing receipt unverified without inventing a replacement or hiding the saved definition", async () => {
    const h = historyHarness(null);
    expect(await readMissionTargetHistory(h.caller, h.scope, targetId)).toMatchObject({ kind: "ready", versions: [{ target, receipt: null }] });
  });
  it("does not read history through a target from another Play", async () => {
    const h = historyHarness();
    h.caller.rpc.mockImplementation(async name => ({ data: name === "current_user_tenant_id" ? tenant : { ...target, mission_id: actor }, error: null }));
    expect(await readMissionTargetHistory(h.caller, h.scope, targetId)).toEqual({ kind: "unavailable" });
    expect(h.caller.rpc.mock.calls.some(c => c[0] === "list_business_mission_target_versions")).toBe(false);
  });
  it("returns the exact canonical count/list after current actor and workspace readback", async () => {
    const h = harness();
    expect(await readMissionTargets(h.caller, h.scope)).toMatchObject({ kind: "ready", targets: [target], totalCount: 1, hasMore: false });
    expect(h.caller.functions.invoke).not.toHaveBeenCalled();
  });
  it("drops a late list after its scope incarnation is retired, including A-B-A", async () => {
    const h = harness();
    h.caller.rpc.mockImplementation(async name => { if (name === "current_user_tenant_id") return { data: tenant, error: null }; h.retire(); return { data: { resolved_tenant_id: tenant, targets: [target], total_count: 1, has_more: false }, error: null }; });
    expect(await readMissionTargets(h.caller, h.scope)).toEqual({ kind: "scope_changed" });
  });
  it.each([{ ...target, tenant_id: actor }, { ...target, mission_id: actor }])("never projects a mismatched child record: %j", async row => {
    const h = harness();
    h.caller.rpc.mockImplementation(async name => ({ data: name === "current_user_tenant_id" ? tenant : { resolved_tenant_id: tenant, targets: [row], total_count: 1, has_more: false }, error: null }));
    expect(await readMissionTargets(h.caller, h.scope)).toEqual({ kind: "unavailable" });
  });
  it("requires the actual current actor before the mutation door", async () => {
    const h = harness(); h.caller.auth.getUser.mockResolvedValue({ data: { user: { id: receiptId } }, error: null });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "refused", mayHavePersisted: false });
    expect(h.caller.functions.invoke).not.toHaveBeenCalled();
  });
  it("accepts only a verified exact target and original receipt, reporting activity independently", async () => {
    const h = harness(); h.caller.functions.invoke.mockResolvedValue({ data: { ...success, railRecorded: false }, error: null });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "verified", target, railRecorded: false, receipt: { requestKey } });
  });
  it.each([
    { ...success, receipt: { ...success.receipt, requestKey: actor } },
    { ...success, target: { ...target, tenant_id: actor } },
    { success: true, verified: true },
    { ...success, target: { ...target, desired_value: "999" } },
  ])("holds an invalid success envelope as uncertain: %j", async data => {
    const h = harness(); h.caller.functions.invoke.mockResolvedValue({ data, error: null });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "uncertain", mayHavePersisted: true });
  });
  it.each([new Error("lost"), { context: { json: async () => { throw Error("unreadable"); } } }])("does not turn invoke transport loss into definite refusal", async error => {
    const h = harness(); h.caller.functions.invoke.mockResolvedValue({ data: null, error });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "uncertain", mayHavePersisted: true });
    expect(h.caller.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it("honors an error response's explicit persisted-uncertainty flag", async () => {
    const h = harness(); h.caller.functions.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ success: false, code: "ACTIVE_ACCOUNT_CHANGED", mutationMayHavePersisted: true }) } } });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "uncertain", mayHavePersisted: true });
  });
  it("withholds success after scope loss while retaining the possible committed outcome", async () => {
    const h = harness(); h.caller.functions.invoke.mockImplementation(async () => { h.retire(); return { data: success, error: null }; });
    expect(await mutateMissionTarget(h.caller, h.scope, "mission_target_save", args)).toMatchObject({ kind: "scope_changed", mayHavePersisted: true });
  });
  it("refuses to issue target actuals after scope retirement", async () => {
    const h = harness(); h.retire();
    expect(await readMissionTargetActual(h.caller, h.scope, target, () => now)).toEqual({ kind: "scope_changed" });
    expect(h.caller.rpc).not.toHaveBeenCalled();
  });
  it("issues and resolves an actual through the incumbent metric contract before projecting exact variance", async () => {
    const h = harness();
    const metric = { metric_key: target.metric.key, metric_version: "1.0.0", owner_department: "business", label: "Active clients", definition: "Current active clients", formula: "Count scoped active clients",
      range: { key: "quarter", start: target.period.start, end: new Date(now).toISOString(), bounds: "[start,end)", timezone: "UTC", semantics: "current_snapshot" }, dimensions: {}, values: { kind: "count", count: 12 }, unit: "count",
      source_refs: ["public.clients"], as_of: new Date(now).toISOString(), freshness: { queried_at: new Date(now).toISOString(), source_updated_through: null }, coverage: { state: "complete", candidate_count: 12, contributing_count: 12, excluded_count: 0 },
      exclusions: [], truth_state: "LIVE", caveats: [], source_revision_ref: "sr_v1_" + "a".repeat(64), account_epoch: tenant, account_epoch_ref: "ae_v1_" + "b".repeat(64), evidence_ref: "aneb_v1_" + "c".repeat(64), reference_expires_at: new Date(now + 900000).toISOString() };
    h.caller.rpc.mockImplementation(async name => ({ data: name === "current_user_tenant_id" ? tenant : name === "get_business_mission" ? { mission: { id: mission } } : metric, error: null }));
    expect(await readMissionTargetActual(h.caller, h.scope, target, () => now)).toMatchObject({ kind: "ready", observation: { actual: "12", variance: "2", attainment: "met" } });
    expect(h.caller.rpc.mock.calls.filter(c => /analytics_evidence/.test(c[0])).map(c => c[0])).toEqual(["issue_analytics_evidence_bundle", "resolve_analytics_evidence_reference"]);
    // A later-turn or expired reference cannot produce an actual, even when the
    // stored target definition and its desired value remain valid.
    expect(await readMissionTargetActual(h.caller, h.scope, target, () => now + 900000)).toEqual({ kind: "unavailable" });
  });
});
