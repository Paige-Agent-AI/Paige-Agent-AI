/**
 * EXP08 A2a — Team Hub driven inside the REAL merged `SoloApp`, so the task card's "Open delivery work" link
 * and the inert approval card are measured in the shipped shell: `TenantCommandCenterShell` (rail, command
 * row, the real PAIGE panel and its inline/overlay switch), `.paige-solo`, the flex row, and SoloApp's own
 * `[data-solo-screen-host]` with its `full`-derived overflow (teamhub is in the `full` set). Same pattern as
 * `calendars-settings-mount` (§18: no fourth reproduction of the shell): only the Supabase transport and the
 * tenant context are substituted (supabase-stub.ts, tenant-context-stub.ts).
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): a local render is not a deployed one, the data is synthetic, and no
 * one is signed in. It proves SCROLL OWNERSHIP, CLIPPING, REACHABILITY, KEYBOARD PATH, NAVIGATION TARGET and
 * WORKSPACE SWITCHING against the real component tree.
 *
 *   /solo/3855/team-hub?theme=dark&tr=read      (tenant a, Harbor Lane Studio)
 *   /solo/4120/team-hub?theme=dark&tenant=b     (tenant b, Juniper Row Consulting)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TenantProvider } from "@/hooks/useTenantContext";
import SoloApp from "@/solo/SoloApp";
import uiFont from "../../../../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2?url";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <style>{`@font-face{font-family:"Schibsted Grotesk";font-style:normal;font-weight:100 900;src:url("${uiFont}") format("woff2");font-display:block}`}</style>
    <QueryClientProvider client={client}>
      {/* defaultTheme, not forcedTheme: the shell stamps its own data-pg from resolvedTheme (settings-mount note). */}
      <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey={`paige-harness-team-hub-theme-${theme}`}>
        <TenantProvider>
          <BrowserRouter>
            <Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes>
          </BrowserRouter>
        </TenantProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
