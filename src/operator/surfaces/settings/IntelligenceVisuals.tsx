import { ArrowRight, Database, FileCheck2, FlaskConical, ShieldCheck, Rocket, ScanSearch, Users, BriefcaseBusiness } from "lucide-react";
import { displayNumber, displayPercent, type Breakdown, type EvalRun, type IntelligenceTrace } from "@/operator/data/intelligenceContract";

const TONES = ["model", "evaluation", "strategy", "performance", "investigation"];
const validCount = (n: number) => Number.isFinite(n) && n >= 0;
function statusTone(status?: string) {
  if (status === "error" || status === "failed") return "failure";
  if (status === "needs_config" || status === "degraded") return "warning";
  if (status === "ok" || status === "success" || status === "complete" || status === "completed") return "evaluation";
  return "model";
}

/** Categories from one returned source; never a task success or conversion funnel. */
export function DistributionChart({ title, rows, unit = "calls" }: { title: string; rows: Breakdown[]; unit?: string }) {
  const available = rows.filter((row) => validCount(row.count));
  const maximum = Math.max(0, ...available.map((row) => row.count));
  return <figure className="intel-chart"><figcaption>{title}</figcaption>
    {available.length ? <ul className="intel-bars">{available.map((row, i) => {
      const label = row.provider ?? row.tier ?? row.status ?? row.modality ?? "Unknown";
      return <li key={`${label}:${i}`}><div><span>{label}</span><strong>{displayNumber(row.count)} <small>{unit}</small></strong></div>
        <div className="intel-bar-track" aria-hidden="true"><span data-tone={row.status ? statusTone(row.status) : TONES[i % TONES.length]} style={{ width: `${maximum ? row.count / maximum * 100 : 0}%` }} /></div>
      </li>;
    })}</ul> : <p className="intel-source">No measured distribution returned.</p>}
    <p className="intel-source">Relative counts within this source. No outcome or quality ranking.</p>
  </figure>;
}

export function StatusComposition({ rows }: { rows: Breakdown[] }) {
  const available = rows.filter((row) => validCount(row.count));
  const total = available.reduce((sum, row) => sum + row.count, 0);
  return <figure className="intel-chart"><figcaption>Recorded call statuses</figcaption>
    {available.length ? <>
      <div className="intel-composition" aria-hidden="true">{available.map((row, i) => <span key={i} data-tone={statusTone(row.status)} style={{ width: `${total ? row.count / total * 100 : 0}%` }} />)}</div>
      <ul className="intel-chart-legend">{available.map((row, i) => <li key={i}><span className="intel-swatch" data-tone={statusTone(row.status)} aria-hidden="true" /><span>{row.status ?? "Unknown"}</span><strong>{displayNumber(row.count)}</strong><small>{total ? displayPercent(row.count / total) : "No share"}</small></li>)}</ul>
      <p className="intel-source">{displayNumber(total)} calls in returned status groups. Call status does not establish task completion.</p>
    </> : <p className="intel-source">Status distribution is unavailable. No success rate inferred.</p>}
  </figure>;
}

/** Actual timestamp/latency points only; no interpolation, synthetic trend, or forecast. */
export function LatencyPlot({ traces }: { traces: IntelligenceTrace[] }) {
  const points = traces.filter((row) => row.latency_ms !== null && Number.isFinite(row.latency_ms) && row.latency_ms >= 0 && Number.isFinite(Date.parse(row.created_at)))
    .map((row) => ({ id: row.id, at: Date.parse(row.created_at), latency: row.latency_ms!, status: row.status ?? undefined })).sort((a, b) => a.at - b.at);
  const start = points[0]?.at ?? 0;
  const end = points.at(-1)?.at ?? 0;
  const maximum = Math.max(1, ...points.map((point) => point.latency));
  return <figure className="intel-chart intel-latency"><figcaption>Call latency in the evidence sample</figcaption>
    {points.length ? <>
      <svg viewBox="0 0 640 180" role="img" aria-label={`${points.length} measured calls, latency range ${displayNumber(Math.min(...points.map((p) => p.latency)))} to ${displayNumber(Math.max(...points.map((p) => p.latency)))} milliseconds. Exact values are in the call inspections.`}>
        {[0, .5, 1].map((part) => <g key={part}><line x1="58" x2="624" y1={148 - part * 120} y2={148 - part * 120} className="intel-plot-grid" /><text x="48" y={152 - part * 120} textAnchor="end">{displayNumber(part * maximum)}</text></g>)}
        {points.map((point) => <circle key={point.id} cx={end === start ? 340 : 58 + (point.at - start) / (end - start) * 566} cy={148 - point.latency / maximum * 120} r="5" data-tone={statusTone(point.status)}><title>{point.id}: {displayNumber(point.latency)} ms · {new Date(point.at).toLocaleString()}</title></circle>)}
        <text x="58" y="172">{new Date(start).toLocaleTimeString()}</text><text x="624" y="172" textAnchor="end">{new Date(end).toLocaleTimeString()}</text><text x="58" y="15">Latency · ms</text>
      </svg>
      <p className="intel-source">{points.length} calls with measured latency, from {traces.length} returned records. Each point is one call; gaps and nulls remain unmeasured.</p>
    </> : <p className="intel-source">No timestamped latency measurements returned.</p>}
  </figure>;
}

