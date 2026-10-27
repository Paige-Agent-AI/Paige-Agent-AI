// The portable export's contract (EXP06 WEB-04, matrix row 10), written before the builder:
// the export is a REAL static artifact of the PUBLISHED page — lineage + asset provenance
// carried, private data/secrets/unsafe execution impossible, and honesty preserved for every
// block that cannot fully live in a static file (forms, chatbot, countdown, live-only scenes).
import { describe, expect, it } from "vitest";
import {
  buildPortableExport,
  PortableExportRefused,
  type PortablePageSource,
} from "./exportPortable";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import type { GrowthBlock } from "../growth";

const ORIGIN = "https://paigeagent.ai";
const EXPORTED_AT = "2026-10-26T00:00:00Z";

function page(over: Partial<PortablePageSource> = {}): PortablePageSource {
  return {
    status: "published",
    tenantSlug: "acme-coaching",
    tenantName: "ACME Coaching",
    pageId: "p-1",
    pageSlug: "workshop",
    pageTitle: "Referral Workshop",
    publishedAt: "2026-10-01T12:00:00Z",
    blocks: [],
    theme: null,
    seo: { description: "One honest line about the workshop." },
    brandFloor: buildGrowthBrandFloor({ logo_url: "https://cdn.example.com/logo.png" }),
    ...over,
  };
}

function exportHtml(blocks: GrowthBlock[], over: Partial<PortablePageSource> = {}) {
  const r = buildPortableExport(page({ blocks, ...over }), { origin: ORIGIN, exportedAt: EXPORTED_AT });
  return r;
}

