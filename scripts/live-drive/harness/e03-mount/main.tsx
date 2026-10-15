// The REAL current ClientsConversations tree with explicitly simulated boundary adapters.
// This entry is outside the production build graph and cannot use a real session or provider.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import ClientsConversations from "@/pages/admin/ClientsConversations";
import { completeFixtureDraft, fixtureLog } from "./supabase-stub";
import "@/index.css";
const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.pg = theme; document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark",theme === "dark");
function Harness() {
  const [paige,setPaige] = useState(false); const [,refresh] = useState(0);
  useEffect(() => { const open=()=>setPaige(true);const changed=()=>refresh(n=>n+1); window.addEventListener("e03-paige-open",open);window.addEventListener("e03-fixture-log",changed);return()=>{window.removeEventListener("e03-paige-open",open);window.removeEventListener("e03-fixture-log",changed);}; },[]);
  return <div data-pg={theme} style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--pg-canvas)",color:"var(--pg-ink)"}}>
    <div style={{padding:"6px 12px",fontSize:12,borderBottom:"1px solid var(--pg-line)"}}>E03 actual components · fixtures only · no authenticated acceptance or provider sends <button onClick={()=>setPaige(p=>!p)} style={{marginLeft:16,textDecoration:"underline"}}>{paige?"Close":"Open"} PAIGE width fixture</button>{new URLSearchParams(location.search).get("case")==="draft-switch"&&<button onClick={completeFixtureDraft} style={{marginLeft:16,textDecoration:"underline"}}>Complete simulated draft</button>}</div>
    <div style={{display:"flex",flex:1,minHeight:0}}>
      <main style={{display:"flex",flexDirection:"column",flex:1,minWidth:0,minHeight:0}}><ClientsConversations /></main>
      {paige?<aside style={{width:"min(34vw,420px)",flexShrink:0,padding:16,borderLeft:"1px solid var(--pg-line)"}}>PAIGE panel width fixture. The existing production panel is unchanged.</aside>:null}
    </div>
    <output aria-label="Simulated boundary calls" style={{fontSize:11,padding:"3px 12px"}}>{fixtureLog.join(" · ") || "No boundary calls"}</output>
    <Toaster />
  </div>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><Harness /></BrowserRouter></QueryClientProvider>);
