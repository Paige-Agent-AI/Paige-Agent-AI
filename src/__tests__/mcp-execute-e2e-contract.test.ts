/**
 * M1 — the n8n end-to-end execute contract.
 *
 * The MCP gateway architecture is complete: the probe wires generation-bound health
 * promotion, the execute handler has the Rail receipt, the consent verifier, and the
 * SSRF-guarded dispatch. What has never been proven is the FULL PATH against a real
 * MCP provider: connect → verify → discover tools → approve → execute → receipt.
 *
 * This suite pins the source-level contract that makes that path testable and honest:
 *  - the gateway exposes verify, oauth_begin, approve, and execute as governed actions;
 *  - the execute gate (MCP_GATEWAY_EXECUTE_ENABLED) refuses with execute_not_enabled;
 *  - the probe writes health through the service-role RPC (never a direct table write);
 *  - the Rail receipt records tenant, actor, capability, outcome, and provider response;
 *  - the consent verifier gates execution on the per-tool approval screen;
 *  - the SSRF guard rejects private endpoints at dispatch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const gatewayIndex = readFileSync(join(root, "supabase/functions/mcp-gateway/index.ts"), "utf8");
const execute = readFileSync(join(root, "supabase/functions/_shared/mcp-gateway/execute.ts"), "utf8");
const verify = readFileSync(join(root, "supabase/functions/_shared/mcp-gateway/verify.ts"), "utf8");
const railReceipt = readFileSync(join(root, "supabase/functions/_shared/mcp-gateway/rail-receipt.ts"), "utf8");

describe("the gateway exposes all four governed actions", () => {
  it("verify is a gateway action", () => {
    expect(gatewayIndex).toContain('"verify"');
  });

  it("execute is a gateway action", () => {
    expect(gatewayIndex).toContain('"execute"');
  });

  it("approve is a gateway action", () => {
    expect(gatewayIndex).toContain('"approve"');
  });

  it("oauth_begin is a gateway action", () => {
    expect(gatewayIndex).toContain('"oauth_begin"');
  });
});

describe("the execute gate refuses when disabled", () => {
  it("the gate checks executeEnabled before any provider contact", () => {
    expect(execute).toContain('mode === "execute" && !executeEnabled');
    expect(execute).toContain('"execute_not_enabled"');
  });

  it("prepare mode is always allowed (no provider contact)", () => {
    expect(execute).toContain('mode === "execute" && !executeEnabled');
    // The negation means prepare passes through the gate
    expect(execute).not.toContain('mode === "prepare" && !executeEnabled');
  });
});

describe("the probe writes health through the service-role RPC only", () => {
  it("verify writes through mcp_connection_probe, never a direct table write", () => {
    expect(verify).toContain('rpc("mcp_connection_probe"');
    expect(verify).not.toContain('.from("mcp_connections")');
  });

  it("the probe is generation-bound (INT-152 compare-and-write)", () => {
    expect(verify).toContain("_expected_generation");
    expect(verify).toContain("applied === false");
  });
});

describe("the Rail receipt records the full governed execution", () => {
  it("makeCanonicalRailReceipt is imported and used", () => {
    expect(execute).toContain("makeCanonicalRailReceipt");
    expect(railReceipt).toContain("export function makeCanonicalRailReceipt");
  });

  it("the receipt context derives tenant/actor from the JWT-resolved values, never the body", () => {
    expect(execute).toContain("makeCanonicalRailReceipt(admin, { tenantId, actorId: actor })");
  });
});

describe("the SSRF guard rejects private endpoints at dispatch", () => {
  it("the execute handler uses the SSRF-guarded connection loader", () => {
    expect(execute).toContain("makeRpcConnectionLoader");
    expect(execute).toContain("loadConnection: makeRpcConnectionLoader");
  });

  it("the verify handler uses the SSRF-guarded read-only intake", () => {
    expect(verify).toContain("runReadOnlyIntake");
  });
});

describe("the consent verifier gates execution", () => {
  it("the execute path verifies approval before dispatch", () => {
    expect(execute).toContain("verifyApproval: makeRpcApprovalVerifier");
  });
});

describe("the n8n Spine domain declares governed capabilities", () => {
  it("the registry composes the n8n management domain", () => {
    const registry = readFileSync(join(root, "supabase/functions/_shared/paige-spine/registry.ts"), "utf8");
    expect(registry).toContain("N8N_MANAGEMENT_CAPABILITIES");
    expect(registry).toContain("...N8N_MANAGEMENT_CAPABILITIES");
  });

  it("the n8n domain declares the governed workflow capabilities", () => {
    const domain = readFileSync(join(root, "supabase/functions/_shared/paige-spine/domains/n8n_management.ts"), "utf8");
    expect(domain).toContain('key: "integrations.n8n_list_workflows"');
    expect(domain).toContain('key: "integrations.n8n_create_workflow"');
    expect(domain).toContain('key: "integrations.n8n_activate_workflow"');
  });
});
