/** DEV-ONLY synthetic render. Separate Vite root excludes this entry from production. */
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { FinanceWorkspace } from "@/solo/finance/FinanceWorkspace";
import "@/index.css";
const params=new URLSearchParams(location.search);
const theme=params.get("theme")??"dark";
localStorage.setItem("paige.tenantShell.navExpanded","false");
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme={theme} forcedTheme={theme}><AgentPresenceProvider hasChatBody><MemoryRouter initialEntries={[`/solo/synthetic/finance/${params.get("tab")??"overview"}`]}><Routes><Route path="/solo/:account/*" element={<TenantCommandCenterShell accountName="SYNTHETIC / Northstar Studio" accountType="standalone" userRole="admin" onSignOut={()=>{}} soloPaigeWorkspace={<div style={{padding:24}}>SYNTHETIC PAIGE geometry fixture. Live conversation is unverified.</div>}><div style={{height:"100%",minHeight:0,overflow:"hidden"}}><FinanceWorkspace epoch="11111111-1111-4111-8111-111111111111"/></div></TenantCommandCenterShell>}/></Routes></MemoryRouter></AgentPresenceProvider></ThemeProvider>);
