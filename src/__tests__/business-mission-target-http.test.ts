// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { executeVerifiedMissionTargetMutation } from "../../supabase/functions/_shared/business-mission-targets/native";

const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222";
const mission = "33333333-3333-4333-8333-333333333333", id = "44444444-4444-4444-8444-444444444444";
const requestKey = "55555555-5555-4555-8555-555555555555", receiptId = "66666666-6666-4666-8666-666666666666";
const definition = { title: "Grow active clients", metric: { key: "business.active_clients_current", version: "1.0.0", unit: "count", value_kind: "count", currency: null, dimensions: {}, range_key: "quarter", semantics: "current_snapshot", business_time_zone: null },
  period: { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z", time_zone: "UTC" }, comparison: "at_least", desired_value: "10", upper_value: null };
const target = { ...definition, id, tenant_id: tenant, mission_id: mission, revision: 1, state: "active" };
const args = { request_key: requestKey, mission_id: mission, expected_mission_revision: 1, target_id: null, expected_target_revision: null, definition, metric_evidence_ref: "aneb_v1_" + "c".repeat(64), reason: "Owner target" };
function harness(authenticated = true) {
  let handler!: (r: Request) => Promise<Response>;
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: authenticated ? { id: actor } : null }, error: null })) }, rpc: vi.fn(async (name: string) => {
    if (name === "current_user_tenant_id") return { data: tenant, error: null };
    if (name === "get_business_mission") return { data: { mission: { id: mission } }, error: null };
    if (name === "save_business_mission_target") return { data: { ok: true, target_id: id, mission_id: mission, revision: 1, state: "active", receipt_id: receiptId, request_key: requestKey, replayed: false }, error: null };
    if (name === "get_business_mission_target_revision") return { data: target, error: null };
    if (name === "get_business_mission_target_receipt") return { data: { id: receiptId, request_key: requestKey, mission_id: mission, operation: "target_create", result: { target_id: id, revision: 1, state: "active", receipt_id: receiptId, request_key: requestKey } }, error: null };
    throw Error("Unexpected RPC " + name);
  }) };
  const admin = { rpc: vi.fn() }, record = vi.fn(async () => true), existing = vi.fn(async () => ({ success: true, verified: true }));
  const deps: Record<string, unknown> = {
    "https://esm.sh/@supabase/supabase-js@2.75.0": { createClient: (_url: string, key: string) => key === "test-service" ? admin : caller },
    "../_shared/business-mission-tenant-brain.ts": { executeVerifiedMissionMutation: existing },
    "../_shared/business-mission-targets/native.ts": { executeVerifiedMissionTargetMutation },
    "../_shared/capability-record.ts": { recordCapabilityRun: record },
  };
  const source = readFileSync("supabase/functions/business-mission-action/index.ts", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", "Deno", code)((name: string) => { if (!(name in deps)) throw Error(name); return deps[name]; }, {}, {
    serve: (fn: typeof handler) => { handler = fn; }, env: { get: (name: string) => ({ SUPABASE_URL: "https://test.invalid", SUPABASE_ANON_KEY: "test-public", SUPABASE_SERVICE_ROLE_KEY: "test-service" })[name] },
  });
  const run = (body: unknown, authorization = "Bearer test-session") => handler(new Request("https://test.invalid/business-mission-action", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) }));
  return { caller, admin, record, existing, run };
}
describe("actual existing native Mission HTTP door with target adoption", () => {
  it("performs exact target/receipt readback before existing Rail, attributing the native owner", async () => {
    const h = harness(), response = await h.run({ tool: "mission_target_save", args });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, verified: true, railRecorded: true, target: { id } });
    expect(h.record).toHaveBeenCalledWith(h.admin, { tenantId: tenant, actorId: actor, capabilityKey: "owner_mission_target_save", outcome: "capability_succeeded", runId: requestKey });
    expect(h.existing).not.toHaveBeenCalled();
  });
  it("keeps the existing Mission route, caller and owner_ui source unchanged", async () => {
    const h = harness(); await h.run({ tool: "mission_create", args: { request_key: requestKey } });
    expect(h.existing).toHaveBeenCalledWith(expect.objectContaining({ caller: h.caller, expectedTenantId: tenant, actorId: actor, requestSource: "owner_ui", tool: "mission_create" }));
    expect(h.caller.rpc.mock.calls.some(([name]) => name === "save_business_mission_target")).toBe(false);
  });
  it.each([false, true])("requires verified Auth before a target writer (missing JWT: %s)", async missing => {
    const h = harness(false), response = await h.run({ tool: "mission_target_save", args }, missing ? "" : "Bearer test-session");
    expect(response.status).toBe(401); expect(h.caller.rpc).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  });
  it("rejects an unregistered body tool before authentication or mutation", async () => {
    const h = harness(); expect((await h.run({ tool: "arbitrary_rpc", args })).status).toBe(400);
    expect(h.caller.auth.getUser).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  });
  it.each([null, [], 42, "text"])("refuses a non-object JSON body before any authority or writer: %j", async body => {
    const h = harness(), response = await h.run(body);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, verified: false, code: "BAD_JSON" });
    expect(h.caller.auth.getUser).not.toHaveBeenCalled(); expect(h.caller.rpc).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  });
  it("never takes actor or tenant authority from body fields", async () => {
    const h = harness(); await h.run({ tool: "mission_target_save", args, tenant_id: actor, actor_id: tenant });
    expect(h.record).toHaveBeenCalledWith(h.admin, expect.objectContaining({ tenantId: tenant, actorId: actor }));
  });
});
