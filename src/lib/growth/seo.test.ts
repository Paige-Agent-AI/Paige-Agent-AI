import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { applyPublishedSeo, MANAGED_SEO_TAGS } from "./seo";

/** A fresh document per test, with a couple of pre-existing foreign metas to prove isolation. */
const freshDoc = () => {
  const doc = document.implementation.createHTMLDocument("Paige");
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const foreign = doc.createElement("meta");
  foreign.setAttribute("name", "viewport");
  foreign.setAttribute("content", "width=device-width");
  doc.head.append(charset, foreign);
  return doc;
};

describe("applyPublishedSeo — the published truth reaches the head, honestly", () => {
  it("title, description, og image and url become the document's sharing truth", () => {
    const doc = freshDoc();
    const applied = applyPublishedSeo(doc, {
      title: "Turn clients into referrals",
      description: "A ninety-minute workshop that leaves you with a referral plan.",
      ogImage: "https://media.example.com/og/workshop.png",
      canonicalUrl: "https://acme-coaching.paigeagent.ai/p/acme-coaching/workshop",
    });
    expect(applied.title).toBe("Turn clients into referrals");
    expect(doc.title).toBe("Turn clients into referrals");
    expect(doc.head.querySelector('meta[name="description"]')?.getAttribute("content"))
      .toBe("A ninety-minute workshop that leaves you with a referral plan.");
    expect(doc.head.querySelector('meta[property="og:image"]')?.getAttribute("content"))
      .toBe("https://media.example.com/og/workshop.png");
    expect(doc.head.querySelector('meta[property="og:url"]')?.getAttribute("content"))
      .toBe("https://acme-coaching.paigeagent.ai/p/acme-coaching/workshop");
    expect(doc.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
  });

  it("no description and no image = no description tag and no card claim — absent beats stale", () => {
    const doc = freshDoc();
    const stale = doc.createElement("meta");
    stale.setAttribute("name", "description");
    stale.setAttribute("content", "an old lie");
    doc.head.append(stale);
    applyPublishedSeo(doc, { title: "Page", description: null, ogImage: null, canonicalUrl: null });
    expect(doc.head.querySelector('meta[name="description"]')).toBeNull();
    expect(doc.head.querySelector('meta[property="og:image"]')).toBeNull();
    expect(doc.head.querySelector('meta[name="twitter:card"]')).toBeNull();
  });

  it("a null title keeps the app default — the tab is never blanked", () => {
    const doc = freshDoc();
    applyPublishedSeo(doc, { title: null, description: "d", ogImage: null, canonicalUrl: null });
    expect(doc.title).toBe("Paige");
  });

  it("only https images ship; http, relative, and javascript-shaped values are dropped", () => {
    const doc = freshDoc();
    for (const bad of ["http://media.example.com/og.png", "/media/og.png", "javascript:alert(1)", "data:text/html,hi", 42, ""]) {
      const applied = applyPublishedSeo(freshDoc(), { title: "t", description: null, ogImage: bad as string | null, canonicalUrl: null });
      expect(applied.ogImage, JSON.stringify(bad)).toBeNull();
    }
    expect(doc).toBeTruthy();
  });

  it("whitespace-only and non-string descriptions are dropped, not guessed", () => {
    const applied = applyPublishedSeo(freshDoc(), { title: "t", description: "   " as string | null, ogImage: null, canonicalUrl: null });
    expect(applied.description).toBeNull();
    const applied2 = applyPublishedSeo(freshDoc(), { title: "t", description: undefined as unknown as string, ogImage: null, canonicalUrl: null });
    expect(applied2.description).toBeNull();
  });

  it("oversized values are elided to the cap, never truncated mid-blindness", () => {
    const long = "x".repeat(500);
    const applied = applyPublishedSeo(freshDoc(), { title: long, description: long, ogImage: null, canonicalUrl: null });
    expect(applied.title!.length).toBeLessThanOrEqual(300);
    expect(applied.description!.length).toBeLessThanOrEqual(400);
    expect(applied.description!.endsWith("…")).toBe(true);
  });

  it("SECURITY (row 13): hostile values land as inert attribute text — never markup, never scripts", () => {
    const doc = freshDoc();
    const hostile = `"><script>window.pwned=1</script><img src=x onerror="window.pwned=1">`;
    applyPublishedSeo(doc, { title: "t", description: hostile, ogImage: null, canonicalUrl: null });
    expect(doc.head.querySelector("script")).toBeNull();
    expect(doc.querySelector("img")).toBeNull();
    const meta = doc.head.querySelector('meta[name="description"]')!;
    // The content is stored as an attribute VALUE — reading it back yields the same inert string.
    expect(meta.getAttribute("content")).toBe(hostile);
    expect((window as typeof window & { pwned?: unknown }).pwned).toBeUndefined();
  });

  it("only the managed tags are touched — the document's other metas survive untouched", () => {
    const doc = freshDoc();
    applyPublishedSeo(doc, { title: "t", description: "d", ogImage: "https://x.example/i.png", canonicalUrl: "https://x.example/p" });
    expect(doc.head.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe("width=device-width");
    expect(doc.head.querySelector("meta[charset]")).not.toBeNull();
    const managed = [...doc.head.querySelectorAll("meta")].filter((m) =>
      MANAGED_SEO_TAGS.some(({ attr, key }) => m.getAttribute(attr) === key));
    // description + og:title + og:description + og:image + og:url + twitter:card (image set → large)
    expect(managed).toHaveLength(6);
  });
});

describe("seo module purity — head truth only, never a fetcher or tracker", () => {
  it("the module contains no network, storage, or analytics surface", () => {
    const src = readFileSync("src/lib/growth/seo.ts", "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|supabase|localStorage|sendBeacon|gtag|analytics/i);
  });

  it("no ranking or placement claim is made anywhere in the module", () => {
    const src = readFileSync("src/lib/growth/seo.ts", "utf8");
    expect(src).not.toMatch(/rank(ing)?\s+(#|position|guarantee)|first on google|top of search/i);
  });
});
