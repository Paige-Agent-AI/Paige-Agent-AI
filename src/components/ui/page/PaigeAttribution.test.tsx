// Unit + render smoke for the §243 <PaigeAttribution> byline primitive.
//
// Focus is the doctrine-load-bearing behavior: it credits a LIST honestly (§13),
// never fabricates or collapses to one canned name, de-dupes, drops unknown VPs,
// renders null on empty, spends NO gold, and stays a display (never a picker).
//
// Rendering uses react-dom/server (already a dependency) rather than React Testing
// Library (not installed — and adding a dep is a §14 proposal, not a reflex). The
// static markup is enough to assert the byline's real output and token discipline.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaigeAttribution, VP_ROSTER, type VP, type PaigeContributor } from "./PaigeAttribution";

const html = (contributors: PaigeContributor[], props = {}) =>
  renderToStaticMarkup(<PaigeAttribution contributors={contributors} {...props} />);

describe("VP_ROSTER", () => {
  it("carries PAIGE + the six VPs, each with a name and a coaching-generic remit", () => {
    const keys = Object.keys(VP_ROSTER).sort();
    expect(keys).toEqual(["CURA", "MENTOR", "MERIT", "NEXUS", "PAIGE", "VERA", "ZION"]);
    for (const k of keys as VP[]) {
      expect(VP_ROSTER[k].name.length).toBeGreaterThan(0);
      expect(VP_ROSTER[k].remit.length).toBeGreaterThan(0);
    }
  });

  it("allows the owner's business-finance remit while keeping funding/credit opt-in (§2)", () => {
    expect(VP_ROSTER.VERA.remit).toBe("Intelligence, finance & risk");
    const banned = /credit|funding|lend|loan|fico|lender/i;
    for (const v of Object.values(VP_ROSTER)) {
      expect(banned.test(v.remit)).toBe(false);
    }
  });
});

describe("<PaigeAttribution> honesty (§13)", () => {
  it("credits every contributor passed — a list, not a single name", () => {
    const out = html([{ vp: "MERIT" }, { vp: "VERA" }]);
    expect(out).toContain("Merit + Vera");
    // surface-neutral default lead-in (this primitive credits live surfaces too, not only drafts)
    expect(out).toContain("By your Paige team");
  });

  it("renders nothing when contributors is undefined/non-array (§32 — degrade, never crash)", () => {
    // Callers adopt this incrementally from loose runtime data that TS types as required
    // but is undefined during load or absent in the DB. Cast to exercise the runtime guard
    // (the prop type can't express "callers may violate me at runtime").
    const renderUnsafe = (c: unknown) =>
      renderToStaticMarkup(<PaigeAttribution contributors={c as PaigeContributor[]} />);
    expect(renderUnsafe(undefined)).toBe("");
    expect(renderUnsafe(null)).toBe("");
  });

  it("uses the surface-neutral default lead-in, and honors a leadIn override", () => {
    expect(html([{ vp: "ZION" }])).toContain("By your Paige team");
    expect(html([{ vp: "ZION" }], { leadIn: "Drafted by your Paige team" }))
      .toContain("Drafted by your Paige team");
  });

  it("shows exactly one name when one contributor is passed (never collapses/expands)", () => {
    const out = html([{ vp: "CURA" }]);
    expect(out).toContain("Cura");
    expect(out).not.toContain(" + ");
  });

  it("renders nothing on an empty list — never fabricates a contributor", () => {
    expect(html([])).toBe("");
  });

  it("drops a VP not in the roster (can't credit a non-existent VP)", () => {
    // @ts-expect-error — intentionally passing an unknown VP id
    const out = html([{ vp: "GHOST" }, { vp: "ZION" }]);
    expect(out).toContain("Zion");
    expect(out).not.toContain("GHOST");
  });

  it("de-dupes repeated VPs (first mention wins)", () => {
    const out = html([{ vp: "MERIT" }, { vp: "MERIT" }]);
    expect(out).toContain("Merit");
    expect(out).not.toContain("Merit + Merit");
  });

  it("renders a role qualifier when present", () => {
    expect(html([{ vp: "VERA", role: "reviewed" }])).toContain("Vera reviewed");
  });
});

describe("<PaigeAttribution> variants + gold discipline (§11)", () => {
  it("block variant adds the joined remit line", () => {
    const out = html([{ vp: "MERIT" }, { vp: "VERA" }], { variant: "block" });
    // markup HTML-escapes "&"; assert on unambiguous substrings of each remit.
    expect(out).toContain("Sales");
    expect(out).toContain("revenue");
    expect(out).toContain("Intelligence, finance");
    expect(out).toContain("risk");
    expect(out).toContain(" · ");
  });

  it("spends NO gold and no raw hex in its OWN markup (§11 — the byline is not an act moment)", () => {
    // showMark:false isolates the component's own styling from the shared PaigeMark
    // brand SVG, whose gold-gradient hex is the one sanctioned place a hex lives.
    const out = html([{ vp: "MERIT" }], { variant: "block", showMark: false });
    expect(out).not.toMatch(/gold/i);
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // classes are semantic tokens only — foreground / muted-foreground / border.
    expect(out).toMatch(/text-muted-foreground/);
    expect(out).toMatch(/text-foreground/);
  });

  it("the same six VPs serve every scope — roster does not swap", () => {
    for (const scope of ["tenant", "operator", "portfolio"] as const) {
      expect(html([{ vp: "NEXUS" }], { scope })).toContain("Nexus");
    }
  });
});
