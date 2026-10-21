/** Existing Marketing1.0.0 intake evidence; no producer, provider or metric arithmetic. */
import { readBusinessMetricEvidence, type MetricCaller } from '../../analytics-metrics/read.ts';
import { contextDegraded, contextUnavailable, type ContextSourceResult } from '../mod.ts';
import type { DomainSnapshot, DomainSnapshotAdapter, SnapshotMetric } from '../snapshot.ts';
import {
  countFigure, emptyIssuerDraft, finishIssuerSnapshot, interpretIssuerMetric,
  issuerMetricWindow, ISSUER_METRIC_REASON, ISSUER_NOTE, noteIssuerSource, pushIssuerHeadline,
  type IssuerMetric, type IssuerValueKind,
} from './issuer-metric.ts';

export const MARKETING_INTAKE_ADAPTER_ID = 'campaigns.marketing_intake.v1';
export const MARKETING_INTAKE_METRICS = {
  received: 'marketing.leads.received',
  linked: 'marketing.leads.converted_to_opportunity',
  sourceTags: 'marketing.leads.by_utm_source',
  campaignTags: 'marketing.leads.by_campaign_tag',
  unrouted: 'marketing.forms.unrouted_current',
  processing: 'marketing.submissions.failed_current',
} as const;

/** Returns only a producer-reported bucket. Complete grouping can truthfully omit an empty bucket. */
function bucket(metric: IssuerMetric, key: string, partial: boolean): number | null {
  if (metric.values?.kind !== 'distribution') return null;
  const found = metric.values.items.find(row => row.key === key);
  return found?.count ?? (partial ? null : 0);
}

export function createMarketingIntakeSnapshotAdapter(
  caller: MetricCaller,
  scope: { readonly tenantId: string | null },
  clock: () => number = Date.now,
): DomainSnapshotAdapter {
  return {
    domain: 'campaigns', owner: 'marketing',
    async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
      const tenantId = scope.tenantId;
      if (ctx.identity.tenantId !== tenantId) return contextDegraded(ISSUER_METRIC_REASON.scopeMismatch);
      const window = issuerMetricWindow(ctx.period, ctx.now);
      if (!window) return contextDegraded(ISSUER_METRIC_REASON.windowUnreadable);
      const draft = emptyIssuerDraft();
      const specs = [
        ['received', 'count', 'Leads received (form submissions)', 'in_period'],
        ['linked', 'count', 'Leads linked to an opportunity', 'in_period'],
        ['sourceTags', 'distribution', 'Leads without a source tag', 'in_period'],
        ['campaignTags', 'distribution', 'Leads without a campaign tag', 'in_period'],
        ['unrouted', 'count', 'Live forms without a pipeline route', 'point_in_time'],
        ['processing', 'distribution', 'Submission processing', 'point_in_time'],
      ] as const;
      for (const [name, kind, label, basis] of specs) {
        if (ctx.signal?.aborted) return contextDegraded(ISSUER_METRIC_REASON.aborted);
        // Reuse the sole internal issuer/resolver cycle. The public33-key tool is not widened.
        const outcome = await readBusinessMetricEvidence(caller, { tenantId }, {
          metric_key: MARKETING_INTAKE_METRICS[name], period: 'custom',
          range_key: window.range_key, range_start: window.range_start, range_end: window.range_end,
        }, clock);
        if (ctx.signal?.aborted) return contextDegraded(ISSUER_METRIC_REASON.aborted);
        if (outcome.status === 'refused') return contextUnavailable(ISSUER_METRIC_REASON.refused);
        // The shared interpreter consumes status/metric; the internal evidence result
        // omits the public tool's message. This compatibility text is never projected.
        const result = interpretIssuerMetric({ ...outcome, message: outcome.status === 'available' ? 'Verified source evidence.' : outcome.message },
          { kind: kind as IssuerValueKind, ownerDepartment: 'marketing' });
        if ('failure' in result) {
          draft.failures.push({ reason: result.failure, headline: true });
          draft.notes.push(ISSUER_NOTE.failed(label));
          continue;
        }
        const { metric, partial } = result;
        let figures: readonly [string, string, number | null][];
        if (name === 'processing') {
          // The original producer always emits BOTH closed buckets, including real zeros.
          // A missing/unknown bucket is a changed contract, never an invented zero.
          const items = metric.values?.kind === 'distribution' ? metric.values.items : [];
          figures = items.length === 2 && items.every(row => row.key === 'failed' || row.key === 'stalled')
            ? [['failed', 'Submissions with processing errors now', bucket(metric, 'failed', true)],
              ['stalled', 'Submissions waiting over 15 minutes now', bucket(metric, 'stalled', true)]] : [];
        } else {
          const tagItems = metric.values?.kind === 'distribution' ? metric.values.items : [];
          const tagsValid = name !== 'sourceTags' && name !== 'campaignTags' || tagItems.every(row =>
            row.key === '_untagged' || row.key === '_other' || (name === 'sourceTags' ? row.key.startsWith('src:') : /^(brief:|tag:)/.test(row.key)));
          const key = name === 'sourceTags' ? 'leads_without_source_tag' : name === 'campaignTags' ? 'leads_without_campaign_tag' : name;
          figures = [[key, label, !tagsValid ? null : kind === 'count' ? countFigure(metric) : bucket(metric, '_untagged', partial)]];
        }
        if (!figures.length || figures.some(([, , value]) => value === null)) {
          draft.failures.push({ reason: ISSUER_METRIC_REASON.shapeUnexpected, headline: true });
          draft.notes.push(ISSUER_NOTE.failed(label));
          continue;
        }
        draft.headlineReads += 1;
        noteIssuerSource(draft, MARKETING_INTAKE_ADAPTER_ID, metric, 'marketing');
        for (const [key, title, value] of figures) {
          const figure: SnapshotMetric = { key: `campaigns.${key}`, label: title, value, unit: 'count', basis,
            ...(basis === 'in_period' && window.window_note ? { window_note: window.window_note } : {}) };
          pushIssuerHeadline(draft, figure, title);
          if (value !== null && value > 0 && (key === 'failed' || key === 'stalled' || key === 'unrouted')) {
            draft.risks.push({ kind: `marketing_${key}`, figure_key: figure.key,
              summary: `${value} ${title.toLowerCase()}. Review the existing Marketing records; no correction has run.`,
              severity: key === 'failed' ? 'act' : 'watch' });
          }
        }
        if (partial) draft.notes.push(ISSUER_NOTE.partial(label));
      }
      // Leads are submissions, not visitors or won clients. Tags are recorded labels, not causal attribution.
      draft.notes.unshift('Recorded intake only: no visits, ad spend, revenue, full funnel or causal attribution');
      return finishIssuerSnapshot(draft, { domain: 'campaigns', owner: 'marketing', period: ctx.period, now: ctx.now });
    },
  };
}
