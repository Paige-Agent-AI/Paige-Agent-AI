import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// The app's real stylesheet (Tailwind and the --pg-* roots), as the A2 harness.
import "@/index.css";
import { TeamHubWorkspace } from "@/solo/team-hub/TeamHubWorkspace";
import { teamHubNavigation } from "@/solo/team-hub/useTeamHub";

// EXP08 Team Hub agents A2b harness frame (copied from A2's). The hub gets exactly the width and height
// the tenant shell gives its screen host. The rail, command row and PAIGE panel are labelled STAND-INS,
// not the real shell. A2b CHANGE: no onApprovalAct is passed, exactly as src/solo/SoloApp.tsx mounts the
// hub, so every Approve / Not now goes through the hub's own actOnCard -> { teamHubCardAct } ->
// functions.invoke("paige-ai-chat"), answered by the double in src/mock-supabase.ts.
const q = new URLSearchParams(location.search);
const vw = Number(q.get("vw")); const vh = Number(q.get("vh"));
const rail = Number(q.get("rail")); const row = Number(q.get("row") ?? 66);
const paige = q.get("paige") ?? "closed"; const pw = Number(q.get("pw") ?? 0);
document.documentElement.setAttribute("data-pg", q.get("theme") ?? "dark");
const hubW = vw - rail - (paige === "inline" ? pw : 0);
const w = window as unknown as { __thPaigeOpened?: number; __thPrefill?: string[]; __thNavigated?: string[] };
window.addEventListener("paige:prefill", (event) => { (w.__thPrefill ??= []).push(String((event as CustomEvent).detail?.prompt ?? "")); });
const openPaige = () => { w.__thPaigeOpened = (w.__thPaigeOpened ?? 0) + 1; };
teamHubNavigation.assign = (url: string) => { (w.__thNavigated ??= []).push(url); };
const label: React.CSSProperties = { font: "500 11px/1.4 var(--pg-font-ui)", color: "var(--pg-faint)", padding: 12 };

/** Harness only: mirrors the hub's visually hidden live region into the stand-in command row, so a frame can show what a screen reader is told. */
function LiveMirror() {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const read = () => { const el = document.querySelector(".th-hub .th-sr[aria-live=polite]"); const t = el?.textContent?.trim() ?? ""; if (t) setSaid(t); };
    const mo = new MutationObserver(read);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  }, []);
  return <div style={{ ...label, display: "flex", gap: 16, alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" }}>
    <span>Command row · stand-in · harness render, not live</span>
    {said && q.get("mirror") === "1" && <span data-harness="live-mirror" style={{ color: "var(--pg-ink)", whiteSpace: "normal" }}>Screen-reader announcement (visually hidden in the product): “{said}”</span>}
  </div>;
}

function Frame() {
  return <div style={{ position: "relative", display: "grid", gridTemplateColumns: `${rail}px ${hubW}px ${paige === "inline" ? pw : 0}px`, width: vw, height: vh, overflow: "hidden", background: "var(--pg-env)" }}>
    <div style={{ background: "var(--pg-nav)", borderRight: "1px solid var(--pg-line-strong)" }}><div style={label}>Shell rail · stand-in · {rail}px</div></div>
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--pg-canvas)" }}>
      <div style={{ height: row, flex: "none", background: "var(--pg-spine)", borderBottom: "1px solid var(--pg-line-soft)", overflow: "hidden" }}><LiveMirror /></div>
      <main data-solo-screen-host style={{ flex: 1, overflow: "hidden", minHeight: 0, minWidth: 0 }}><TeamHubWorkspace onOpenTeamSettings={() => undefined} openPaige={openPaige} /></main>
    </div>
    {paige === "inline" && <div data-harness="paige-inline" style={{ background: "var(--pg-spine)", borderLeft: "1px solid var(--pg-line)" }}><div style={label}>PAIGE panel · stand-in · {pw}px</div></div>}
    {paige === "overlay" && <>
      <div data-harness="paige-scrim" style={{ position: "absolute", zIndex: 7, top: 0, bottom: 0, left: rail, right: Math.min(410, vw - rail), background: "rgba(8,7,11,.42)", backdropFilter: "blur(2px)" }} />
      <div data-harness="paige-overlay" style={{ position: "absolute", zIndex: 8, top: 0, bottom: 0, right: 0, width: Math.min(410, vw - rail), background: "var(--pg-spine)", borderLeft: "1px solid var(--pg-line)" }}><div style={label}>PAIGE panel · stand-in overlay · {Math.min(410, vw - rail)}px</div></div>
    </>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Frame />);
