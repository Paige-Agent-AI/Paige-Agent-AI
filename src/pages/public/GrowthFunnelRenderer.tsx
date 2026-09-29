// Public funnel runner: walks a visitor through the ordered steps of a funnel
// (page → form → thankyou), one step at a time.
//
// The page step renders through the SHARED <GrowthBlocks> — the exact component (and the
// exact resolveGrowthTheme token map) that draws /p/:tenantSlug/:pageSlug and the Studio
// live preview. A page reached through a funnel is the SAME page: canvas == published ==
// funnel, no third renderer to drift. This file owns only data loading, the brand floor,
// the step machine, and the advance affordance.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type {
  GrowthBlock,
  GrowthFunnelStepConfig,
  GrowthFunnelStepType,
  GrowthPageTheme,
} from "@/lib/growth";
import { GrowthBlocks } from "@/components/growth/GrowthBlocks";
import { resolveGrowthTheme, GROWTH_BRAND_FLOOR, buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import { GP_FADE_RISE, GP_PRESS, fadeRiseStyle, useReducedMotion } from "@/components/growth/growth-motion";
import { GrowthFormEmbed } from "@/pages/public/GrowthFormRenderer";

interface Funnel {
  id: string;
  tenant_id: string;
  name: string;
}

interface Step {
  id: string;
  step_type: GrowthFunnelStepType;
  order_index: number;
  page_id: string | null;
  form_id: string | null;
  config_json: GrowthFunnelStepConfig | null;
}

// Only what the renderer needs from the page row (same shape the public page reads).
interface PageRow {
  id: string;
  title: string;
  blocks_json: GrowthBlock[];
  theme_json: GrowthPageTheme;
  tenant_id: string;
}

// Anon-safe brand peek shape (peek_tenant_portal_brand, keyed by slug).
interface PortalBrand {
  primary_color: string | null;
  accent_color: string | null;
  font: string | null;
  logo_url: string | null;
}

// ── step config readers (config-as-data, §10 — the label is authored, not hardcoded) ──
function pageCtaLabel(config: GrowthFunnelStepConfig | null): string {
  const cfg = config as { cta_label?: unknown } | null;
  const label = typeof cfg?.cta_label === "string" ? cfg.cta_label.trim() : "";
  return label || "Continue";
}

function thankYouCopy(config: GrowthFunnelStepConfig | null): { headline: string; message: string } {
  const cfg = config as { headline?: unknown; message?: unknown } | null;
  const headline = typeof cfg?.headline === "string" ? cfg.headline.trim() : "";
  const message = typeof cfg?.message === "string" ? cfg.message.trim() : "";
  return {
    headline: headline || "You're in.",
    message: message || "We'll be in touch shortly.",
  };
}

export default function GrowthFunnelRenderer() {
  const { tenantSlug, funnelSlug } = useParams();
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!tenantSlug || !funnelSlug) return;
    (async () => {
      const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
      if (!tenant) { setNotFound(true); setLoading(false); return; }
      const { data: f } = await supabase.from("growth_funnels")
        .select("id,tenant_id,name")
        .eq("tenant_id", tenant.id)
        .eq("slug", funnelSlug)
        .eq("status", "active")
        .maybeSingle();
      if (!f) { setNotFound(true); setLoading(false); return; }
      setFunnel(f as Funnel);
      const { data: st } = await supabase.from("growth_funnel_steps")
        .select("id,step_type,order_index,page_id,form_id,config_json")
        .eq("funnel_id", f.id)
        .order("order_index");
      setSteps((st ?? []) as unknown as Step[]);
      // Tenant brand FLOOR (anon-safe, SECURITY DEFINER, keyed by the slug in the route) so
      // every step of the funnel wears its coach's brand (§6). A brand miss is not a funnel
      // miss — the resolver falls through to the on-brand floor.
      // `peek_tenant_portal_brand` is absent from the generated Database types (they predate the
      // migration that added it), so the RPC name does not typecheck against the union. One narrow
      // cast here rather than an `as any` — the result is still checked against PortalBrand below.
      const call = supabase.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data: brandData } = await call("peek_tenant_portal_brand", { _slug: tenantSlug });
      const row = Array.isArray(brandData) ? (brandData[0] as PortalBrand | undefined) : (brandData as PortalBrand | null);
      if (row) setBrand(row);
      setLoading(false);
    })();
  }, [tenantSlug, funnelSlug]);

  useEffect(() => {
    if (funnel?.name) document.title = funnel.name;
  }, [funnel?.name]);

  // Land each new step at the top rather than mid-scroll from the previous one.
  useEffect(() => {
    if (idx === 0) return;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [idx, reduced]);

  // The tenant brand becomes the FLOOR; each page's own theme_json overrides it. Both are
  // fed to the ONE resolver inside <GrowthBlocks>, so a funnel page themes exactly as the
  // same page does when it's served standalone.
  const brandFloor = useMemo<GrowthPageTheme>(() => buildGrowthBrandFloor(brand), [brand]);

  if (loading) return <FunnelSkeleton brandFloor={brandFloor} />;
  if (notFound || !funnel) {
    return (
      <FunnelNotice
        brandFloor={brandFloor}
        title="Funnel not found"
        body="This funnel may have moved or is no longer live."
      />
    );
  }
  if (steps.length === 0) {
    return (
      <FunnelNotice
        brandFloor={brandFloor}
        title="Nothing to show yet"
        body="This funnel doesn't have any steps live right now. Check back shortly."
      />
    );
  }

  const step = steps[idx];
  const next = () => setIdx((i) => i + 1);
  const hasNext = idx < steps.length - 1;

  // Advanced past the last step (a funnel that ends on a page rather than a thankyou).
  if (!step) {
    return <FunnelNotice brandFloor={brandFloor} title="You're all set." body="Thanks — we'll be in touch shortly." glyph />;
  }

  if (step.step_type === "page") {
    if (!step.page_id) {
      return <StepUnavailable brandFloor={brandFloor} ctaLabel={pageCtaLabel(step.config_json)} onNext={next} />;
    }
    return (
      <FunnelPageStep
        key={step.id}
        pageId={step.page_id}
        brandFloor={brandFloor}
        ctaLabel={pageCtaLabel(step.config_json)}
        onNext={next}
      />
    );
  }

  if (step.step_type === "form") {
    if (!step.form_id) {
      return <StepUnavailable brandFloor={brandFloor} ctaLabel="Continue" onNext={next} />;
    }
    return (
      <FunnelFormStep
        key={step.id}
        formId={step.form_id}
        brandFloor={brandFloor}
        // Advance the funnel on a completed submission — but only when a step follows. If this
        // form ends the funnel, it keeps its own authored success state.
        onComplete={hasNext ? next : undefined}
        onSkip={next}
      />
    );
  }

  if (step.step_type === "thankyou") {
    const { headline, message } = thankYouCopy(step.config_json);
    return <FunnelNotice brandFloor={brandFloor} title={headline} body={message} glyph />;
  }

  // Step types on the roadmap (booking, payment) — never strand the visitor mid-funnel.
  return <StepUnavailable brandFloor={brandFloor} ctaLabel="Continue" onNext={next} />;
}

