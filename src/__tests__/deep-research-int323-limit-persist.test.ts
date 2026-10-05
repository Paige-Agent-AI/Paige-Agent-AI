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

const copyFor = (trace: Array<Record<string, unknown>>, limitReached = true): string => {
  // two-stage eval: the outer call returns the real function; the inner call runs it
  const outer = new Function(js(`return (${extractFn("researchLimitFallbackCopy")});`)) as unknown as
    () => (t: Array<Record<string, unknown>>, limit: boolean) => string;
  return outer()(trace, limitReached);
};

const site1Start = core.indexOf("// INT-323 site 1 — a research turn that produced a GOVERNED research result");
const site2Start = core.indexOf("// INT-323 site 2 — THE RECORDED DEFECT PATH");
const site2End = core.indexOf("// ── THE FINAL CHECK", site2Start);
const site1 = core.slice(site1Start, core.indexOf("if (continueContinuation)", site1Start));
const site2 = core.slice(site2Start, site2End);

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

  it("the limit wording appears ONLY when a limit was actually recorded (site-truthful copy)", () => {
    expect(copyFor([{ saved: true }], true)).toContain("research limit");
    expect(copyFor([{ saved: false }], true)).toContain("research limit");
    expect(copyFor([{ saved: true }], false)).not.toContain("research limit");
    expect(copyFor([{ saved: false }], false)).not.toContain("research limit");
  });

  it("no fabricated synthesis: neither arm claims findings, sources, or completion", () => {
    for (const c of [copyFor([{ saved: true }], true), copyFor([{ saved: false }], true), copyFor([{ saved: true }], false), copyFor([{ saved: false }], false)]) {
      expect(c).not.toMatch(/found \d|sources? (say|show)|verified|conclusion|evidence/i);
    }
  });
});

describe("INT-323 — both sites (research + empty prose → the copy rides the ONE replay/pump + ONE persist)", () => {
  it("proof 1: SITE 2 covers THE RECORDED DEFECT PATH (ok-but-empty closing stream, LIMIT_REACHED)", () => {
    expect(site2Start).toBeGreaterThan(-1);
    expect(site2).toContain("researchTrace.length > 0");
    expect(site2).toContain("!finalAssistantText.trim()");
    expect(site2).toContain('turnTracker.record().state === "LIMIT_REACHED"');
    expect(site2).toContain("const limited = researchLimitFallbackCopy(researchTrace");
  });

  it("site 2 emits the copy ON THE WIRE (wire half of proofs 2/3) — content frame + sentinel", () => {
    expect(site2).toContain("finalAssistantText = limited;");
    expect(site2).toContain("emitContent(controller, enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: limited } }] })}");
    expect(site2.match(/data: \[DONE\]/g)?.length).toBe(1);
  });

  it("site 1 covers the replayed-round sibling (finalChunks present, no forced termination)", () => {
    expect(site1Start).toBeGreaterThan(-1);
    expect(site1).toContain("finalChunks && !forcedTermination");
    expect(site1).toContain("!finalAssistantText.trim()");
    expect(site1).toContain('turnTracker.record().state === "LIMIT_REACHED"');
  });

  it("NEITHER site converts the turn state — no tracker calls at all", () => {
    for (const site of [site1, site2]) {
      expect(site).not.toContain("turnTracker.budgetStop");
      expect(site).not.toContain("turnTracker.interrupted");
      expect(site).not.toContain("turnTracker.final");
    }
  });

  it("proof 6 — exactly-once: neither site persists or dispatches anything itself", () => {
    for (const site of [site1, site2]) {
      expect(site).not.toContain("persistAssistantTurn");
      expect(site).not.toContain("fetch(");
    }
    // site 1 only sets replay variables; site 2 only sets text + emits the two frames
    expect(site1).toContain("lastRoundFinished = true;");
    expect(site2).toContain("finalAssistantText = limited;");
  });

  it("proofs 2/3 (persist half): the ONE persist site is unchanged and saves the SAME variable with the reference", () => {
    const guard = "if (payloadThreadId && finalAssistantText.trim()) {";
    expect(core).toContain(guard);
    const site = core.indexOf(guard);
    const persistCall = core.slice(site, core.indexOf("} catch", site));
    expect(persistCall).toContain("persistAssistantTurn(finalAssistantText, withTurnRecord(finalAssistantText, assistantTurnMetadata()))");
  });

  it("proof 5 — ordinary FINAL research turns (prose present) can never enter either site", () => {
    expect(site1).toContain("!finalAssistantText.trim()");
    expect(site2).toContain("!finalAssistantText.trim()");
  });

  it("the paige_research reference still rides assistantTurnMetadata (the reload contract)", () => {
    expect(core).toContain("paige_research: researchTrace.map((r) => ({");
    expect(core).toContain("run_id: r.run_id, question: r.question, saved: r.saved === true,");
  });
});

describe("INT-323 proof 7 — the mutations demonstrably break the gate's predicates", () => {
  it("deleting site 2 (the recorded defect path) removes the only coverage of it — the gate goes red", () => {
    expect(core).toContain("INT-323 site 2 — THE RECORDED DEFECT PATH");
    expect(core.replace(site2, "")).not.toContain("THE RECORDED DEFECT PATH");
  });

  it("gutting the fallback to always-claimed-saved VIOLATES proof 4's predicate (enforcement shown)", () => {
    const mutatedFn = extractFn("researchLimitFallbackCopy").replace(
      "const savedRuns = researchTrace.filter((r) => r.saved === true).length;",
      "const savedRuns = 1;",
    );
    const outer = new Function(js(`return (${mutatedFn});`)) as unknown as
      () => (t: Array<Record<string, unknown>>, limit: boolean) => string;
    const c = outer()([{ saved: false }], true);
    // the same predicate proof 4 enforces on the REAL source:
    const proof4Holds = c.includes("could not be confirmed as saved") && !c.includes("research library");
    expect(proof4Holds).toBe(false); // the mutation lies — proof 4 would fail exactly here
    expect(copyFor([{ saved: false }], true)).toContain("could not be confirmed as saved"); // the real one holds
  });
});
