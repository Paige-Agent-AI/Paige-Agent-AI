import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Palette, MessageSquareText, Type as TypeIcon, Loader2, Eye,
} from "lucide-react";
import { PageShell } from "@/components/ui/page/PageShell";
import { PageHeader } from "@/components/ui/page/PageHeader";
import { SectionCard } from "@/components/ui/page/SectionCard";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { ColorField, LogoUploader, BrandFontPicker } from "@/components/ui/page/BrandControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useBrandFontFaces } from "@/hooks/useBrandFontFaces";
import { brandFontStack, resolveBrandFontPair } from "@/lib/brand-fonts";
import { usePortalCatalogInput, usePortalConfig } from "@/hooks/usePortalConfig";
import { resolvePortalCatalog } from "@/lib/playbook/resolve";
import { PORTAL_CUSTOMER_PREVIEW_VIEWER, assemblePortalNav } from "@/lib/portal/portalMenu";
import { PortalMenuEditor, PortalMenuPreview } from "./PortalMenuEditor";
import {
  readableTextOn, isValidHex, PRIMARY_FLOOR, ACCENT_FLOOR,
} from "@/lib/brand/resolveBrand";
import type { PortalModuleOverlay } from "@/hooks/useClientPortalConfig";
import { cn } from "@/lib/utils";
import { CustomerAssistantSettings } from "@/components/tenant-relationships/CustomerAssistantSettings";
import { assistantFields, assistantPatch } from "@/lib/portal/assistantSettings";
import type { ClientPortalConfig } from "@/hooks/useClientPortalConfig";

/**
 * Client Portal (§9/§10/§11) — the ONE tenant-facing surface where a tenant skins
 * the client-facing portal (/app): brand (logo, colors, type), which tabs a client
 * sees + their order, the welcome greeting, and a live "View as Client" preview.
 *
 * Two existing native data seams:
 *   - Brand  → set_tenant_brand (via useBrandKit).
 *   - Portal → set_tenant_portal_config (via usePortalConfig): a PRESENTATION
 *     OVERLAY over the customer portal menu — hide, rename, reorder, never new
 *     keys (E09 Slice M, "Customer portal menu"; Paige reaches the same seam
 *     through client.portal_menu_configure). Every preview computes its menu with
 *     assemblePortalNav (@/lib/portal/portalMenu), the function the live AppNav
 *     runs, so it can't drift (§13).
 *
 * GOLD DISCIPLINE (§11): one gold act per page — the menu card's "Save menu".
 * The header's save is scoped to what it writes ("Save brand, greeting & agent")
 * and stays outline in BOTH mounts: embedded it takes the dashboard's neutral
 * `opd-button` chrome and never `opd-primary` (an unlayered gold fill that would
 * beat the outline variant); toggles use the Switch's own styling; the mock's single
 * "Get started" CTA wears the tenant's OWN accent (brand data), never a resting
 * decoration.
 */

