import { Link } from 'react-router-dom';
import { routeLinkTarget } from '@/lib/links/workspaceLinks';
import type { useOwnerTaskAutomations } from './data/useOwnerTaskAutomations';
import type { OwnerTaskReview } from './data/ownerTaskAutomation';
import type { ActOutcome } from '../../supabase/functions/_shared/paige-orchestration/outcomes';

type Source = ReturnType<typeof useOwnerTaskAutomations>;
type Result = NonNullable<Extract<Source['history'], { status: 'ready' }>['outcome']>;
const when = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
}).format(new Date(value)) + ' UTC';
const approval = (value: string) => value === 'approved' ? 'Approved' : value === 'rejected' ? 'Declined'
  : value === 'pending' ? 'Awaiting approval' : 'Decision unavailable';
const outcomeLabels = {
  condition_not_matched:'Conditions did not match', held_by_lane:'Execution held', approval_pending:'Waiting for approval',
  refused_authority:'Access refused', refused_budget:'Budget limit reached', refused_trust_compass:'Permission limit reached',
  refused_consent:'Communication permission refused', accepted_for_execution:'Accepted for execution', retrying:'Recovery recorded',
  executed:'Execution recorded', failed:'Failure recorded', ambiguous:'Outcome uncertain', cancelled:'Cancelled',
} satisfies Record<ActOutcome,string>;
const outcomeWords = (value:string) => outcomeLabels[value as ActOutcome] ?? 'Recorded state unavailable';

function OriginalResult({ result, account, navigationHeld }: { result: Result; account: string | null; navigationHeld: boolean }) {
  const target = result.status === 'ready' && result.originalTask.state === 'verified'
    ? routeLinkTarget({ destination: 'operations_work', record_id: result.originalTask.taskId }, 'solo', account) : null;
  return <div className="sa-owner-task-result" role="status">
    {result.status === 'loading' ? <p className="sa-note">Reading the original result and receipt…</p>
      : result.status === 'refused' ? <p className="sa-note">This result is no longer available in your current workspace or role.</p>
        : result.status === 'unavailable' ? <p className="sa-note">The original outcome couldn’t be read. Select Inspect outcome to read it again; nothing will be rerun.</p>
          : result.status === 'ready' ? <>
            <h4>{result.title}</h4><p className="sa-note">{outcomeWords(result.recordedOutcome)} · Decision recorded: <time dateTime={result.decidedAt}>{when(result.decidedAt)}</time></p>
            {result.originalTask.state === 'verified' ? <>
              <p className="sa-note">Original task creation is verified against its saved result and receipt. Open the task to read its current state.</p>
              <details className="sa-owner-task-evidence">
                <summary>Original task evidence</summary>
                <dl>
                  <dt>Task</dt><dd>{result.originalTask.taskId}</dd>
                  <dt>Creation receipt</dt><dd>{result.originalTask.receiptId}</dd>
                  <dt>Execution</dt><dd>{result.originalTask.runId}</dd>
                  <dt>Approval</dt><dd>{result.approvalId}</dd>
                  <dt>Process</dt><dd>{result.processId}</dd>
                  <dt>Attempt</dt><dd>{result.occurrenceId}</dd>
                </dl>
              </details>
              {target?.status === 'exact' && (navigationHeld ? <p className="sa-note">Finish or cancel your pipeline rule edit before opening the task.</p>
                : <Link className="sa-ctl" to={target.to}>{target.label}</Link>)}
            </> : <p className="sa-note">The original task could not be verified. A recorded status alone does not establish that a task was created. Nothing will be rerun here.</p>}
          </> : null}
  </div>;
}

/** Presentation only. The original reader owns authority and proof. */
export function OwnerTaskProcessHistory({ source, review, account, id, close, navigationHeld = false }: {
  source: Source; review: OwnerTaskReview; account: string | null; id: string; close: () => void; navigationHeld?: boolean;
}) {
  const history = source.history;
  if (source.busy || source.needsRefresh || history.status === 'closed' || history.processId !== review.id) return null;
  return <section className="sa-owner-task-history sa-editor" id={id} aria-label="Process history"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="sa-field"><div className="sa-rule-controls"><h4>Original attempts</h4>
      <button type="button" className="sa-ctl" onClick={close}>Close history</button></div>
      <p className="sa-note">Read the original approval and result. Inspecting history does not run this process.</p></div>
    {history.status === 'loading' ? <p className="sa-field sa-note" role="status">Reading original attempts…</p>
      : history.status === 'refused' ? <div className="sa-field" role="status"><p className="sa-note">Your workspace or access changed. Refresh this workspace to inspect its history.</p></div>
        : history.status === 'unavailable' ? <div className="sa-field" role="status"><p className="sa-note">History couldn’t be read.</p>
          <button className="sa-ctl" type="button" onClick={() => void source.openHistory(review)}>Read history again</button></div>
          : history.status === 'ready' ? <>
            {!history.list.items.length && <p className="sa-field sa-note">{history.list.hasMore
              ? 'No attempt was returned in this page. Older attempts may not be shown.' : 'No recorded attempts were found for this process.'}</p>}
            <ol className="sa-owner-task-attempts">{history.list.items.map((item, index) => <li key={item.approvalId} className="sa-field">
              <p className="sa-note" id={id+'-attempt-'+index}>{approval(item.approvalStatus)} · Updated {when(item.updatedAt)}</p>
              <button type="button" className="sa-ctl" aria-describedby={id+'-attempt-'+index}
                aria-pressed={history.selected === item} onClick={() => void source.inspectOutcome(item)}>Inspect outcome</button>
              {history.selected === item && history.outcome && <OriginalResult result={history.outcome} account={account} navigationHeld={navigationHeld}/>}
            </li>)}</ol>
            {history.list.items.length > 0 && history.list.hasMore && <p className="sa-field sa-note">Showing {history.list.items.length} recent {history.list.items.length === 1 ? 'attempt' : 'attempts'}. Older attempts may not be shown.</p>}
          </> : null}
  </section>;
}
