import { createRoot } from "react-dom/client";
import "@/index.css";
import "@/solo/settings.css";
import { SoloTeamWorkspace } from "@/solo/team-workspace";
import { TeamHubWorkspace } from "@/solo/team-hub/TeamHubWorkspace";
const q = new URLSearchParams(location.search);
const theme = q.get("theme") ?? "light";
document.documentElement.setAttribute("data-pg", theme);
document.body.style.background = "var(--pg-canvas)";
function Shell() {
  if (q.get("s") === "hub-off") return <div data-pg={theme} className="paige-solo" style={{ height: "100vh", background: "var(--pg-canvas)" }}><TeamHubWorkspace /></div>;
  return <div data-pg={theme} className="paige-solo solo-settings" style={{ minHeight: q.get("frame") ? undefined : "100vh", padding: "clamp(16px, 2.2vw, 28px)", background: "var(--pg-canvas)", color: "var(--pg-ink)", fontFamily: "var(--pg-font-ui)", fontSize: "var(--pg-t-body)" }}>
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 14 }}>
      <header className="ss-page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><span style={{ display: "none" }}>Solo settings</span><h1 style={{ margin: "1px 0", font: "650 var(--pg-t-title)/1.15 var(--pg-font-display)", letterSpacing: "-.02em" }}>Team</h1><p style={{ margin: 0, color: "var(--pg-muted)", fontSize: 11.5 }}>Harness frame: the Settings shell header is drawn as a label-free stand-in.</p></div></header>
      <SoloTeamWorkspace openPaige={() => undefined} openConnections={() => undefined} />
    </div>
  </div>;
}
// Evidence frames: ?frame=1 wraps the page in a 72px rail stand-in and, with ?paige=open, the PAIGE
// stand-in the Solo shell uses — inline beside the page above 1024px, an overlay at 1024px and below.
function Framed() {
  const paige = q.get("paige") === "open";
  const vw = window.innerWidth;
  const inline = paige && vw > 1024;
  const width = vw >= 1500 ? 399 : 340;
  return <div style={{ display: "flex", minHeight: "100vh", background: "var(--pg-canvas)" }} data-pg={theme}>
    <aside aria-label="Rail stand-in" style={{ width: 72, flex: "none", borderRight: "1px solid var(--pg-line)", background: "var(--pg-surface)" }} />
    <main style={{ flex: 1, minWidth: 0 }}><Shell /></main>
    {inline && <aside aria-label="PAIGE stand-in" style={{ width, flex: "none", borderLeft: "1px solid var(--pg-line)", background: "var(--pg-surface)" }} />}
    {paige && !inline && <><div style={{ position: "fixed", inset: 0, zIndex: 7, backdropFilter: "blur(3px)", background: "color-mix(in srgb, var(--pg-canvas) 40%, transparent)" }} /><aside aria-label="PAIGE stand-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 410, zIndex: 8, borderLeft: "1px solid var(--pg-line)", background: "var(--pg-surface)" }} /></>}
  </div>;
}
createRoot(document.getElementById("root")!).render(q.get("frame") ? <Framed /> : <Shell />);
