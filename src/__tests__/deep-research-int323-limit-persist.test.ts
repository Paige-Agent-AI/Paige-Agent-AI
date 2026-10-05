/**
 * INT-323 — LIMIT_REACHED research turns must not drop the assistant turn and its saved
 * research reference (the R2 acceptance seam, owner ruling 2026-10-05).
 *
 * The defect: the closing model prose came back empty on a governed-research turn that had
 * recorded its limit; the main persistence guard (`if (payloadThreadId && finalAssistantText.trim())`)
 * then skipped the assistant turn — so no bundle_ref.paige_research reference ever landed and
 * reload lost the card, while the run itself WAS saved (INT-309 proved that half live).
 *
 * The repair: beside the C1 exhausted-branch, a research-aware branch authors the whole
 * answer from RUNTIME TRUTH (researchLimitFallbackCopy — deterministic from the trace's
 * governed-readback saved verdicts, never a model call), replaces the empty round's chunks,
 * and lets the ONE replay path + the ONE persistence site carry the SAME copy with the
 * normal bundle metadata. LIMIT_REACHED stays LIMIT_REACHED — never converted to FINAL.
 *
 * This suite pins the ruling's regression proofs:
 *  1. research + empty closing answer → the branch supplies the deterministic copy;
 *  2/3. wire and persisted copy are THE SAME object (one replay, one persist — proven by
 *     construction pins: the branch only sets finalAssistantText/finalChunks; the unchanged
 *     persist guard persists that same variable with assistantTurnMetadata);
 *  4. saved=false can never produce a Saved claim (the fallback's unsaved arm);
 *  5. ordinary FINAL research behavior unchanged (branch requires empty text; non-empty
 *     prose never enters it);
 *  6. exactly-once (no persist/research call inside the branch);
 *  7. mutation: restoring "skip persistence when final text is empty" (deleting the branch)
 *     fails the gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = join(__dirname, "..", "..");
const core = readFileSync(join(root, "supabase/functions/paige-ai-chat/index.ts"), "utf8");

const js = (body: string) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/** Extract a named module-scope function's full text via the AST. */
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

const copyFor = (trace: Array<Record<string, unknown>>): string => {
  // two-stage eval: the outer call returns the real function; the inner call runs it
  const outer = new Function(js(`return (${extractFn("researchLimitFallbackCopy")});`)) as unknown as
    () => (t: Array<Record<string, unknown>>) => string;
  return outer()(trace);
};

const branchStart = core.indexOf("// INT-323 — a research turn that produced a GOVERNED research result");
const branchEnd = core.indexOf("if (continueContinuation) { continueContinuation = false; continue; }", branchStart);
const branch = core.slice(branchStart, branchEnd);

describe("INT-323 — the fallback copy is deterministic runtime truth", () => {
  it("proof 4: saved=false can NEVER produce a Saved claim", () => {
    const c = copyFor([{ saved: false }]);
    expect(c).toContain("could not be confirmed as saved");
    expect(c).toContain("I won't claim any result from it");
    expect(c).not.toContain("research library");
  });

  it("saved=true (the governed readback verdict) claims the library truthfully", () => {
    const c = copyFor([{ saved: true }]);
    expect(c).toContain("research limit");
    expect(c).toContain("saved run is in this workspace's research library");
  });

  it("mixed runs: ANY saved run → the saved arm (the owner is pointed at what exists)", () => {
    expect(copyFor([{ saved: false }, { saved: true }])).toContain("research library");
    expect(copyFor([{ saved: false }, { saved: false }])).not.toContain("research library");
  });

  it("no fabricated synthesis: neither arm claims findings, sources, or completion", () => {
    for (const c of [copyFor([{ saved: true }]), copyFor([{ saved: false }])]) {
      expect(c).toContain("before I could finish the written summary");
      expect(c).not.toMatch(/found \d|sources? (say|show)|verified|conclusion/i);
    }
  });
});

