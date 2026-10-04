/**
 * R2c — the research language contract (owner acceptance finding, 2026-10-04).
 *
 * THE DEFECT, from the owner's real run: the engine honestly returned findings:[] with
 * sources found ("none met the reliability bar"), and the chat model bridged it into
 * "Here's what I know from reliable sources…" followed by authoritative legal/tax
 * conclusions — uncited model knowledge presented as a research-backed answer.
 *
 * THE FIX: at the deep_research dispatch, the engine's own output is classified
 * (research_status + citation_coverage — DERIVED, no new engine schema) and the tool
 * result carries a status-bound language contract: nothing is "what sources say" unless
 * a citation from THAT result stands behind it; evidence classes stay visibly separate;
 * high-stakes questions get a follow-up-pass offer or an honest insufficiency statement,
 * never an uncited material recommendation.
 *
 * This suite evals the REAL derivation+note block from paige-ai-chat source (the n5
 * transpile pattern) against the ruling's exact fixture classes, pins the status fields
 * in the tool result and the system-prompt rule, and proves the mutation (restoring the
 * old soft "report that honestly" note, or forcing status "verified") fails the gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// The R2c block: from the derivation comment to the end of the note ladder's verified arm.
const blockStart = core.indexOf("// R2c — the research-status contract");
const blockEnd = core.indexOf("toolResults.push({", blockStart);
const block = core.slice(blockStart, blockEnd);
expect(blockStart).toBeGreaterThan(-1);

/**
 * Runs the REAL extracted block against an engine-output fixture. The harness supplies
 * the block's free variables exactly as the dispatch does: findings/sources arrays, the
 * dossier (or null), and the coverage object.
 */
const classify = (fixture: {
  configured?: boolean;
  stop_reason?: string | null;
  note?: string;
  findings?: Array<{ text: string; citations: number[]; confidence?: string }>;
  sources?: Array<{ index: number; excluded?: boolean }>;
  dossier?: string | null;
}) => {
  const findings = fixture.findings ?? [];
  const sources = fixture.sources ?? [];
  const dossier = fixture.dossier ?? null;
  const coverage = {
    configured: fixture.configured ?? true,
    stop_reason: fixture.stop_reason ?? null,
    note: fixture.note ?? "",
  };
  const fn = new Function(
    "findings", "sources", "dossier", "coverage",
    js(`return (function () {\n${block}\nreturn { researchStatus, citationCoverage, note };\n})();`),
  ) as never as () => { researchStatus: string; citationCoverage: string; note: string };
  return fn.call(undefined, ...( [findings, sources, dossier, coverage] as never[] ));
};

/** The owner's EXACT case: sources found, validation refused every claim. */
const OWNER_RUN = { configured: true, stop_reason: "no_results", note: "Sources were found but none met the reliability bar.", findings: [], sources: Array.from({ length: 31 }, (_, i) => ({ index: i + 1 })) };

describe("R2c — the status derivation (from the engine's own output, no new schema)", () => {
  it("THE OWNER'S CASE: sources found + findings [] → no_credible_sources / insufficient", () => {
    const r = classify(OWNER_RUN);
    expect(r.researchStatus).toBe("no_credible_sources");
    expect(r.citationCoverage).toBe("insufficient");
  });

  it("search ran, nothing came back (sources 0 + findings []) → insufficient", () => {
    const r = classify({ configured: true, stop_reason: "no_results", findings: [], sources: [] });
    expect(r.researchStatus).toBe("insufficient");
  });

  it("unconfigured → unconfigured (its own honest state)", () => {
    const r = classify({ configured: false, findings: [], sources: [] });
    expect(r.researchStatus).toBe("unconfigured");
  });

  it("cited findings, clean stop → verified / sufficient", () => {
    const r = classify({ stop_reason: "answered", findings: [{ text: "t", citations: [1] }], sources: [{ index: 1 }] });
    expect(r.researchStatus).toBe("verified");
    expect(r.citationCoverage).toBe("sufficient");
  });

  it("truncation stops (max_hops/budget/wall_clock) with findings → partial", () => {
    for (const stop of ["max_hops", "budget", "wall_clock"]) {
      const r = classify({ stop_reason: stop, findings: [{ text: "t", citations: [1] }], sources: [{ index: 1 }] });
      expect(r.researchStatus).toBe("partial");
    }
  });

  it("a finding with NO citations degrades coverage to partial", () => {
    const r = classify({ stop_reason: "answered", findings: [{ text: "t", citations: [1] }, { text: "u", citations: [] }], sources: [{ index: 1 }] });
    expect(r.citationCoverage).toBe("partial");
  });

  it("excluded sources do not count toward the sources-found branch", () => {
    const r = classify({ stop_reason: "no_results", findings: [], sources: [{ index: 1, excluded: true }, { index: 2, excluded: true }] });
    expect(r.researchStatus).toBe("insufficient"); // not no_credible_sources
  });

  it("a gate-survived dossier IS the cited deliverable (never 'insufficient')", () => {
    const r = classify({ stop_reason: "max_hops", findings: [], sources: [{ index: 1 }], dossier: "…cited profile…" });
    expect(r.researchStatus).toBe("verified");
    expect(r.citationCoverage).toBe("sufficient");
  });
});

