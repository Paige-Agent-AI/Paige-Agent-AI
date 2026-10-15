import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Palette, Type, Mail, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/ui/page/SectionCard";
import { StatePill } from "@/components/ui/page/StatePill";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { ColorField, LogoUploader, BrandFontPicker } from "@/components/ui/page/BrandControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import {
  readableTextOn, isValidHex, PRIMARY_FLOOR, ACCENT_FLOOR,
  type BrandField, type BrandSource,
} from "@/lib/brand/resolveBrand";
import { cn } from "@/lib/utils";

function SourceBadge({ source, hasOwn }: { source?: BrandSource; hasOwn: boolean }) {
  // "Custom" uses `success` (not gold `included`) — gold is reserved for the Save act (§11).
  if (hasOwn) return <StatePill state="success">Custom</StatePill>;
  if (source === "agency") return <StatePill state="pending">Inherited</StatePill>;
  return <StatePill state="off">Placeholder</StatePill>;
}

/**
 * Brand Kit editor (#143) — the tenant's logo, colors, voice, and sending
 * identity, saved to tenants.brand via set_tenant_brand and used everywhere Paige
 * builds. Gold discipline (§11): Save is the only gold act; the active-preview
 * ring is indigo. Reads the cascade so a sub-account shows inherited values from
 * its agency with an "Inherited" badge until it sets its own.
 */
