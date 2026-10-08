/**
 * GHL-1 — the governed chat lane for GoHighLevel, declared from the REAL tool catalogue.
 *
 * The owner's transcript (2026-10-03) demanded it: "can you get any contacts out of GHL and
 * start adding them here inside of our CRM records?" — and after his pushback rounds Paige
 * honestly reported the gap: "The GHL MCP connection exists and is healthy, but I don't have
 * the capability exposed to pull contact data." TRUE: the M4 lane deliberately shipped the
 * connection with NO chat surface, gated on a real connection's discovery — which the
 * owner's live connection (36 real tools: contacts_*, conversations_*, opportunities_*,
 * calendars_*, payments_*, blogs_*, social-posting_*, emails_*, locations_*) just provided.
 *
 * This suite pins the lane that closes the gap:
 *  - the Spine domain declares the two chat tools from the real catalogue (list=read,
 *    run=external_effect behind chat-canonical propose-first);
 *  - the registry lint's GHL TypeScript PROOF vouches the wiring (the canonical-connection
 *    resolution, the gateway dispatch, prepare-vs-execute on the approval channel, the
 *    honest not_connected);
 *  - the chat manifest declares both tools with the governed copy;
 *  - the risk class is high (the mutating gate forces confirm even on auto).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { GHL_MANAGEMENT_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/domains/ghl_management.ts";

const root = join(__dirname, "..", "..");
const domain = readFileSync(join(root, "supabase/functions/_shared/paige-spine/domains/ghl_management.ts"), "utf8");
const registry = readFileSync(join(root, "supabase/functions/_shared/paige-spine/registry.ts"), "utf8");
const lint = readFileSync(join(root, "scripts/ci/paige-spine-registry-lint.mjs"), "utf8");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const adapter = readFileSync(join(root, "supabase/functions/_shared/ghl-management.ts"), "utf8");
const actionRisk = readFileSync(join(root, "supabase/functions/_shared/action-risk.ts"), "utf8");

describe("the GHL Spine domain is declared from the real catalogue", () => {
  it("the registry composes the ghl management domain", () => {
    expect(registry).toContain("...GHL_MANAGEMENT_CAPABILITIES");
    expect(GHL_MANAGEMENT_CAPABILITIES.every(cap => PAIGE_SPINE_CAPABILITIES.includes(cap))).toBe(true);
    expect(validateSpineRegistry(GHL_MANAGEMENT_CAPABILITIES)).toEqual([]);
  });

  it("list is read-only; run is an external effect behind chat-canonical propose-first", () => {
    expect(domain).toContain('key: "integrations.ghl_list_actions"');
    expect(domain).toContain('chatTool: "ghl_list_actions", riskPolicyKey: "read_only", approvalAuthority: "none"');
    expect(domain).toContain('key: "integrations.ghl_run_action"');
    expect(domain).toContain('classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "ghl_run_action", riskPolicyKey: "high", approvalAuthority: "chat-canonical"');
  });

  it("the projectors name the REAL projection homes (the gateway's own closed actions)", () => {
    expect(domain).toContain('projector: "mcp-gateway.tools"');
    expect(domain).toContain('projector: "mcp-gateway.execute"');
  });

  it("the domain cites the discovery event (the owner's live 36-tool catalogue) as its gate", () => {
    expect(domain).toContain("36 real tools");
    expect(domain).toContain("declared from the REAL discovered tool catalogue");
  });
});

describe("the registry lint carries the GHL TypeScript proof", () => {
  it("the proof exists and vouches both gateway symbols", () => {
    expect(lint).toContain("function validateGhlTypeScript");
    expect(lint).toContain("projector:'mcp-gateway.tools'");
    expect(lint).toContain("projector:'mcp-gateway.execute'");
  });

  it("the proof's seven negatives are in the self-test (adapter-tool, unmount, resolution, guard, prepare-bypass, not_connected, refusal-body)", () => {
    expect(lint).toContain("ghlNegatives=[");
    expect(lint).toContain("['ghl adapter tool removed'");
    expect(lint).toContain("['ghl adapter unmounted'");
    expect(lint).toContain("['ghl provider resolution weakened'");
    expect(lint).toContain("['ghl dispatch guard weakened'");
    expect(lint).toContain("['ghl prepare bypass (always execute)'");
    expect(lint).toContain("['ghl honest not_connected removed'");
    expect(lint).toContain("['ghl refusal body dropped'");
  });

  it("the proof verifies the ADAPTER shape (specs catalog → derived catalog → spread mount)", () => {
    expect(lint).toContain("adapter derives tools from a literal specs catalog");
    expect(lint).toContain("catalog mounted in the handler toolDefs by spread (never re-declared inline)");
  });
});

describe("the chat manifest and dispatch carry the governed lane", () => {
  it("both tools are declared with discovery-first + propose-first + gate-honest copy (in the domain ADAPTER)", () => {
    expect(adapter).toContain("ghl_list_actions: {");
    expect(adapter).toContain("ghl_run_action: {");
    expect(adapter).toContain("Resolve the exact tool_name here BEFORE running one with ghl_run_action");
    expect(adapter).toContain("until then the call returns the honest prepare result");
    expect(adapter).toContain("LIVE execution additionally requires the owner's gateway execute gate");
    // The chat-handler ruling: mounted by spread, never re-declared inline.
    expect(chat).toContain("...GHL_MANAGEMENT_TOOLS,");
    expect(chat).not.toContain('name: "ghl_list_actions",');
    expect(chat).not.toContain('name: "ghl_run_action",');
  });

  it("the dispatch resolves the canonical connection server-side — never a model-supplied id", () => {
    expect(chat).toContain('tc.function.name === "ghl_list_actions" || tc.function.name === "ghl_run_action"');
    expect(chat).toContain('c?.provider_key === "gohighlevel"');
    expect(chat).not.toContain("connection_id: args.");
  });

  it("the run dispatch prepares without approval and executes with it", () => {
    expect(chat).toContain('mode: approvalChannel.has(tc.id) ? "execute" : "prepare"');
  });

  it("gateway REFUSAL BODIES reach the model verbatim — never the generic transport sentence", () => {
    // functions.invoke resolves a non-2xx to {data:null, error:FunctionsHttpError} whose
    // message is a transport constant; the gateway's closed refusal vocabulary
    // (execute_not_enabled, approval_required, not_found, bad_tool_name) lives in the BODY.
    // Both GHL invoke sites read it with the in-file helper built for exactly this seam.
    expect(chat.match(/readInvokeBody\(ghlErr, ghlData\)/g)?.length).toBe(2);
    expect(chat).not.toMatch(/ghlErr\) throw ghlErr/);
  });

  it("the catalogue names the waiting tools — never a bare count", () => {
    expect(chat).toContain("NAME the waiting tools so the operator can act");
  });

  it("the confirm card names the live-CRM consequence", () => {
    expect(chat).toContain('case "ghl_run_action":');
    expect(chat).toContain("this touches the live CRM");
  });
});

describe("the risk class gates unattended use", () => {
  it("ghl_run_action is high — the mutating gate forces confirm even on auto", () => {
    expect(actionRisk).toContain('["ghl_run_action", "high", "runs a tool in the tenant\'s GoHighLevel CRM');
  });
});
