// Render smoke + doctrine checks for the #244 "About Your Paige Team" directory.
//
// The load-bearing behavior: it sources EVERY VP identity from the exported
// VP_ROSTER (§12/§18 single source of truth — no second list), renders all seven
// members for every scope (§9/§35 tri-scope — the roster never changes, only the
// framing subhead), stays gold-free (§11 — a learn page has no act moment), and
// carries no finance/credit wording (§2).
//
// Rendering uses react-dom/server (already a dependency) rather than React Testing
// Library (not installed — adding a dep is a §14 proposal, not a reflex), matching
// the PaigeAttribution test. The plain PageHeader + SectionCards render without a
// Router (no <Link> on this page), so static markup is enough.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaigeTeamDirectory, type PaigeTeamScope } from "./PaigeTeamDirectory";
import { VP_ROSTER } from "@/components/ui/page";

const SCOPES: PaigeTeamScope[] = ["tenant", "operator", "agency"];

const html = (scope: PaigeTeamScope) =>
  renderToStaticMarkup(<PaigeTeamDirectory scope={scope} />);

// Remits carry "&" ("Quality & standards"), which renders HTML-escaped in static
// markup — assert against the escaped form so the check matches the real output.
const esc = (s: string) => s.replace(/&/g, "&amp;");

describe("<PaigeTeamDirectory> — sources identity from VP_ROSTER (§12/§18)", () => {
  it("renders every VP_ROSTER name + remit, in all three scopes", () => {
    for (const scope of SCOPES) {
      const out = html(scope);
      for (const { name, remit } of Object.values(VP_ROSTER)) {
        expect(out).toContain(name);
        expect(out).toContain(esc(remit));
      }
    }
  });

  it("shows all seven members (Paige + the six specialists)", () => {
    const out = html("tenant");
    // The roster is exactly PAIGE + six VPs.
    expect(Object.keys(VP_ROSTER)).toHaveLength(7);
    for (const { name } of Object.values(VP_ROSTER)) {
      expect(out).toContain(name);
    }
  });
});

describe("<PaigeTeamDirectory> — tri-scope framing (§9/§35)", () => {
  it("flips only the subhead per scope; the roster is identical", () => {
    const tenant = html("tenant");
    const operator = html("operator");
    const agency = html("agency");
    expect(tenant).toContain("inside your practice");
    expect(operator).toContain("across the platform");
    expect(agency).toContain("across your book of accounts");
    // Same roster everywhere — Nexus proves the cards don't change with scope.
    for (const out of [tenant, operator, agency]) {
      expect(out).toContain(VP_ROSTER.NEXUS.name);
      expect(out).toContain(esc(VP_ROSTER.NEXUS.remit));
    }
  });
});

describe("<PaigeTeamDirectory> — custom-specialists gate (#18, §9/§51)", () => {
  // The tenant's/agency's OWN forged keepers section renders on the tenant AND
  // agency surfaces (each reading its own tenant via the RLS-scoped hook — an
  // agency sees the keepers IT forged, never a sub-account aggregate), and is
  // ABSENT operator-side (the operator is the platform, not a tenant). In static
  // markup no effect fires, so the section renders its loading state — its header
  // is the stable render marker.
  const SECTION_MARKER = "Specialists Paige built for your practice";

  it("renders the custom-specialists section for the AGENCY surface (#18 self-view)", () => {
    expect(html("agency")).toContain(SECTION_MARKER);
  });

  it("still renders it for the TENANT surface (unchanged)", () => {
    expect(html("tenant")).toContain(SECTION_MARKER);
  });

  it("does NOT render it for the OPERATOR surface (no per-tenant roster — §51)", () => {
    expect(html("operator")).not.toContain(SECTION_MARKER);
  });
});

describe("<PaigeTeamDirectory> — §-clean", () => {
  it("spends no gold on an ACT — a learn page has no act moment (§11)", () => {
    const out = html("operator");
    // The ONLY gold permitted is the shared GlyphPlate's platform-standard faint
    // rest hairline (--gold/0.25) on the header plate and the Paige brand mark. What
    // must be ABSENT is any gold spent on an act/on moment: the armed/bright gold
    // ring (--gold/0.6), a gold FILL (bg gold / --accent-foreground pairing), or
    // gold-as-text (--gold-dark). None of those appear on a read-only learn page.
    expect(out).not.toContain("hsl(var(--gold)/0.6)"); // armed ring = the on/act moment
    expect(out).not.toContain("--gold-dark"); // gold-as-text
    expect(out).not.toContain("--accent-foreground"); // gold-fill pairing
    expect(out).not.toContain("bg-[hsl(var(--gold"); // gold fill
    // The specialist grid plates deliberately rest on the INDIGO hairline, not gold.
    expect(out).toContain("ring-[hsl(var(--primary-light)/0.7)]");
  });

  it("has no opt-in funding/credit wording (§2)", () => {
    const banned = /credit|funding|lend|loan|fico|lender/i;
    for (const scope of SCOPES) {
      expect(html(scope)).toContain("financial evidence and risks");
      expect(banned.test(html(scope))).toBe(false);
    }
  });
});
