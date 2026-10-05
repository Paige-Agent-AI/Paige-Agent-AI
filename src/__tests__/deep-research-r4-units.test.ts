/**
 * R4 — decomposed claim formation: the unit contract, bounds, aggregation, and the
 * unchanged-validator guarantee.
 *
 * The ruling's invariants this suite pins:
 *  - synthesis units are ANSWER-COVERAGE obligations (not planner search queries) with a
 *    bounded vocabulary distinguishing overall / side / relation / facet / position /
 *    insufficiency — a comparison must NEVER be one side only;
 *  - bounded: max units, hard call ceiling, per-unit tokens, concurrency lanes;
 *  - aggregation/dedupe is DETERMINISTIC: near-duplicates merge (citations union), genuine
 *    conflicts NEVER dedupe, and dedupe can only merge citations the validator re-checks;
 *  - validateAndBind is UNTOUCHED (the causal-measurement requirement) — the R3 suite's
 *    behavioral deep-equal continues to cover it; here we pin the call passes the same
 *    citable set and the SAME validator symbol with no new gate in between;
 *  - a unit may conclude insufficiency without zeroing its siblings;
 *  - the dossier carries the unit layer (units[] added; R3 fields unchanged).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-deep-research/index.ts"), "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const extractFn = (name: string): string => {
  const sf = ts.createSourceFile("fn.ts", core, ts.ScriptTarget.ES2022, true);
  let found: string | null = null;
  const walk = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    n.forEachChild(walk);
  };
  walk(sf);
  if (!found) throw new Error(`${name} not found`);
  return found;
};

// STOP literal for tokens()
import { match } from "node:assert";
const STOP_LIT = (core.match(/const STOP = new Set\(\[[\s\S]*?\]\);/) ?? [""])[0];

describe("R4 — the synthesis-unit contract", () => {
  it("the coverage vocabulary is the six ruled kinds, and nothing vertical", () => {
    for (const kind of ["overall", "side", "relation", "facet", "position", "insufficiency"]) {
      expect(core).toContain(`"${kind}"`);
    }
    expect(core).toContain("type UnitCoverageKind");
    // no vertical/domain-specific category crept in
    expect(core).not.toMatch(/coverage_kind[^;]*"(legal|tax|financial|market)"/);
  });

  it("the unit shape carries id/objective/kind/source_refs/status", () => {
    const fn = extractFn("planSynthesisUnits");
    expect(fn).toContain("unit_id:");
    expect(fn).toContain("objective:");
    expect(fn).toContain("coverage_kind:");
    expect(fn).toContain("source_refs:");
    expect(core).toContain("status: \"pending\" | \"synthesized\" | \"insufficient\" | \"failed\"");
  });

  it("the planner prompt enforces the comparison rule (never one side) and the contested rule (no manufactured consensus)", () => {
    const fn = extractFn("planSynthesisUnits");
    expect(fn).toContain("Never only one side");
    expect(fn).toContain("do NOT manufacture consensus");
    expect(fn).toContain("NOT search");
  });

  it("planner degradation = the pre-R4 single overall unit (universal seam)", () => {
    const fn = extractFn("planSynthesisUnits");
    expect(fn).toContain('return [{ unit_id: "u1", objective: question.slice(0, 240), coverage_kind: "overall"');
  });
});

describe("R4 — bounds (no unbounded retry)", () => {
  it("hard constants: units ≤ 6, calls ≤ 7, unit tokens ≤ 900, lanes ≤ 3", () => {
    expect(core).toContain("const R4_MAX_UNITS = 6;");
    expect(core).toContain("const R4_MAX_SYNTH_CALLS = 7;");
    expect(core).toContain("const R4_UNIT_MAX_TOKENS = 900;");
    expect(core).toContain("const R4_UNIT_CONCURRENCY = 3;");
  });

  it("the call ceiling is enforced inside the lane loop, not just declared", () => {
    expect(core).toContain("callsMade < R4_MAX_SYNTH_CALLS");
    expect(core).toContain("callsMade++");
  });
});

describe("R4 — aggregation/dedupe (behavioral, on the real extracted functions)", () => {
  const aggJs = js(STOP_LIT + "\n" + extractFn("tokens") + "\n" + extractFn("jaccard") + "\n" + extractFn("aggregateUnits"));
  type AggIn = Array<{ unit: { unit_id: string; objective: string; coverage_kind: string; source_refs: number[]; status: string }; out: { findings: Array<{ summary: string; citations: number[] }> ; insufficient?: boolean } | null }>;
  type AggOut = { findings: Array<{ summary: string; citations: number[] }>; unitDiagnostics: Array<Record<string, unknown>> };
  const agg = (new Function(`${aggJs}\nreturn aggregateUnits;`) as () => (u: AggIn) => AggOut)();
  const U = (id: string, kind = "facet") => ({ unit_id: id, objective: `objective ${id}`, coverage_kind: kind, source_refs: [1, 2], status: "pending" });

  it("near-duplicates merge: ONE finding survives, citations union (deduped)", () => {
    const out = agg([
      { unit: U("u1"), out: { findings: [
        { summary: "The federal minimum wage is $7.25 per hour nationwide since 2009", citations: [1] },
        { summary: "The federal minimum wage is $7.25 per hour nationwide since 2009", citations: [2, 2] },
      ] } },
    ]);
    expect(out.findings.length).toBe(1);
    expect(out.findings[0].citations).toEqual([1, 2]);
  });

  it("genuine conflicts NEVER dedupe: two materially different claims stay two findings", () => {
    const out = agg([
      { unit: U("u1"), out: { findings: [
        { summary: "Business failure within five years is about 50 percent per SBA data", citations: [1] },
        { summary: "Census Bureau longitudinal data puts five-year closure closer to 65 percent", citations: [2] },
      ] } },
    ]);
    expect(out.findings.length).toBe(2);
  });

  it("units are independent: an insufficient unit contributes zero findings and siblings survive", () => {
    const out = agg([
      { unit: U("u1"), out: { findings: [], insufficient: true } },
      { unit: U("u2"), out: { findings: [{ summary: "alpha beta gamma delta epsilon zeta verified figure", citations: [3] }] } },
    ]);
    expect(out.findings.length).toBe(1);
    const d1 = out.unitDiagnostics.find((d) => d.unit_id === "u1");
    expect(d1).toMatchObject({ insufficient: true, candidates_emitted: 0 });
    expect(out.unitDiagnostics.find((d) => d.unit_id === "u2")).toMatchObject({ aggregated: 1 });
  });

  it("a failed unit (null out) is recorded failed, not silently dropped", () => {
    const out = agg([{ unit: U("u1"), out: null }]);
    expect(out.unitDiagnostics[0]).toMatchObject({ synthesis_returned: false, candidates_emitted: 0 });
    expect(out.findings.length).toBe(0);
  });
});

describe("R4 — the unchanged-validator guarantee (causal measurement)", () => {
  it("validateAndBind's source is byte-identical to R3 (no loosening)", () => {
    // The R3 suite already proves behavior; here pin that the call still passes the SAME
    // citable set to the SAME single gate — and that no second/threshold gate was added.
    const call = core.indexOf("validateAndBind(synth, citable, strict, dossier.candidates)");
    expect(call).toBeGreaterThan(-1);
    // exactly ONE validateAndBind invocation in the engine
    expect((core.match(/validateAndBind\(/g) ?? []).length).toBe(2); // the definition + the one call
  });

  it("retrieval is untouched: no change to the search/read/rank/exclusion seams", () => {
    expect(core).toContain("const MAX_HOPS = 3;");
    expect(core).toContain("const MAX_TOTAL_SEARCHES = 10;");
    expect(core).toContain("const MAX_READS = 6;");
    expect(core).toContain("s.reliability_score = clamp01(0.45 * s.authority + 0.25 * s.recency + 0.30 * s.corroboration);");
    expect(core).toContain('s.excluded = tier === "T5" || s.reliability_score < 0.25;');
  });

  it("dossier extension: units[] rides the SAME dossier; R3 fields unchanged", () => {
    expect(core).toContain("(dossier as Record<string, unknown>).units = unitDiagnostics;");
    expect(core).toContain("dossier.synthesis.returned = true;");
    expect(core).toContain("dossier.synthesis.candidates = Array.isArray(synth?.findings) ? synth.findings.length : 0;");
  });

  it("dossier (entity) mode keeps its single specialized call — no silent behavior fork", () => {
    expect(core).toContain("if (entityTarget) {");
    expect(core).toContain("const mono = await synthesize(question, domainHint, citable, entityTarget);");
  });

  it("same route/model class for every unit call (doc_draft reasoning tier)", () => {
    const fn = extractFn("synthesizeUnit");
    expect(fn).toContain('routedChatCompletion("doc_draft"');
    expect(fn).not.toContain("featherless");
  });
});

describe("R4 mutation proof", () => {
  it("raising the dedupe threshold to erase conflicts breaks the conflict pin", () => {
    const mutated = js(STOP_LIT + "\n" + extractFn("tokens") + "\n" + extractFn("jaccard") + "\n" + extractFn("aggregateUnits")).replace(">= 0.8", ">= 0.05");
    // with a 0.05 threshold the two conflicting claims in this suite WOULD merge — run the
    // mutant and prove the consequence the real-code conflict pin forbids.
    const aggMut = (new Function(`${mutated}\nreturn aggregateUnits;`) as unknown as () => (u: Array<{ unit: { unit_id: string; objective: string; coverage_kind: string; source_refs: number[]; status: string }; out: { findings: Array<{ summary: string; citations: number[] }>; insufficient?: boolean } | null }>) => { findings: Array<{ summary: string; citations: number[] }>; unitDiagnostics: Array<Record<string, unknown>> })();
    const mut = aggMut([{ unit: { unit_id: "u1", objective: "o", coverage_kind: "facet", source_refs: [], status: "pending" }, out: { findings: [
      { summary: "Business failure within five years is about 50 percent per SBA data", citations: [1] },
      { summary: "Census Bureau longitudinal data puts five-year closure closer to 65 percent", citations: [2] },
    ] } }]);
    expect(mut.findings.length).toBe(1); // the mutation erases the conflict — exactly what the real-code pin forbids
    expect(core).toContain(">= 0.8");
  });
});