type PortalStudioProps = { embedded?: boolean; onDirtyChange?: (dirty: boolean) => void; assistantFocusRequest?: number };
export default function PortalStudio(props: PortalStudioProps = {}) {
  const { activeTenantId, activeUserId } = useTenantContext();
  return <PortalStudioEditor key={`${activeUserId ?? ""}:${activeTenantId ?? ""}`} {...props} activeTenantId={activeTenantId} />;
}
function PortalStudioEditor({ embedded = false, onDirtyChange, assistantFocusRequest = 0, activeTenantId }: PortalStudioProps & { activeTenantId: string | null }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { toast } = useToast();
  const bk = useBrandKit(activeTenantId);
  const pc = usePortalConfig(activeTenantId);
  // The owner's own catalog inputs — the same ones the server hands customers as `_catalog` (§57).
  const catalogInput = usePortalCatalogInput(activeTenantId);

  const own = bk.state?.own ?? {};
  const eff = bk.state?.effective ?? null;

  const catalog = useMemo(() => resolvePortalCatalog(catalogInput.data), [catalogInput.data]);

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

  // ── Portal overlay editor (welcome + assistant; the menu has its own card and its own Save) ──
  const [welcome, setWelcome] = useState({ headline: "", subhead: "" });
  const [assistant, setAssistant] = useState(() => assistantFields());
  const [portalBaseline, setPortalBaseline] = useState<{ welcome: typeof welcome; assistant: typeof assistant } | null>(null);
  const [menuDirty, setMenuDirty] = useState(false);
  const [menuDraft, setMenuDraft] = useState<PortalModuleOverlay[] | undefined>(undefined);

  const initialWelcome = useMemo(
    () => ({ headline: pc.config.welcome?.headline ?? "", subhead: pc.config.welcome?.subhead ?? "" }),
    [pc.config],
  );
  const welcomeDirty = !!portalBaseline && JSON.stringify(welcome) !== JSON.stringify(portalBaseline.welcome);
  const changedAssistant = portalBaseline ? assistantPatch(portalBaseline.assistant, assistant) : undefined;
  const portalDirty = welcomeDirty || !!changedAssistant;
  const savedPortalKey = JSON.stringify({ welcome: initialWelcome, assistant: assistantFields(pc.config.assistant) });
  const seedPortal = (config: ClientPortalConfig) => {
    const next = {
      welcome: { headline: config.welcome?.headline ?? "", subhead: config.welcome?.subhead ?? "" },
      assistant: assistantFields(config.assistant),
    };
    setWelcome(next.welcome); setAssistant(next.assistant); setPortalBaseline(next);
  };
  const saveMenu = useCallback((modules: PortalModuleOverlay[]) => pc.save({ modules }), [pc]);
  const rereadMenu = useCallback(async () => (await pc.refetch()).data?.modules, [pc]);

  useEffect(() => {
    if (pc.isLoading || pc.isError || portalDirty) return;
    seedPortal(pc.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPortalKey, pc.isLoading, pc.isError, portalDirty]);

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

  // Preview nav = assemblePortalNav, the function the live AppNav runs, over the menu editor's unsaved draft,
  // for a customer of this one business — so the preview can never differ from the live menu (§13).
  const previewNav = useMemo(
    () => assemblePortalNav({ catalog, overlay: menuDraft ?? pc.config.modules, viewer: PORTAL_CUSTOMER_PREVIEW_VIEWER }),
    [catalog, menuDraft, pc.config.modules],
  );

  const headlineText = welcome.headline.trim() || "Welcome back";
  const subheadText = welcome.subhead.trim()
    || brandForm.tagline.trim()
    || "Here's where things stand — your next steps are ready when you are.";

  const dirty = brandDirty || portalDirty;
  const busy = bk.saving || pc.saving;
  useBeforeUnloadGuard(dirty || busy || menuDirty);
  useEffect(() => { onDirtyChange?.(dirty || busy || menuDirty); }, [dirty, busy, menuDirty, onDirtyChange]);

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
        if (!mounted.current) return;
      }
      if (portalDirty) {
        const patch: Partial<ClientPortalConfig> = {};
        const w: { headline?: string; subhead?: string } = {};
        if (welcome.headline.trim()) w.headline = welcome.headline.trim();
        if (welcome.subhead.trim()) w.subhead = welcome.subhead.trim();
        if (welcomeDirty) patch.welcome = w;
        if (changedAssistant) patch.assistant = changedAssistant;
        const saved = await pc.save(patch);
        if (!mounted.current) return;
        seedPortal(saved);
        // The menu card keeps its own draft; this save never sends `modules`.
      }
      toast({ title: "Portal saved", description: "Your clients will see this next time they sign in." });
    } catch (e) {
      if (!mounted.current) return;
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

  if (bk.isError || pc.isError || catalogInput.isError) return <section role="alert" className="p-6 space-y-3">
    <h2 className="text-lg font-semibold">We couldn’t load the saved experience</h2>
    <p className="text-sm text-muted-foreground">Try again before editing the portal’s appearance or content.</p>
    <Button variant="outline" onClick={() => { void bk.refetch(); void pc.refetch(); void catalogInput.refetch(); }}>Retry experience</Button>
  </section>;

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        icon={Palette}
        eyebrow={embedded ? undefined : "Client Portal"}
        title={embedded ? "Customize experience" : "Your client's portal"}
        description={embedded ? undefined : "Everything your clients see when they sign in — brand, tabs, and greeting. Set it once; Paige carries it everywhere."}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {/* Scoped to what this button writes. The menu has its own card and its own Save menu, the page's
                one gold act (§11); its unsaved state is named here too, so nothing reads as saved when it isn't. */}
            {(dirty || menuDirty) && (
              <span data-testid="portal-unsaved" className="text-xs text-muted-foreground">
                {dirty && menuDirty ? "Unsaved changes here and in the menu" : dirty ? "Unsaved changes" : "Unsaved menu changes — use Save menu"}
              </span>
            )}
            <Button variant="outline" className={embedded ? "opd-button" : undefined} data-testid="portal-studio-header-save" onClick={() => void handleSave()} disabled={!dirty || busy || (brandDirty && invalidHex)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              Save brand, greeting &amp; agent
            </Button>
          </div>
        }
      />

      {bk.isLoading || pc.isLoading || catalogInput.isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}</div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-8">
        {/* ── Customer portal menu (E09 Slice M): its own draft and its own Save ── */}
        <PortalMenuEditor
          catalog={catalog}
          saved={pc.config.modules}
          save={saveMenu}
          reread={rereadMenu}
          onDirtyChange={setMenuDirty}
          onDraftChange={setMenuDraft}
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* ── Authoring ── */}
          <fieldset disabled={busy} className="min-w-0 space-y-4" aria-label="Portal experience settings">
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
                    <label htmlFor="portal-product-name" className="text-sm font-medium text-foreground">Portal name</label>
                    <Input
                      id="portal-product-name"
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
                  <label htmlFor="portal-tagline" className="text-sm font-medium text-foreground">Tagline</label>
                  <Input
                    id="portal-tagline"
                    value={brandForm.tagline} placeholder="One line that says what you do."
                    onChange={(e) => setBrandForm((f) => ({ ...f, tagline: e.target.value }))}
                  />
                </div>
              </div>
            </SectionCard>

            {/* WELCOME */}
            <SectionCard
              icon={MessageSquareText}
              title="How they're greeted"
              description="The headline and line your clients land on. Leave blank to use the default."
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="portal-welcome-headline" className="text-sm font-medium text-foreground">Headline</label>
                  <Input
                    id="portal-welcome-headline"
                    value={welcome.headline} placeholder="Welcome back"
                    onChange={(e) => setWelcome((w) => ({ ...w, headline: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="portal-welcome-subhead" className="text-sm font-medium text-foreground">Subhead</label>
                  <Input
                    id="portal-welcome-subhead"
                    value={welcome.subhead} placeholder="Here's where things stand — your next steps are ready."
                    onChange={(e) => setWelcome((w) => ({ ...w, subhead: e.target.value }))}
                  />
                </div>
              </div>
            </SectionCard>
            <CustomerAssistantSettings value={assistant} onChange={setAssistant} focusRequest={assistantFocusRequest} savedName={pc.config.assistant?.display_name} />
          </fieldset>

          {/* ── View as Client (live preview) ── */}
          <div data-testid="portal-view-as-client" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <SectionCard
              padded={false}
              icon={Eye}
              title="View as client"
              description="A representative view — not live client data."
            >
              <div className="p-4">
                <div ref={previewRef} className={cn("overflow-hidden rounded-xl border border-border", !embedded && "shadow-card")}>
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
                  <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,172px)_minmax(0,1fr)]" style={{ fontFamily: previewFont }}>
                  {/* nav: the grouped menu a customer of this business sees — the same component and the same
                      assemblePortalNav() as the menu card's preview, over its unsaved draft. */}
                  <PortalMenuPreview sections={previewNav} testId="portal-view-as-client-nav" dense />
                  {/* home card */}
                  <div className="min-w-0 space-y-3 p-2 sm:p-3">
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
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  This updates live as you edit. It's how the portal reads to a signed-in client.
                </p>
              </div>
            </SectionCard>
          </div>
        </div>
        </div>
      )}
    </PageShell>
  );
}
