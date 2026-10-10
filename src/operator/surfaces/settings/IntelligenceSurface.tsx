import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, RefreshCw, ArrowUpRight, FileDown, X, Gauge, ScanSearch, FlaskConical, Cpu, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIntelligence } from "@/operator/data/useIntelligence";
import {
  displayCost, displayNumber, displayPercent, newRecommendation, recommendationDocument, recommendationErrors,
  type EvalRun, type IntelligenceRead, type IntelligenceTrace, type Recommendation, type ReadState,
} from "@/operator/data/intelligenceContract";
import "./intelligence.css";
import { DistributionChart, StatusComposition, LatencyPlot, EvaluationChart, GovernedPath } from "./IntelligenceVisuals";

const WORKSPACES = [
  ["executive", "Executive Flight Deck"], ["forensic", "Forensic Observatory"],
  ["studio", "Improvement Studio"], ["lab", "Local Model Lab"], ["radar", "Opportunity Radar"],
] as const;
type Workspace = typeof WORKSPACES[number][0];
const WORKSPACE_ICONS = { executive: Gauge, forensic: ScanSearch, studio: FlaskConical, lab: Cpu, radar: Radar };

export default function IntelligenceSurface() {
  const read = useIntelligence();
  // Identity change or authority loss unmounts evidence and drafts; token renewal preserves them.
  if (read.access !== "allowed") return (
    <section className="intelligence" aria-busy={read.access === "checking"}>
      <h2 className="sr-only">PAIGE Intelligence</h2>
      <p role="status">{read.access === "checking" ? "Checking Operator access…" : read.access === "error"
        ? "Operator access could not be checked. Retry before loading fleet evidence."
        : "Platform Operator access required. Fleet evidence is not available in a tenant workspace."}</p>
      {read.access === "error" && <Button onClick={read.retryAccess}>Retry access check</Button>}
    </section>
  );
  return <IntelligenceWorkspace key={read.subject} read={read} />;
}

