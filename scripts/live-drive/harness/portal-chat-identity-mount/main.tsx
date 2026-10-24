// E09 CURA identity, round 2 — the customer /app home, AS APPSHELL LAYS IT OUT (src/pages/AppShell.tsx): AppNav
// on top; the REAL PaigeChat at 40% on the left; the REAL AppDashboardHome at 60% on the right (below 768px only
// the chat shows on /app, exactly as AppShell does); the REAL PushNotificationPrompt over it.
// HARNESS RENDER · SYNTHETIC DATA · NOT LIVE (see stubs.ts). AppShell itself is not mounted: it gates on a real
// session, consents, onboarding and landing-route resolution, which this harness cannot honestly fake.
//
// THEME: the customer /app is themed by next-themes (attribute="class"): only a light/dark class on <html>.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { AppNav } from "@/components/app/AppNav";
import { PaigeChat } from "@/components/app/PaigeChat";
import { AppDashboardHome } from "@/pages/AppShell";
import { PushNotificationPrompt, pushTopicsSentence } from "@/components/notifications/PushNotificationPrompt";
import { CustomerIdentityProvider } from "@/lib/portal/customerIdentity";
import { TenantProvider } from "@/hooks/useTenantContext";
import { useClientPortalFrame } from "@/hooks/useClientPortalFrame";
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
const creditAlerts = params.get("funding") === "1";

function Shell() {
  // AppShell's CustomerIdentityRoot: one frame read shared with every page; staff standing is false here.
  const customer = useClientPortalFrame(user.id, true);
  const state = { frame: customer.frame as never, phase: customer.phase as never, staff: customer.frame ? null : false, staffAssistantName: null };
  return (
    <CustomerIdentityProvider state={state}>
      <PushNotificationPrompt description={pushTopicsSentence({ creditAlerts })} suppressed={false} />
      <div className="h-dvh min-h-0 flex flex-col bg-background overflow-x-hidden" data-harness-app>
        <AppNav user={user} />
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={40} minSize={30} maxSize={60} className="min-h-0 max-md:!flex-[1_1_100%]">
            <div data-harness-region="chat" className="h-full"><PaigeChat user={user} session={null} /></div>
          </ResizablePanel>
          <ResizableHandle withHandle className="max-md:hidden" />
          <ResizablePanel defaultSize={60} className="min-h-0 max-md:hidden">
            <div data-harness-region="page" className="h-full overflow-y-auto scroll-touch p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-6">
              <AppDashboardHome factors={null} userId={user.id} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </CustomerIdentityProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {/* App.tsx mounts TenantProvider above /app; with the stubbed transport it resolves no workspace. */}
        <TenantProvider><Shell /></TenantProvider>
        <span
          data-harness-tag
          aria-hidden="true"
          style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 10, lineHeight: "14px", padding: "0 6px", zIndex: 2147483647, pointerEvents: "none", whiteSpace: "nowrap", background: "#111111", color: "#ffffff", borderRadius: "4px 4px 0 0", fontFamily: "ui-monospace, monospace" }}
        >
          HARNESS RENDER · SYNTHETIC DATA · NOT LIVE
        </span>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
