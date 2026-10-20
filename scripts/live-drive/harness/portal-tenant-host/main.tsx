/**
 * E09 Slice H harness: the REAL PortalGateway and the REAL host routing (useHostRouting, as App.tsx
 * mounts it), real CSS, a deterministic Supabase adapter. The visitor is "signed in" on every host so
 * the drive can prove the tenant host never reads that session. Not authenticated production proof.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import PortalGateway from "@/pages/PortalGateway";
import { useHostRouting } from "@/lib/hostRouting";
import "@/index.css";

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");

function HostRouting({ children }: { children: ReactNode }) {
  useHostRouting();
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><HelmetProvider><BrowserRouter><HostRouting><Routes>
    <Route path="/portal/:tenantSlug" element={<PortalGateway />} />
    <Route path="/app" element={<p data-signed-in-surface>SIGNED-IN CUSTOMER PORTAL</p>} />
  </Routes></HostRouting></BrowserRouter></HelmetProvider></StrictMode>,
);
