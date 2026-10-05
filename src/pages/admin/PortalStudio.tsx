import { useEffect, useMemo, useRef, useState } from "react";
import {
  Palette, LayoutTemplate, MessageSquareText, Type as TypeIcon,
  ChevronUp, ChevronDown, Loader2, ClipboardList, Eye,
} from "lucide-react";
import { PageShell } from "@/components/ui/page/PageShell";
import { PageHeader } from "@/components/ui/page/PageHeader";
import { SectionCard } from "@/components/ui/page/SectionCard";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { ColorField, LogoUploader, BrandFontPicker } from "@/components/ui/page/BrandControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useBrandFontFaces } from "@/hooks/useBrandFontFaces";
import { brandFontStack, resolveBrandFontPair } from "@/lib/brand-fonts";
import { usePortalConfig } from "@/hooks/usePortalConfig";
import { usePlaybook } from "@/lib/playbook";
import {
  catalogRoutableItems, applyPortalOverlay, type PortalCatalogItem,
} from "@/lib/portal/moduleNav";
import {
  readableTextOn, isValidHex, PRIMARY_FLOOR, ACCENT_FLOOR,
} from "@/lib/brand/resolveBrand";
import type { PortalModuleOverlay } from "@/hooks/useClientPortalConfig";
import { cn } from "@/lib/utils";

/**
 * Client Portal (§9/§10/§11) — the ONE tenant-facing surface where a tenant skins
 * the client-facing portal (/app): brand (logo, colors, type), which tabs a client
 * sees + their order, the welcome greeting, and a live "View as Client" preview.
 *
 * Two data seams, both Paige-callable:
 *   - Brand  → set_tenant_brand (via useBrandKit).
 *   - Portal → set_tenant_portal_config (via usePortalConfig): a PRESENTATION
 *     OVERLAY over the Playbook module CATALOG — subtractive/reordering only,
 *     never new keys. The preview computes its tab list from the SAME shared
 *     merge (@/lib/portal/moduleNav) the live AppNav uses, so it can't drift (§13).
 *
 * GOLD DISCIPLINE (§11): gold is spent only on the Save act; toggles use the
 * Switch's own styling; the mock's single "Get started" CTA wears the tenant's
 * OWN accent (brand data), never a resting decoration.
 */

interface TabRow {
  key: string;
  label: string;
  icon: PortalCatalogItem["icon"];
  visible: boolean;
}

/** Order the FULL catalog (visible + hidden) the way the overlay resolves it, so
 *  the editor shows tabs in the exact order a client sees them, hidden ones in
 *  place. Mirrors applyPortalOverlay's sort, but keeps hidden rows. */
function seedRows(catalog: PortalCatalogItem[], overlay: PortalModuleOverlay[] | undefined): TabRow[] {
  const byKey = new Map<string, PortalModuleOverlay>();
  if (Array.isArray(overlay)) {
    for (const o of overlay) if (o && typeof o.key === "string") byKey.set(o.key, o);
  }
  return [...catalog]
    .sort((a, b) => {
      const ao = byKey.get(a.key)?.order;
      const bo = byKey.get(b.key)?.order;
      const aEff = typeof ao === "number" && Number.isFinite(ao) ? ao : a.catalogIndex;
      const bEff = typeof bo === "number" && Number.isFinite(bo) ? bo : b.catalogIndex;
      return aEff !== bEff ? aEff - bEff : a.catalogIndex - b.catalogIndex;
    })
    .map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      visible: byKey.get(item.key)?.visible !== false,
    }));
}