describe("INT-323 — the branch (research + empty prose → the copy rides the ONE replay + ONE persist)", () => {
  it("exists, and fires ONLY when a governed research result exists AND the prose is empty (proof 5)", () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(branch).toContain("researchTrace.length > 0");
    expect(branch).toContain("!finalAssistantText.trim()");
    // ordinary FINAL research turns (prose present) never enter — the trim guard is load-bearing
    expect(branch).toContain("const limited = researchLimitFallbackCopy(researchTrace);");
  });

  it("the copy is emitted ON THE WIRE exactly like the exhausted branch (proof 3, wire half)", () => {
    expect(branch).toContain("finalAssistantText = limited;");
    expect(branch).toContain("enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: limited } }] })}");
    expect(branch).toContain('enc.encode("data: [DONE]');
    expect(branch).toMatch(/finalChunks = \[/);
    expect(branch).toContain("lastRoundFinished = true;");
  });

  it("LIMIT_REACHED is NEVER converted: the branch touches no turn-tracker state", () => {
    expect(branch).not.toContain("turnTracker.");
    expect(branch).not.toContain("budgetStop");
    expect(branch).not.toContain("interrupted(");
  });

  it("proof 6 — exactly-once: the branch neither persists nor dispatches anything itself", () => {
    expect(branch).not.toContain("persistAssistantTurn");
    expect(branch).not.toContain("fetch(");
    expect(branch).not.toContain("emitContent");
    expect(branch).not.toContain("turnTracker.");
    // the branch only READS the trace and sets the copy variables — its executable body is
    // exactly: the guard, the fallback call, three variable assignments. Nothing else runs.
    const body = branch.slice(branch.indexOf("if (finalChunks")).trim();
    expect(body.startsWith("if (finalChunks")).toBe(true);
    expect(body.replace(/}\s*$/, "").trimEnd().endsWith("lastRoundFinished = true;")).toBe(true);
    for (const stmt of ["const limited = researchLimitFallbackCopy(researchTrace);", "finalAssistantText = limited;", "finalChunks = [", "lastRoundFinished = true;"]) {
      expect(body).toContain(stmt);
    }
    expect(body.split(";").length).toBeLessThanOrEqual(8); // no hidden extra statements
  });

  it("proofs 2/3 (persist half): the ONE persist site is unchanged and saves the SAME variable with the reference", () => {
    const guard = "if (payloadThreadId && finalAssistantText.trim()) {";
    expect(core).toContain(guard);
    // the persist uses assistantTurnMetadata (which carries the paige_research reference — pinned by R2b)
    const site = core.indexOf(guard);
    const persistCall = core.slice(site, core.indexOf("} catch", site));
    expect(persistCall).toContain("persistAssistantTurn(finalAssistantText, withTurnRecord(finalAssistantText, assistantTurnMetadata()))");
  });

  it("the paige_research reference still rides assistantTurnMetadata (the reload contract)", () => {
    expect(core).toContain("paige_research: researchTrace.map((r) => ({");
    expect(core).toContain("run_id: r.run_id, question: r.question, saved: r.saved === true,");
  });
});

describe("INT-323 proof 7 — the mutation (restore skip-on-empty) fails the gate", () => {
  it("deleting the branch removes every load-bearing pin (the gate goes red on the real source)", () => {
    const mutated = core.replace(branch, "");
    expect(mutated).not.toContain("researchLimitFallbackCopy(researchTrace)");
    expect(mutated).not.toContain("// INT-323 — a research turn");
    // while the real source holds them:
    expect(core).toContain("researchLimitFallbackCopy(researchTrace)");
    expect(branchStart).toBeGreaterThan(-1);
  });

  it("gutting the fallback (always claiming saved) fails proof 4", () => {
    const mutatedFn = extractFn("researchLimitFallbackCopy").replace(
      "const savedRuns = researchTrace.filter((r) => r.saved === true).length;",
      "const savedRuns = 1;",
    );
    const outer = new Function(js(`return (${mutatedFn});`)) as unknown as
      () => (t: Array<Record<string, unknown>>) => string;
    const c = outer()([{ saved: false }]);
    expect(c).toContain("research library"); // the mutation lies — and the saved=false pin above refuses exactly this
  });
});
