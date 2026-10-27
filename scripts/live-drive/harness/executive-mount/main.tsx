import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { CommandHub } from "@/solo/CommandCenter";
import { subscribePaigePromptHandoff } from "@/lib/paigePromptHandoff";
import { HarnessPresence, useAgentPresence, useSoloPendingActions } from "./stubs";
import { ReportReadFixture } from "./report-fixture";
import { SoloPlanningSuggestion } from "@/solo/SoloPlanningSuggestion";
import { PreparedWorkReview } from "@/solo/PreparedWorkReview";
import "@/index.css";
import "@/solo/solo-tokens.css";

const Catalogue = lazy(() => import("@/solo/SoloPaigeWorkspace").then(module => ({ default: module.SoloPaigeWorkspace })));
function CataloguePanel() {
  const [tab, setTab] = useState<"chat" | "knowledge" | "research" | "helpers" | "capabilities">("capabilities");
  return <Suspense fallback={<p>Loading the synthetic catalogue…</p>}><Catalogue dockedTab={tab} onDockedTabChange={setTab} /></Suspense>;
}
function DeskEntry() {
  const data = useSoloPendingActions();
  return <section style={{padding:24}}><h2>Decision Desk component mount</h2><p>Synthetic prepared-work port. The complete Business Game Plan page is outside this bounded component proof.</p><PreparedWorkReview data={data}><button style={{minHeight:44,padding:12,border:'1px solid var(--pg-line)',borderRadius:'var(--pg-r-chip)'}}>Read prepared work</button></PreparedWorkReview></section>;
}

function Conversation() {
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  useEffect(() => subscribePaigePromptHandoff((p) => setDraft((d) => d ? d + "\n\n" + p : p)), []);
  return <section aria-label="Synthetic PAIGE conversation" style={{ height: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}><h2>PAIGE conversation</h2><p>Development-only composer. No model, microphone, provider, approval or business action can run.</p>
    {import.meta.env.E2_HARNESS_SLICE === "desk" && <SoloPlanningSuggestion key={location.pathname} api={{ threadId:null, ready:true, busy:false, hasOwnerMessages:false, restoreLayout:()=>undefined, focusComposer:()=>composer.current?.focus({preventScroll:true}) }} tenantId="test-tenant-desk" actorId="test-actor-desk" relevant={location.pathname.includes("business-game-plan")} active plan={null} onClearContext={()=>undefined} sidePanel />}
    <label>Drafted question<textarea ref={composer} aria-label="Synthetic message draft" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: "100%", minHeight: 160, color: "var(--pg-ink)", background: "var(--pg-surface)", border: "1px solid var(--pg-line)", padding: 12 }} /></label><button disabled>Send unavailable in walkthrough</button></section>;
}
function App() {
  const { expandRail } = useAgentPresence();
  const { resolvedTheme, setTheme } = useTheme();
  const l = useLocation(), p = new URLSearchParams(l.search);
  useEffect(() => { const requested = new URLSearchParams(l.search).get("theme"); if (requested === "light" || requested === "dark") setTheme(requested); }, [l.search, setTheme]);
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const name = p.get("workspace") === "b" ? "Example Studio" : "Example Services";
  return <>
    <style>{".e2-walkthrough-shell > [data-tenant-shell]{height:100%}.e2-walkthrough-shell .tcs-main{overflow:hidden}"}</style>
    <div className="e2-walkthrough-shell" style={{ height: "calc(100dvh - 32px)" }}>
      <TenantCommandCenterShell accountName={name} accountType="standalone" userRole={p.get("state") === "member" ? "member" : "admin"} onSignOut={() => {}} brandHomeHref="/solo/1234567/command-center" soloPaigeWorkspace={p.get("view") === "capabilities" ? <CataloguePanel /> : <Routes><Route path="/solo/:account/*" element={<Conversation />} /></Routes>}>
        <div className="paige-solo" data-theme={theme} style={{ height: "100%", minHeight: 0, minWidth: 0 }}>
          <Routes><Route path="/solo/:account/*" element={import.meta.env.E2_HARNESS_SLICE === "report" ? <ReportReadFixture /> : import.meta.env.E2_HARNESS_SLICE === "desk" && l.pathname.includes("business-game-plan") ? <DeskEntry /> : l.pathname.includes("command-center") ? <CommandHub account="1234567" accountContext={{ accountName: name, accountType: "standalone" }} openPaige={expandRail} /> : <section style={{ padding: 24 }}><h2>Canonical destination</h2><p>{l.pathname + l.search}</p><p>Destination resolution only; the actual departmental read is not executed by this walkthrough.</p><Link to="/solo/1234567/command-center/executive">Back to Executive</Link></section>} /></Routes>
        </div>
      </TenantCommandCenterShell>
    </div>
    <nav aria-label="Development-only scenario controls" style={{ position: "fixed", bottom: 0, insetInline: 0, height: 32, overflow: "auto", display: "flex", alignItems: "center", gap: 12, padding: "0 12px", fontSize: 11, background: "var(--pg-raised)", color: "var(--pg-ink)", whiteSpace: "nowrap" }}><strong>SYNTHETIC WALKTHROUGH · NO BACKEND</strong>{import.meta.env.E2_HARNESS_SLICE === "desk" && <span>Alt+R: hold/release synthetic reread</span>}{["ready", "loading", "error", "unavailable", "empty", "member"].map((state) => <Link key={state} to={"/solo/1234567/command-center/executive?state=" + state + "&theme=" + theme}>{state}</Link>)}<Link to="/solo/1234567/command-center/executive?workspace=b">workspace B</Link></nav>
  </>;
}
// Renderer-side diagnostic: FontFaceSet iteration belongs to the real page,
// rather than the read-only inspection bridge. Synthetic evidence only.
function ProductFontProof() {
  const [status,setStatus]=useState("Product font: waiting");
  useEffect(()=>{let current=true;void document.fonts.ready.then(()=>{
    const face=Array.from(document.fonts).find(item=>item.family.replaceAll('"',"")==="Schibsted Grotesk"&&item.style==="normal"&&item.status==="loaded");
    if(current)setStatus(face?`Product font: Schibsted Grotesk · ${face.weight} · ${face.status}`:"Product font: unverified");
  });return()=>{current=false;};},[]);
  return <output style={{position:"fixed",bottom:32,right:4,zIndex:60,fontSize:10,color:"var(--pg-muted)"}}>{status}</output>;
}
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
createRoot(document.getElementById("root")!).render(<BrowserRouter><ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey="paige.e2.walkthrough.theme"><HarnessPresence><App /><ProductFontProof /></HarnessPresence></ThemeProvider></BrowserRouter>);
