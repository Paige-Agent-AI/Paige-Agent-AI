// The portable export (EXP06 WEB-04, matrix row 10): a REAL static HTML document of a page's
// PUBLISHED columns — never its drafts. One download, honestly labeled, that a tenant can keep
// or hand to any host: the same --gp-* tokens the live page resolves (resolveGrowthTheme — the
// one seam), the same band rhythm (assignBands — the one algorithm), the same media allowlist
// (embedUrl — the one parser), and the same rich_text sanitizer posture as the renderer.
//
// What a static file cannot do, it does not fake: no <script> ships at all; an embedded form
// links to the live page instead of fabricating intake; the chatbot links instead of chatting;
// a countdown states its date as a snapshot. Asset provenance and lineage ride a manifest the
// caller downloads beside the HTML. A download is NOT a deployment — the live page stays the
// source of truth.
//
// NOT A PUBLISH PATH. This reads what the publish door already put live; it creates nothing,
// mutates nothing, and touches no database (the caller passes the published columns in).
import DOMPurify from "dompurify";
import { resolveGrowthTheme } from "@/components/growth/growth-theme";
import { assignBands } from "@/lib/growth/bands";
import { embedUrl } from "@/lib/growth/media";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";

/** Only a published page may be exported. The literal type makes the studio seam say so;
 *  the runtime guard below makes it true regardless of the caller. */
export interface PortablePageSource {
  status: "published";
  tenantSlug: string;
  tenantName: string | null;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  /** ISO timestamp of the publication this export captures. */
  publishedAt: string | null;
  /** blocks_json — the PUBLISHED blocks, never draft_blocks_json. */
  blocks: GrowthBlock[];
  /** theme_json — the PUBLISHED theme. */
  theme: GrowthPageTheme | null;
  /** seo_json — the PUBLISHED SEO fields. */
  seo: { description?: string; og_image?: string } | null;
  /** The tenant's brand floor (buildGrowthBrandFloor of the same row the live page reads). */
  brandFloor: GrowthPageTheme;
}

export interface PortableExportAsset {
  url: string;
  origin: "brand-floor" | "page-theme" | "block";
  blockType?: string;
}

export interface PortableExportManifest {
  format: "paige-portable-export/1";
  generatedAt: string;
  origin: string;
  tenant: { slug: string; name: string | null };
  page: { id: string; slug: string; title: string; publishedAt: string | null };
  source: string;
  distinctFromDeployment: true;
  staticOnly: true;
  assets: PortableExportAsset[];
  notes: string[];
}

export class PortableExportRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PortableExportRefused";
  }
}

export interface PortableExport {
  html: string;
  manifest: PortableExportManifest;
  fileName: string;
}

/** HTML-escape any tenant-authored text before it enters the document. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Where a link may go: external http(s) as-is; mailto/tel kept; same-app paths absolutized to
 * the platform origin so navigation survives off-platform hosting. Anything else — javascript:,
 * data:, scheme-relative junk — is dropped (the label stays; the target does not).
 */
function linkUrl(href: string | undefined, origin: string): string | null {
  if (!href || typeof href !== "string") return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^(mailto|tel):/i.test(href)) return href;
  if (href.startsWith("/")) return `${origin}${href}`;
  return null;
}

function httpsOnly(u: string | undefined | null): string | null {
  return typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
}

/** A button-styled anchor when the target is safe, a styled span when it is not — the copy
 *  always survives, an unsafe target never does. */
function ctaAnchor(label: string, href: string | undefined, origin: string): string {
  const url = linkUrl(href, origin);
  const text = esc(label || "Learn more");
  return url
    ? `<a class="gp-btn" href="${esc(url)}">${text}</a>`
    : `<span class="gp-btn gp-btn-quiet">${text}</span>`;
}

function heading(t: string | undefined, tag: "h2"): string {
  return t ? `<${tag}>${esc(t)}</${tag}>` : "";
}

const PROSE_STYLE = `.gp-prose{color:var(--gp-text)} .gp-prose p{color:inherit}`;

/** The export's own small stylesheet: the same tokens, a faithful simple layout. No framework,
 *  no script, responsive by construction. */
