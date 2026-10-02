/**
 * M3 — the Zapier governed-lane contract.
 *
 * The owner's MCP objective: n8n, Zapier, and Go High Level each live as their OWN governed
 * connection with their own requirements. For n8n (M1) the full execute path was pinned. For
 * Zapier the pieces already existed on two regimes — the LIVE chat lane (zapier_list_actions /
 * zapier_run_action dispatching through the governed call-zapier-action edge) and the CANONICAL
 * gateway (provider_key='zapier', auth_kind ∈ {oauth,url}) — but the Spine could not see the
 * surface: no capability declarations, so no risk class, no approval authority, no Rail
 * visibility contract. This suite pins the lane end to end:
 *  - the provider descriptor exists with EXACTLY Zapier's two executable auth kinds;
 *  - the loader treats both of Zapier's kinds as MCP-executable (a listed connection can run);
 *  - the Spine registers the two LIVE chat tools with the honest risk classes
 *    (discovery = read-only; RUN = external_effect behind chat-canonical approval);
 *  - the chat manifest carries both tools with the governed propose-first + honest-refusal copy;
 *  - the legacy lane's refusal vocabulary stays closed (an unreachable Zapier is never
 *    reported to an operator as an approval problem).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const registrySeed = readFileSync(
  join(root, "supabase/migrations/20270319000000_connected_mcp_gateway_registry.sql"),
  "utf8",
);
const connection = readFileSync(join(root, "supabase/functions/_shared/mcp-gateway/connection.ts"), "utf8");
const spineRegistry = readFileSync(join(root, "supabase/functions/_shared/paige-spine/registry.ts"), "utf8");
const zapierDomain = readFileSync(
  join(root, "supabase/functions/_shared/paige-spine/domains/zapier_management.ts"),
  "utf8",
);
const chatCore = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const mcpOutcome = readFileSync(join(root, "supabase/functions/_shared/mcp-outcome.ts"), "utf8");

describe("the zapier provider descriptor exists with exactly Zapier's facets", () => {
  it("the seed registers zapier with oauth + url auth kinds over http transport", () => {
    expect(registrySeed).toContain("('zapier',         'Zapier',             false, '{oauth,url}',           '{http}',     'multi', NULL, '{}',");
    expect(registrySeed).toContain("Zapier MCP over OAuth 2.1 (DCR + PKCE) against mcp.zapier.com.");
  });
});

describe("both of zapier's auth kinds are MCP-executable in the canonical loader", () => {
  it("the executable set includes oauth and url and excludes the non-MCP rest facet", () => {
    expect(connection).toContain('MCP_EXECUTABLE_AUTH_KINDS = new Set(["oauth", "bearer", "header", "url", "none"])');
  });
});

describe("the Spine registers the live zapier chat surface", () => {
  it("the registry composes the zapier management domain", () => {
    expect(spineRegistry).toContain("...ZAPIER_MANAGEMENT_CAPABILITIES");
  });

  it("the edge-executor exception covers the zapier entries field-for-field", () => {
    expect(spineRegistry).toContain(
      "const EDGE_CHAT_EXECUTOR_CAPABILITIES = [...N8N_MANAGEMENT_CAPABILITIES, ...ZAPIER_MANAGEMENT_CAPABILITIES] as const;",
    );
    expect(spineRegistry).toContain("EDGE_CHAT_EXECUTOR_CAPABILITIES.some(entry => entry.key === capability.key");
  });

  it("discovery is read-only; RUN is an external effect behind chat-canonical approval", () => {
    expect(zapierDomain).toContain('key: "integrations.zapier_list_actions"');
    expect(zapierDomain).toContain('chatTool: "zapier_list_actions", riskPolicyKey: "read_only", approvalAuthority: "none"');
    expect(zapierDomain).toContain('key: "integrations.zapier_run_action"');
    expect(zapierDomain).toContain(
      'classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "zapier_run_action", riskPolicyKey: "high", approvalAuthority: "chat-canonical"',
    );
  });

  it("the mutating entry carries LIVE chat binding and idempotency discipline", () => {
    expect(zapierDomain).toContain(
      'chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "SCR-ZAPIER-MANAGEMENT"',
    );
    expect(zapierDomain).toContain("never automatically retried after uncertain results");
  });
});

describe("the chat manifest carries the governed zapier tools", () => {
  it("both tools are declared with discovery-first + propose-first copy", () => {
    expect(chatCore).toContain('name: "zapier_list_actions"');
    expect(chatCore).toContain('name: "zapier_run_action"');
    expect(chatCore).toContain("Use this FIRST to test the connection");
    expect(chatCore).toContain("PROPOSE first and call again with confirm:true once the operator approves");
  });

  it("both tools have dispatch handlers in the tool loop", () => {
    expect(chatCore).toContain('case "zapier_run_action":');
    expect(chatCore).toContain('tc.function.name === "zapier_list_actions"');
  });
});

describe("the legacy lane's refusal vocabulary stays closed and honest", () => {
  it("an unreachable or unconnected Zapier is never reported as an approval problem", () => {
    expect(mcpOutcome).toContain('not_connected: "This workspace has not connected a Zapier account yet."');
    expect(mcpOutcome).toContain('connection_disabled: "This workspace\'s Zapier connection is turned off."');
    expect(mcpOutcome).toContain('discovery_unavailable: "The connected Zapier account could not be reached just now."');
    expect(mcpOutcome).toContain(
      'reauthorization_required: "This workspace\'s Zapier authorization has expired and needs reconnecting. Do not retry."',
    );
  });
});
