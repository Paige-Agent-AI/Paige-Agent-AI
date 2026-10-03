import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, BarChart3, FileText, GitBranch, LayoutList, Receipt, Search, Tag } from "lucide-react";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { subtabPath } from "@/lib/routing/tierBranches";
import type { TenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { useSoloCampaigns } from "./useSoloCampaigns";
import { PipelineSurface, DetailDrawer } from "./growth2";
import { CatalogOffers } from "./catalog-offers";
import { SalesOps } from "./sales-ops";
import { Analytics2 } from "./analytics2";
import { SalesOverview } from "./sales/SalesOverview";
import { dealInSalesPeriod, type SalesPeriod } from "./sales/deriveSalesOverview";
import "./sales/sales-department.css";

const TABS = [["overview", "Overview", BarChart3], ["opportunities", "Opportunities", LayoutList], ["pipeline", "Pipeline", GitBranch], ["offers", "Offers", Tag], ["agreements", "Terms & Agreements", FileText], ["payments", "Payments", Receipt], ["performance", "Performance", BarChart3]] as const;

function Opportunities({ data, open, stage }: { data: ReturnType<typeof useSoloCampaigns>; open(tab: string, query?: string): void; stage: string | null }) {
  const [search, setSearch] = React.useState("");
  const [period, setPeriod] = React.useState<SalesPeriod>("all");
  const [stageFilter, setStageFilter] = React.useState(stage ?? "all");
  React.useEffect(() => { setSearch(""); setStageFilter(stage ?? "all"); }, [data.tenantId, stage]);
  if (data.phase !== "ready") return <div className="sales-empty" role={data.phase === "error" ? "alert" : "status"}><h2>{data.phase === "error" ? "Opportunity records could not be read" : ["loading", "resolving"].includes(data.phase) ? "Reading this workspace’s opportunities…" : "Workspace read unavailable"}</h2><p>No deal records are inferred from a failed or unresolved read.</p>{data.phase === "error" && <button className="btn" onClick={data.retry}>Retry</button>}</div>;
  const stages = data.pipelineWorkspace.stages;
  const rows = data.pipelineWorkspace.deals.filter(deal => (stageFilter === "all" || deal.stageId === stageFilter) && dealInSalesPeriod(deal.createdAt, period, Date.now()) && `${deal.title} ${deal.clientName} ${deal.owner}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="sales-register" aria-label="Canonical opportunity register"><div className="sales-register-controls"><label className="sales-search"><Search size={15}/><span className="campaigns-sr-only">Search opportunities</span><input type="search" placeholder="Search opportunities" value={search} onChange={event => setSearch(event.target.value)}/></label><label>Stage<select value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option value="all">All stages</option>{stages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Created date<select value={period} onChange={event => setPeriod(event.target.value as SalesPeriod)}><option value="all">All recorded dates</option><option value="30d">Last 30 days</option><option value="7d">Last 7 days</option></select></label><button className="btn btn-p" disabled={!data.pipelineWorkspace.canManage} onClick={() => open("pipeline", "new=opportunity")}>New Opportunity <ArrowUpRight size={15}/></button></div><div className="sales-register-scroll">{rows.length ? <table><caption className="campaigns-sr-only">Recorded opportunities from the canonical pipeline workspace</caption><thead><tr><th>Opportunity</th><th>Contact</th><th>Stage</th><th>Owner</th><th>Next action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button onClick={() => open("pipeline", `deal=${encodeURIComponent(row.id)}`)}>{row.title}</button><small>{row.status}</small></td><td>{row.clientName}</td><td>{stages.find(item => item.id === row.stageId)?.label ?? "Stage unavailable"}</td><td>{row.owner}</td><td>{row.nextAction}</td></tr>)}</tbody></table> : <div className="sales-empty"><h2>No matching opportunities</h2><p>{data.pipelineWorkspace.deals.length ? "Change the search, date or stage filter." : "Create your own pipeline and add a real opportunity to begin."}</p><button className="btn" onClick={() => { setSearch(""); setStageFilter("all"); setPeriod("all"); }}>Clear filters</button><button className="btn" onClick={() => open("pipeline")}>Open Pipeline</button></div>}</div></section>;
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
  const open = React.useCallback((destination: string, search?: string) => {
    if (!params.account) return;
    navigate(`${subtabPath("solo", params.account, "sales", destination)}${search ? `?${search}` : ""}`);
  }, [navigate, params.account]);
  const onDetail = React.useCallback((value: unknown) => setDetail(value ? { tenant: data.tenantId, account: params.account, tab, value } : null), [data.tenantId, params.account, tab]);
  const visibleDetail = detail?.tenant === data.tenantId && detail?.account === params.account && detail?.tab === tab && data.phase === "ready" ? detail.value : null;
  const closeDetail = React.useCallback(() => setDetail(null), []);
  const openClients = React.useCallback((contactId?: string) => navigate(`${subtabPath("solo", params.account, "clients", "people")}?origin=sales&salesReturn=department${contactId ? `&person=${encodeURIComponent(contactId)}` : ""}`), [navigate, params.account]);
  const changeSalesView = (view: string) => open(view === "terms" ? "agreements" : view === "command" ? "overview" : "payments", ["terms", "command"].includes(view) ? undefined : `view=${view}`);
  const paymentsView = ["invoices", "recurring", "scenarios"].includes(query.get("view") ?? "") ? query.get("view")! : ["payments", "revenue", "collections"].includes(query.get("view") ?? "") ? "revenue" : "overview";
  const operations = (view: string) => <SalesOps controlledView={view} hideNavigation onViewChange={changeSalesView} setDetail={onDetail} deals={data.pipelineWorkspace.deals} dealsPhase={data.phase} stages={data.pipelineWorkspace.stages} submissions={data.submissions} submissionsPhase={data.phase} submissionsRetry={data.retry} onOpenCatalog={(resume = false) => open("offers", resume ? "resume=terms&origin=sales" : undefined)} onOpenClients={openClients} onOpenPipeline={() => open("pipeline")}/>;
  let body: React.ReactNode;
  if (tab === "overview") body = <SalesOverview key={data.tenantId ?? "unresolved"} data={data} onOpen={open}/>;
  else if (tab === "opportunities") body = <Opportunities key={data.tenantId ?? "unresolved"} data={data} stage={query.get("stage")} open={open}/>;
  else if (tab === "pipeline") body = <PipelineSurface key={data.tenantId} data={data} setDetail={onDetail} focusDealId={query.get("deal")} createRequested={query.get("new") === "opportunity"} onClearFocus={() => open("pipeline")}/>;
  else if (tab === "offers") body = <>{query.get("resume") === "terms" && <div className="sales-return"><button className="btn" onClick={() => open("agreements", "resume=terms")}>Return to terms editor</button></div>}<CatalogOffers setDetail={onDetail}/></>;
  else if (tab === "agreements") body = operations("terms");
  else if (tab === "payments") body = <><nav className="sales-payments-tabs" aria-label="Customer money views">{[["overview", "Overview"], ["invoices", "Invoices"], ["recurring", "Recurring"], ["revenue", "Collections"]].map(([key, label]) => <button key={key} aria-pressed={paymentsView === key} onClick={() => open("payments", key === "overview" ? undefined : `view=${key}`)}>{label}</button>)}<button aria-pressed={paymentsView === "scenarios"} onClick={() => open("payments", "view=scenarios")}>Model a scenario</button></nav>{operations(paymentsView)}</>;
  else body = <Analytics2 accountContext={accountContext} accountEpoch={accountEpoch} openPaige={openPaige} controlledView="money" hideNavigation/>;
  return <div className="solo-campaigns sales-department" data-sales-view={tab}><h1 className="campaigns-sr-only">Sales</h1><nav className="campaigns-nav sales-tabs" role="tablist" aria-label="Sales departments">{TABS.map(([key, label, Icon], index) => <button key={key} ref={node => { refs.current[index] = node; }} id={`sales-tab-${key}`} role="tab" aria-controls="sales-department-panel" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length; setTab(TABS[next][0]); refs.current[next]?.focus(); }}><Icon size={15}/><span>{label}</span></button>)}</nav><div id="sales-department-panel" role="tabpanel" aria-labelledby={`sales-tab-${tab}`} className="campaigns-scroll sales-department-body">{body}</div><DetailDrawer detail={visibleDetail} onClose={closeDetail}/></div>;
}
