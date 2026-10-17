// E09 Slice 1 — portal messages in the owner's canonical inbox, inside the REAL Solo Clients workspace.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts). ?state=thread|help|notjoined|error
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { Toaster as Sonner } from "@/components/ui/sonner";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
// Theme attributes sit where the APP puts them, not all on <html>: next-themes puts `.dark` on <html>
// (App.tsx ThemeProvider attribute="class"), TenantCommandCenterShell puts `data-pg` on the shell root, and
// SoloApp puts `data-theme` on its .paige-solo wrapper. Stacking all three on <html> changes which token
// block wins (`.dark` and `[data-pg="dark"]` both set --primary; on one element the later rule wins, while
// in the app the shell's own data-pg block overrides the inherited `.dark` values).
document.documentElement.classList.toggle("dark", theme === "dark");
const paige = params.get("paige") === "open" ? "open" : "closed";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {/* SoloApp wraps every Solo screen in the real AgentPresenceProvider (launcher off, chat body on).
            The VoiceDeviceProvider is NOT mounted: useVoiceDevice() is null here, so the call affordance
            is whatever the inbox renders without a device — a harness divergence, not product evidence. */}
        <AgentPresenceProvider launcherEnabled={false} hasChatBody>
          <div data-pg={theme} data-tenant-shell data-nav="compact" data-paige={paige} style={{ height: "100vh" }}>
            <nav className="tcs-nav" />
            <section className="tcs-canvas">
              <main id="tenant-shell-main" className="tcs-main">
                {/* The app mounts Solo under /solo/:account/* — useSubtabRoute reads the sub-tab from those params. */}
                <div className="paige-solo" data-theme={theme} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <main data-solo-screen-host style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}>
                    <Routes>
                      <Route path="/solo/:account/*" element={<TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />} />
                    </Routes>
                  </main>
                </div>
              </main>
            </section>
            {/* The shell's PAIGE column, a placeholder only: `?paige=open` shows the dock region. It does not
                reproduce the app's dock narrowing, so PAIGE-open frames are not evidence of the docked layout. */}
            <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)" />
          </div>
        </AgentPresenceProvider>
        {/* App.tsx mounts the same sonner Toaster globally; the portal reply's outcome copy is a toast. */}
        <Sonner />
        <span data-harness-tag style={{ position: "fixed", bottom: 0, right: 0, fontSize: 10, padding: 3, zIndex: 2147483647, background: "var(--pg-raised)", color: "var(--pg-muted)" }}>HARNESS RENDER · SYNTHETIC DATA · NOT LIVE</span>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