export function EvaluationChart({ runs, onInspect }: { runs: EvalRun[]; onInspect: (run: EvalRun, opener: HTMLButtonElement) => void }) {
  return <figure className="intel-chart"><figcaption>Recorded evaluation pass rates</figcaption>
    {runs.length ? <ul className="intel-eval-bars">{runs.slice(0, 10).map((run) => {
      const measured = run.pass_rate !== null && Number.isFinite(run.pass_rate) && run.pass_rate >= 0 && run.pass_rate <= 1;
      return <li key={run.id}><button type="button" onClick={(e) => onInspect(run, e.currentTarget)} aria-label={`Inspect plotted evaluation ${run.id}`}>
        <span>{run.target_version ?? "Version not recorded"}<small>{run.target_kind ?? "Target not recorded"} · {run.scored_count} / {run.case_count} scored</small></span>
        <strong>{measured ? displayPercent(run.pass_rate) : "Unscored"}</strong>
        <span className="intel-bar-track" aria-hidden="true"><span data-tone="evaluation" style={{ width: `${measured ? run.pass_rate! * 100 : 0}%` }} /></span>
      </button></li>;
    })}</ul> : <p className="intel-source">No evaluation measurements returned.</p>}
    <p className="intel-source">Latest 10 returned runs, each on its own cases. Different datasets and scorers do not establish comparable model quality. Select a run to inspect its evidence.</p>
  </figure>;
}

const PATHS = {
  improvement: [
    { title: "Evidence", detail: "Recorded calls & evaluations", status: "Read contracts exist", icon: Database, tone: "investigation" },
    { title: "Recommendation", detail: "Prepare & download", status: "Session draft only", icon: FileCheck2, tone: "evaluation" },
    { title: "Human review", detail: "Authority & approvals", status: "Submission unavailable", icon: ShieldCheck, tone: "performance" },
    { title: "Experiment", detail: "Bounded replay & validation", status: "Unavailable", icon: FlaskConical, tone: "model" },
    { title: "Release", detail: "Canary, readback & rollback", status: "Unavailable", icon: Rocket, tone: "strategy" },
  ],
  opportunity: [
    { title: "Source evidence", detail: "Citations, dates & assumptions", status: "Operator supplied", icon: ScanSearch, tone: "investigation" },
    { title: "Intelligence", detail: "Synthesize an opportunity", status: "Session dossier only", icon: FileCheck2, tone: "strategy" },
    { title: "Marketing", detail: "Validate market demand", status: "Handoff unavailable", icon: Users, tone: "strategy" },
    { title: "Operations", detail: "Feasibility & delivery", status: "Handoff unavailable", icon: BriefcaseBusiness, tone: "evaluation" },
    { title: "Owner decision", detail: "Approve the next action", status: "Submission unavailable", icon: ShieldCheck, tone: "performance" },
  ],
  model: [
    { title: "Provenance", detail: "Model, license & runtime", status: "Unavailable", icon: Database, tone: "model" },
    { title: "Data permission", detail: "Consent & permitted use", status: "Unavailable", icon: ShieldCheck, tone: "performance" },
    { title: "Benchmark", detail: "Common cases & scorers", status: "Existing eval substrate", icon: FlaskConical, tone: "evaluation" },
    { title: "Candidate review", detail: "Quality, safety & economics", status: "Unavailable", icon: FileCheck2, tone: "investigation" },
    { title: "Promotion", detail: "Authority & rollback evidence", status: "Unavailable", icon: Rocket, tone: "strategy" },
  ],
} as const;

/** A capability/ownership map, not a job progress tracker or an execution control. */
export function GovernedPath({ kind }: { kind: keyof typeof PATHS }) {
  return <figure className="intel-pipeline"><figcaption>{kind === "opportunity" ? "Opportunity to accountable action" : kind === "model" ? "Model admission requirements" : "The governed improvement loop"}</figcaption>
    <ol>{PATHS[kind].map(({ title, detail, status, icon: Icon, tone }, i) => <li key={title} data-tone={tone}>
      <div className="intel-pipe-node"><Icon size={20} aria-hidden="true" /></div><strong>{title}</strong><p>{detail}</p><small>{status}</small>
      {i < PATHS[kind].length - 1 && <ArrowRight className="intel-pipe-arrow" size={16} aria-hidden="true" />}
    </li>)}</ol><p className="intel-source">Capability path only. No job is running; a draft grants no execution or release authority.</p>
  </figure>;
}
