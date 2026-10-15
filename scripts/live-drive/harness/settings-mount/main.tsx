/**
 * Dev-only mount for the WHOLE Solo Settings route, so the harness can measure a
 * real render of every destination a session cannot log in to reach.
 *
 * WHY THIS EXISTS SEPARATELY FROM `connections-mount`. That harness hand-builds
 * `.solo-settings`, `.ss-page-head` and `.ss-content` around a bare `CalendarsView`.
 * It therefore never runs `SoloSettings` itself — not its scroll-owner resolution,
 * not its scroll reset, not its destination switch. A surface's own scroll logic
 * cannot be measured by a harness that reimplements the markup that logic keys on.
 * Here the mounted component IS `SoloSettings`, and the only thing around it is the
 * shell.
 *
 * WHAT IS REAL: the shipped `SoloSettings` and every destination it renders, the
 * shipped data hooks, the shipped `settings.css` / `settings-integrations.css` /
 * `connections-calendars.css`, the shipped tenant-shell CSS, and the shell's real
 * element chain including SoloApp's screen host. Only the Supabase transport and
 * the tenant context are stubbed — and both are the SAME modules `connections-mount`
 * uses, not a second copy (§18).
 *
 * `BrowserRouter`, not `MemoryRouter`: Settings derives its destination from the URL
 * via `useSubtabRoute`, and its `segmentSpent` decision lives in history state. A
 * drive must be able to navigate by address and to reload, which memory routing
 * cannot express.
 *
 * The `?host=clipped` mode re-creates the pre-#681 SoloApp host (`overflow:hidden`
 * at `height:100%`) so a drive can prove its reachability checks FAIL when the
 * scroll owner is taken away. A check that cannot fail is not a check.
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): a local render is not a deployed one, and
 * the rows are synthetic. It proves GEOMETRY, SCROLL OWNERSHIP, KEYBOARD REACH and
 * DESTINATION SWITCHING — never production data or production behaviour.
 *
 *   /solo/1971670/settings/vault?theme=dark
 */
import { Component, StrictMode, useEffect, useReducer, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BarChart3, Blocks, Building2, CircleDollarSign, FileLock2, Link2, ShieldCheck, Users } from "lucide-react";
import { SoloSettings } from "@/solo/settings";
import { SOLO_SETTINGS_DESTINATIONS } from "@/solo/settings-contract";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { AgentPresenceProvider, useAgentPresence } from "@/components/ui/paige";
import { CommandHub } from "@/solo/CommandCenter";
import { ClientsHub } from "@/solo/conversations";
import { GrowthHub } from "@/solo/growth2";
import { Analytics2 } from "@/solo/analytics2";
import { SoloPaigeWorkspace } from "@/solo/SoloPaigeWorkspace";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
// PRODUCTION ORDER, and the reason this line exists (2026-08-31 reconciliation).
// `SoloApp` imports solo-tokens.css BEFORE it imports ./settings, so the Solo
// form-fit law `.paige-solo main{overflow:hidden!important}` is live on every real
// Settings render. This harness did not load it, so it measured a screen host that
// obeyed its inline `overflow:auto` — a host production never had. Every geometry
// number it produced was therefore taken from a surface with a scroll owner the
// shipped app did not give it. Do NOT drop this import to make a drive pass.
import "@/solo/solo-tokens.css";
import "@/solo/settings.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const secondContext = params.get("tenant") === "second";
const harnessAccountName = secondContext ? "Second harness workspace" : "Harness workspace";
// Opt-in reproduction of the pre-#681 clipped host, so the reachability checks can
// be shown to fail when the scroll owner is removed.
const clipped = params.get("host") === "clipped";
// NEGATIVE CONTROL for the Settings-scoped scroll override. These are the REAL
// non-Settings Solo screens, mounted in the IDENTICAL chain with the IDENTICAL
// stylesheets. Their host must stay `overflow:hidden` — the Solo form-fit law — or
// the Settings override has leaked into a design-locked surface. Command Center is
// the home for Systems Check and Mind, so `?screen=home` covers both.
const screen = params.get("screen") ?? "settings";
// `?paige=full` mounts PAIGE as SoloApp does on its own route (`route==='paige'`): the shell's
// `paigeFull` and the workspace's `full`, together. Default off, so every existing drive is unchanged.
const paigeFullMode = params.get("paige") === "full";

// Applied BEFORE first paint so a frame can never capture the pre-toggle state.
// The Solo shell keys its palette on data-pg, not on the `dark` class.
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");

/**
 * The shell's real chain, reproduced exactly as `TenantCommandCenterShell` builds it:
 *
 *   [data-tenant-shell]  grid, height:100dvh, overflow:hidden
 *     .tcs-nav           the fixed rail
 *     .tcs-canvas        flex column, min-height:0, overflow:hidden
 *       .tcs-command-row the fixed header
 *       main.tcs-main    flex:1, min-height:0, overflow-y:auto
 *
 * then SoloApp's own wrapper inside it:
 *
 *   .paige-solo > flex row (overflow:hidden) > main[data-solo-screen-host]
 *
 * whose overflow is `auto` for a document-flow route like Settings and `hidden` for
 * a route in SoloApp's `full` set. Do NOT simplify this to an inline height: a
 * surface that overflows its ancestor is reachable in a faked shell and unreachable
 * in the real one, which is precisely how a clipped Settings measured as healthy.
 *
 * `.tcs-main--settings-scrollbar` is deliberately NOT pre-applied here.
 * `SoloSettings` adds it to whichever element actually owns the scroll, and a
 * harness that applied it up front would hide whether the shipped code still does.
 */
