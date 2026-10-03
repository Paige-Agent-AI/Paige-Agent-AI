/**
 * Mind-1 — the Integrations domain's Mind binding (SCR-INTEGRATIONS-MIND).
 *
 * The owner's architecture mandate: Spine, Rail, Memory, MIND — every lane complete to the
 * platform's design. The integrations surface declared `mindBinding: "UNAVAILABLE"` since its
 * creation; the Knowledge agent's lane landing (owner green light 2026-10-02) opened the Mind
 * work. The pipeline domain's Mind projection says a second domain needs a Spine Change
 * Request, not an import — this is that SCR, honoured as a SEPARATE bounded projection
 * (never a widening of the shared primitive).
 *
 * What this binding means in practice: the tenant's REAL connection surface (channel
 * connectors + the gateway's live MCP connections — n8n, zapier, and GHL when connected) is
 * projected as closed-vocabulary facts with a citation and freshness word per line, and that
 * one wording is what Chat sees. The incident class it prevents is real: 2026-10-02, a
 * capability question ("can you read your n8n connection") was answered against the WRONG
 * provider's readiness block because no integrations-wide verified state existed in context.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
// The projection module's only import is type-only, so the test exercises the REAL module
// (not a copy) — behavior and source pins can never drift apart.
import { projectIntegrationRow, loadIntegrationsMindEvidence } from "../../supabase/functions/_shared/paige-spine/domains/integrationsMindEvidence.ts";

const root = join(__dirname, "..", "..");
const projectionPath = join(root, "supabase/functions/_shared/paige-spine/domains/integrationsMindEvidence.ts");
const projection = readFileSync(projectionPath, "utf8");
const surface = readFileSync(join(root, "supabase/functions/_shared/paige-spine/domains/integrations_surface.ts"), "utf8");
const chat = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

const REAL_ROW = {
  channel: "mcp",
  provider: "n8n",
  status: "active",
  health: "healthy",
  last_updated: new Date().toISOString(),
};

describe("the projection is bounded and fail-closed", () => {
  it("a real adapter row projects with citation, freshness, and closed facts", () => {
    const r = projectIntegrationRow(REAL_ROW);
    expect(r).not.toBeNull();
    expect(r!.citation).toBe("integrations:mcp:n8n");
    expect(r!.facts).toEqual({ channel: "mcp", provider: "n8n", status: "active", health: "healthy" });
    expect(r!.freshness).toBe("available");
    expect(r!.statement).toContain("The mcp integration (n8n) is active");
  });

  it("values outside the closed vocabularies are refused whole, never sanitized", () => {
    expect(projectIntegrationRow({ ...REAL_ROW, channel: "secret-channel" })).toBeNull();
    expect(projectIntegrationRow({ ...REAL_ROW, status: "on-fire" })).toBeNull();
    expect(projectIntegrationRow({ ...REAL_ROW, health: "cursed" })).toBeNull();
    expect(projectIntegrationRow(null)).toBeNull();
    expect(projectIntegrationRow("n8n")).toBeNull();
  });

  it("the adapter's REAL health vocabulary projects — unprobed and unconfigured rows included", () => {
    // 2026-10-02 review: the projection's health set once omitted these, and the fail-closed
    // loader then blanked the whole block for any tenant with an unprobed MCP connection —
    // exactly the messy fresh-connection state the block exists for.
    expect(projectIntegrationRow({ ...REAL_ROW, health: "unknown" })?.facts.health).toBe("unknown");
    expect(projectIntegrationRow({ ...REAL_ROW, health: "unconfigured" })?.facts.health).toBe("unconfigured");
    expect(projectIntegrationRow({ ...REAL_ROW, channel: "whatsapp", health: "degraded" })?.facts.channel).toBe("whatsapp");
  });

  it("a timestamp that does not parse refuses the row (never renders garbage as verified)", () => {
    expect(projectIntegrationRow({ ...REAL_ROW, last_updated: "not-a-date" })).toBeNull();
    expect(projectIntegrationRow({ ...REAL_ROW, last_updated: "" })).toBeNull();
  });

  it("an old row is STALE, not current — the freshness boundary is the adapter's own", () => {
    const old = projectIntegrationRow({ ...REAL_ROW, last_updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });
    expect(old?.freshness).toBe("stale");
  });

  it("the never-carry boundary is stated in the module (credentials, URLs, labels, identifiers)", () => {
    expect(projection).toContain("WHAT IT MAY NEVER CARRY");
    expect(projection).toContain("a server URL, a credential or its last4, a label the tenant");
  });

  it("the projection is a separate bounded module — the pipeline primitive is not widened", () => {
    expect(projection).not.toContain('from "../mindEvidence.ts"');
    expect(projection).toContain("Spine Change Request");
    expect(projection).toContain("SCR-INTEGRATIONS-MIND");
  });

  it("the SCR marker is declared in the machine-scannable form the mind-contract guard requires", () => {
    expect(projection).toContain("// mind-projection-scr: SCR-INTEGRATIONS-MIND");
  });
});

describe("the loader never returns a partial answer (the three-state contract)", () => {
  const clientOf = (rows: unknown, error: unknown = null) => ({ rpc: async () => ({ data: rows, error }) });

  it("one un-projectable row fails the WHOLE projection to unavailable — never a filtered subset", async () => {
    const evidence = await loadIntegrationsMindEvidence(clientOf([REAL_ROW, { ...REAL_ROW, channel: "mystery" }]) as never);
    expect(evidence).toEqual({ status: "unavailable" });
  });

  it("an empty adapter result is no_evidence (honest absence), not an error", async () => {
    const evidence = await loadIntegrationsMindEvidence(clientOf([]) as never);
    expect(evidence).toEqual({ status: "no_evidence" });
  });

  it("a clean row set is recorded", async () => {
    const evidence = await loadIntegrationsMindEvidence(clientOf([REAL_ROW]) as never);
    expect(evidence.status).toBe("recorded");
  });

  it("an adapter error is unavailable", async () => {
    const evidence = await loadIntegrationsMindEvidence(clientOf(null, { message: "rpc down" }) as never);
    expect(evidence).toEqual({ status: "unavailable" });
  });
});

describe("the registry declarations are honest", () => {
  it("both read capabilities raise mindBinding to PARTIAL behind the SCR marker", () => {
    expect(surface.match(/mindBinding: "PARTIAL"/g)?.length).toBe(2);
    expect(surface.match(/SCR-INTEGRATIONS-MIND/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the vocabulary debt is paid — the full adapter/checker sets the RPC can emit", () => {
    expect(surface).toContain('channel: ["email", "sms", "calendar", "voice", "mcp", "whatsapp", "instagram", "facebook"]');
    expect(surface).toContain('health: ["healthy", "degraded", "disconnected", "unconfigured", "unknown"]');
    expect(surface).toContain('"gohighlevel", "generic-remote"]');
  });
});

describe("chat consumes the one wording", () => {
  it("the chat core loads and injects the integrations Mind block", () => {
    expect(chat).toContain('loadIntegrationsMindEvidence(supabaseClient)');
    expect(chat).toContain('renderIntegrationsMindEvidence(integrationsMind)');
    expect(chat).toContain("...(integrationsMindBlock ? [{ role: \"system\", content: integrationsMindBlock }] : []),");
  });

  it("only a RECORDED projection enters context — unavailable/no-evidence never injects a fixed block", () => {
    expect(chat).toContain('integrationsMind.status === "recorded"');
  });

  it("the render carries the trust markers (citation on every line, stale-is-old, read-only)", () => {
    expect(projection).toContain("name the source reference on a line when you state what it proves");
    expect(projection).toContain("report it as old, never as current");
    expect(projection).toContain("Read-only: this projection never changes a connection.");
  });
});
