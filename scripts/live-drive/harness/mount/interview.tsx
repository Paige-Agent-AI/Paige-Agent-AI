import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloPaigeWorkspace } from "@/solo/SoloPaigeWorkspace";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { scenario, fixtureIdentity, recoverSyntheticSource, advanceSyntheticRevision } from "./interview.fixture";
import "@/index.css";
import "@/solo/solo-paige-workspace.css";
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
function RequestedTheme() { const { setTheme } = useTheme(); useEffect(() => { setTheme(theme); }, [setTheme]); return null; }
const full = new URLSearchParams(location.search).get("layout") !== "docked";
function Profile() { return <><div data-harness-label style={{position:"fixed",top:4,right:6,zIndex:100,fontSize:10,pointerEvents:"none",background:"hsl(var(--background))",color:"hsl(var(--muted-foreground))"}}>SYNTHETIC RENDER · NOT AUTHENTICATED ACCEPTANCE</div><SoloPaigeWorkspace full={full} onboarding /></>; }
function HarnessPage() {
  const location = useLocation();
  return <main style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "auto", padding: 24 }}><h1 style={{ fontSize: 21 }}>Experience 01 component evidence</h1><p>SYNTHETIC HARNESS · NOT AUTHENTICATED PRODUCT ACCEPTANCE</p><p>Actual SOLO workspace, Chat, presence and interview components. All source hooks and transport are synthetic; this is render evidence only.</p><p>Context: {fixtureIdentity.name} · State: {scenario}</p><p>Memory-router destination: {location.pathname}</p><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><button type="button" onClick={recoverSyntheticSource}>Resolve synthetic dependency</button><button type="button" onClick={advanceSyntheticRevision}>Simulate concurrent Setup change</button></div></main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false}><RequestedTheme /><AgentPresenceProvider hasChatBody><MemoryRouter initialEntries={["/solo/" + fixtureIdentity.tenantId + "/paige/chat"]}><TenantCommandCenterShell paigeFull={full} accountName={fixtureIdentity.name} accountType="standalone" userRole="admin" onSignOut={() => {}} soloPaigeWorkspace={<Profile />}><HarnessPage /></TenantCommandCenterShell></MemoryRouter></AgentPresenceProvider></ThemeProvider></QueryClientProvider>);
