import { describe, expect, it } from "vitest";

import { pageFromRow } from "./studio-data";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";

// The export card's source of truth: `published` must come from the row's LIVE columns and only
// for a status="published" row. If a regression ever pointed it at draft columns, the Studio would
// hand the export builder draft content while every other test stayed green — this is that guard.
describe("pageFromRow published columns", () => {
  const publishedBlocks: GrowthBlock[] = [{ type: "hero", title: "Published hero" }];
  const draftBlocks: GrowthBlock[] = [{ type: "hero", title: "Draft hero" }];
  const theme: GrowthPageTheme = { primary: "#1d3a2a", accent: "#e8b84c" };

  it("is null unless the row is status=published (an unpublished page never offers an export)", () => {
    const r = pageFromRow({
      id: "p1", title: "Workshop", slug: "workshop", status: "draft",
      blocks_json: publishedBlocks, theme_json: theme, seo_json: { description: "d" }, published_at: "2026-10-01",
    });
    expect(r.published).toBeNull();
  });

  it("carries blocks_json (NEVER draft_blocks_json) even when drafts differ", () => {
    const r = pageFromRow({
      id: "p1", title: "Workshop", slug: "workshop", status: "published",
      blocks_json: publishedBlocks, draft_blocks_json: draftBlocks,
      theme_json: theme, draft_theme_json: null, seo_json: { description: "live desc" },
      published_at: "2026-10-01",
    });
    expect(r.published).not.toBeNull();
    expect(r.published!.blocks).toEqual(publishedBlocks);
    expect(JSON.stringify(r.published!.blocks)).not.toContain("Draft hero");
    expect(r.published!.theme).toEqual(theme);
    expect(r.published!.seo).toEqual({ description: "live desc" });
    expect(r.published!.publishedAt).toBe("2026-10-01");
    // The editor's own view stays draft-preferred — the affordance must not change the Studio.
    expect(r.blocks).toEqual(draftBlocks);
    expect(r.changesPending).toBe(true);
  });

  it("treats non-array blocks_json as no published face rather than guessing", () => {
    const r = pageFromRow({
      id: "p1", title: "Workshop", slug: "workshop", status: "published",
      blocks_json: null, published_at: null,
    });
    expect(r.published).toBeNull();
  });
});
