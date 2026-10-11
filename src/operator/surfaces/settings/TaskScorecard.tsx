import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { criterionNames, scorecardCoverage, type TaskEvaluation, type TaskScorecardRead, type TaskSetVersion } from '@/operator/data/taskScorecardContract';
import { displayNumber, displayPercent } from '@/operator/data/intelligenceContract';
import { resolveTaskEvaluatorSet } from '../../../../supabase/functions/_shared/eval/trajectory-registry';

export function TaskScorecard({ read, work, onInspectTask, onBrowseTasks }: {
  read?: TaskScorecardRead; work: { id: string; category: string } | null;
  onInspectTask: (id: string) => void; onBrowseTasks: () => void;
}) {
  const [definitions, setDefinitions] = useState(false);
  const [selected, setSelected] = useState<TaskEvaluation | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null); const inspection = useRef<HTMLElement>(null);
  // A previously recorded action must not reopen inspection and steal return focus on remount.
  const handledAction = useRef(read?.action.item?.run_ref);
  const page = read?.page; const data = page && !page.error ? page.data : undefined;
  const pending = read?.action.status === 'pending'; const uncertain = read?.action.status === 'unconfirmed';
  const definition = resolveTaskEvaluatorSet('durable-task-evidence', read?.version ?? '1.1.0');
  const valid = data && selected ? data.items.find(i => i.run_ref === selected.run_ref) ?? (read?.action.item?.run_ref === selected.run_ref ? read.action.item : null) : null;
  const inspectionId = valid?.run_ref;
  useEffect(() => { setSelected(null); }, [read?.version]);
  useEffect(() => {
    if (read?.action.status === 'recorded' && read.action.item && read.action.item.run_ref !== handledAction.current) {
      handledAction.current = read.action.item.run_ref; setSelected(read.action.item);
    }
  }, [read?.action]);
  useEffect(() => { if (inspectionId) { inspection.current?.focus(); inspection.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); } }, [inspectionId]);
  function close() { setSelected(null); if (opener.current?.isConnected) opener.current.focus(); else document.getElementById('intel-scorecard-heading')?.focus(); }
  const coverage = data ? scorecardCoverage(data) : null;
  return <section className="intel-section intel-scorecard" aria-label="Agent scorecard" aria-busy={pending || page?.loading}>
    <header><h3 id="intel-scorecard-heading" tabIndex={-1}>Agent scorecard</h3><p>PARTIAL · versioned task evidence · recorded model participants · outcome ownership unavailable</p></header>
    {!read ? <p>Task scorecard unavailable: no Operator reader is connected.</p> : <>
      <div className="intel-score-toolbar"><label htmlFor="intel-task-set">Evaluator set</label>
        <Select value={read.version} disabled={pending || uncertain} onValueChange={v => read.selectVersion(v as TaskSetVersion)}>
          <SelectTrigger id="intel-task-set"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="1.0.0">Durable task evidence · 1.0.0</SelectItem><SelectItem value="1.1.0">Durable task evidence · 1.1.0</SelectItem>
          </SelectContent></Select>
        <Button variant="outline" aria-expanded={definitions} onClick={() => setDefinitions(!definitions)}>Inspect criteria</Button>
        <Button variant="outline" disabled={pending || page?.fetching} onClick={page?.refresh}>Refresh scorecard</Button>
      </div>
      <p className="intel-source">Coverage applies to this returned evaluation sample, including labeled historical replays. It is not a business completion rate or an overall agent-health score.</p>
      <p className="intel-source intel-id">Evaluator identity: {definition.id}@{definition.version} · {data?.set.hash ?? 'Server identity not yet read'}</p>
      {definitions && <div className="intel-definitions">{definition.evaluators.map(c => <details key={c.id}><summary>{criterionNames[c.id]} · {c.version}</summary><p>{c.criterion}</p><dl><dt>Required evidence</dt><dd>{c.required_evidence.join(' · ')}</dd><dt>Failure</dt><dd>{c.failure}</dd><dt>Indeterminate</dt><dd>{c.indeterminate}</dd><dt>Not applicable</dt><dd>{c.not_applicable}</dd></dl></details>)}</div>}
      {page?.loading ? <><p role="status">Loading task scorecard…</p><Skeleton className="h-10 w-full" /><Skeleton className="mt-4 h-32 w-full" /></> : page?.error ? <div className="intel-empty" role="alert"><strong>{page.unavailable ? 'Task scorecard unavailable' : 'Task scorecard could not load'}</strong><p>No stale evidence is shown. Refresh after checking access and the connection.</p></div> : !data ? <p role="status">No source response yet.</p> : data.items.length === 0 ? <div className="intel-empty"><strong>No recorded task evaluations</strong><p>Inspect a supported task in the Forensic Observatory, then evaluate its recorded evidence with an exact evaluator version.</p><Button variant="outline" onClick={onBrowseTasks}>Inspect a task</Button></div> : <>
        <dl className="intel-measures"><Measure label="Evaluations in sample" value={displayNumber(data.sample.evaluations)} note={`${data.sample.observations} observations · ${data.sample.replays} historical replays`} /><Measure label="Canonical task subjects" value={displayNumber(data.sample.task_subjects)} note="Repeated evaluation is not another task" /><Measure label="Resolved criterion coverage" value={displayPercent(coverage!.coverage)} note={`${coverage!.resolved} / ${coverage!.denominator} applicable checks resolved`} /><Measure label="Unresolved checks" value={displayNumber(coverage!.unresolved)} note={`${coverage!.excluded} positively excluded checks`} /></dl>
        <figure className="intel-chart"><figcaption>Criterion evidence coverage</figcaption><ul className="intel-score-bars">{data.criteria.map(c => <li key={c.scorer}><div><strong>{criterionNames[c.scorer]}</strong><span>{c.version}</span></div><div className="intel-score-track" aria-hidden="true">{(['pass', 'fail', 'indeterminate', 'not_applicable'] as const).map(v => <span key={v} data-verdict={v} style={{ width: `${c.total ? 100 * c[v] / c.total : 0}%` }} />)}</div><p>{c.resolved} / {c.coverage_denominator} resolved · {c.pass} pass · {c.fail} fail · {c.indeterminate} indeterminate · {c.not_applicable} excluded · criterion pass rate {c.criterion_pass_rate === null ? 'unavailable' : displayPercent(c.criterion_pass_rate)}</p></li>)}</ul><p className="intel-source">Green: pass · red: fail · amber: indeterminate · neutral: not applicable. Missing evidence remains unresolved.</p></figure>
        <p className="intel-source">Server observed {new Date(data.observed_at).toLocaleString()} · up to 25 evaluations per page · historical observations retain their original source time.</p>
        <div className="intel-table-wrap"><table><caption className="sr-only">Recorded task evaluations</caption><thead><tr><th>Recorded / mode</th><th>Canonical task</th><th>Observed state</th><th><span className="sr-only">Inspection</span></th></tr></thead><tbody>{data.items.map(i => <tr key={i.run_ref}><td>{new Date(i.created_at).toLocaleString()}<small>{i.mode === 'replay' ? 'Historical replay' : 'Observation'}</small></td><td className="intel-id">{i.category ?? 'Unknown category'}<small>{i.work_ref}</small></td><td>{i.recorded_state ?? 'Unknown'}<small>{i.source_available ? 'Source available' : 'Source removed · history only'}</small></td><td><Button variant="ghost" onClick={e => { opener.current = e.currentTarget; setSelected(i); }} aria-label={`Inspect task evaluation ${i.run_ref}`}>Inspect evaluation</Button></td></tr>)}</tbody></table></div>
      </>}
      <div className="intel-actions"><Button variant="outline" disabled={pending || uncertain} onClick={() => { read.pageOlder(null); document.getElementById('intel-scorecard-heading')?.focus(); }}>Newest evaluations</Button><Button variant="outline" disabled={pending || uncertain || page?.fetching || page?.error || !data?.next_cursor} onClick={() => { read.pageOlder(data?.next_cursor ?? null); document.getElementById('intel-scorecard-heading')?.focus(); }}>Older evaluations</Button></div>
      {work && <div className="intel-score-participant"><strong>Evaluate selected task</strong><p className="intel-id">{work.category} · {work.id}</p><p>Records an internal deterministic evaluation of current evidence. No task, approval, provider call or model configuration is changed.</p><Button disabled={pending || uncertain || page?.error || !data} onClick={() => { opener.current = null; void read.evaluate({ version: read.version, workId: work.id }); }}>Evaluate recorded evidence</Button><Button variant="ghost" onClick={() => onInspectTask(work.id)}>Inspect canonical task evidence</Button></div>}
      {valid && <section ref={inspection} tabIndex={-1} className="intel-section" aria-label="Task evaluation inspection" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}><div className="intel-detail-close"><Button variant="ghost" onClick={close}>Close evaluation</Button></div><h4>{valid.mode === 'replay' ? 'Historical replay' : 'Recorded task evaluation'}</h4>
        <dl className="intel-detail"><Fact label="Evaluation reference" value={valid.run_ref} /><Fact label="Canonical task reference" value={valid.work_ref} /><Fact label="Evaluator set" value={`${data!.set.id}@${data!.set.version}`} /><Fact label="Definition hash" value={data!.set.hash} /><Fact label="Input identity" value={valid.input_hash} /><Fact label="Source observed" value={new Date(valid.source_observed_at).toLocaleString()} /><Fact label="Previous evaluation" value={valid.previous_run_ref ?? 'None · fresh observation'} /><Fact label="Terminal verification at observation" value={valid.terminal_verified_at_observation === null ? 'Unknown' : valid.terminal_verified_at_observation ? 'Recorded verified condition; current readback remains separate' : 'Unverified'} /></dl>
        <ul className="intel-score-results">{valid.results.map(r => <li key={r.result_ref}><strong>{criterionNames[r.scorer]} · {r.version}</strong><span data-verdict={r.verdict}>{r.verdict.replace('_', ' ')}</span><p>Evidence: {r.evidence} · {r.reason}</p><small className="intel-id">paige_eval_result:{r.result_ref}</small></li>)}</ul>
        <h4>Recorded participant context</h4>{valid.participants.length ? valid.participants.map(p => <p key={p.trace_ref} className="intel-id">{p.agent_ref} · roster version {p.roster_version_at_observation} at observation · execution version unavailable · trace {p.trace_ref}</p>) : <p>No proven agent participants. No task owner was inferred.</p>}<p>{displayNumber(valid.unassigned_model_calls)} unassigned model calls. Participation does not establish task ownership.</p>
        <p className="intel-source">Historical input is immutable. Source reads detect observed drift; they are not an atomic snapshot across every system. Replay does not reverify the destination or rerun the task.</p><div className="intel-actions"><Button variant="outline" onClick={() => onInspectTask(valid.work_ref)}>Inspect canonical task evidence</Button><Button disabled={pending || uncertain || !valid.source_available} variant="outline" onClick={() => { void read.evaluate({ version: read.version, replayRunId: valid.run_ref }); }}>Replay stored evidence</Button></div>{!valid.source_available && <p>Replay unavailable: the canonical task source was removed.</p>}
      </section>}
      <p role="status">{read.action.message}</p>{pending && <Button variant="ghost" onClick={read.stopWaiting}>Stop waiting</Button>}
    </>}
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="intel-id">{value}</dd></div>; }
function Measure({ label, value, note }: { label: string; value: string; note: string }) { return <div><dt>{label}</dt><dd>{value}</dd><small>{note}</small></div>; }
