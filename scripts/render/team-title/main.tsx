// Mounts the REAL Solo Team screen inside the same wrappers Settings gives it (.paige-solo >
// .solo-settings > header + .ss-content), with the shell's stylesheets. The Supabase client and the
// tenant hook are replaced by the stubs beside this file; nothing else is. The shell's navigation
// and the PAIGE panel are not rendered here, so these frames prove the screen's own copy and layout
// at each width, not the authenticated shell.
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import "../../../src/solo/solo-tokens.css";
import "../../../src/solo/settings.css";
import { SoloTeamWorkspace } from "../../../src/solo/team-workspace";

const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-theme", theme);
if (theme === "dark") document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  // data-pg scopes the --pg-* tokens, exactly as TenantCommandCenterShell sets it for the Solo shell.
  <div className="paige-solo" data-pg={theme} data-theme={theme} style={{ minHeight: "100vh" }}>
    <div className="solo-settings">
      <header className="ss-page-head"><div><span>Solo settings</span><h1>Team</h1><p>Who works in this business, what they do, and what they can access.</p></div></header>
      <div className="ss-content" data-settings-tab="team"><SoloTeamWorkspace /></div>
    </div>
  </div>,
);
