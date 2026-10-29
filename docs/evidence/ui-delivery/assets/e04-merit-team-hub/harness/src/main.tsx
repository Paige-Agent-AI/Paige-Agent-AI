// Real original SOLO shell and PAIGE workspace. Only backend/identity ports are
// offline doubles. This is source-rendered geometry, NEVER authenticated proof.
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { AgentPresenceProvider, useAgentPresence } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloPaigeWorkspace } from "@/solo/SoloPaigeWorkspace";
import { VoiceDeviceProvider } from "@/lib/voice/VoiceDeviceProvider";
import { TeamHubWorkspace } from "@/solo/team-hub/TeamHubWorkspace";
import { FixtureTenantProvider, fixtureTenant, useTenantContext, useFixtureSwitch } from "./mock-tenant";
import "@/index.css";
import "@/solo/solo-tokens.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const q = new URLSearchParams(location.search);
document.documentElement.dataset.pg = q.get("theme") === "light" ? "light" : "dark";
// The actual shell resolves SOLO navigation from the actual route, never a
// fixture-specific layout. Preserve query-selected render context on entry.
if (location.pathname === "/") history.replaceState(null, "", `/solo/${fixtureTenant().account_number}/team-hub${location.search}`);

function Workspace() {
  const { activeTenant } = useTenantContext(), switchFixture = useFixtureSwitch();
  const { expandRail } = useAgentPresence(), navigate = useNavigate(), location = useLocation();
  const account = activeTenant.account_number;
  return <div data-offline-full-solo-shell data-fixture-account={account} style={{ height: "100dvh", overflow: "hidden" }}>
    <TenantCommandCenterShell accountName={activeTenant.name} accountType="standalone" userRole="admin"
      onSignOut={() => undefined} accountControls={<button type="button" onClick={() => {
        const next = switchFixture(); navigate(`/solo/${next}/team-hub`);
      }}>Switch offline fixture workspace</button>}
      soloPaigeWorkspace={<SoloPaigeWorkspace full={false} dockedTab="chat" onDockedTabChange={() => undefined} />}>
      <main data-solo-screen-host style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {location.pathname.includes("/sales/agreements") ? <section style={{ padding: 24 }}>
          <h1>Offline original-record route boundary</h1>
          <p>The real record link reached {location.pathname}{location.search}. No agreement or authentication is supplied by this fixture.</p>
          <button onClick={() => navigate(`/solo/${account}/team-hub`)}>Return to Team Hub fixture</button>
        </section> : <TeamHubWorkspace openPaige={expandRail} onOpenTeamSettings={() => undefined} />}
      </main>
    </TenantCommandCenterShell>
  </div>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme={q.get("theme") === "light" ? "light" : "dark"} enableSystem={false}>
  <QueryClientProvider client={client}><FixtureTenantProvider><BrowserRouter>
    <AgentPresenceProvider launcherEnabled={false} hasChatBody={q.get("paige") === "open"}>
      <VoiceDeviceProvider><Workspace /></VoiceDeviceProvider>
    </AgentPresenceProvider>
  </BrowserRouter></FixtureTenantProvider></QueryClientProvider>
</ThemeProvider>);
