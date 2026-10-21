import { useLayoutEffect, useRef } from 'react';
import { ArrowUpRight, RefreshCw, Sparkles } from 'lucide-react';
import { useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { useBusinessReview } from '../data/useBusinessReview';
import { formatReviewInstant } from '../executive-review';
import { routeLinkTarget } from '@/lib/links/workspaceLinks';
import { handOffPaigePrompt } from '@/lib/paigePromptHandoff';
import { clearPaigeClientScope } from '../paigeClientScope';
import { clearPaigePublicPresenceScope } from '../paigePublicPresenceScope';
import './operations-recorded-findings.css';

const RETURN_FOCUS = 'exp05RecordedFindingsReturn';
const readPrompt = 'Review the current recorded Operations findings in this workspace. Read the authorized Operations business snapshot again. Distinguish Systems Check findings from recorded automation-run outcomes and native blocked or overdue Work. Keep missing evidence unknown, explain source time and coverage, and prepare bounded next steps for my review. Do not run checks, create work, change settings or execute an action.';
const historyRecord = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ? value as Record<string, unknown> : null;

/** One canonical focused read. Findings are not native Work status or action receipts. */
export function OperationsRecordedFindings({ tenantId, userId, openPaige, canLeave }: {
  tenantId: string; userId: string; openPaige?: () => void; canLeave: () => boolean;
}) {
  const review = useBusinessReview(tenantId, 'last_7_days', { focus: ['operations'], actorId: userId });
  const navigate = useNavigate(), location = useLocation(), navigationType = useNavigationType();
  const { account } = useParams();
  const heading = useRef<HTMLHeadingElement>(null);
  const state = historyRecord(location.state), focusScope = `${userId}:${tenantId}`;
  const target = routeLinkTarget({ destination: 'systems_check', record_id: null }, 'solo', account);
  const snapshot = review.state === 'ready' ? review.snapshot : null;
  const domain = snapshot?.domains.operations;
  const data = domain?.status === 'available' ? domain.data : null;
  const windowNotes = [...new Set(data?.headline.flatMap(metric => metric.window_note ? [metric.window_note] : []) ?? [])];

  useLayoutEffect(() => {
    if (navigationType !== 'POP' || state?.[RETURN_FOCUS] !== focusScope) return;
    heading.current?.focus();
    const next = { ...state }; delete next[RETURN_FOCUS];
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: next });
  }, [navigationType, state, focusScope, navigate, location.pathname, location.search, location.hash]);

  function openSource() {
    if (!target || !canLeave()) return;
    // Preserve existing history state; unknown legacy state is left untouched.
    // This marker restores UI focus only and carries no record or execution authority.
    if (location.state == null || state) navigate({ pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: { ...state, [RETURN_FOCUS]: focusScope } });
    navigate(target.to);
  }
  function prepareReview() {
    if (!data || !openPaige) return;
    clearPaigeClientScope(); clearPaigePublicPresenceScope();
    handOffPaigePrompt(readPrompt); openPaige();
  }

  return <section className="ops-recorded-findings" aria-labelledby="recorded-findings-heading">
    <header><div><h2 id="recorded-findings-heading" tabIndex={-1} ref={heading}>Recorded Operations findings</h2>
      <p>Separate from blocked or overdue Work.</p></div>
      <button type="button" className="ops-findings-icon" aria-label="Refresh recorded Operations findings"
        disabled={review.state === 'loading'} onClick={review.refresh}><RefreshCw size={17} aria-hidden="true" /></button>
    </header>
    {review.state === 'loading' ? <p role="status">Reading recorded Operations findings…</p>
      : !data || !snapshot ? <div role="status"><p>{review.state === 'failed' ? review.message : 'Recorded Operations findings could not be read for this workspace.'}</p>
        <button type="button" className="ops-findings-action" onClick={review.refresh}>Try reading again</button></div>
        : <>
          <div className="ops-findings-source-time"><span>Read {formatReviewInstant(snapshot.composed_at, snapshot.period.timezone, true)} · {snapshot.period.timezone}</span>
            <span>{data.coverage === 'partial' ? 'Partial source coverage' : 'Source coverage reported complete'}</span></div>
          {windowNotes.length > 0 && <div className="ops-findings-note" aria-label="Original source windows">{windowNotes.map(note => <p key={note}>{note}</p>)}</div>}
          {data.risks.length ? <ul>{data.risks.map((risk, index) => {
            const runs = risk.kind === 'automation_runs_failed';
            return <li key={`${risk.kind}:${index}`}><div className="ops-findings-row">
              <strong>{runs ? 'Recorded automation runs' : risk.kind.startsWith('systems_check_') ? 'Systems Check' : 'Recorded Operations'}</strong>
              <span>{risk.severity === 'act' ? 'Needs review' : risk.severity === 'watch' ? 'Watch' : 'Recorded'}</span></div>
              <p>{risk.summary}</p>
              {runs && <p className="ops-findings-note">Recorded run totals · {snapshot.period.label}. Individual runs aren’t available here.</p>}
            </li>;
          })}</ul> : <p>No findings were returned in this review. This does not confirm that every business area was checked.</p>}
          {data.coverage_note && <p className="ops-findings-note">{data.coverage_note}</p>}
          <div className="ops-findings-actions">{target && <button type="button" className="ops-findings-action" onClick={openSource}>
            {target.label}<ArrowUpRight size={15} aria-hidden="true" /></button>}
            {openPaige && <button type="button" className="ops-findings-action" onClick={prepareReview}><Sparkles size={15} aria-hidden="true" />Prepare a read-only PAIGE review</button>}
          </div>
        </>}
  </section>;
}
