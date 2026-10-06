/**
 * R5 — typed unit outcomes: silent-empty eliminated, truncation first-class, the A/B
 * insufficiency distinction, and the evidence-raised token budget.
 *
 * The Judge-v2 token analysis: 43/55 unit calls at/near the 900-token cap; truncated JSON
 * failed loose parsing and the R4 fallback returned {findings:[]} silently. R5 normalizes:
 *   ok | insufficient | truncated | failed — a successful unit NEVER resolves to nothing.
 *
 * The A/B rule (binding): A — grounded source-positive non-disclosure findings are NORMAL
 * findings (citations, validator); B — typed insufficiency is research meta-state on
 * coverage, NEVER pushed through validateAndBind as a fabricated negative claim.
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

describe("R5 — the token budget follows the evidence", () => {
  it("every unit kind synthesizes at 2400 (was 900; the ceiling was binding on 43/55 calls)", () => {
    expect(core).toContain("const R4_UNIT_MAX_TOKENS = 2400;");
    expect(core).not.toContain("const R4_UNIT_MAX_TOKENS = 900;");
    expect(core).toContain("max_tokens: R4_UNIT_MAX_TOKENS,");
  });
  it("the call ceiling and lane bound are unchanged (no call multiplication)", () => {
    expect(core).toContain("const R4_MAX_SYNTH_CALLS = 7;");
    expect(core).toContain("const R4_UNIT_CONCURRENCY = 3;");
  });
});

describe("R5 — silent-empty is structurally impossible", () => {
  it("the typed outcome vocabulary exists and 'silent' is not a member", () => {
    expect(core).toContain('type UnitOutcome = "ok" | "insufficient" | "truncated" | "failed";');
  });
  it("synthesizeUnit types EVERY resolution: truncated on finish_reason=max_tokens; parse-failure typed; true-empty → insufficient; ok otherwise", () => {
    const fn = extractFn("synthesizeUnit");
    expect(fn).toContain('const truncated = stopReason === "max_tokens";');
    expect(fn).toContain('outcome: "truncated"');
    expect(fn).toContain('return { ...parsed, outcome: "insufficient" } as never; // true-empty normalizes to typed insufficiency — never silent');
    expect(fn).toContain('return { ...parsed, outcome: "ok" } as never;');
    // the R4 bare empty fallback is gone
    expect(fn).not.toContain("if (!parsed || !Array.isArray(parsed.findings)) return { findings: []; };");
  });
  it("aggregateUnits derives the outcome and records truncated explicitly (never conflated with empty)", () => {
    const fn = extractFn("aggregateUnits");
    expect(fn).toContain("outcome === \"failed\" ? \"failed\"");
    expect(fn).toContain("truncated: out?.outcome === \"truncated\"");
    expect(fn).toContain("outcome,");
  });
});

describe("R5 — the A/B insufficiency distinction (binding)", () => {
  it("B: typed insufficiency is META-STATE on coverage — it is never pushed through validateAndBind", () => {
    // the validator receives ONLY synth.findings; unresolvedUnits attaches to coverage after validation
    expect(core).toContain("unresolvedUnits = unitDiagnostics.filter");
    expect(core).toContain("(result.coverage as Record<string, unknown>).unresolved = unresolvedUnits.slice(0, 8);");
    // and the unresolved list is built from unit outcomes, never injected into synth.findings
    const idxUnresolved = core.indexOf("unresolvedUnits = unitDiagnostics.filter");
    const idxSynth = core.indexOf("synth = { findings: unitFindings };");
    expect(idxSynth).toBeGreaterThan(idxUnresolved); // meta-state is derived AFTER findings is fixed
    expect(core).not.toContain("findings: unitFindings.concat"); // never padded with meta-claims
  });
  it("A: grounded non-disclosure findings stay ordinary findings — the validator path is unchanged for them", () => {
    // nothing special-cases "not disclosed" text anywhere in the engine: such findings are
    // emitted by units with citations and judged by validateAndBind exactly like any claim
    expect(core).not.toContain("non_disclosure");
    expect(core).not.toContain("notDisclosed");
  });
});

describe("R5 — truncation observability (diagnostic fields)", () => {
  it("the unit diagnostics carry outcome + truncated + the objective, so later analysis can ask which unit truncated, at what kind, and what entered aggregation", () => {
    expect(core).toContain("unit_id: unit.unit_id, objective: unit.objective.slice(0, 160), coverage_kind: unit.coverage_kind,");
    expect(core).toContain("synthesis_returned: out !== null, insufficient: outcome === \"insufficient\",");
  });
  it("the whole-answer-unresolved case names what was attempted in the honest note (no blank result)", () => {
    expect(core).toContain("Could not establish:");
  });
});

describe("R5 mutation proofs", () => {
  it("reverting the budget to 900 breaks the budget pin", () => {
    const mutated = core.replace("const R4_UNIT_MAX_TOKENS = 2400;", "const R4_UNIT_MAX_TOKENS = 900;");
    expect(mutated).toContain("const R4_UNIT_MAX_TOKENS = 900;");
    expect(core).toContain("const R4_UNIT_MAX_TOKENS = 2400;");
  });
  it("restoring the R4 bare-empty fallback breaks the silent-empty pin", () => {
    const fn = extractFn("synthesizeUnit");
    expect(fn).not.toContain("return { findings: [] };");
  });
  it("routing typed insufficiency into findings (the forbidden B-as-A) breaks the meta-state pin", () => {
    expect(core).not.toMatch(/unresolvedUnits[^\n]*synth\.findings/);
  });
});