function stylesheet(vars: Record<string, string>): string {
  const root = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
  return `:root{${root}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--gp-bg);color:var(--gp-text);font-family:var(--gp-font);line-height:1.6;font-size:17px}
img{max-width:100%;height:auto;display:block}
a{color:var(--gp-accent-ink)}
section[data-band]{padding:4rem 1.5rem}
section[data-band="contrast"]{background:var(--gp-contrast-bg);--gp-bg:var(--gp-contrast-bg);--gp-text:var(--gp-contrast-text);--gp-muted:var(--gp-contrast-muted);--gp-accent-ink:var(--gp-contrast-accent-ink);--gp-surface:var(--gp-contrast-surface)}
section[data-band="deep"]{background:var(--gp-deep-bg);--gp-bg:var(--gp-deep-bg);--gp-text:var(--gp-deep-text);--gp-muted:var(--gp-deep-muted);--gp-accent-ink:var(--gp-deep-accent-ink);--gp-surface:var(--gp-deep-surface)}
.gp-wrap{max-width:72rem;margin:0 auto}
.gp-wrap-narrow{max-width:48rem;margin:0 auto}
h1,h2,h3{font-family:var(--gp-font-display,var(--gp-font));line-height:1.15;margin:0 0 .6em}
h1{font-size:2.6rem}h2{font-size:1.9rem}h3{font-size:1.25rem}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.8rem;font-weight:600;color:var(--gp-accent-ink);margin:0 0 .8rem}
p{margin:0 0 1em;color:var(--gp-muted)}
p.lead{font-size:1.15rem}
.gp-btn{display:inline-block;background:var(--gp-accent);color:var(--gp-accent-foreground);padding:.75em 1.6em;border-radius:999px;text-decoration:none;font-weight:600}
.gp-btn-quiet{background:transparent;color:var(--gp-text);border:1px solid currentColor}
.gp-grid{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
.gp-card{background:var(--gp-surface);border:1px solid color-mix(in srgb,var(--gp-text) 18%,transparent);border-radius:.75rem;padding:1.25rem}
.gp-card b{display:block;margin-bottom:.35rem}
.gp-num{font-size:.8rem;font-weight:700;letter-spacing:.1em;color:var(--gp-accent-ink)}
.gp-stat b{display:block;font-size:2.2rem;font-family:var(--gp-font-display,var(--gp-font));color:var(--gp-accent-ink)}
.gp-video{aspect-ratio:16/9;background:#000;max-width:48rem;margin:0 auto}
.gp-video iframe,.gp-video video{width:100%;height:100%;border:0;display:block}
.gp-caption{text-align:center;font-size:.9rem;margin-top:.75rem}
.gp-unavailable{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#000}
.gp-unavailable p{color:#cfcfcf;margin:0;padding:0 1.5rem;text-align:center;font-size:.95rem;font-weight:500}
.gp-quote{margin:0;font-size:1.1rem;color:var(--gp-text)}
.gp-quote footer{margin-top:.6rem;font-size:.9rem;color:var(--gp-muted)}
.gp-faq details{border-bottom:1px solid color-mix(in srgb,var(--gp-text) 18%,transparent);padding:.85rem 0}
.gp-faq summary{cursor:pointer;font-weight:600;color:var(--gp-text)}
.gp-faq p{margin:.6rem 0 0}
.gp-two{display:grid;gap:2rem;grid-template-columns:1fr 1fr;align-items:center}
.gp-price{text-align:center}
.gp-price .gp-card{display:flex;flex-direction:column;gap:.5rem}
.gp-price .featured{border-color:var(--gp-accent);border-width:2px}
.gp-logo-row{display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center;justify-content:center}
.gp-logo-row span{font-weight:600;color:var(--gp-muted)}
.gp-logo-row img{max-height:2.5rem;width:auto}
.gp-hero-split{display:grid;gap:2rem;grid-template-columns:1fr 1fr;align-items:center}
.gp-hero-full{position:relative;border-radius:1rem;overflow:hidden;aspect-ratio:16/9;max-height:34rem;margin-top:1.5rem}
.gp-hero-full img{width:100%;height:100%;object-fit:cover}
.gp-steps{list-style:none;margin:0;padding:0;counter-reset:step}
.gp-steps li{padding:1rem 0 1rem 3rem;position:relative;border-bottom:1px solid color-mix(in srgb,var(--gp-text) 15%,transparent)}
.gp-steps li::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:1rem;width:2rem;height:2rem;border-radius:999px;background:var(--gp-accent);color:var(--gp-accent-foreground);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem}
footer.gp-lineage{padding:1.25rem 1.5rem;font-size:.8rem;color:var(--gp-muted);text-align:center;border-top:1px solid color-mix(in srgb,var(--gp-text) 15%,transparent)}
${PROSE_STYLE}
@media (max-width:640px){section[data-band]{padding:2.75rem 1.1rem}h1{font-size:1.95rem}h2{font-size:1.5rem}.gp-two,.gp-hero-split{grid-template-columns:1fr}}`;
}

