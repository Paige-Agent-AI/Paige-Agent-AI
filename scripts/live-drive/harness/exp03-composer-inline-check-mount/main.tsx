// EXP03 O12 piece 3 — the email reply's inline check (Send → check → Send now / Schedule send), in the owner's
// canonical inbox, inside the REAL Solo Clients workspace. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts).
// ?door=ok|hang|unknown|expire|suppressed|noconsent|clientdnd|tenantdnd|nosender|noemail&theme=light|dark&paige=open|closed.
// The drive burns the label AFTER measuring. Copied from exp03-scheduled-send-mount/main.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { Toaster as Sonner } from "@/components/ui/sonner";
import "@/index.css";
import "../portal-access-mount/fonts.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
// Theme attributes sit where the APP puts them (see exp03-scheduled-send-mount/main.tsx for why).
document.documentElement.classList.toggle("dark", theme === "dark");
const paige = params.get("paige") === "open" ? "open" : "closed";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {/* VoiceDeviceProvider is NOT mounted (a harness divergence, not product evidence). */}
        <AgentPresenceProvider launcherEnabled={false} hasChatBody>
          <div data-pg={theme} data-tenant-shell data-nav="compact" data-paige={paige} style={{ height: "100vh" }}>
            <nav className="tcs-nav" />
            <section className="tcs-canvas">
              <main id="tenant-shell-main" className="tcs-main">
                <div className="paige-solo" data-theme={theme} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <main data-solo-screen-host style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}>
                    <Routes>
                      <Route path="/solo/:account/*" element={<TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />} />
                    </Routes>
                  </main>
                </div>
              </main>
            </section>
            {/* The shell's PAIGE column, a placeholder only (not the app's dock narrowing). */}
            <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)" />
          </div>
        </AgentPresenceProvider>
        <Sonner />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
