import { describe, expect, it } from "vitest";

import {
  canonicalAppUrl,
  resolveCanonicalAppPath,
  resolveCanonicalRecordLink,
  withQuery,
} from "../../supabase/functions/_shared/canonical-app-url";
import { SOLO_BRANCHES } from "@/lib/routing/tierBranches";
import { SOLO_SETUP_TABS } from "@/solo/settings-business-context-contract";

describe("canonical externally emitted app destinations", () => {
  it.each([
    ["operator", "operator", null, "home", "/operator/fleet/systems-check"],
    ["account", "solo", "1971670", "home", "/solo/1971670/command-center/executive"],
    ["account", "sub_account", "1971671", "home", "/business/1971671/command-center/overview"],
    ["account", "agency", "1971672", "home", "/agency/1971672/command-center/overview"],
  ] as const)("maps %s/%s to its mounted home", (actor, tier, account, destination, expected) => {
    expect(resolveCanonicalAppPath({ actor, tier, account, destination })).toBe(expected);
  });

  it.each([
    ["solo", "/solo/1971670/settings/billing"],
    ["sub_account", "/business/1971670/billing/your-plan"],
    ["agency", "/agency/1971670/billing/your-plan"],
  ] as const)("maps %s billing only to a mounted action-parity surface", (tier, expected) => {
    expect(resolveCanonicalAppPath({
      actor: "account",
      tier,
      account: "1971670",
      destination: "billing",
    })).toBe(expected);
  });

  it("maps database account_type=standalone to the Solo tree", () => {
    expect(resolveCanonicalAppPath({
      actor: "account",
      tier: "standalone",
      account: 1971670,
      destination: "connections",
    })).toBe("/solo/1971670/settings/connections");
  });

  it("uses the mounted operator governance routes for operator alerts", () => {
    expect(resolveCanonicalAppPath({
      actor: "operator", tier: "operator", destination: "approvals",
    })).toBe("/operator/settings/governance/approvals");
    expect(resolveCanonicalAppPath({
      actor: "operator", tier: "operator", destination: "security",
    })).toBe("/operator/settings/governance/security");
  });

  it.each([
    { actor: "account", tier: "enterprise", account: "1971670", destination: "home" },
    { actor: "operator", tier: "operator", destination: "billing" },
    { actor: "account", tier: "agency", account: "1971670", destination: "security" },
    { actor: "account", tier: "solo", account: "1971670", destination: "approvals" },
    { actor: "operator", tier: "solo", account: "1971670", destination: "home" },
    { actor: "account", tier: "operator", account: "1971670", destination: "home" },
    { actor: "account", tier: "solo", account: "not/an/account", destination: "home" },
    { actor: "account", tier: "solo", account: null, destination: "home" },
  ] as const)("fails closed for unsupported or unsafe destination %#", (input) => {
    expect(resolveCanonicalAppPath(input)).toBeNull();
  });

  it("emits the canonical Paige Agent AI origin and never /admin", () => {
    const url = canonicalAppUrl({
      actor: "account",
      tier: "solo",
      account: 1971670,
      destination: "billing",
    });
    expect(url).toBe("https://paigeagent.ai/solo/1971670/settings/billing");
    expect(url).not.toContain("/admin");
  });
});