// ── the page step: the real renderer, nothing forked ─────────────────────────
// Loads the page exactly as GrowthPageRenderer does (published only — a funnel is a public
// surface and must show what the public sees, never a draft) and mounts <GrowthBlocks>.
// The advance action rides in the children slot, INSIDE the themed `--gp-*` scope.
function FunnelPageStep({
  pageId,
  brandFloor,
  ctaLabel,
  onNext,
}: {
  pageId: string;
  brandFloor: GrowthPageTheme;
  ctaLabel: string;
  onNext: () => void;
}) {
  const [page, setPage] = useState<PageRow | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      const { data } = await supabase.from("growth_pages")
        .select("id,title,blocks_json,theme_json,tenant_id")
        .eq("id", pageId)
        .eq("status", "published")
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setState("missing"); return; }
      setPage(data as unknown as PageRow);
      setState("ready");
    })();
    return () => { cancelled = true; };
  }, [pageId]);

  if (state === "loading") return <FunnelSkeleton brandFloor={brandFloor} />;
  if (state === "missing" || !page) {
    // The step's page isn't published — say so honestly, and still let them move on.
    return (
      <StepUnavailable brandFloor={brandFloor} ctaLabel={ctaLabel} onNext={onNext} />
    );
  }

  return (
    <GrowthBlocks
      blocks={page.blocks_json ?? []}
      theme={page.theme_json}
      brandFloor={brandFloor}
      tenantId={page.tenant_id}
    >
      <AdvanceBar label={ctaLabel} onNext={onNext} />
    </GrowthBlocks>
  );
}

// ── the form step: the one public form embed, with the funnel's own loading and missing states ─
// A form that is not live (inactive, or its business is not taking submissions) never strands the
// visitor on an empty section: it becomes the same "not ready" step as any other missing step.
function FunnelFormStep({ formId, brandFloor, onComplete, onSkip }: {
  formId: string; brandFloor: GrowthPageTheme; onComplete?: () => void; onSkip: () => void;
}) {
  const [missing, setMissing] = useState(false);
  if (missing) return <StepUnavailable brandFloor={brandFloor} ctaLabel="Continue" onNext={onSkip} />;
  return (
    <Scope brandFloor={brandFloor} className="px-6 py-16 md:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <GrowthFormEmbed
          formId={formId}
          accent="var(--gp-accent)"
          onComplete={onComplete}
          loading={<FormSkeleton />}
          onUnavailable={() => setMissing(true)}
        />
      </div>
    </Scope>
  );
}

