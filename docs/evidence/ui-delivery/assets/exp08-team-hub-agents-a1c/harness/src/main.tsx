import { createRoot } from "react-dom/client";
import "./tokens.css";
import { TeamHubWorkspace } from "@/solo/team-hub/TeamHubWorkspace";
import { teamHubNavigation } from "@/solo/team-hub/useTeamHub";

// EXP08 Team Hub agents A1c harness frame. The hub gets exactly the width and height the tenant shell gives its screen
// host. The rail, command row and PAIGE panel are labelled PLACEHOLDERS, not the real shell.
const q = new URLSearchParams(location.search);
const vw = Number(q.get("vw")); const vh = Number(q.get("vh"));
const rail = Number(q.get("rail")); const row = Number(q.get("row") ?? 66);
const paige = q.get("paige") ?? "closed"; const pw = Number(q.get("pw") ?? 0);
document.documentElement.setAttribute("data-pg", q.get("theme") ?? "dark");
const hubW = vw - rail - (paige === "inline" ? pw : 0);
// The shell's openPaige is a placeholder here: it only records that it was called, and the
// paige:prefill event handOffPaigePrompt dispatches is recorded so the draft can be checked.
const w = window as unknown as { __thPaigeOpened?: number; __thPrefill?: string[] };
window.addEventListener("paige:prefill", (event) => { (w.__thPrefill ??= []).push(String((event as CustomEvent).detail?.prompt ?? "")); });
const openPaige = () => { w.__thPaigeOpened = (w.__thPaigeOpened ?? 0) + 1; };
// Download navigates away; here it is recorded instead, so the frame stays and the URL can be checked.
teamHubNavigation.assign = (url: string) => { ((window as unknown as { __thNavigated?: string[] }).__thNavigated ??= []).push(url); };
const label: React.CSSProperties = { font: "500 11px/1.4 var(--pg-font-ui)", color: "var(--pg-faint)", padding: 12 };

function Frame() {
  return <div style={{ position: "relative", display: "grid", gridTemplateColumns: `${rail}px ${hubW}px ${paige === "inline" ? pw : 0}px`, width: vw, height: vh, overflow: "hidden", background: "var(--pg-env)" }}>
    <div style={{ background: "var(--pg-nav)", borderRight: "1px solid var(--pg-line-strong)" }}><div style={label}>Shell rail · placeholder · {rail}px</div></div>
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--pg-canvas)" }}>
      <div style={{ height: row, flex: "none", background: "var(--pg-spine)", borderBottom: "1px solid var(--pg-line-soft)" }}><div style={label}>Command row · placeholder</div></div>
      <main data-solo-screen-host style={{ flex: 1, overflow: "hidden", minHeight: 0, minWidth: 0 }}><TeamHubWorkspace onOpenTeamSettings={() => undefined} openPaige={openPaige} /></main>
    </div>
    {paige === "inline" && <div style={{ background: "var(--pg-spine)", borderLeft: "1px solid var(--pg-line)" }}><div style={label}>PAIGE panel · placeholder · {pw}px</div></div>}
    {paige === "overlay" && <>
      <div style={{ position: "absolute", zIndex: 7, top: 0, bottom: 0, left: rail, right: Math.min(410, vw - rail), background: "rgba(8,7,11,.42)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "absolute", zIndex: 8, top: 0, bottom: 0, right: 0, width: Math.min(410, vw - rail), background: "var(--pg-spine)", borderLeft: "1px solid var(--pg-line)" }}><div style={label}>PAIGE panel · placeholder overlay · {Math.min(410, vw - rail)}px</div></div>
    </>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Frame />);
