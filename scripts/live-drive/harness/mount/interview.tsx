import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloBusinessInterview } from "@/solo/SoloBusinessInterview";
import "@/index.css";
import "@/solo/solo-paige-workspace.css";
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
function Profile() {
  const [open, setOpen] = useState(true);
  return <div className="spw-root" style={{ containerType: "inline-size" }}><div className="spw-chat-head"><strong>PAIGE</strong><button type="button" onClick={() => setOpen(value => !value)}>{open ? "Close profile" : "Business interview"}</button></div>{open && <SoloBusinessInterview threadId="synthetic-thread" busy={false} refreshEpoch={0} onPause={() => setOpen(false)} />}<div style={{ flex: 1, minHeight: 0, padding: 20, overflow: "auto" }}><p>HARNESS RENDER · NOT LIVE</p><p>The profile above is the product component. Its data provider is synthetic. Chat transport, authentication and server persistence are not exercised here.</p></div><div style={{ padding: 16 }}>Synthetic conversation area — no model call.</div></div>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" forcedTheme={theme}><AgentPresenceProvider hasChatBody><MemoryRouter initialEntries={["/solo/synthetic/paige/chat"]}><TenantCommandCenterShell accountName="SYNTHETIC / Example Services" accountType="standalone" userRole="admin" onSignOut={() => {}} soloPaigeWorkspace={<Profile />}><Profile /></TenantCommandCenterShell></MemoryRouter></AgentPresenceProvider></ThemeProvider>);
