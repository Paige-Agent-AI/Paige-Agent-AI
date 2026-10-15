import { describe, it, expect } from "vitest";
import { catalogueDeclarations } from "../../../scripts/ci/tool-catalogue-lint.mjs";
import {
  TOOL_MAP,
  UNMAPPED_CATALOGUE_TOOLS,
  CAPABILITY_DOMAINS,
  toolsForCapability,
  maxModeForRisk,
  clampModeToRisk,
  postureOf,
} from "./capabilityTools";
// The ONE source of truth for action risk. Importing it here (test-only, never in the app bundle)
// is what makes the copied classes in capabilityTools.ts a guarded copy rather than a second source.
import { classifyAction } from "../../../supabase/functions/_shared/action-risk";

// The catalogue `list_tool_autonomy` exposes — DERIVED from the LATEST migration that defines the
// function, not hand-transcribed. A hand copy silently goes stale when a migration adds a governed
// tool, which is the exact "governed invisibly" failure the catalogue's own header warns about; a
// derived list makes that a hard test failure the moment the migration lands.
function catalogueKeysFromMigration(): string[] {
  return [...catalogueDeclarations().at(-1)!.keys];
}
const CATALOGUE_KEYS: readonly string[] = catalogueKeysFromMigration();

describe("capabilityTools — no drift from the action-risk policy (§18)", () => {
  it("every mapped tool's copied risk class matches action-risk.ts exactly", () => {
    for (const [tool, { risk }] of Object.entries(TOOL_MAP)) {
      expect({ tool, risk: classifyAction(tool) }).toEqual({ tool, risk });
    }
  });

  it("no mapped tool is unclassified (a knob must front a real, runnable action)", () => {
    for (const tool of Object.keys(TOOL_MAP)) {
      expect(classifyAction(tool)).not.toBe("unclassified");
    }
  });

  it("the deliberately-unmapped catalogue tools are unclassified phantoms OR undispatched tombstones", () => {
    // Two reasons a catalogue tool stays off the Solo knobs: `pipeline_create` / `pipeline_add_stage`
    // are UNCLASSIFIED phantoms; `marketplace_install` / `marketplace_uninstall` / `n8n_delete_workflow`
    // are CLASSIFIED containment tombstones that no runtime dispatches (lint-exempted in
    // action-risk-lint) — a knob for either would be a §70.1 false affordance, so both are excluded.
    const TOMBSTONES = new Set(["marketplace_install", "marketplace_uninstall", "n8n_delete_workflow"]);
    for (const tool of UNMAPPED_CATALOGUE_TOOLS) {
      if (TOMBSTONES.has(tool)) {
        expect({ tool, unclassified: classifyAction(tool) === "unclassified" }).toEqual({ tool, unclassified: false });
      } else {
        expect({ tool, class: classifyAction(tool) }).toEqual({ tool, class: "unclassified" });
      }
    }
  });

  it("fronts no ghost tool — every tool it maps or names is really in the catalogue", () => {
    const catalogue = new Set(CATALOGUE_KEYS);
    // A knob (or a named phantom) must correspond to a tool the catalogue actually exposes; a mapped
    // key the catalogue does not carry would be a control for an action the runtime never governs.
    for (const tool of Object.keys(TOOL_MAP)) expect(catalogue.has(tool)).toBe(true);
    for (const tool of UNMAPPED_CATALOGUE_TOOLS) expect(catalogue.has(tool)).toBe(true);
  });

  it("curates a Solo-capability SUBSET of the cross-surface catalogue — never claims to cover it whole", () => {
    // `list_tool_autonomy` is a SHARED contract: it now also carries the MCP-door / operator acts
    // (`tenant_create`, `agency_*`, `platform_post_notification`, cross-tenant/privacy acts) that a
    // Solo tenant's Trust Compass must NOT front (§9/§53). So the Solo surface deliberately fronts a
    // subset, not the whole catalogue. Which of the newly-catalogued tools belong on the Solo surface
    // is a §00 product decision, tracked as its own follow-up — this test records the subset
    // relationship honestly rather than forcing every cross-tier act onto the Solo knobs (§13).
    const accountedFor = new Set([...Object.keys(TOOL_MAP), ...UNMAPPED_CATALOGUE_TOOLS]);
    const catalogue = new Set(CATALOGUE_KEYS);
    expect(accountedFor.size).toBeLessThan(catalogue.size); // strict subset — the catalogue is larger
    for (const tool of accountedFor) expect(catalogue.has(tool)).toBe(true);
    // Known OPERATOR / cross-tenant acts are in the catalogue but are explicitly NOT on the Solo
    // surface — a mapping guard against accidentally putting a platform-tier knob on a Solo tenant.
    for (const op of ["tenant_create", "agency_create_subaccount", "platform_post_notification"]) {
      expect(catalogue.has(op)).toBe(true);
      expect(accountedFor.has(op)).toBe(false);
    }
  });
});

describe("capabilityTools — domains and clamps", () => {
  it("every capability domain has at least one real tool", () => {
    for (const d of CAPABILITY_DOMAINS) expect(toolsForCapability(d.key).length).toBeGreaterThan(0);
  });

  it("every mapped tool belongs to a real domain key", () => {
    const keys = new Set(CAPABILITY_DOMAINS.map((d) => d.key));
    for (const { capability } of Object.values(TOOL_MAP)) expect(keys.has(capability)).toBe(true);
  });

  it("risk ceilings: ordinary→auto, high→confirm, owner_only→off", () => {
    expect(maxModeForRisk("ordinary")).toBe("auto");
    expect(maxModeForRisk("high")).toBe("confirm");
    expect(maxModeForRisk("owner_only")).toBe("off");
  });

  it("clamp never lets a mode exceed its risk ceiling (no false affordance §70.1)", () => {
    expect(clampModeToRisk("auto", "high")).toBe("confirm");
    expect(clampModeToRisk("auto", "owner_only")).toBe("off");
    expect(clampModeToRisk("confirm", "owner_only")).toBe("off");
    expect(clampModeToRisk("auto", "ordinary")).toBe("auto");
    expect(clampModeToRisk("off", "ordinary")).toBe("off");
  });

  it("owner_only always reads as 'Your call' regardless of stored mode", () => {
    expect(postureOf("auto", "owner_only")).toBe("your_call");
    expect(postureOf("off", "owner_only")).toBe("your_call");
    expect(postureOf("auto", "ordinary")).toBe("guardrails");
    expect(postureOf("confirm", "high")).toBe("asks");
    expect(postureOf("off", "ordinary")).toBe("held");
  });
});
