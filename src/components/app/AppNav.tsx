import { Link, useLocation, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, LogOut, User as UserIcon, Menu, ArrowLeft, MessageCircle, Eye, LifeBuoy, CircleHelp, ChevronDown } from "lucide-react";
import { assemblePortalNav, type PortalNavItem, type PortalNavSection, type PortalViewer } from "@/lib/portal/portalMenu";
import { resolvePortalCatalog } from "@/lib/playbook/resolve";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { supabase } from "@/integrations/supabase/client";
import { performSignOut, customerSignOutTarget, cachePortalSlug } from "@/lib/auth/signOut";
import { useUnreadSupportCount } from "@/hooks/useUnreadSupportCount";
import { isAvatarBucketUrl } from "@/components/ui/avatar-uploader";
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalBrandState, type ClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { useClientPortalConfigState } from "@/hooks/useClientPortalConfig";
import { readableTextOn } from "@/lib/brand/contrast";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";

// Renders the brand mark in the /app chrome. Prefers the TENANT's brand (logo, or
// a monogram + name driven by the tenant's primary color) so a client sees THEIR
// coach's brand — never hardcoded Paige (§6/§9). Falls back to the Paige logo ONLY
// once the resolver has returned no tenant (staff / platform context). While the
// resolver is in flight it renders a neutral skeleton so the platform logo never
// flashes and swaps to the tenant's (§11 — no jarring hand-off).
function PortalLogo({
  brand,
  loading,
  imgClassName,
  skeletonClassName = "h-7 w-24",
  nameClassName = "font-bold text-base truncate max-w-[160px]",
}: {
  brand: ClientPortalBrand | null;
  loading: boolean;
  imgClassName: string;
  skeletonClassName?: string;
  nameClassName?: string;
}) {
  if (loading) {
    return (
      <span
        className={`inline-block rounded bg-primary-foreground/10 animate-pulse ${skeletonClassName}`}
        aria-hidden="true"
      />
    );
  }
  const name = brand?.tenant_name?.trim();
  const logo = brand?.logo_url?.trim();
  const color = brand?.primary_color?.trim() || null;

  if (logo) {
    return <img src={logo} alt={name || "PaigeAgent.ai"} className={imgClassName} />;
  }
  if (name) {
    // No logo on file — wear a tenant monogram tinted with their primary color
    // (the color is the tenant's accent, applied only to the brand mark — never to
    // an act/approve control, so gold discipline stays intact — §11).
    return (
      <span className="flex items-center gap-2">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold shrink-0 ${
            color ? "" : "bg-sidebar-accent text-primary-foreground"
          }`}
          style={color ? { backgroundColor: color, color: readableTextOn(color) } : undefined}
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className={nameClassName}>{name}</span>
      </span>
    );
  }
  // Resolved with no tenant → platform (Paige) fallback: the current Command Mark.
  return <PaigeCommandMark className={imgClassName} label="PaigeAgent.ai" />;
}

// The customer portal menu (E09 Slice M) is assembled by assemblePortalNav() in @/lib/portal/portalMenu —
// the ONE registry the owner's menu editor and its preview compute from too, so neither can drift from the
// live chrome (§13). Floors are hard (§9); funding surfaces stay routable only for a tenant whose opt-in
// funding Playbook lists those keys (§2). Home and Messages are fixed at the top; the rest is grouped —
// "Your work", "Paperwork", "Learn" — and the business may hide, rename and reorder within a group.

// Resting entries on the brand bar. Selection is a quiet fill, never gold: gold is spent on acts (§11).
const BAR_ITEM = "flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/80";
const BAR_REST = "text-primary-foreground/85 hover:text-primary-foreground hover:bg-sidebar-accent/50";
const BAR_ACTIVE = "bg-sidebar-accent text-primary-foreground font-medium";
const DRAWER_ITEM = "w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-left transition-colors motion-reduce:transition-none";
// Full-strength foreground on the brand fill: the dimmer sidebar grey measured 4.15:1 on the dark-theme violet.
const DRAWER_REST = "text-primary-foreground hover:bg-sidebar-accent/50";
const DRAWER_ACTIVE = "bg-sidebar-accent text-primary-foreground font-medium";

/** A desktop group with two or more entries: a menu button, keyboard and screen-reader correct (Radix). */
function PortalGroupMenu({ section, isActive }: { section: PortalNavSection; isActive: (href: string) => boolean }) {
  const active = section.items.some((i) => isActive(i.href));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-portal-group={section.label ?? ""}
          data-active={active ? "true" : undefined}
          className={cn(BAR_ITEM, active ? BAR_ACTIVE : BAR_REST, "data-[state=open]:bg-sidebar-accent data-[state=open]:text-primary-foreground")}
        >
          {section.label}
          <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-64 rounded-lg p-1.5">
        {section.items.map((item) => (
          <DropdownMenuItem key={item.href} asChild className="min-h-[44px] items-start gap-3 rounded-md px-2.5 py-2 focus:bg-muted focus:text-popover-foreground data-[highlighted]:bg-muted">
            <Link to={item.href} aria-current={isActive(item.href) ? "page" : undefined} className={cn(isActive(item.href) && "bg-muted")}>
              <item.icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span data-portal-label className={cn("block text-sm leading-5 text-popover-foreground", isActive(item.href) && "font-medium")}>{item.label}</span>
                {item.description && <span className="block text-xs leading-4 text-muted-foreground">{item.description}</span>}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AppNavProps {
  user: User;
}

export function AppNav({ user }: AppNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { isAdmin, mode, setMode } = useDashboardMode();
  const pb = usePlaybook();
  // Resolve the TENANT's brand for the chrome (same resolver onboarding uses —
  // get_client_portal_brand()). `loading` gates a skeleton so the platform logo
  // never flashes before the tenant's resolves (§6/§11).
  const { brand, loading: brandLoading, error: brandError, multipleBusinesses } = useClientPortalBrandState();
  // A customer of ONE business (an actual relationship resolved server-side) gets
  // help from THAT business ("Get help" → their own inbox), never Paige's platform
  // support desk. Everyone else whose relationship has resolved keeps platform
  // Support — staff/owners, and a customer of MORE than one business, who has no
  // thread that can send until choosing a business exists (Slice 8). Neither renders
  // until the relationship resolves, so a customer never sees the platform desk flash
  // in (E09 owner decision). A FAILED resolve is not "not a customer": it shows
  // neither, rather than a destination that may be wrong.
  const relationshipKnown = !brandLoading && !brandError;
  const isCustomer = relationshipKnown && !!brand?.tenant_id && !multipleBusinesses;
  const showPlatformSupport = relationshipKnown && !isCustomer;
  const showGetHelp = isCustomer;
  // Moving between the thread and its help mode is one page: replace, so the page's
  // discard guard (which only intercepts push) never asks to leave a page it stays on.
  const staysInThread = (href: string) =>
    location.pathname === "/app/messages" && (href === "/app/messages" || href.startsWith("/app/messages?"));
  const go = (href: string) => navigate(href, staysInThread(href) ? { replace: true } : undefined);
  const { count: unreadSupport } = useUnreadSupportCount(showPlatformSupport ? user.id : null);
  // The tenant's PRESENTATION OVERLAY over the Playbook module catalog (§9/§10).
  // Purely subtractive/reordering — never introduces module keys. Resolves to {}
  // while loading / for staff / on error, so the nav is fail-open: an
  // absent/empty overlay leaves the tab list byte-for-byte unchanged.
  const { config: portalConfig } = useClientPortalConfigState();
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    supabase.from("profiles").select("avatar_url").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setAvatarUrl((data as { avatar_url?: string | null } | null)?.avatar_url || ""); });
    return () => { cancelled = true; };
  }, [user.id]);
  const avatarNode = isAvatarBucketUrl(avatarUrl)
    ? <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
    : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent"><UserIcon className="w-3.5 h-3.5" /></span>;

  // Cache this customer's portal slug so an involuntary logout (session expiry,
  // forced sign-out) can still return them to their tenant gateway, not the
  // Paige page (§9). Reuses the brand already resolved above (no second RPC).
  // No-ops for staff (get_client_portal_brand returns no row → brand is null).
  useEffect(() => {
    if (isAdmin || brandLoading) return;
    cachePortalSlug(brand?.tenant_slug ?? null);
  }, [isAdmin, brandLoading, brand]);

  // The menu (E09 Slice M). A customer cannot read their business's `tenants` row (RLS), so their catalog
  // comes from the server's `_catalog` in the portal config (§57 — the owner edits the list the customer
  // sees); staff, who have no customer relationship, keep their own Playbook read. FAIL-OPEN: an absent
  // overlay or catalog gives the default menu, never fewer entries.
  const viewer: PortalViewer = { isStaff: isAdmin, isCustomer, brandResolved: !!brand };
  const catalog = portalConfig.catalog ? resolvePortalCatalog(portalConfig.catalog) : pb.portal.modules;
  const sections = assemblePortalNav({ catalog, overlay: portalConfig.modules, viewer });
  const isActive = (href: string) => location.pathname === href;

  const userRoleLabel = isAdmin ? "Admin" : "Client";
  const isViewingAsClient = isAdmin && mode === "client";

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setMobileMenuOpen(false);
    setIsSigningOut(true);
    // Customers land back on their coach's branded gateway; staff exit to root.
    const target = await customerSignOutTarget("/");
    await performSignOut(target);
  };

  if (isMobile) {
    return (
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground border-b border-border">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button aria-label="Open navigation" variant="ghost" size="icon" className="h-[44px] w-[44px] text-primary-foreground hover:bg-primary-light">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" aria-describedby={undefined} className="bg-primary text-primary-foreground w-64 max-w-[calc(100vw-2rem)] max-h-[100dvh] p-0 flex flex-col motion-reduce:animate-none motion-reduce:transition-none [&>button]:h-[44px] [&>button]:w-[44px] [&>button]:top-1 [&>button]:right-1 [&>button]:flex [&>button]:items-center [&>button]:justify-center">
            <SheetTitle className="sr-only">Customer navigation</SheetTitle>
            <div className="p-4 pr-[52px] border-b border-sidebar-border">
              <PortalLogo
                brand={brand}
                loading={brandLoading}
                imgClassName="h-8 w-auto max-w-full object-contain"
                skeletonClassName="h-8 w-28"
                nameClassName="font-bold text-lg truncate min-w-0"
              />
            </div>
            <nav aria-label="Customer navigation" className="p-2 pb-[max(8px,env(safe-area-inset-bottom))] space-y-1 flex-1 min-h-0 overflow-y-auto">
              {sections.map((section) => {
                const drawerItem = (item: PortalNavItem) => (
                  <button
                    key={item.href}
                    type="button"
                    aria-current={isActive(item.href) ? "page" : undefined}
                    onClick={() => { go(item.href); setMobileMenuOpen(false); }}
                    className={cn(DRAWER_ITEM, isActive(item.href) ? DRAWER_ACTIVE : DRAWER_REST)}
                  >
                    <item.icon aria-hidden className="w-4 h-4 shrink-0" />
                    {item.label}
                  </button>
                );
                if (section.label === null) return section.items.map(drawerItem);
                const headingId = `portal-drawer-${section.id}`;
                return (
                  <div key={section.id} role="group" aria-labelledby={headingId} className="space-y-1 pt-3">
                    <p id={headingId} data-portal-heading className="px-3 pb-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-primary-foreground">
                      {section.label}
                    </p>
                    {section.items.map(drawerItem)}
                  </div>
                );
              })}
              <div className="border-t border-sidebar-border !my-3" />
              {showGetHelp && (
                <button
                  onClick={() => { go("/app/messages?topic=help"); setMobileMenuOpen(false); }}
                  className={cn(DRAWER_ITEM, DRAWER_REST)}
                >
                  <CircleHelp className="w-4 h-4" />
                  Get help
                </button>
              )}
              {showPlatformSupport && (
                <button
                  onClick={() => { navigate("/app/support"); setMobileMenuOpen(false); }}
                  className={cn(DRAWER_ITEM, DRAWER_REST)}
                >
                  <LifeBuoy className="w-4 h-4" />
                  <span className="flex-1 text-left">Support</span>
                  {unreadSupport > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                      {unreadSupport > 9 ? "9+" : unreadSupport}
                    </span>
                  )}
                </button>
              )}
              {!brandLoading && brand?.tenant_id && (
                <button
                  onClick={() => { navigate("/app/settings?view=client-account"); setMobileMenuOpen(false); }}
                  className={cn(DRAWER_ITEM, DRAWER_REST)}
                >
                  <UserIcon className="w-4 h-4" />
                  Account
                </button>
              )}
              <button
                onClick={() => { navigate("/app/settings"); setMobileMenuOpen(false); }}
                className={cn(DRAWER_ITEM, DRAWER_REST)}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <div className="border-t border-sidebar-border my-2" />
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-red-400 dark:text-primary-foreground hover:bg-red-500/10 disabled:opacity-60"
              >
                <LogOut className="w-4 h-4" />
                {isSigningOut ? "Signing Out..." : "Sign Out"}
              </button>
            </nav>
          </SheetContent>
        </Sheet>

        {brandLoading ? (
          <span
            className="inline-block h-4 w-24 rounded bg-primary-foreground/10 animate-pulse"
            aria-hidden="true"
          />
        ) : (
          <span className="font-bold text-base sm:text-lg truncate">
            {brand?.tenant_name?.trim() || "PaigeAgent"}
          </span>
        )}

        <div className="flex items-center gap-1 [&_button]:min-h-[44px] [&_button]:min-w-[44px]">
          <NotificationBell />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2 bg-primary text-primary-foreground border-b border-sidebar-border">
      <div className="flex flex-wrap min-w-0 max-w-full items-center gap-x-4 gap-y-2">
        <Link to="/app" className="flex items-center gap-2">
          <PortalLogo
            brand={brand}
            loading={brandLoading}
            imgClassName="h-7 w-auto max-w-[180px] object-contain"
            skeletonClassName="h-7 w-24"
          />
        </Link>
        <nav aria-label="Customer navigation" className="flex flex-wrap min-w-0 items-center gap-1">
          {sections.flatMap((section) => {
            const link = (item: PortalNavItem) => (
              <Link
                key={item.href}
                to={item.href}
                replace={staysInThread(item.href)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(BAR_ITEM, isActive(item.href) ? BAR_ACTIVE : BAR_REST)}
              >
                <item.icon aria-hidden className="w-4 h-4" />
                {item.label}
              </Link>
            );
            // A group with exactly one entry is a plain link; with more, a menu.
            if (section.label === null || section.items.length === 1) return section.items.map(link);
            return [<PortalGroupMenu key={section.id} section={section} isActive={isActive} />];
          })}
        </nav>
      </div>

      <div className="flex flex-wrap min-w-0 items-center gap-3 ml-auto">
        <Badge variant="outline" className="text-[10px] font-medium capitalize border-accent/30 text-accent hidden sm:inline-flex">
          {userRoleLabel}
        </Badge>

        {isViewingAsClient && (
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground/70 hover:text-primary-foreground hover:bg-sidebar-accent/50 gap-1.5 text-xs"
            onClick={() => { setMode("internal"); navigate("/choose-account"); }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Exit Client View
          </Button>
        )}

        {/* A customer reaches their business through the Messages nav item; a second
            top-bar entry to the same page only crowded the bar. */}
        {!isCustomer && !isAdmin && relationshipKnown && (
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground/70 hover:text-primary-foreground hover:bg-sidebar-accent/50 gap-1.5 text-xs"
            onClick={() => navigate("/app")}
            title={`Ask ${pb.persona.name} to connect you with your advisor`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Contact Advisor</span>
          </Button>
        )}

        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary-foreground hover:bg-sidebar-accent gap-2 px-2"
            >
              {avatarNode}
              <span className="hidden md:inline text-xs max-w-[140px] truncate">
                {user.email}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">
              {user.email}
            </div>
            <DropdownMenuSeparator />
            {isAdmin && !isViewingAsClient && (
              <>
                <DropdownMenuItem onClick={() => navigate("/choose-account")}>
                  <Eye className="w-4 h-4 mr-2" />
                  Choose workspace
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {showGetHelp && (
              <DropdownMenuItem onClick={() => go("/app/messages?topic=help")}>
                <CircleHelp className="w-4 h-4 mr-2" />
                Get help
              </DropdownMenuItem>
            )}
            {showPlatformSupport && (
              <DropdownMenuItem onClick={() => navigate("/app/support")}>
                <LifeBuoy className="w-4 h-4 mr-2" />
                <span className="flex-1">Support</span>
                {unreadSupport > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {unreadSupport > 9 ? "9+" : unreadSupport}
                  </span>
                )}
              </DropdownMenuItem>
            )}
            {!brandLoading && brand?.tenant_id && (
              <DropdownMenuItem onClick={() => navigate("/app/settings?view=client-account")}>
                <UserIcon className="w-4 h-4 mr-2" />
                Account
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => navigate("/app/settings")}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="hidden lg:inline-flex text-primary-foreground/70 hover:text-primary-foreground hover:bg-red-500/20 gap-1.5 text-xs disabled:opacity-60"
        >
          <LogOut className="w-3.5 h-3.5" />
          {isSigningOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </div>
    </div>
  );
}

