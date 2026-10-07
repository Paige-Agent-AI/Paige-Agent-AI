import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, BarChart3, FileText, Columns3, LayoutList, Receipt, Search, Tag } from "lucide-react";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { subtabPath } from "@/lib/routing/tierBranches";
import type { TenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { useSoloCampaigns } from "./useSoloCampaigns";
import { PipelineSurface, DetailDrawer } from "./growth2";
import { CatalogOffers } from "./catalog-offers";
import { SalesOps } from "./sales-ops";
import { SalesPerformanceWorkspace } from "./sales/performance/SalesPerformanceWorkspace";
import { SalesOverview } from "./sales/SalesOverview";
import { CollectionsWorkspace } from "./sales/collections/CollectionsWorkspace";
import { dealInSalesPeriod, salesPeriodFromQuery } from "./sales/deriveSalesOverview";
import "./sales/sales-department.css";
const TABS = [["overview", "Overview", BarChart3], ["opportunities", "Opportunities", LayoutList], ["offers", "Offers", Tag], ["agreements", "Terms & Agreements", FileText], ["payments", "Payments", Receipt], ["performance", "Performance", BarChart3]] as const;
function requestSalesNavigation(proceed:()=>void) {
  const event=new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}});
  if(window.dispatchEvent(event))proceed();
}
function Opportunities({ data, open, onDetail }: { data: ReturnType<typeof useSoloCampaigns>; open(tab: string, query?: string): void; onDetail(value: unknown): void }) {
  const location=useLocation(),query=new URLSearchParams(location.search);
  const search=query.get("search")??"",period=salesPeriodFromQuery(query.get("period")),stage=query.get("stage")??"all",pipeline=query.get("pipeline")??"all",view=query.get("view")==="board"?"board":"list";
  const update=(patch:Record<string,string|null>)=>{const next=new URLSearchParams(location.search);Object.entries(patch).forEach(([key,value])=>value===null?next.delete(key):next.set(key,value));open("opportunities",next.toString())};
  const pipelines=data.pipelineWorkspace.pipelines.filter(item=>item.lifecycleStatus!=="archived");
  const stages=data.pipelineWorkspace.stages.filter(item=>!item.archivedAt&&(pipeline==="all"||item.pipelineId===pipeline));
  const matches=(deal:typeof data.pipelineWorkspace.deals[number])=>(stage==="all"||deal.stageId===stage)&&dealInSalesPeriod(deal.createdAt,period,Date.now())&&`${deal.title} ${deal.clientName} ${deal.owner}`.toLowerCase().includes(search.toLowerCase());
  if(data.phase!=="ready")return <div className="sales-empty" role={data.phase==="error"?"alert":"status"}><h2>{data.phase==="error"?"Opportunity records could not be read":["loading","resolving"].includes(data.phase)?"Reading this workspace’s opportunities…":"Workspace read unavailable"}</h2><p>No deal records are inferred from a failed or unresolved read.</p>{data.phase==="error"&&<button className="btn" onClick={data.retry}>Retry</button>}</div>;
  const rows=data.pipelineWorkspace.deals.filter(deal=>(pipeline==="all"||deal.pipelineId===pipeline)&&matches(deal));
  const board=(patch:Record<string,string|null>={})=>update({view:"board",...patch});
  return <section className={`sales-opportunities sales-register is-${view}`} aria-label="Opportunities workspace"><div className="sales-register-controls"><div className="sales-opportunity-views" role="group" aria-label="Opportunity views"><button aria-pressed={view==="list"} onClick={()=>update({view:"list",deal:null,new:null})}><LayoutList size={15}/>List</button><button aria-pressed={view==="board"} onClick={()=>board()}><Columns3 size={15}/>Board</button></div><label className="sales-search"><Search size={15}/><span className="campaigns-sr-only">Search opportunities</span><input type="search" placeholder="Search opportunities" value={search} onChange={event=>update({search:event.target.value||null})}/></label>{view==="list"&&<label>Pipeline<select value={pipeline} onChange={event=>update({pipeline:event.target.value,stage:null,deal:null})}>{view==="list"&&<option value="all">All pipelines</option>}{pipelines.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Stage<select value={stage} onChange={event=>update({stage:event.target.value})}><option value="all">All stages</option>{stages.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Created date<select value={period} onChange={event=>update({period:event.target.value})}><option value="all">All recorded dates</option><option value="30d">Last 30 days</option><option value="7d">Last 7 days</option></select></label>{view==="list"&&<button className="btn btn-p" disabled={!data.pipelineWorkspace.canManage} onClick={()=>board({new:"opportunity"})}>New Opportunity <ArrowUpRight size={15}/></button>}</div>{view==="board"?<PipelineSurface key={data.tenantId} data={data} setDetail={onDetail} dealFilter={matches} selectedPipelineId={pipeline==="all"?null:pipeline} onSelectedPipelineChange={(id:string)=>update({pipeline:id||null,...(stage!=="all"&&data.pipelineWorkspace.stages.find(item=>item.id===stage)?.pipelineId!==id?{stage:null}:{})})} focusDealId={query.get("deal")} createRequested={query.get("new")==="opportunity"} onClearFocus={()=>update({deal:null,new:null})}/>:<div className="sales-register-scroll">{rows.length?<table><caption className="campaigns-sr-only">Recorded opportunities from the canonical pipeline workspace</caption><thead><tr><th>Opportunity</th><th>Contact</th><th>Pipeline / stage</th><th>Owner</th><th>Next action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><button onClick={()=>board({deal:row.id,pipeline:row.pipelineId})}>{row.title}</button><small>{row.status}</small></td><td>{row.clientName}</td><td>{pipelines.find(item=>item.id===row.pipelineId)?.name??"Pipeline unavailable"}<small>{stages.find(item=>item.id===row.stageId)?.label??"Stage unavailable"}</small></td><td>{row.owner}</td><td>{row.nextAction}</td></tr>)}</tbody></table>:<div className="sales-empty"><h2>No matching opportunities</h2><p>{data.pipelineWorkspace.deals.length?"Change the search, date, pipeline or stage filter.":"Create your own pipeline and add a real opportunity to begin."}</p><button className="btn" onClick={()=>update({search:null,stage:null,period:null,pipeline:null})}>Clear filters</button><button className="btn" onClick={()=>board()}>Open Board</button></div>}</div>}</section>;
}
export function SalesWorkspace({ accountContext, accountEpoch, openPaige }: { accountContext?: TenantAccountContext; accountEpoch?: string | null; openPaige?: () => void }) {
  const [tab, setTab] = useSubtabRoute("solo", "sales", "overview");
  const data = useSoloCampaigns({ scope: "pipeline" });
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [detail, setDetail] = React.useState<{ tenant: string | null; account: string | undefined; tab: string; value: unknown } | null>(null);
  React.useEffect(()=>{if(tab!=="pipeline"||!params.account)return;const next=new URLSearchParams(location.search);next.set("view","board");navigate({pathname:subtabPath("solo",params.account,"sales","opportunities"),search:next.toString(),hash:location.hash},{replace:true});},[tab,params.account,location.search,location.hash,navigate]);
  const open = React.useCallback((destination: string, search?: string) => {
    if (!params.account) return;
    if(destination==="pipeline"){const next=new URLSearchParams(search);next.set("view","board");destination="opportunities";search=next.toString();}
    requestSalesNavigation(()=>navigate(`${subtabPath("solo", params.account, "sales", destination)}${search ? `?${search}` : ""}`));
  }, [navigate, params.account]);
  const onDetail = React.useCallback((value: unknown) => setDetail(value ? { tenant: data.tenantId, account: params.account, tab, value } : null), [data.tenantId, params.account, tab]);
  const visibleDetail = detail?.tenant === data.tenantId && detail?.account === params.account && detail?.tab === tab && data.phase === "ready" ? detail.value : null;
  const closeDetail = React.useCallback(() => setDetail(null), []);
  const openClients = React.useCallback((contactId?: string) => navigate(`${subtabPath("solo", params.account, "clients", "people")}?origin=sales&salesReturn=department${contactId ? `&person=${encodeURIComponent(contactId)}` : ""}`), [navigate, params.account]);
  const changeSalesView = (view: string) => open(view === "terms" ? "agreements" : view === "command" ? "overview" : "payments", ["terms", "command"].includes(view) ? undefined : `view=${view}`);
  const paymentsView = query.get("view") === "scenarios" ? "scenarios" : ["recurring", "payments", "revenue", "collections"].includes(query.get("view") ?? "") ? "collections" : "invoices";
  const operations = (view: string) => <SalesOps controlledView={view} hideNavigation onViewChange={changeSalesView} setDetail={onDetail} deals={data.pipelineWorkspace.deals} dealsPhase={data.phase} stages={data.pipelineWorkspace.stages} submissions={data.submissions} submissionsPhase={data.phase} submissionsRetry={data.retry} onOpenCatalog={(resume = false) => open("offers", resume ? "resume=terms&origin=sales" : undefined)} onOpenClients={openClients} onOpenPipeline={() => open("pipeline")}/>;
  let body: React.ReactNode;
  if (tab === "overview") body = <SalesOverview key={data.tenantId ?? "unresolved"} data={data} onOpen={open}/>;
  else if (tab === "opportunities") body = <Opportunities key={data.tenantId ?? "unresolved"} data={data} open={open} onDetail={onDetail}/>;
  else if (tab === "pipeline") body = null;
  else if (tab === "offers") body = <>{query.get("resume") === "terms" && <div className="sales-return"><button className="btn" onClick={() => open("agreements", "resume=terms")}>Return to terms editor</button></div>}<CatalogOffers setDetail={onDetail}/></>;
  else if (tab === "agreements") body = operations("terms");
  else if (tab === "payments") body = <><nav className="sales-payments-tabs" aria-label="Customer money views">{[["invoices", "Invoices"], ["collections", "Collections"]].map(([key, label]) => <button key={key} aria-pressed={paymentsView === key} onClick={() => open("payments", `view=${key}`)}>{label}</button>)}<button aria-pressed={paymentsView === "scenarios"} onClick={() => open("payments", "view=scenarios")}>Model a scenario</button></nav>{paymentsView === "collections" ? <CollectionsWorkspace key={`${data.tenantId}:${accountEpoch ?? params.account}`} tenantId={data.tenantId} initialBuilderIntent={query.get("view") === "recurring" ? "recurring" : undefined} onOpenInvoices={() => open("payments", "view=invoices")}/> : operations(paymentsView)}</>;
  else body = <SalesPerformanceWorkspace epoch={accountEpoch} onNavigate={destination => open(destination.tab, destination.query)}/>;
  return <div className="solo-campaigns sales-department" data-sales-view={tab}><h1 className="campaigns-sr-only">Sales</h1><nav className="campaigns-nav sales-tabs" role="tablist" aria-label="Sales departments">{TABS.map(([key, label, Icon], index) => <button key={key} ref={node => { refs.current[index] = node; }} id={`sales-tab-${key}`} role="tab" aria-controls="sales-department-panel" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => requestSalesNavigation(()=>setTab(key))} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length; refs.current[next]?.click(); refs.current[next]?.focus(); }}><Icon size={15}/><span>{label}</span></button>)}</nav><div id="sales-department-panel" role="tabpanel" aria-labelledby={`sales-tab-${tab}`} className="campaigns-scroll sales-department-body">{body}</div><DetailDrawer detail={visibleDetail} onClose={closeDetail}/></div>;
}
