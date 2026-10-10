import { describe, expect, it } from "vitest";
import { SETTINGS_MENU } from "./settingsIA";
import { findSlot, viewSlug } from "./operatorIA";
import { canonicalPath, resolveOperatorAddress, viewPath } from "@/operator/shell/operatorAddress";
describe("owner-approved Operator Settings categories", () => {
  it("retains every Settings capability exactly once in the grouped navigation", () => {
    const leaves = SETTINGS_MENU.flatMap((g) => [...g.views]);
    expect(new Set(leaves).size).toBe(leaves.length);
    expect([...leaves].sort()).toEqual([...findSlot("settings")!.views].sort());
    expect(SETTINGS_MENU.map((g) => g.label)).toEqual(["Setup", "Team", "Connections", "Integrations", "Analytics", "Security & data", "Vault", "Billing", "PAIGE Intelligence"]);
  });
  it("resolves every old bookmark to the same capability under its category", () => {
    for (const leaf of findSlot("settings")!.views) {
      const old = resolveOperatorAddress("settings", viewSlug(leaf));
      expect(old.kind === "resolved" && old.view).toBe(leaf);
      const path = canonicalPath(old);
      expect(path).toBe(viewPath("settings", leaf));
      const fresh = resolveOperatorAddress("settings", path.slice("/operator/settings/".length));
      expect(fresh.kind === "resolved" && fresh.view).toBe(leaf);
      expect(fresh.kind === "resolved" && fresh.stale).toBe(false);
    }
  });
  it("normalizes unknown category tabs without inventing new destinations", () => {
    const bad = resolveOperatorAddress("settings", "connections/unknown");
    expect(canonicalPath(bad)).toBe("/operator/settings/connections");
    expect(bad.kind === "resolved" && bad.stale).toBe(true);
    expect(resolveOperatorAddress("seventh-slot", "settings").kind).toBe("unknown");
  });
});
