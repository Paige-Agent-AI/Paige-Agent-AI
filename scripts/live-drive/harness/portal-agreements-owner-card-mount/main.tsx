// E09 Slice A + Documents — the owner's Clients → Portal card ("Files and agreements") inside the REAL
// TenantRelationshipsClientsWorkspace PortalView, which renders for the non-Solo tiers (Sub-account, Agency,
// Enterprise; Solo has OwnerPortalDashboard). HARNESS RENDER · SYNTHETIC DATA · NOT LIVE: the data boundary is
// the client-standing harness's stubs (../client-standing-mount/stubs.ts). ?tier=sub_account|agency|enterprise
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);
const tierParam = params.get("tier");
const tier = tierParam === "agency" || tierParam === "enterprise" ? tierParam : "sub_account";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <div data-tenant-shell data-nav="compact" data-paige="closed" style={{ height: "100vh" }}>
          <nav className="tcs-nav" />
          <section className="tcs-canvas">
            <main id="tenant-shell-main" className="tcs-main">
              {/* Inline mount (no :account in the address): the sub-tab is local state, so the drive presses "Portal". */}
              <TenantRelationshipsClientsWorkspace routeTier={tier} openPaige={() => undefined} />
            </main>
          </section>
        </div>
        <span data-harness-tag style={{ position: "fixed", bottom: 0, right: 0, fontSize: 10, padding: 3, zIndex: 100, background: "var(--pg-raised)", color: "var(--pg-muted)" }}>HARNESS RENDER · SYNTHETIC DATA · NOT LIVE</span>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
