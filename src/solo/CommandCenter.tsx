// @ts-nocheck
import React, { useEffect, useRef } from "react";
import { Activity, BrainCircuit, ShieldCheck, Target } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { SoloMindWorkspace } from "./SoloMindWorkspace";
import { SoloSystemsCheckWorkspace } from "./SoloSystemsCheckWorkspace";
import { SoloGamePlanWorkspace } from "./SoloGamePlanWorkspace";
import { TrustCompass } from "./compass";

// Business Game Plan → Systems Check → Trust Compass → Mind (owner-ruled 2026-09-05). All four are
// real surfaces now: Business Game Plan is the default landing, and Trust Compass is the third tab.
// Each key MUST match its registry subtab key ("plan"/"sys"/"compass"/"mind") — a source-parsing
// contract test asserts the TABS set and order against the registry.
const TABS = [
  ["plan", "Business Game Plan", Target],
  ["sys", "Systems Check", Activity],
  ["compass", "Trust Compass", ShieldCheck],
  ["mind", "Mind", BrainCircuit],
];

// `workspaceId` reaches the Systems Check workspace so its Rail panel can notice a switch.
// The `key` on the mount below is the primary mechanism — it remounts the subtree, so no
// prior-workspace row, filter, pending read or loading state survives — and this prop is the
// feed's own request guard behind it.
const CommandCenter = ({ accountContext, openPaige, workspaceId }) => <SoloSystemsCheckWorkspace accountContext={accountContext} openPaige={openPaige} workspaceId={workspaceId} />;

