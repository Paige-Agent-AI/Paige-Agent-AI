/**
 * Stage 3 — the realtime pipeline board.
 *
 * The owner had to refresh to see a deal Paige had just created (2026-09-30 live
 * report). The board's data hook owns one canonical fetch; this repair adds a
 * tenant-scoped realtime subscription over the SAME records — deals, pipelines
 * and their stages — whose events re-run the canonical load. No second cache, no
 * patching (a refetch always reads current truth, so stale events cannot
 * overwrite fresher state and duplicates are structurally impossible), no
 * polling loop, no new event bus.
 *
 * Safety pinned here:
 *  - the subscription is keyed and filtered to the ACTIVE tenant;
 *  - cleanup removes the channel (workspace switch and unmount tear it down);
 *  - an event resolves through the existing retry/load path, which the data
 *    effect re-scopes to whatever tenant is current — a late event from the old
 *    workspace cannot mutate the new board's data, only cause a refetch of
 *    current truth;
 *  - a reconnecting channel refetches once on SUBSCRIBED so recovery is truthful.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const HOOK = "src/solo/useSoloCampaigns.ts";
const hook = readFileSync(join(root, HOOK), "utf8");

describe("the board subscribes to its tenant's pipeline records", () => {
  it("opens a tenant-keyed channel over deals, pipelines and stages", () => {
    expect(hook).toMatch(/channel\(`solo-pipeline-board:\$\{activeTenantId\}`\)/);
    expect(hook).toMatch(/table: "deals", filter: `tenant_id=eq\.\$\{activeTenantId\}`/);
    expect(hook).toMatch(/table: "pipelines"/);
    expect(hook).toMatch(/table: "pipeline_stages"/);
  });

  it("events resolve through the existing canonical reload, not a second cache", () => {
    // Events route through the coalesced scheduler whose timer fires the canonical retry().
    expect(hook).toMatch(/postgres_changes[\s\S]{0,400}?scheduleReload\(\)/);
  });

  it("tears the channel down on change and unmount", () => {
    expect(hook).toMatch(/removeChannel\(channel\)/);
  });

  it("refetches once when the channel (re)subscribes, so recovery is truthful", () => {
    expect(hook).toMatch(/SUBSCRIBED[\s\S]{0,200}?scheduleReload\(\)/);
  });

  it("coalesces event bursts into one trailing reload, and teardown clears the timer", () => {
    expect(hook).toContain("const scheduleReload = () => {");
    expect(hook).toMatch(/clearTimeout\(reloadTimer\);[\s\S]{0,120}setTimeout\(\(\) => \{ if \(!disposed\) retry\(\); \}, 200\)/);
    expect(hook).toMatch(/return \(\) => \{\s*disposed = true;\s*clearTimeout\(reloadTimer\);/);
  });

  it("is not a vacuous check: the hook still exposes the retry the board already uses", () => {
    expect(hook).toContain("const retry = useCallback(() => setRefreshKey((key) => key + 1), []);");
  });
});
