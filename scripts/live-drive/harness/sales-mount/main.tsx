import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GrowthHub } from "@/solo/growth2";
import { setSalesHarnessMode, type Mode } from "./useSoloSalesOps-stub";
import { setAgreementsHarnessMode, type AgreementsMode } from "./useSoloCommercialTerms-stub";
import { setCampaignsHarnessMode, type CampaignsMode } from "./useSoloCampaigns-stub";
import { setSigningsHarnessMode, type SigningsMode } from "./useSoloAgreementSignings-stub";
import "@/index.css";
import "@/solo/solo-tokens.css";

// The stub reaches React through the global so it can subscribe without importing a second copy.
(globalThis as { __React?: typeof React }).__React = React;

const AGREEMENT_MODES: readonly AgreementsMode[] =
  ["none", "no-clients", "empty", "populated", "unreadable", "readonly", "error"];

const MODES: readonly Mode[] = [
  "first-use", "declared", "not-yet", "unrecognised-processor", "populated",
  "activity-unreadable", "readonly", "authority-unknown",
  "loading", "resolving", "unavailable", "error", "save-refused",
];

const CAMPAIGN_MODES: readonly CampaignsMode[] = ["evidence", "sparse"];

/* The signings stub has always carried these and NOTHING ever called its setter, so every document
 * state — the sender, the sealed-copy act, the "could not be read" alert, the derived Expired —
 * was unreachable in the harness and could not be driven or seen. */
const SIGNING_MODES: readonly SigningsMode[] =
  ["none", "populated", "unreadable", "readonly", "error", "loading", "resolving", "unavailable"];

function Harness() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    document.documentElement.setAttribute("data-pg", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  return (
    // A two-row grid: reviewer controls (auto) over the mounted shell (1fr). The drive HIDES the
    // controls (`display:none`) except for the instant it clicks one, so at a 439px column they
    // neither intercept a SubNav click nor consume height that would fake a vertical overflow — the
    // `auto` track collapses to 0 when the controls are hidden and the shell gets the true height.
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto minmax(0,1fr)" }}>
      <aside
        aria-label="Reviewer controls"
        data-harness-controls
        data-harness-chrome
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", flexWrap: "wrap",
          borderBottom: "1px solid #d4d0c8", background: "#f4f1eb",
          font: "11px system-ui", color: "#302d36",
        }}
      >
        <strong style={{ marginRight: 6 }}>LOCAL REVIEW · NO LIVE DATA</strong>
        {CAMPAIGN_MODES.map((m) => (
          <button key={m} data-campaigns={m} onClick={() => setCampaignsHarnessMode(m)}>pipe:{m}</button>
        ))}
        {AGREEMENT_MODES.map((mode) => (
          <button key={mode} data-agreements={mode} onClick={() => setAgreementsHarnessMode(mode)}>
            terms:{mode}
          </button>
        ))}
        {SIGNING_MODES.map((mode) => (
          <button key={mode} data-signings={mode} onClick={() => setSigningsHarnessMode(mode)}>
            docs:{mode}
          </button>
        ))}
        {MODES.map((mode) => (
          <button key={mode} data-mode={mode} onClick={() => setSalesHarnessMode(mode)}>{mode}</button>
        ))}
        <button data-theme-toggle onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
          theme: {theme}
        </button>
      </aside>
      <main className="paige-solo" data-theme={theme} style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        <MemoryRouter initialEntries={["/solo/review/growth/sales"]}>
          <Routes><Route path="/solo/:account/*" element={<GrowthHub />} /></Routes>
        </MemoryRouter>
      </main>
    </div>
  );
}

class HarnessBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    return this.state.error
      ? <pre data-harness-error style={{ padding: 20 }}>{this.state.error.stack}</pre>
      : this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><HarnessBoundary><Harness /></HarnessBoundary></StrictMode>,
);
