import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloBusinessInterview } from "@/solo/SoloBusinessInterview";
import { Card } from "@/components/ui/card";
import { scenario, fixtureIdentity, recoverSyntheticSource, advanceSyntheticRevision } from "./interview.fixture";
import "@/index.css";
import "@/solo/solo-paige-workspace.css";
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
function RequestedTheme() { const { setTheme } = useTheme(); useEffect(() => { setTheme(theme); }, [setTheme]); return null; }
function Profile() {
  const [open, setOpen] = useState(true);
  return <div className="spw-root" style={{ containerType: "inline-size" }}><Card className="flex flex-col h-full min-h-0 rounded-none border-0 shadow-none">
    <div className="spw-chat-head"><div><strong>PAIGE</strong><span>Synthetic render context</span></div><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close profile" : "Business interview"}</button></div>
    {open && <SoloBusinessInterview threadId={scenario === "first-use" ? null : fixtureIdentity.threadId} busy={scenario === "busy"} refreshEpoch={0} onPause={() => setOpen(false)} />}
    <div style={{ flex: 1, minHeight: 0, padding: 16, overflow: "auto" }}><p>Synthetic conversation region</p><p>No Chat transport, model, authentication or server persistence is exercised in this render harness.</p></div>
    <div style={{ flex: "none", padding: 12, borderTop: "1px solid hsl(var(--border))" }}><label style={{ display: "block" }}>Reserved composer region — no send capability<textarea disabled rows={2} style={{ width: "100%", resize: "none" }} placeholder="Actual Chat acceptance requires the approved runner" /></label></div>
  </Card></div>;
}
function HarnessPage() {
  const location = useLocation();
  return <main style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "auto", padding: 24 }}><h1 style={{ fontSize: 21 }}>Experience 01 component evidence</h1><p>SYNTHETIC HARNESS · NOT AUTHENTICATED PRODUCT ACCEPTANCE</p><p>One actual profile component in the incumbent shell, with bounded Card/transcript/composer regions. This page is an evidence label, not a second profile.</p><p>Context: {fixtureIdentity.name} · State: {scenario}</p><p>Memory-router destination: {location.pathname}</p><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><button type="button" onClick={recoverSyntheticSource}>Resolve synthetic dependency</button><button type="button" onClick={advanceSyntheticRevision}>Simulate concurrent Setup change</button></div></main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false}><RequestedTheme /><AgentPresenceProvider hasChatBody><MemoryRouter initialEntries={["/solo/" + fixtureIdentity.tenantId + "/paige/chat"]}><TenantCommandCenterShell accountName={fixtureIdentity.name} accountType="standalone" userRole="admin" onSignOut={() => {}} soloPaigeWorkspace={<Profile />}><HarnessPage /></TenantCommandCenterShell></MemoryRouter></AgentPresenceProvider></ThemeProvider>);
