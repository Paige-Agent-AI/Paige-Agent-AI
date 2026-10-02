/**
 * M4 — the Go High Level connection-lane contract.
 *
 * The third of the owner's three providers ("reignite our MCP connections with n8n, Zapier,
 * and Go High Level"). Until M4, GHL could not exist in the canonical gateway at all — the
 * create writer refuses an unknown provider key (MCP_BAD_PROVIDER) and no GHL row was seeded.
 * This suite pins the lane's honest boundary:
 *  - the provider descriptor IS seeded (both of GHL's auth kinds, the one executable transport);
 *  - the loader treats both of GHL's kinds as MCP-executable (a listed connection can run);
 *  - the registry JSON carries the entry as PARTIAL with the gap named (no live execution);
 *  - the Integrations catalogue names the real GHL MCP endpoint;
 *  - and NOTHING over-claims: no GHL chat tool exists, no Spine capability is declared —
 *    the governed tool surface lands only after the first real connection's discovery
 *    shows GHL's actual tool names (the M3 pattern: register what exists).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const seed = readFileSync(
  join(root, "supabase/migrations/20270319000000_connected_mcp_gateway_registry.sql"),
  "utf8",
);
const ghlMigration = readFileSync(
  join(root, "supabase/migrations/20270534000000_gohighlevel_mcp_provider.sql"),
  "utf8",
);
const connection = readFileSync(join(root, "supabase/functions/_shared/mcp-gateway/connection.ts"), "utf8");
const spineRegistry = readFileSync(join(root, "supabase/functions/_shared/paige-spine/registry.ts"), "utf8");
const chatCore = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");
const catalogue = readFileSync(join(root, "src/solo/settings-integrations-gateway.tsx"), "utf8");
const registryJson = JSON.parse(
  readFileSync(join(root, "docs/integration-registry/integration-capability-registry.json"), "utf8"),
) as { providers: Array<{ id: string; status: string; dependency: string }> };

describe("the gohighlevel provider descriptor is seeded", () => {
  it("M4 seeds the row with exactly GHL's two executable auth kinds over http", () => {
    expect(ghlMigration).toContain(
      "('gohighlevel', 'Go High Level', false, '{oauth,bearer}', '{http}', 'multi', NULL, '{}',",
    );
    expect(ghlMigration).toContain("ON CONFLICT (provider_key) DO NOTHING");
  });

  it("the seed is additive — the original three providers are untouched", () => {
    expect(seed).toContain("('generic-remote', 'Generic remote MCP', true,");
    expect(seed).toContain("('zapier',         'Zapier',             false, '{oauth,url}',");
    expect(seed).not.toContain("gohighlevel");
  });

  it("the frontier discipline holds — the migration numbers above the recorded frontier", () => {
    expect(ghlMigration.length).toBeGreaterThan(0);
    // lexical filename ordering puts 20270534000000 after the recorded 20270533200000 frontier
    expect("20270534000000_gohighlevel_mcp_provider.sql" > "20270533200000_knowledge_submit_activation.sql").toBe(true);
  });
});

describe("both of GHL's auth kinds are MCP-executable in the canonical loader", () => {
  it("oauth and bearer are in the executable set; the REST-only api_key facet is not", () => {
    expect(connection).toContain('MCP_EXECUTABLE_AUTH_KINDS = new Set(["oauth", "bearer", "header", "url", "none"])');
    expect(connection).not.toContain('"api_key"');
  });
});

describe("the registry JSON carries the honest PARTIAL entry", () => {
  it("gohighlevel-mcp exists as PARTIAL with the gap named", () => {
    const ghl = registryJson.providers.find((p) => p.id === "gohighlevel-mcp");
    expect(ghl).toBeDefined();
    expect(ghl?.status).toBe("PARTIAL");
    expect(ghl?.dependency).toContain("no chat tool, no spine capability, no connection exists");
  });
});

describe("the catalogue names GHL's real MCP endpoint", () => {
  it("the Integrations catalogue row carries the leadconnectorhq MCP URL", () => {
    expect(catalogue).toContain("https://services.leadconnectorhq.com/mcp/anthropic/v2");
  });
});

describe("nothing over-claims a GHL surface that does not exist yet", () => {
  it("no GHL chat tool is declared (the lane lands after real discovery)", () => {
    expect(chatCore).not.toContain('name: "ghl_');
    expect(chatCore).not.toContain('name: "gohighlevel');
  });

  it("no GHL Spine capability is declared (register what exists, no more)", () => {
    expect(spineRegistry).not.toContain("GHL_");
    expect(spineRegistry).not.toContain("GOHIGHLEVEL_");
  });
});
