// E09 Slice 1 — portal messages in the owner's canonical inbox, inside the REAL Solo Clients workspace.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts). ?state=thread|help|notjoined|error
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { Toaster as Sonner } from "@/components/ui/sonner";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);
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
          <div data-tenant-shell data-nav="compact" data-paige={paige} style={{ height: "100vh" }}>
            <nav className="tcs-nav" />
            <section className="tcs-canvas">
              <main id="tenant-shell-main" className="tcs-main">
                <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />
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
