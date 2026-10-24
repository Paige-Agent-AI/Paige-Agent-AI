import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { GrowthHub } from "@/solo/growth2";
import { AdsWorkspace } from "@/solo/AdsWorkspace";
import "@/index.css";
import "@/solo/solo-tokens.css";

// The stub for useCatalogOffers reaches React through the global so it can subscribe.
(globalThis as { __React?: typeof React }).__React = React;

const params = new URLSearchParams(window.location.search);
const tab = params.get("tab") || "overview";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.classList.toggle("light", theme === "light");

class HarnessBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    return this.state.error ? <pre data-harness-error style={{ padding: 20 }}>{this.state.error.stack}</pre> : this.props.children;
  }
}

// SoloApp's dispatch, reduced to the two screens this harness owns: Ads is its own department since
// 2026-10-10, so `tab=ads` opens `/solo/review/ads`. `legacy=` opens an old `/growth/ads` address instead.
function Screen() {
  const params = useParams();
  const location = useLocation();
  React.useEffect(() => { document.body.dataset.harnessPath = `${location.pathname}${location.search}`; }, [location]);
  return (params["*"] || "").split("/")[0] === "ads" ? <AdsWorkspace tenantId="tenant-review"/> : <GrowthHub />;
}
const legacy = params.get("legacy");
// EXP07: `piece=`/`kind=` pass through to the Content tab's preview/filter (the real app keeps
// them in the address). `paige=open` docks the PAIGE column the way the real shell does
// (TenantCommandCenterShell: main + `minmax(440px,34vw)` dock) — the campaigns drawer is
// position:fixed and overlays it, which is the geometry the captures must show (review fix for
// the PR4 finding: the earlier 380px flex-aside simulated a reflow the real app never does).
// Defaults keep every existing drive intact.
const piece = params.get("piece");
const kind = params.get("kind");
const query = [piece ? `piece=${piece}` : "", kind ? `kind=${kind}` : ""].filter(Boolean).join("&");
const entry = legacy !== null ? `/solo/review/growth/ads${legacy ? `?view=${legacy}` : ""}` : tab === "ads" ? "/solo/review/ads" : `/solo/review/growth/${tab}${query ? `?${query}` : ""}`;
const paigeOpen = params.get("paige") === "open";

createRoot(document.getElementById("root")!).render(
  <StrictMode><HarnessBoundary>
    <div style={{ display: "grid", gridTemplateColumns: `minmax(0,1fr) ${paigeOpen ? "minmax(440px,34vw)" : "0px"}`, height: "100vh", minWidth: 0, overflow: "hidden" }}>
      <main className="paige-solo" data-theme={theme} style={{ minWidth: 0, overflow: "hidden" }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="/solo/:account/*" element={<Screen />} /></Routes>
        </MemoryRouter>
      </main>
      {paigeOpen && <aside aria-label="PAIGE dock (harness placeholder)" style={{ borderLeft: "1px solid rgba(127,127,127,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(127,127,127,0.8)", fontSize: 13 }}>PAIGE dock · the fixed campaigns drawer overlays this</aside>}
    </div>
  </HarnessBoundary></StrictMode>,
);
