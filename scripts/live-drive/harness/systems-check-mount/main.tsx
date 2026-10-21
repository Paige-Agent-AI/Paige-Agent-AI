import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SoloSystemsCheckWorkspace } from "@/solo/SoloSystemsCheckWorkspace";
import "@/index.css";

const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div data-pg={theme} style={{ height: "100vh", minWidth: 0, display: "flex", flexDirection: "column", background: "var(--pg-canvas)", color: "var(--pg-ink)" }}>
      <div style={{ flex: 1, minHeight: 0 }}><SoloSystemsCheckWorkspace accountContext={{ accountName: "Harness tenant", accountType: "standalone" }} /></div>
      <footer style={{ padding: 4, fontSize: 12, lineHeight: "16px", fontFamily: "var(--pg-font-ui)" }}>Simulated check status · No backend or scan.</footer>
    </div>
  </StrictMode>,
);
