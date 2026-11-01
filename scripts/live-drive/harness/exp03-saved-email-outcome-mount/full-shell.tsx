// Opt-in source proof: original shell + original PAIGE renderer, fictional ports.
// Never part of the app build; not authenticated or provider acceptance.
import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter,Route,Routes} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ThemeProvider} from "next-themes";
import {TenantCommandCenterShell} from "@/components/tenant-shell/TenantCommandCenterShell";
import {TenantRelationshipsClientsWorkspace} from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import {SoloPaigeWorkspace} from "@/solo/SoloPaigeWorkspace";
import {AgentPresenceProvider,useAgentPresence} from "@/components/ui/paige";
import {Toaster} from "@/components/ui/sonner";
import "@/index.css";
import "../portal-access-mount/fonts.css";
import "@/components/tenant-shell/tenant-command-center-shell.css";
import "@/solo/solo-tokens.css";

const theme=new URLSearchParams(location.search).get("theme")==="dark"?"dark":"light";
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Shell(){
 const {expandRail}=useAgentPresence();
 return <TenantCommandCenterShell accountName="Northwind Studio — fictional" accountType="standalone" userRole="admin" onSignOut={()=>{}} brandHomeHref="/solo/42/command-center" soloPaigeWorkspace={<SoloPaigeWorkspace/>}>
  <div className="paige-solo" data-theme={theme} style={{height:"100%",minHeight:0}}>
   <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
    <main data-solo-screen-host style={{flex:1,overflow:"hidden",minHeight:0,minWidth:0}}>
     <Routes><Route path="/solo/:account/*" element={<TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={expandRail}/>}/></Routes>
    </main>
   </div>
  </div>
 </TenantCommandCenterShell>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><QueryClientProvider client={client}><ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey={`exp03-fictional-shell-${theme}`}><BrowserRouter><AgentPresenceProvider launcherEnabled={false} hasChatBody><Shell/></AgentPresenceProvider><Toaster/></BrowserRouter></ThemeProvider></QueryClientProvider></StrictMode>);
