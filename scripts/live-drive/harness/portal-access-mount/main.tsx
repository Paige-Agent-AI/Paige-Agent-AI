// E09 Slice 7 — portal access, owner and customer. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts).
// Owner: the same mount as owner-shared-work/main.tsx (the tenant shell's classes and data-pg theme on <html>).
// Customer: the REAL CustomerAccessGate around a stand-in for the /app shell, so the gate is what decides
// whether the shell (menu, Support, Paige) renders at all.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { CustomerAccessGate } from "@/components/app/CustomerAccessGate";
import { ContactPortalPanel } from "@/components/admin/contacts/ContactPortalPanel";
import { ConsumerInvitation } from "@/pages/ConsumerInvitation";
import { HelmetProvider } from "react-helmet-async";
import { CLIENT, CUSTOMER, TENANT } from "./stubs";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "./fonts.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const surface = params.get("surface") ?? "owner";
const customer = surface === "customer";
const panelState = params.get("state") ?? "joined";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const tag = (
  <span
    data-harness-tag
    aria-hidden="true"
    style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "4px 4px 0 0", fontFamily: "ui-monospace, monospace" }}
  >
    HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
  </span>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {surface === "panel" ? (
          // The contact panel as the inbox card rail and contact detail mount it (§60/§61: Solo, Sub-account, Enterprise).
          <main className="min-h-dvh bg-background text-foreground p-4 sm:p-8">
            <div className="mx-auto max-w-[36rem]" data-panel-root>
              <ContactPortalPanel contactId={CLIENT} email="jordan@rivera.example"
                linkedUserId={panelState === "ended" ? null : CUSTOMER} name="Jordan Rivera" />
            </div>
          </main>
        ) : surface === "invite" ? (
          <HelmetProvider>
            <ConsumerInvitation token="harness-accepted-token"
              info={{ tenant_id: TENANT, tenant_name: "Northwind Studio", is_valid: false, invited_email: "jordan@rivera.example", brand: { logo_url: null, primary_color: "#304E42" } }} />
          </HelmetProvider>
        ) : customer ? (
          <CustomerAccessGate userId={CUSTOMER} enabled>
            {/* Stand-in for the /app shell: what a customer with OPEN access would get. */}
            <div data-shell-standin className="min-h-dvh bg-background text-foreground p-6">
              <nav aria-label="Customer navigation" className="mb-4 text-sm">Home · Messages · Support</nav>
              <h1 className="text-2xl font-semibold">Welcome back</h1>
            </div>
          </CustomerAccessGate>
        ) : (
          <div data-tenant-shell data-nav="compact" data-paige="closed" style={{ height: "100vh" }}>
            <nav className="tcs-nav" />
            <section className="tcs-canvas">
              <main id="tenant-shell-main" className="tcs-main">
                <TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => undefined} />
              </main>
            </section>
            <aside className="tcs-paige" hidden aria-label="PAIGE dock (harness placeholder)" />
          </div>
        )}
        {tag}
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
