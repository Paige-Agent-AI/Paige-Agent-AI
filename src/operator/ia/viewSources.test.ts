/**
 * The drop-nothing guarantee, enforced rather than asserted.
 *
 * The thirteen-branch console's interface is gone; its features are supposed to have been placed,
 * not lost. Prose saying so is worth nothing — the failure mode is a capability quietly having no
 * home, which looks exactly like a capability nobody has got to yet. So this walks the SHIPPED
 * branch registry and fails if any leaf is neither carried by a view nor explicitly retired.
 *
 * It reads OPERATOR_BRANCHES rather than a copy of it, so adding a branch there without placing it
 * breaks this test — which is the point. A list restated here could drift from the tree it claims
 * to cover, and would then prove only that it agrees with itself.
 */
import { describe, expect, it } from "vitest";
import { OPERATOR_BRANCHES } from "@/lib/routing/tierBranches";
import { OPERATOR_SLOTS, viewSlug } from "@/operator/ia/operatorIA";
import { RETIRED_ADDRESSES, VIEW_SOURCES, viewSource } from "@/operator/ia/viewSources";
import { canonicalPath, resolveOperatorAddress } from "@/operator/shell/operatorAddress";

/** Every addressable leaf in the shipped tree, as `branch/leaf` or `settings/group/leaf`. */
function shippedLeaves(): string[] {
  const out: string[] = [];
  for (const branch of OPERATOR_BRANCHES) {
    for (const sub of branch.subtabs ?? []) {
      const nested = (sub as { subtabs?: { slug: string }[] }).subtabs;
      if (nested?.length) for (const leaf of nested) out.push(`${branch.slug}/${sub.slug}/${leaf.slug}`);
      else out.push(`${branch.slug}/${sub.slug}`);
    }
  }
  return out;
}

describe("viewSources — every shipped operator feature has a home", () => {
  it("keeps Intelligence exclusively in Settings and removes the duplicate Fleet area", () => {
    expect(Object.entries(VIEW_SOURCES).filter(([, source]) => source.bespoke === "IntelligenceSurface").map(([address]) => address))
      .toEqual(["settings/paige-intelligence"]);
    expect(OPERATOR_SLOTS.find(s => s.id === "fleet")?.views).toEqual(["Systems check", "Directory", "History", "Mind"]);
    expect(canonicalPath(resolveOperatorAddress("fleet", ""))).toBe("/operator/fleet/systems-check");
    expect(canonicalPath(resolveOperatorAddress("fleet", "overview"))).toBe("/operator/settings/paige-intelligence");
    expect(canonicalPath(resolveOperatorAddress("fleet", "mind"))).toBe("/operator/fleet/mind");
  });
  it("covers every leaf of the shipped branch tree", () => {
    const carried = new Set(Object.values(VIEW_SOURCES).flatMap((s) => s.carries));
    const homeless = shippedLeaves().filter(
      (leaf) => !carried.has(leaf) && !(leaf in RETIRED_ADDRESSES),
    );
    expect(homeless, `these shipped addresses have no view and no retirement reason: ${homeless.join(", ")}`)
      .toEqual([]);
  });

  it("carries no address the shipped tree does not have", () => {
    const shipped = new Set(shippedLeaves());
    const invented = [...new Set(Object.values(VIEW_SOURCES).flatMap((s) => s.carries))]
      .filter((a) => !shipped.has(a));
    expect(invented, `carried addresses that do not exist: ${invented.join(", ")}`).toEqual([]);
  });

  it("keys every entry to a real slot and a real view", () => {
    const real = new Set(
      OPERATOR_SLOTS.flatMap((s) => s.views.map((v) => `${s.id}/${viewSlug(v)}`)),
    );
    const bogus = Object.keys(VIEW_SOURCES).filter((k) => !real.has(k));
    expect(bogus, `entries keyed to no view in the IA: ${bogus.join(", ")}`).toEqual([]);
  });

  it("gives every one of the IA's views an entry — absence is declared, never implied", () => {
    const missing: string[] = [];
    for (const slot of OPERATOR_SLOTS) {
      for (const view of slot.views) {
        if (!viewSource(slot.id, viewSlug(view))) missing.push(`${slot.id}/${viewSlug(view)}`);
      }
    }
    expect(missing, `views with no entry at all: ${missing.join(", ")}`).toEqual([]);
  });

  it("retires nothing that a view also carries — a thing is placed or retired, never both", () => {
    const carried = new Set(Object.values(VIEW_SOURCES).flatMap((s) => s.carries));
    const both = Object.keys(RETIRED_ADDRESSES).filter((a) => carried.has(a));
    expect(both, `both carried and retired: ${both.join(", ")}`).toEqual([]);
  });
});
