import { Link } from "react-router-dom";
import { viewPath } from "@/operator/shell/operatorAddress";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useSalesWorkspace, type SalesDeal, type SalesStage } from "@/operator/data/useSalesWorkspace";

/**
 * EXP00 — PAIGE Inc's company Sales department.
 *
 * The operator's own pipeline: leads → qualified → demo → proposal → won/lost,
 * with real money figures, kanban + list views, and governed stage transitions
 * through the canonical pipeline tables (tenant_id IS NULL = company scope).
 * Every figure comes from the operator_sales_workspace RPC; no invented numbers.
 */

const money = (cents: number) =>
  cents === 0 ? "—" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export function SalesDept({ view: viewName = 'pipeline' }: { view?: string } = {}) {
  const { data, error, loading, createDeal, moveDeal } = useSalesWorkspace();
  const [view, setView] = useState<"board" | "list">("board");
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<SalesDeal | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pipelines = data?.pipelines ?? [];
  const stages = useMemo(
    () => (data?.stages ?? []).filter(s => pipelineFilter === "all" || s.pipeline_id === pipelineFilter),
    [data, pipelineFilter],
  );
  const deals = useMemo(() => {
    const q = search.toLowerCase();
    let base = data?.deals ?? [];
    // View differentiation: Leads shows early-stage open deals; Activity shows recently updated
    if (viewName === 'leads') {
      const leadStages = new Set(stages.filter(s => s.stage_type === 'open' && s.order_index <= 2).map(s => s.id));
      base = base.filter(d => leadStages.has(d.stage_id) && d.status === 'open');
    } else if (viewName === 'activity') {
      base = [...base].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 20);
    }
    return base.filter(d =>
      (pipelineFilter === "all" || d.pipeline_id === pipelineFilter) &&
      (q === "" || `${d.title} ${d.source ?? ""} ${d.notes ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data, pipelineFilter, search]);

  const summary = data?.summary;
  const defaultPipeline = pipelines.find(p => p.is_default) ?? pipelines[0];

  const handleCreate = async (title: string, value: number, closeDate: string, source: string) => {
    if (!defaultPipeline || !title.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await createDeal({
        title: title.trim(),
        pipeline_id: defaultPipeline.id,
        value_cents: Math.round(value * 100),
        expected_close_date: closeDate || null,
        source: source || null,
      });
      setShowCreate(false);
    } catch (e) {
      setActionError((e as Error).message);
    } finally { setBusy(false); }
  };

  const handleMove = async (dealId: string, toStageId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await moveDeal(dealId, toStageId);
      setSelected(null);
    } catch (e) {
      setActionError((e as Error).message);
    } finally { setBusy(false); }
  };

  if (loading) {
    return <div className="min-w-0 p-6" aria-busy="true" role="status">Loading the company pipeline…</div>;
  }
  if (error) {
    return (
      <div className="min-w-0 p-6">
        <p role="alert" className="text-[var(--pg-attention,#b45309)]">
          Sales could not load or access was refused ({error}). Leave and reopen Sales to retry.
        </p>
      </div>
    );
  }
  if (!summary || pipelines.length === 0) {
    return (
      <div className="min-w-0 p-6">
        <h2 className="text-[16px] font-medium">Company Sales</h2>
        <p className="mt-2 text-[13px] text-[var(--pg-muted)]">
          No company pipeline has been created yet. The first pipeline seed runs with the next database deploy.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* Summary band */}
      <div className="border-b border-[var(--pg-line)] px-6 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold">Company Sales</h1>
            <p className="mt-0.5 text-[12px] text-[var(--pg-muted)]">
              PAIGE Agent AI Inc's own pipeline — {summary.open_deals} open ({money(summary.open_value_cents)}),
              {" "}{summary.won_deals} won ({money(summary.won_value_cents)})
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-[var(--pg-ink)] px-3 py-1.5 text-[12px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New opportunity
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 border-b border-[var(--pg-line)] px-6 py-2">
        <div className="flex rounded-md border border-[var(--pg-line)]" role="tablist">
          {(["board", "list"] as const).map(v => (
            <button key={v} role="tab" aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("px-3 py-1 text-[11px] font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === v ? "bg-[var(--pg-ink)] text-white" : "text-[var(--pg-muted)] hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
        {pipelines.length > 1 && (
          <select value={pipelineFilter} onChange={e => setPipelineFilter(e.target.value)}
            className="rounded-md border border-[var(--pg-line)] bg-transparent px-2 py-1 text-[11px] text-[var(--pg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by pipeline">
            <option value="all">All pipelines</option>
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search opportunities…"
          className="flex-1 rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1 text-[12px] placeholder:text-[var(--pg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search opportunities"
        />
      </div>

      {actionError && (
        <p role="alert" className="px-6 py-2 text-[12px] text-[var(--pg-attention,#b45309)]">{actionError}</p>
      )}

      {/* Board view */}
      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto px-6 py-4" role="region" aria-label="Pipeline board">
          {stages.filter(s => s.stage_type === "open").map(stage => (
            <StageColumn key={stage.id} stage={stage} deals={deals.filter(d => d.stage_id === stage.id && d.status === "open")}
              onSelect={setSelected} onMove={handleMove} stages={stages} busy={busy} />
          ))}
          <div className="flex gap-3">
            {(["won", "lost"] as const).map(st => {
              const stage = stages.find(s => s.stage_type === st);
              if (!stage) return null;
              return (
                <StageColumn key={stage.id} stage={stage} deals={deals.filter(d => d.stage_id === stage.id)} 
                  onSelect={setSelected} onMove={handleMove} stages={stages} busy={busy} />
              );
            })}
          </div>
        </div>
      ) : (
        /* List view */
        <div className="px-6 py-4">
          {deals.length === 0 ? (
            <p role="status" className="py-8 text-center text-[12px] text-[var(--pg-muted)]">
              {search ? "No opportunities match your search." : "No opportunities yet. Create the first one above."}
            </p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <caption className="sr-only">Company sales opportunities</caption>
              <thead>
                <tr className="border-b border-[var(--pg-line)] text-[var(--pg-muted)]">
                  <th className="py-2 pr-3">Opportunity</th>
                  <th className="pr-3">Stage</th>
                  <th className="pr-3">Value</th>
                  <th className="pr-3">Close date</th>
                  <th className="pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {deals.map(d => {
                  const stage = stages.find(s => s.id === d.stage_id);
                  return (
                    <tr key={d.id} tabIndex={0} role="button"
                      onClick={() => setSelected(d)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelected(d); }}
                      className="cursor-pointer border-b border-[var(--pg-line)] hover:bg-[var(--pg-line)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <td className="py-2.5 pr-3 font-medium">{d.title}</td>
                      <td className="pr-3">{stage?.label ?? "—"}</td>
                      <td className="pr-3 tabular-nums">{money(d.value_cents)}</td>
                      <td className="pr-3">{dateShort(d.expected_close_date)}</td>
                      <td className="pr-3">{d.status === "open" ? "" : d.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Deal detail drawer */}
      {selected && (
        <DealDetail deal={selected} stages={stages} onClose={() => setSelected(null)} onMove={handleMove} busy={busy} />
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateDealDialog defaultPipelineName={defaultPipeline?.name ?? ""} onClose={() => setShowCreate(false)} onSubmit={handleCreate} busy={busy} />
      )}
    </div>
  );
}

function StageColumn({ stage, deals, onSelect, onMove, stages, busy }: {
  stage: SalesStage;
  deals: SalesDeal[];
  onSelect: (d: SalesDeal) => void;
  onMove: (dealId: string, toStageId: string) => void;
  stages: SalesStage[];
  busy: boolean;
}) {
  const total = deals.reduce((n, d) => n + d.value_cents, 0);
  return (
    <div className="flex min-w-[220px] flex-1 flex-col rounded-lg border border-[var(--pg-line)]" data-stage={stage.label} aria-label={`${stage.label} column`}>
      <div className="flex items-center justify-between border-b border-[var(--pg-line)] px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium">
          <span className="h-2 w-2 rounded-full" style={{ background: stage.color ?? "var(--pg-muted)" }} aria-hidden="true" />
          {stage.label}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--pg-muted)]">{deals.length} · {money(total)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {deals.length === 0 ? (
          <p className="py-4 text-center text-[10px] text-[var(--pg-muted)]">No opportunities</p>
        ) : deals.map(d => (
          <button key={d.id} onClick={() => onSelect(d)}
            className="rounded-md border border-[var(--pg-line)] bg-card p-2 text-left text-[11px] transition-colors hover:border-[var(--pg-ink)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${d.title}, ${money(d.value_cents)}`}>
            <span className="block font-medium">{d.title}</span>
            <span className="mt-0.5 block tabular-nums text-[var(--pg-muted)]">{money(d.value_cents)}</span>
            {d.expected_close_date && <span className="text-[10px] text-[var(--pg-muted)]">→ {dateShort(d.expected_close_date)}</span>}
          </button>
        ))}
      </div>
      {busy && deals.length > 0 && <div className="px-3 pb-2 text-[10px] text-[var(--pg-muted)]">Moving…</div>}
      {deals.length > 0 && (
        <p className="px-3 pb-2 text-[9px] text-[var(--pg-muted)]">Click a card to move it</p>
      )}
    </div>
  );
}

