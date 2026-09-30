import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  PageShell, PageHeader, SectionCard, StatePill, Toolbar, FilterChip, EmptyState, GlyphPlate,
} from "@/components/ui/page";
import type { PillState } from "@/components/ui/page";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { CalendarConnectorsPanel } from "@/components/admin/settings/CalendarConnectorsPanel";
import {
  Workflow, CreditCard, MessageSquare, Send, Zap, Search, Activity,
  ExternalLink, FileSignature, CalendarClock, BarChart3, Bug, Share2, UserSearch,
  Building2, ShieldCheck, Landmark, Plug, Mail, CalendarCheck, ChevronRight,
  LayoutGrid, Rows3, Command as CommandIcon,
} from "lucide-react";


type ConfigShape = {
  ghl_pit_ref: string | null;
  ghl_location_id: string | null;
  langsmith_project: string | null;
  posthog_project_url: string | null;
  sentry_org_slug: string | null;
  cal_default_event_type_id: string | null;
  docusign_templates: Record<string, string> | null;
};

type Counts = {
  n8n: number;
  mcp: number;
  telegramConfigured: boolean;
  recentSubscriptionEvents: number;
  envelopes: number;
  bookings: number;
  enrichments: number;
  emailConnected: boolean;
};

// Each tile keeps its identity (§18: one home per capability). `long` is the
// plain-English "What Paige does with this" blurb shown in the hover-peek and the
// detail Sheet — coaching-generic, mogul-founder voice (§3), no backend jargon.
// `short` is the compact name for the Sheet's act button and the Cmd+K palette.
const tiles = [
  { key: "n8n", icon: Workflow, short: "n8n", title: "n8n Workflows", description: "Connect your n8n so Paige can run, monitor, and build automations across your tools.", long: "Paige runs, watches, and builds automations across your tools here — so the repeatable work happens without you ever touching it.", href: "/choose-account" },
  { key: "stripe", icon: CreditCard, short: "Stripe", title: "Stripe Revenue", description: "Live subscription events, MRR delta and churn alerts.", long: "Paige watches your subscription revenue in real time — new signups, revenue changes, and churn — and flags what needs your attention.", href: "/choose-account" },
  { key: "zapier", icon: Zap, short: "Zapier", title: "Zapier MCP", description: "Expose thousands of apps to Paige via the MCP client.", long: "Paige reaches thousands of apps through one connection, so she can act inside tools you already use without any custom wiring.", href: "/choose-account" },
  { key: "telegram", icon: Send, short: "Telegram", title: "Telegram Alerts", description: "Bot channel for admin alerts and overdue approvals.", long: "Paige pings you on Telegram the moment something needs a decision — an approval waiting, an alert worth your eyes.", href: "/choose-account" },
  { key: "email", icon: Mail, short: "Email", title: "Email (Custom Domain)", description: "Send and receive email from your unified inbox under your own verified domain.", long: "Paige sends and receives email from one inbox under your own verified domain, so every message looks and lands like it came from you.", href: "/choose-account" },
  { key: "firecrawl", icon: Search, short: "Firecrawl", title: "Firecrawl Web Search", description: "Live web research and site crawling.", long: "Paige researches the live web and reads sites for you — pulling in what she needs to answer well and act on current information.", href: "/choose-account" },
  { key: "langsmith", icon: Activity, short: "AI Activity", title: "AI Activity (LangSmith)", description: "Recent traces, cost and latency for all AI calls.", long: "See exactly what Paige's team is doing behind the scenes — recent work, what it cost, and how fast it ran.", href: "/choose-account" },
  { key: "docusign", icon: FileSignature, short: "DocuSign", title: "DocuSign", description: "VIP apps, coach agreements, DFY engagement letters, term sheets.", long: "Paige prepares and sends agreements for signature, then tracks each one until it's signed — no more chasing paperwork.", href: "/choose-account" },
  { key: "cal", icon: CalendarClock, short: "Cal.com", title: "Cal.com", description: "Booking surface for VIP intros, DFY discovery and workshops.", long: "Paige turns your booking calendar into a front door for intros, discovery calls, and workshops, and keeps every slot in sync.", href: "/choose-account" },
  { key: "meta_pixel", icon: Share2, short: "Meta Pixel", title: "Meta Pixel + Conversions API", description: "Track ad conversions on Paige + external landing/webinar pages.", long: "Paige measures which ads actually turn into clients across your pages, so you spend on what works and cut what doesn't.", href: "/choose-account" },
  { key: "meta", icon: Share2, short: "Meta Graph", title: "Meta Graph (Facebook + Instagram)", description: "Provider connection and actions are not available yet.", long: "Meta remains unavailable until Paige can prove tenant-owned authorization, explicit account selection, provider readback, and governed action evidence.", href: "/choose-account" },
  { key: "apollo", icon: UserSearch, short: "Apollo", title: "Apollo Enrichment", description: "Manual lookup; automatic enrichment unavailable.", long: "Automatic enrichment when a contact is created is unavailable. Manual lookup is separate.", href: "/choose-account" },
  { key: "posthog", icon: BarChart3, short: "PostHog", title: "PostHog Analytics", description: "Product usage truth for internal + B2B rollout.", long: "Paige reads real product usage so you know what people actually do, not what you hope they do.", href: "/choose-account" },
  { key: "sentry", icon: Bug, short: "Sentry", title: "Sentry Errors", description: "Frontend + Edge Function error tracking with deep links.", long: "Paige catches errors across the app and functions the moment they happen, with a direct link to the cause.", href: "/choose-account" },
  { key: "nav", icon: Building2, short: "Nav", title: "Nav (Business Credit)", description: "Pull D&B / Experian / Equifax business profiles for capital readiness.", long: "Paige pulls your business's credit profile so you can see exactly where you stand before you go after capital.", href: "/choose-account" },
  { key: "smartcredit", icon: ShieldCheck, short: "SmartCredit", title: "SmartCredit (Owner Lens)", description: "Owner credit standing — funding eligibility lens only. No dispute work.", long: "A read-only lens on the owner's personal credit standing — purely to gauge funding eligibility, nothing more.", href: "/choose-account" },
  { key: "plaid", icon: Landmark, short: "Plaid", title: "Plaid (Banking)", description: "Cash flow signals. Connect to go live.", long: "Paige reads your banking cash-flow signals so she can spot trends and help you time the right moves.", href: "/choose-account" },
] as const;

