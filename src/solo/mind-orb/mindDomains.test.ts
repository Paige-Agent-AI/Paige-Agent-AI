import { describe, expect, it } from "vitest";
import {
  buildMindDomains,
  buildOrbRecords,
  groundedCount,
  orbDomains,
  truthToTier,
  allRecords,
  truthForState,
  MIND_DOMAINS,
  type MindInputs,
  type MindSignalState,
} from "./mindDomains";

const EMPTY: MindInputs = { knowledge: [], n8n: null, approvals: [] };

const FULL: MindInputs = {
  knowledge: [
    { id: "doc1", title: "Onboarding playbook.pdf", summary: "How we onboard.", source: "Upload", when: "4d ago", chunkCount: 12, domain: "Operations" },
    { id: "doc2", title: "Service agreement", chunkCount: 1 },
  ],
  n8n: {
    api: { words: "API connected.", action: "No action needed.", lastSuccessfulCheck: "2d ago", actionNeeded: false, detail: "Workflow count: 3." },
    mcp: { words: "Tools pending.", action: "Approve tools.", lastSuccessfulCheck: null, actionNeeded: true, detail: "Approved tools: 0." },
  },
  approvals: [
    { id: "a1", title: "Approve the March dunning sequence", dept: "Finance", type: "dunning", aging: "today" },
  ],
};

const byKey = (inputs: MindInputs) => {
  const map = new Map(buildMindDomains(inputs).map((d) => [d.def.key, d]));
  return map;
};

describe("buildMindDomains — reconciliation", () => {
  it("returns exactly the six approved domains, in the approved order", () => {
    const domains = buildMindDomains(EMPTY);
    expect(domains.map((d) => d.def.key)).toEqual([
      "identity", "people", "goals", "systems", "knowledge", "offers",
    ]);
  });

  it("maps knowledge docs to the Knowledge domain without inferring owner confirmation", () => {
    const knowledge = byKey(FULL).get("knowledge")!;
    expect(knowledge.verdict).toBe("PARTIAL");
    expect(knowledge.records).toHaveLength(2);
    expect(knowledge.records[0]).toMatchObject({
      domain: "knowledge", state: "needs_confirmation", truth: "PARTIAL", id: "knowledge:doc1",
    });
    // singular/plural chunk copy is honest
    expect(knowledge.records[1].evidence).toContain("1 recorded chunk");
    expect(knowledge.records[0].evidence).toContain("12 recorded chunks");
  });

  it("maps n8n readiness to Connected sources (status only), never Rail history", () => {
    const systems = byKey(FULL).get("systems")!;
    expect(systems.verdict).toBe("LIVE");
    expect(systems.records.map((r) => r.id)).toEqual(["systems:n8n-api", "systems:n8n-mcp"]);
    // action-needed channel is needs_confirmation; a checked channel is source_refreshed
    expect(systems.records[0].state).toBe("source_refreshed");
    expect(systems.records[1].state).toBe("needs_confirmation");
  });

  it("maps approvals to Operating decisions and points the actionable queue at Systems Check", () => {
    const goals = byKey(FULL).get("goals")!;
    expect(goals.records).toHaveLength(1);
    expect(goals.records[0]).toMatchObject({ domain: "goals", state: "needs_confirmation", id: "decision:a1" });
    expect(goals.records[0].summary.toLowerCase()).toContain("systems check");
  });

  it("§58: NEVER surfaces Systems Check findings as Mind records (they live in the Systems Check subtab)", () => {
    // Even with rich inputs, no record id is a finding and nothing claims a Systems Check finding source.
    const records = allRecords(buildMindDomains(FULL));
    expect(records.some((r) => r.id.startsWith("finding:"))).toBe(false);
    expect(records.some((r) => /systems check (finding|snapshot)/i.test(r.source))).toBe(false);
  });

  it("§13/§70: invents NO records when every source is empty — only honest absences", () => {
    const domains = buildMindDomains(EMPTY);
    expect(allRecords(domains)).toHaveLength(0);
    for (const d of domains) {
      expect(d.records).toHaveLength(0);
      expect(d.empty).toBeTruthy(); // every empty domain states its honest absence
    }
  });

  it("keeps not-yet-wired domains honest: identity/people show an absence, offers is UNAVAILABLE", () => {
    const map = byKey(FULL);
    expect(map.get("identity")!.empty?.body).toMatch(/no frontend|nothing reads it|governed store/i);
    expect(map.get("people")!.empty?.body).toMatch(/governed|clients/i);
    const offers = map.get("offers")!;
    expect(offers.verdict).toBe("UNAVAILABLE");
    expect(offers.empty?.body).toMatch(/live in Offers/);
    expect(offers.empty?.body).not.toMatch(/campaigns/i); // the department is Marketing now (2026-10-03)
  });
});

