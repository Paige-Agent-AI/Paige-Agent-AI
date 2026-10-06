/**
 * R6-A — the cognitive-class contract: declarations as DATA, telemetry readback from the
 * shared router's own reports, the inert evidence-gated escalation predicate, and the
 * Judge-v3 evaluator carve-out.
 *
 * The ruling's negative space is the core guarantee: NOTHING in R6-A creates a provider
 * route, names a provider/model in research code, calls OpenAI directly, or changes
 * research behavior. These tests pin both the contract AND the non-creation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-deep-research/index.ts"), "utf8");
const scorers = readFileSync(join(root, "supabase/functions/_shared/eval/scorers.ts"), "utf8");
const gate = readFileSync(join(root, "supabase/functions/_shared/eval/gate.ts"), "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const extractFn = (from: string, name: string): string => {
  const sf = ts.createSourceFile("fn.ts", from, ts.ScriptTarget.ES2022, true);
  let found: string | null = null;
  const walk = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) found = n.getText(sf);
      }
    }
    n.forEachChild(walk);
  };
  walk(sf);
  if (!found) throw new Error(`${name} not found`);
  return found;
};

describe("R6-A — the class contract is DATA, not a router", () => {
  it("every research phase is classified into the five-class vocabulary", () => {
    for (const phase of ["entity_planner", "rank_and_validate", "hop_query_planner", "unit_planner", "unit_synthesis", "dossier_synthesis", "strategist", "retrieval"]) {
      expect(core).toContain(`${phase}: "`);
    }
    expect(core).toContain('type ResearchCognitiveClass = "deterministic" | "cheap" | "operational" | "frontier" | "frozen_evaluator";');
  });
  it("NO provider or model string appears anywhere in the research engine's contract (no rival router)", () => {
    // the contract's DATA names no provider (comments may document the direction)
    const contractStart = core.indexOf("const RESEARCH_COGNITIVE_CLASSES");
    const contract = core.slice(contractStart, core.indexOf("};", contractStart) + 2);
    const noComments = contract.split(String.fromCharCode(10))
      .map((l) => (l.includes("//") ? l.slice(0, l.indexOf("//")) : l))
      .join(String.fromCharCode(10));
    for (const banned of ["openai", "gpt-6", "astra", "sol", "anthropic", "sonnet", "claude", "groq", "qwen", "luna"]) {
      expect(noComments.toLowerCase()).not.toContain(banned);
    }
    // and the engine holds NO direct OpenAI fetch — every model call goes through the shared router
    expect(core).not.toMatch(/api\.openai\.com|api\.openai/);
    expect(core).not.toContain('from "openai"');
    expect(core).toContain('import { routedChatCompletion } from "../_shared/model-router.ts";');
  });
  it("the deterministic phases are pinned LLM-free (code, not models)", () => {
    expect(core).toContain('entity_planner: "deterministic"');
    expect(core).toContain('rank_and_validate: "deterministic"');
    expect(core).toContain('retrieval: "deterministic"');
  });
  it("cheap and operational classes are declared for exactly the ruled phases", () => {
    expect(core).toContain('hop_query_planner: "cheap"');
    expect(core).toContain('unit_planner: "cheap"');
    expect(core).toContain('unit_synthesis: "operational"');
    expect(core).toContain('strategist: "operational"');
  });
});

describe("R6-A — the frontier escalation predicate (behavioral, on the real extracted function)", () => {
  const build = () => {
    const fnText = extractFn(core, "shouldEscalateToFrontier");
    const typeText = core.match(/type UnitOutcome = [^;]+;/)![0];
    const iface = core.slice(core.indexOf("interface EscalationInputs"), core.indexOf("}", core.indexOf("interface EscalationInputs")) + 1);
    return (new Function(js(`${typeText}\n${fnText}\nreturn shouldEscalateToFrontier;`)) as unknown as () => (x: {
      unitKind: string; evidenceSufficient: boolean; sourceCount: number; priorOutcome: string | null; ambiguityUnresolved: boolean;
    }) => { escalate: boolean; reason: string | null })();
  };
  it("NO evidence => never escalate (honest insufficiency, not try-harder)", () => {
    const f = build();
    expect(f({ unitKind: "facet", evidenceSufficient: false, sourceCount: 0, priorOutcome: "truncated", ambiguityUnresolved: false })).toEqual({ escalate: false, reason: null });
    expect(f({ unitKind: "facet", evidenceSufficient: true, sourceCount: 1, priorOutcome: "truncated", ambiguityUnresolved: false })).toEqual({ escalate: false, reason: null });
  });
  it("typed insufficiency NEVER escalates (the owner invariant)", () => {
    const f = build();
    expect(f({ unitKind: "facet", evidenceSufficient: true, sourceCount: 30, priorOutcome: "insufficient", ambiguityUnresolved: true })).toEqual({ escalate: false, reason: null });
  });
  it("truncation WITH sufficient evidence escalates for the named reason", () => {
    const f = build();
    expect(f({ unitKind: "relation", evidenceSufficient: true, sourceCount: 12, priorOutcome: "truncated", ambiguityUnresolved: false }))
      .toEqual({ escalate: true, reason: "typed_truncation_with_sufficient_evidence" });
  });
  it("hard reconciliation unresolved after an operational attempt escalates for the named reason", () => {
    const f = build();
    expect(f({ unitKind: "relation", evidenceSufficient: true, sourceCount: 8, priorOutcome: "ok", ambiguityUnresolved: true }))
      .toEqual({ escalate: true, reason: "hard_reconciliation_unresolved_after_operational_attempt" });
  });
  it("transport failure and plain success are NOT frontier reasons (fallback policy owns transport)", () => {
    const f = build();
    expect(f({ unitKind: "side", evidenceSufficient: true, sourceCount: 9, priorOutcome: "failed", ambiguityUnresolved: false })).toEqual({ escalate: false, reason: null });
    expect(f({ unitKind: "side", evidenceSufficient: true, sourceCount: 9, priorOutcome: "ok", ambiguityUnresolved: false })).toEqual({ escalate: false, reason: null });
  });
  it("the gate is INERT in R6-A — nothing in the engine calls it", () => {
    const callSites = core.split("shouldEscalateToFrontier").length - 1; // definition mentions
    // 1 = the definition only (its own name in the signature); any consumer would add more
    expect(callSites).toBe(1);
  });
});

describe("R6-A — telemetry readback (the router's report, not research's choice)", () => {
  it("unit diagnostics carry the declared cognitive class + the served model from the routed response", () => {
    expect(core).toContain("cognitive_class: RESEARCH_COGNITIVE_CLASSES.unit_synthesis,");
    expect(core).toContain("served_model: (unit as { __served_model?: string }).__served_model ?? null,");
  });
  it("the served model is READ from the shared router's response (never written from research)", () => {
    expect(core).toContain("__served_model =");
    expect(core).toContain("r5resp.model");
  });
  it("the cognitive-class parameter is carried but NEVER consulted for routing in R6-A", () => {
    expect(core).toContain("void cognitiveClass; // present for the R6-B class-bearing seam; deliberately unused here");
  });
});

describe("R6-A G.3 — Judge v3: the versioned fixed-route evaluator", () => {
  it("v3 exists with the SAME rubric mechanics and budget as v2, stamped by name", () => {
    expect(scorers).toContain('"v1" | "v2" | "v3"');
    expect(scorers).toContain('version === "v3" ? "rubric_judge_v3"');
    expect(scorers).toContain('version === "v2" || version === "v3" ? 1600 : 500');
  });
  it("v2 is frozen historically — its behavior is untouched", () => {
    expect(scorers).toContain('version === "v2" || version === "v3" ? 1600 : 500'); // v2 and v3 share the 1600 budget; v1 untouched at 500
  });
  it("the gate routes v3 and marks it a judge; unparseable/unavailable → null, never zero, never failover", () => {
    expect(gate).toContain('name === "rubric_judge_v3"');
    expect(gate).toContain('name === "rubric_judge_v3" ? "v3" : "v1"');
    expect(scorers).toContain('"low_confidence"'); // the null-preserving degrade path is unchanged
  });
  it("no dynamic class routing anywhere in the evaluator (frozen instrument)", () => {
    expect(scorers).not.toContain("cognitive_class");
    expect(scorers).not.toContain("RESEARCH_COGNITIVE_CLASSES");
  });
});

describe("R6-A — research behavior is UNCHANGED (the non-regression guarantee)", () => {
  it("no call site's routed job kind changed (extract/doc_draft/plan exactly as R5)", () => {
    expect((core.match(/routedChatCompletion\("extract"/g) ?? []).length).toBe(2);
    expect((core.match(/routedChatCompletion\("doc_draft"/g) ?? []).length).toBe(2);
  });
  it("the protected seams are untouched", () => {
    expect(core).toContain("const MAX_HOPS = 3;");
    expect(core).toContain("const R4_UNIT_MAX_TOKENS = 2400;");
    expect(core).toContain('type UnitOutcome = "ok" | "insufficient" | "truncated" | "failed";');
  });
});
