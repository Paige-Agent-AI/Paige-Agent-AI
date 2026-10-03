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
import { readFileSync, readdirSync } from "node:fs";
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
  it("M4 seeded the row (history); the 2026-10-03 correction makes it honest to GHL's REAL requirements", () => {
    // History: the original seed (kept verbatim — immutable past migrations).
    expect(ghlMigration).toContain(
      "('gohighlevel', 'Go High Level', false, '{oauth,bearer}', '{http}', 'multi', NULL, '{}',",
    );
    // The correction: bearer ONLY (GHL offers no OAuth for MCP today), the GENERIC endpoint
    // shape, and notes naming the PIT + locationId-header requirement.
    const correction = readFileSync(
      join(root, "supabase/migrations/20270536000000_ghl_provider_auth_honesty.sql"),
      "utf8",
    );
    expect(correction).toContain("auth_kinds = '{bearer}'");
    expect(correction).toContain("resource_url_shape = '/mcp/'");
    expect(correction).toContain("required_custom_headers = '{locationId}'");
    expect(correction).toContain("WHERE provider_key = 'gohighlevel'");
    // The DOCTRINE: narrowed as PAIGE's verified surface — never a claim GHL lacks OAuth.
    expect(correction).toContain("NOT YET VERIFIED for PAIGE");
    expect(correction).not.toContain("does not offer OAuth");
  });

  it("the server-side enforcement is provider METADATA + a trigger — no provider code branches", () => {
    const correction = readFileSync(
      join(root, "supabase/migrations/20270536000000_ghl_provider_auth_honesty.sql"),
      "utf8",
    );
    expect(correction).toContain("ADD COLUMN IF NOT EXISTS required_custom_headers text[]");
    expect(correction).toContain("CREATE TRIGGER trg_mcp_provider_required_headers");
    expect(correction).toContain("MCP_MISSING_REQUIRED_HEADER");
    // Only bearer/header facets carry the header contract; the trigger guards the decrypted
    // bundle, and an error names header NAMES only — values are credential material.
    expect(correction).toContain("IF NEW.auth_kind NOT IN ('bearer', 'header') THEN RETURN NEW; END IF;");
    expect(correction).toContain("Names only: a header VALUE is credential material and never crosses into an error.");
  });

  it("the seed is additive — the original three providers are untouched", () => {
    expect(seed).toContain("('generic-remote', 'Generic remote MCP', true,");
    expect(seed).toContain("('zapier',         'Zapier',             false, '{oauth,url}',");
    expect(seed).not.toContain("gohighlevel");
  });

  it("the frontier discipline holds — the migration exists on disk and numbers above the recorded frontier", () => {
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
    // The file must actually be on disk (db push picks up exactly this directory).
    expect(migrations).toContain("20270534000000_gohighlevel_mcp_provider.sql");
    // And it must sort above the recorded production frontier at authoring time — an
    // interleaved lower number would apply beneath already-recorded history.
    const frontier = "20270533200000_knowledge_submit_activation.sql";
    expect(migrations).toContain(frontier);
    expect(migrations.indexOf("20270534000000_gohighlevel_mcp_provider.sql")).toBeGreaterThan(
      migrations.indexOf(frontier),
    );
  });
});

describe("both of GHL's auth kinds are MCP-executable in the canonical loader", () => {
  it("bearer is in the executable set (GHL's kind); the REST-only api_key facet is not", () => {
    expect(connection).toContain('MCP_EXECUTABLE_AUTH_KINDS = new Set(["oauth", "bearer", "header", "url", "none"])');
    expect(connection).not.toContain('"api_key"');
  });

  it("the locationId requirement is met by the encrypted custom-header lane (no reserved-name collision)", () => {
    const client = readFileSync(join(root, "supabase/functions/_shared/mcp-client.ts"), "utf8");
    expect(client).toContain("customHeadersUsable");
    // locationId is NOT a reserved transport header, so a GHL connection's custom header rides.
    expect(client).not.toContain('"locationid"');
    expect(client).not.toContain('"locationId"');
  });
});

describe("the registry JSON carries the honest PARTIAL entry", () => {
  it("gohighlevel-mcp exists as PARTIAL with the gap named", () => {
    const ghl = registryJson.providers.find((p) => p.id === "gohighlevel-mcp");
    expect(ghl).toBeDefined();
    expect(ghl?.status).toBe("PARTIAL");
    expect(ghl?.dependency).toContain("GHL-1 landed the governed chat lane");
  });
});

describe("the catalogue names GHL's real MCP endpoint", () => {
  it("the catalogue row carries the GENERIC endpoint, the PIT instructions, AND the provider identity", () => {
    expect(catalogue).toContain('url: "https://services.leadconnectorhq.com/mcp/"');
    expect(catalogue).toContain("Private Integration token (Settings → Private Integrations) plus your locationId header");
    expect(catalogue).not.toContain("/mcp/anthropic/v2");
    // The tile's create routes to the canonical gohighlevel descriptor — NOT generic-remote.
    expect(catalogue).toContain('pk: "gohighlevel", req: ["locationId"]');
  });

  it("the drawer carries the provider identity into the create (the identity fix)", () => {
    // The preset flows pk → providerKey; the create uses the preset's identity, falling
    // back to generic-remote only for untagged presets.
    expect(catalogue).toContain('providerKey: item.pk,');
    expect(catalogue).toContain('providerKey: preset.providerKey ?? "generic-remote"');
    // The presence checks prefer the explicit catalogue key over legacy/URL inference.
    expect(catalogue).toContain("providerKey: p.pk ??");
  });

  it("the drawer enforces the preset's required headers before save", () => {
    expect(catalogue).toContain("const missing = preset.requiredHeaders.filter((h) => !have.has(h.toLowerCase()));");
    expect(catalogue).toContain("requires the ${missing.join(\", \")}");
    // A preset with required headers preselects the Token + headers mode.
    expect(catalogue).toContain('auth: item.pk && item.req?.length ? "headers" : undefined');
    expect(catalogue).toContain(": preset.auth ?? null;");
  });
});

describe("the lane LANDED (GHL-1, 2026-10-03) — declared from the real catalogue, not before it", () => {
  it("the GHL chat tools exist BECAUSE the owner's live connection discovered the real 36", () => {
    // The M4 pins said: no ghl chat tool and no GHL spine capability UNTIL real discovery.
    // The owner's live connection (36 real tools) is that discovery; GHL-1 landed the lane.
    expect(chatCore).toContain('name: "ghl_list_actions"');
    expect(chatCore).toContain('name: "ghl_run_action"');
    // The lane routes through the CANONICAL gateway (no legacy edge, no new authority).
    expect(chatCore).toContain('c?.provider_key === "gohighlevel"');
  });

  it("the Spine domain is declared and composed (the register-what-exists discipline honored)", () => {
    expect(spineRegistry).toContain("...GHL_MANAGEMENT_CAPABILITIES");
  });
});