describe("truthForState", () => {
  const cases: Array<[MindSignalState, string]> = [
    ["owner_confirmed", "LIVE SOURCE"],
    ["connection_sourced", "LIVE SOURCE"],
    ["source_refreshed", "LIVE SOURCE"],
    ["needs_confirmation", "PARTIAL"],
    ["legacy_sourced", "PROPOSED"],
    ["unavailable", "UNAVAILABLE"],
  ];
  it.each(cases)("maps %s -> %s", (state, truth) => {
    expect(truthForState(state)).toBe(truth);
  });
});

describe("buildOrbRecords — one bright node per governed record (Synapse)", () => {
  it("emits exactly one node per real record, carrying domain, truth tier, and the record ref", () => {
    const domains = buildMindDomains(FULL);
    const nodes = buildOrbRecords(domains);
    // one node per real record — no hubs, no ghosts (§13/§70: a node exists only because a record does)
    expect(nodes).toHaveLength(allRecords(domains).length);
    expect(nodes.every((n) => n.record && n.id === (n.record as { id: string }).id)).toBe(true);
    // knowledge docs are grounded (LIVE SOURCE); the pending decision is partial
    const know = nodes.filter((n) => n.domain === "knowledge");
    expect(know).toHaveLength(2);
    expect(know.every((n) => n.tier === "partial")).toBe(true);
    expect(nodes.find((n) => n.id === "decision:a1")?.tier).toBe("partial");
    // deterministic
    expect(buildOrbRecords(buildMindDomains(FULL)).map((n) => n.id)).toEqual(nodes.map((n) => n.id));
  });

  it("emits NO nodes when every source is empty — never a ghost/placeholder (§13/§70)", () => {
    expect(buildOrbRecords(buildMindDomains(EMPTY))).toHaveLength(0);
  });
});

describe("truthToTier — the owner-approved 6→3 orb legend", () => {
  it.each([
    ["LIVE SOURCE", "grounded"],
    ["PARTIAL", "partial"],
    ["PROPOSED", "partial"],
    ["UNAVAILABLE", "unavailable"],
  ] as const)("maps %s -> %s", (truth, tier) => {
    expect(truthToTier(truth)).toBe(tier);
  });
});

describe("groundedCount — grounded (LIVE SOURCE) only, never the total", () => {
  it("counts only LIVE SOURCE records and is strictly below the total held", () => {
    const domains = buildMindDomains(FULL);
    // FULL held = 5: 2 knowledge (PARTIAL) + n8n api source_refreshed (LIVE) + n8n mcp needs_confirmation
    // (PARTIAL) + 1 approval (PARTIAL). Grounded = 1.
    expect(allRecords(domains)).toHaveLength(5);
    expect(groundedCount(domains)).toBe(1);
    expect(groundedCount(domains)).toBeLessThan(allRecords(domains).length);
  });

  it("is 0 when nothing is grounded", () => {
    expect(groundedCount(buildMindDomains(EMPTY))).toBe(0);
  });
});

describe("orbDomains — the six regions handed to the engine", () => {
  it("returns the six approved domains with finite az/el", () => {
    const d = orbDomains();
    expect(d.map((x) => x.key)).toEqual(["identity", "people", "goals", "systems", "knowledge", "offers"]);
    expect(d.every((x) => Number.isFinite(x.az) && Number.isFinite(x.el))).toBe(true);
  });
});

describe("MIND_DOMAINS", () => {
  it("carries the six approved names", () => {
    expect(MIND_DOMAINS.map((d) => d.name)).toEqual([
      "Business context", "Client relationships", "Operating decisions",
      "Connected sources", "Knowledge resources", "Offers & services",
    ]);
  });
});
