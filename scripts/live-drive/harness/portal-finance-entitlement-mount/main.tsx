// E09 F2 — the customer portal Home and bell, for a business that is not finance-entitled and one that is.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts). The REAL AppNav (and its NotificationBell), the REAL
// AppDashboardHome (welcome, Getting Started, credit factor grid, tile grid) and the REAL useFinancePortal decide
// what shows, from the customer frame's `entitlements`. The layout is AppShell's (src/pages/AppShell.tsx,
// AppShellBody): AppNav on top, chat 40% left (a labelled placeholder), the page 60% right; below 768px only the page.
// AppShell itself is not mounted (it gates on a real session, consents and landing-route resolution).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";
import { AppDashboardHome } from "@/pages/AppShell";
import { CustomerIdentityProvider } from "@/lib/portal/customerIdentity";
import { readClientPortalFrame } from "@/lib/client-portal-frame";
import { useFinancePortal } from "@/hooks/useFinanceEntitlement";
import { useCreditFactors } from "@/hooks/useCreditFactors";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { BRAND, CONFIG, PROFILE, harnessUser } from "./stubs";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const user = harnessUser as unknown as User;
// The frame exactly as client_portal_frame() returns it, through the REAL parser.
const frame = readClientPortalFrame({ actor_id: harnessUser.id, profile: PROFILE, brand: BRAND, config: CONFIG }, harnessUser.id);
if (!frame) throw new Error("harness: the frame did not parse");

function Home() {
  // AppShellBody's one answer, verbatim.
  const { open: financePortal } = useFinancePortal();
  const { factors } = useCreditFactors(harnessUser.id, { enabled: financePortal });
  return <AppDashboardHome factors={financePortal ? factors : null} userId={harnessUser.id} financePortal={financePortal} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <CustomerIdentityProvider state={{ frame, phase: "ready" }}>
        <BrowserRouter>
          <div className="h-dvh min-h-0 flex flex-col bg-background overflow-x-hidden" data-harness-app>
            <AppNav user={user} />
            <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
              <ResizablePanel defaultSize={40} minSize={30} maxSize={60} className="min-h-0 max-md:hidden">
                <div data-harness-placeholder style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", fontSize: 13, textAlign: "center" }}>
                  Chat — harness placeholder (the real chat panel is not mounted here)
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle className="max-md:hidden" />
              <ResizablePanel defaultSize={60} className="min-h-0 max-md:!flex-[1_1_100%]">
                <div data-harness-region="page" className="h-full overflow-y-auto scroll-touch p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-6">
                  <Routes>
                    <Route path="/app" element={<Home />} />
                    <Route path="*" element={<p>Another page (harness placeholder)</p>} />
                  </Routes>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <span data-harness-tag aria-hidden="true"
            style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "0 0 4px 4px", fontFamily: "ui-monospace, monospace" }}>
            HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
          </span>
        </BrowserRouter>
      </CustomerIdentityProvider>
    </QueryClientProvider>
  </StrictMode>,
);