/** Same component in the real shell and the isolated LOCAL SYNTHETIC review host. */
export function IntelligenceWorkspace({ read }: { read: IntelligenceRead }) {
  const [workspace, setWorkspace] = useState<Workspace>("executive");
  const [trace, setTrace] = useState<IntelligenceTrace | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState({ improvement: newRecommendation("improvement"), opportunity: newRecommendation("opportunity") });
  const [notice, setNotice] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!destination) return;
    // Radix Presence mounts a changed panel after its layout effect. Focus the settled panel.
    const frame = requestAnimationFrame(() => {
      const field = document.getElementById(destination);
      if (field) { field.focus({ preventScroll: true }); field.scrollIntoView?.({ block: "center", behavior: "auto" }); }
      setDestination(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [destination, workspace]);
  function inspectWorkspace(kind: "forensic" | "studio") {
    setWorkspace(kind);
    setDestination(kind === "forensic" ? "intel-call-filter" : "intel-evaluation-evidence");
  }
  function prepare(kind: Recommendation["kind"], evidence: string) {
    setDrafts((d) => ({ ...d, [kind]: { ...d[kind], evidence: d[kind].evidence.includes(evidence)
      ? d[kind].evidence : [d[kind].evidence, evidence].filter(Boolean).join("\n") } }));
    setWorkspace(kind === "improvement" ? "studio" : "radar");
    setDestination(`intel-${kind}-evidence`);
    setNotice("Evidence reference added to your session draft. No proposal was submitted.");
  }
  const traces = read.traces.error ? [] : read.traces.data ?? [];
  const runs = read.evals.error ? [] : read.evals.data ?? [];
  const validTrace = trace ? traces.find((row) => row.id === trace.id) ?? null : null;
  const validRun = run ? runs.find((row) => row.id === run.id) ?? null : null;
  const m = read.metrics.error ? {} : read.metrics.data ?? {};
  const t = m.traces ?? {};
  const models = Array.from(new Set(traces.filter((row) => row.model).map((row) => JSON.stringify([row.provider, row.model]))))
    .map((key) => { const [provider, model] = JSON.parse(key) as [string | null, string]; return { provider, model, count: traces.filter((r) => r.provider === provider && r.model === model).length }; });
  const filtered = traces.filter((row) => [row.id, row.agent_id, row.provider, row.model, row.status, row.job_kind]
    .some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  return (
    <section className="intelligence" data-workspace={workspace} aria-label="PAIGE Intelligence">
      <div className="intel-heading">
        <div><h2 className="sr-only">PAIGE Intelligence</h2><p>Observe performance. Investigate evidence. Prepare the next improvement.</p></div>
        <span className="intel-state">PARTIAL · observational foundation</span>
      </div>
      <Tabs value={workspace} onValueChange={(v) => { setWorkspace(v as Workspace); setNotice(""); }}>
        <TabsList className="intel-tabs" aria-label="Intelligence workspaces">
          {WORKSPACES.map(([id, name]) => { const Icon = WORKSPACE_ICONS[id]; return <TabsTrigger key={id} value={id} data-workspace={id}><Icon size={16} aria-hidden="true" />{name}</TabsTrigger>; })}
        </TabsList>
        <p className="intel-notice" role="status">{notice}</p>

        <TabsContent value="executive">
          <Section title="The evidence available today" subtitle="Fleet-wide · last 30 days · call telemetry, not verified task outcomes">
            <ReadStatus state={read.metrics} name="Fleet metrics" />
            <dl className="intel-measures">
              <Measure label="Traced LLM calls" value={displayNumber(t.total)} />
              <Measure label="Estimated model spend" value={displayCost(t.cost_estimate_usd)} note="List-price estimate; not a bill" />
              <Measure label="Average call latency" value={displayNumber(t.avg_latency_ms, " ms")} />
              <Measure label="Eval pass rate" value={displayPercent(m.evals?.avg_pass_rate)} note="Mean recorded run pass rate" />
            </dl>
            {read.metrics.data && !read.metrics.error && <p className="intel-source">Source: operator_intelligence_metrics · observed {new Date(read.metrics.updatedAt).toLocaleTimeString()} · aggregate refresh every 30s</p>}
            <div className="intel-chart-grid">
              <StatusComposition rows={t.by_status ?? []} />
              <DistributionChart title="Provider call distribution" rows={t.by_provider ?? []} />
            </div>
          </Section>
          <div className="intel-columns">
            <Section title="Decisions to prepare" subtitle="Signals retain their actual scope">
              <Signal title="Investigate recorded call failures" value={displayNumber(t.error_count)} action="Inspect calls" onClick={() => inspectWorkspace("forensic")} />
              <Signal title="Review calls awaiting configuration" value={displayNumber(t.needs_config)} action="Inspect setup gaps" onClick={() => inspectWorkspace("forensic")} />
              <Signal title="Review evaluation evidence" value={displayNumber(m.evals?.runs)} action="Inspect evaluations" onClick={() => inspectWorkspace("studio")} />
              <Signal title="Review doctrine flags" value={displayNumber(m.doctrine_flags)} />
              <p className="intel-source">Counts show recorded signals; severity and root cause require investigation.</p>
            </Section>
            <Section title="Operational quality coverage" subtitle="What this source cannot yet measure">
              <Coverage label="Verified task completion" status="UNAVAILABLE" detail="Task identity and terminal-outcome correlation are missing." />
              <Coverage label="Approval / tenant integrity" status="UNAVAILABLE" detail="No task-level hard-gate scorecard is exposed here." />
              <Coverage label="Cost per completed task" status="UNAVAILABLE" detail="Call spend has no verified completed-task denominator." />
              <Coverage label="Business effects" status="UNVERIFIED" detail="No attributable outcome link; no uplift or ROI claim." />
            </Section>
          </div>
          <Section title="Existing intelligence departments" subtitle="Original Intelligence capabilities preserved">
            <dl className="intel-measures">
              <Measure label="Agent roster" value={displayNumber(m.roster?.total)} note={`${displayNumber(m.roster?.enabled)} enabled · ${displayNumber(m.roster?.auto_disabled)} auto-disabled`} />
              <Measure label="Agent invocations" value={displayNumber(m.roster?.invocations)} note={`${displayNumber(m.roster?.invocations_all)} all-time · current value in 30 days`} />
              <Measure label="Prompt memories" value={displayNumber(m.memory?.total)} note={`${displayNumber(m.memory?.rated)} rated · ${displayNumber(m.memory?.window)} in 30 days`} />
              <Measure label="Tokens in / out" value={`${displayNumber(t.tokens_in)} / ${displayNumber(t.tokens_out)}`} />
            </dl>
            <div className="intel-columns">
              <Breakdown title="Provider routing" rows={t.by_provider ?? []} />
              <Breakdown title="Cognitive tiers" rows={t.by_tier ?? []} />
            </div>
            <dl className="intel-measures">
              <Measure label="Eval runs · all-time" value={displayNumber(m.evals?.runs_all)} />
              <Measure label="Recorded eval results" value={displayNumber(m.evals?.results)} />
              <Measure label="Passed eval results" value={displayNumber(m.evals?.passed)} />
              <Measure label="Call status groups" value={displayNumber(t.by_status?.length)} />
            </dl>
            <div className="intel-columns">
              <Breakdown title="Call statuses" rows={t.by_status ?? []} unit="calls" />
              <Breakdown title="Memory modalities" rows={m.memory?.by_modality ?? []} unit="memories" />
            </div>
          </Section>
          <ConversationSeam />
        </TabsContent>

        <TabsContent value="forensic">
          <Section title="Inspect the operational evidence" subtitle="Latest 50 recorded LLM calls · canonical metadata read on load and explicit refresh">
            <ReadStatus state={read.traces} name="Call evidence" />
            <LatencyPlot traces={traces} />
            <label className="intel-search"><Search size={16} aria-hidden /><span className="sr-only">Filter call evidence</span>
              <Input id="intel-call-filter" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter ID, caller, model or status" />
            </label>
            {!read.traces.loading && !read.traces.error && filtered.length === 0 && <Empty title={search ? "No matching calls" : "No recorded calls returned"} detail={search ? "Clear the filter to inspect the current sample." : "Calls will appear when legitimate runtime telemetry is recorded. No activity has been invented."} />}
            {filtered.length > 0 && <div className="intel-table-wrap"><table><caption className="sr-only">Recorded call metadata</caption>
              <thead><tr><th>Recorded</th><th>Caller / workspace</th><th>Model / route</th><th>Status</th><th>Estimated cost</th><th><span className="sr-only">Inspection</span></th></tr></thead>
              <tbody>{filtered.map((row) => <tr key={row.id}>
                <td><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></td>
                <td>{row.agent_id ?? "Unknown caller"}<small>Attributed: {row.tenant_label ?? "Platform"}{row.parent_name ? ` · parent: ${row.parent_name}` : ""}</small>{row.working_context_label && <small>Working on: {row.working_context_label}</small>}</td>
                <td>{row.model ?? "Not recorded"}<small>{row.provider ?? "Unknown provider"} · {row.tier ?? "No tier"}</small></td>
                <td>{row.status ?? "Not recorded"}</td><td>{displayCost(row.cost_estimate_usd)}</td>
                <td><Button variant="ghost" size="sm" aria-label={`Inspect call ${row.id}`} onClick={(e) => { opener.current = e.currentTarget; setTrace(row); }}>Inspect</Button></td>
              </tr>)}</tbody>
            </table></div>}
          </Section>
          {validTrace && <Inspection title="Call evidence" onClose={() => { setTrace(null); opener.current?.focus(); }}>
            <dl className="intel-detail">
              <Fact label="Source trace ID" value={validTrace.id} /><Fact label="Job category" value={validTrace.job_kind} />
              <Fact label="Modality" value={validTrace.modality} /><Fact label="Tokens in / out" value={`${displayNumber(validTrace.tokens_in)} / ${displayNumber(validTrace.tokens_out)}`} />
              <Fact label="Latency" value={displayNumber(validTrace.latency_ms, " ms")} /><Fact label="Error class" value={validTrace.error_class} />
            </dl>
            <Coverage label="Task trajectory" status="PARTIAL" detail="This is one model call. Goal, conversation, tool selection, approvals, receipts, continuations and verified terminal outcome are not exposed by this read." />
            <Button variant="outline" onClick={() => prepare("improvement", `paige_llm_trace:${validTrace.id}`)}>Prepare recommendation from this evidence <ArrowUpRight size={14} aria-hidden /></Button>
          </Inspection>}
          <ConversationSeam />
        </TabsContent>

        <TabsContent value="studio">
          <Section title="Evaluation and regression evidence" headingId="intel-evaluation-evidence" subtitle="Latest 25 canonical runs · target version, scorer set and case links · no paid evaluation is triggered">
            <ReadStatus state={read.evals} name="Evaluation history" />
            <EvaluationChart runs={runs} onInspect={(selected, button) => { opener.current = button; setRun(selected); }} />
            {!read.evals.loading && !read.evals.error && runs.length === 0 && <Empty title="No evaluation runs returned" detail="Existing datasets, cases, runs and results remain the canonical store. This view does not create a parallel corpus." />}
            {runs.length > 0 && <div className="intel-table-wrap"><table><caption className="sr-only">Evaluation runs</caption>
              <thead><tr><th>Target / version</th><th>Status</th><th>Scored / cases</th><th>Pass rate</th><th>Scorer set</th><th><span className="sr-only">Inspection</span></th></tr></thead>
              <tbody>{runs.map((row) => <tr key={row.id}><td>{row.target_kind ?? "Not recorded"}<small>{row.target_version ?? "Version not recorded"}</small></td>
                <td>{row.status}</td><td>{row.scored_count} / {row.case_count}<small>{row.degraded_count} degraded</small></td>
                <td>{displayPercent(row.pass_rate)}</td><td>{row.scorer_set?.join(", ") || "Not recorded"}</td>
                <td><Button variant="ghost" size="sm" aria-label={`Inspect evaluation ${row.id}`} onClick={(e) => { opener.current = e.currentTarget; setRun(row); }}>Inspect</Button></td></tr>)}</tbody>
            </table></div>}
          </Section>
          {validRun && <Inspection title="Evaluation evidence" onClose={() => { setRun(null); opener.current?.focus(); }}>
            <dl className="intel-detail"><Fact label="Run ID" value={validRun.id} /><Fact label="Dataset reference" value={validRun.dataset_id} />
              <Fact label="Previous run" value={validRun.prev_run_id} /><Fact label="Dataset status" value={validRun.dataset_status} />
              <Fact label="Aggregate score" value={displayNumber(validRun.aggregate_score)} /><Fact label="Completed" value={validRun.completed_at} /></dl>
            <p className="intel-source">Showing {validRun.results.length} of {validRun.result_count} scorer results (maximum 100). Null scores remain unscored. Rubrics, payloads and judge rationale are excluded.</p>
            <div className="intel-table-wrap"><table><caption className="sr-only">Sampled scorer results</caption><thead><tr><th>Scorer</th><th>Status</th><th>Score / verdict</th><th>Case / trace reference</th></tr></thead>
              <tbody>{validRun.results.map((result) => <tr key={result.id}><td>{result.scorer}<small>{result.scorer_kind}</small></td><td>{result.status}</td>
                <td>{displayNumber(result.score)} · {result.passed === null ? "Unscored" : result.passed ? "Passed" : "Failed"}</td>
                <td className="intel-id">{result.case_id ?? "No case"}<small>{result.source_trace_id ?? "No trace"}</small></td></tr>)}</tbody></table></div>
            <Coverage label="Reproducible task scorecard" status="UNAVAILABLE" detail="Target version and scorer names exist; an immutable dataset revision and complete runtime/evaluator fingerprint do not." />
            <Button variant="outline" onClick={() => prepare("improvement", `paige_eval_run:${validRun.id}; dataset:${validRun.dataset_id ?? "not recorded"}`)}>Prepare recommendation from this run</Button>
          </Inspection>}
          <Section title="Controlled improvement path" subtitle="A recommendation confers no authority">
            <GovernedPath kind="improvement" />
            <Coverage label="Clustering, experiments and releases" status="UNAVAILABLE" detail="Issue discovery, candidate records, controlled replay, canary and rollback seams remain subsequent INT-280 slices. Existing paige-eval is not invoked by this UI." />
          </Section>
          <ProposalEditor draft={drafts.improvement} onChange={(draft) => setDrafts((d) => ({ ...d, improvement: draft }))} />
        </TabsContent>

        <TabsContent value="lab">
          <Section title="Models observed in call evidence" subtitle="Latest 50 calls only · an observation is not an inventory, connected runtime or promotion recommendation">
            <ReadStatus state={read.traces} name="Model evidence" />
            <DistributionChart title="Observed model distribution" rows={models.map((model) => ({ provider: `${model.model} · ${model.provider ?? "Not recorded"}`, count: model.count }))} unit="sample calls" />
            {models.length === 0 && !read.traces.loading && !read.traces.error && <Empty title="No model identities returned" detail="Only model/provider names recorded in legitimate traces appear here." />}
            {models.length > 0 && <div className="intel-table-wrap"><table><caption className="sr-only">Observed models</caption><thead><tr><th>Model</th><th>Provider</th><th>Calls in sample</th><th>Readiness</th></tr></thead>
              <tbody>{models.map((model) => <tr key={`${model.provider}:${model.model}`}><td>{model.model}</td><td>{model.provider ?? "Not recorded"}</td><td>{model.count}</td><td>UNVERIFIED</td></tr>)}</tbody></table></div>}
          </Section>
          <Section title="Hosted versus local comparison" subtitle="One evaluation standard; separate permission to run or train">
            <GovernedPath kind="model" />
            <Coverage label="Inventory / provenance / runtime fingerprint" status="UNAVAILABLE" detail="Model artifacts, licenses, runtime versions and hardware are not recorded by the current read." />
            <Coverage label="Common benchmark suites" status="PARTIAL" detail="Canonical evaluation cases and scorer results exist. Local/hosted adapters and immutable dataset revisions are missing." />
            <Coverage label="Training data permission" status="UNAVAILABLE" detail="No consent, contractual rights or permitted-training-use manifest. Customer records and conversations are not eligible by default." />
            <Coverage label="Quantization and inference economics" status="UNAVAILABLE" detail="No comparable hardware, memory, throughput or quantization measurements." />
            <Coverage label="Fine-tuning / adapter experiments" status="PLANNED" detail="Requires approved data provenance, training authority and a bounded spend ceiling." />
            <Coverage label="Promotion and rollback" status="UNAVAILABLE" detail="Requires quality/safety regression evidence, explicit cohort, release approval and a rollback reference." />
          </Section>
        </TabsContent>

        <TabsContent value="radar">
          <Section title="Product Opportunity Dossiers" subtitle="Evidence synthesis by Intelligence · demand validation by Marketing · feasibility and delivery by Operations">
            <GovernedPath kind="opportunity" />
            <Coverage label="Continuous market discovery" status="UNAVAILABLE" detail="No research feed or governed dossier submission contract is connected. Add cited evidence to a session draft; no market facts or commercial estimates are prefilled." />
          </Section>
          <ProposalEditor draft={drafts.opportunity} onChange={(draft) => setDrafts((d) => ({ ...d, opportunity: draft }))} />
          <ConversationSeam />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function Section({ title, subtitle, children, headingId }: { title: string; subtitle?: string; children: ReactNode; headingId?: string }) {
  return <section className="intel-section"><header><h3 id={headingId} tabIndex={headingId ? -1 : undefined}>{title}</h3>{subtitle && <p>{subtitle}</p>}</header>{children}</section>;
}
function Measure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>;
}
function Fact({ label, value }: { label: string; value?: string | null }) {
  return <div><dt>{label}</dt><dd className="intel-id">{value ?? "Not recorded"}</dd></div>;
}
function Coverage({ label, status, detail }: { label: string; status: string; detail: string }) {
  return <div className="intel-coverage"><div><strong>{label}</strong><span className="intel-state" data-capability={status.toLowerCase()}>{status}</span></div><p>{detail}</p></div>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="intel-empty"><strong>{title}</strong><p>{detail}</p></div>;
}
function ReadStatus<T>({ state, name }: { state: ReadState<T>; name: string }) {
  return <div className="intel-read">
    <span role="status">{state.loading ? `Loading ${name.toLowerCase()}…` : state.error ? state.unavailable
      ? `${name} unavailable: the Operator metadata read is not installed. No records were substituted.`
      : `${name} could not load or access was refused. No stale evidence is shown.` : state.data ? "Recorded source data · production acceptance UNVERIFIED" : "No source response yet"}</span>
    <Button variant="outline" size="sm" disabled={state.fetching} onClick={state.refresh}><RefreshCw size={14} aria-hidden /> {state.fetching ? "Refreshing" : `Refresh ${name.toLowerCase()}`}</Button>
  </div>;
}
function Signal({ title, value, action, onClick }: { title: string; value: string; action?: string; onClick?: () => void }) {
  return <div className="intel-signal"><div><strong>{title}</strong>{action && <Button variant="link" size="sm" onClick={onClick}>{action} <ArrowUpRight size={12} aria-hidden /></Button>}</div><span>{value}</span></div>;
}
function Breakdown({ title, rows, unit = "calls" }: { title: string; rows: { provider?: string; tier?: string; status?: string; modality?: string; count: number; cost_estimate_usd?: number | null }[]; unit?: string }) {
  return <div><h4>{title}</h4>{rows.length ? rows.map((row, i) => <div className="intel-signal" key={row.provider ?? row.tier ?? row.status ?? row.modality ?? i}><strong>{row.provider ?? row.tier ?? row.status ?? row.modality ?? "Unknown"}</strong><span>{displayNumber(row.count)} {unit}{unit === "calls" && ` · ${displayCost(row.cost_estimate_usd)}`}</span></div>) : <p className="intel-source">No breakdown returned.</p>}</div>;
}
function Inspection({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Section title={title}><div onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}><div className="intel-detail-close"><Button autoFocus variant="ghost" size="sm" onClick={onClose}><X size={14} aria-hidden /> Close inspection</Button></div>{children}</div></Section>;
}
function ConversationSeam() {
  return <Section title="Discuss with PAIGE" subtitle="One governed Chat / Live experience">
    <p>Open the existing PAIGE spine from the shell to continue a conversation. Intelligence evidence is not automatically attached or retrieved yet.</p>
    <Coverage label="Contextual evidence handoff" status="UNAVAILABLE" detail="Operator Chat / Live owners must expose an authorized Intelligence read and shared context reference. This screen does not start a conversation, send evidence or create a second runtime." />
  </Section>;
}

const FIELDS: { key: keyof Omit<Recommendation, "kind">; label: string; hint: string }[] = [
  { key: "problem", label: "Problem or opportunity", hint: "State the observed gap and its impact." },
  { key: "target", label: "Target business, industry or capability", hint: "Name the affected audience or operating capability." },
  { key: "evidence", label: "Evidence and source references", hint: "Trace/run/case IDs or cited source URLs. Exclude private customer content." },
  { key: "freshness", label: "Source freshness", hint: "Observation dates, evidence window and stale-source limitations." },
  { key: "confidence", label: "Confidence", hint: "State the level and why the evidence supports it." },
  { key: "assumptions", label: "Remaining assumptions", hint: "What still needs to be tested? Write none only when justified." },
  { key: "capability", label: "Proposed PAIGE capability or change", hint: "A bounded recommendation, not an instruction to execute." },
  { key: "value", label: "Expected customer value", hint: "The business job this could improve." },
  { key: "economics", label: "Economics and commercial assumptions", hint: "Estimate with assumptions, or state that economics are unverified." },
  { key: "dependencies", label: "Architecture and operational dependencies", hint: "Canonical seams, resources and accountable owners." },
  { key: "risks", label: "Risks and required approvals", hint: "Include privacy, safety, spend, training and release gates where relevant." },
  { key: "acceptance", label: "Acceptance metrics and hard constraints", hint: "How improvement will be measured; what must not regress." },
  { key: "nextAction", label: "Suggested next action", hint: "The next review, research or validation step." },
  { key: "owner", label: "Accountable department", hint: "Marketing: demand validation. Operations: feasibility and delivery." },
];
function ProposalEditor({ draft, onChange }: { draft: Recommendation; onChange: (draft: Recommendation) => void }) {
  const [review, setReview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const prefix = `intel-${draft.kind}`;
  return <Section title={draft.kind === "opportunity" ? "Prepare a Product Opportunity Dossier" : "Prepare an improvement recommendation"} subtitle="Session draft · download for human review · no saved record, approval or departmental submission">
    <form noValidate onSubmit={(e) => { e.preventDefault(); const missing = recommendationErrors(draft); setErrors(missing); setReview(missing.length === 0); setMessage(missing.length ? "Complete the highlighted review fields." : "Draft ready for your review. Nothing has been submitted.");
      if (missing.length) document.getElementById(`${prefix}-${missing[0]}`)?.focus(); }}>
      <p role="status">{message}</p>
      {review ? <dl className="intel-review">{FIELDS.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{draft[field.key]}</dd></div>)}</dl> :
        <div className="intel-form">{FIELDS.map((field) => <div key={field.key}>
          <label htmlFor={`${prefix}-${field.key}`}>{field.label}</label>
          <Textarea id={`${prefix}-${field.key}`} value={draft[field.key]} maxLength={4000} rows={2} required
            aria-invalid={errors.includes(field.key)} aria-describedby={`${prefix}-${field.key}-hint`}
            onChange={(e) => { onChange({ ...draft, [field.key]: e.target.value }); setErrors((old) => old.filter((key) => key !== field.key)); }} />
          <small id={`${prefix}-${field.key}-hint`}>{errors.includes(field.key) ? "Required for a reviewable recommendation. " : ""}{field.hint}</small>
        </div>)}</div>}
      <div className="intel-actions">
        {review ? <><Button type="button" variant="outline" onClick={() => setReview(false)}>Edit draft</Button>
          <Button type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(recommendationDocument(draft), null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = `INT-280-${draft.kind}-LOCAL-DRAFT.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("Session draft downloaded. No proposal was submitted or approved.");
          }}><FileDown size={14} aria-hidden /> Download draft</Button></> : <Button type="submit">Review draft</Button>}
        <Button type="button" variant="ghost" onClick={() => setDiscarding(true)}>Discard draft</Button>
      </div>
      {discarding && <div className="intel-discard" role="group" aria-label="Discard session draft">
        <p>Discard the current session draft? Its text will be cleared.</p>
        <Button type="button" variant="outline" onClick={() => setDiscarding(false)}>Keep editing</Button>
        <Button type="button" onClick={() => { onChange(newRecommendation(draft.kind)); setReview(false); setErrors([]); setDiscarding(false); setMessage("Session draft discarded."); }}>Discard text</Button>
      </div>}
    </form>
  </Section>;
}
