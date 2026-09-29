import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GrowthHub } from "@/solo/growth2";
import "@/index.css";
import "@/solo/solo-tokens.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";

// Structural harness: the real Catalog and form Details drawer inside the shell's own chrome, so the
// PAIGE dock changes the content column exactly as it does in the app. `?theme=light|dark`,
// `?paige=open|closed`, `?member=1`. NOT the live app.
(globalThis as { __React?: typeof React }).__React = React;
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const paige = params.get("paige") === "open" ? "open" : "closed";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

function Harness() {
  return (
    <div data-tenant-shell data-nav="expanded" data-paige={paige}>
      <nav className="tcs-nav" />
      <section className="tcs-canvas">
        <header className="tcs-command-row"><div className="tcs-context"><span>Campaigns / Catalog · structural harness</span></div></header>
        <main id="tenant-shell-main" className="tcs-main paige-solo" data-theme={theme}>
          <MemoryRouter initialEntries={["/solo/review/growth/catalog?type=form"]}>
            <Routes><Route path="/solo/:account/*" element={<GrowthHub />} /></Routes>
          </MemoryRouter>
        </main>
      </section>
      <aside className="tcs-paige" hidden={paige !== "open"} aria-label="PAIGE dock (harness placeholder)"><div className="tcs-paige-header"><span style={{ color: "var(--pg-ink)" }}>PAIGE</span></div></aside>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
