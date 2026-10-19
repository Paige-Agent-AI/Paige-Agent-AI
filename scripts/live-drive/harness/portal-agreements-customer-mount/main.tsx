// E09 Slice A — the agreements a business sent its customer, inside the REAL customer chrome.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts).
//
// The layout is AppShell's (src/pages/AppShell.tsx) reproduced with the same primitives and classes, exactly as the
// Progress harness does: AppNav on top, then PaigeChat 40% left (a labelled placeholder) and the routed page 60% right
// in an `overflow-y-auto p-4 md:p-6` scroller; below 768px only the page panel shows. The signing page (/sign/:token)
// is mounted on its own, as App.tsx mounts it — outside the customer shell — so the frame of it reached from the
// portal can be compared with the frame reached from the emailed link.
//
// THEME: the customer /app is themed by next-themes (App.tsx: attribute="class") — only a `light`/`dark` class on
// <html>, set here exactly as next-themes does.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";
import Agreements from "@/pages/app/Agreements";
import MyAgreements from "@/pages/MyAgreements";
import AgreementSigning from "@/pages/sign/AgreementSigning";
import { ClientHomeTiles } from "@/components/client/ClientHomeTiles";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { harnessUser } from "./stubs";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const user = harnessUser as unknown as User;

function PaigeChatPlaceholder() {
  return (
    <div
      data-harness-placeholder
      style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", fontSize: 13, textAlign: "center" }}
    >
      Paige chat — harness placeholder (the real PaigeChat panel is not mounted here)
    </div>
  );
}

/** Where a link went: the drive reads the path and query off this (Messages' ?draft= prefill is Slice 5's). */
function Elsewhere() {
  const l = useLocation();
  return <p data-harness-elsewhere style={{ color: "hsl(var(--muted-foreground))" }}>{l.pathname}{l.search}</p>;
}

function Shell() {
  return (
    <div className="h-dvh min-h-0 flex flex-col bg-background overflow-x-hidden" data-harness-app>
      <div style={{ display: "contents" }} data-harness-region="nav">
        <AppNav user={user} />
      </div>
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={40} minSize={30} maxSize={60} className="min-h-0 max-md:hidden">
          <PaigeChatPlaceholder />
        </ResizablePanel>
        <ResizableHandle withHandle className="max-md:hidden" />
        <ResizablePanel defaultSize={60} className="min-h-0 max-md:!flex-[1_1_100%]">
          <div data-harness-region="page" className="h-full overflow-y-auto scroll-touch p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-6">
            <Routes>
              <Route path="/app/agreements" element={<Agreements />} />
              <Route path="/app/agreements/platform" element={<MyAgreements />} />
              {/* The customer home's tile grid in AppShell's own home wrapper; the welcome and feed are not mounted. */}
              <Route path="/app" element={<div className="space-y-6 max-w-4xl mx-auto" data-harness-home><ClientHomeTiles userId={harnessUser.id} /></div>} />
              <Route path="*" element={<Elsewhere />} />
            </Routes>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

const signing = window.location.pathname.startsWith("/sign/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          {signing ? (
            <Routes><Route path="/sign/:token" element={<AgreementSigning />} /></Routes>
          ) : <Shell />}
          <span
            data-harness-tag
            aria-hidden="true"
            style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "0 0 4px 4px", fontFamily: "ui-monospace, monospace" }}
          >
            HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
          </span>
        </BrowserRouter>
      </QueryClientProvider>
    </HelmetProvider>
  </StrictMode>,
);
