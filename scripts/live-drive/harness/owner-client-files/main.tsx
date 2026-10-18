// E09 Slice 4 — "Files for {client}" inside the REAL Solo Clients workspace and client record, after "Shared with
// {client}". HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts). Same mount as
// client-standing-mount/main.tsx: the tenant shell's classes and data-pg theme on <html>.
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
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <div data-tenant-shell data-nav="compact" data-paige="closed" style={{ height: "100vh" }}>
          <nav className="tcs-nav" />
          <section className="tcs-canvas">
            <main id="tenant-shell-main" className="tcs-main">
              <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />
            </main>
          </section>
          <aside className="tcs-paige" hidden aria-label="PAIGE dock (harness placeholder)" />
        </div>
        <span
          data-harness-tag
          aria-hidden="true"
          style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "4px 4px 0 0", fontFamily: "ui-monospace, monospace" }}
        >
          HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
        </span>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
