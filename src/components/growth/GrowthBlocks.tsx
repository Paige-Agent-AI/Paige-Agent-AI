// The ONE block renderer. This exact tree draws the public landing page at
// /p/<tenant>/<slug> AND the Studio live preview — preview == published, no fork. Every
// one of the 19 GrowthBlock types renders here, token-driven (only `--gp-*` vars, zero
// hardcoded hex), responsive, motion-safe, AA-contrast, on a generous spacing rhythm.
//
// Theming: <GrowthBlocks> wraps the list in a scope div that applies resolveGrowthTheme()
// as inline CSS variables, so the same component themes identically in both surfaces.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";
import { supabase } from "@/integrations/supabase/client";
import { resolveGrowthFontPair, resolveGrowthTheme, type GrowthThemeVars } from "@/components/growth/growth-theme";
import { useBrandFontFaces } from "@/hooks/useBrandFontFaces";
import "./growth-brand-fonts.css";
import { GP_FADE_RISE, GP_PRESS, fadeRiseStyle, useReducedMotion } from "@/components/growth/growth-motion";
import { GrowthFormEmbed } from "@/pages/public/GrowthFormRenderer";

// ── shared layout tokens ─────────────────────────────────────────────────────
const SECTION = "px-6 md:px-10 py-16 md:py-24";
const WRAP = "mx-auto w-full max-w-6xl";
const WRAP_NARROW = "mx-auto w-full max-w-3xl";

// ── section rhythm (§11) — a page must not render as one flat brand color head-to-toe. Each
// block gets a background BAND; its wrapper rebinds the base --gp-* vars to that band's set, so
// every block body re-themes with ZERO per-block changes. Adjacent bands never repeat, so a real
// color break always falls between sections. `--gp-accent`/`--gp-primary` are never rebound, so
// gold stays emphasis-only and the hero scrim stays constant.
type GpBand = "brand" | "contrast" | "deep";

const BAND_CYCLE: GpBand[] = ["brand", "contrast", "deep", "contrast"];

function assignBands(blocks: GrowthBlock[]): GpBand[] {
  const out: GpBand[] = [];
  let contentIdx = 0;
  let prev: GpBand | null = null;
  for (const b of blocks) {
    let band: GpBand;
    if (b.type === "hero" || b.type === "hero_scene") band = "brand"; // heroes own the brand tone (their own scrim/scene)
    else if (b.type === "stats") band = "deep"; // a proof band reads best as a dark strip
    else {
      band = BAND_CYCLE[contentIdx % BAND_CYCLE.length];
      contentIdx++;
    }
    if (band === prev) band = band === "contrast" ? "brand" : "contrast"; // never two same tones touching
    out.push(band);
    prev = band;
  }
  return out;
}

/** Per-band wrapper style that rebinds the base --gp-* to the band's set. `brand` inherits the
 *  scope (no override, transparent). */
function bandStyle(band: GpBand | undefined): React.CSSProperties {
  if (band === "contrast")
    return {
      background: "var(--gp-contrast-bg)",
      ["--gp-bg" as string]: "var(--gp-contrast-bg)",
      ["--gp-text" as string]: "var(--gp-contrast-text)",
      ["--gp-muted" as string]: "var(--gp-contrast-muted)",
      ["--gp-accent-ink" as string]: "var(--gp-contrast-accent-ink)",
      ["--gp-surface" as string]: "var(--gp-contrast-surface)",
    } as React.CSSProperties;
  if (band === "deep")
    return {
      background: "var(--gp-deep-bg)",
      ["--gp-bg" as string]: "var(--gp-deep-bg)",
      ["--gp-text" as string]: "var(--gp-deep-text)",
      ["--gp-muted" as string]: "var(--gp-deep-muted)",
      ["--gp-accent-ink" as string]: "var(--gp-deep-accent-ink)",
      ["--gp-surface" as string]: "var(--gp-deep-surface)",
    } as React.CSSProperties;
  return {};
}

// Hairline border / raised surface, both derived from theme tokens (no opacity guesswork).
const hairline = "1px solid color-mix(in srgb, var(--gp-text) 14%, transparent)";
const cardStyle: React.CSSProperties = {
  background: "color-mix(in srgb, var(--gp-text) 4%, transparent)",
  border: hairline,
  borderRadius: "1rem",
};

