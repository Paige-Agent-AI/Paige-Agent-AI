import { createRoot } from "react-dom/client";
import { SoloTeamWorkspace } from "@/solo/team-workspace";
// The toast layer is MOUNTED here deliberately. Without it `toast.*` renders nothing, so any
// outcome routed to that channel was invisible to this harness — it would have reported a missing
// message as a product defect, or worse, an assertion moved off it as a pass. Some outcomes must
// outlive the dialog (a workspace switch mid-removal), and this is where they land.
import { Toaster } from "sonner";
import "@/index.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/solo/settings.css";

// Both genuine themes are renderable: `?theme=light` must produce a real light surface, not a
// slightly-less-dark one. The harness sets every switch the app itself sets.
const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
// The shell's PAIGE dock narrows the content column, so a screen can fit with the dock closed and
// reflow badly with it open. `?paige=open` sets the shell's own switch (as the integrations mount
// does); the default stays closed, so existing drives are unchanged.
const paige = new URLSearchParams(window.location.search).get("paige") === "open" ? "open" : "closed";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

function Harness() {
  return <div data-tenant-shell data-nav="expanded" data-paige={paige}><nav className="tcs-nav"/><section className="tcs-canvas"><header className="tcs-command-row"><div className="tcs-context"><span>Settings / Team · structural harness</span></div></header><main id="tenant-shell-main" className="tcs-main"><div className="paige-solo" data-theme={theme} style={{ height: "100%", minHeight: 0 }}><div style={{ display: "flex", height: "100%", overflow: "hidden" }}><main data-solo-screen-host className="tcs-main--settings-scrollbar-hidden tcs-main--settings-scrollbar-shown" style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}><section className="solo-settings"><div className="ss-content"><SoloTeamWorkspace openPaige={() => { document.body.dataset.paigeOpened = "true"; }}/></div></section></main></div></div></main></section><Toaster/></div>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