function DealDetail({ deal, stages, onClose, onMove, busy }: {
  deal: SalesDeal;
  stages: SalesStage[];
  onClose: () => void;
  onMove: (dealId: string, toStageId: string) => void;
  busy: boolean;
}) {
  const stage = stages.find(s => s.id === deal.stage_id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label={deal.title}>
      <div className="w-full max-w-md rounded-lg border border-[var(--pg-line)] bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-semibold">{deal.title}</h2>
            <p className="mt-0.5 text-[11px] text-[var(--pg-muted)]">
              {stage?.label} · {money(deal.value_cents)} · {deal.status}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--pg-muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close detail">✕</button>
        </div>
        {deal.source && <p className="mt-3 text-[11px] text-[var(--pg-muted)]">Source: {deal.source}</p>}
        {deal.notes && <p className="mt-1 text-[11px] text-[var(--pg-muted)]">{deal.notes}</p>}
        {deal.expected_close_date && <p className="mt-1 text-[11px] text-[var(--pg-muted)]">Expected close: {dateShort(deal.expected_close_date)}</p>}
        {deal.lost_reason && <p className="mt-1 text-[11px] text-[var(--pg-attention,#b45309)]">Lost: {deal.lost_reason}</p>}
        <div className="mt-3">
          <Link to={viewPath("relationships", "Customers")} className="text-[11px] text-[var(--pg-muted)] underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View customer lifecycle in Customers →
          </Link>
        </div>
        <div className="mt-4">
          <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--pg-muted)]">Move to stage</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {stages.filter(s => s.id !== deal.stage_id).map(s => (
              <button key={s.id} disabled={busy}
                onClick={() => onMove(deal.id, s.id)}
                className={cn("rounded-md border px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  s.stage_type === "won" ? "border-green-600/30 text-green-700" :
                  s.stage_type === "lost" ? "border-red-600/30 text-red-700" : "border-[var(--pg-line)] text-foreground")}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {busy && <p className="mt-3 text-[11px] text-[var(--pg-muted)]" role="status">Saving…</p>}
      </div>
    </div>
  );
}

