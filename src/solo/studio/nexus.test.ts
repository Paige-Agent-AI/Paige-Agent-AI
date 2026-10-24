// NEXUS attribution in Vibe Studio — prompt and roster-fidelity unit tests (EXP06, ANT-162).
// EVIDENCE CLASS (§32/§70.1): focused unit tests on the pure prompt module. Rendered behaviour is
// proven in studio.render.test.tsx; authenticated runtime is not claimed here.
import { describe, expect, it } from "vitest";
import { VP_ROSTER } from "@/components/ui/page/PaigeAttribution";
import { DEPT_VP } from "@/lib/paige/vpDepartments";
import {
  STUDIO_DEPARTMENT_OWNING_VP, nexusDepartmentRemit, nexusDisplayName, planWithNexusPrompt, reviewWithNexusPrompt,
} from "./nexus";

describe("studio NEXUS attribution", () => {
  it("the department tie is the typed seam's: marketing → NEXUS", () => {
    expect(DEPT_VP.marketing).toBe("NEXUS");
    expect(STUDIO_DEPARTMENT_OWNING_VP).toBe("NEXUS");
  });

  it("names and remits come from VP_ROSTER, never a local string", () => {
    expect(nexusDisplayName()).toBe(VP_ROSTER.NEXUS.name);
    expect(nexusDepartmentRemit()).toBe(VP_ROSTER.NEXUS.remit);
  });

  it("the plan prompt is addressed to the roster name, keeps PAIGE as COO, and forbids actions", () => {
    const p = planWithNexusPrompt();
    expect(p.startsWith(`${VP_ROSTER.NEXUS.name},`)).toBe(true);
    expect(p).toContain("PAIGE remains my COO");
    expect(p).toContain("Do not take an action");
    // Planning asks for missing/conflicting facts rather than presuming them.
    expect(p).toContain("what's missing or conflicting");
  });

  it("the review prompt cites the door's own facts and keeps the approval with the owner", () => {
    const p = reviewWithNexusPrompt("form", "New client intake", "https://app.example.com/form/f-1");
    expect(p.startsWith(`${VP_ROSTER.NEXUS.name},`)).toBe(true);
    expect(p).toContain('form "New client intake"');
    expect(p).toContain("at https://app.example.com/form/f-1");
    expect(p).toContain("PAIGE remains my COO");
    expect(p).toContain("Do not publish anything");
  });

  it("no prepared address yet: the review prompt states the act without inventing an address", () => {
    const p = reviewWithNexusPrompt("page", null, null);
    expect(p).toContain("page I'm about to publish");
    expect(p).not.toContain(" at ");
    expect(p).not.toMatch(/https?:\/\//);
  });
});
