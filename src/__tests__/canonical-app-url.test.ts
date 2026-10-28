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
  it("focuses only a valid Systems Check UUID on its existing SOLO destination", () => {
    const input = { actor: "account", tier: "solo", account: "1971670", destination: "systems_check" } as const;
    const id = "e2000000-0000-4000-8000-000000000001";
    expect(resolveCanonicalRecordLink({ ...input, recordId: id })).toEqual({
      path: `/solo/1971670/command-center/systems-check?finding=${id}`, status: "exact",
    });
    expect(resolveCanonicalRecordLink({ ...input, recordId: "../foreign" })?.status).toBe("surface_only");
    for (const tier of ["sub_account", "agency", "enterprise", "operator"] as const) {
      expect(resolveCanonicalRecordLink({ ...input, tier, recordId: id })).toBeNull();
    }
  });
  it('uses the existing Portal for owner Knowledge references and refuses unmounted tiers',()=>{
    const input={actor:'account',tier:'solo',account:'1234567',destination:'portal_knowledge'} as const,id='b3b60300-0000-4000-8000-000000000001';
    expect(resolveCanonicalRecordLink({...input,recordId:id})).toEqual({path:'/solo/1234567/clients/portal?view=knowledge&source='+id,status:'exact'});
    expect(resolveCanonicalRecordLink({...input,recordId:'not-an-id'})).toEqual({path:'/solo/1234567/clients/portal?view=knowledge',status:'surface_only'});
    for(const tier of ['sub_account','agency','enterprise','operator'] as const)expect(resolveCanonicalAppPath({...input,tier})).toBeNull();
  });
  it.each(["solo", "standalone"] as const)("routes %s Marketing to its existing native Overview without invented record focus", tier => {
    const input = { actor: "account" as const, tier, account: "1971670", destination: "marketing" as const };
    const path = "/solo/1971670/growth/overview";
    expect(resolveCanonicalAppPath(input)).toBe(path);
    expect(resolveCanonicalRecordLink({ ...input, recordId: "00000000-0000-4000-8000-000000000001" }))
      .toEqual({ path, status: "surface_only" });
    const mounted = SOLO_BRANCHES.find(branch => branch.slug === "growth");
    expect(mounted?.subtabs.some(tab => tab.slug === "overview" && !tab.hidden)).toBe(true);
  });
  it.each([
    { actor: "operator", tier: "operator", account: null },
    { actor: "operator", tier: "solo", account: "1971670" },
    { actor: "account", tier: "sub_account", account: "1971670" },
    { actor: "account", tier: "agency", account: "1971670" },
    { actor: "account", tier: "enterprise", account: "1971670" },
    { actor: "account", tier: "solo", account: null },
    { actor: "account", tier: "solo", account: "1971670/../../other" },
  ] as const)("withholds the Marketing destination for unsupported identity %#", input => {
    expect(resolveCanonicalAppPath({ ...input, destination: "marketing" })).toBeNull();
  });

  it.each([
    ["account", "solo", "101", "/solo/101/operations/work"],
    ["account", "standalone", "202", "/solo/202/operations/work"],
    ["account", "sub_account", "303", "/business/303/calendar/tasks"],
    ["account", "agency", "404", "/agency/404/calendar/tasks"],
    ["operator", "operator", null, "/operator/calendar/tasks"],
  ] as const)("keeps task destinations on the native %s/%s owner", (actor, tier, account, path) => {
    expect(resolveCanonicalAppPath({ actor, tier, account, destination: "tasks" })).toBe(path);
    expect(resolveCanonicalRecordLink({ actor, tier, account, destination: "tasks", recordId: "00000000-0000-4000-8000-000000000001" }))
      .toEqual(tier === "solo" || tier === "standalone"
        ? { path: `${path}?task=00000000-0000-4000-8000-000000000001`, status: "exact" }
        : { path, status: "surface_only" });
  });

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
    ["conversations", "/solo/1971670/clients/conversations"],
  ] as const)("maps %s to its mounted Solo surface with only supported focus", (destination, path) => {
    expect(resolveCanonicalRecordLink({ ...solo, destination })).toEqual({ path, status: "surface_only" });
    // Only the mounted agreement, invoice and Task consumers support exact UUID focus.
    expect(resolveCanonicalRecordLink({ ...solo, destination, recordId: UUID })).toEqual(destination === 'sales_invoices'
      ? { path: `${path}&invoice=${UUID}`, status: "exact" }
      : destination === 'sales_agreements' ? { path: `${path}?agreement=${UUID}`, status: "exact" }
      : destination === 'operations_work' ? { path: `${path}?task=${UUID}`, status: "exact" }
      : { path, status: "surface_only" });
  });

  it("never puts anything but a UUID into a focus parameter", () => {
    for (const recordId of ['x" onload="alert(1)', "../../admin", "", null, undefined, `${UUID}#x`]) {
      expect(resolveCanonicalRecordLink({ ...solo, destination: "contacts", recordId }))
        .toEqual({ path: "/solo/1971670/clients/people", status: "surface_only" });
    }
  });

  it("never mints a Conversations address outside the mounted SOLO owner surface", () => {
    for (const tier of ["sub_account", "agency", "enterprise"] as const) {
      expect(resolveCanonicalRecordLink({ ...solo, tier, destination: "conversations", recordId: UUID })).toBeNull();
    }
    expect(resolveCanonicalRecordLink({ actor: "operator", tier: "operator", destination: "conversations", recordId: UUID })).toBeNull();
    expect(resolveCanonicalRecordLink({ ...solo, actor: "operator", destination: "conversations" })).toBeNull();
    for (const account of [null, "", "../1", "https://foreign.invalid"]) {
      expect(resolveCanonicalRecordLink({ ...solo, account, destination: "conversations" })).toBeNull();
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
    for (const destination of ["sales_agreements", "sales_invoices", "sales_collections", "operations_work", "business_time_zone", "conversations"] as const) {
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
    expect(hasSub("clients", "conversations")).toBe(true);
    expect(SOLO_SETUP_TABS).toContain("business-profile");
  });

  it("leaves every existing destination and canonicalAppUrl unchanged", () => {
    expect(resolveCanonicalAppPath({ ...solo, destination: "contacts" })).toBe("/solo/1971670/clients/people");
    expect(canonicalAppUrl({ ...solo, destination: "sales_invoices" })).toBe("https://paigeagent.ai/solo/1971670/sales/payments?view=invoices");
  });
});
