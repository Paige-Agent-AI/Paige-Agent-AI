import { describe, expect, it } from "vitest";
import { SPINE_ACTION_CLASSIFICATIONS, type SpineCapability, type SpineSignal } from "@/../supabase/functions/_shared/paige-spine/contracts.ts";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "@/../supabase/functions/_shared/paige-spine/registry.ts";
import { resolveSpineEvidence } from "@/../supabase/functions/_shared/paige-spine/resolveEvidence.ts";

const currentScope = () => ({ isCurrent: () => true });
const validSignal: SpineSignal = {
  signal_id: "f1000000-0000-4000-8000-00000000e101", kind: "pipeline.deal_stage_moved",
  tenant_id: "f1000000-0000-4000-8000-000000001111", subject_type: "client", subject_ref: "CLT-SPINE-A",
  occurred_at: "2026-09-01T12:00:00.000Z", recorded_at: "2026-09-01T12:00:01.000Z",
  source_system: "context_rail", source_record_ref: "rail:f1000000-0000-4000-8000-00000000e101",
  source_actor_type: "person", availability: "available", classification: "operational", lifecycle: "observed",
  safe_summary: "A pipeline stage changed.", facts: { change_type: "stage_changed", outcome: "succeeded", actor: "person" },
  audience: "owner_internal", schema_version: 1, expires_at: "2027-09-01T12:00:00.000Z",
  outcome_ref: "rail:f1000000-0000-4000-8000-00000000e101",
};
const rpc = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });

describe("PAIGE Spine registry", () => {
  it("registers one honest read-only vertical slice", () => {
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
    expect(PAIGE_SPINE_CAPABILITIES[0]).toMatchObject({
      key: "pipeline.deal_stage_evidence", domain: "pipeline", owner: "solo-pipeline", maturity: "PARTIAL",
      chatBinding: "PARTIAL", mindBinding: "PARTIAL", sharedPrimitiveChange: "NONE",
      action: { classification: "read", riskPolicyKey: "read_only", approvalAuthority: "none" },
    });
  });

  it("rejects a retired prepare class and a key outside the owning domain", () => {
    const prepare = { ...PAIGE_SPINE_CAPABILITIES[0], action: { ...PAIGE_SPINE_CAPABILITIES[0].action, classification: "prepare" } } as unknown as SpineCapability;
    const wrongDomain = { ...PAIGE_SPINE_CAPABILITIES[0], key: "future.safe_evidence" } as SpineCapability;
    expect(SPINE_ACTION_CLASSIFICATIONS).toEqual(["read", "mutate", "external_effect"]);
    expect(validateSpineRegistry([prepare]).join("\n")).toMatch(/unsupported action classification prepare/);
    expect(validateSpineRegistry([wrongDomain]).join("\n")).toMatch(/namespace must match domain/);
  });

  it("fails mutable and external actions closed without canonical Chat enforcement", () => {
    const unsafe = {
      ...PAIGE_SPINE_CAPABILITIES[0], key: "pipeline.unsafe_mutation", chatBinding: "PARTIAL",
      action: { classification: "mutate", executor: "public.move_deal", chatTool: "deal_move_stage", idempotency: "", riskPolicyKey: "read_only", approvalAuthority: "none" },
    } as unknown as SpineCapability;
    const findings = validateSpineRegistry([unsafe]).join("\n");
    expect(findings).toMatch(/chat-canonical/); expect(findings).toMatch(/LIVE Chat/);
    expect(findings).toMatch(/ordinary or high/); expect(findings).toMatch(/idempotency/);
    const external = { ...unsafe, chatBinding: "LIVE", action: { ...unsafe.action!, classification: "external_effect", riskPolicyKey: "ordinary", approvalAuthority: "chat-canonical", idempotency: "keyed" } } as SpineCapability;
    expect(validateSpineRegistry([external]).join("\n")).toMatch(/external effects require high/);
  });

  it("rejects duplicate capability keys", () => {
    expect(validateSpineRegistry([PAIGE_SPINE_CAPABILITIES[0], PAIGE_SPINE_CAPABILITIES[0]])).toContain("duplicate capability key: pipeline.deal_stage_evidence");
  });
});