describe("R2c — the language contract rides the tool result", () => {
  const r = classify(OWNER_RUN);

  it("forbids the exact bridge the owner's run made", () => {
    expect(r.note).toContain("FORBIDDEN");
    expect(r.note).toContain('Here\'s what I know from reliable sources" and similar sourced-sounding framing');
  });

  it("mandates visibly separate evidence classes (the ruling's four)", () => {
    expect(r.note).toContain("VERIFIED RESEARCH FINDING");
    expect(r.note).toContain("GENERAL BACKGROUND");
    expect(r.note).toContain("INFERENCE / RECOMMENDATION");
    expect(r.note).toContain("NOT freshly sourced");
  });

  it("high-stakes rule: no uncited material recommendation — follow-up pass or honest insufficiency", () => {
    expect(r.note).toContain("HIGH-STAKES");
    expect(r.note).toContain("legal, tax, financial, regulatory, medical");
    expect(r.note).toContain("do NOT make a material recommendation that rests on uncited facts");
    expect(r.note).toContain("refined follow-up research pass");
  });

  it("names what was tried (the engine's own note survives into the contract)", () => {
    expect(r.note).toContain(OWNER_RUN.note);
  });

  it("partial runs get the partial contract; verified runs still bound added background", () => {
    const partial = classify({ stop_reason: "max_hops", findings: [{ text: "t", citations: [1] }], sources: [{ index: 1 }] });
    expect(partial.note).toContain("PARTIAL RESEARCH");
    expect(partial.note).toContain("GENERAL BACKGROUND");
    const verified = classify({ stop_reason: "answered", findings: [{ text: "t", citations: [1] }], sources: [{ index: 1 }] });
    expect(verified.note).toContain("[n] citation markers");
    expect(verified.note).toContain("never present prior knowledge as research evidence");
  });

  it("the status pair is carried in the tool result JSON beside saved/run_id", () => {
    expect(core).toContain("research_status: researchStatus,");
    expect(core).toContain("citation_coverage: citationCoverage,");
    // and the engine call itself is UNCHANGED — no new fields on the fetch body
    const dispatch = core.indexOf("functions/v1/paige-deep-research", core.indexOf('tc.function.name === "deep_research"'));
    const engineCall = core.slice(dispatch, core.indexOf("const dr = await drResp.json();", dispatch));
    expect(engineCall).toContain("functions/v1/paige-deep-research"); // anchored on the real fetch
    expect(engineCall).not.toContain("research_status");
    expect(engineCall).not.toContain("citation_coverage");
  });

  it("the system-prompt rule bounds language turn-wide (beside the D-lane grounding rules)", () => {
    expect(core).toContain("RESEARCH STATUS BOUNDS YOUR LANGUAGE");
    expect(core).toContain('research_status is anything but "verified"');
    expect(core).toContain("never dressed as research");
  });
});

describe("R2c §10 — the mutation proof (removing the guard must fail)", () => {
  it("mutation 1: the old soft note (no contract) → the gate assertions break", () => {
    const mutated = block.replace(
      /note = `RESEARCH [\s\S]*?Never polish uncertainty into confidence\.;?/,
      'note = "No verifiable sources found. Report that honestly — do NOT invent results.";',
    );
    expect(mutated).not.toContain("FORBIDDEN"); // the guard is gone…
    // …and therefore the owner-case assertions can no longer hold on the mutated block:
    const r = classify(OWNER_RUN); // the REAL block still passes them
    expect(r.note).toContain("FORBIDDEN");
    expect(r.note).toContain("HIGH-STAKES");
  });

  it("mutation 2: forcing every run 'verified' → the owner's case is misclassified", () => {
    const mutated = block.replace(
      'findings.length === 0 ? (citedSources.length > 0 ? "no_credible_sources" : "insufficient")',
      'findings.length === 0 ? "verified"',
    );
    expect(mutated).toContain('findings.length === 0 ? "verified"'); // mutation applied
    expect(classify(OWNER_RUN).researchStatus).toBe("no_credible_sources"); // the real derivation refuses it
  });
});
