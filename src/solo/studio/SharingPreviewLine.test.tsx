// The sharing preview line (PR8, row 12 / WEB-12) as the owner meets it in the publish panel:
// before a page goes live, the panel shows exactly what search and share will show — title and
// description, or the honest fact that no description is set. Reading only; never an editor.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { SharingPreviewLine } from "./PublishPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });
const mount = (props: { title: string; draftSeo: { description?: string; og_image?: string } | null }) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<SharingPreviewLine {...props} />); });
};

describe("SharingPreviewLine", () => {
  it("shows the title and the description that will go live", () => {
    mount({ title: "Referral Workshop", draftSeo: { description: "Ninety minutes to a Monday-ready referral plan." } });
    expect(host.textContent).toContain("What search and share will show:");
    expect(host.textContent).toContain("Referral Workshop");
    expect(host.textContent).toContain("Ninety minutes to a Monday-ready referral plan.");
    // The client-rendering boundary is ON the card (review finding), not hidden in docs.
    expect(host.textContent).toContain("Applied when the page loads in a browser");
    expect(host.textContent).toContain("may show the platform's own details");
  });

  it("no description set: says so honestly and points at Paige — never invents one", () => {
    mount({ title: "Referral Workshop", draftSeo: null });
    expect(host.textContent).toContain("Referral Workshop");
    expect(host.textContent).toContain("No description is set");
    expect(host.textContent).toContain("Ask Paige to add a one-line description.");
    expect(host.textContent).toContain("Applied when the page loads in a browser");
    // And nothing pretends a ranking or a guaranteed link preview exists.
    expect(host.textContent).not.toMatch(/rank|first on google|top of search/i);
  });

  it("an empty-string description is the honest missing state, not a blank quote", () => {
    mount({ title: "T", draftSeo: { description: "" } });
    expect(host.textContent).toContain("No description is set");
    expect(host.textContent).not.toContain("— “”");
  });
});

describe("SharingPreviewLine mounting (static)", () => {
  it("the panel mounts it in the pre-publish view for ready pages, fed by the door's title", () => {
    const src = readFileSync("src/solo/studio/PublishPanel.tsx", "utf8");
    expect(src).toContain('<SharingPreviewLine title={pub.preview.title} draftSeo={artifact.page.draftSeo} />');
    // Reading only: the panel gains no SEO write path of any kind.
    expect(src).not.toMatch(/draft_seo_json|seo_json|update.*seo|p_seo/i);
  });
});
