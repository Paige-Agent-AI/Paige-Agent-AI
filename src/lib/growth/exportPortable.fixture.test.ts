// Evidence fixture generator — NOT a test of the builder (exportPortable.test.ts is). Run
// explicitly to write the evidence asset the PR ships:
//   PAIGE_WRITE_EXPORT_FIXTURE=1 npx vitest run src/lib/growth/exportPortable.fixture.ts
// The written file is the REAL builder's output for a fixture published page that mirrors the
// harness studio's workshop page, so the record's captures and the studio captures describe one
// coherent story. CI never writes docs: without the env var this file is skipped.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortableExport, type PortablePageSource } from "./exportPortable";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";

const OUT_DIR = path.resolve(import.meta.dirname, "../../../docs/evidence/ui-delivery/assets/exp06-portable-export");

describe("export evidence fixture (opt-in write)", () => {
  it.skipIf(!process.env.PAIGE_WRITE_EXPORT_FIXTURE)("writes the real builder output for the evidence record", () => {
    const src: PortablePageSource = {
      status: "published",
      tenantSlug: "acme-coaching",
      tenantName: "ACME Coaching",
      pageId: "p-fixture",
      pageSlug: "workshop",
      pageTitle: "Turn your next ten clients into a referral engine",
      publishedAt: "2026-10-01T12:00:00Z",
      brandFloor: buildGrowthBrandFloor({ primary_color: "#1d3a2a", accent_color: "#e8b84c" }),
      theme: null,
      seo: { description: "A ninety-minute referral workshop for coaches, with a replay." },
      blocks: [
        { type: "hero", eyebrow: "Live workshop", title: "Turn your next ten clients into a referral engine", subtitle: "One honest hour on asking well — with the templates we use.", cta_label: "Save my seat", cta_href: "/p/acme-coaching/workshop", image_url: "https://images.unsplash.com/photo-1517245421214-74ac55b4f75e?w=1200" },
        { type: "stats", title: "What the last cohort did", items: [{ value: "3.2×", label: "more referrals asked" }, { value: "11", label: "of 14 asked twice" }, { value: "0", label: "lost clients" }] },
        { type: "media", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Last year's workshop (replay)", caption: "Ninety minutes, recorded." },
        { type: "embedded_form", form_slug: "workshop-signup", title: "Save your seat" },
        { type: "faq", title: "Fair questions", items: [{ question: "Is it recorded?", answer: "Yes — every ticket includes the replay." }, { question: "Can my team join?", answer: "One ticket covers one seat; write us for group rates." }] },
        { type: "cta", title: "Doors close Friday", body: "The next cohort opens in January.", cta_label: "Save my seat", cta_href: "/p/acme-coaching/workshop" },
      ],
    };
    const r = buildPortableExport(src, { origin: "https://acme-coaching.paigeagent.ai", exportedAt: "2026-10-26T00:00:00Z" });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path.join(OUT_DIR, r.fileName), r.html, "utf8");
    writeFileSync(path.join(OUT_DIR, r.fileName.replace(/\.html$/, "-manifest.json")), JSON.stringify(r.manifest, null, 2), "utf8");
    // The write itself must have produced the artifacts we assert elsewhere.
    expect(r.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(r.manifest.assets.length).toBeGreaterThan(0);
  });
});
