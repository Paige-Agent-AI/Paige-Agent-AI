import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import { SoloBusinessInterview } from "@/solo/SoloBusinessInterview";

const params = new URLSearchParams(location.search);
const onboarding = params.get("onboarding") === "1";
if (params.get("theme") !== "light") document.documentElement.classList.add("dark");
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <MemoryRouter>
      <div className="spw-root" style={{ height: "100vh", display: "flex", padding: "16px", gap: "12px" }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", border: "1px solid rgba(128,128,128,.25)" }} aria-label="workspace stand-in" />
        <SoloBusinessInterview threadId="10000000-0000-4000-8000-000000000001" busy={false} refreshEpoch={0} onboarding={onboarding} onPause={() => {}} />
      </div>
    </MemoryRouter>
  </StrictMode>,
);
