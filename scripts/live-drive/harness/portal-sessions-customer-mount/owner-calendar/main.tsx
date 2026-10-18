// Owner side of E09 Slice 2: the Solo calendar mounted exactly as calendar-mount mounts it (inside the
// `trc-canonical-mount--direct` container the calendar's container queries resolve against), so the drive can
// open "New appointment" and frame the client picker. HARNESS RENDER · SYNTHETIC DATA · NOT LIVE.
//   /?theme=light|dark
// CSS ORDER MATCHES THE APP: src/main.tsx injects index.css first and the Solo shell (SoloEntry) is a lazy
// chunk, so solo-calendar.css lands AFTER index.css and its own rules win ties of equal specificity (e.g.
// `.sc-combo-trigger:focus-visible` over index.css's `[data-pg] :focus-visible`). Importing the component
// first would invert that and render rings the app never shows.
import "@/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SoloCalendarWorkspace } from "@/components/tenant-calendar/SoloCalendarWorkspace";
import { HARNESS_TENANT } from "./tenant-stub";
import "@/components/tenant-relationships/tenant-relationships-clients-workspace.css";

const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
// The Solo shell keys its palette on data-pg (not the `dark` class); set both before first paint.
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "minmax(0,1fr)", background: "var(--pg-canvas)" }}>
      <div style={{ minWidth: 0, minHeight: 0, display: "grid" }}>
        <div className="trc-canonical-mount trc-canonical-mount--direct" data-calendar-owner="clients">
          <SoloCalendarWorkspace activeTenantId={HARNESS_TENANT} connectionsHref="/solo/1/settings/integrations" openPaige={() => undefined} />
        </div>
      </div>
    </div>
    <span
      data-harness-tag
      aria-hidden="true"
      style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "0 0 4px 4px", fontFamily: "ui-monospace, monospace" }}
    >
      HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
    </span>
  </StrictMode>,
);
