import { describe, it, expect } from "vitest";
import { VP_ROSTER, type VP } from "@/components/ui/page";
import {
  DEPT_VP,
  VP_DEPARTMENTS,
  resolveVpForDept,
  resolveVpForActionKind,
  type DeptSlug,
} from "@/lib/paige/vpDepartments";

describe("vpDepartments — VP↔department map integrity (§12/§16)", () => {
  it("every department names an owning VP that exists in VP_ROSTER (§243)", () => {
    for (const [slug, vp] of Object.entries(DEPT_VP)) {
      expect(VP_ROSTER[vp as VP], `dept ${slug} → ${vp}`).toBeDefined();
    }
  });

  it("DEPT_VP and VP_DEPARTMENTS are mutually exact — no drift between the two views", () => {
    // Every dept in DEPT_VP appears under exactly one VP in VP_DEPARTMENTS…
    const flat = Object.entries(VP_DEPARTMENTS).flatMap(([vp, slugs]) =>
      slugs.map((s) => [s, vp] as const),
    );
    const inverse = new Map<string, string>(flat);
    expect(inverse.size).toBe(flat.length); // no dept owned by two VPs
    for (const [slug, vp] of Object.entries(DEPT_VP)) {
      expect(inverse.get(slug), `dept ${slug}`).toBe(vp);
    }
    // …and vice-versa: every VP_DEPARTMENTS entry matches DEPT_VP.
    for (const [slug, vp] of flat) {
      expect(DEPT_VP[slug as DeptSlug]).toBe(vp);
    }
  });

  it("covers all 10 canonical departments + the legacy owner_ops desk", () => {
    expect(Object.keys(DEPT_VP).sort()).toEqual(
      [
        "client_experience",
        "executive_office",
        "finance",
        "legal_compliance",
        "marketing",
        "operations_pmo",
        "owner_ops",
        "people_talent",
        "product_curriculum",
        "sales",
        "technology_automation",
      ].sort(),
    );
  });
});

describe("resolveVpForDept — always-visible tiles fall back, never crash (§32)", () => {
  it("resolves every known slug to its owner", () => {
    expect(resolveVpForDept("marketing")).toBe("NEXUS");
    expect(resolveVpForDept("legal_compliance")).toBe("VERA");
    expect(resolveVpForDept("owner_ops")).toBe("PAIGE");
  });
  it("falls back to PAIGE for unknown / null / undefined (visible degrade, §32)", () => {
    expect(resolveVpForDept("something_new")).toBe("PAIGE");
    expect(resolveVpForDept(null)).toBe("PAIGE");
    expect(resolveVpForDept(undefined)).toBe("PAIGE");
    expect(resolveVpForDept("")).toBe("PAIGE");
  });
});

describe("resolveVpForActionKind — draft credit is null unless real (§13)", () => {
  it("resolves namespaced §16 kinds via their namespace", () => {
    expect(resolveVpForActionKind("marketing.draft_campaign")).toBe("NEXUS");
    expect(resolveVpForActionKind("sales.work_followup")).toBe("MERIT");
    expect(resolveVpForActionKind("finance.retainer_reminder")).toBe("VERA");
    expect(resolveVpForActionKind("curriculum.suggest_resource")).toBe("MENTOR");
    expect(resolveVpForActionKind("tech.propose_automation")).toBe("ZION");
    expect(resolveVpForActionKind("ops.record_status")).toBe("ZION");
    expect(resolveVpForActionKind("talent.flag_role_gap")).toBe("PAIGE");
    expect(resolveVpForActionKind("legal.flag_review")).toBe("VERA");
    expect(resolveVpForActionKind("exec.compile_brief")).toBe("PAIGE");
  });
  it("resolves a bare department slug passed directly (linked to_department)", () => {
    expect(resolveVpForActionKind("client_experience")).toBe("CURA");
  });
  it("returns null for legacy / unknown categories — no fabricated credit (§13)", () => {
    expect(resolveVpForActionKind("email")).toBeNull();
    expect(resolveVpForActionKind("follow_up")).toBeNull();
    expect(resolveVpForActionKind("sms_reminder")).toBeNull();
    expect(resolveVpForActionKind(null)).toBeNull();
    expect(resolveVpForActionKind(undefined)).toBeNull();
    expect(resolveVpForActionKind("")).toBeNull();
  });
});
