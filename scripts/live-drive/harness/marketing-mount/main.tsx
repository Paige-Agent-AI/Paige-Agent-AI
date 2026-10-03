import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GrowthHub } from "@/solo/growth2";
import "@/index.css";
import "@/solo/solo-tokens.css";

// The stub for useCatalogOffers reaches React through the global so it can subscribe.
(globalThis as { __React?: typeof React }).__React = React;

const params = new URLSearchParams(window.location.search);
const tab = params.get("tab") || "overview";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.classList.toggle("light", theme === "light");

class HarnessBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    return this.state.error ? <pre data-harness-error style={{ padding: 20 }}>{this.state.error.stack}</pre> : this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><HarnessBoundary>
    <main className="paige-solo" data-theme={theme} style={{ height: "100vh", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <MemoryRouter initialEntries={[`/solo/review/growth/${tab}`]}>
        <Routes><Route path="/solo/:account/*" element={<GrowthHub />} /></Routes>
      </MemoryRouter>
    </main>
  </HarnessBoundary></StrictMode>,
);
