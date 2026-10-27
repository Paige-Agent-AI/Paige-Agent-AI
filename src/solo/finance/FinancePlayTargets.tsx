import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { routeLinkTarget } from '@/lib/links/workspaceLinks';
import { ExecutiveTargets } from '../ExecutiveTargets';
import type { useBusinessReview } from '../data/useBusinessReview';

/** One presentation of the original F7/Metric review, never another target reader. */
export function FinancePlayTargets({ review, tenantId, actorId, account, metricKeys }: {
  review: ReturnType<typeof useBusinessReview>;
  tenantId: string | null | undefined;
  actorId: string | null | undefined;
  account?: string | null;
  metricKeys: readonly string[];
}) {
  const heading = useId();
  const current = !!tenantId && !!actorId;
  const snapshot = current && review.state === 'ready' && review.snapshot.tenant_id === tenantId
    && review.snapshot.actor_id === actorId ? review.snapshot : null;
  const domain = snapshot?.requested.length === 1 && snapshot.requested[0] === 'game_plan'
    ? snapshot.domains.game_plan : undefined;
  const data = domain?.status === 'available' && Array.isArray(domain.data.mission_targets)
    && domain.data.mission_targets.every(row => row.target.tenant_id === tenantId && row.target.mission_id === row.mission.id)
    ? domain.data : null;
  // The original review samples at most six TOTAL targets. A filtered empty
  // sample never establishes that there are no saved financial targets.
  const targets = data?.mission_targets?.filter(row => metricKeys.includes(row.target.metric.key)
    && row.target.metric.value_kind === 'currency_totals') ?? [];
  const link = current ? routeLinkTarget({ destination: 'business_game_plan', record_id: null }, 'solo', account) : null;
  return <section className="finance-play-targets" aria-labelledby={heading}>
    <h2 id={heading}>Financial Play targets</h2>
    <p>Saved targets and issued actuals, separate from a company budget or cash forecast.</p>
    {!current ? <p role="status">Resolving the current workspace before reading targets…</p>
      : review.state === 'loading' ? <p role="status">Reading permitted Play targets…</p>
        : review.state === 'failed' ? <div role="alert"><p>Play targets could not be verified. No target or actual is inferred.</p><button onClick={review.refresh}>Retry target read</button></div>
          : !data ? <p>Financial targets are unavailable in this review. No target or actual is inferred.</p>
            : targets.length ? <ExecutiveTargets targets={targets} account={account} headingLevel={3}/>
              : <p>No financial targets were returned in this review sample. Other targets may exist.</p>}
    {data && <details className="exec-provenance"><summary>Source &amp; coverage</summary>
      <p>Only financial targets included in the current review sample appear here. Open Business Game Plan for all saved targets.</p>
      {data.coverage_note && <p>{data.coverage_note}</p>}
    </details>}
    {link ? <Link className="exec-link" to={link.to}>Open Business Game Plan<ArrowUpRight size={15} aria-hidden="true"/></Link>
      : <p>Resolve this workspace to open Business Game Plan.</p>}
  </section>;
}
