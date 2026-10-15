import React, { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ThemeProvider, useTheme } from "next-themes";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { SoloScreenBoundary } from "@/solo/SoloScreenBoundary";
import { PlatformUpdateBanner } from "@/components/PlatformUpdateBanner";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { ProofPresence, useAgentPresence } from "./adapter";

let deployed = "test-current-build";
window.fetch = (async (url: string | URL | Request) => {
  if (typeof url !== "string" || !/^\/version\.json\?t=\d+$/.test(url)) throw new Error("Only synthetic local version read allowed");
  return new Response(JSON.stringify({ buildId: deployed, customerUpdate: null }), { status: 200 });
}) as typeof fetch;
const MissingScreen = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: test-screen.js")));
function PaigeFixture() {
  const [draft, setDraft] = useState(""); useBeforeUnloadGuard(Boolean(draft));
  return <div className="p-4"><h2>PAIGE render fixture</h2><label className="block mt-4">Protected local draft<input aria-label="Protected local draft" className="block w-full border rounded p-2" value={draft} onChange={e => setDraft(e.target.value)} /></label><button className="border rounded px-3 py-2 mt-3" onClick={() => setDraft("")}>Clear local fixture draft</button><p className="mt-3 text-sm">No Chat or business action is connected.</p></div>;
}
function SourceProof() {
  const location = useLocation(); const { expandRail, collapseRail, railExpanded } = useAgentPresence(); const { resolvedTheme, setTheme } = useTheme();
  const [actor, setActor] = useState("a"); const [failed, setFailed] = useState(false);
  return <><TenantCommandCenterShell accountName={`Test Studio ${actor.toUpperCase()}`} accountType="standalone" userRole="admin" onSignOut={() => { throw new Error("No Auth effects in render proof"); }} soloPaigeWorkspace={<PaigeFixture key={actor} />}>
    <div className="paige-solo" style={{ width: "100%", minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="border-b p-3 flex flex-wrap gap-2 text-xs" aria-label="Isolated proof controls"><strong>Isolated source proof · no business actions</strong><button onClick={() => { setFailed(true); deployed = "test-next-build"; window.dispatchEvent(new Event("vite:preloadError", { cancelable: true })); }}>Simulate missing screen</button><button onClick={() => { setActor(actor === "a" ? "b" : "a"); setFailed(false); }}>Switch synthetic account</button><button onClick={() => railExpanded ? collapseRail() : expandRail()}>Toggle fixture PAIGE</button><button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>Toggle fixture theme</button></div>
      <main data-source-proof-screen style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" }}><SoloScreenBoundary key={`${actor}:${location.pathname}`}><Suspense fallback="Opening page">{failed ? <MissingScreen /> : <div className="p-6"><h1 className="text-xl font-semibold">Current scoped page</h1><p className="mt-2">Existing native shell and source recovery components; synthetic department content.</p></div>}</Suspense></SoloScreenBoundary></main>
    </div>
  </TenantCommandCenterShell><PlatformUpdateBanner /></>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}><MemoryRouter initialEntries={["/solo/test-account/clients/conversations"]}><ProofPresence><SourceProof /></ProofPresence></MemoryRouter></ThemeProvider>);
