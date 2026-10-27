// The portable export affordance (WEB-04) as the owner meets it: a card in the publish panel
// that exists ONLY for a live page with published columns, downloads a static copy of the
// PUBLISHED version, and never pretends to deploy anything. Same render posture as the studio's
// other behavioural tests (createRoot + act; not authenticated runtime).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PortableExportCard } from "./PublishPanel";
import type { LoadedArtifact } from "./artifact-state";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function livePage(over: Record<string, unknown> = {}): Extract<LoadedArtifact, { kind: "page" }> {
  return {
    kind: "page",
    page: {
      id: "p-1", title: "Referral Workshop", slug: "workshop", live: true, changesPending: false,
      blocks: [{ type: "hero", title: "Draft hero" }],
      theme: null,
      draftSeo: null,
      published: {
        blocks: [{ type: "hero", title: "Published hero" }],
        theme: null, seo: null, publishedAt: "2026-10-01T12:00:00Z",
      },
      ...over,
    },
  };
}

let host: HTMLDivElement;
let root: Root | null = null;
let lastBlob: Blob | null = null;
const clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  host = document.createElement("div");
  lastBlob = null;
  clicked.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: (b: Blob) => { lastBlob = b; return "blob:export"; },
    revokeObjectURL: () => undefined,
  }));
  // jsdom anchors don't navigate; capture the click's intent instead.
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this); };
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function mount(artifact: Extract<LoadedArtifact, { kind: "page" }>) {
  root = createRoot(host);
  act(() => {
    root!.render(
      <PortableExportCard artifact={artifact} tenantSlug="acme" tenantName="ACME" brandFloor={buildGrowthBrandFloor(null)} onError={() => {}} />,
    );
  });
}

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe("PortableExportCard — the affordance", () => {
  it("says what it is: a download of the published version, not a deployment", () => {
    mount(livePage());
    expect(host.textContent).toContain("Portable export");
    expect(host.textContent).toContain("A download, not a deployment");
    expect(host.textContent).toContain("no scripts ship");
  });

  it("downloads the built HTML under the versioned name, carrying the published hero", async () => {
    mount(livePage());
    act(() => { button("Download HTML")!.click(); });
    expect(lastBlob).toBeTruthy();
    expect(clicked.at(-1)?.download).toBe("acme-workshop-2026-10-01.html");
    const html = await (lastBlob as Blob).text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // The card carried the PUBLISHED hero, never the draft one on the same page.
    expect(html).toContain("Published hero");
    expect(html).not.toContain("Draft hero");
  });

  it("downloads the manifest beside it", async () => {
    mount(livePage());
    act(() => { button("manifest.json")!.click(); });
    expect(lastBlob).toBeTruthy();
    expect(clicked.at(-1)?.download).toBe("acme-workshop-2026-10-01-manifest.json");
    const manifest = JSON.parse(await (lastBlob as Blob).text());
    expect(manifest.format).toBe("paige-portable-export/1");
    expect(manifest.page.slug).toBe("workshop");
  });
});

describe("static: the export is a download surface, never a second publish path", () => {
  const source = readFileSync("src/solo/studio/PublishPanel.tsx", "utf8");

  it("the card renders only for a live page with published columns, in both panel views", () => {
    expect(source.match(/artifact\.kind === "page" && artifact\.page\.published && tenantSlug && brandFloor/g)?.length).toBe(2);
  });

  it("the panel still names no publish or unpublish RPC — the export adds no authority", () => {
    expect(source).not.toMatch(/growth_page_publish|growth_page_unpublish/);
    expect(source).toContain("buildPortableExport");
  });
});