type Tile = (typeof tiles)[number];

// Static category map keyed by tile.key (§12: organize what we create). Every one
// of the 18 tiles lands in exactly one group; anything unmapped falls into "More"
// below so no tile is ever silently dropped (§13).
const CATEGORIES: { id: string; label: string; icon: LucideIcon; keys: string[] }[] = [
  { id: "automation", label: "Automation & workflows", icon: Workflow, keys: ["n8n", "zapier"] },
  { id: "revenue", label: "Revenue & payments", icon: CreditCard, keys: ["stripe"] },
  { id: "comms", label: "Communications", icon: MessageSquare, keys: ["email", "telegram"] },
  { id: "scheduling", label: "Scheduling & signatures", icon: CalendarClock, keys: ["cal", "docusign"] },
  { id: "marketing", label: "Marketing & audiences", icon: Share2, keys: ["meta", "meta_pixel"] },
  { id: "research", label: "Research & enrichment", icon: UserSearch, keys: ["firecrawl", "apollo"] },
  { id: "analytics", label: "Analytics & observability", icon: Activity, keys: ["langsmith", "posthog", "sentry"] },
  { id: "finance", label: "Business finance", icon: Landmark, keys: ["nav", "smartcredit", "plaid"] },
];

const CALENDAR_ID = "calendar";
const CALENDAR_LABEL = "Calendar & meetings";
// The calendar panel ships three connectors (Google · Zoom · Apple) — a stable
// tile-count for the rail badge, never a status claim (§13).
const CALENDAR_COUNT = 3;

type Density = "comfortable" | "compact";
type Filter = "all" | "connected" | "notConnected";

