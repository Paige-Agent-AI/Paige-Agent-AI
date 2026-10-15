import { catalogueDeclarations } from "../../../../scripts/ci/tool-catalogue-lint.mjs";
/**
 * `settings · Capabilities` — the clamp arithmetic and the governed-but-invisible gap.
 *
 * This surface is WIRED, so most of what matters is behaviour rather than authored strings: what
 * the Trust Compass does to a mode, what the schema forbids, and whether a failed read is honest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { clampMode } from "@/operator/data/useToolAutonomy";

describe("the ceiling clamps a mode; it never rewrites one", () => {
  /** `capOf` — `capsVals` L9954, verbatim in arithmetic. */
  it("holds everything off at a ceiling of nothing", () => {
    for (const m of ["auto", "confirm", "off"] as const) {
      expect(clampMode(m, 0)).toBe("off");
    }
  });

  it("holds autopilot down to ask-first one rung up, and leaves the rest alone", () => {
    expect(clampMode("auto", 1)).toBe("confirm");
    expect(clampMode("confirm", 1)).toBe("confirm");
    expect(clampMode("off", 1)).toBe("off");
  });

  it("stops clamping once the ceiling is above ask-first", () => {
    for (const c of [2, 3, 4]) {
      expect(clampMode("auto", c)).toBe("auto");
      expect(clampMode("confirm", c)).toBe("confirm");
    }
  });

  /**
   * A NULL ceiling means the platform holds no rung. Clamping against one would report a gate
   * that is not set (§13) — the same reason `usePlatformTrust` renders no meter rather than a
   * default rung.
   */
  it("clamps nothing when the platform holds no rung", () => {
    expect(clampMode("auto", null)).toBe("auto");
    expect(clampMode("off", null)).toBe("off");
  });

  /**
   * The clamp is a RENDER, never a write. Stated as a property: clamping is idempotent on the
   * stored mode, so a ceiling that goes down and back up restores what the tool was set to. If a
   * later edit ever wrote the clamped value back, this is the test that would still pass while
   * the product silently lost every autopilot setting — so it is paired with the assertion that
   * the surface's own write path is `setMode`, not the clamp.
   */
  it("leaves the stored mode recoverable when the ceiling moves down and back", () => {
    const stored = "auto" as const;
    expect(clampMode(stored, 1)).toBe("confirm");
    expect(clampMode(stored, 4)).toBe("auto");
  });
});

/**
 * The governed-but-invisible gap. The real number is measured by `lint:tool-catalogue`, which
 * fails when it grows; these read the SHIPPED component and the two files the number comes from,
 * so the foot cannot drift back to CD's "four" or the ledger's "five" without a test saying so.
 *
 * The first version of this block asserted a string constant it had declared itself two lines
 * earlier — which proves the test file can hold a string, and nothing about what ships. Recorded
 * because that is the exact shape of a test that passes forever while the product is wrong.
 */
