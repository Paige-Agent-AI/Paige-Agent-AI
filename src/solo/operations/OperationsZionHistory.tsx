import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, RotateCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { readZionAssignments, type ZionAssignment, type ZionAssignmentSummary } from './zion-assignment-read';
import './operations-zion-history.css';

type Inspection = { id: string; state: 'reading' | 'unavailable' | 'refused' } | { id: string; state: 'ready'; value: ZionAssignment };
type View = { scope: string; phase: 'idle' | 'reading' | 'unavailable' | 'refused' }
  | { scope: string; phase: 'sample'; entries: ZionAssignmentSummary[]; inspection: Inspection | null };
const labels = { pending: 'Recorded pending', succeeded: 'Response recorded', failed: 'Recorded failure', dispatched: 'Recorded handoff', unknown: 'Outcome unknown' };
const receiptLabels = { verified: 'Original receipt verified', unverified: 'Original receipt not verified', missing: 'No original receipt was returned',
  unavailable: 'Original receipt unavailable', conflicting: 'Original receipt needs review' };
const at = (value: string | null) => value === null ? 'Time unavailable' : `${new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value))} UTC`;

/** Deliberate reads of original own-identity records. No invocation, approval,
 * polling, provider operation or durable browser cache is created here. */
export function OperationsZionHistory({ tenantId, userId }: { tenantId: string; userId: string }) {
  const scope = JSON.stringify([userId, tenantId]);
  const liveScope = useRef(scope); liveScope.current = scope;
  const sequence = useRef(0), mounted = useRef(true), lifecycle = useRef<object>({}), header = useRef<HTMLButtonElement>(null);
  const headingId = useId(), contentId = useId();
  const [saved, setSaved] = useState<View>({ scope, phase: 'idle' });
  // Props changing are a privacy boundary before effects, even outside the keyed owner.
  const view: View = saved.scope === scope ? saved : { scope, phase: 'idle' };
  useEffect(() => {
    mounted.current = true;
    lifecycle.current = {};
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION' || liveScope.current !== scope) return;
      sequence.current++;
      setSaved({ scope, phase: event === 'SIGNED_OUT' ? 'refused' : 'unavailable' });
    });
    return () => { mounted.current = false; lifecycle.current = {}; data.subscription.unsubscribe(); };
  }, [scope]);
  const request = () => {
    const epoch = ++sequence.current, generation = lifecycle.current, origin = { actorId: userId, tenantId, epoch };
    const current = () => mounted.current && lifecycle.current === generation && liveScope.current === scope && sequence.current === epoch ? origin : null;
    return { origin, current };
  };
  function close() { sequence.current++; setSaved({ scope, phase: 'idle' }); }
  async function readSample() {
    header.current?.focus();
    const { origin, current } = request();
    setSaved({ scope, phase: 'reading' });
    const result = await readZionAssignments(origin, supabase, current);
    if (!current()) return;
    setSaved(result.status === 'ready' && 'entries' in result
      ? { scope, phase: 'sample', entries: result.entries, inspection: null }
      : { scope, phase: result.status === 'refused' ? 'refused' : 'unavailable' });
  }
  async function inspect(entry: ZionAssignmentSummary) {
    if (view.phase !== 'sample' || !view.entries.some(row => row.id === entry.id)
      || view.inspection?.state === 'reading') return;
    const { origin, current } = request();
    setSaved({ ...view, inspection: { id: entry.id, state: 'reading' } });
    const result = await readZionAssignments(origin, supabase, current, entry);
    if (!current()) return;
    // A current-authority refusal withdraws the whole displayed sample.
    if (result.status === 'refused') { setSaved({ scope, phase: 'refused' }); return; }
    setSaved({ ...view, inspection: result.status === 'ready' && 'invocation' in result
      ? { id: entry.id, state: 'ready', value: result.invocation } : { id: entry.id, state: 'unavailable' } });
  }

  return <section className="ops-zion-history" aria-labelledby={headingId}>
    <header className="ops-desk-section-heading"><h2 id={headingId}>ZION assignments</h2>
      <button ref={header} type="button" className="ops-desk-inspect" aria-expanded={view.phase !== 'idle'} aria-controls={contentId}
        onClick={view.phase === 'idle' ? () => { void readSample(); } : close}>
        {view.phase === 'idle' ? 'Inspect recent work' : 'Close inspection'}
      </button>
    </header>
    <div id={contentId}>
      {view.phase === 'idle' && <p className="ops-view-muted">Inspect the original responses from work you asked ZION to prepare.</p>}
      {view.phase === 'reading' && <div role="status" aria-busy="true"><p>Reading your recent specialist assignments…</p>
        <div className="ops-zion-skeleton" aria-hidden="true" /><div className="ops-zion-skeleton" aria-hidden="true" /></div>}
      {(view.phase === 'unavailable' || view.phase === 'refused') && <div role="status">
        <p>{view.phase === 'refused' ? 'Current owner or admin access is required to inspect these assignments.' : 'Your recent assignments could not be verified.'}</p>
        <button type="button" className="ops-view-text-action" onClick={() => { void readSample(); }}>Check current access again</button>
      </div>}
      {view.phase === 'sample' && <>
        {!view.entries.length ? <><p role="status">No ZION assignment appears in this recent sample.</p>
          <p className="ops-view-muted">The sample is not a complete history. Use Plan with ZION to prepare your next request.</p></>
          : <><p className="ops-view-muted">Your recent requests · sampled from up to five specialist assignments.</p>
            <ul className="ops-zion-rows">{view.entries.map(entry => {
              const inspection = view.inspection?.id === entry.id ? view.inspection : null;
              const result = inspection?.state === 'ready' ? inspection.value : null;
              return <li key={entry.id}>
                <div className="ops-desk-section-heading"><div><strong>ZION</strong><p className="ops-view-muted">Requested {at(entry.created_at)}</p></div>
                  <span>{labels[result?.recorded_status ?? entry.recorded_status]}</span></div>
                <button type="button" className="ops-desk-inspect" aria-expanded={inspection?.state === 'ready'}
                  aria-disabled={view.inspection?.state === 'reading' || undefined}
                  onClick={() => { void inspect(entry); }}>
                  {inspection?.state === 'reading' ? 'Inspecting original response…' : result ? 'Refresh original response' : 'Inspect original response'}
                </button>
                {inspection?.state === 'reading' && <p role="status">Checking the original assignment and its receipt…</p>}
                {inspection?.state === 'unavailable' && <p role="status">The original response could not be verified. No assignment was repeated.</p>}
                {result && <div className="ops-zion-result">
                  <p role="status">{receiptLabels[result.receipt_state]}</p>
                  <p className="ops-view-muted">Inspected {at(result.observed_at)}</p>
                  {result.response_text !== null ? <details><summary><ChevronRight size={14} aria-hidden="true" />
                    Read original response{result.response_truncated ? ' (shortened)' : ''}</summary><p>{result.response_text}</p></details>
                    : <p>{result.recorded_status === 'pending' ? 'The original assignment is recorded as pending.'
                      : result.recorded_status === 'failed' ? 'The original assignment has a recorded failure.'
                        : result.recorded_status === 'dispatched' ? 'A handoff was recorded. Completion is not verified.'
                          : result.recorded_status === 'unknown' ? 'The original outcome is unknown. Inspect the same assignment before repeating work.'
                            : 'No readable original response was returned.'}</p>}
                  <p className="ops-view-muted">Business actions need their own work records and results.</p>
                  <details><summary><ChevronRight size={14} aria-hidden="true" />Original references</summary>
                    <dl><dt>Assignment</dt><dd><code>{result.id}</code></dd>
                      {result.receipt_state === 'verified' && <><dt>Receipt</dt><dd><code>{result.receipt_id}</code></dd><dt>Recorded</dt><dd>{at(result.receipt_at)}</dd></>}
                    </dl></details>
                </div>}
              </li>;
            })}</ul></>}
        <button type="button" className="ops-view-text-action" onClick={() => { void readSample(); }}><RotateCw size={14} aria-hidden="true" />Refresh sample</button>
      </>}
    </div>
  </section>;
}
