import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  getTierFeatureSet,
  hasFeature,
  resolveTierKey,
  type Feature,
  type TierClassification,
  type TierKey,
} from "./tierFeatures";

// §60 tier-lock guard (owner-ruled 2026-08-11). This test LOCKS the load-bearing
// cells of the TIER_FEATURE_BASELINE map so a future careless edit that re-adds
// (or drops) a feature on the wrong tier is caught in CI — the §51/§13 backstop the
// lint:tier-features guard can't provide (the linter checks call sites, not the map).
// PURE — no DB, no fetch.

/** Build a classification for a tier the way the hook does. */
function cls(
  account_type: string | null,
  opts: { parent?: string | null; staff?: boolean } = {},
): TierClassification {
  return {
    account_type,
    parent_tenant_id: opts.parent ?? null,
    isPlatformStaff: opts.staff ?? false,
  };
}

const SOLO = cls("standalone");
const SUB = cls("sub_account", { parent: "agency-uuid" });
const AGENCY = cls("agency");
const ENTERPRISE = cls("enterprise");
const GOD = cls(null, { staff: true });

describe("resolveTierKey", () => {
  const cases: Array<[string, TierClassification, TierKey]> = [
    ["god = platform staff, no tenant", GOD, "god"],
    ["agency", AGENCY, "agency"],
    ["enterprise", ENTERPRISE, "enterprise"],
    ["sub_account (typed)", SUB, "sub_account"],
    ["solo (standalone, no parent)", SOLO, "solo"],
    ["solo (null type, no parent)", cls(null), "solo"],
  ];
  it.each(cases)("resolves %s", (_label, c, expected) => {
    expect(resolveTierKey(c)).toBe(expected);
  });

  it("§51 parent-first: a legacy 'standalone' WITH a parent resolves to sub_account, not solo", () => {
    expect(resolveTierKey(cls("standalone", { parent: "agency-uuid" }))).toBe("sub_account");
  });

  it("§51 defense-in-depth: a mistyped child (account_type='agency' while parented) never resolves to a manager tier", () => {
    expect(resolveTierKey(cls("agency", { parent: "agency-uuid" }))).toBe("sub_account");
  });

  it("platform staff WITH an active tenant resolves to that tenant's tier, not god", () => {
    expect(resolveTierKey(cls("sub_account", { parent: "x", staff: true }))).toBe("sub_account");
  });
});

describe("§60 customer_portal_invite lock — the owner-ruled cell", () => {
  it("solo + sub_account + enterprise GET it (enterprise = the HYBRID tier, owner 2026-08-11)", () => {
    expect(hasFeature(SOLO, "customer_portal_invite")).toBe(true);
    expect(hasFeature(SUB, "customer_portal_invite")).toBe(true);
    // Enterprise HYBRID (closes flag 1 from PR #458): a creation-capable tenant with a
    // direct client book must be able to invite the very clients its campaigns are for.
    expect(hasFeature(ENTERPRISE, "customer_portal_invite")).toBe(true);
  });
  it("a pure agency + god do NOT (the lock holds for agency)", () => {
    expect(hasFeature(AGENCY, "customer_portal_invite")).toBe(false);
    expect(hasFeature(GOD, "customer_portal_invite")).toBe(false);
  });
});