// Experience 04 E4-S3 — chat → record links. A REFERENCE (destination + optional record id) becomes
// an address only here, for the account the link is opened from; exact when the mounted surface
// reads a focus parameter for that record, surface-only otherwise, and null where nothing is mounted.
describe("resolveCanonicalRecordLink", () => {
  const UUID = "e4000000-0000-4000-8000-0000000c0001";
  const solo = { actor: "account", tier: "solo", account: "1971670" } as const;

  it("opens the exact client when the Clients surface reads ?person=", () => {
    expect(resolveCanonicalRecordLink({ ...solo, destination: "contacts", recordId: UUID }))
      .toEqual({ path: `/solo/1971670/clients/people?person=${UUID}`, status: "exact" });
  });
  it("opens only a UUID Play locator through the mounted owner Game Plan surface", () => {
    expect(resolveCanonicalRecordLink({ ...solo, destination: "business_game_plan", recordId: UUID }))
      .toEqual({ path: `/solo/1971670/command-center/business-game-plan?play=${UUID}`, status: "exact" });
    for (const recordId of ["../foreign", `${UUID}#x`, "", null]) {
      expect(resolveCanonicalRecordLink({ ...solo, destination: "business_game_plan", recordId }))
        .toEqual({ path: "/solo/1971670/command-center/business-game-plan", status: "surface_only" });
    }
    expect(resolveCanonicalRecordLink({ ...solo, tier: "sub_account", destination: "business_game_plan", recordId: UUID })).toBeNull();
  });

  it.each([
    ["sales_agreements", "/solo/1971670/sales/agreements"],
    ["sales_invoices", "/solo/1971670/sales/payments?view=invoices"],
    ["sales_collections", "/solo/1971670/sales/payments?view=collections"],
    ["operations_work", "/solo/1971670/operations/work"],
    ["business_time_zone", "/solo/1971670/settings/setup/business-profile#business-time-zone"],
  ] as const)("maps %s to its Solo surface, surface-only", (destination, path) => {
    expect(resolveCanonicalRecordLink({ ...solo, destination })).toEqual({ path, status: "surface_only" });
    // The invoice destination supports exact focus; other department destinations remain lists.
    expect(resolveCanonicalRecordLink({ ...solo, destination, recordId: UUID })).toEqual(destination === 'sales_invoices'
      ? { path: `${path}&invoice=${UUID}`, status: "exact" }
      : { path, status: "surface_only" });
  });

  it("never puts anything but a UUID into a focus parameter", () => {
    for (const recordId of ['x" onload="alert(1)', "../../admin", "", null, undefined, `${UUID}#x`]) {
      expect(resolveCanonicalRecordLink({ ...solo, destination: "contacts", recordId }))
        .toEqual({ path: "/solo/1971670/clients/people", status: "surface_only" });
    }
  });

  it("an exact pipeline link carries ?deal=; a surface-only time-zone link keeps its #fragment and no query", () => {
    expect(resolveCanonicalRecordLink({ ...solo, destination: "pipeline", recordId: UUID }))
      .toEqual({ path: `/solo/1971670/growth/pipeline?deal=${UUID}`, status: "exact" });
    const zone = resolveCanonicalRecordLink({ ...solo, destination: "business_time_zone" })!;
    expect(zone.path.indexOf("#")).toBeGreaterThan(zone.path.indexOf("business-profile"));
    expect(zone.path).not.toContain("?");
  });

  it("the focus inserter puts the query before a #fragment and joins an existing query with &", () => {
    expect(withQuery("/a?view=x#f", "k", "v")).toBe("/a?view=x&k=v#f");
    expect(withQuery("/a#f", "k", "v")).toBe("/a?k=v#f");
    expect(withQuery("/a?view=x", "k", "v")).toBe("/a?view=x&k=v");
    expect(withQuery("/a", "k", "a b")).toBe("/a?k=a%20b");
  });

  it("fails closed for a sub-account: the client list only, nothing else", () => {
    const sub = { actor: "account", tier: "sub_account", account: "1971670" } as const;
    expect(resolveCanonicalRecordLink({ ...sub, destination: "contacts", recordId: UUID }))
      .toEqual({ path: "/business/1971670/clients/people", status: "surface_only" });
    for (const destination of ["sales_agreements", "sales_invoices", "sales_collections", "operations_work", "business_time_zone"] as const) {
      expect(resolveCanonicalRecordLink({ ...sub, destination })).toBeNull();
    }
  });

  it("fails closed for enterprise, agency, operator and a bad account", () => {
    expect(resolveCanonicalRecordLink({ actor: "account", tier: "enterprise", account: "1971670", destination: "contacts", recordId: UUID })).toBeNull();
    expect(resolveCanonicalRecordLink({ actor: "account", tier: "agency", account: "1971670", destination: "sales_invoices" })).toBeNull();
    expect(resolveCanonicalRecordLink({ actor: "operator", tier: "operator", destination: "contacts", recordId: UUID })).toBeNull();
    expect(resolveCanonicalRecordLink({ ...solo, account: "not/an/account", destination: "contacts", recordId: UUID })).toBeNull();
  });

  it("every new Solo destination lands on a branch and subtab the Solo router mounts (§58)", () => {
    const branch = (slug: string) => SOLO_BRANCHES.find((b) => b.slug === slug);
    const hasSub = (b: string, s: string) => !!branch(b)?.subtabs?.some((t) => t.slug === s);
    expect(hasSub("sales", "agreements")).toBe(true);
    expect(hasSub("sales", "payments")).toBe(true);
    expect(hasSub("operations", "work")).toBe(true);
    expect(hasSub("clients", "people")).toBe(true);
    expect(SOLO_SETUP_TABS).toContain("business-profile");
  });

  it("leaves every existing destination and canonicalAppUrl unchanged", () => {
    expect(resolveCanonicalAppPath({ ...solo, destination: "contacts" })).toBe("/solo/1971670/clients/people");
    expect(canonicalAppUrl({ ...solo, destination: "sales_invoices" })).toBe("https://paigeagent.ai/solo/1971670/sales/payments?view=invoices");
  });
});
