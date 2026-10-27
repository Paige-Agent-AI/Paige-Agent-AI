/** Original Marketing email counts through the sole Metric/Evidence issuer. */
import { readBusinessMetricEvidence, type MetricCaller } from '../../analytics-metrics/read.ts';
import { contextDegraded, contextUnavailable } from '../mod.ts';
import type { DomainSnapshotAdapter } from '../snapshot.ts';
import { countFigure, emptyIssuerDraft, finishIssuerSnapshot, interpretIssuerMetric, issuerMetricWindow,
  ISSUER_METRIC_REASON, ISSUER_NOTE, noteIssuerSource, pushIssuerHeadline } from './issuer-metric.ts';

const METRICS = [
  ['marketing.email.sent', 'sent', 'Campaign emails sent', 'in_period'],
  ['marketing.email.opened', 'opened', 'Sent emails with a tracked open', 'point_in_time'],
  ['marketing.email.clicked', 'clicked', 'Sent emails with a tracked click', 'point_in_time'],
] as const;

export function createEmailCampaignSnapshotAdapter(caller: MetricCaller,
  scope: { readonly tenantId: string | null }, clock: () => number = Date.now): DomainSnapshotAdapter {
  return { domain: 'email', owner: 'marketing', async read(ctx) {
    const tenantId = scope.tenantId;
    if (ctx.identity.tenantId !== tenantId) return contextDegraded(ISSUER_METRIC_REASON.scopeMismatch);
    const window = issuerMetricWindow(ctx.period, ctx.now);
    if (!window) return contextDegraded(ISSUER_METRIC_REASON.windowUnreadable);
    const draft = emptyIssuerDraft();
    // Keep the critical definition FIRST inside the existing bounded note.
    draft.notes.push('Recorded sends in this period; not delivery confirmations. Later opens/clicks for these sends only. Own-mail tracking is excluded. Image loads do not prove reading. No rates, retention or revenue inferred.');
    for (const [metricKey, key, label, basis] of METRICS) {
      if (ctx.signal?.aborted) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const outcome = await readBusinessMetricEvidence(caller, { tenantId }, {
        metric_key: metricKey, period: 'custom', range_key: window.range_key,
        range_start: window.range_start, range_end: window.range_end,
      }, clock);
      if (ctx.signal?.aborted) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      if (outcome.status === 'refused') {
        const refused = contextUnavailable(ISSUER_METRIC_REASON.refused);
        return { status: refused.status, reason: refused.reason, data: null };
      }
      const interpreted = interpretIssuerMetric({ ...outcome,
        message: outcome.status === 'available' ? 'Verified source evidence.' : outcome.message },
      { kind: 'count', ownerDepartment: 'marketing' });
      const value = 'failure' in interpreted ? null : countFigure(interpreted.metric);
      if ('failure' in interpreted || value === null) {
        draft.failures.push({ reason: 'failure' in interpreted ? interpreted.failure : ISSUER_METRIC_REASON.shapeUnexpected, headline: true });
        draft.notes.push(ISSUER_NOTE.failed(label)); continue;
      }
      draft.headlineReads++;
      noteIssuerSource(draft, 'email.marketing_campaigns.v1', interpreted.metric, 'marketing');
      const note = key === 'opened' ? 'For these sends, through this read. An image load is not a read receipt.'
        : key === 'clicked' ? 'For these sends, through this read. Not unique people or a conversion.' : window.window_note;
      pushIssuerHeadline(draft, { key: `email.${key}`, label, value, unit: 'count', basis,
        ...(note ? { window_note: note } : {}) }, label);
      if (interpreted.partial) draft.notes.push(ISSUER_NOTE.partial(label));
    }
    return finishIssuerSnapshot(draft, { domain: 'email', owner: 'marketing', period: ctx.period, now: ctx.now });
  } };
}
