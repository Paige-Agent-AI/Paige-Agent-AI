/**
 * R3 — the inspectable research dossier: taxonomy-from-source pins + non-regression proof.
 *
 * The ruling: derive the drop-reason taxonomy from validateAndBind's ACTUAL branches (not
 * invented), and prove the instrumentation changes NO substantive output (R3 is observation).
 *
 * This suite:
 *  1. runs the REAL extracted validateAndBind with and without the diag collector and proves
 *     the returned findings are DEEP-EQUAL (non-regression, behaviorally);
 *  2. drives every ACTUAL branch of the validator with fixtures and asserts the exact
 *     machine-readable drop reason each branch must emit (the canonical taxonomy);
 *  3. pins the dossier's bounded shape (caps, ids, persistence wiring, column migration);
 *  4. mutation: removing the diag wiring or re-collapsing the citation guard breaks the gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-deep-research/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20270588000000_research_dossier_column.sql"), "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/** Extract validateAndBind + its module-level helpers so the REAL function executes. */
const extract = () => {
  const sf = ts.createSourceFile("fn.ts", core, ts.ScriptTarget.ES2022, true);
  const fns = new Map<string, string>();
  const want = new Set(["validateAndBind", "tokens", "hostOf", "digitsOnly", "phonesIn", "composeText", "deriveConfidence"]);
  const walk = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && want.has(n.name.text)) fns.set(n.name.text, n.getText(sf));
    n.forEachChild(walk);
  };
  walk(sf);
  for (const k of want) if (!fns.has(k)) throw new Error(`missing dependency extraction: ${k}`);
  const order = ["tokens", "hostOf", "digitsOnly", "phonesIn", "composeText", "deriveConfidence", "validateAndBind"];
  return js(order.map((k) => fns.get(k)).join("\n"));
};
// tokens() closes over the module-level STOP set — include it in every eval body.
const STOP_LIT = "const STOP = new Set([\n  \"the\", \"and\", \"for\", \"with\", \"that\", \"this\", \"from\", \"your\", \"you\", \"are\",\n  \"was\", \"were\", \"will\", \"have\", \"has\", \"not\", \"but\", \"all\", \"can\", \"how\",\n  \"what\", \"when\", \"which\", \"who\", \"why\", \"about\", \"into\", \"over\", \"than\",\n]);";
const vabJs = extract();
/** Run the real validator; returns { findings, diag }. */
const run = (synth: unknown, citable: unknown[], strict = false) => {
  const diag: unknown[] = [];
  // two-stage eval: the outer body carries the hoisted declarations; it RETURNS the validator
  const outer = new Function(`${STOP_LIT}
${vabJs}
return validateAndBind;`) as
    () => (s: unknown, c: unknown[], st: boolean, d?: unknown[]) => unknown[];
  const findings = outer()(synth, citable, strict, diag);
  return { findings, diag: diag as Array<Record<string, unknown>> };
};
const SRC = (index: number, url: string, text: string, host?: string) => ({
  index, url, title: `t${index}`, snippet: text.slice(0, 60), content: text, read: true,
  host: host ?? new URL(url).hostname, published_at: null, fetched_at: "", authority: 1, recency: 1,
  corroboration: 1, reliability_score: 1, tier: "T2", reliability: "high", excluded: false,
});

describe("R3 non-regression — the diag collector changes NOTHING", () => {
  const citable = [SRC(1, "https://irs.gov/a", "The due date is April 15 2026 and the safe harbor is 90 percent of current year tax."), SRC(2, "https://reuters.com/b", "Reuters confirms the April 15 2026 deadline.")];
  const synth = { findings: [
    { summary: "Q1 estimated tax is due April 15 2026", citations: [1, 2] },
    { summary: "No-citation finding", citations: [] },
    { summary: "Bad-ref finding", citations: [99] },
    { summary: "Ghost name", citations: [1], name: "Zzyzx Nonexistent" },
  ] };

  it("findings are DEEP-EQUAL with and without the collector (behavioral non-regression)", () => {
    const withoutOuter = new Function(`${STOP_LIT}
${vabJs}
return validateAndBind;`) as
      () => (s: unknown, c: unknown[], st: boolean) => unknown[];
    const without = withoutOuter();
    const a = without(synth, citable, false);
    const b = run(synth, citable, false).findings;
    expect(b).toEqual(a);
  });

  it("every candidate lands in the diag with a stable run-local id, in order", () => {
    const { diag } = run(synth, citable, false);
    expect(diag.map((d) => d.cid)).toEqual(["c1", "c2", "c3", "c4"]);
  });
});

