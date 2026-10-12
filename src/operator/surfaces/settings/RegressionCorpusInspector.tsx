import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { RegressionCorpusCase, RegressionCorpusPage, RegressionCorpusRead, RegressionHistory } from '@/operator/data/regressionCorpusContract';

const modes = ['historical', 'current', 'reintroduced'] as const;
const modeName = { historical: 'Historical faulty source', current: 'Corrected canonical source', reintroduced: 'Controlled defect reintroduction' };
const verdictName = (row?: RegressionHistory | null) => row ? row.verdict.toUpperCase().replace('_', ' ') : 'INDETERMINATE';
const title = (c: RegressionCorpusCase) => c.definition.case_key === 'credit-sync-audit-reference' ? 'Credit-sync audit integrity' : c.definition.case_key;
const color = (row?: RegressionHistory | null) => row?.mode === 'reintroduced' || !row || row.verdict === 'indeterminate' ? 'var(--pg-warning)' : row.verdict === 'pass' ? 'var(--pg-positive)' : row.verdict === 'fail' ? 'var(--pg-negative)' : 'var(--pg-muted)';
const resolved = (row?: RegressionHistory | null) => row && row.evidence_state === 'complete' && row.applicability === 'applicable' && ['pass', 'fail'].includes(row.verdict) ? 1 : 0;