// ── small building blocks ────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <span
      className="inline-block rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]"
      style={{
        color: "var(--gp-accent-ink)",
        border: "1px solid color-mix(in srgb, var(--gp-accent-ink) 40%, transparent)",
        background: "color-mix(in srgb, var(--gp-accent-ink) 8%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

function Heading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // §11: headings read in --gp-text, never accent. Accent is reserved for eyebrows + CTAs.
  return (
    <h2 className={`font-display font-semibold tracking-tight ${className}`} style={{ color: "var(--gp-text)" }}>
      {children}
    </h2>
  );
}

function Lede({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return <p className={`text-lg leading-relaxed ${className}`} style={{ color: "var(--gp-muted)" }}>{children}</p>;
}

function CtaButton({ label, href, size = "md" }: { label?: string; href?: string; size?: "md" | "lg" }) {
  if (!label || !href) return null;
  const pad = size === "lg" ? "px-8 py-3.5 text-base" : "px-6 py-3 text-sm";
  return (
    <a
      href={href}
      className={`${GP_PRESS} inline-flex items-center gap-2 rounded-full font-semibold shadow-lg transition-[filter,box-shadow] hover:brightness-95 ${pad}`}
      style={{ background: "var(--gp-accent)", color: "var(--gp-accent-foreground)" }}
    >
      {label}
      <span aria-hidden>→</span>
    </a>
  );
}

function SectionHead({ eyebrow, title, subtitle, center = true }: { eyebrow?: string; title?: string; subtitle?: string; center?: boolean }) {
  if (!title && !subtitle && !eyebrow) return null;
  return (
    <div className={`${center ? "text-center mx-auto max-w-2xl" : "max-w-2xl"} mb-12 space-y-4`}>
      {eyebrow && <div>{center ? <Eyebrow>{eyebrow}</Eyebrow> : <Eyebrow>{eyebrow}</Eyebrow>}</div>}
      {title && <Heading className="text-3xl md:text-4xl">{title}</Heading>}
      {subtitle && <Lede>{subtitle}</Lede>}
    </div>
  );
}

// A framed, motion-safe media/image frame with a token hairline.
function Frame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl ${className}`} style={{ border: hairline, background: "var(--gp-surface)" }}>
      {children}
    </div>
  );
}

// ── media embed helpers (client-side render into a SANDBOXED iframe) ──────────
function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}
function loomId(url: string): string | null {
  const m = url.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function embedUrl(provider: string, url: string): string | null {
  switch (provider) {
    case "youtube": {
      const id = youTubeId(url);
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    case "vimeo": {
      const id = vimeoId(url);
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    case "loom": {
      const id = loomId(url);
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
    default:
      return null;
  }
}

// ── individual block bodies ──────────────────────────────────────────────────
function HeroBlock({ block }: { block: Extract<GrowthBlock, { type: "hero" }> }) {
  const hasImage = !!block.image_url;
  const split = block.image_position === "split" && hasImage;

  const copy = (
    <div className={`space-y-6 ${split ? "" : "mx-auto max-w-3xl text-center"}`}>
      {block.eyebrow && <Eyebrow>{block.eyebrow}</Eyebrow>}
      <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl" style={{ color: "var(--gp-text)" }}>
        {block.title}
      </h1>
      {block.subtitle && (
        <p className={`text-lg leading-relaxed md:text-xl ${split ? "" : "mx-auto max-w-2xl"}`} style={{ color: "var(--gp-muted)" }}>
          {block.subtitle}
        </p>
      )}
      {block.quote && (
        <blockquote
          className="border-l-2 pl-4 text-base italic md:text-lg"
          style={{ color: "var(--gp-muted)", borderColor: "var(--gp-accent-ink)" }}
        >
          {block.quote}
        </blockquote>
      )}
      {block.cta_label && block.cta_href && (
        <div className={split ? "" : "flex justify-center"}>
          <CtaButton label={block.cta_label} href={block.cta_href} size="lg" />
        </div>
      )}
    </div>
  );

  // Full-bleed image: image behind, AA scrim from the brand ink, copy centered on top.
  if (hasImage && !split) {
    return (
      <section className="relative overflow-hidden">
        <img src={block.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--gp-primary) 78%, transparent) 0%, color-mix(in srgb, var(--gp-primary) 62%, transparent) 55%, color-mix(in srgb, var(--gp-primary) 84%, transparent) 100%)",
          }}
        />
        <div className={`relative ${WRAP} px-6 md:px-10 py-28 md:py-40`}>{copy}</div>
      </section>
    );
  }

  // Split: copy one side, framed image the other.
  if (split) {
    return (
      <section className={SECTION}>
        <div className={`${WRAP} grid items-center gap-10 md:grid-cols-2 md:gap-16`}>
          <div>{copy}</div>
          <Frame>
            <img src={block.image_url} alt="" className="aspect-[4/3] w-full object-cover" />
          </Frame>
        </div>
      </section>
    );
  }

  // No image: centered editorial hero.
  return (
    <section className={`${SECTION} py-24 md:py-36`}>
      <div className={`${WRAP} px-0`}>{copy}</div>
    </section>
  );
}

// Animated brand-toned hero (#240) — the premium, image-free opener. The visual is a slow
// aurora of blurred, brand-PRIMARY-tinted blobs (never gold — §11 keeps gold on the CTA only),
// with a fixed vignette that guarantees the headline stays AA over the moving field. The drift
// is pure CSS transform on the `.gp-aurora-*` classes, which no-op under reduced motion, so this
// degrades to a calm static gradient. Same copy contract + tokens as HeroBlock.
function HeroSceneBlock({ block }: { block: Extract<GrowthBlock, { type: "hero_scene" }> }) {
  return (
    <section
      className="relative isolate overflow-hidden"
      // Render on the DEEP palette, not the raw brand: the resolver clamps --gp-deep-bg to a
      // genuinely-dark field with AA light ink for EVERY tenant — even a pale/pastel primary,
      // where the raw-primary version would put dark ink on a darkened field and fail AA. Rebinding
      // the base tokens here also makes the block immune to whatever band it lands in (§13: guard
      // the edge — a hero_scene that isn't the first block must still be legible).
      style={{
        background: "var(--gp-deep-bg)",
        ["--gp-text" as string]: "var(--gp-deep-text)",
        ["--gp-muted" as string]: "var(--gp-deep-muted)",
        ["--gp-accent-ink" as string]: "var(--gp-deep-accent-ink)",
        ["--gp-surface" as string]: "var(--gp-deep-surface)",
      } as React.CSSProperties}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Brand-tinted glow — the tenant's primary color still reads on the dark field. */}
        <div
          className="gp-aurora-blob gp-aurora-a absolute -left-[15%] -top-[20%] h-[62vh] w-[62vh] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--gp-primary) 58%, white 42%) 0%, transparent 70%)", opacity: 0.3 }}
        />
        {/* Deep shadow for dimensional depth (mixes the dark field toward black — always safe here). */}
        <div
          className="gp-aurora-blob gp-aurora-b absolute -right-[10%] top-[8%] h-[56vh] w-[56vh] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--gp-deep-bg) 20%, black 80%) 0%, transparent 70%)", opacity: 0.45 }}
        />
        <div
          className="gp-aurora-blob gp-aurora-c absolute -bottom-[25%] left-[28%] h-[52vh] w-[52vh] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--gp-primary) 68%, white 32%) 0%, transparent 70%)", opacity: 0.22 }}
        />
        {/* Fixed vignette — always deepens toward the dark field, keeping copy AA over the motion. */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(120% 90% at 50% 32%, transparent 44%, color-mix(in srgb, var(--gp-deep-bg) 55%, black) 100%)" }}
        />
      </div>

      <div className={`relative ${WRAP} px-6 md:px-10 py-32 md:py-44`}>
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          {block.eyebrow && <Eyebrow>{block.eyebrow}</Eyebrow>}
          <h1
            className="font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl"
            style={{ color: "var(--gp-text)" }}
          >
            {block.title}
          </h1>
          {block.subtitle && (
            <p className="mx-auto max-w-2xl text-lg leading-relaxed md:text-xl" style={{ color: "var(--gp-muted)" }}>
              {block.subtitle}
            </p>
          )}
          {block.cta_label && block.cta_href && (
            <div className="flex justify-center pt-2">
              <CtaButton label={block.cta_label} href={block.cta_href} size="lg" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PhaseCardsBlock({ block }: { block: Extract<GrowthBlock, { type: "phase_cards" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <SectionHead title={block.title} />
        <div className="grid gap-6 md:grid-cols-3">
          {block.cards.map((c, i) => (
            <div key={i} className="p-7" style={cardStyle}>
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gp-accent-ink)" }}>{c.phase}</div>
              <h3 className="mb-3 text-xl font-semibold" style={{ color: "var(--gp-text)" }}>{c.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--gp-muted)" }}>{c.body}</p>
              {c.outcome && (
                <div className="mt-5 border-t pt-4" style={{ borderColor: "color-mix(in srgb, var(--gp-text) 12%, transparent)" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--gp-muted)" }}>Outcome</div>
                  <div className="text-sm font-medium" style={{ color: "var(--gp-accent-ink)" }}>{c.outcome}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureGridBlock({ block }: { block: Extract<GrowthBlock, { type: "feature_grid" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <SectionHead title={block.title} />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {block.items.map((item, i) => (
            <div key={i} className="p-7" style={cardStyle}>
              {item.icon && <div className="mb-4 text-2xl" aria-hidden>{item.icon}</div>}
              <h3 className="mb-2 text-lg font-semibold" style={{ color: "var(--gp-text)" }}>{item.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--gp-muted)" }}>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBlock({ block }: { block: Extract<GrowthBlock, { type: "cta" }> }) {
  return (
    <section className={SECTION}>
      <div className={`${WRAP_NARROW} rounded-3xl px-8 py-16 text-center`} style={{ ...cardStyle, background: "var(--gp-surface)" }}>
        <Heading className="text-3xl md:text-4xl">{block.title}</Heading>
        {block.body && <Lede className="mx-auto mt-4 max-w-xl">{block.body}</Lede>}
        <div className="mt-8 flex justify-center">
          <CtaButton label={block.cta_label} href={block.cta_href} size="lg" />
        </div>
      </div>
    </section>
  );
}

function RichTextBlock({ block }: { block: Extract<GrowthBlock, { type: "rich_text" }> }) {
  // Same sanitize posture as the legacy renderer — strip scripts/embeds/handlers.
  const safeHtml = useMemo(
    () =>
      DOMPurify.sanitize(block.html ?? "", {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"],
      }),
    [block.html],
  );
  return (
    <section className={`px-6 md:px-10 py-12 md:py-16`}>
      <div
        className="prose prose-invert mx-auto max-w-3xl prose-headings:font-display prose-a:font-medium"
        style={{ color: "var(--gp-text)", ["--tw-prose-body" as string]: "var(--gp-muted)", ["--tw-prose-headings" as string]: "var(--gp-text)", ["--tw-prose-links" as string]: "var(--gp-accent-ink)", ["--tw-prose-bold" as string]: "var(--gp-text)" } as React.CSSProperties}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </section>
  );
}

function EmbeddedFormBlock({ block, tenantId }: { block: Extract<GrowthBlock, { type: "embedded_form" }>; tenantId?: string }) {
  return (
    <section id="apply" className={SECTION}>
      <div className={WRAP_NARROW}>
        {block.title && <SectionHead title={block.title} />}
        {tenantId ? (
          <GrowthFormEmbed tenantId={tenantId} formSlug={block.form_slug} accent="var(--gp-accent)" />
        ) : (
          // Preview / unresolved: a designed placeholder so the section never blanks out.
          <div className="rounded-2xl p-10 text-center" style={{ ...cardStyle, background: "var(--gp-surface)" }}>
            <div className="mx-auto mb-3 h-10 w-10 rounded-full" style={{ background: "color-mix(in srgb, var(--gp-accent-ink) 20%, transparent)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--gp-text)" }}>Your form renders here on the published page.</p>
            <p className="mt-1 text-xs" style={{ color: "var(--gp-muted)" }}>Connected to “{block.form_slug}”.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SocialProofBlock({ block }: { block: Extract<GrowthBlock, { type: "social_proof" }> }) {
  return (
    <section className="px-6 md:px-10 py-14">
      <div className={WRAP}>
        {block.title && <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gp-muted)" }}>{block.title}</p>}
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {block.logos.map((logo, i) =>
            logo.image_url ? (
              <img key={i} src={logo.image_url} alt={logo.name} className="h-8 w-auto opacity-70 transition-opacity hover:opacity-100 md:h-9" style={{ filter: "grayscale(1)" }} />
            ) : (
              <span key={i} className="text-lg font-semibold tracking-tight" style={{ color: "var(--gp-muted)" }}>{logo.name}</span>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <div className="mb-3 flex gap-0.5" aria-label={`${r} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} aria-hidden style={{ color: i < r ? "var(--gp-accent-ink)" : "color-mix(in srgb, var(--gp-text) 22%, transparent)" }}>★</span>
      ))}
    </div>
  );
}