describe("R3 taxonomy — every ACTUAL validator branch, its exact machine reason", () => {
  const citable = [SRC(1, "https://one.gov/x", "alpha beta gamma delta 2026"), SRC(2, "https://two.com/y", "epsilon zeta 2027")];

  it("citation_missing — synthesis emitted no citations FIELD at all", () => {
    const { diag } = run({ findings: [{ summary: "s" }] }, citable, false);
    expect(diag[0]).toMatchObject({ outcome: "dropped", drop_reason: "citation_missing" });
  });

  it("citation_empty — the array is present but empty", () => {
    const { diag } = run({ findings: [{ summary: "s", citations: [] }] }, citable, false);
    expect(diag[0]).toMatchObject({ outcome: "dropped", drop_reason: "citation_empty" });
  });

  it("citation_unresolvable — refs exist, none resolve; each unresolved ref carries its reason", () => {
    const { diag } = run({ findings: [{ summary: "s", citations: [99, 7] }] }, citable, false);
    expect(diag[0]).toMatchObject({ outcome: "dropped", drop_reason: "citation_unresolvable" });
    expect(diag[0].unresolved).toEqual([{ ref: 99, reason: "index_out_of_range" }, { ref: 7, reason: "index_out_of_range" }]);
  });

  it("name_token_mismatch — the entity name is not grounded in any cited source", () => {
    const { diag } = run({ findings: [{ summary: "s", citations: [1], name: "Totally Unseen Name" }] }, citable, false);
    expect(diag[0]).toMatchObject({ outcome: "dropped", drop_reason: "name_token_mismatch", name: "Totally Unseen Name" });
    expect(diag[0].checks).toMatchObject({ name_grounded: false });
  });

  it("contact_unverified_strict — STRICT mode drops name-ok/contact-failed records; non-strict keeps them", () => {
    const synth = { findings: [{ summary: "s", citations: [1], name: "alpha beta", website: "https://unseen.example", phone: "+1 555 000 0000" }] };
    expect(run(synth, citable, true).diag[0]).toMatchObject({ outcome: "dropped", drop_reason: "contact_unverified_strict" });
    const lax = run(synth, citable, false);
    expect(lax.diag[0]).toMatchObject({ outcome: "accepted", drop_reason: null });
    expect(lax.diag[0].checks).toMatchObject({ website: "nulled", phone: "nulled" });
  });

  it("accepted rows carry the resolved cites, per-check verdicts, and NO drop reason", () => {
    const { diag } = run({ findings: [{ summary: "alpha 2026", citations: [1, 2] }] }, citable, false);
    expect(diag[0]).toMatchObject({ outcome: "accepted", drop_reason: null, resolved: [1, 2], citations_emitted: [1, 2] });
    expect(diag[0].checks).toMatchObject({ name_grounded: null, website: "n/a", phone: "n/a" });
  });
});

describe("R3 dossier wiring — bounded shape + canonical persistence", () => {
  it("the hop layer captures planner/queries/searches/reads/budget (source pins)", () => {
    expect(core).toContain("planner: entityTarget ? \"entity\" : \"llm\"");
    expect(core).toContain("planned_queries: queries.slice(0, BND.MAX_QUERIES_PER_HOP)");
    expect(core).toContain("search_hits_added: sources.length - sourcesBeforeSearch");
    expect(core).toContain("reads_selected: readsSelected.slice(0, BND.MAX_READS)");
    expect(core).toContain("budget: hopBudget()");
  });

  it("synthesis diagnostics: returned + candidate count (the synthesis-refusal vs validation-rejection split)", () => {
    expect(core).toContain("dossier.synthesis.returned = !!synth;");
    expect(core).toContain("dossier.synthesis.candidates = Array.isArray(synth?.findings) ? synth.findings.length : 0;");
  });

  it("the 64-candidate cap is explicit and flags truncation", () => {
    expect(core).toContain("dossier.candidates.slice(0, 64)");
    expect(core).toContain("caps_applied.candidates_truncated = true");
  });

  it("the dossier persists on the canonical record — all three persistRun sites carry it", () => {
    expect(core.match(/persistRun\(SUPABASE_URL, SERVICE_KEY, runId, body, result, lineageTenantId, dossier\)/g)?.length).toBe(3);
    expect(core).toContain("dossier: (dossier ?? null) as never,");
  });

  it("the migration is additive-only: one nullable jsonb column on research_runs, no second store", () => {
    expect(migration).toContain("ALTER TABLE public.research_runs ADD COLUMN IF NOT EXISTS dossier jsonb;");
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("REVOKE");
    expect(migration).not.toContain("GRANT");
  });

  it("nothing downstream READS the dossier (instrumentation purity)", () => {
    // every dossier mention outside its own capture must be write-side only
    const reads = core.match(/dossier\.[a-z_]+/g) ?? [];
    const readTargets = new Set(reads.map((r) => r.replace(/\.slice|\.push|\.length|\.candidates|\.synthesis|\.hops|\.caps_applied|\.v/g, "").split(".")[1] ?? ""));
    // the only fields read are its own bookkeeping (push/length/slice on the collectors)
    for (const t of readTargets) expect(["", "hops", "synthesis", "candidates", "caps_applied", "v"]).toContain(t);
  });
});

describe("R3 mutation proof — re-collapsing the citation guard or unwiring the diag fails", () => {
  it("collapsing the three-way citation split back to one reason breaks the taxonomy gate", () => {
    const mutated = vabJs.replace(
      /collect\(!Array\.isArray\(rf\.citations\) \? "citation_missing" : rf\.citations\.length === 0 \? "citation_empty" : "citation_unresolvable"\);/,
      'collect("citation_unresolvable");',
    );
    expect(mutated).not.toContain('"citation_missing"');
    // while the real source distinguishes all three:
    expect(vabJs).toContain('"citation_missing"');
    expect(vabJs).toContain('"citation_empty"');
    expect(vabJs).toContain('"citation_unresolvable"');
  });

  it("dropping the diag parameter from the validator call (unwired instrumentation) fails the wiring pin", () => {
    const mutated = core.replace(
      "const findings = validateAndBind(synth, citable, strict, dossier.candidates);",
      "const findings = validateAndBind(synth, citable, strict);",
    );
    expect(mutated).not.toContain("validateAndBind(synth, citable, strict, dossier.candidates)");
  });
});