export function RegressionCorpusInspector({ read }: { read?: RegressionCorpusRead }) {
  const [selection, setSelection] = useState<{ id: string; page: RegressionCorpusPage } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null); const detail = useRef<HTMLElement | null>(null); const heading = useRef<HTMLHeadingElement | null>(null);
  const page = read?.page;
  const data = page && !page.error && !page.fetching ? page.data : undefined;
  const selected = selection?.page === data ? data?.items.find(c => c.case_ref === selection.id) : undefined;
  useEffect(() => {
    if (selected) { detail.current?.focus(); detail.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }
  }, [selection, selected]);
  useEffect(() => { if (selection && !selected) { setSelection(null); heading.current?.focus(); } }, [selection, selected]);
  function close() { setSelection(null); if (opener.current?.isConnected) opener.current.focus(); else heading.current?.focus(); }
  function navigate(action: () => void) { setSelection(null); heading.current?.focus(); action(); }
  const recent = selected?.history.reduce<Partial<Record<typeof modes[number], RegressionHistory>>>((all, row) => {
    if (!all[row.mode] || Date.parse(row.recorded_at) >= Date.parse(all[row.mode]!.recorded_at)) all[row.mode] = row;
    return all;
  }, {});
  return <section className="intel-section intel-scorecard intel-corpus" aria-labelledby="intel-corpus-heading" aria-busy={page?.fetching ?? false}>
    <header><h3 id="intel-corpus-heading" ref={heading} tabIndex={-1}>Regression Corpus Inspector</h3><p>Inspect a versioned case and how its original defect is detected. Recorded fixture tests do not describe current production health.</p></header>
    {!read ? <p>Corpus reader unavailable: no Operator reader is connected.</p> : <>
      <div className="intel-read"><span className="intel-state">PARTIAL · controlled offline evidence</span><Button variant="outline" disabled={page?.fetching} onClick={() => navigate(read.page.refresh)}>Refresh corpus</Button></div>
      {page?.loading || page?.fetching ? <><p role="status">Loading case metadata…</p><Skeleton className="h-20 w-full" /></> : page?.error ? <div role="alert" className="intel-empty"><strong>{page.unavailable ? 'Corpus reader unavailable' : 'Could not read the corpus'}</strong><p>{page.unavailable ? 'The protected reader is unavailable in this environment.' : 'No stale results are shown. Check your connection and refresh the corpus.'}</p></div> : !data ? <p role="status">No verified corpus read is available.</p> : <>
        <p className="intel-source">{data.items.length} reviewed {data.items.length === 1 ? 'case' : 'cases'} on this page · source: operator_intelligence_regression_corpus · observed {new Date(data.observed_at).toLocaleString()}</p>
        {!data.items.length ? <div className="intel-empty"><strong>No regression cases returned</strong><p>Only independently reviewed, sanitized fixtures are published. New cases require an engineering PR and review.</p></div> : <div className="intel-table-wrap"><table><caption className="sr-only">Versioned regression cases</caption><thead><tr><th>Case / version</th><th>Evidence</th><th>Recorded corrected-source result</th><th>Inspect</th></tr></thead><tbody>{data.items.map(c => <tr key={c.case_ref}><td>{title(c)}<small className="intel-id">{c.definition.case_key} · {c.definition.version}</small></td><td>Repository defect #{c.definition.source.issue}<small>Synthetic offline fixture · historical task unlinked</small></td><td><strong style={{ color: color(c.latest_corrected_result) }}>{verdictName(c.latest_corrected_result)}</strong><small>{resolved(c.latest_corrected_result)} / 1 required check resolved · {c.latest_corrected_result?.evidence_state ?? 'missing'} evidence</small><small>At reproduction, within returned history</small></td><td><Button variant="ghost" aria-label={`Inspect regression case ${title(c).toLowerCase()}`} onClick={e => { opener.current = e.currentTarget; setSelection({ id: c.case_ref, page: data }); }}>Inspect case</Button></td></tr>)}</tbody></table></div>}
        <div className="intel-actions"><Button variant="outline" disabled={!read.cursor} onClick={() => navigate(() => read.pageOlder(null))}>Newest cases</Button><Button variant="outline" disabled={!data.next_cursor} onClick={() => navigate(() => read.pageOlder(data.next_cursor))}>Older cases</Button></div>
        {selected && <section ref={detail} tabIndex={-1} className="intel-section" aria-label="Regression case inspection" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
          <div className="intel-detail-close"><Button variant="ghost" onClick={close}>Back to Improvement Studio</Button></div><h4>{title(selected)}</h4>
          <p className="intel-source">Case version {selected.definition.version} · {selected.definition.evaluator.id} evaluator {selected.definition.evaluator.version} · synthetic offline reproduction</p>
          {selected.latest_corrected_result?.verdict !== 'pass' && <p role="status">The returned corrected-source result is {verdictName(selected.latest_corrected_result)} · {selected.latest_corrected_result?.evidence_state ?? 'missing'} evidence. This does not pass a required regression gate.</p>}
          <figure className="corpus-lifecycle"><figcaption>Recorded regression lifecycle</figcaption><ol>{modes.map((mode, i) => { const row = recent?.[mode]; return <li key={mode}><span>{i + 1}</span><strong style={{ color: color(row) }}>{verdictName(row)}</strong><p>{modeName[mode]}</p><small>{row ? `HTTP ${row.output.http_status ?? 'unknown'} · audit ${row.output.audit_recorded === null ? 'unknown' : row.output.audit_recorded ? 'recorded' : 'missing'} · ${row.evidence_state} evidence` : 'No recorded evidence in this page'}</small>{mode === 'reintroduced' && <p className="corpus-controlled">{row?.verdict === 'fail' ? 'Expected FAIL: the controlled regression-detection test caught the old defect.' : 'Controlled regression-detection test; the expected result is FAIL. Missing or indeterminate evidence does not prove detection.'} This is not a current production failure.</p>}</li>; })}</ol></figure>
          <dl className="intel-detail"><Fact label="Expected behavior" value={Object.entries(selected.definition.expected).map(([k, v]) => `${k} = ${v}`).join(' · ')} /><Fact label="Recorded corrected check" value={`${resolved(selected.latest_corrected_result)} / 1 required check resolved · offline CI only`} /></dl>
          <h4>Evidence and provenance</h4><p>These records describe controlled invocations of faulty, corrected and reintroduced source against the same synthetic fixture. Only recorded evaluator verdicts establish the test result.</p>
          {selected.history_limit_reached && <p role="status">History is limited to 25 records. The full lifecycle may be incomplete; no omitted result is inferred.</p>}
          <details className="corpus-technical"><summary>Immutable identities, hashes and source provenance</summary><dl className="intel-detail">
            <Fact label="Case identity" value={`${selected.definition.case_key}@${selected.definition.version}`} /><Fact label="Canonical case reference" value={selected.case_ref} /><Fact label="Case hash" value={selected.case_hash} /><Fact label="Fixture hash" value={selected.definition.fixture.hash} /><Fact label="Frozen evaluator" value={`${selected.definition.evaluator.set_id}@${selected.definition.evaluator.set_version} · ${selected.definition.evaluator.id}@${selected.definition.evaluator.version}`} /><Fact label="Evaluator hash" value={selected.definition.evaluator.definition_hash} />
            <Fact label="Source path" value={selected.definition.source.source_path} /><Fact label="Faulty / fixed commits" value={`${selected.definition.source.faulty_commit} / ${selected.definition.source.fixed_commit}`} /><Fact label="Fix merge commit" value={selected.definition.source.merge_commit} /><Fact label="Fixture and runner" value={`${selected.definition.fixture.path} · ${selected.definition.runner}`} />
          </dl><ul className="intel-score-results">{selected.history.map(row => <li key={row.run_ref}><strong>{modeName[row.mode]} · {verdictName(row)}{row.mode === 'reintroduced' ? ' · controlled detection test' : ''}</strong><span className="intel-id">Run {row.run_ref} · result {row.result_ref ?? 'missing'}</span><span className="intel-id">Invoked source SHA-256 {row.source_hash}</span><span className="intel-id">Evidence SHA-256 {row.evidence_hash}</span><p>{new Date(row.recorded_at).toLocaleString()} · {row.evidence_state} evidence · {row.applicability ?? 'unknown'} · hash encoding: {row.hash_encoding}</p></li>)}</ul></details>
          <p className="intel-source">No original production task was captured; historical customer impact is UNKNOWN. Authenticated Operator acceptance is UNVERIFIED. No customer content is stored in this case.</p>
          <div className="intel-actions"><a href={`https://github.com/Paige-Agent-AI/Paige-Agent-AI/issues/${selected.definition.source.issue}`} target="_blank" rel="noreferrer">Source issue #{selected.definition.source.issue} <ArrowUpRight size={14} aria-hidden /></a><a href={`https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/${selected.definition.source.fix_pr}#issuecomment-${selected.definition.source.review_comment}`} target="_blank" rel="noreferrer">Independent fix review <ArrowUpRight size={14} aria-hidden /></a><Button variant="outline" disabled>Inspect canonical task evidence</Button></div>
          <p className="intel-source">Forensic task handoff unavailable: this historical defect has no server-proven trajectory identity. Offline replay runs in CI; no task or provider is executed from this inspector.</p>
        </section>}
      </>}
    </>}
  </section>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="intel-id">{value}</dd></div>; }