export default function IntegrationsHub() {
  const reduce = useReducedMotion();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [counts, setCounts] = useState<Counts>({
    n8n: 0, mcp: 0, telegramConfigured: false, recentSubscriptionEvents: 0,
    envelopes: 0, bookings: 0, enrichments: 0, emailConnected: false,
  });

  // Dimensional-surface UI state (§47/§48): search + filter + density, the active
  // tile whose detail Sheet is open, and the Cmd+K palette.
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [density, setDensity] = useState<Density>("comfortable");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<string[]>(() => [
    ...CATEGORIES.map((c) => c.id),
    "more",
    CALENDAR_ID,
  ]);

  useEffect(() => {
    void (async () => {
      // channel_connectors isn't in the generated types yet (like messages/snippets
      // in ClientsConversations); route through the same `any` client the rest of the
      // Conversations surface uses so an untyped table doesn't cascade `never` into the
      // sibling queries' `.eq()` chains. Results are re-typed on assignment below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const [cfg, n8n, mcp, tg, sub, env, bkg, enr, email] = await Promise.all([
        sb.from("paige_config").select("ghl_pit_ref, ghl_location_id, langsmith_project, posthog_project_url, sentry_org_slug, cal_default_event_type_id, docusign_templates").eq("id", 1).maybeSingle(),
        sb.rpc("get_tenant_n8n_connection"),
        sb.from("paige_mcp_connections").select("id", { count: "exact", head: true }).eq("enabled", true),
        sb.from("paige_telegram_config").select("default_admin_chat_id").eq("id", 1).maybeSingle(),
        sb.from("paige_subscription_events").select("id", { count: "exact", head: true }).gte("created_at", since),
        sb.from("paige_signature_envelopes").select("id", { count: "exact", head: true }),
        sb.from("paige_bookings").select("id", { count: "exact", head: true }).gte("scheduled_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
        sb.from("paige_enrichment_log").select("id", { count: "exact", head: true }).gte("created_at", since),
        sb.from("channel_connectors").select("id", { count: "exact", head: true }).eq("channel_type", "email").eq("active", true).eq("status", "active"),
      ]);
      setConfig(cfg.data as ConfigShape | null);
      setCounts({
        n8n: (n8n as { data?: { configured?: boolean } | null } | null)?.data?.configured ? 1 : 0,
        mcp: mcp.count ?? 0,
        telegramConfigured: Boolean(tg.data?.default_admin_chat_id),
        recentSubscriptionEvents: sub.count ?? 0,
        envelopes: env.count ?? 0,
        bookings: bkg.count ?? 0,
        enrichments: enr.count ?? 0,
        emailConnected: (email.count ?? 0) > 0,
      });
    })();
  }, []);

  // ⌘K is now owned platform-wide by the universal Paige launcher (§18 one home;
  // Wave 4 Slice 4a.1). This hub's palette used to register its OWN global ⌘K listener,
  // which collided with the launcher under AdminLayout (both fired → two dialogs). That
  // listener is removed; the palette is reached by its visible "Jump" button below,
  // which stays fully functional — no feature regressed (§39 B1 / §37).

  const hasSentryDsn = Boolean(import.meta.env.VITE_SENTRY_DSN);
  const hasPosthogKey = Boolean(import.meta.env.VITE_POSTHOG_KEY);

  const statusFor = (key: string): { state: PillState; label: string } => {
    switch (key) {
      case "n8n": return counts.n8n > 0 ? { state: "success", label: "Connected" } : { state: "off", label: "Not configured" };
      case "stripe": return counts.recentSubscriptionEvents > 0 ? { state: "success", label: `${counts.recentSubscriptionEvents} events (7d)` } : { state: "off", label: "Awaiting events" };
      case "ghl": return config?.ghl_location_id ? { state: "success", label: "Connected" } : { state: "off", label: "Not configured" };
      case "zapier": return counts.mcp > 0 ? { state: "success", label: `${counts.mcp} active` } : { state: "off", label: "Not configured" };
      case "telegram": return counts.telegramConfigured ? { state: "success", label: "Active" } : { state: "off", label: "Not configured" };
      case "email": return counts.emailConnected ? { state: "success", label: "Connected" } : { state: "off", label: "Not connected" };
      case "firecrawl": return { state: "success", label: "Active" };
      case "langsmith": return config?.langsmith_project ? { state: "success", label: config.langsmith_project } : { state: "off", label: "Disabled" };
      case "docusign": return counts.envelopes > 0 ? { state: "success", label: `${counts.envelopes} envelope${counts.envelopes === 1 ? "" : "s"}` } : { state: "off", label: "Not configured" };
      case "cal": return counts.bookings > 0 ? { state: "success", label: `${counts.bookings} bookings (30d)` } : { state: "off", label: "Not configured" };
      case "meta": return { state: "off", label: "Unavailable" };
      case "apollo": return { state: "off", label: "Auto-enrich unavailable" };
      case "posthog": return hasPosthogKey ? { state: "success", label: "Connected" } : { state: "off", label: "Disabled" };
      case "sentry": return hasSentryDsn ? { state: "success", label: "Connected" } : { state: "off", label: "Disabled" };
      // No pixel/CAPI-specific signal in config yet — never claim "Connected" off
      // the Meta *page* field (that's the separate Meta Graph tile). Stay truthful
      // (§13): show "Not configured" until a real pixel-id/event signal exists.
      case "meta_pixel": return { state: "off", label: "Not configured" };
      case "nav": return { state: "off", label: "Not connected" };
      case "smartcredit": return { state: "off", label: "Not connected" };
      case "plaid": return { state: "off", label: "Not connected" };
      default: return { state: "off", label: "Not configured" };
    }
  };

  // Already-loaded live config values relevant to a tile, shown as labeled rows in
  // the detail Sheet. Only surfaces values we actually have — never a placeholder
  // (§15) and never a fabricated "connected" (§13).
  const detailRows = (key: string): { label: string; value: string }[] => {
    switch (key) {
      case "n8n": return [{ label: "Connection", value: counts.n8n > 0 ? "Connected" : "Not connected" }];
      case "stripe": return [{ label: "Events (last 7 days)", value: String(counts.recentSubscriptionEvents) }];
      case "zapier": return [{ label: "Active MCP actions", value: String(counts.mcp) }];
      case "telegram": return [{ label: "Admin channel", value: counts.telegramConfigured ? "Configured" : "Not set" }];
      case "email": return [{ label: "Inbox", value: counts.emailConnected ? "Connected" : "Not connected" }];
      case "langsmith": return config?.langsmith_project ? [{ label: "Project", value: config.langsmith_project }] : [];
      case "posthog": return config?.posthog_project_url ? [{ label: "Project", value: config.posthog_project_url }] : [];
      case "sentry": return config?.sentry_org_slug ? [{ label: "Organization", value: config.sentry_org_slug }] : [];
      case "docusign": return [{ label: "Envelopes", value: String(counts.envelopes) }];
      case "cal": return [{ label: "Bookings (last 30 days)", value: String(counts.bookings) }];
      case "meta": return [];
      case "apollo": return [
        { label: "Auto-enrich", value: "Unavailable" },
        { label: "Enrichments (7d)", value: String(counts.enrichments) },
      ];
      default: return [];
    }
  };

  // ── Grouping + filtering ────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const matchesTile = (t: Tile) => {
    const hay = `${t.title} ${t.description} ${t.long} ${t.short}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (filter === "all") return true;
    const connected = statusFor(t.key).state === "success";
    return filter === "connected" ? connected : !connected;
  };

  const assigned = new Set(CATEGORIES.flatMap((c) => c.keys));
  const tileGroups = CATEGORIES.map((c) => {
    const groupTiles = tiles.filter((t) => c.keys.includes(t.key));
    return { id: c.id, label: c.label, icon: c.icon, tiles: groupTiles };
  });
  const moreTiles = tiles.filter((t) => !assigned.has(t.key));
  if (moreTiles.length) tileGroups.push({ id: "more", label: "More", icon: Plug, tiles: moreTiles });

  // Rendered content groups (after search/filter). Calendar shows under "All" only —
  // its per-user connection state lives inside the panel and can't be truthfully
  // classified here (§13), so it isn't offered under the connected/not-connected filters.
  type ContentGroup = { id: string; label: string; icon: LucideIcon; kind: "tiles" | "panel"; tiles: Tile[]; count: number };
  const contentGroups: ContentGroup[] = [];
  for (const g of tileGroups) {
    const vis = g.tiles.filter(matchesTile);
    if (vis.length) contentGroups.push({ id: g.id, label: g.label, icon: g.icon, kind: "tiles", tiles: vis, count: vis.length });
  }
  const calMatch = filter === "all" && (q === "" || "calendar meetings google zoom apple bookings sync meeting".includes(q));
  if (calMatch) contentGroups.push({ id: CALENDAR_ID, label: CALENDAR_LABEL, icon: CalendarCheck, kind: "panel", tiles: [], count: CALENDAR_COUNT });

  // Rail groups mirror the RENDERED content (§13/§48): the count matches what's on
  // screen under an active search/filter, and every rail entry has a real scroll
  // target — so the navigator never overstates and never dead-scrolls to a hidden group.
  const railGroups = contentGroups.map((g) => ({ id: g.id, label: g.label, icon: g.icon, count: g.count }));

  const visibleIds = contentGroups.map((g) => g.id);
  // While a search is active, force every matching group open so results are never
  // hidden inside a collapsed accordion; otherwise honor the operator's fold state.
  const accordionValue = q ? visibleIds : openGroups;

  const connectedCount = tiles.filter((t) => statusFor(t.key).state === "success").length;

  const gridCls =
    density === "compact"
      ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

  const goToGroup = (id: string) => {
    setOpenGroups((prev) => (prev.includes(id) ? prev : [...prev, id]));
    requestAnimationFrame(() => {
      document.getElementById(`grp-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  const active = activeKey ? tiles.find((t) => t.key === activeKey) ?? null : null;

  // ── Tile card (dimensional, §47) — whole card opens the detail Sheet; a HoverCard
  // previews the same blurb on pointer devices; tap on touch opens the Sheet directly.
  const renderTile = (tile: Tile) => {
    const status = statusFor(tile.key);
    const hasConfig = tile.href !== "/choose-account";
    const open = () => setActiveKey(tile.key);
    return (
      <HoverCard key={tile.key} openDelay={140} closeDelay={80}>
        <HoverCardTrigger asChild>
          <motion.div
            role="button"
            tabIndex={0}
            aria-label={`Open ${tile.title} details`}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            whileHover={reduce ? undefined : { y: -3 }}
            transition={reduce ? undefined : { type: "spring", stiffness: 400, damping: 26 }}
            className="cursor-pointer rounded-[var(--radius)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <SectionCard
              interactive
              icon={tile.icon}
              title={tile.title}
              description={tile.description}
              actions={<StatePill state={status.state}>{status.label}</StatePill>}
            >
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                {hasConfig ? "Open settings" : "View details"}
                <ChevronRight className="size-3.5" />
              </span>
            </SectionCard>
          </motion.div>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          className={cn(
            "w-72",
            // §22: the peek is pointer-only, but still write its own reduced-motion
            // fallback — neutralize Radix's zoom/fade so no effect is left ungated.
            reduce && "data-[state=open]:!animate-none data-[state=closed]:!animate-none",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-sm font-semibold text-foreground">{tile.title}</span>
            <StatePill state={status.state}>{status.label}</StatePill>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tile.long}</p>
        </HoverCardContent>
      </HoverCard>
    );
  };

  // One integrations home (§9/§12): a landscape-first split view — a sticky category
  // rail, a searchable/filterable toolbar, and collapsible groups of connector tiles.
  // The calendar connectors that used to live in a rival Settings tab are folded in as
  // their own group so the surface reads as one continuous system, not a bolt-on.
  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        eyebrow="Connector Layer"
        icon={Plug}
        title="Integrations"
        description="Every tool Paige can reach — the wiring that lets her act across your stack. Admin only."
        actions={
          <span className="text-sm text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{connectedCount}</span> connected
            <span className="mx-1.5 text-border">·</span>
            {tiles.length} available
          </span>
        }
      />

      <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
        {/* Left category rail — split-view left pane (landscape primary; collapses on mobile). */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-1">
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Categories
            </p>
            {railGroups.map((g) => {
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => goToGroup(g.id)}
                  className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {g.count}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right content pane. */}
        <div className="min-w-0 space-y-4">
          {/* Sticky toolbar: live search · truthful connected filter · density · Cmd+K. */}
          <Toolbar className="sticky top-0 z-20 -mx-1 rounded-[var(--radius)] border border-border/60 bg-background/85 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search integrations…"
                aria-label="Search integrations"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
                <FilterChip active={filter === "connected"} onClick={() => setFilter("connected")}>Connected</FilterChip>
                <FilterChip active={filter === "notConnected"} onClick={() => setFilter("notConnected")}>Not connected</FilterChip>
              </div>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <ToggleGroup
                type="single"
                value={density}
                onValueChange={(v) => v && setDensity(v as Density)}
                variant="outline"
                size="sm"
                className="gap-0"
              >
                <ToggleGroupItem value="comfortable" aria-label="Comfortable density" className="rounded-r-none">
                  <Rows3 className="h-4 w-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="compact" aria-label="Compact density" className="rounded-l-none">
                  <LayoutGrid className="h-4 w-4" />
                </ToggleGroupItem>
              </ToggleGroup>
              {/* Opens the hub-scoped integration palette. The ⌘K hint was removed: ⌘K
                  now belongs to the universal Paige launcher (§18), so promising it here
                  would be false. The button is the palette's affordance. */}
              <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} className="gap-1.5" aria-label="Jump to integration">
                <CommandIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Jump to integration</span>
              </Button>
            </div>
          </Toolbar>

          {contentGroups.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No integrations match"
              description="Try a different search term, or clear the filter to see every tool Paige can reach."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Accordion
              type="multiple"
              value={accordionValue}
              onValueChange={(v) => {
                if (!q) setOpenGroups(v);
              }}
              className={cn(
                "space-y-3",
                // §22: instant expand/collapse under reduced motion. The `!` forces
                // animation:none to win over the primitive's data-state keyframes
                // regardless of stylesheet source order (equal-specificity otherwise).
                reduce && "[&_[class*='animate-accordion']]:!animate-none",
              )}
            >
              {contentGroups.map((g) => {
                const Icon = g.icon;
                return (
                  <AccordionItem
                    key={g.id}
                    value={g.id}
                    id={`grp-${g.id}`}
                    // §47/§22 depth: the group is a RECESSED base tier (hairline border,
                    // subtle muted fill, no shadow) so the raised bg-card tiles inside read
                    // as the single elevated layer — base→raised, not card-on-card (§25).
                    // scroll-mt clears the sticky toolbar (~56px single-row, taller when it
                    // wraps) so a rail jump lands the heading BELOW it, not hidden under it.
                    className="scroll-mt-28 rounded-[var(--radius)] border border-border/60 bg-muted/20 px-4"
                  >
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <span className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="font-display text-sm font-semibold text-foreground">{g.label}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                          {g.count}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pt-1">
                      {g.kind === "panel" ? (
                        <CalendarConnectorsPanel />
                      ) : (
                        <div className={gridCls}>{g.tiles.map(renderTile)}</div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      </div>

      {/* Contextual detail Sheet (§47 pop-out). Deep-links to the tile's dedicated config
          route — never reimplements it inside the Sheet (§18: no redundant silos). */}
      <Sheet open={active !== null} onOpenChange={(o) => { if (!o) setActiveKey(null); }}>
        <SheetContent
          side="right"
          className={cn(
            "w-full overflow-y-auto sm:max-w-md",
            reduce && "data-[state=open]:!animate-none data-[state=closed]:!animate-none",
          )}
        >
          {active && (() => {
            const status = statusFor(active.key);
            const rows = detailRows(active.key);
            const hasConfig = active.href !== "/choose-account";
            const Icon = active.icon;
            return (
              <div className="flex h-full flex-col">
                <SheetHeader className="text-left">
                  <div className="flex items-start gap-3">
                    <GlyphPlate icon={Icon} size="lg" />
                    <div className="min-w-0 pt-0.5">
                      <SheetTitle className="font-display">{active.title}</SheetTitle>
                      <div className="mt-1.5">
                        <StatePill state={status.state}>{status.label}</StatePill>
                      </div>
                    </div>
                  </div>
                </SheetHeader>

                <div className="mt-5 space-y-5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      What Paige does with this
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{active.long}</p>
                  </div>

                  {rows.length > 0 && (
                    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-muted/30">
                      <dl className="divide-y divide-border/60">
                        {rows.map((r) => (
                          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <dt className="shrink-0 text-xs text-muted-foreground">{r.label}</dt>
                            <dd className="truncate text-sm font-medium tabular-nums text-foreground">{r.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>

                {/* The single gold act (§11): deep-link to the real config surface. */}
                <div className="mt-auto pt-6">
                  {hasConfig ? (
                    <Button asChild variant="gold" className="w-full">
                      <Link to={active.href}>
                        Open {active.short} settings <ExternalLink className="size-4" />
                      </Link>
                    </Button>
                  ) : (
                    <div className="rounded-[var(--radius)] border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
                      {active.key === "apollo" ? "Automatic enrichment is unavailable." : "Always on — no setup needed."}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Hub-scoped Cmd+K palette (§47) — jump to any integration by name/category; NOT a
          rival global palette (§18). Selecting one opens that tile's detail Sheet. */}
      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Jump to an integration"
        description="Search and open any tool Paige can reach."
        className={cn(reduce && "data-[state=open]:!animate-none data-[state=closed]:!animate-none")}
      >
        <CommandInput placeholder="Jump to an integration…" />
        <CommandList>
          <CommandEmpty>No integrations found.</CommandEmpty>
          {tileGroups.map((g) => (
            <CommandGroup key={g.id} heading={g.label}>
              {g.tiles.map((t) => {
                const Icon = t.icon;
                return (
                  <CommandItem
                    key={t.key}
                    value={`${t.title} ${g.label} ${t.short}`}
                    onSelect={() => {
                      setActiveKey(t.key);
                      setPaletteOpen(false);
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{t.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{g.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </PageShell>
  );
}