describe("§60 other load-bearing cells", () => {
  it("fleet_console is god-only", () => {
    expect(hasFeature(GOD, "fleet_console")).toBe(true);
    for (const c of [SOLO, SUB, AGENCY, ENTERPRISE]) {
      expect(hasFeature(c, "fleet_console")).toBe(false);
    }
  });

  it("subaccount_management is manager-tier only (agency + enterprise)", () => {
    expect(hasFeature(AGENCY, "subaccount_management")).toBe(true);
    expect(hasFeature(ENTERPRISE, "subaccount_management")).toBe(true);
    for (const c of [SOLO, SUB, GOD]) {
      expect(hasFeature(c, "subaccount_management")).toBe(false);
    }
  });

  it("universal features are on every tier incl. god", () => {
    const universal: Feature[] = [
      "command_center",
      "systems_check",
      "marketplace",
      "analytics",
      "setup",
      "paige_hub",
    ];
    for (const c of [SOLO, SUB, AGENCY, ENTERPRISE, GOD]) {
      for (const f of universal) expect(hasFeature(c, f)).toBe(true);
    }
  });

  it("god does NOT carry the tenant CRM cluster (people_crm/pipeline/conversations)", () => {
    for (const f of ["people_crm", "pipeline", "conversations"] as Feature[]) {
      expect(hasFeature(GOD, f)).toBe(false);
    }
  });

  it("§60 growth (creation surfaces) — solo/sub/enterprise/god GET it, agency does NOT", () => {
    for (const c of [SOLO, SUB, ENTERPRISE, GOD]) {
      expect(hasFeature(c, "growth")).toBe(true);
    }
    expect(hasFeature(AGENCY, "growth")).toBe(false);
  });

  it("§60 studio (Vibe Studio) — solo/sub/enterprise/god GET it, agency does NOT", () => {
    for (const c of [SOLO, SUB, ENTERPRISE, GOD]) {
      expect(hasFeature(c, "studio")).toBe(true);
    }
    expect(hasFeature(AGENCY, "studio")).toBe(false);
  });

  it("§61 skills (self-use gate) — solo/sub/enterprise/god GET it, agency does NOT (agency resells via Marketplace, doesn't self-use)", () => {
    for (const c of [SOLO, SUB, ENTERPRISE, GOD]) {
      expect(hasFeature(c, "skills")).toBe(true);
    }
    expect(hasFeature(AGENCY, "skills")).toBe(false);
  });

  it("§60 trust_compass — SOLO-ONLY for now; sub-account DEFERRED (owner ruling 2026-09-06)", () => {
    // The Command Center shell is universal, but its Trust Compass sub-tab is released to Solo
    // only until an explicit sub-account release. Enterprise inherits it via the Solo union
    // (harmless — enterprise renders a different shell). Sub-account, agency, god do NOT get it.
    expect(hasFeature(SOLO, "trust_compass")).toBe(true);
    expect(hasFeature(ENTERPRISE, "trust_compass")).toBe(true);
    expect(hasFeature(SUB, "trust_compass")).toBe(false);
    expect(hasFeature(AGENCY, "trust_compass")).toBe(false);
    expect(hasFeature(GOD, "trust_compass")).toBe(false);
  });

  it("§60 live_conversation — SOLO-ONLY for now; sub-account DEFERRED (same posture as trust_compass)", () => {
    // The owner named Solo when he asked for Live ("available for my solo tier for all of my
    // users", 2026-09-23), and the standing 2026-09-06 ruling defers sub-account delivery until
    // an explicit release. Enterprise inherits via the Solo union; agency has no direct book to
    // speak about and god is the operator, not a tenant.
    expect(hasFeature(SOLO, "live_conversation")).toBe(true);
    expect(hasFeature(ENTERPRISE, "live_conversation")).toBe(true);
    expect(hasFeature(SUB, "live_conversation")).toBe(false);
    expect(hasFeature(AGENCY, "live_conversation")).toBe(false);
    expect(hasFeature(GOD, "live_conversation")).toBe(false);
  });

  it("§60 live_conversation is a WHOLE-SHELL answer — every Solo classification gets it, including one whose account_type has not settled", () => {
    // The failure this guards is the one the owner named: a brand-new Solo signup arriving with a
    // capability its neighbours have. resolveTierKey fail-safes an unset account_type to solo, and
    // the server predicate (live_conversation_tier_allows) makes the same reading, so a freshly
    // provisioned tenant is eligible on both layers with no operator action and no per-account row.
    const freshlyProvisioned = cls(null);
    expect(hasFeature(freshlyProvisioned, "live_conversation")).toBe(true);
    // And it is never per-account: two different Solo tenants resolve identically.
    expect(getTierFeatureSet(SOLO)).toBe(getTierFeatureSet(freshlyProvisioned));
  });

  // §18/§60 — the SQL twin and this map must give the same answer, and this pin exists because they
  // already disagreed once. getTierFeatureSet is frontend-only and not server-importable, so the
  // server needs its own predicate (the same pattern as trg_agreement_tier); a twin nobody pins is
  // just a fork with a nicer name. The first draft of live_conversation_tier_allows excluded
  // 'enterprise' while ENTERPRISE_FEATURES spreads SOLO_FEATURES and therefore included it — a
  // disagreement with no observable symptom today (0 enterprise tenants; Enterprise renders the
  // agency shell), which is exactly how it would have survived. An adversarial read caught it; this
  // test is what catches the next one.
  it("§18 the SQL tier predicate agrees with this map about live_conversation", () => {
    const sql = readFileSync(
      "supabase/migrations/20270422000000_live_conversation_is_a_solo_tier_capability.sql",
      "utf8",
    );
    // The predicate's shape: top-level AND account_type NOT IN (<excluded>).
    const excluded = sql.match(/coalesce\(t\.account_type, 'standalone'\) NOT IN \(([^)]*)\)/);
    expect(excluded, "the predicate's account_type exclusion list could not be located").not.toBeNull();
    const sqlExcludes = new Set(
      excluded![1].split(",").map((part) => part.trim().replace(/^'|'$/g, "")),
    );
    // What the SQL would answer for a TOP-LEVEL tenant of each account_type.
    const sqlAllows = (accountType: string) => !sqlExcludes.has(accountType);
    expect(sqlAllows("standalone")).toBe(hasFeature(SOLO, "live_conversation"));
    expect(sqlAllows("enterprise")).toBe(hasFeature(ENTERPRISE, "live_conversation"));
    expect(sqlAllows("agency")).toBe(hasFeature(AGENCY, "live_conversation"));
    expect(sqlAllows("sub_account")).toBe(hasFeature(SUB, "live_conversation"));
    // And the unsettled account_type both sides fail-safe to solo.
    expect(sqlAllows("standalone")).toBe(hasFeature(cls(null), "live_conversation"));
  });

  // The predicate must also refuse every PARENTED tenant outright (§51: a child is never a manager
  // tier), which is the half the account_type list above cannot express.
  it("§51 the SQL tier predicate refuses any parented tenant before it looks at account_type", () => {
    const sql = readFileSync(
      "supabase/migrations/20270422000000_live_conversation_is_a_solo_tier_capability.sql",
      "utf8",
    );
    expect(sql).toMatch(/t\.parent_tenant_id IS NULL\s*\n?\s*AND coalesce\(t\.account_type/);
    // Mirrors resolveTierKey's parent-first check, so a legacy sub-account still typed 'standalone'
    // is refused by both layers rather than only by one.
    expect(resolveTierKey(cls("standalone", { parent: "agency-uuid" }))).toBe("sub_account");
    expect(hasFeature(cls("standalone", { parent: "agency-uuid" }), "live_conversation")).toBe(false);
  });

  it("enterprise is a superset of agency (never falls below it — even after the growth/studio split)", () => {
    const agencySet = getTierFeatureSet(AGENCY);
    const enterpriseSet = getTierFeatureSet(ENTERPRISE);
    for (const f of agencySet) expect(enterpriseSet.has(f)).toBe(true);
  });
});
