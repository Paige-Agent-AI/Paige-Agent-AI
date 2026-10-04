// @vitest-environment node
//
// Piece 3b WIRING — the capability manifest seams a unit test can't see (§32/§37). The pure signal
// builder, decision core, and render block are unit-tested in paige-capability-signals.test.ts and
// paige-capability-render.test.ts; this asserts the edge handler actually: imports the pure pieces;
// OFFERS capability_status via the gateway; resolves the manifest through ONE gatherer that feeds
// BOTH the capability_status read tool AND the per-turn prompt block (§18, so they can't diverge);
// and injects that block into the model's system context (the P0 Defect-1 grounding).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const src = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

describe("capability_status tool wiring (source assertions)", () => {
  it("imports the projection, the legacy classification, the render block, the Spine registry and the authority seam", () => {
    // C0a — the manifest is a PROJECTION over the emitted tools, never the hand-written signal list.
    expect(src).toContain('from "../_shared/paige-capability-status/projection.ts"');
    expect(src).toContain('import { LEGACY_CAPABILITIES } from "../_shared/paige-capability-status/legacy-capabilities.ts"');
    expect(src).toContain('import { renderProjectedCapabilityBlock, type SpecialistSummary } from "../_shared/paige-capability-status/render.ts"');
    expect(src).toContain('import { PAIGE_SPINE_CAPABILITIES } from "../_shared/paige-spine/registry.ts"');
    expect(src).toContain('from "../_shared/workspace-authority.ts"');
    // the hand-written family list is no longer the chat's authority
    expect(src).not.toContain("buildCapabilitySignals");
    expect(src).not.toContain("gatherCapabilityManifest");
  });

  it("offers the tool via the Capability Gateway (not inline) with no body params", () => {
    // MIGRATED 2026-09 — the def moved OFF the inline handler array and onto the Capability Gateway
    // (owner ruling 2026-09-01: domains/Spine own features, Chat consumes), which is how the
    // chat-tool-registry ratchet descended 10 → 8.
    expect(src).not.toMatch(/^\s*name: "capability_status",\s*$/m);
    expect(src).toContain("...buildGatewayToolDefs()");
    expect(src).toContain('import { buildGatewayToolDefs } from "../_shared/paige-capability-gateway/gateway.ts"');

    const gw = readFileSync("supabase/functions/_shared/paige-capability-gateway/gateway.ts", "utf8");
    const at = gw.indexOf('name: "capability_status"');
    expect(at).toBeGreaterThan(-1);
    const defWindow = gw.slice(at, at + 1200);
    expect(defWindow).toContain("parameters: {");
    expect(defWindow).toContain("properties: {}");
  });

  it("has a describeStep case so the live trace reads honestly", () => {
    expect(src).toContain('case "capability_status": return { label: "Checking what I can do here", group: "owner" };');
  });

  it("routes capability_status INTO the owner-ops branch, where it needs no workspace role", () => {
    const auth = readFileSync("supabase/functions/_shared/workspace-authority.ts", "utf8");
    expect(auth).toMatch(/OWNER_OPS_BRANCH_TOOLS[^;]*"capability_status"/s);
    expect(auth).toContain('export const ROLE_FREE_BRANCH_TOOLS: ReadonlySet<string> = new Set(["capability_status"]);');
    expect(src).toContain("OWNER_OPS_BRANCH_TOOLS.has(tc.function.name) ||");
    expect(src).toContain("|| ROLE_FREE_BRANCH_TOOLS.has(tc.function.name)");
  });

  it("resolves ONE shared projection — server-side facts over exactly the emitted tools", () => {
    expect(src).toContain("const gatherCapabilityProjection = (): Promise<CapabilityProjection> => (capabilityProjectionCache ??=");
    // the projection reads the FINAL emitted tool list, not a hand list
    expect(src).toMatch(/const emitted = \(toolDefs as any\[\]\)/);
    // lanes: the Trust-Compass clamp in ONE round trip, then the SAME action-class clamp the gate uses
    expect(src).toContain('supabaseClient.rpc("resolve_tool_autonomy_many"');
    expect(src).toContain("lanes.set(key, clampLaneByRisk(mode, key) as Lane);");
    expect(src).toContain('import { classifyAction, clampLaneByRisk,');
    expect(readFileSync("supabase/functions/_shared/action-risk.ts", "utf8")).toContain("export function clampLaneByRisk(");
    // authority: the SAME resolver the dispatch gate uses (workspace role, never the global admin row)
    expect(src).toContain("isWorkspaceAdmin: (tool) => authorityAdmits(tool, authority, WORKSPACE_BUILD_TOOLS),");
    // research readiness gates on the REAL provider-key presence, never the value (§13/§34)
    expect(src).toContain('["research_provider", Deno.env.get("FIRECRAWL_API_KEY") ? "ready" : "not_ready"]');
    // n8n readiness is the MCP/OAuth state — "available" only means the record parsed (the R0 over-claim)
    expect(src).toContain('if (mcp === "connected_approved_tools" || mcp === "connected_no_approved_tools") return "ready";');

    // the tool dispatch returns the SAME cached projection (never its own divergent resolution)
    const at = src.indexOf('} else if (tc.function.name === "capability_status") {');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 900);
    expect(block).toContain("const projection = await gatherCapabilityProjection();");
    expect(block).toContain("capabilities: projection.rows,");
  });

  it("injects the per-turn capability block, tenant-only and never a client seat, filled once the tool list is final", () => {
    expect(src).toContain('const capabilityManifestEligible = !!personaCtx.tenant_id && callerTier !== "client";');
    expect(src).toContain("...(capabilityManifestEligible ? [capabilityStatusMessage] : []),");
    expect(src).toContain("capabilityStatusMessage.content = renderProjectedCapabilityBlock(projection.rows, projection.specialists);");
    // an empty or failed projection is removed — never an empty or half-resolved system message
    expect(src).toContain("const at = aiMessages.indexOf(capabilityStatusMessage);");
    // ORDER: Studio narrowing → fill → first model call
    const narrow = src.indexOf("const offScope = narrowToolDefs(");
    const fill = src.indexOf("capabilityStatusMessage.content = renderProjectedCapabilityBlock(");
    const firstCall = src.indexOf("messages: liveDecisionMessages(aiMessages),");
    expect(narrow).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(narrow);
    expect(firstCall).toBeGreaterThan(fill);
  });

  it("is NOT declared a mutating tool — it is a read, so no approval gate wraps it (§no false confirm)", () => {
    const risk = readFileSync("supabase/functions/_shared/action-risk.ts", "utf8");
    expect(risk).not.toContain("capability_status");
    const verb = /(^|_)(create|update|delete|remove|save|send|publish|install|uninstall|grant|revoke|run|assign|enroll|book|set|draft|generate|file|advance|forge|archive|activate|deactivate|move|add|build|log|author|enable|disable|invite|upload|apply|approve|reject|import|export|sync|write|post|schedule|cancel|start|stop|trigger|fire|configure|buy|purchase|name|rename|propose|provision|claim|release)(_|$)/;
    expect(verb.test("capability_status")).toBe(false);
  });
});
