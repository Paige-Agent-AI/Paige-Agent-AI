import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { MetricResult } from "@/lib/analytics/metric-contract";
import { analyticsRangeKey, SETTINGS_ANALYTICS_VIEWS, settingsAnalyticsView } from "./analytics-routing";
import { SETTINGS_METRICS, useSettingsAnalytics, type MetricRead, type SettingsMetricKey } from "./data/useSettingsAnalytics";
import "./settings-analytics.css";

const sections = [
  { key: "business-health", label: "Business Health", summary: "Client lifecycle and recorded onboarding", primary: "business.lifecycle_current", metrics: ["business.active_clients_current", "business.lifecycle_current", "business.onboarding_current", "business.retention", "business.profitability", "business.nps"] },
  { key: "operations", label: "Operations", summary: "Systems Check, workflow configuration and recorded executions", primary: "operations.systems_check_latest", metrics: ["operations.systems_check_latest", "operations.unresolved_findings_current", "operations.workflows_active_current", "operations.recorded_workflow_runs", "operations.recorded_workflow_activity", "operations.current_system_exceptions"] },
  { key: "team", label: "Team", summary: "Active seats, team roles and measurement coverage", primary: "team.role_distribution_current", metrics: ["team.active_members_current", "team.role_distribution_current", "team.performance_scorecards"] },
  { key: "ai-usage", label: "AI & Usage", summary: "Recorded resource consumption, with telemetry limits visible", primary: "ai.recorded_model_requests_daily", metrics: ["ai.recorded_model_requests_daily", "ai.recorded_model_requests", "ai.recorded_tokens", "ai.estimated_model_cost", "ai.recorded_latency", "ai.recorded_browser_calls", "ai.voice_consumption"] },
] as const;
const friendly = (key: string) => key.replace(/^client_/, "").replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
const evidenceTime = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: "UTC", timeZoneName: "short" });
function Truth({ read }: { read?: MetricRead }) {
  const truth = read?.result?.truth_state;
  return <span className={`sa-truth sa-truth--${truth?.toLowerCase() ?? "unavailable"}`}>{truth ?? "READ FAILED"}</span>;
}
function MetricValue({ result }: { result: MetricResult }) {
  const v = result.values;
  if (!v) return <span className="sa-missing">Not measurable yet</span>;
  if (v.kind === "count") return <strong>{v.count.toLocaleString()}</strong>;
  if (v.kind === "decimal") return <strong>{result.unit === "estimated_usd" ? "$" : ""}{Number(v.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}{result.unit === "milliseconds" ? " ms" : ""}</strong>;
  return <span>{v.kind === "distribution" ? "Recorded distribution" : "Recorded history"}</span>;
}
function MetricVisual({ result }: { result: MetricResult }) {
  if (!result.values) return <p className="sa-missing">{result.caveats.at(-1) ?? "No canonical measurement is available."}</p>;
  if (result.values.kind === "distribution") {
    const items = result.values.items;
    const maximum = Math.max(1, ...items.map(i => i.count));
    return <div className="sa-bars" role="img" aria-label={items.map(i => `${friendly(i.label)}: ${i.count}`).join(", ") || "No recorded items"}>
      {items.length ? items.map(i => <div key={i.key}><span>{friendly(i.label)}</span><div className={`sa-bar sa-bar--${i.key}`}><i style={{ width: `${100 * i.count / maximum}%` }}/></div><b>{i.count.toLocaleString()}</b></div>) : <p>No matching records in this measurement.</p>}
    </div>;
  }
  if (result.values.kind === "series") {
    return <RecordedSeries points={result.values.points}/>;
  }
  if (result.values.kind === "diagnostic_events") {
    return result.values.items.length ? <ol className="sa-event-ledger" aria-label={result.label}>{result.values.items.map((event, index) => <li key={`${event.at}-${index}`}>
      <div><strong>{event.check_key ? friendly(event.check_key) : "Workflow run"}</strong><span>{friendly(event.status)}{event.severity ? ` · ${friendly(event.severity)}` : ""}</span></div>
      <time dateTime={event.at}>{evidenceTime(event.at)}</time>
      <p>{event.completed_at ? `Completed ${evidenceTime(event.completed_at)}` : "Completion not recorded"}{event.retry_count !== null ? ` · ${event.retry_count.toLocaleString()} recorded retries` : ""}</p>
    </li>)}</ol> : <p className="sa-missing">No matching activity or exceptions are recorded in this measurement. This does not imply complete monitoring; inspect the coverage.</p>;
  }
  return <div className="sa-value"><MetricValue result={result}/><span>{result.unit === "estimated_usd" ? "Estimated, not billed spend" : result.unit === "count" ? "Recorded count" : friendly(result.unit)}</span></div>;
}
function RecordedSeries({ points }: { points: Array<{ at: string; value: number | null }> }) {
  const [selected, setSelected] = useState(points.at(-1)?.at);
  const point = points.find(p => p.at === selected) ?? points.at(-1);
  const maximum = Math.max(1, ...points.map(p => p.value ?? 0));
  const date = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (!points.length) return <p className="sa-missing">No recorded daily measurement is available.</p>;
  return <figure className="sa-series-figure"><div className="sa-series-scale"><span>{maximum.toLocaleString()} recorded requests</span><span>UTC days</span></div>
    <div className="sa-series" aria-label="Recorded requests by UTC day">
      {points.map(p => <button key={p.at} type="button" style={{ height: `${p.value === null ? 87 : Math.max(3, 87 * p.value / maximum)}px` }} title={`${date(p.at)}: ${p.value === null ? "Unknown" : p.value.toLocaleString()}`} aria-label={`${date(p.at)} UTC: ${p.value ?? "Unknown"} recorded requests`} aria-pressed={point?.at === p.at} className={p.value === null ? "sa-series-unknown" : ""} onClick={() => setSelected(p.at)}/>)}
    </div><div className="sa-series-axis"><span>{date(points[0].at)}</span><span>{date(points.at(-1)!.at)}</span></div>
    <figcaption aria-live="polite">{point && <>{date(point.at)} UTC · <b>{point.value === null ? "Quantity unknown" : `${point.value.toLocaleString()} recorded requests`}</b></>}</figcaption></figure>;
}
function OverviewVisual({ category, result }: { category: string; result: MetricResult }) {
  const values = result.values;
  if (values?.kind !== "distribution") return <MetricVisual result={result}/>;
  const total = values.items.reduce((sum, i) => sum + i.count, 0);
  const legend = <div className="sa-glance-legend">{values.items.map(i => <span key={i.key}>{friendly(i.label)} <b>{i.count.toLocaleString()}</b></span>)}</div>;
  if (category === "operations") return <div><div className="sa-check-cells" role="img" aria-label={values.items.map(i => `${friendly(i.label)}: ${i.count}`).join(", ")}>{values.items.flatMap(i => Array.from({ length: Math.min(i.count, 40) }, (_, n) => <i className={`sa-check--${i.key}`} key={`${i.key}-${n}`}/>))}</div>{legend}<p className="sa-caption">Latest completed sweep. Up to 40 recorded findings shown per status.</p></div>;
  if (category === "team") return <div><div className="sa-seat-cells" role="img" aria-label={values.items.map(i => `${friendly(i.label)}: ${i.count}`).join(", ")}>{values.items.flatMap((i, color) => Array.from({ length: Math.min(i.count, 20) }, (_, n) => <i style={{ opacity: 1 - color * .18 }} key={`${i.key}-${n}`}/>))}</div>{legend}<p className="sa-caption">Active membership seats; up to 20 shown per role.</p></div>;
  return <div><div className="sa-lifecycle-band" role="img" aria-label={values.items.map(i => `${friendly(i.label)}: ${i.count}`).join(", ")}>{values.items.filter(i => i.count > 0).map(i => <i key={i.key} className={`sa-band--${i.key}`} style={{ flex: i.count }}/>)}{total === 0 && <span>No recorded clients</span>}</div>{legend}<p className="sa-caption">Current client lifecycle; no historical trend is implied.</p></div>;
}
function Evidence({ result }: { result: MetricResult }) {
  const { resolvedTheme } = useTheme();
  return <Sheet><SheetTrigger asChild><button className="sa-evidence-trigger">Why this measurement?</button></SheetTrigger><SheetContent className="sa-evidence sa-evidence-drawer" data-pg={resolvedTheme === "dark" ? "dark" : "light"}><SheetTitle>{result.label}</SheetTitle><SheetDescription>Measurement evidence and coverage</SheetDescription><span className={`sa-truth sa-truth--${result.truth_state.toLowerCase()}`}>{result.truth_state}</span><dl>
    <div><dt>Definition</dt><dd>{result.definition}</dd></div>
    <div><dt>Date range</dt><dd>{evidenceTime(result.range.start)} – {evidenceTime(result.range.end)}</dd></div>
    <div><dt>Reading as of</dt><dd>{evidenceTime(result.as_of)}</dd></div>
    <div><dt>Source current through</dt><dd>{result.freshness.source_updated_through ? evidenceTime(result.freshness.source_updated_through) : "Not recorded"}</dd></div>
    <div><dt>Coverage</dt><dd>{result.coverage.contributing_count.toLocaleString()} contributing; {result.coverage.excluded_count.toLocaleString()} excluded of {result.coverage.candidate_count.toLocaleString()} candidate records</dd></div>
    <div><dt>Source systems</dt><dd>{result.source_refs.map(s => friendly(s.replace(/^public\./, ""))).join(", ") || "No supported producer"}</dd></div>
    <div><dt>Calculation</dt><dd>{result.formula}</dd></div>
    <div><dt>Version</dt><dd>{result.metric_version}</dd></div>
  </dl><ul>{result.caveats.map(c => <li key={c}>{c}</li>)}</ul><p className="sa-reference">Evidence identity: {result.evidence_ref}</p></SheetContent></Sheet>;
}
function Reading({ read, label, metricKey }: { read?: MetricRead; label?: string; metricKey: string }) {
  const result = read?.result;
  return <article className="sa-reading" tabIndex={-1} id={`metric-${metricKey.replace(/\./g, "-")}`}><header><h3>{result?.label ?? label ?? "Measurement unavailable"}</h3><Truth read={read}/></header>
    {result ? <><MetricVisual result={result}/><p className="sa-caption">{result.range.semantics === "current_snapshot" ? "Current snapshot; no historical trend is implied." : "Requested UTC interval."}{result.truth_state === "PARTIAL" ? " Coverage is incomplete." : ""}</p><Evidence result={result}/></> : <p className="sa-missing">This workspace measurement could not be verified. Refresh to retry. No value has been substituted.</p>}
  </article>;
}
export function SoloSettingsAnalytics() {
  const location = useLocation();
  const navigate = useNavigate();
  const { account = "", "*": splat = "" } = useParams();
  const view = settingsAnalyticsView(splat);
  const range = analyticsRangeKey(location.search);
  const { reads, loading, permissionDenied, refresh, scope } = useSettingsAnalytics(range);
  const heading = useRef<HTMLHeadingElement>(null);
  const [previousView, setPreviousView] = useState(view);
  const base = `/solo/${encodeURIComponent(account)}/settings/analytics`;
  useEffect(() => {
    if (splat !== `settings/analytics/${view}`) navigate(`${base}/${view}?range=${range}`, { replace: true });
  }, [splat, view, base, range, navigate]);
  useEffect(() => {
    if (previousView !== view) { heading.current?.focus({ preventScroll: true }); setPreviousView(view); }
  }, [view, previousView]);
  useEffect(() => {
    if (loading || view !== "data-health" || !location.hash.startsWith("#metric-")) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [loading, view, location.hash]);
  const current = sections.find(s => s.key === view);
  const problems = SETTINGS_METRICS.filter(k => reads[k]?.error || reads[k]?.result?.truth_state !== "LIVE");
  return <section className="sa-workspace" key={scope} aria-labelledby="sa-title" aria-busy={loading}>
    <header className="sa-header"><p>Your operating health, resource use and confidence in the numbers.</p><div className="sa-actions"><label>Range<select value={range} onChange={e => navigate(`${base}/${view}?range=${e.target.value}`)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="quarter">Last 90 days</option></select></label><button onClick={refresh} disabled={loading} aria-label="Refresh measurements"><RefreshCw size={16}/>Refresh</button></div></header>
    <nav className="sa-nav" aria-label="Analytics views">{SETTINGS_ANALYTICS_VIEWS.map(v => <Link key={v.key} to={`${base}/${v.key}?range=${range}`} aria-current={v.key === view ? "page" : undefined}>{v.label}</Link>)}</nav>
    <h2 id="sa-title" ref={heading} tabIndex={-1}>{SETTINGS_ANALYTICS_VIEWS.find(v => v.key === view)?.label}</h2>
    {permissionDenied ? <div className="sa-missing" role="status"><h3>Analytics access is not permitted</h3><p>These workspace measurements require an active owner or admin membership. Ask your workspace owner to review your access. Refresh after your permissions change.</p></div> : loading ? <div className="sa-loading" role="status"><span className="sr-only">Loading measurements for the active workspace</span>{[0, 1, 2, 3, 4].map(n => <div key={n}><i/><b/></div>)}</div> : view === "overview" ? <>
      <div className="sa-glance">{sections.map(s => <article className="sa-glance-row" key={s.key}><div><h3>{s.label}</h3><Truth read={reads[s.primary]}/><p>{s.summary}</p></div><div>{reads[s.primary]?.result ? <OverviewVisual category={s.key} result={reads[s.primary]!.result!}/> : <p className="sa-missing">Measurement read failed</p>}</div><Link to={`${base}/${s.key}?range=${range}`}>Inspect<ArrowUpRight size={14}/></Link></article>)}
      <article className="sa-glance-row"><div><h3>Data Health</h3><p>Coverage and source trust</p></div><div className="sa-coverage-cells">{SETTINGS_METRICS.map(k => <Link key={k} to={`${base}/data-health?range=${range}#metric-${k.replace(/\./g, "-")}`} className={`sa-cell--${reads[k]?.result?.truth_state.toLowerCase() ?? "failed"}`}><span>{reads[k]?.result?.label ?? friendly(k.split(".")[1])}</span><b>{reads[k]?.result?.truth_state ?? "Read failed"}</b></Link>)}</div><Link to={`${base}/data-health?range=${range}`}>Inspect<ArrowUpRight size={14}/></Link></article></div>
      <section className="sa-attention"><h3>Measurement needs attention</h3><p>{problems.length.toLocaleString()} measurements are incomplete, unavailable or could not be read. Inspect their evidence before relying on them.</p><Link to={`${base}/data-health?range=${range}`}>Review coverage</Link></section>
    </> : view === "data-health" ? <div className="sa-health-ledger">{SETTINGS_METRICS.map(k => <Reading key={k} metricKey={k} read={reads[k]} label={friendly(k.split(".")[1])}/>)}</div> : <><p className="sa-intro">{current?.summary}. Inspect the evidence to understand coverage and exclusions.</p><div className="sa-detail-ledger">{current?.metrics.map(k => <Reading key={k} metricKey={k} read={reads[k]} label={friendly(k.split(".")[1])}/>)}</div>
      {view === "operations" && <div className="sa-owner-links"><Link to={`/solo/${account}/command-center/systems-check`}>Open Systems Check findings and run evidence<ArrowUpRight size={14}/></Link><Link to={`/solo/${account}/settings/integrations/automations`}>Inspect workflow configuration<ArrowUpRight size={14}/></Link></div>}
      {view === "team" && <div className="sa-owner-links"><Link to={`/solo/${account}/settings/team`}>Manage team membership<ArrowUpRight size={14}/></Link></div>}
    </>}
    <footer className="sa-owner-links"><Link to={`/solo/${account}/growth/analytics`}>Marketing performance lives in Marketing<ArrowUpRight size={14}/></Link><Link to={`/solo/${account}/sales/performance`}>Sales performance lives in Sales<ArrowUpRight size={14}/></Link></footer>
  </section>;
}
