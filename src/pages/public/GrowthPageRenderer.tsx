// Public landing page renderer — reads growth_pages.blocks_json by tenant slug + page slug.
// Anyone (including logged-out visitors) can view a published page thanks to the RLS
// `growth_pages_public_read_published` policy.
//
// The RENDERING core is the shared <GrowthBlocks>: the exact same component (and the exact
// same resolveGrowthTheme token map) that draws the Studio live preview. Preview ==
// published — there is no second renderer to drift. The brand floor + footer live in the
// shared <GrowthPageView>, which the DB-free /render-frame (paige-browser screenshots) also
// mounts. This file owns only data loading and the loading / not-found chrome.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";
import { GrowthPageView } from "@/components/growth/GrowthPageView";
import { resolveGrowthTheme } from "@/components/growth/growth-theme";

interface PageRow {
  id: string;
  title: string;
  status: string;
  blocks_json: GrowthBlock[];
  theme_json: GrowthPageTheme;
  seo_json: { description?: string; og_image?: string };
  og_image_url: string | null;
  tenant_id: string;
}

// Anon-safe brand peek shape (peek_tenant_portal_brand, keyed by slug).
interface PortalBrand {
  primary_color: string | null;
  accent_color: string | null;
  font: string | null;
  logo_url: string | null;
}

export default function GrowthPageRenderer() {
  const { tenantSlug, pageSlug } = useParams();
  const [page, setPage] = useState<PageRow | null>(null);
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !pageSlug) return;
    (async () => {
      const { data: tenant } = await supabase.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
      if (!tenant) { setNotFound(true); setLoading(false); return; }
      const { data } = await supabase.from("growth_pages")
        .select("id,title,status,blocks_json,theme_json,seo_json,og_image_url,tenant_id")
        .eq("tenant_id", tenant.id)
        .eq("slug", pageSlug)
        .eq("status", "published")
        .maybeSingle();
      if (!data) { setNotFound(true); setLoading(false); return; }
      setPage(data as unknown as PageRow);
      // Resolve the tenant brand FLOOR (anon-safe, SECURITY DEFINER, keyed by the
      // slug in the route) so a published page wears its coach's brand (§6). A transient
      // brand miss is not a page miss — the resolver falls through to the on-brand floor.
      //
      // `get: true` sends this as a GET. The function is STABLE (checked on production 2026-10-04,
      // provolatile 's'), so PostgREST serves it read-only — and paige-browser's read-only egress
      // fence, which aborts every POST, can now load the brand when it screenshots a published page.
      try {
        const { data: brandData } = await supabase.rpc("peek_tenant_portal_brand", { _slug: tenantSlug }, { get: true });
        const row = Array.isArray(brandData) ? (brandData[0] as PortalBrand | undefined) : (brandData as PortalBrand | null);
        if (row) setBrand(row);
      } catch (e) {
        console.error("[growth-page] brand lookup failed; rendering on the brand floor:", e);
      }
      setLoading(false);
    })();
  }, [tenantSlug, pageSlug]);

  useEffect(() => {
    if (page?.title) document.title = page.title;
  }, [page?.title]);

  if (loading) return <PageSkeleton />;
  if (notFound || !page) return <><NotFound /><PageReadyMarker state="missing" /></>;

  // The tenant brand becomes the FLOOR; the page's own theme_json overrides it. Both are fed to
  // the ONE resolver inside <GrowthBlocks> by the shared <GrowthPageView>.
  return (
    <>
      <GrowthPageView blocks={page.blocks_json} theme={page.theme_json} brand={brand} tenantId={page.tenant_id} />
      <PageReadyMarker state="true" />
    </>
  );
}

// Present only once the page row AND its brand (or the brand's failure) have settled — what
// paige-browser's /render waits on for a published page. The app-wide [data-app-ready] fires at
// mount, before this data arrives, so it cannot stand in. "missing" = no such published page.
function PageReadyMarker({ state }: { state: "true" | "missing" }) {
  return <div data-growth-page-ready={state} hidden aria-hidden="true" />;
}

// Themed skeleton — a masthead + card grid shimmer on the on-brand floor. Never a bare
// "Loading…" (§11). Uses the same `--gp-*` scope the real page will, so the transition in
// is seamless.
function PageSkeleton() {
  const vars = resolveGrowthTheme(null, null);
  const bar = "rounded-lg gp-shimmer";
  return (
    <div style={{ ...(vars as Record<string, string>), background: "var(--gp-bg)", minHeight: "100dvh", fontFamily: "var(--gp-font)" } as React.CSSProperties} aria-hidden>
      <div className="mx-auto w-full max-w-6xl px-6 md:px-10 py-24 md:py-36">
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
    </div>
  );
}

function NotFound() {
  const vars = resolveGrowthTheme(null, null);
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ ...(vars as Record<string, string>), background: "var(--gp-bg)", color: "var(--gp-text)", fontFamily: "var(--gp-font)" } as React.CSSProperties}
    >
      <h1 className="font-display text-3xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--gp-muted)" }}>This page may have moved or is no longer published.</p>
    </div>
  );
}
