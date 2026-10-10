/** DEV-ONLY synthetic adapter proof. Separate Vite root excludes this from production. */
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AgentPresenceProvider } from "@/components/ui/paige";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { DebtCreditWorkspace } from "@/solo/finance/debt-credit/DebtCreditWorkspace";
import type { DebtCreditEnvelope, DebtCreditObligation } from "@/solo/finance/debt-credit/types";
import { FINANCE_TABS } from "@/solo/finance/FinanceWorkspace";
import "@/index.css";
const params = new URLSearchParams(location.search), theme = params.get("theme") ?? "dark";
const now = Date.now(), asOf = new Date(now - 3600000).toISOString();
const due = new Date(now + 5 * 86400000).toISOString().slice(0,10);
const products = ["business_card","business_card","revolving_line","revolving_line","term_loan","other_financing"] as const;
const balances = ["820000","460000","2200000","1500000","12400000",null];
const names = ["Travel & supplier card","Operations card","Working capital line","Seasonal credit line","Equipment loan","Founder financing"];
const rows: DebtCreditObligation[] = products.map((product,i) => ({obligationId:`test-obligation-${i}`,accountId:`test-account-${i}`,entity:{id:"test-entity-1",label:"Example Services Group"},currency:"USD",institution:{id:"test-bank-1",label:"Harbor Capital Bank"},product,originalLabel:names[i],balanceMinor:balances[i],principalMinor:product === "business_card" ? null : balances[i],limitMinor:i<4?"5000000":null,availableMinor:i<4?(5000000n-BigInt(balances[i]!)).toString():null,aprText:i<5?"7.5% variable":null,maturityDate:i===4?"2028-10-10":null,nextPayment:i<5?{amountMinor:"80000",principalMinor:"70000",interestMinor:"10000",dueDate:due}:null,source:{temporalBasis:"historical_statement",evidenceRef:`synthetic-evidence-${i}`,asOf,expiresAt:new Date(params.get("state")==="expired" ? now-1 : now+900000).toISOString(),label:"SYNTHETIC statement observation",coverage:"Synthetic current-source contract; no provider proof"},match:{status:"single_source"}}));
rows.push({...rows[0],obligationId:"test-unresolved",accountId:"test-unresolved-account",originalLabel:"Unmatched accounting credit account",balanceMinor:"950000",match:{status:"unresolved"}});
rows.push({...rows[0],obligationId:"test-cad",accountId:"test-cad-account",currency:"CAD",entity:{id:"test-entity-2",label:"Example Canada entity"},originalLabel:"Canadian operations card"});
const state=params.get("state") ?? "ready";
localStorage.setItem("paige.tenantShell.navExpanded","false");
function Proof() {
 const [revision,setRevision]=React.useState(0),[destination,setDestination]=React.useState("");
 const phase = ["loading","unavailable","error","denied","partial"].includes(state) ? state as DebtCreditEnvelope["phase"] : "ready";
 const source:DebtCreditEnvelope={phase,defaultEntityId:"test-entity-1",defaultCurrency:"USD",scopeEpoch:"test-epoch-A",readIdentity:`test-read-${revision}`,rows:["ready","partial"].includes(phase)&&state!=="empty"?rows:[],asOf,coverage:"SYNTHETIC ONLY. Two cards and two credit lines at one institution; unsupported founder terms and unresolved overlap remain excluded."};
 return <div className="finance-workspace"><nav className="finance-tabs" aria-label="Synthetic Finance context">{FINANCE_TABS.map(([key,label])=><button key={key} aria-current={key==="debt"?"page":undefined} disabled>{label}</button>)}</nav><div className="finance-content"><p style={{fontSize:11}}>SYNTHETIC COMPANY & SOURCE ADAPTER — NO LIVE PROVIDER OR FINANCIAL EFFECT</p><output data-proof-destination>{destination}</output><DebtCreditWorkspace source={source} epoch={params.get("epoch")==="other"?"test-epoch-B":"test-epoch-A"} retry={()=>setRevision(n=>n+1)} onIntegrations={()=>setDestination("/solo/synthetic/settings/integrations")} onReview={scope=>{setDestination("Existing PAIGE review handoff: "+scope.kind);window.dispatchEvent(new CustomEvent("paige:open",{detail:{prompt:"SYNTHETIC financial review handoff; no live company data or action."}}));}}/></div></div>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" defaultTheme={theme} forcedTheme={theme}><AgentPresenceProvider hasChatBody><MemoryRouter initialEntries={["/solo/synthetic/finance/debt-credit"]}><TenantCommandCenterShell accountName="SYNTHETIC / Example Services Group" accountType="standalone" userRole="admin" onSignOut={()=>{}} soloPaigeWorkspace={<div style={{padding:24}}>SYNTHETIC PAIGE geometry fixture. Live conversation unverified.</div>}><Proof/></TenantCommandCenterShell></MemoryRouter></AgentPresenceProvider></ThemeProvider>);