describe("resolveSpineEvidence", () => {
  it("uses only the registered RPC, public client reference, and clamped limit", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const result = await resolveSpineEvidence({ rpc: async (name, args) => { calls.push([name, args]); return { data: [validSignal], error: null }; } },
      "pipeline.deal_stage_evidence", { clientRef: "  clt-spine-a  ", limit: 500, scope: currentScope() });
    expect(calls).toEqual([["get_pipeline_spine_evidence", { p_client_ref: "clt-spine-a", p_limit: 100 }]]);
    expect(result).toEqual({ status: "available", signals: [validSignal] });
    expect(JSON.stringify(calls)).not.toContain("tenant");
  });

  it("fails the whole response closed on structural or nested drift", async () => {
    const malformed = [
      { ...validSignal, raw_payload: "SECRET" }, { ...validSignal, kind: "wrong.kind" },
      { ...validSignal, safe_summary: undefined }, { ...validSignal, facts: { ...validSignal.facts, deal_id: "SECRET" } },
      { ...validSignal, facts: { change_type: { nested: "SECRET" }, outcome: "succeeded", actor: "person" } },
    ];
    for (const row of malformed) await expect(resolveSpineEvidence(rpc([row]), "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: currentScope() }))
      .resolves.toEqual({ status: "unavailable", reason: "resolver_unavailable", signals: [] });
  });

  it("rejects secret-bearing approved fields, invalid time, and mismatched provenance", async () => {
    const malformed = [
      { ...validSignal, safe_summary: "SECRET_TOKEN" }, { ...validSignal, source_system: "SECRET" },
      { ...validSignal, source_actor_type: "SECRET" }, { ...validSignal, classification: "SECRET" },
      { ...validSignal, lifecycle: "SECRET" }, { ...validSignal, facts: { ...validSignal.facts, actor: "SECRET" } },
      { ...validSignal, occurred_at: "not-a-date" }, { ...validSignal, recorded_at: "2025-01-01T00:00:00Z" },
      { ...validSignal, source_record_ref: "rail:other" }, { ...validSignal, outcome_ref: "rail:other" },
    ];
    for (const row of malformed) await expect(resolveSpineEvidence(rpc([row]), "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: currentScope() }))
      .resolves.toEqual({ status: "unavailable", reason: "resolver_unavailable", signals: [] });
  });

  it("rejects subject, audience, UUID, and mixed-tenant drift", async () => {
    const cases = [
      [{ ...validSignal, subject_ref: "CLT-OTHER" }], [{ ...validSignal, audience: "client_visible" }],
      [{ ...validSignal, tenant_id: "not-a-uuid" }],
      [validSignal, { ...validSignal, signal_id: "f2000000-0000-4000-8000-00000000e201", tenant_id: "f2000000-0000-4000-8000-000000002222", source_record_ref: "rail:f2000000-0000-4000-8000-00000000e201", outcome_ref: "rail:f2000000-0000-4000-8000-00000000e201" }],
    ];
    for (const data of cases) await expect(resolveSpineEvidence(rpc(data), "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: currentScope() }))
      .resolves.toEqual({ status: "unavailable", reason: "resolver_unavailable", signals: [] });
  });

  it("requires scope and discards an in-flight response after account switch", async () => {
    await expect(resolveSpineEvidence(rpc([validSignal]), "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A" } as never))
      .resolves.toEqual({ status: "unavailable", reason: "scope_changed", signals: [] });
    let resolveRpc: ((value: { data: unknown; error: unknown }) => void) | undefined;
    let current = true;
    const pending = resolveSpineEvidence({ rpc: () => new Promise((resolve) => { resolveRpc = resolve; }) }, "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: { isCurrent: () => current } });
    current = false; resolveRpc?.({ data: [validSignal], error: null });
    await expect(pending).resolves.toEqual({ status: "unavailable", reason: "scope_changed", signals: [] });
  });

  it("fails closed for missing subject, unknown capability, errors, and exceptions", async () => {
    await expect(resolveSpineEvidence(rpc([]), "pipeline.deal_stage_evidence", { clientRef: " ", scope: currentScope() })).resolves.toEqual({ status: "unavailable", reason: "subject_required", signals: [] });
    await expect(resolveSpineEvidence(rpc([]), "missing.capability", { clientRef: "CLT-SPINE-A", scope: currentScope() })).resolves.toEqual({ status: "unavailable", reason: "capability_unavailable", signals: [] });
    await expect(resolveSpineEvidence(rpc([{ secret: "x" }], { message: "SECRET" }), "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: currentScope() })).resolves.toEqual({ status: "unavailable", reason: "resolver_unavailable", signals: [] });
    await expect(resolveSpineEvidence({ rpc: async () => { throw new Error("SECRET"); } }, "pipeline.deal_stage_evidence", { clientRef: "CLT-SPINE-A", scope: currentScope() })).resolves.toEqual({ status: "unavailable", reason: "resolver_unavailable", signals: [] });
  });
});

describe("PC-1 browser capability registration", () => {
  it("registers browser.browse_public_url as a read-only edge-executor declaration (no chat tool)", () => {
    const cap = PAIGE_SPINE_CAPABILITIES.find((c) => c.key === "browser.browse_public_url");
    expect(cap).toMatchObject({
      domain: "browser",
      owner: "paige-skill-runner",
      action: { classification: "read", executor: "edge.skill-runner", riskPolicyKey: "read_only", approvalAuthority: "none" },
      chatBinding: "UNAVAILABLE",
      sharedPrimitiveChange: "NONE",
    });
    expect(cap?.action?.chatTool).toBeUndefined();
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
  });
});
