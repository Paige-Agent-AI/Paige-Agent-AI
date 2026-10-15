import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// The guard is dependency-free and its exports are pure (the CLI entry only runs under a direct
// `node` invocation), so importing it here has no side effects. tsc is non-strict + allowJs, so the
// `.mjs` import adds no new type error; vitest resolves it in Node.
import {
  analyzeMindContract,
  CANONICAL_MIND_STATES,
  extractMindStateLiterals,
  isMindProjectionCandidate,
  readRealSpineInputs,
} from "@/../scripts/ci/mind-contract-lint.mjs";

const FIXTURES = "scripts/fixtures/mind-contract";
const fixture = (name: string) => ({ path: `${FIXTURES}/${name}`, content: readFileSync(`${FIXTURES}/${name}`, "utf8") });

// The real Spine projection + Chat adapter, exactly as they ship on main. Every test proves the
// LIVE contract holds AND that a planted regression is caught — the failing-first pair.
const real = readRealSpineInputs();
const realViolations = analyzeMindContract(real);
type Inputs = Parameters<typeof analyzeMindContract>[0];
const codes = (inputs: Inputs) => analyzeMindContract(inputs).map((v: { code: string }) => v.code);

describe("Mind three-state evidence contract (§18/§13/§00)", () => {
  it("MC1 — the live union is EXACTLY {recorded, no_evidence, unavailable}; a fourth state AND a second projection that omits a state are both caught", () => {
    // The live contract is fully clean end-to-end (asserted once here).
    expect(realViolations).toEqual([]);
    expect(real.projections.length).toBeGreaterThan(0);
    for (const projection of real.projections) {
      expect(extractMindStateLiterals(projection.content)).toEqual([...CANONICAL_MIND_STATES].sort());
    }
    const good = fixture("good-projection.ts");
    // Failing-first: a projection that adds a "partial" state is flagged MC1.
    expect(codes({ projections: [fixture("bad-mc1-projection.ts")], chatAdapter: fixture("good-chat.ts"), canonicalPath: `${FIXTURES}/bad-mc1-projection.ts` })).toContain("MC1");
    // P1 regression: a SECOND two-state projection ({recorded, unavailable}) is DISCOVERED as a
    // candidate and flagged MC1 (bad state set), not silently filtered out.
    expect(codes({ projections: [good, fixture("bad-p1-twostate-second.ts")], chatAdapter: fixture("good-chat.ts"), canonicalPath: good.path })).toContain("MC1");
    // PR-A2 (a) — load-bearing on the DETECTOR (what readRealSpineInputs filters real files with):
    // a function-valued `export const project*MindEvidence` (reusing the canonical type, no own
    // union) is recognized as a candidate; the Chat adapter is not.
    expect(isMindProjectionCandidate(fixture("bad-p1b-const-projection.ts").content)).toBe(true);
    expect(isMindProjectionCandidate(fixture("good-chat.ts").content)).toBe(false);
    // …and once discovered, alongside the canonical home it is flagged MC4 (second home, no SCR).
    expect(codes({ projections: [good, fixture("bad-p1b-const-projection.ts")], chatAdapter: fixture("good-chat.ts"), canonicalPath: good.path })).toContain("MC4");
  });

  it("MC2 — the live projector is fail-closed at its RETURN branches; a projector that returns 'recorded' for an empty/partial set is caught", () => {
    expect(realViolations.map((v: { code: string }) => v.code)).not.toContain("MC2");
    const bad = fixture("bad-mc2-projection.ts");
    expect(codes({ projections: [bad], chatAdapter: fixture("good-chat.ts"), canonicalPath: bad.path })).toContain("MC2");
  });

  it("MC3 — the honesty copy is bound to the right state; SWAPPING the UNAVAILABLE and NO_EVIDENCE lines is caught even though both phrases remain in the file", () => {
    expect(realViolations.map((v: { code: string }) => v.code)).not.toContain("MC3");
    const bad = fixture("bad-mc3-projection.ts");
    expect(codes({ projections: [bad], chatAdapter: fixture("good-chat.ts"), canonicalPath: bad.path })).toContain("MC3");
  });

  it("MC4 — exactly ONE CANONICAL Mind projection at the explicit path; every other live projection carries an SCR marker; a second without one is caught, and a shorter-pathed SCR'd projection does not falsely blame the canonical one", () => {
    // SCR era (SCR-INTEGRATIONS-MIND, 2026-10-02): a second, SCR-marked projection is a
    // legitimate governed extension — the invariant is no longer "exactly one projection" but
    // "exactly one CANONICAL home, and every other live projection is SCR-marked".
    expect(real.projections.filter((p: { path: string }) => p.path === real.canonicalPath).length).toBe(1);
    const unmarkedSeconds = real.projections.filter(
      (p: { path: string; content: string }) => p.path !== real.canonicalPath && !/sharedPrimitiveChange\s*:\s*["'`]SCR-|\/\/\s*mind-projection-scr\s*:\s*\S+/.test(p.content),
    );
    expect(unmarkedSeconds).toEqual([]);
    expect(realViolations.map((v: { code: string }) => v.code)).not.toContain("MC4");
    // Failing-first: a second SCR-less Mind projection alongside the real one is flagged MC4.
    expect(codes({ projections: [...real.projections, fixture("bad-mc4-second-projection.ts")], chatAdapter: real.chatAdapter, canonicalPath: real.canonicalPath })).toContain("MC4");
    // The canonical anchor is explicit (not shortest-path): a marked second projection with a
    // SHORTER path than the canonical home does NOT cause the canonical one to be blamed for MC4.
    const scrSecond = { path: "a.ts", content: "export type NewMindEvidence = never;\n// mind-projection-scr: SCR-approved" };
    const withScrSecond = analyzeMindContract({ projections: [...real.projections, scrSecond], chatAdapter: real.chatAdapter, canonicalPath: real.canonicalPath });
    expect(withScrSecond.filter((v: { code: string; path: string }) => v.code === "MC4" && v.path === real.canonicalPath)).toEqual([]);
    // PR-A2 (b): the canonical home is MISSING (only a marked replacement remains) → MC4, even
    // though the replacement carries a valid SCR marker.
    expect(codes({ projections: [fixture("scr-marked-projection.ts")], chatAdapter: real.chatAdapter, canonicalPath: real.canonicalPath })).toContain("MC4");
  });

  it("MC5 — the live Chat adapter RETURNS via the Mind projection (comments ignored); a re-deriving adapter and a MISSING adapter are both caught", () => {
    expect(realViolations.map((v: { code: string }) => v.code)).not.toContain("MC5");
    // Failing-first: a Chat adapter that constructs the no_evidence branch itself is flagged MC5.
    expect(codes({ projections: real.projections, chatAdapter: fixture("bad-mc5-chat.ts"), canonicalPath: real.canonicalPath })).toContain("MC5");
    // A missing/deleted configured adapter is a violation, not a silent pass.
    expect(codes({ projections: real.projections, chatAdapter: undefined, canonicalPath: real.canonicalPath })).toContain("MC5");
    // PR-A2 (c): an exported entry point that re-implements the states is caught even when an
    // UNUSED non-exported helper carries the render call (the whole-file check missed this).
    expect(codes({ projections: real.projections, chatAdapter: fixture("bad-mc5b-chat-scoped.ts"), canonicalPath: real.canonicalPath })).toContain("MC5");
  });
});