const CommandHub = ({ accountContext, openPaige }) => {
  const [tab, setTab] = useSubtabRoute("solo", "command-center", "plan");
  const { activeTenantId, activeUserId } = useTenantContext();
  // §60 Solo-only gate for the Trust Compass sub-tab (owner ruling 2026-09-06 —
  // "no subaccount delivery without explicit release"). The Command Center shell is
  // universal, but this ONE sub-tab is released to Solo only; sub-account is DEFERRED.
  // Derived through the ONE tier helper, never an inline account_type compare (§60).
  // While the tenant is still resolving, `has` defaults to the permissive solo tier,
  // so a Solo owner never flickers without the tab; a sub-account briefly shows it,
  // then the redirect effect below bounces the gated URL to the default landing.
  const { has: hasTierFeature, loading: tierLoading } = useTierFeatures();
  const showCompass = hasTierFeature("trust_compass");
  const VISIBLE_TABS = showCompass ? TABS : TABS.filter(([key]) => key !== "compass");
  // The effective tab never resolves to a gated surface: a sub-account that lands on
  // the compass URL renders the default Business Game Plan panel while the redirect fires.
  const effectiveTab = tab === "compass" && !showCompass ? "plan" : tab;
  const location = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef([]);
  const [routeAnnouncement, setRouteAnnouncement] = React.useState("");

  // Bare `/command-center` and the legacy `/command-center/overview` both open the new default
  // landing, Business Game Plan. `replace` so Back does not trap the owner in a redirect loop
  // (the regex intentionally does NOT match `/command-center/business-game-plan`, so no loop).
  useEffect(() => {
    if (!/\/command-center(?:\/overview)?\/?$/.test(location.pathname)) return;
    const pathname = location.pathname.replace(
      /\/command-center(?:\/overview)?\/?$/,
      "/command-center/business-game-plan",
    );
    setRouteAnnouncement("Command Center opened Business Game Plan.");
    navigate(`${pathname}${location.search}${location.hash}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!/\/command-center\/(?:directory|history)\/?$/.test(location.pathname)) return;
    const pathname = location.pathname.replace(
      /\/command-center\/(?:directory|history)\/?$/,
      "/command-center/mind",
    );
    setRouteAnnouncement("Previous record address opened in Mind.");
    navigate(`${pathname}${location.search}${location.hash}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  // A workspace that does not carry the Trust Compass sub-tab (a sub-account, until it is
  // explicitly released) cannot sit on its URL — the legacy /solo/{n}/trust-compass redirect
  // or a shared link would otherwise leave it on a gated surface. Bounce it to the default
  // Business Game Plan landing once the tenant has resolved (never mid-load, when `has`
  // defaults to solo). §60/§58 — the address stays valid, it just resolves to the default.
  useEffect(() => {
    if (tierLoading || showCompass) return;
    if (!/\/command-center\/trust-compass\/?$/.test(location.pathname)) return;
    const pathname = location.pathname.replace(
      /\/command-center\/trust-compass\/?$/,
      "/command-center/business-game-plan",
    );
    setRouteAnnouncement("Trust Compass is not available for this workspace yet.");
    navigate(`${pathname}${location.search}${location.hash}`, { replace: true });
  }, [tierLoading, showCompass, location.hash, location.pathname, location.search, navigate]);

  const selectTab = (key, focus = false) => {
    setTab(key);
    if (focus) requestAnimationFrame(() => tabRefs.current[VISIBLE_TABS.findIndex(([tabKey]) => tabKey === key)]?.focus());
  };

  const onTabKeyDown = (event, index) => {
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % VISIBLE_TABS.length;
    if (event.key === "ArrowLeft") next = (index - 1 + VISIBLE_TABS.length) % VISIBLE_TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = VISIBLE_TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(VISIBLE_TABS[next][0], true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, overflow: "hidden" }}>
      <nav
        aria-label="Command Center sections"
        role="tablist"
        style={{
          display: "flex", alignItems: "stretch", minHeight: 43,
          padding: "0 clamp(14px, 2.2vw, 30px)", gap: 5, flex: "0 0 auto",
          background: "var(--pg-spine)",
          borderBottom: "1px solid var(--pg-line)",
        }}
      >
        {VISIBLE_TABS.map(([key, text, Icon], index) => {
          const active = effectiveTab === key;
          return (
            <button
              key={key} type="button" role="tab" id={`command-tab-${key}`}
              aria-selected={active} aria-current={active ? "page" : undefined}
              aria-controls={active ? `command-panel-${key}` : undefined} tabIndex={active ? 0 : -1}
              ref={(node) => { tabRefs.current[index] = node; }}
              onClick={() => selectTab(key)} onKeyDown={(event) => onTabKeyDown(event, index)}
              style={{
                position: "relative", display: "inline-flex", alignItems: "center", gap: 7,
                border: 0, padding: "0 11px", background: "transparent",
                color: active ? "var(--pg-ink)" : "var(--pg-muted)",
                fontSize: 11, fontWeight: active ? 800 : 650, cursor: "pointer",
              }}
            >
              <Icon size={14} color={active ? "var(--pg-gold)" : "currentColor"} aria-hidden="true" />
              {text}
              {active && <span aria-hidden="true" style={{ position: "absolute", inset: "auto 8px -1px", height: 2, borderRadius: 2, background: "var(--pg-gold)" }} />}
            </button>
          );
        })}
      </nav>
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{routeAnnouncement}</span>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {effectiveTab === "plan" ? (
          <div role="tabpanel" id="command-panel-plan" aria-labelledby="command-tab-plan" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <SoloGamePlanWorkspace key={activeTenantId ?? "unresolved"} accountContext={accountContext} openPaige={openPaige} workspaceId={activeTenantId} />
          </div>
        ) : effectiveTab === "sys" ? (
          <div role="tabpanel" id="command-panel-sys" aria-labelledby="command-tab-sys" style={{ height: "100%" }}>
            <CommandCenter key={activeTenantId ?? "unresolved"} accountContext={accountContext} openPaige={openPaige} workspaceId={activeTenantId} />
          </div>
        ) : effectiveTab === "compass" ? (
          <div role="tabpanel" id="command-panel-compass" aria-labelledby="command-tab-compass" style={{ height: "100%", overflow: "auto" }}>
            {/* `key` re-keys every read on a workspace switch so no prior workspace's autonomy, pending
                actions, or recorded activity can linger even for a frame. */}
            <TrustCompass key={activeTenantId ?? "unresolved"} accountEpoch={activeTenantId} openPaige={openPaige} />
          </div>
        ) : activeTenantId ? (
          <div role="tabpanel" id="command-panel-mind" aria-labelledby="command-tab-mind" style={{ height: "100%" }}>
            <SoloMindWorkspace
              account={account}
              key={`${activeUserId ?? "resolving"}:${activeTenantId}`}
              accountContext={accountContext}
              openPaige={openPaige}
              requestedKnowledgeId={new URLSearchParams(location.search).get("knowledge")}
              preferenceScope={activeUserId ? { userId: activeUserId, tenantId: activeTenantId } : null}
            />
          </div>
        ) : (
          <div role="status" aria-live="polite" style={{ padding: 24, color: "var(--pg-muted)" }}>
            Resolving this account's Mind…
          </div>
        )}
      </div>
    </div>
  );
};

export { CommandHub, CommandCenter };

