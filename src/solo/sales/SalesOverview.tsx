import React from "react";
import { ArrowUpRight, FileText, GitBranch, PenLine, Receipt, Search } from "lucide-react";
import { useSoloCommercialTerms } from "../useSoloCommercialTerms";
import { useSoloAgreementSignings } from "../useSoloAgreementSignings";
import { useSalesInvoiceDrafts } from "../useSalesInvoiceDrafts";
import type { useSoloCampaigns } from "../useSoloCampaigns";
import { deriveSalesOverview, type SalesPeriod, type SalesOverviewRow } from "./deriveSalesOverview";

type Props = { data: ReturnType<typeof useSoloCampaigns>; onOpen(tab: string, query?: string): void };
const SOURCES = { deals: "Pipeline deals", terms: "Engagement terms", signings: "Signature documents", invoices: "Saved invoice drafts" };
const ICONS = { deals: GitBranch, terms: FileText, signings: PenLine, invoices: Receipt };

export function SalesOverview({ data, onOpen }: Props) {
  const terms = useSoloCommercialTerms();
  const signings = useSoloAgreementSignings();
  const invoices = useSalesInvoiceDrafts();
  const [period, setPeriod] = React.useState<SalesPeriod>("all");
  const [group, setGroup] = React.useState("attention");
  const [search, setSearch] = React.useState("");
  const [selection, setSelection] = React.useState<{ tenant: string | null; id: string } | null>(null);
  const current = deriveSalesOverview({
    tenantId: data.tenantId,
    deals: { tenantId: data.tenantId, phase: data.phase, rows: data.pipelineWorkspace.deals },
    terms: { tenantId: terms.tenantId, phase: terms.phase, readable: terms.agreementsReadable, rows: terms.agreements },
    signings: { tenantId: signings.tenantId, phase: signings.phase, readable: signings.readable, rows: signings.signings },
    invoices: { tenantId: invoices.tenantId, phase: invoices.phase, rows: invoices.rows },
    stages: data.pipelineWorkspace.stages.filter(stage => !stage.archivedAt),
    clients: terms.tenantId === data.tenantId && terms.phase === "ready" ? terms.clients : [], period, now: Date.now(),
  });
  const visible = current.rows.filter(row => row.group === group && `${row.title} ${row.person} ${row.state}`.toLowerCase().includes(search.toLowerCase()));
  const selected = selection?.tenant === data.tenantId ? visible.find(row => row.id === selection.id) ?? null : null;
  React.useEffect(() => { setSelection(null); setSearch(""); setGroup("attention"); }, [data.tenantId]);
  const open = (row: SalesOverviewRow) => onOpen(row.target, row.source === "deals" ? `deal=${encodeURIComponent(row.recordId)}` : row.source === "invoices" ? "view=invoices" : undefined);
  const sources = [{ key: "deals" as const, phase: data.phase, retry: data.retry }, { key: "terms" as const, phase: terms.phase, retry: terms.retry }, { key: "signings" as const, phase: signings.phase, retry: signings.retry }, { key: "invoices" as const, phase: invoices.phase, retry: invoices.retry }];
  return <div className="sales-overview">
    <div className="sales-operating-controls">
      <label>Opportunity created date<select value={period} onChange={event => { setPeriod(event.target.value as SalesPeriod); setSelection(null); }}><option value="all">All recorded dates</option><option value="30d">Last 30 days</option><option value="7d">Last 7 days</option></select></label>
      <button className="btn btn-p" disabled={data.phase !== "ready" || !data.pipelineWorkspace.canManage} onClick={() => onOpen("pipeline", "new=opportunity")}>New Opportunity <ArrowUpRight size={15} /></button>
    </div>
    <div className="sales-source-summary" aria-label="Independent recorded source counts">
      {sources.map(({ key, phase, retry }) => { const Icon = ICONS[key]; return <div key={key}><Icon size={17} /><span>{SOURCES[key]}<small>{key === "deals" ? "Created-date preference" : key === "invoices" ? invoices.hasMore ? "Loaded draft page · more available" : "Saved draft snapshot" : "Independent source snapshot"}</small></span><strong>{current.counts[key] ?? "—"}</strong>{current.counts[key] === null && <span className="sales-source-state">{["loading", "resolving"].includes(phase) ? "Reading…" : phase === "error" ? <button onClick={retry}>Retry read</button> : "Read unavailable"}</span>}</div>; })}
    </div>
    <section className="sales-stage-strip" aria-label="Recorded open deals by current stage"><div className="sales-section-line"><h2>Recorded stages</h2><span>Independent pipeline records · no deal value inferred</span></div><div>{current.stages.length ? current.stages.map(stage => <button key={stage.id} onClick={() => onOpen("opportunities", `stage=${encodeURIComponent(stage.id)}`)}><span className="sales-stage-track" aria-hidden="true"><span style={{ width: `${stage.count / Math.max(1, ...current.stages.map(item => item.count)) * 100}%` }} /></span><span>{stage.label}</span><strong>{stage.count}</strong></button>) : <p>{data.phase === "ready" ? "No recorded stages yet. Create your own pipeline to begin." : "Stage records are not available yet."}</p>}</div></section>
    <div className="sales-operating-grid">
      <section className="sales-work-queue" aria-label="Commercial work queue">
        <div className="sales-queue-controls"><div role="group" aria-label="Operating groups">{[["attention", "Needs attention"], ["motion", "In motion"], ["resolved", "Resolved"]].map(([key, label]) => <button key={key} aria-pressed={group === key} onClick={() => { setGroup(key); setSelection(null); }}>{label}<span>{current.rows.filter(row => row.group === key).length}</span></button>)}</div><label className="sales-search"><Search size={15}/><span className="campaigns-sr-only">Search recorded work</span><input type="search" placeholder="Search recorded work" value={search} onChange={event => { setSearch(event.target.value); setSelection(null); }}/></label></div>
        <div className="sales-queue-rows">{visible.length ? visible.map(row => { const Icon = ICONS[row.source]; return <button key={row.id} className="sales-work-row" aria-pressed={selected?.id === row.id} onClick={() => setSelection({ tenant: data.tenantId, id: row.id })}><Icon size={17}/><span><strong>{row.title}</strong><small>{row.person} · {SOURCES[row.source]}</small></span><span className="sales-row-state">{row.state}</span><ArrowUpRight size={15}/></button>; }) : <div className="sales-empty"><h2>{search ? "No matching recorded work" : "No readable work in this group"}</h2><p>{sources.some(source => current.counts[source.key] === null) ? "Some source reads remain unavailable; this is not a complete empty-work verdict." : "Choose another operating group or start with an opportunity."}</p>{search ? <button className="btn" onClick={() => { setSearch(""); setSelection(null); }}>Clear search</button> : <button className="btn" onClick={() => onOpen("opportunities")}>Open Opportunities</button>}</div>}</div>
      </section>
      <section className="sales-record-context" aria-label="Selected source record"><div className="sales-section-line"><h2>{selected ? selected.title : "Record context"}</h2></div><div className="sales-context-body">{selected ? <><dl><dt>Source</dt><dd>{SOURCES[selected.source]}</dd><dt>Recorded state</dt><dd>{selected.state}</dd><dt>Context</dt><dd>{selected.person}</dd><dt>Next step</dt><dd>{selected.next}</dd></dl><p>These facts belong to this source record. No linked deal, agreement, invoice or payment is inferred.</p><button className="btn btn-p" onClick={() => open(selected)}>Open {selected.target === "pipeline" ? "Pipeline record" : selected.target === "agreements" ? "Terms & Agreements" : "Payments draft"}<ArrowUpRight size={15}/></button></> : <p>Select recorded work to inspect its source and continue in its owning destination.</p>}</div></section>
    </div>
  </div>;
}
