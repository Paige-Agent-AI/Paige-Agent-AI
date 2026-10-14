// Experience 04 E4-S3 PR beta — "Where {client} stands" inside the REAL Solo Clients workspace and client
// record. HARNESS RENDER · NOT LIVE (see stubs.ts). ?state=populated|empty|nozone|refused|error|loading
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
const paige = params.get("paige") === "open" ? "open" : "closed";
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <div data-tenant-shell data-nav="compact" data-paige={paige} style={{ height: "100vh" }}>
          <nav className="tcs-nav" />
          <section className="tcs-canvas">
            <main id="tenant-shell-main" className="tcs-main">
              <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />
            </main>
          </section>
          {/* The shell's PAIGE column, a placeholder only: `?paige=open` shows the dock region, but it does NOT
              reproduce the app's dock narrowing (measured: the record keeps its width under the dock at 1024
              and 900), so PAIGE-open frames are not evidence of the docked layout. */}
          <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)" />
        </div>
        <span style={{ position: "fixed", bottom: 0, right: 0, fontSize: 10, padding: 3, zIndex: 100, background: "var(--pg-raised)", color: "var(--pg-muted)" }}>HARNESS RENDER · SYNTHETIC DATA · NOT LIVE</span>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