const SETTINGS_ICONS = {
  setup: Building2, team: Users, connections: Link2, integrations: Blocks,
  analytics: BarChart3, "security-data": ShieldCheck, vault: FileLock2, billing: CircleDollarSign,
};

function Shell() {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    // Test-only equivalent of SoloApp rerendering after a tenant-context refresh.
    const onRefresh = () => flushSync(refresh);
    window.addEventListener("paige:harness-parent-refresh", onRefresh);
    return () => window.removeEventListener("paige:harness-parent-refresh", onRefresh);
  }, []);
  const route = useParams();
  const { expandRail } = useAgentPresence();
  const account = route.account ?? "1971670";
  const splat = route["*"] ?? "settings/setup";
  const activeId = splat.split("/")[1] || "setup";
  const contextualNavigation = screen === "settings" ? {
    label: "Settings",
    backHref: `/solo/${account}/command-center`,
    backLabel: "Back to PAIGE",
    activeId,
    items: SOLO_SETTINGS_DESTINATIONS.map((item) => ({
      id: item.key,
      label: item.label,
      href: `/solo/${account}/settings/${item.key}${window.location.search}`,
      icon: SETTINGS_ICONS[item.key],
    })),
  } : undefined;

  return <TenantCommandCenterShell
    accountName={harnessAccountName}
    accountType="standalone"
    userRole="admin"
    contextualNavigation={contextualNavigation}
    soloPaigeWorkspace={<SoloPaigeWorkspace full={paigeFullMode} dockedTab="chat" onDockedTabChange={() => undefined} />}
    paigeFull={paigeFullMode}
    brandHomeHref={`/solo/${account}/command-center`}
    onSignOut={() => {}}
  >
    <div className="paige-solo" data-theme={theme} style={{ height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
        <main
          data-solo-screen-host
          style={{ flex: 1, overflow: clipped ? "hidden" : "auto", minHeight: 0, minWidth: 0 }}
        >
          {screen === "settings"
            ? <SoloSettings openPaige={expandRail} />
            : <MountReport label={screen}>{NEGATIVE_CONTROLS[screen] ?? null}</MountReport>}
        </main>
      </div>
    </div>
  </TenantCommandCenterShell>;
}

/**
 * The real screens, keyed by SoloApp's own route ids. `openPaige` is a no-op here:
 * the rail launcher is shell state this mount does not own, and none of the scroll
 * geometry under measurement depends on it.
 */
const NEGATIVE_CONTROLS: Record<string, ReactNode> = {
  home: <CommandHub accountContext={{ accountName: "Harness workspace", accountType: "standalone" }} openPaige={() => {}} />,
  clients: <ClientsHub />,
  growth: <GrowthHub />,
  analytics: <Analytics2 accountContext={{ accountName: "Harness workspace", accountType: "standalone" }} accountEpoch="harness-tenant" openPaige={() => {}} />,
};

/**
 * A screen that throws must not be reported as a screen that stayed form-fitting:
 * the drive reads `data-mounted` and says which control actually rendered (§13). The
 * host's computed overflow is a CSS fact either way, but a crashed child is a weaker
 * proof than a rendered one and the report has to say which it got.
 */
class MountReport extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String(e).slice(0, 200) }; }
  componentDidCatch(e: unknown) { console.error(`[harness] ${this.props.label} threw:`, e); }
  render() {
    return (
      <div data-negative-control={this.props.label} data-mounted={this.state.error ? "threw" : "ok"} style={{ height: "100%", minHeight: 0 }}>
        {this.state.error ? <p style={{ padding: 24 }}>{this.props.label} did not mount: {this.state.error}</p> : this.props.children}
      </div>
    );
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
        `defaultTheme`, NOT `forcedTheme` — and this is a repair, not a preference.
        `forcedTheme` stamps the document attribute but leaves next-themes'
        `resolvedTheme` at the stored/system value, and `TenantCommandCenterShell`
        reads `resolvedTheme` to stamp its OWN `data-pg` on the wrappers inside
        this one. So the shell rendered `data-pg="light"` under
        `<html data-pg="dark">`, its own attribute won for everything beneath it,
        and `--pg-canvas` computed `#fbf9f5` in BOTH runs. Every "both themes"
        result this harness has ever produced was one palette measured twice.
        Geometry was unaffected (identical numbers), colour was never exercised.
        The per-theme `storageKey` keeps a persisted choice from overriding the
        default, so the two runs cannot contaminate each other.
        The drive asserts the RENDERED palette, not this prop — see its
        `theme actually reaches the rendered shell` check.
      */}
      <ThemeProvider
        attribute="class"
        defaultTheme={theme}
        enableSystem={false}
        storageKey={`paige-harness-theme-${theme}`}
      >
        <AgentPresenceProvider launcherEnabled={false} hasChatBody>
          <BrowserRouter>
            <Routes><Route path="/solo/:account/*" element={<Shell />} /></Routes>
          </BrowserRouter>
        </AgentPresenceProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