export function BrandKitPanel() {
  const { activeTenantId } = useTenantContext();
  const { toast } = useToast();
  const bk = useBrandKit(activeTenantId);
  const own = bk.state?.own ?? {};
  const eff = bk.state?.effective ?? null;

  // Local, dirty-tracked text/color form (logos save immediately on upload).
  const [form, setForm] = useState({
    primary_color: "", accent_color: "", font: "", product_name: "", tagline: "",
    from_name: "", support_email: "",
  });
  const [dark, setDark] = useState(false);

  const dirty = useMemo(() => {
    const norm = (v?: string | null) => (v ?? "").trim();
    return (["primary_color", "accent_color", "font", "product_name", "tagline", "from_name", "support_email"] as const)
      .some((k) => norm(form[k]) !== norm(own[k]));
  }, [form, own]);
  useBeforeUnloadGuard(dirty || bk.saving);

  // Seed the form from the saved brand — but never clobber unsaved edits. A logo
  // upload/remove refetches `own` (new identity), which would otherwise revert the
  // user's in-progress text/color changes; skip the reseed while the form is dirty.
  const seeded = useRef(false);
  useEffect(() => {
    if (!bk.state) return;
    if (seeded.current && dirty) return;
    setForm({
      primary_color: own.primary_color ?? "",
      accent_color: own.accent_color ?? "",
      font: own.font ?? "",
      product_name: own.product_name ?? "",
      tagline: own.tagline ?? "",
      from_name: own.from_name ?? "",
      support_email: own.support_email ?? "",
    });
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bk.state?.own]);

  const src = (f: BrandField): BrandSource | undefined => eff?.source?.[f];
  const hasOwn = (k: keyof typeof form) => !!own[k]?.toString().trim();

  // Effective values drive the preview (own value if set, else inherited/floor).
  const previewPrimary = isValidHex(form.primary_color) ? form.primary_color : (eff?.primary_color ?? PRIMARY_FLOOR);
  const previewAccent = isValidHex(form.accent_color) ? form.accent_color : (eff?.accent_color ?? ACCENT_FLOOR);
  const previewName = form.product_name.trim() || eff?.product_name || bk.state?.tenantName || "Your brand";
  const previewLogo =
    (dark ? (own.logo_dark_url || eff?.logo_dark_url) : null) ||
    own.logo_url || eff?.logo_url || null;

  const invalidHex =
    (form.primary_color.trim() && !isValidHex(form.primary_color)) ||
    (form.accent_color.trim() && !isValidHex(form.accent_color));

  const handleSave = async () => {
    if (invalidHex) {
      toast({ title: "Check your colors", description: "Colors must be a 6-digit hex like #EBB94C.", variant: "destructive" });
      return;
    }
    // Send only changed keys; empty string clears the key (cascade resumes).
    const patch: Record<string, string> = {};
    (["primary_color", "accent_color", "font", "product_name", "tagline", "from_name", "support_email"] as const).forEach((k) => {
      const next = form[k].trim();
      const prev = (own[k] ?? "").toString().trim();
      if (next !== prev) patch[k] = next;
    });
    try {
      await bk.save(patch);
      toast({ title: "Brand saved", description: "Paige will build with this from now on." });
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  if (!activeTenantId) {
    return <EmptyState icon={Palette} title="No active workspace" description="Pick a workspace to set up its brand." />;
  }
  if (bk.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      {/* ── Editor ── */}
      <div className="space-y-4">
        <SectionCard
          icon={ImageIcon}
          title="Logo & mark"
          description="Used in the portal, emails, and anything Paige builds. Transparent PNG or SVG works best."
          actions={<SourceBadge source={src("logo_url")} hasOwn={!!own.logo_url} />}
        >
          <div className="flex flex-wrap gap-5">
            <LogoUploader label="Logo (light)" hint="Shown on light backgrounds." kind="logo"
              url={own.logo_url ?? null} onUpload={bk.setLogo} onClear={bk.clearLogo} busy={bk.saving} />
            <LogoUploader label="Logo (dark)" hint="Shown on dark backgrounds." kind="logo-dark"
              url={own.logo_dark_url ?? null} onUpload={bk.setLogo} onClear={bk.clearLogo} busy={bk.saving} />
            <LogoUploader label="Favicon" hint="Square. The browser-tab icon." kind="favicon" square
              url={own.favicon_url ?? null} onUpload={bk.setLogo} onClear={bk.clearLogo} busy={bk.saving} />
          </div>
        </SectionCard>

        <SectionCard
          icon={Palette}
          title="Colors"
          description="Primary carries headers and buttons; accent is spent on the act/approve moment."
          actions={<SourceBadge source={src("primary_color")} hasOwn={hasOwn("primary_color")} />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary" value={form.primary_color} floor={PRIMARY_FLOOR}
              onChange={(v) => setForm((f) => ({ ...f, primary_color: v }))}
              contrastAgainst="#FFFFFF" contrastLabel="On white," />
            {/* Accent is always used as a fill with auto-contrast text, so a
                readability chip would always "pass" and mislead — omit it. */}
            <ColorField label="Accent" value={form.accent_color} floor={ACCENT_FLOOR}
              onChange={(v) => setForm((f) => ({ ...f, accent_color: v }))} />
          </div>
        </SectionCard>

        <SectionCard
          icon={Type}
          title="Type & voice"
          description="What your product is called and how it reads."
          actions={<SourceBadge source={src("product_name")} hasOwn={hasOwn("product_name")} />}
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">Product / portal name</span>
                <Input value={form.product_name} placeholder={bk.state?.tenantName || "Your brand"}
                  onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="brand-kit-typeface" className="text-sm font-medium text-foreground">Typeface</label>
                <BrandFontPicker
                  id="brand-kit-typeface"
                  value={form.font}
                  onChange={(v) => setForm((f) => ({ ...f, font: v }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Tagline</span>
              <Input value={form.tagline} placeholder="One line that says what you do."
                onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={Mail}
          title="Sending identity"
          description="The name and reply-to on emails Paige sends for you."
          actions={<SourceBadge source={src("from_name")} hasOwn={hasOwn("from_name")} />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">From name</span>
              <Input value={form.from_name} placeholder={bk.state?.tenantName || "Your brand"}
                onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">Support / reply-to email</span>
              <Input value={form.support_email} type="email" placeholder="hello@yourbrand.com"
                onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))} />
            </div>
          </div>
        </SectionCard>

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="gold" onClick={() => void handleSave()} disabled={!dirty || bk.saving || !!invalidHex}>
            {bk.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
            Save brand
          </Button>
        </div>
      </div>

      {/* ── Live preview ── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <SectionCard
          padded={false}
          title="Live preview"
          actions={
            <button type="button" onClick={() => setDark((d) => !d)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              {dark ? "Dark" : "Light"}
            </button>
          }
        >
          <div className="p-4">
            <div className={cn("overflow-hidden rounded-xl border", dark ? "border-white/10" : "border-border")}
              style={{ background: dark ? "#0B0B12" : "#FFFFFF" }}>
              {/* portal masthead */}
              <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: previewPrimary }}>
                {previewLogo ? (
                  <img src={previewLogo} alt="" className="h-6 max-w-[120px] object-contain" />
                ) : (
                  <span className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold"
                    style={{ background: previewAccent, color: readableTextOn(previewAccent) }}>
                    {previewName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate text-sm font-semibold" style={{ color: readableTextOn(previewPrimary) }}>
                  {previewName}
                </span>
              </div>
              {/* body */}
              <div className="space-y-3 p-4" style={{ color: dark ? "#E7E7EA" : "#1A1A22", fontFamily: form.font || undefined }}>
                <p className="text-sm font-semibold">Welcome back</p>
                <p className="text-xs opacity-70">
                  {(form.tagline.trim() || eff?.tagline) || "This is how your portal and emails will look to your clients."}
                </p>
                <button className="rounded-md px-3 py-1.5 text-xs font-semibold"
                  style={{ background: previewAccent, color: readableTextOn(previewAccent) }}>
                  Get started
                </button>
              </div>
              {/* email footer */}
              <div className="border-t px-4 py-2 text-[11px]"
                style={{ borderColor: dark ? "rgba(255,255,255,.08)" : "hsl(var(--border))", color: dark ? "#8A8A95" : "#71717A" }}>
                From {form.from_name.trim() || eff?.from_name || previewName}
                {(form.support_email.trim() || eff?.support_email) ? ` · ${form.support_email.trim() || eff?.support_email}` : ""}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Paige uses these everywhere she builds — the client portal, emails, pages, and assets.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
