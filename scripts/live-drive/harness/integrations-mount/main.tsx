/**
 * Dev-only mount for Settings › Integrations, so the harness can measure a REAL
 * render of a surface these sessions cannot log into.
 *
 * WHAT IS REAL: the shipped `SoloIntegrationsView`, the shipped
 * `useN8nConnection` (including its sanitiser and its error mapping), the
 * shipped `settings-integrations.css` and `settings.css`, against the app's real
 * `--pg` tokens, inside the real shell scroll owner. Only the Supabase transport
 * and the tenant context are stubbed.
 *
 * WHAT THIS DOES NOT PROVE (§13/§32.c): a local render is not a deployed one,
 * and no real n8n instance is contacted. It proves GEOMETRY, SCROLL OWNERSHIP
 * and INTERACTION — never production data or an authenticated provider result.
 *
 *   /?theme=light&data=connected&paige=open
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SoloSettings } from "@/solo/settings";
import "@/index.css";
// PRODUCTION ORDER, and the reason both of these are here (2026-08-31).
// This mount used to fake the shell with an inline `height:100vh; overflowY:auto` on
// a bare `#tenant-shell-main` — no `tcs-main` class, no shell stylesheet, no
// `.paige-solo` chain, no screen host. That is the SAME fake #681 identified as the
// reason a clipped Settings could measure healthy, and it survived here after both
// other Settings mounts were repaired. Without solo-tokens.css the Solo form-fit law
// `.paige-solo main{overflow:hidden!important}` never participates, so the Settings
// scroll-owner opt-out is never exercised and this drive could pass while production
// clipped the surface. Do NOT drop either import to make a drive pass.
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/solo/solo-tokens.css";
import "@/solo/settings.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
// The shell's PAIGE dock changes the content column's width, so a surface can fit with the
// dock closed and reflow badly with it open. Defaults to closed — existing drives are unchanged.
const paige = params.get("paige") === "open" ? "open" : "closed";
// Synthetic callback route only; never a tenant-authority input or a production entry.
const route = params.get("data") === "oauth-return"
  ? "/solo/10000001/settings/integrations?mcp=cancelled&connection=00000000-0000-4000-8000-000000000021"
  : "/solo/1971670/settings/integrations";

// Applied BEFORE first paint so a frame can never capture the pre-toggle state.
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");

/**
 * The shell's real chain, matching the other two Settings harness mounts exactly:
 *
 *   [data-tenant-shell]  grid, height:100dvh, overflow:hidden
 *     .tcs-nav           the fixed rail
 *     .tcs-canvas        flex column, min-height:0, overflow:hidden
 *       .tcs-command-row the fixed header
 *       main.tcs-main    flex:1, min-height:0, overflow-y:auto
 *         .paige-solo > flex row > main[data-solo-screen-host]   ← SoloApp's own host
 *
 * `.solo-settings` / `.ss-content` are what this surface's container queries resolve
 * against — mounting the view bare would leave `container-type: normal` and silently
 * disable every responsive rule, so a layout could be "proven" in a frame where its
 * queries never fired. The page header is the real one from `settings.tsx`.
 *
 * Do NOT simplify this back into an inline height. `.tcs-main` earns its height from
 * `flex:1` inside `.tcs-canvas`, itself a stretched item of a `height:100dvh` grid;
 * a surface that overflows its ancestor is reachable in a faked shell and unreachable
 * in the real one, which is exactly how a clipped Settings measured as healthy.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div data-tenant-shell data-nav="expanded" data-paige={paige}>
      <nav className="tcs-nav" aria-label="Tenant workspace">
        <div className="tcs-nav-links" />
      </nav>
      <section className="tcs-canvas">
        <header className="tcs-command-row">
          <div className="tcs-context"><span>Harness</span></div>
        </header>
        <main id="tenant-shell-main" className="tcs-main">
          <div className="paige-solo" data-theme={theme} style={{ height: "100%", minHeight: 0 }}>
            <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
              <main data-solo-screen-host style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}>
                <MemoryRouter initialEntries={[route]}>
                  <Routes>
                    <Route path="/solo/:account/*" element={<SoloSettings />} />
                  </Routes>
                </MemoryRouter>
              </main>
            </div>
          </div>
        </main>
      </section>
    </div>
  </StrictMode>,
);