interface Ctx {
  origin: string;
  liveUrl: string;
  assets: PortableExportAsset[];
  notes: string[];
  tenantName: string | null;
  /** The export's own clock: a countdown snapshot is judged against it, once, statically. */
  exportedAtMs: number;
}

function asset(ctx: Ctx, url: string, origin: PortableExportAsset["origin"], blockType?: string) {
  ctx.assets.push({ url, origin, ...(blockType ? { blockType } : {}) });
}

/** One block → static HTML. Structure mirrors GrowthBlocks' composition with the same tokens. */
function renderBlock(b: GrowthBlock, ctx: Ctx): string {
  const o = ctx.origin;
  switch (b.type) {
    case "hero": {
      const img = httpsOnly(b.image_url);
      if (img) asset(ctx, img, "block", "hero");
      const copy = `<div>${b.eyebrow ? `<p class="eyebrow">${esc(b.eyebrow)}</p>` : ""}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="lead">${esc(b.subtitle)}</p>` : ""}${(b.cta_label || b.cta_href) ? ctaAnchor(b.cta_label ?? "", b.cta_href, o) : ""}${b.quote ? `<p class="gp-quote" style="margin-top:1.25rem">“${esc(b.quote)}”</p>` : ""}</div>`;
      if (img && b.image_position === "split") {
        return `<div class="gp-hero-split">${copy}<div>${img ? `<img src="${esc(img)}" alt="">` : ""}</div></div>`;
      }
      return `${copy}${img ? `<div class="gp-hero-full"><img src="${esc(img)}" alt=""></div>` : ""}`;
    }
    case "hero_scene":
      // The aurora is motion-only decoration; a static export renders the copy honestly on the
      // brand tone and says so in the manifest.
      ctx.notes.push("hero_scene: the animated brand scene does not ship in a static export; the copy renders on the brand tone.");
      return `<div>${b.eyebrow ? `<p class="eyebrow">${esc(b.eyebrow)}</p>` : ""}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="lead">${esc(b.subtitle)}</p>` : ""}${(b.cta_label || b.cta_href) ? ctaAnchor(b.cta_label ?? "", b.cta_href, o) : ""}</div>`;
    case "phase_cards":
      return `${heading(b.title, "h2")}<div class="gp-grid">${b.cards.map((c) => `<div class="gp-card"><span class="gp-num">${esc(c.phase)}</span><b>${esc(c.title)}</b><p style="margin-bottom:0">${esc(c.body)}</p>${c.outcome ? `<p class="eyebrow" style="margin:.6rem 0 0">${esc(c.outcome)}</p>` : ""}</div>`).join("")}</div>`;
    case "feature_grid":
      return `${heading(b.title, "h2")}<div class="gp-grid">${b.items.map((i) => `<div class="gp-card">${i.icon ? `<span class="gp-num">${esc(i.icon)}</span>` : ""}<b>${esc(i.title)}</b><p style="margin-bottom:0">${esc(i.body)}</p></div>`).join("")}</div>`;
    case "cta":
      return `<div style="text-align:center">${heading(b.title, "h2")}${b.body ? `<p>${esc(b.body)}</p>` : ""}${ctaAnchor(b.cta_label, b.cta_href, o)}</div>`;
    case "rich_text": {
      // The renderer's exact posture: strip scripts/styles/iframes/objects/embeds/forms and
      // inline handlers. A static file accepts nothing looser than the live page does.
      const safe = DOMPurify.sanitize(b.html ?? "", {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"],
      });
      return `<div class="gp-prose">${safe}</div>`;
    }
    case "embedded_form": {
      // A static file cannot carry the live intake contract (consent, gating, the canonical
      // source record). It never fabricates a form: it links to the live page's form.
      ctx.notes.push(`embedded_form “${b.form_slug}”: a static export links to the live page instead of fabricating intake — submissions stay on the live form.`);
      return `${heading(b.title ?? "Save your spot", "h2")}<p>Handled securely on the live page.</p><a class="gp-btn" href="${esc(ctx.liveUrl)}">${esc(b.title ? "Continue on the live page" : "Fill in the form on the live page")}</a>`;
    }
    case "social_proof":
      return `${heading(b.title, "h2")}<div class="gp-logo-row">${b.logos.map((l) => {
        const img = httpsOnly(l.image_url);
        if (img) { asset(ctx, img, "block", "social_proof"); return `<img src="${esc(img)}" alt="${esc(l.name)}">`; }
        return `<span>${esc(l.name)}</span>`;
      }).join("")}</div>`;
    case "testimonial":
      return `${b.items.map((t) => `<figure class="gp-card" style="margin:0"><blockquote class="gp-quote">“${esc(t.quote)}”</blockquote><footer>${esc([t.author, t.role].filter(Boolean).join(", "))}${typeof t.rating === "number" ? ` · ${t.rating}/5` : ""}</footer></figure>`).join("")}`;
    case "pricing":
      return `${heading(b.title, "h2")}<div class="gp-grid gp-price">${b.tiers.map((t) => `<div class="gp-card${t.featured ? " featured" : ""}"><b>${esc(t.name)}</b><p class="gp-stat"><b>${esc(t.price)}</b>${t.period ? `<span style="font-size:.9rem;color:var(--gp-muted)"> / ${esc(t.period)}</span>` : ""}</p><ul style="margin:0;padding-left:1.1rem;color:var(--gp-muted)">${t.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>${t.cta_label ? ctaAnchor(t.cta_label, t.cta_href, o) : ""}</div>`).join("")}</div>`;
    case "faq":
      return `${heading(b.title, "h2")}<div class="gp-faq">${b.items.map((i) => `<details><summary>${esc(i.question)}</summary><p>${esc(i.answer)}</p></details>`).join("")}</div>`;
    case "media": {
      const title = b.title ? esc(b.title) : "Embedded video";
      let inner: string;
      if (b.provider === "mp4") {
        const src = httpsOnly(b.url);
        if (src) { asset(ctx, src, "block", "media"); inner = `<video src="${esc(src)}" controls playsinline preload="metadata"></video>`; }
        else inner = unavailable();
      } else {
        const src = embedUrl(b.provider, b.url);
        if (src) {
          asset(ctx, src, "block", "media");
          inner = `<iframe src="${esc(src)}" title="${title}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
        } else inner = unavailable();
      }
      return `${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<div class="gp-video">${inner}</div>${b.caption ? `<p class="gp-caption">${esc(b.caption)}</p>` : ""}`;
    }
    case "stats":
      return `${heading(b.title, "h2")}<div class="gp-grid gp-stat">${b.items.map((i) => `<div><b>${esc(i.value)}</b><span style="color:var(--gp-muted)">${esc(i.label)}</span></div>`).join("")}</div>`;
    case "countdown": {
      // No script ticks in a static file: the date is stated as a snapshot, honestly.
      ctx.notes.push("countdown: the exported page states the end date as a static snapshot; it does not tick.");
      const end = Date.parse(b.ends_at);
      const expired = !Number.isNaN(end) && end < ctx.exportedAtMs;
      const when = Number.isNaN(end) ? esc(b.ends_at) : new Date(end).toISOString().slice(0, 10);
      return `${heading(b.title, "h2")}<p class="gp-stat" style="text-align:center">${expired ? esc(b.expired_text ?? "This has ended.") : `<b>${when}</b>`}</p>`;
    }
    case "two_column": {
      const img = httpsOnly(b.image_url);
      if (img) asset(ctx, img, "block", "two_column");
      const copy = `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ""}${b.body ? `<p>${esc(b.body)}</p>` : ""}${b.cta_label ? ctaAnchor(b.cta_label, b.cta_href, o) : ""}`;
      const media = img ? `<img src="${esc(img)}" alt="">` : "";
      return `<div class="gp-two">${b.image_side === "left" ? media + copy : copy + media}</div>`;
    }
    case "image": {
      const src = httpsOnly(b.url);
      if (!src) return "";
      asset(ctx, src, "block", "image");
      return `<figure style="margin:0"><img src="${esc(src)}" alt="${esc(b.alt ?? "")}">${b.caption ? `<figcaption class="gp-caption">${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "gallery":
      return `${heading(b.title, "h2")}<div class="gp-grid">${b.images.map((g) => {
        const src = httpsOnly(g.url);
        if (!src) return "";
        asset(ctx, src, "block", "gallery");
        return `<figure class="gp-card" style="margin:0;padding:.5rem"><img src="${esc(src)}" alt="${esc(g.alt ?? "")}">${g.caption ? `<figcaption class="gp-caption">${esc(g.caption)}</figcaption>` : ""}</figure>`;
      }).join("")}</div>`;
    case "steps":
      return `${heading(b.title, "h2")}<ol class="gp-steps">${b.items.map((i) => `<li>${i.number ? `<span class="gp-num">${esc(i.number)}</span>` : ""}<b>${esc(i.title)}</b><p style="margin-bottom:0">${esc(i.body)}</p></li>`).join("")}</ol>`;
    case "chatbot": {
      // The tenant's Paige chats on the live page; a static file never pretends to.
      ctx.notes.push("chatbot: the exported page links to the live conversation; a static file cannot host it.");
      return `${heading(b.title ?? "Chat with us", "h2")}<p>${esc(b.greeting ?? "Ask anything — we answer on the live page.")}</p><a class="gp-btn" href="${esc(ctx.liveUrl)}">Open the live page</a>`;
    }
    default:
      return "";
  }
}

function unavailable(): string {
  return `<div class="gp-unavailable"><p>This video isn’t available right now.</p></div>`;
}

export function buildPortableExport(
  src: PortablePageSource,
  opts: { origin: string; exportedAt: string },
): PortableExport {
  if ((src as { status?: string })?.status !== "published") {
    throw new PortableExportRefused("Only a published page can be exported — publish it first; the export carries the approved public version.");
  }
  if (!Array.isArray(src.blocks)) {
    throw new PortableExportRefused("The published page has no blocks to export.");
  }

  const ctx: Ctx = {
    origin: opts.origin,
    liveUrl: `${opts.origin}/p/${encodeURIComponent(src.tenantSlug)}/${encodeURIComponent(src.pageSlug)}`,
    assets: [],
    notes: [],
    tenantName: src.tenantName,
    exportedAtMs: Date.parse(opts.exportedAt),
  };

  // The brand floor's logo is part of the page's face — record its provenance when present.
  const brandLogo = httpsOnly(src.brandFloor?.logo_url);
  if (brandLogo) asset(ctx, brandLogo, "brand-floor");
  const og = httpsOnly(src.seo?.og_image);
  if (og) asset(ctx, og, "page-theme");

  const vars = resolveGrowthTheme(src.theme ?? undefined, src.brandFloor ?? undefined);
  const bands = assignBands(src.blocks);

  const sections = src.blocks.map((b, i) => {
    const inner = renderBlock(b, ctx);
    if (!inner) return "";
    const wrap = b.type === "hero" || b.type === "hero_scene" || b.type === "cta" || b.type === "rich_text" || b.type === "media" || b.type === "faq" ? "gp-wrap-narrow" : "gp-wrap";
    return `    <section data-band="${bands[i] ?? "brand"}"><div class="${wrap}">${inner}</div></section>`;
  }).join("\n");

  const description = src.seo?.description ? `  <meta name="description" content="${esc(src.seo.description)}">\n` : "";
  // The static export unfurls exactly like the live page: og:title mirrors the <title>,
  // og:description mirrors the description, og:image only when an approved absolute one exists.
  const ogDesc = src.seo?.description ? `  <meta property="og:description" content="${esc(src.seo.description)}">\n` : "";
  const ogMeta = og
    ? `  <meta property="og:title" content="${esc(src.pageTitle)}">\n${ogDesc}  <meta property="og:image" content="${esc(og)}">\n  <meta name="twitter:card" content="summary_large_image">\n`
    : (src.seo?.description ? `  <meta property="og:title" content="${esc(src.pageTitle)}">\n${ogDesc}` : "");
  const published = src.publishedAt ? src.publishedAt.slice(0, 10) : "unknown-date";

  const html = `<!DOCTYPE html>
<!-- Paige Agent AI portable export · tenant ${esc(src.tenantSlug)} · page ${esc(src.pageSlug)} · published ${esc(published)} · exported ${esc(opts.exportedAt)} -->
<!-- A download of the published version, not a deployment. The live page remains the source of truth. No scripts ship in this file. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(src.pageTitle)}</title>
${description}${ogMeta}  <meta name="generator" content="Paige Agent AI — portable export of the published version">
  <style>${stylesheet(vars)}</style>
</head>
<body>
    <main>
${sections}
    </main>
    <footer class="gp-lineage">Exported from the published version · ${esc(src.tenantName ?? src.tenantSlug)} · ${esc(published)} · A download, not a deployment — the live page stays the source of truth.</footer>
</body>
</html>`;

  const manifest: PortableExportManifest = {
    format: "paige-portable-export/1",
    generatedAt: opts.exportedAt,
    origin: opts.origin,
    tenant: { slug: src.tenantSlug, name: src.tenantName },
    page: { id: src.pageId, slug: src.pageSlug, title: src.pageTitle, publishedAt: src.publishedAt },
    source: "growth_pages published columns (blocks_json/theme_json/seo_json) via Studio",
    distinctFromDeployment: true,
    staticOnly: true,
    assets: ctx.assets,
    notes: [...ctx.notes, "Static export: no scripts ship; anything interactive links or snapshots honestly."],
  };

  return {
    html,
    manifest,
    fileName: `${src.tenantSlug}-${src.pageSlug}-${published}.html`,
  };
}
