// E09 Slice 4 — the customer's Documents (files the business shared, their own uploads, and work released for
// their review), inside the REAL customer chrome.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts).
//
// The layout is AppShell's (src/pages/AppShell.tsx L280-L305) reproduced with the same primitives and
// classes: AppNav on top, then a horizontal ResizablePanelGroup — PaigeChat 40% left (a labelled
// placeholder here), the routed page 60% right in an `overflow-y-auto p-4 md:p-6` scroller; below 768px
// only the page panel shows. AppShell itself is not mounted because it gates on a real session, consents,
// onboarding and landing-route resolution — none of which this harness can honestly fake.
//
// THEME: the customer /app is themed by next-themes (App.tsx: attribute="class"), i.e. ONLY a `light` /
// `dark` class on <html>. The real ThemeProvider is mounted (forced to the shot's theme) because the review
// dialog reads its theme from next-themes, exactly as in the app. It never sets `data-pg` on <html> (that bridge is the tenant shell's), and
// setting it here would swap in different --background/--primary values than customers see. So this
// harness deliberately sets the class + color-scheme exactly as next-themes does, and nothing else.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";
import { ThemeProvider } from "next-themes";
import ClientDocuments from "@/pages/app/ClientDocuments";
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

function Elsewhere() {
  return <p style={{ color: "hsl(var(--muted-foreground))" }}>Another customer page (harness placeholder)</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" forcedTheme={theme} disableTransitionOnChange>
    <QueryClientProvider client={client}>
      <BrowserRouter>
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
                  <Route path="/app/documents" element={<ClientDocuments />} />
                  {/* The customer home's tile grid, in AppShell's own home wrapper (AppShell.tsx L336/L375); the
                      welcome, checklist and activity feed above/below it are not mounted. */}
                  <Route path="/app" element={<div className="space-y-6 max-w-4xl mx-auto" data-harness-home><ClientHomeTiles userId={harnessUser.id} /></div>} />
                  <Route path="*" element={<Elsewhere />} />
                </Routes>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <span
          data-harness-tag
          aria-hidden="true"
          style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "0 0 4px 4px", fontFamily: "ui-monospace, monospace" }}
        >
          HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
        </span>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