export default function PortalStudio() {
  const { activeTenantId } = useTenantContext();
  const { toast } = useToast();
  const bk = useBrandKit(activeTenantId);
  const pc = usePortalConfig(activeTenantId);
  const playbook = usePlaybook();

  const own = bk.state?.own ?? {};
  const eff = bk.state?.effective ?? null;

  const catalog = useMemo(() => catalogRoutableItems(playbook.portal.modules), [playbook]);

  // ── Brand form (subset: colors, type, name, tagline; logos save on upload) ──
  const [brandForm, setBrandForm] = useState({
    primary_color: "", accent_color: "", font: "", product_name: "", tagline: "",
  });
  const brandDirty = useMemo(() => {
    const norm = (v?: string | null) => (v ?? "").trim();
    return (["primary_color", "accent_color", "font", "product_name", "tagline"] as const)
      .some((k) => norm(brandForm[k]) !== norm((own as Record<string, unknown>)[k] as string));
  }, [brandForm, own]);

  const brandSeeded = useRef(false);
  useEffect(() => {
    if (!bk.state) return;
    if (brandSeeded.current && brandDirty) return;
    setBrandForm({
      primary_color: own.primary_color ?? "",
      accent_color: own.accent_color ?? "",
      font: own.font ?? "",
      product_name: own.product_name ?? "",
      tagline: own.tagline ?? "",
    });
    brandSeeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bk.state?.own]);

  // ── Portal overlay editor (tabs + welcome) ──
  const [rows, setRows] = useState<TabRow[]>([]);
  const [welcome, setWelcome] = useState({ headline: "", subhead: "" });

  const initialRows = useMemo(() => seedRows(catalog, pc.config.modules), [catalog, pc.config]);
  const initialWelcome = useMemo(
    () => ({ headline: pc.config.welcome?.headline ?? "", subhead: pc.config.welcome?.subhead ?? "" }),
    [pc.config],
  );
  const baselineKey = useMemo(
    () => JSON.stringify({
      r: initialRows.map((r) => ({ k: r.key, v: r.visible })),
      w: initialWelcome,
    }),
    [initialRows, initialWelcome],
  );
  const currentKey = JSON.stringify({
    r: rows.map((r) => ({ k: r.key, v: r.visible })),
    w: welcome,
  });
  const portalSeeded = useRef(false);
  const portalDirty = portalSeeded.current && currentKey !== baselineKey;

  useEffect(() => {
    if (pc.isLoading) return;
    if (portalSeeded.current && portalDirty) return;
    setRows(initialRows);
    setWelcome(initialWelcome);
    portalSeeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineKey, pc.isLoading]);

  // ── Preview brand values (own → inherited → floor), live from the form ──
  const previewPrimary = isValidHex(brandForm.primary_color)
    ? brandForm.primary_color : (eff?.primary_color ?? PRIMARY_FLOOR);
  const previewAccent = isValidHex(brandForm.accent_color)
    ? brandForm.accent_color : (eff?.accent_color ?? ACCENT_FLOOR);
  const previewName = brandForm.product_name.trim() || eff?.product_name || bk.state?.tenantName || "Your brand";
  const previewLogo = own.logo_url || eff?.logo_url || null;
  // Preview type: a library font previews in its REAL faces (display for the greeting, its paired body
  // face for the rest), loaded the same way the published page loads them. Anything else previews as
  // its plain name, exactly as before.
  const previewFontName = brandForm.font || eff?.font || "";
  const previewPair = resolveBrandFontPair(previewFontName);
  const previewFont = previewPair ? brandFontStack(previewPair.body) : previewFontName || undefined;
  const previewDisplayFont = previewPair ? brandFontStack(previewPair.display) : previewFont;
  const previewRef = useRef<HTMLDivElement>(null);
  useBrandFontFaces(previewRef, previewPair ? [previewPair.display, previewPair.body] : []);

  const invalidHex =
    (!!brandForm.primary_color.trim() && !isValidHex(brandForm.primary_color)) ||
    (!!brandForm.accent_color.trim() && !isValidHex(brandForm.accent_color));

  // Preview nav = the SAME overlay merge the live portal runs, fed from the live
  // editor rows so it updates on every toggle/reorder. "Action items" is force-
  // injected after Home for the client exactly as AppNav does it (§8), so the
  // preview reflects what a client truly sees.
  const previewNav = useMemo(() => {
    const overlay = rows.map((r, i): PortalModuleOverlay => ({ key: r.key, visible: r.visible, order: i }));
    const nav = applyPortalOverlay(catalog, overlay);
    const withActions = [...nav];
    if (!withActions.some((i) => i.href === "/app/actions")) {
      const homeIdx = withActions.findIndex((i) => i.href === "/app");
      withActions.splice(homeIdx >= 0 ? homeIdx + 1 : 0, 0, {
        key: "actions", label: "Action items", href: "/app/actions", icon: ClipboardList,
      });
    }
    return withActions;
  }, [catalog, rows]);

  const headlineText = welcome.headline.trim() || "Welcome back";
  const subheadText = welcome.subhead.trim()
    || brandForm.tagline.trim()
    || "Here's where things stand — your next steps are ready when you are.";

  const dirty = brandDirty || portalDirty;
  const busy = bk.saving || pc.saving;
  useBeforeUnloadGuard(dirty || busy);

  const move = (index: number, delta: number) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (brandDirty && invalidHex) {
      toast({ title: "Check your colors", description: "Colors must be a 6-digit hex like #EBB94C.", variant: "destructive" });
      return;
    }
    try {
      if (brandDirty) {
        const patch: Record<string, string> = {};
        (["primary_color", "accent_color", "font", "product_name", "tagline"] as const).forEach((k) => {
          const nextVal = brandForm[k].trim();
          const prevVal = ((own as Record<string, unknown>)[k] ?? "").toString().trim();
          if (nextVal !== prevVal) patch[k] = nextVal;
        });
        await bk.save(patch);
      }
      if (portalDirty) {
        const modules: PortalModuleOverlay[] = rows.map((r, i) => ({ key: r.key, visible: r.visible, order: i }));
        const w: { headline?: string; subhead?: string } = {};
        if (welcome.headline.trim()) w.headline = welcome.headline.trim();
        if (welcome.subhead.trim()) w.subhead = welcome.subhead.trim();
        await pc.save({ modules, welcome: w });
      }
      toast({ title: "Portal saved", description: "Your clients will see this next time they sign in." });
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  if (!activeTenantId) {
    return (
      <PageShell width="wide">
        <PageHeader
          variant="plain" icon={Palette} eyebrow="Client Portal" title="Your client's portal"
          description="Skin the portal your clients live in — brand, tabs, and greeting, in one place."
        />
        <EmptyState icon={Palette} title="No active workspace" description="Pick a workspace to build its client portal." />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        icon={Palette}
        eyebrow="Client Portal"
        title="Your client's portal"
        description="Everything your clients see when they sign in — brand, tabs, and greeting. Set it once; Paige carries it everywhere."
        actions={
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            <Button variant="gold" onClick={() => void handleSave()} disabled={!dirty || busy || (brandDirty && invalidHex)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              Save portal
            </Button>
          </div>
        }
      />

      {bk.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}</div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* ── Authoring ── */}
          <div className="space-y-4">
            {/* BRAND */}
            <SectionCard
              icon={Palette}
              title="Your brand"
              description="The logo, colors, and name your clients see across the portal. Paige builds emails and pages with these too."
            >
              <div className="space-y-4">
                <div className="max-w-xs">
                  <LogoUploader
                    label="Logo" hint="Shown in the portal header. Transparent PNG or SVG works best."
                    kind="logo" url={own.logo_url ?? null}
                    onUpload={bk.setLogo} onClear={bk.clearLogo} busy={bk.saving}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField
                    label="Primary" value={brandForm.primary_color} floor={PRIMARY_FLOOR}
                    onChange={(v) => setBrandForm((f) => ({ ...f, primary_color: v }))}
                    contrastAgainst="#FFFFFF" contrastLabel="On white,"
                  />
                  <ColorField
                    label="Accent" value={brandForm.accent_color} floor={ACCENT_FLOOR}
                    onChange={(v) => setBrandForm((f) => ({ ...f, accent_color: v }))}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium text-foreground">Portal name</span>
                    <Input
                      value={brandForm.product_name} placeholder={bk.state?.tenantName || "Your brand"}
                      onChange={(e) => setBrandForm((f) => ({ ...f, product_name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="portal-brand-typeface" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" /> Typeface
                    </label>
                    <BrandFontPicker
                      id="portal-brand-typeface"
                      value={brandForm.font}
                      onChange={(v) => setBrandForm((f) => ({ ...f, font: v }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Tagline</span>
                  <Input
                    value={brandForm.tagline} placeholder="One line that says what you do."
                    onChange={(e) => setBrandForm((f) => ({ ...f, tagline: e.target.value }))}
                  />
                </div>
              </div>
            </SectionCard>

            {/* TABS */}
            <SectionCard
              icon={LayoutTemplate}
              title="What they see"
              description="Turn tabs on or off and set their order. This is what shows in your client's portal menu."
            >
              {rows.length === 0 ? (
                <EmptyState
                  icon={LayoutTemplate}
                  title="No portal tabs yet"
                  description="Your portal menu comes from your Playbook. Author your modules in Your Paige, then arrange them here."
                />
              ) : (
                <div className="space-y-2">
                  {rows.map((row, i) => {
                    const RowIcon = row.icon;
                    return (
                      <div
                        key={row.key}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                      >
                        <div className="flex flex-col">
                          <button
                            type="button" onClick={() => move(i, -1)} disabled={i === 0}
                            aria-label={`Move ${row.label} up`}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                            aria-label={`Move ${row.label} down`}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <RowIcon className={cn("h-4 w-4 shrink-0", row.visible ? "text-foreground" : "text-muted-foreground")} />
                        <span className={cn("flex-1 text-sm", row.visible ? "text-foreground" : "text-muted-foreground line-through")}>
                          {row.label}
                        </span>
                        <Switch
                          checked={row.visible}
                          onCheckedChange={(v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, visible: v } : r)))}
                          aria-label={`Show ${row.label} in the portal`}
                        />
                      </div>
                    );
                  })}
                  <p className="pt-1 text-xs text-muted-foreground">
                    Home and Action items always show for clients — that's how Paige hands work back and forth.
                  </p>
                </div>
              )}
            </SectionCard>

            {/* WELCOME */}
            <SectionCard
              icon={MessageSquareText}
              title="How they're greeted"
              description="The headline and line your clients land on. Leave blank to use the default."
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Headline</span>
                  <Input
                    value={welcome.headline} placeholder="Welcome back"
                    onChange={(e) => setWelcome((w) => ({ ...w, headline: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium text-foreground">Subhead</span>
                  <Input
                    value={welcome.subhead} placeholder="Here's where things stand — your next steps are ready."
                    onChange={(e) => setWelcome((w) => ({ ...w, subhead: e.target.value }))}
                  />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* ── View as Client (live preview) ── */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <SectionCard
              padded={false}
              icon={Eye}
              title="View as client"
              description="A representative view — not live client data."
            >
              <div className="p-4">
                <div ref={previewRef} className="overflow-hidden rounded-xl border border-border shadow-card">
                  {/* masthead */}
                  <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: previewPrimary }}>
                    {previewLogo ? (
                      <img src={previewLogo} alt="" className="h-6 max-w-[120px] object-contain" />
                    ) : (
                      <span
                        className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold"
                        style={{ background: previewAccent, color: readableTextOn(previewAccent) }}
                      >
                        {previewName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate text-sm font-semibold" style={{ color: readableTextOn(previewPrimary) }}>
                      {previewName}
                    </span>
                  </div>
                  {/* nav */}
                  <div
                    className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/40 px-2.5 py-2"
                    style={{ fontFamily: previewFont }}
                  >
                    {previewNav.map((item, i) => {
                      const NavIcon = item.icon;
                      return (
                        <span
                          key={item.key}
                          className={cn(
                            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
                            i === 0
                              ? "bg-background font-medium text-foreground shadow-sm"
                              : "text-muted-foreground",
                          )}
                        >
                          <NavIcon className="h-3.5 w-3.5" />
                          {item.label}
                        </span>
                      );
                    })}
                  </div>
                  {/* home card */}
                  <div className="space-y-3 p-5" style={{ fontFamily: previewFont }}>
                    <p className="text-base font-semibold text-foreground" style={{ fontFamily: previewDisplayFont }}>{headlineText}</p>
                    <p className="text-sm text-muted-foreground">{subheadText}</p>
                    <button
                      type="button" disabled
                      className="rounded-md px-3.5 py-2 text-xs font-semibold"
                      style={{ background: previewAccent, color: readableTextOn(previewAccent) }}
                    >
                      Get started
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  This updates live as you edit. It's how the portal reads to a signed-in client.
                </p>
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </PageShell>
  );
}
