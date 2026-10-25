import type { FinanceReviewEvidence } from '../../supabase/functions/_shared/finance/business-review-evidence';
import { formatFinanceSourceAmount } from '../../supabase/functions/_shared/finance/business-review-evidence';
import { formatReviewInstant } from './executive-review';

/** Same closed Finance facts as PAIGE's review. No totals or provider requests in the UI. */
export function ExecutiveFinanceEvidence({ evidence, timezone, accountHeadingLevel = 4 }: { evidence: FinanceReviewEvidence; timezone: string; accountHeadingLevel?: 3 | 4 }) {
  const AccountHeading = accountHeadingLevel === 3 ? 'h3' : 'h4';
  return <section className="exec-finance-evidence" aria-label="Financial source snapshots">
    {!evidence.sources.length ? <p className="exec-note">Financial figures are unavailable; this does not mean a zero balance. Review source setup in Finance.</p>
      : <p className="exec-note">Showing {evidence.sources.length} of {evidence.eligible_sources} eligible sources. Companies, accounts and currencies stay separate; credit is not cash.</p>}
    {evidence.sources.map(source => <details className="exec-provenance exec-finance-source" key={source.binding_id}>
      <summary>{source.company_label}<small>{source.provider === 'plaid' ? 'Plaid' : 'QuickBooks'} · {source.state === 'available' ? 'Recorded source facts' : 'Source snapshot unavailable'}</small></summary>
      {source.state === 'unavailable' ? <p className="exec-note">Source snapshot unavailable. No amount is inferred. Inspect the source in Finance.</p> : <>
        <p className="exec-note">{source.coverage === 'complete' ? 'Complete source snapshot' : 'Partial source snapshot'} · Showing {source.accounts.length} of {source.accounts_count} source accounts. Institution freshness is unverified.</p>
        <dl>
          <div><dt>Source observed</dt><dd>{formatReviewInstant(source.source_observed_at, timezone, true)} · {timezone}</dd></div>
          <div><dt>Synchronized</dt><dd>{formatReviewInstant(source.synchronized_at, timezone, true)} · {timezone}</dd></div>
        </dl>
        {!source.accounts.length && <p className="exec-note">No account figures returned; no balance is inferred.</p>}
        {source.accounts.map(account => <section className="exec-finance-account" key={account.native_id} aria-label={account.label}>
          <AccountHeading>{account.label}</AccountHeading>{account.product && <p className="exec-note">Source product: {account.product}</p>}
          <dl className="exec-figures">
            <div><dt>Source balance</dt><dd>{formatFinanceSourceAmount(account.current_balance, account.currency)}</dd></div>
            <div><dt>Available cash</dt><dd>{formatFinanceSourceAmount(account.available_cash, account.currency)}</dd></div>
            <div><dt>Available credit</dt><dd>{formatFinanceSourceAmount(account.available_credit, account.currency)}</dd></div>
            <div><dt>Credit limit</dt><dd>{formatFinanceSourceAmount(account.credit_limit, account.currency)}</dd></div>
          </dl>
          {!account.currency && <p className="exec-note">Currency is unavailable, so monetary values cannot be verified for display.</p>}
        </section>)}
        <dl className="exec-finance-references">
          <div><dt>Company / source revisions</dt><dd>{source.company_version} / {source.binding_revision}</dd></div>
          <div><dt>Snapshot revision</dt><dd>{source.snapshot_version}</dd></div>
          <div><dt>Source observation</dt><dd>{source.observation_id}</dd></div>
          <div><dt>Source receipt reference</dt><dd>{source.receipt_run_id}</dd></div>
        </dl>
        <p className="exec-note">Source observations are not proof PAIGE executed work. No company-wide balance, profit or forecast is calculated here.</p>
      </>}
    </details>)}
  </section>;
}