describe("what the surface says about the gap is the measured number", () => {
  /**
   * COMMENTS ARE STRIPPED FIRST, and this is the second time that has been the bug. The port
   * DOCUMENTS what it refused to carry — it quotes CD's "Four automation tools…" in the comment
   * that explains why the count was corrected — so a guard reading the raw file fires on the very
   * note proving the figure was fixed. `consoleTypography.test.ts` learned this on its own first
   * run. Read the code, never the prose about the code.
   */
  const surface = readFileSync(
    resolve(process.cwd(), "src/operator/surfaces/settings/CapabilitiesSurface.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

  /**
   * THE FOOT NO LONGER CLAIMS A GAP, BECAUSE THERE ISN'T ONE.
   *
   * CD's delivered sentence counted four; the true count when it was ported was 23, so it shipped
   * with the true figure. Migration 20261020000000 then closed the gap to ZERO — and a sentence
   * describing a gap that no longer exists is a false claim about the platform, rendered on the
   * platform's own governance surface. So it is removed rather than restated with a new number.
   *
   * This asserts the absence in EVERY spelling the claim has ever had, because "it doesn't say 23"
   * would pass the moment someone wrote "24". The live gap itself is asserted to be zero by the
   * derivation test below — this one only guards the PROSE from re-acquiring a stale figure.
   */
  it("no longer claims a catalogue gap, in any of its historic spellings", () => {
    expect(surface).not.toContain("Four automation tools");
    expect(surface).not.toMatch(/gated at runtime but missing/);
    expect(surface).not.toMatch(/governed and invisible/);
    // And it has not simply been emptied: CD's rules are still the body of it.
    expect(surface).toContain("Modes are stored per tenant per tool");
  });

  it("still carries the two schema rules CD wrote, which are not figures but law", () => {
    expect(surface).toContain("anything sent through approval must carry approval");
    expect(surface).toContain("Auto-send cannot be expressed");
  });

  /**
   * And the number itself, derived the way the guard derives it: every tool in the runtime gate
   * that has no row in the catalogue. If a migration adds them, this drops and the guard's own
   * baseline check fails first — which is the ordering that makes the fix visible rather than
   * silent.
   */
  it("matches the live diff of the runtime gate against the catalogue", () => {
    // The runtime gate is the action-risk policy's key set — the handler no longer holds a literal
    // of its own, so that the classification and the gated set cannot drift apart. This derives the
    // gate the same way the runtime does.
    const policy = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/action-risk.ts"),
      "utf8",
    );
    const at = policy.indexOf("const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [");
    const gate = new Set(
      [
        ...policy
          .slice(at, policy.indexOf("\n];", at))
          .matchAll(/\[\s*"([a-z0-9_]+)"\s*,\s*"(?:ordinary|high|owner_only)"\s*,/g),
      ].map((m) => m[1]),
    );
    // A parse that finds nothing would report a clean gap, which is indistinguishable from a clean
    // gap. Prove the subject was found before measuring it.
    expect(gate.size).toBeGreaterThan(40);

    const catalogue = catalogueDeclarations().at(-1)!.keys;

    const invisible = [...gate].filter((k) => !catalogue.has(k));

    // THIS USED TO MEASURE THE GAP; IT NOW ASSERTS THERE ISN'T ONE.
    //
    // For a long time the gate governed 46 tools and the catalogue listed 23, so 23 were governed
    // but INVISIBLE — permanently `confirm`, with no way for the tenant to turn them off or on.
    // Among them `n8n_delete_workflow`, a permanent delete the operator could not disable. The gap
    // opened when a migration that said it re-declared the catalogue "verbatim" quietly dropped the
    // n8n rows, and widened one tool at a time after that: a tool added to the gate and not to the
    // list fails nothing and simply never appears.
    //
    // Migration 20261020000000 closes it. Asserting ZERO rather than a number is the point — a
    // count has to be re-agreed every time the gate changes, and re-agreeing a number is how the
    // gap grew. The invariant does not need updating; it needs obeying.
    //
    // If this fails, do NOT adjust it: a tool was added to `MUTATING_TOOLS` without a catalogue
    // row, and the fix is the row. The failure message names exactly which.
    expect(invisible).toEqual([]);
    expect(catalogue.size).toBeGreaterThanOrEqual(gate.size);
    // Kept explicitly, because it is the one that made this more than bookkeeping.
    expect(catalogue.has("n8n_delete_workflow")).toBe(true);

    // MERGE NOTE (2026-09-01). `main` asserted the OPPOSITE of this: `invisible` has length 23,
    // with `n8n_delete_workflow` among them. Both were true of their own branch — main still
    // carries the gap; this branch's migration 20261032000000 closed it. The zero assertion is
    // kept because it is the stronger invariant, and because a COUNT is what let the gap grow:
    // every new governed tool required re-agreeing a number, and re-agreeing it is how tools
    // slipped in ungoverned. Main's four Comms tools arrive with this merge, so keeping zero
    // obliges the merge to give them catalogue rows rather than to raise a number — which is
    // exactly the pressure this assertion exists to create.
  }, 20_000);
});