// ── the advance affordance ───────────────────────────────────────────────────
// The funnel's own "next" action, drawn on the page's resolved theme (--gp-accent fill,
// AA-clamped --gp-accent-foreground ink) so it reads as part of the page, not a stray
// browser button. Same visual language as the CTA buttons inside <GrowthBlocks>.
function AdvanceButton({ label, onNext }: { label: string; onNext: () => void }) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onNext}
      className={`inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-base font-semibold shadow-lg transition-[filter,box-shadow] hover:brightness-95 ${reduced ? "" : GP_PRESS}`}
      style={{ background: "var(--gp-accent)", color: "var(--gp-accent-foreground)" }}
    >
      {label}
      <span aria-hidden>→</span>
    </button>
  );
}

// Page-step footer: the advance action on a hairline rule, on the page's spacing rhythm.
// Rendered in the <GrowthBlocks> children slot, so it inherits the same `--gp-*` scope the
// blocks above it were drawn with.
function AdvanceBar({ label, onNext }: { label: string; onNext: () => void }) {
  const reduced = useReducedMotion();
  return (
    <section className="px-6 pb-16 md:px-10 md:pb-24">
      <div
        className={`mx-auto flex w-full max-w-6xl justify-center border-t pt-10 ${reduced ? "" : GP_FADE_RISE}`}
        style={{
          borderColor: "color-mix(in srgb, var(--gp-text) 12%, transparent)",
          ...(reduced ? {} : fadeRiseStyle(0)),
        }}
      >
        <AdvanceButton label={label} onNext={onNext} />
      </div>
    </section>
  );
}

// ── themed chrome (mirrors GrowthPageRenderer's skeleton / not-found posture) ──
// One `--gp-*` scope for the non-block steps, so the funnel reads as one continuous
// system from step to step. Never a bare "Loading…" or a raw not-found line (§11).
function Scope({
  brandFloor,
  className = "",
  children,
}: {
  brandFloor?: GrowthPageTheme | null;
  className?: string;
  children: React.ReactNode;
}) {
  const vars = resolveGrowthTheme(null, brandFloor);
  return (
    <div
      className={className}
      style={{
        ...(vars as Record<string, string>),
        background: "var(--gp-bg)",
        color: "var(--gp-text)",
        fontFamily: "var(--gp-font)",
        minHeight: "100dvh",
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function FunnelSkeleton({ brandFloor }: { brandFloor?: GrowthPageTheme | null }) {
  const bar = "rounded-lg gp-shimmer";
  return (
    <Scope brandFloor={brandFloor}>
      <div className="mx-auto w-full max-w-6xl px-6 py-24 md:px-10 md:py-36" aria-hidden>
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <div className={`${bar} mx-auto h-6 w-40`} />
          <div className={`${bar} mx-auto h-14 w-full max-w-2xl`} />
          <div className={`${bar} mx-auto h-14 w-3/4`} />
          <div className={`${bar} mx-auto h-5 w-1/2`} />
          <div className={`${bar} mx-auto mt-4 h-12 w-44`} />
        </div>
        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className={`${bar} h-52 w-full`} />)}
        </div>
      </div>
    </Scope>
  );
}

function FormSkeleton() {
  const bar = "rounded-lg gp-shimmer";
  return (
    <div className="space-y-5" aria-hidden>
      <div className={`${bar} h-8 w-1/2`} />
      <div className={`${bar} h-11 w-full`} />
      <div className={`${bar} h-11 w-full`} />
      <div className={`${bar} h-11 w-2/3`} />
      <div className={`${bar} h-12 w-40`} />
    </div>
  );
}

// A crafted, themed message state — used for not-found, an empty funnel, and completion.
function FunnelNotice({
  brandFloor,
  title,
  body,
  glyph = false,
}: {
  brandFloor?: GrowthPageTheme | null;
  title: string;
  body: string;
  glyph?: boolean;
}) {
  return (
    <Scope brandFloor={brandFloor} className="flex flex-col items-center justify-center px-6 text-center">
      {glyph && (
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-full text-2xl"
          style={{
            background: "color-mix(in srgb, var(--gp-accent-ink) 14%, transparent)",
            color: "var(--gp-accent-ink)",
            border: "1px solid color-mix(in srgb, var(--gp-accent-ink) 40%, transparent)",
          }}
          aria-hidden
        >
          ✓
        </div>
      )}
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: "var(--gp-muted)" }}>{body}</p>
    </Scope>
  );
}

// A step whose target isn't live (unpublished page, unlinked form, roadmap step type).
// Truthful about the state and still moves the visitor forward — never a dead end (§13).
function StepUnavailable({
  brandFloor,
  ctaLabel,
  onNext,
}: {
  brandFloor: GrowthPageTheme;
  ctaLabel: string;
  onNext: () => void;
}) {
  return (
    <Scope brandFloor={brandFloor} className="flex flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-3xl font-semibold tracking-tight">This step isn't ready yet</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: "var(--gp-muted)" }}>
        Nothing is live here right now. You can keep going.
      </p>
      <div className="mt-8">
        <AdvanceButton label={ctaLabel} onNext={onNext} />
      </div>
    </Scope>
  );
}
