// Actual owning Sales department and shell; only network/identity/provider ports are synthetic.
// No production entry imports this module. Not authenticated or persistence acceptance.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentPresenceProvider } from "@/components/ui/paige/AgentPresenceContext";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SalesWorkspace } from "@/solo/SalesWorkspace";
import { setSalesHarnessMode } from "./useSoloSalesOps-stub";
import { setAgreementsHarnessMode } from "./useSoloCommercialTerms-stub";
import { setSigningsHarnessMode } from "./useSoloAgreementSignings-stub";
import "@/index.css";
import "@/solo/solo-tokens.css";

(globalThis as { __React?: typeof React }).__React = React;
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
setSalesHarnessMode("declared");
setAgreementsHarnessMode("populated");
setSigningsHarnessMode(params.get("read") === "error" ? "error" : "populated");
localStorage.setItem("paige.agentRail.collapsed", String(params.get("paige") !== "open"));
localStorage.setItem("paige.tenantShell.navExpanded", "false");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey={`agreements-proof-${theme}`}>
      <AgentPresenceProvider launcherEnabled={false} hasChatBody={false}>
        <MemoryRouter initialEntries={["/solo/42/sales/agreements"]}>
          <TenantCommandCenterShell accountName="Synthetic agreement review" accountType="standalone" userRole="admin" onSignOut={() => undefined}
            soloPaigeWorkspace={<div style={{ padding: 16 }}>Local PAIGE slot. No conversation or execution transport.</div>}>
            <div className="paige-solo" data-theme={theme} style={{ width:"100%", maxWidth:"none", height:"100%", minWidth:0, minHeight:0, alignSelf:"stretch", display:"flex", flexDirection:"column" }}>
              <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden" }}>
                <main data-solo-screen-host style={{ flex:1, overflow:"hidden", minHeight:0, minWidth:0 }}>
                  <Routes><Route path="/solo/:account/*" element={<SalesWorkspace/>}/></Routes>
                </main>
              </div>
            </div>
          </TenantCommandCenterShell>
          <div data-harness-chrome style={{ position: "fixed", bottom: 0, left: 0, zIndex: 200, background: "#16131a", color: "#f6f2ea", padding: "2px 6px", fontSize: 11 }}>LOCAL SYNTHETIC DATA · AUTH AND PROVIDERS UNVERIFIED</div>
        </MemoryRouter>
      </AgentPresenceProvider>
    </ThemeProvider>
  </QueryClientProvider>,
);
