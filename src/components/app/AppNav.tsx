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
import { Settings, LogOut, User as UserIcon, Menu, ArrowLeft, MessageCircle, Eye, LifeBuoy, ClipboardList, CalendarClock, FileText, MessagesSquare, CircleHelp, ListChecks } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { catalogRoutableItems, applyPortalOverlay } from "@/lib/portal/moduleNav";
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

// The client portal nav is driven by the active Playbook's portal.modules,
// resolved through the shared MODULE_ROUTES + overlay merge in
// @/lib/portal/moduleNav — the ONE source of truth Portal Studio's "View as
// Client" preview computes from too, so the preview can never drift from the
// live chrome (§13). The merge stays Playbook-gated (§2/§9): funding surfaces are
// routable only for a tenant whose opt-in funding Playbook lists those keys.

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
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

  // Base nav = the active Playbook's module CATALOG (filtered to routable keys,
  // default order) with the tenant PRESENTATION OVERLAY applied — both computed
  // by the shared @/lib/portal/moduleNav helpers. FAIL-OPEN: an absent/empty/
  // malformed overlay yields byte-for-byte the catalog order. The force-injected
  // "Action items" and staff "Planning" items below are added AFTER this merge,
  // so the overlay can never touch or hide them.
  const navItems: NavItem[] = applyPortalOverlay(
    catalogRoutableItems(pb.portal.modules),
    portalConfig.modules,
  ).map(({ label, href, icon }): NavItem => ({ label, href, icon }));

  // "Action items" is the customer's side of the two-way action bus (§8) — a core
  // portal surface every client gets, regardless of what their Playbook's module
  // list happens to include. Slot it right after Home.
  if (!isAdmin && !navItems.some((i) => i.href === "/app/actions")) {
    const homeIdx = navItems.findIndex((i) => i.href === "/app");
    navItems.splice(homeIdx >= 0 ? homeIdx + 1 : 0, 0, {
      label: "Action items", href: "/app/actions", icon: ClipboardList,
    });
  }

  // Documents is available to an actual native customer relationship even when
  // an older Playbook predates the module key. Overlay stays presentation-only;
  // the mounted page and Storage independently re-resolve actual permission.
  if (brand && portalConfig.modules?.find(item => item.key === "documents")?.visible !== false
    && !navItems.some(item => item.href === "/app/documents")) {
    const after = navItems.findIndex(item => item.href === "/app/actions");
    navItems.splice(after >= 0 ? after + 1 : navItems.length, 0, {label: "Documents", href: "/app/documents", icon: FileText});
  }

  // Messages is the customer's conversation with their business (E09) — a core
  // portal surface every customer gets, independent of the Playbook's module list.
  // Shown only once a customer relationship has resolved (like Documents / Get
  // help), so nobody without one is handed a dead-end link. The page still
  // re-resolves the relationship server-side.
  if (isCustomer && !navItems.some((i) => i.href === "/app/messages")) {
    const after = Math.max(
      navItems.findIndex((i) => i.href === "/app/documents"),
      navItems.findIndex((i) => i.href === "/app/actions"),
    );
    navItems.splice(after >= 0 ? after + 1 : navItems.length, 0, {
      label: "Messages", href: "/app/messages", icon: MessagesSquare,
    });
  }

  // Sessions is the customer's own bookings with their business (E09 Slice 2). The Playbook catalog
  // places it, and the presentation overlay may hide it; it is shown ONLY to a customer of one
  // business — staff and a customer of several businesses have no sessions this page can show.
  // A Playbook that predates the key still gets it, after Messages, unless the overlay hides it.
  const sessionsHidden = portalConfig.modules?.find((m) => m.key === "sessions")?.visible === false;
  if (!isCustomer) {
    for (let i = navItems.length - 1; i >= 0; i--) if (navItems[i].href === "/app/sessions") navItems.splice(i, 1);
  } else if (!sessionsHidden && !navItems.some((i) => i.href === "/app/sessions")) {
    const after = navItems.findIndex((i) => i.href === "/app/messages");
    navItems.splice(after >= 0 ? after + 1 : navItems.length, 0, {
      label: "Sessions", href: "/app/sessions", icon: CalendarClock,
    });
  }

  // Progress is the work the business explicitly shared with the customer (E09 Slice 3). Same rule as
  // Sessions: the Playbook catalog places it and the overlay may hide it; it is shown ONLY to a
  // customer of one business. A Playbook that predates the key still gets it, after Sessions.
  const progressHidden = portalConfig.modules?.find((m) => m.key === "progress")?.visible === false;
  if (!isCustomer) {
    for (let i = navItems.length - 1; i >= 0; i--) if (navItems[i].href === "/app/progress") navItems.splice(i, 1);
  } else if (!progressHidden && !navItems.some((i) => i.href === "/app/progress")) {
    const after = Math.max(
      navItems.findIndex((i) => i.href === "/app/sessions"),
      navItems.findIndex((i) => i.href === "/app/messages"),
    );
    navItems.splice(after >= 0 ? after + 1 : navItems.length, 0, {
      label: "Progress", href: "/app/progress", icon: ListChecks,
    });
  }

  // Planning is the Task Manager — where every reminder/task/milestone Paige
  // sets actually lives, and the landing spot for a fired reminder's
  // notification. Staff always get it (plan_list is tenant-member scoped, so a
  // pure client can't use it yet — the client view ships separately).
  if (isAdmin && !navItems.some((i) => i.href === "/app/planning")) {
    navItems.push({ label: "Planning", href: "/app/planning", icon: CalendarClock });
  }

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
              {navItems.map((item) => (
                <button
                  key={item.href}
                  onClick={() => { go(item.href); setMobileMenuOpen(false); }}
                  className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] transition-colors ${
                    location.pathname === item.href
                      ? "bg-sidebar-accent text-accent"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
              {showGetHelp && (
                <button
                  onClick={() => { go("/app/messages?topic=help"); setMobileMenuOpen(false); }}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-sidebar-foreground hover:bg-sidebar-accent/50"
                >
                  <CircleHelp className="w-4 h-4" />
                  Get help
                </button>
              )}
              {showPlatformSupport && (
                <button
                  onClick={() => { navigate("/app/support"); setMobileMenuOpen(false); }}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-sidebar-foreground hover:bg-sidebar-accent/50"
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
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-sidebar-foreground hover:bg-sidebar-accent/50"
                >
                  <UserIcon className="w-4 h-4" />
                  Account
                </button>
              )}
              <button
                onClick={() => { navigate("/app/settings"); setMobileMenuOpen(false); }}
                className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <div className="border-t border-sidebar-border my-2" />
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] text-red-400 hover:bg-red-500/10 disabled:opacity-60"
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
        <nav className="flex flex-wrap min-w-0 items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              replace={staysInThread(item.href)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                location.pathname === item.href
                  ? "bg-sidebar-accent text-accent font-medium"
                  : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
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

