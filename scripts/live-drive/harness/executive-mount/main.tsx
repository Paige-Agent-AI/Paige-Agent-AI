import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { CommandHub } from "@/solo/CommandCenter";
import { subscribePaigePromptHandoff } from "@/lib/paigePromptHandoff";
import { HarnessPresence, useAgentPresence } from "./stubs";
import "@/index.css";
import "@/solo/solo-tokens.css";

function Conversation() {
  const [draft, setDraft] = useState("");
  useEffect(() => subscribePaigePromptHandoff((p) => setDraft((d) => d ? d + "\n\n" + p : p)), []);
  return <section aria-label="Synthetic PAIGE conversation" style={{ height: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}><h2>PAIGE conversation</h2><p>Development-only composer. No model, microphone, provider, approval or business action can run.</p><label>Drafted question<textarea aria-label="Synthetic message draft" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: "100%", minHeight: 160, color: "var(--pg-ink)", background: "var(--pg-surface)", border: "1px solid var(--pg-line)", padding: 12 }} /></label><button disabled>Send unavailable in walkthrough</button></section>;
}
function App() {
  const { expandRail } = useAgentPresence();
  const { resolvedTheme, setTheme } = useTheme();
  const l = useLocation(), p = new URLSearchParams(l.search);
  useEffect(() => { setTheme(new URLSearchParams(l.search).get("theme") === "light" ? "light" : "dark"); }, [l.search, setTheme]);
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const name = p.get("workspace") === "b" ? "Example Studio" : "Example Services";
  return <>
    <style>{".e2-walkthrough-shell > [data-tenant-shell]{height:100%}.e2-walkthrough-shell .tcs-main{overflow:hidden}"}</style>
    <div className="e2-walkthrough-shell" style={{ height: "calc(100dvh - 32px)" }}>
      <TenantCommandCenterShell accountName={name} accountType="standalone" userRole={p.get("state") === "member" ? "member" : "admin"} onSignOut={() => {}} brandHomeHref="/solo/1234567/command-center" soloPaigeWorkspace={<Conversation />}>
        <div className="paige-solo" data-theme={theme} style={{ height: "100%", minHeight: 0, minWidth: 0 }}>
          <Routes><Route path="/solo/:account/*" element={l.pathname.includes("command-center") ? <CommandHub account="1234567" accountContext={{ accountName: name, accountType: "standalone" }} openPaige={expandRail} /> : <section style={{ padding: 24 }}><h2>Canonical destination</h2><p>{l.pathname + l.search}</p><p>Destination resolution only; the actual departmental read is not executed by this walkthrough.</p><Link to="/solo/1234567/command-center/executive">Back to Executive</Link></section>} /></Routes>
        </div>
      </TenantCommandCenterShell>
    </div>
    <nav aria-label="Development-only scenario controls" style={{ position: "fixed", bottom: 0, insetInline: 0, height: 32, overflow: "auto", display: "flex", alignItems: "center", gap: 12, padding: "0 12px", fontSize: 11, background: "var(--pg-raised)", color: "var(--pg-ink)", whiteSpace: "nowrap" }}><strong>SYNTHETIC WALKTHROUGH · NO BACKEND</strong>{["ready", "loading", "error", "unavailable", "empty", "member"].map((state) => <Link key={state} to={"/solo/1234567/command-center/executive?state=" + state + "&theme=" + theme}>{state}</Link>)}<Link to="/solo/1234567/command-center/executive?workspace=b">workspace B</Link></nav>
  </>;
}
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
createRoot(document.getElementById("root")!).render(<BrowserRouter><ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey="paige.e2.walkthrough.theme"><HarnessPresence><App /></HarnessPresence></ThemeProvider></BrowserRouter>);
