import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { AdsWorkspace } from "@/solo/AdsWorkspace";
import { GrowthHub } from "@/solo/growth2";
import "@/index.css";
import "@/solo/solo-tokens.css";

// Renders the REAL Solo tenant shell (rail, command row, canvas) around the REAL Ads department, the way
// SoloApp mounts it, for an authenticated Solo (standalone) account. Only network reads are stubbed.
(globalThis as { __React?: typeof React }).__React = React;
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const entry = params.get("path") || "/solo/review/ads";
document.documentElement.setAttribute("data-pg", theme);
try { localStorage.setItem("ads-harness-theme", theme); } catch { /* the default below still applies */ }

class HarnessBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    return this.state.error ? <pre data-harness-error style={{ padding: 20 }}>{this.state.error.stack}</pre> : this.props.children;
  }
}

function Screen() {
  const routeParams = useParams();
  const location = useLocation();
  React.useEffect(() => { document.body.dataset.harnessPath = `${location.pathname}${location.search}`; }, [location]);
  const branch = (routeParams["*"] || "").split("/")[0];
  return <TenantCommandCenterShell accountName="Northwind Studio" accountType="standalone" userRole="admin" onSignOut={() => {}}>
    <div className="paige-solo" data-theme={theme} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <main data-solo-screen-host style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}>
        {branch === "ads" ? <AdsWorkspace tenantId="tenant-review"/> : branch === "growth" ? <GrowthHub/> : <p style={{ padding: 24 }}>{branch}</p>}
      </main>
    </div>
  </TenantCommandCenterShell>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><HarnessBoundary>
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey="ads-harness-theme">
      <div style={{ height: "100vh" }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="/solo/:account/*" element={<Screen/>}/></Routes>
        </MemoryRouter>
      </div>
    </ThemeProvider>
  </HarnessBoundary></StrictMode>,
);