function CreateDealDialog({ defaultPipelineName, onClose, onSubmit, busy }: {
  defaultPipelineName: string;
  onClose: () => void;
  onSubmit: (title: string, value: number, closeDate: string, source: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [source, setSource] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label="New opportunity">
      <div className="w-full max-w-sm rounded-lg border border-[var(--pg-line)] bg-card p-5 shadow-lg">
        <h2 className="text-[16px] font-semibold">New opportunity</h2>
        <p className="mt-0.5 text-[11px] text-[var(--pg-muted)]">Pipeline: {defaultPipelineName}</p>
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="deal-title" className="text-[10px] font-medium uppercase tracking-wider text-[var(--pg-muted)]">Title</label>
            <input id="deal-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus
              className="mt-1 w-full rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. Acme Consulting — Solo Beta" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="deal-value" className="text-[10px] font-medium uppercase tracking-wider text-[var(--pg-muted)]">Value ($)</label>
              <input id="deal-value" type="number" min="0" value={value} onChange={e => setValue(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1.5 text-[12px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="149" />
            </div>
            <div>
              <label htmlFor="deal-close" className="text-[10px] font-medium uppercase tracking-wider text-[var(--pg-muted)]">Close date</label>
              <input id="deal-close" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
          </div>
          <div>
            <label htmlFor="deal-source" className="text-[10px] font-medium uppercase tracking-wider text-[var(--pg-muted)]">Source</label>
            <input id="deal-source" value={source} onChange={e => setSource(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--pg-line)] bg-transparent px-3 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="e.g. referral, demo request, inbound" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] text-[var(--pg-muted)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cancel</button>
          <button onClick={() => onSubmit(title, Number(value) || 0, closeDate, source)} disabled={!title.trim() || busy}
            className="rounded-md bg-[var(--pg-ink)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SalesDept;
