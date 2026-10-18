// E09 Slice M — the customer portal menu (AppNav, the real customer chrome) and the owner's "Customer portal menu"
// editor (the real PortalStudio, embedded the way Solo's Clients → Portal → Customize experience mounts it, or with
// `mount=standalone` the way the non-Solo Clients workspace mounts it: <PortalStudio /> in a trc-canonical-mount).
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts).
//
// THEME: the customer /app is themed by next-themes — only a `light`/`dark` class on <html>. The owner view sits in
// the tenant shell, themed by `data-pg` on <html> (same mount as owner-shared-work/main.tsx).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";
import PortalStudio from "@/pages/admin/PortalStudio";
import { harnessUser } from "./stubs";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/components/tenant-relationships/owner-portal-dashboard.css";
import "@/components/tenant-relationships/tenant-relationships-clients-workspace.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const view = params.get("view") ?? "customer";
const standalone = params.get("mount") === "standalone";
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
if (view === "owner") {
  document.documentElement.setAttribute("data-pg", theme);
  document.documentElement.setAttribute("data-theme", theme);
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const tag = (
  <span
    data-harness-tag
    aria-hidden="true"
    style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "4px 4px 0 0", fontFamily: "ui-monospace, monospace" }}
  >
    HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
  </span>
);

function Customer() {
  return (
    <div className="h-dvh min-h-0 flex flex-col bg-background overflow-x-hidden" data-harness-app>
      <div style={{ display: "contents" }} data-harness-region="nav">
        <AppNav user={harnessUser as unknown as User} />
      </div>
      <div data-harness-region="page" className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-4xl space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Welcome back, Jordan</h1>
          <p className="text-sm text-muted-foreground">Northwind Studio · your portal (harness placeholder page)</p>
        </div>
      </div>
    </div>
  );
}

function Owner() {
  return (
    <div data-tenant-shell data-nav="compact" data-paige="closed" style={{ height: "100vh" }}>
      <nav className="tcs-nav" />
      <section className="tcs-canvas">
        <main id="tenant-shell-main" className="tcs-main">
          {standalone ? (
            <div className="trc-canonical-mount" data-portal-configuration data-harness-region="page">
              <PortalStudio />
            </div>
          ) : (
            <div className="opd-editor" data-harness-region="page">
              <PortalStudio embedded />
            </div>
          )}
        </main>
      </section>
      <aside className="tcs-paige" hidden aria-label="PAIGE dock (harness placeholder)" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {view === "owner" ? <Owner /> : <Customer />}
        {tag}
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
