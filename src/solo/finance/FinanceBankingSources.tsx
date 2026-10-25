import type { BusinessReviewState } from '../data/useBusinessReview';
import { ExecutiveFinanceEvidence } from '../ExecutiveFinanceEvidence';

/** The originating Finance view of the same validated review; no second source read. */
export function FinanceBankingSources({ review, tenantId, onRetry, onIntegrations }: {
  review: BusinessReviewState;
  tenantId: string | null | undefined;
  onRetry: () => void;
  onIntegrations: () => void;
}) {
  const domain = review.state === 'ready' ? review.snapshot.domains.finance : undefined;
  const evidence = domain?.status === 'available' && tenantId
    && domain.data.finance_evidence?.tenant_id === tenantId ? domain.data.finance_evidence : null;
  return <section className="finance-banking-sources" aria-label="Company financial sources">
    <h2>Company accounts</h2>
    {review.state === 'loading' ? <p role="status">Reading permitted financial source snapshots…</p>
      : review.state === 'failed' ? <div role="alert"><p>Financial sources could not be read. No balance is inferred.</p><button onClick={onRetry}>Retry financial sources</button></div>
        : evidence ? <ExecutiveFinanceEvidence evidence={evidence} timezone={review.snapshot.period.timezone} accountHeadingLevel={3} />
          : <p>No source details returned; unavailable does not mean a zero balance. Refresh or review source connections.</p>}
    <button onClick={onIntegrations}>Review source connections</button>
  </section>;
}