describe("buildPortableExport — the published artifact only", () => {
  it("builds a complete static document from the published columns", () => {
    const r = exportHtml([
      { type: "hero", title: "We & you", subtitle: "Turn <clients> into referrers", cta_label: "Save a seat", cta_href: "/p/acme-coaching/signup" },
    ]);
    expect(r.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(r.html).toContain("<title>Referral Workshop</title>");
    expect(r.html).toContain('name="description" content="One honest line about the workshop."');
    // The same token seam the live page resolves — the export's :root carries the resolved --gp-* set.
    expect(r.html).toContain("--gp-primary:");
    // Text is escaped; nothing tenant-authored reaches the document as markup.
    expect(r.html).toContain("We &amp; you");
    expect(r.html).toContain("Turn &lt;clients&gt; into referrers");
  });

  it("refuses anything but a published page", () => {
    expect(() =>
      buildPortableExport(page({ status: "draft" } as Partial<PortablePageSource> & { status: string }), { origin: ORIGIN, exportedAt: EXPORTED_AT }),
    ).toThrow(PortableExportRefused);
  });

  it("carries lineage and asset provenance in the manifest", () => {
    const r = exportHtml([
      { type: "hero", title: "T", image_url: "https://cdn.example.com/hero.jpg" },
      { type: "media", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ]);
    expect(r.manifest.format).toBe("paige-portable-export/1");
    expect(r.manifest.tenant).toEqual({ slug: "acme-coaching", name: "ACME Coaching" });
    expect(r.manifest.page).toMatchObject({ id: "p-1", slug: "workshop", title: "Referral Workshop", publishedAt: "2026-10-01T12:00:00Z" });
    expect(r.manifest.source).toContain("blocks_json");
    expect(r.manifest.distinctFromDeployment).toBe(true);
    const urls = r.manifest.assets.map((a) => a.url);
    expect(urls).toContain("https://cdn.example.com/logo.png");
    expect(urls).toContain("https://cdn.example.com/hero.jpg");
    expect(urls).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    const logo = r.manifest.assets.find((a) => a.url.includes("logo.png"));
    expect(logo?.origin).toBe("brand-floor");
    const hero = r.manifest.assets.find((a) => a.url.includes("hero.jpg"));
    expect(hero?.origin).toBe("block");
  });

  it("names the file after tenant, page, and published date", () => {
    const r = exportHtml([]);
    expect(r.fileName).toBe("acme-coaching-workshop-2026-10-01.html");
  });
});

describe("buildPortableExport — nothing unsafe ships", () => {
  it("contains no script element, no inline handler, and no javascript: URL", () => {
    const r = exportHtml([
      { type: "cta", title: "Go", cta_label: "Click", cta_href: "javascript:alert(1)" },
      { type: "hero", title: "H", cta_label: "X", cta_href: "data:text/html,<script>alert(1)</script>" },
    ]);
    expect(r.html.toLowerCase()).not.toContain("<script");
    expect(r.html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(r.html.toLowerCase()).not.toContain("javascript:");
    // The buttons still say their labels — dropping the unsafe target never drops the copy.
    expect(r.html).toContain("Click");
    expect(r.html).toContain("X");
  });

  it("sanitizes rich_text with the app's exact posture", () => {
    const r = exportHtml([
      { type: "rich_text", html: `<p onclick="steal()">Real <b>copy</b></p><script>alert(1)</script><iframe src="https://evil.example"></iframe><style>body{}</style>` },
    ]);
    expect(r.html).toContain("Real <b>copy</b>");
    expect(r.html.toLowerCase()).not.toContain("<script");
    expect(r.html.toLowerCase()).not.toContain("<iframe");
    // The ONE <style> allowed is the export's own head stylesheet — the tenant's <style> payload is gone.
    expect(r.html.toLowerCase().match(/<style/g)?.length).toBe(1);
    expect(r.html).not.toContain("body{}");
    expect(r.html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe("buildPortableExport — block honesty in a static file", () => {
  it("renders provider media through the same allowlist as the live page", () => {
    const ok = exportHtml([{ type: "media", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Replay" }]);
    expect(ok.html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(ok.html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');

    const broken = exportHtml([{ type: "media", provider: "youtube", url: "https://example.com/not-a-video", title: "Replay" }]);
    expect(broken.html).toContain("This video isn’t available right now.");
    expect(broken.html).not.toContain("<iframe");

    const mp4 = exportHtml([{ type: "media", provider: "mp4", url: "https://cdn.example.com/talk.mp4" }]);
    expect(mp4.html).toContain("<video");
    expect(mp4.html).toContain("controls");
    // No autoplay ATTRIBUTE on any media element — the `allow` list is the provider permission
    // set the live iframe already carries (accelerometer; autoplay; …), promising nothing itself.
    for (const r of [ok, broken, mp4]) {
      expect(r.html).not.toMatch(/<(video|iframe)\b[^>]*\sautoplay(?=[\s/>=]|$)/i);
    }
  });

  it("absolutizes internal links to the platform origin", () => {
    const r = exportHtml([
      { type: "hero", title: "T", cta_label: "Sign up", cta_href: "/p/acme-coaching/signup" },
    ]);
    expect(r.html).toContain(`href="${ORIGIN}/p/acme-coaching/signup"`);
  });

  it("an embedded form links to the live page instead of fabricating intake", () => {
    const r = exportHtml([{ type: "embedded_form", form_slug: "signup", title: "Save your seat" }]);
    expect(r.html.toLowerCase()).not.toContain("<form");
    expect(r.html).toContain("Save your seat");
    expect(r.html).toContain(`${ORIGIN}/p/acme-coaching/workshop`);
    expect(r.manifest.notes.some((n) => n.includes("signup"))).toBe(true);
  });

  it("a chatbot block says the conversation lives on the live page", () => {
    const r = exportHtml([{ type: "chatbot", title: "Ask us anything" }]);
    expect(r.html).toContain("Ask us anything");
    expect(r.html).toContain(`${ORIGIN}/p/acme-coaching/workshop`);
    expect(r.html.toLowerCase()).not.toContain("<input");
  });

  it("a countdown renders its date statically and says so in the manifest", () => {
    const r = exportHtml([{ type: "countdown", title: "Doors close", ends_at: "2026-11-01T17:00:00Z" }]);
    expect(r.html).toContain("2026");
    expect(r.html.toLowerCase()).not.toContain("<script");
    expect(r.manifest.notes.some((n) => n.toLowerCase().includes("countdown"))).toBe(true);
  });

  it("mirrors the live page's section band rhythm", () => {
    const r = exportHtml([
      { type: "hero", title: "H" },
      { type: "feature_grid", items: [{ title: "A", body: "B" }] },
      { type: "stats", items: [{ value: "10", label: "clients" }] },
    ]);
    // assignBands: hero=brand, feature_grid cycles to contrast, stats is always deep.
    expect(r.html).toContain('data-band="contrast"');
    expect(r.html).toContain('data-band="deep"');
    expect(r.manifest.format).toBe("paige-portable-export/1");
    expect(r.manifest.staticOnly).toBe(true);
  });

  it("renders gallery and image assets with their alt text", () => {
    const r = exportHtml([
      { type: "image", url: "https://cdn.example.com/team.jpg", alt: "The team" },
      { type: "gallery", title: "Moments", images: [{ url: "https://cdn.example.com/g1.jpg", alt: "Workshop" }] },
    ]);
    expect(r.html).toContain('src="https://cdn.example.com/team.jpg"');
    expect(r.html).toContain('alt="The team"');
    expect(r.html).toContain('alt="Workshop"');
  });
});

describe("buildPortableExport — the published version, not the draft", () => {
  it("styles from the published theme through the live resolver", () => {
    const r = exportHtml([{ type: "hero", title: "T" }], { theme: { primary: "#244a6b" } });
    // resolveGrowthTheme derives --gp-primary from the page theme over the floor.
    expect(r.html).toContain("--gp-primary:#244a6b");
  });
});
