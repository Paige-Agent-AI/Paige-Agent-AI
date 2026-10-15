/**
 * Dev-only mount for the Client Portal brand typeface picker, so the harness can measure a REAL render.
 *
 * WHY THIS EXISTS RATHER THAN A LOGIN: PortalStudio is auth-gated (Solo → Clients → Portal → "Open gated
 * Portal configuration", owner/admin only) and these sessions hold no tenant credentials; §63 puts the
 * owner's real accounts off-limits as fixtures. It is never imported by `src/`, has its own root and vite
 * config, and never reaches a production bundle (§9).
 *
 * WHAT IS REAL: the shipped PortalStudio (and BrandFontPicker), the shipped useBrandKit/usePortalConfig
 * hooks, the shipped brand-font loader and the self-hosted files under public/fonts/brand, the app's real
 * tokens. Only the Supabase transport and the tenant context are stubbed.
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): a local render is not a deployed one. It proves GEOMETRY,
 * INTERACTION and the PAYLOAD the save sends — never production data or the authenticated route.
 *
 *   /?theme=dark&paige=open&font=Literata
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PortalStudio from "@/pages/admin/PortalStudio";
import "@/index.css";
// The production mount's own stylesheet: it styles the `trc-canonical-mount` wrapper PortalStudio sits in.
import "@/components/tenant-relationships/tenant-relationships-clients-workspace.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
// Applied BEFORE first paint. PortalStudio reads the shadcn tokens (`.dark`); the Solo shell keys on data-pg.
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");

// `paige=open` reserves the PAIGE panel's column the way the shell does when it is unfolded.
const paigeOpen = params.get("paige") === "open";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div style={{ height: "100vh", display: "grid", gridTemplateColumns: paigeOpen ? "minmax(0,1fr) 380px" : "minmax(0,1fr)" }} className="bg-background text-foreground">
        <div data-scroll-owner="" style={{ minWidth: 0, minHeight: 0, overflow: "auto" }}>
          <div className="trc-canonical-mount" data-portal-configuration>
            <PortalStudio />
          </div>
        </div>
        {paigeOpen && <aside aria-label="PAIGE panel (reserved column)" className="border-l border-border bg-muted/40" />}
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