function TestimonialBlock({ block }: { block: Extract<GrowthBlock, { type: "testimonial" }> }) {
  const many = block.items.length > 1;
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <div className={`grid gap-6 ${many ? "md:grid-cols-2 lg:grid-cols-3" : "mx-auto max-w-2xl"}`}>
          {block.items.map((it, i) => (
            <figure key={i} className="flex flex-col p-8" style={cardStyle}>
              <Stars rating={it.rating} />
              <blockquote className="flex-1 text-lg leading-relaxed" style={{ color: "var(--gp-text)" }}>“{it.quote}”</blockquote>
              {(it.author || it.role) && (
                <figcaption className="mt-6 flex items-center gap-3">
                  {it.avatar_url && <img src={it.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />}
                  <span className="text-sm">
                    {it.author && <span className="block font-semibold" style={{ color: "var(--gp-text)" }}>{it.author}</span>}
                    {it.role && <span className="block" style={{ color: "var(--gp-muted)" }}>{it.role}</span>}
                  </span>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingBlock({ block }: { block: Extract<GrowthBlock, { type: "pricing" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <SectionHead title={block.title} />
        <div className="grid items-stretch gap-6 md:grid-cols-3">
          {block.tiers.map((tier, i) => {
            const featured = !!tier.featured;
            return (
              <div
                key={i}
                className="relative flex flex-col p-8"
                style={{
                  ...cardStyle,
                  background: featured ? "var(--gp-surface)" : (cardStyle.background as string),
                  border: featured ? "1px solid var(--gp-accent-ink)" : hairline,
                  boxShadow: featured ? "0 20px 60px -20px color-mix(in srgb, var(--gp-primary) 60%, transparent)" : undefined,
                }}
              >
                {featured && (
                  <span className="absolute -top-3 left-8 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ background: "var(--gp-accent)", color: "var(--gp-accent-foreground)" }}>
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold" style={{ color: "var(--gp-text)" }}>{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-semibold" style={{ color: "var(--gp-text)" }}>{tier.price}</span>
                  {tier.period && <span className="text-sm" style={{ color: "var(--gp-muted)" }}>/{tier.period}</span>}
                </div>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {tier.features.map((f, j) => (
                    <li key={j} className="flex gap-2" style={{ color: "var(--gp-muted)" }}>
                      <span aria-hidden style={{ color: "var(--gp-accent-ink)" }}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {tier.cta_label && tier.cta_href && (
                  <div className="mt-8">
                    <CtaButton label={tier.cta_label} href={tier.cta_href} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FaqBlock({ block }: { block: Extract<GrowthBlock, { type: "faq" }> }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className={SECTION}>
      <div className={WRAP_NARROW}>
        <SectionHead title={block.title} />
        <div className="divide-y" style={{ borderColor: "color-mix(in srgb, var(--gp-text) 12%, transparent)" }}>
          {block.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderColor: "color-mix(in srgb, var(--gp-text) 12%, transparent)" }} className="border-t first:border-t-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left"
                >
                  <span className="text-base font-medium md:text-lg" style={{ color: "var(--gp-text)" }}>{item.question}</span>
                  <span aria-hidden className="shrink-0 text-xl transition-transform" style={{ color: "var(--gp-accent-ink)", transform: isOpen ? "rotate(45deg)" : "none" }}>+</span>
                </button>
                {isOpen && <p className="pb-5 pr-8 text-sm leading-relaxed" style={{ color: "var(--gp-muted)" }}>{item.answer}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MediaBlock({ block }: { block: Extract<GrowthBlock, { type: "media" }> }) {
  const src = block.provider !== "mp4" ? embedUrl(block.provider, block.url) : null;
  return (
    <section className={SECTION}>
      <div className={WRAP_NARROW}>
        <SectionHead title={block.title} />
        <Frame>
          <div className="aspect-video w-full bg-black">
            {block.provider === "mp4" ? (
              <video src={block.url} controls playsInline className="h-full w-full" />
            ) : src ? (
              <iframe
                src={src}
                title={block.title || "Embedded video"}
                className="h-full w-full"
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            ) : null}
          </div>
        </Frame>
        {block.caption && <p className="mt-3 text-center text-sm" style={{ color: "var(--gp-muted)" }}>{block.caption}</p>}
      </div>
    </section>
  );
}

function StatsBlock({ block }: { block: Extract<GrowthBlock, { type: "stats" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <SectionHead title={block.title} />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {block.items.map((s, i) => (
            <div key={i} className="text-center">
              <div className="font-display text-4xl font-semibold tabular-nums md:text-5xl" style={{ color: "var(--gp-accent-ink)" }}>{s.value}</div>
              <div className="mt-2 text-sm" style={{ color: "var(--gp-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CountdownBlock({ block }: { block: Extract<GrowthBlock, { type: "countdown" }> }) {
  const target = useMemo(() => new Date(block.ends_at).getTime(), [block.ends_at]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isNaN(target)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const diff = Math.max(0, target - now);
  const expired = !isNaN(target) && diff <= 0;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const units: { v: number; l: string }[] = [
    { v: d, l: "Days" }, { v: h, l: "Hours" }, { v: m, l: "Minutes" }, { v: s, l: "Seconds" },
  ];

  return (
    <section className={SECTION}>
      <div className={`${WRAP_NARROW} rounded-3xl px-8 py-14 text-center`} style={{ ...cardStyle, background: "var(--gp-surface)" }}>
        {block.title && <Heading className="text-2xl md:text-3xl">{block.title}</Heading>}
        {block.subtitle && <Lede className="mx-auto mt-3 max-w-lg">{block.subtitle}</Lede>}
        {expired ? (
          <p className="mt-8 text-xl font-semibold" style={{ color: "var(--gp-accent-ink)" }}>{block.expired_text || "This has ended."}</p>
        ) : (
          <div className="mt-8 flex justify-center gap-4 md:gap-6">
            {units.map((u, i) => (
              <div key={i} className="flex min-w-[64px] flex-col items-center rounded-xl px-3 py-4" style={{ border: hairline, background: "color-mix(in srgb, var(--gp-text) 4%, transparent)" }}>
                <span className="font-display text-3xl font-semibold tabular-nums md:text-4xl" style={{ color: "var(--gp-text)" }}>{String(u.v).padStart(2, "0")}</span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--gp-muted)" }}>{u.l}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TwoColumnBlock({ block }: { block: Extract<GrowthBlock, { type: "two_column" }> }) {
  const imageRight = block.image_side !== "left";
  const img = block.image_url ? (
    <Frame>
      <img src={block.image_url} alt="" className="aspect-[4/3] w-full object-cover" />
    </Frame>
  ) : null;
  const copy = (
    <div className="space-y-5">
      {block.heading && <Heading className="text-3xl md:text-4xl">{block.heading}</Heading>}
      {block.body && <Lede>{block.body}</Lede>}
      {block.cta_label && block.cta_href && <div className="pt-2"><CtaButton label={block.cta_label} href={block.cta_href} /></div>}
    </div>
  );
  return (
    <section className={SECTION}>
      <div className={`${WRAP} grid items-center gap-10 md:grid-cols-2 md:gap-16`}>
        {img && imageRight ? <>{copy}{img}</> : img ? <>{img}{copy}</> : copy}
      </div>
    </section>
  );
}

function ImageBlock({ block }: { block: Extract<GrowthBlock, { type: "image" }> }) {
  return (
    <section className="px-6 md:px-10 py-12">
      <figure className={WRAP}>
        <Frame>
          <img src={block.url} alt={block.alt || ""} className="w-full object-cover" />
        </Frame>
        {block.caption && <figcaption className="mt-3 text-center text-sm" style={{ color: "var(--gp-muted)" }}>{block.caption}</figcaption>}
      </figure>
    </section>
  );
}

function GalleryBlock({ block }: { block: Extract<GrowthBlock, { type: "gallery" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP}>
        <SectionHead title={block.title} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {block.images.map((img, i) => (
            <figure key={i}>
              <Frame>
                <img src={img.url} alt={img.alt || ""} className="aspect-square w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              </Frame>
              {img.caption && <figcaption className="mt-2 text-xs" style={{ color: "var(--gp-muted)" }}>{img.caption}</figcaption>}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepsBlock({ block }: { block: Extract<GrowthBlock, { type: "steps" }> }) {
  return (
    <section className={SECTION}>
      <div className={WRAP_NARROW}>
        <SectionHead title={block.title} />
        <ol className="space-y-8">
          {block.items.map((step, i) => (
            <li key={i} className="flex gap-5">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg font-semibold"
                style={{ background: "color-mix(in srgb, var(--gp-accent-ink) 14%, transparent)", color: "var(--gp-accent-ink)", border: "1px solid color-mix(in srgb, var(--gp-accent-ink) 40%, transparent)" }}
              >
                {step.number || i + 1}
              </span>
              <div className="pt-1">
                <h3 className="text-lg font-semibold" style={{ color: "var(--gp-text)" }}>{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--gp-muted)" }}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── chatbot: the tenant's own Paige, inline on the published site ─────────────
// Scoped to the block (never a full-screen takeover). The tenant is resolved SERVER-SIDE by
// the public slug in the route — the client sends the slug, never a tenant identity it made up.
// On the studio canvas (no tenantId / no public slug) it renders a graceful static preview so
// the section never crashes or calls a live endpoint it can't be authorized for.
type ChatMsg = { role: "user" | "assistant"; content: string };

function ChatbotBlock({ block, tenantId }: { block: Extract<GrowthBlock, { type: "chatbot" }>; tenantId?: string }) {
  const { tenantSlug } = useParams();
  const reduceMotion = useReducedMotion();
  const greeting = (block.greeting || "").trim() || "Hi — ask me anything, and I'll help you find your way.";
  const placeholder = (block.placeholder || "").trim() || "Type your question…";
  const title = (block.title || "").trim();

  const live = !!tenantId && !!tenantSlug;

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveRegionId = useMemo(() => `paige-chat-log-${Math.random().toString(36).slice(2, 8)}`, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, sending, reduceMotion]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending || !live) return;
    setError(null);
    const nextHistory = messages.slice(-12);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("paige-public-chat", {
        body: {
          slug: tenantSlug,
          message: text,
          history: nextHistory,
          ...(convId.current ? { conversation_id: convId.current } : {}),
        },
      });
      if (fnErr) throw fnErr;
      if (!data?.ok || typeof data?.reply !== "string") throw new Error("generic");
      if (data.conversation_id) convId.current = data.conversation_id as string;
      setMessages((m) => [...m, { role: "assistant", content: data.reply as string }]);
    } catch (err) {
      // On a non-2xx the invoke throws with the Response on `.context`; sniff a 429 so we can
      // show the softer "slow down" copy. Any failure to read it just falls back to generic.
      let rate = false;
      try {
        const ctx = (err as { context?: Response })?.context;
        if (ctx && typeof ctx.status === "number") rate = ctx.status === 429;
      } catch { /* ignore */ }
      setError(rate
        ? "You're sending messages a little fast — give it a moment and try again."
        : "Something went sideways on my end. Try again in a moment, or use the contact options on this page.");
    } finally {
      setSending(false);
    }
  }

  const bubbleBase = "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed";
  const panel = (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl"
      style={{ ...cardStyle, background: "var(--gp-surface)" }}
    >
      {/* header */}
      <div className="flex items-center gap-3 px-6 py-4" style={{ borderBottom: hairline }}>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: "color-mix(in srgb, var(--gp-accent-ink) 16%, transparent)", color: "var(--gp-accent-ink)", border: "1px solid color-mix(in srgb, var(--gp-accent-ink) 40%, transparent)" }}
          aria-hidden
        >
          P
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: "var(--gp-text)" }}>{title || "Chat with us"}</div>
          <div className="truncate text-xs" style={{ color: "var(--gp-muted)" }}>Usually replies in a few seconds</div>
        </div>
      </div>

      {/* transcript */}
      <div
        ref={scrollRef}
        id={liveRegionId}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        className="flex max-h-[24rem] min-h-[13rem] flex-col gap-3 overflow-y-auto px-6 py-5"
      >
        <div className="flex justify-start">
          <div className={bubbleBase} style={{ background: "color-mix(in srgb, var(--gp-text) 6%, transparent)", color: "var(--gp-text)" }}>
            {greeting}
          </div>
        </div>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className={bubbleBase} style={{ background: "var(--gp-primary)", color: "var(--gp-primary-foreground)" }}>
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className={`${bubbleBase} whitespace-pre-wrap`} style={{ background: "color-mix(in srgb, var(--gp-text) 6%, transparent)", color: "var(--gp-text)" }}>
                {m.content}
              </div>
            </div>
          ),
        )}
        {sending && (
          <div className="flex justify-start">
            <div className={`${bubbleBase} flex items-center gap-1.5`} style={{ background: "color-mix(in srgb, var(--gp-text) 6%, transparent)" }} aria-label="Assistant is typing">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className={reduceMotion ? "" : "animate-pulse"}
                  style={{ width: 6, height: 6, borderRadius: 999, background: "var(--gp-muted)", animationDelay: `${d * 160}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-start">
            <div className={bubbleBase} style={{ background: "color-mix(in srgb, var(--gp-text) 6%, transparent)", color: "var(--gp-muted)" }} role="status">
              {error}
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <form onSubmit={send} className="flex items-end gap-2 px-4 py-3" style={{ borderTop: hairline }}>
        <label htmlFor={`${liveRegionId}-input`} className="sr-only">Your message</label>
        <textarea
          id={`${liveRegionId}-input`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          rows={1}
          disabled={!live || sending}
          placeholder={live ? placeholder : "Chat is live on your published page."}
          maxLength={2000}
          className="min-h-[2.75rem] max-h-32 flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none disabled:opacity-60"
          style={{
            background: "var(--gp-bg)",
            color: "var(--gp-text)",
            border: hairline,
            fontFamily: "var(--gp-font)",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--gp-primary)"; e.currentTarget.style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--gp-primary) 24%, transparent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--gp-text) 14%, transparent)"; e.currentTarget.style.boxShadow = "none"; }}
        />
        {/* Gold is spent ONLY here — the act/send moment (§11). */}
        <button
          type="submit"
          disabled={!live || sending || !input.trim()}
          aria-label="Send message"
          className={`${GP_PRESS} inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-[filter,opacity] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45`}
          style={{ background: "var(--gp-accent)", color: "var(--gp-accent-foreground)" }}
        >
          Send
          <span aria-hidden>↑</span>
        </button>
      </form>
    </div>
  );

  return (
    <section className={SECTION}>
      <div className={WRAP}>
        {(title || !live) && (
          <SectionHead
            title={title || "Chat with us"}
            subtitle={live ? undefined : "This is a preview. On your published page, visitors chat live with your Paige here."}
          />
        )}
        {panel}
      </div>
    </section>
  );
}

// ── single-block dispatcher (exported for callers that render one block) ──────
export function BlockRenderer({ block, tenantId }: { block: GrowthBlock; tenantId?: string }) {
  switch (block.type) {
    case "hero": return <HeroBlock block={block} />;
    case "hero_scene": return <HeroSceneBlock block={block} />;
    case "phase_cards": return <PhaseCardsBlock block={block} />;
    case "feature_grid": return <FeatureGridBlock block={block} />;
    case "cta": return <CtaBlock block={block} />;
    case "rich_text": return <RichTextBlock block={block} />;
    case "embedded_form": return <EmbeddedFormBlock block={block} tenantId={tenantId} />;
    case "social_proof": return <SocialProofBlock block={block} />;
    case "testimonial": return <TestimonialBlock block={block} />;
    case "pricing": return <PricingBlock block={block} />;
    case "faq": return <FaqBlock block={block} />;
    case "media": return <MediaBlock block={block} />;
    case "stats": return <StatsBlock block={block} />;
    case "countdown": return <CountdownBlock block={block} />;
    case "two_column": return <TwoColumnBlock block={block} />;
    case "image": return <ImageBlock block={block} />;
    case "gallery": return <GalleryBlock block={block} />;
    case "steps": return <StepsBlock block={block} />;
    case "chatbot": return <ChatbotBlock block={block} tenantId={tenantId} />;
    default: return null;
  }
}

export interface GrowthBlocksProps {
  blocks: GrowthBlock[];
  theme?: GrowthPageTheme | null;
  brandFloor?: GrowthPageTheme | null;
  /** Tenant id — lets `embedded_form` resolve a live form. Absent in bare preview. */
  tenantId?: string;
  /** Rendered inside the themed scope, after the blocks (e.g. a page footer). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The themed scope + block list. This is the single tree the public page and the Studio
 * preview both mount — one renderer, one theme resolver, so what you preview is what
 * publishes.
 */
export function GrowthBlocks({ blocks, theme, brandFloor, tenantId, children, className = "" }: GrowthBlocksProps) {
  const vars = resolveGrowthTheme(theme, brandFloor);
  // Brand fonts: load ONLY the resolved display + body faces, into the document this tree is actually
  // in (the Studio canvas is an iframe). `data-gp-font="brand"` arms the scoped heading rule in
  // ./growth-brand-fonts.css; without a library font the page keeps today's type exactly.
  const fontPair = resolveGrowthFontPair(theme, brandFloor);
  const scopeRef = useRef<HTMLDivElement>(null);
  useBrandFontFaces(scopeRef, fontPair ? [fontPair.display, fontPair.body] : []);
  const scopeStyle = {
    ...(vars as GrowthThemeVars),
    background: "var(--gp-bg)",
    color: "var(--gp-text)",
    fontFamily: "var(--gp-font)",
    minHeight: "100dvh",
  } as React.CSSProperties;

  const bands = useMemo(() => assignBands(blocks ?? []), [blocks]);

  return (
    <div ref={scopeRef} data-gp="" data-gp-font={fontPair ? "brand" : undefined} className={className} style={scopeStyle}>
      {(blocks ?? []).map((block, i) => (
        <div key={i} className={GP_FADE_RISE} style={{ ...fadeRiseStyle(i), ...bandStyle(bands[i]) }}>
          <BlockRenderer block={block} tenantId={tenantId} />
        </div>
      ))}
      {children}
    </div>
  );
}

export default GrowthBlocks;
