import { describe, expect, it } from 'vitest';
import { buildBusinessReviewEvidenceBlocks } from '../../supabase/functions/_shared/document-business-review-evidence';
import type { MetricResult } from '../../supabase/functions/_shared/analytics-metrics/metric-contract';

const asOf = '2026-10-22T12:00:00Z';
const context = { tenantId: 'a3400000-0000-4000-8000-000000000011', period: { key: 'month' as const, start: '2026-09-22T12:00:00Z', end: asOf }, now: Date.parse('2026-10-23T12:00:00Z') };
function metric(): Omit<MetricResult, 'account_epoch' | 'account_epoch_ref'> {
  return { metric_key: 'sales.cash.recorded_received', metric_version: '1.0.0', owner_department: 'sales', label: 'Recorded cash', definition: 'Recorded receipts in the source period.', formula: 'SUM(recorded receipts)',
    range: { key: 'month', start: context.period.start, end: asOf, bounds: '[start,end)', timezone: 'UTC', semantics: 'event_timestamp_cohort' }, dimensions: {},
    values: { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '20000', record_count: 1 }, { currency: 'eur', amount_minor: '30000', record_count: 1 }], breakdown: [] }, unit: 'currency_minor',
    source_refs: ['public.paige_invoice_payments'], as_of: asOf, freshness: { queried_at: asOf, source_updated_through: null }, coverage: { state: 'complete', candidate_count: 2, contributing_count: 2, excluded_count: 0 }, exclusions: [], truth_state: 'LIVE', caveats: ['Recorded receipts do not prove bank settlement.'],
    source_revision_ref: `sr_v1_${'a'.repeat(64)}`, evidence_ref: `aneb_v1_${'b'.repeat(64)}`, reference_expires_at: '2026-10-22T12:15:00Z' };
}
const capture = (item = metric()) => ({ version: 1, captured_at: asOf, measurements: [item] });
const text = (value: unknown) => JSON.stringify(value);

describe('original document historical business evidence', () => {
  it('keeps currencies separate and never renders a short-lived reference or private workspace identity', async () => {
    const source = capture(); const before = structuredClone(source);
    const result = await buildBusinessReviewEvidenceBlocks(source, context);
    expect(text(result.blocks)).toContain('USD 200.00'); expect(text(result.blocks)).toContain('EUR 300.00');
    expect(text(result.blocks)).not.toContain('500.00'); expect(text(result)).not.toMatch(/aneb_v1_|ae_v1_|a3400000/);
    expect(result.provenance[0].source_revision_ref).toBe(source.measurements[0].source_revision_ref);
    expect(text(result.blocks)).toContain('Historical business evidence'); expect(source).toEqual(before);
  });
  it('validates at capture time after a reference expires, without claiming a current metric read', async () => {
    const result = await buildBusinessReviewEvidenceBlocks(capture(), context);
    expect(text(result.blocks)).toContain('Read current business information again');
    const source = capture(); source.measurements[0].reference_expires_at = asOf;
    await expect(buildBusinessReviewEvidenceBlocks(source, context)).rejects.toThrow('EVIDENCE_INVALID');
  });
  it('preserves unavailable versus a verified zero and source caveats', async () => {
    const zero = metric(); zero.values = { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '0', record_count: 0 }], breakdown: [] };
    expect(text((await buildBusinessReviewEvidenceBlocks(capture(zero), context)).blocks)).toContain('USD 0.00');
    const absent = metric(); absent.values = null; absent.truth_state = 'UNAVAILABLE'; absent.coverage = { state: 'unavailable', candidate_count: 2, contributing_count: 0, excluded_count: 2 };
    absent.exclusions = [{ reason: 'Missing source evidence', count: 2 }];
    const result = await buildBusinessReviewEvidenceBlocks(capture(absent), context);
    expect(text(result.blocks)).toContain('Value unavailable'); expect(text(result.blocks)).not.toContain('USD 0.00');
    expect(text(result.blocks)).toContain('bank settlement'); expect(result.provenance[0].coverage).toEqual(absent.coverage);
  });
  it('retains exact large minor-unit values without converting them to rounded numbers', async () => {
    const source = metric(); source.values = { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '9007199254740993', record_count: 1 }], breakdown: [] };
    expect(text((await buildBusinessReviewEvidenceBlocks(capture(source), context)).blocks)).toContain('9007199254740993 minor units (exact)');
  });
  it('keeps point-in-time source semantics separate from the report window', async () => {
    const source = metric(); source.metric_key = 'sales.receivables.outstanding_current'; source.range.semantics = 'current_snapshot';
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), context);
    expect(text(result.blocks)).toContain('Snapshot observed at the source read'); expect(result.provenance[0].range.semantics).toBe('current_snapshot');
  });
  it('preserves an explicit quarter-to-date window without claiming a completed quarter', async () => {
    const source = metric(); source.range.key = 'quarter'; source.range.start = '2026-10-01T00:00:00Z';
    const quarter = { ...context, period: { key: 'quarter' as const, start: source.range.start, end: asOf } };
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), quarter);
    expect(text(result.blocks)).toContain('2026-10-01T00:00:00Z to 2026-10-22T12:00:00Z (exclusive)');
    expect(text(result.blocks)).not.toMatch(/completed quarter|2026-12-31/); expect(result.provenance[0].range.key).toBe('quarter');
  });
  it('preserves the original business calendar for current overdue measurements', async () => {
    const source = metric(); source.metric_key = 'sales.receivables.overdue_current'; source.metric_version = '1.1.0'; source.range.semantics = 'current_snapshot';
    source.source_refs.push('public.tenant_business_time_zones');
    source.business_time_zone = { state: 'configured', zone: 'UTC', set_at: '2026-10-01T00:00:00Z', as_of_date: '2026-10-22' };
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), context);
    expect(text(result.blocks)).toContain('Business date: 2026-10-22 (UTC)');
    expect(result.provenance[0].business_time_zone).toEqual(source.business_time_zone);
  });
  it('keeps partial-source exclusions and source categories without claiming settlement', async () => {
    const source = metric(); source.truth_state = 'PARTIAL'; source.coverage = { state: 'partial', candidate_count: 3, contributing_count: 2, excluded_count: 1 };
    source.exclusions = [{ reason: 'Unverified import', count: 1 }];
    if (source.values?.kind === 'currency_totals') source.values.breakdown = [{ currency: 'usd', source: 'human_recorded', amount_minor: '20000', record_count: 1 }];
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), context);
    expect(text(result.blocks)).toContain('Coverage: partial'); expect(text(result.blocks)).toContain('Unverified import: 1');
    expect(text(result.blocks)).toContain('human recorded: USD 200.00'); expect(text(result.blocks)).not.toContain('LIVE');
  });
  it('preserves all series observations beyond one original document list and missing values', async () => {
    const source = metric(); source.metric_key = 'ai.recorded_model_requests_daily'; source.owner_department = 'ai'; source.unit = 'count';
    source.values = { kind: 'series', points: Array.from({ length: 101 }, (_, index) => ({ at: new Date(Date.parse(context.period.start) + index * 3600000).toISOString(), value: index === 50 ? null : index })) };
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), context);
    const items = result.blocks.filter(block => block.type === 'list').flatMap(block => block.items as string[]);
    expect(items.filter(item => /^2026-/.test(item))).toHaveLength(101); expect(items).toContain('2026-09-24T14:00:00.000Z: Unavailable');
  });
  it('detaches provenance from mutable input and returns only known source fields', async () => {
    const source = capture(); Object.assign(source.measurements[0].range, { private_extra: 'omit-me' });
    const result = await buildBusinessReviewEvidenceBlocks(source, context);
    source.measurements[0].range.start = 'changed'; source.measurements[0].caveats.push('later mutation');
    expect(result.provenance[0].range.start).toBe(context.period.start); expect(text(result.provenance)).not.toMatch(/omit-me|later mutation/);
  });
  it('retains original failed-work observations and retries without claiming an executed fix', async () => {
    const source = metric(); source.metric_key = 'operations.recorded_workflow_activity'; source.owner_department = 'operations'; source.unit = 'events';
    source.coverage = { state: 'complete', candidate_count: 1, contributing_count: 1, excluded_count: 0 };
    source.values = { kind: 'diagnostic_events', items: [{ source: 'workflow_run', status: 'failed', at: '2026-10-21T12:00:00Z', completed_at: asOf, retry_count: 2, severity: null, check_key: null }] };
    const result = await buildBusinessReviewEvidenceBlocks(capture(source), context);
    expect(text(result.blocks)).toContain('workflow run · failed'); expect(text(result.blocks)).toContain('2 retries');
    expect(text(result.blocks)).toContain(`completed ${asOf}`); expect(text(result.blocks)).not.toMatch(/fixed|action completed/);
  });
  it.each(['wrong-period', 'unknown-metric', 'inconsistent-truth', 'expired-at-capture', 'future-capture', 'duplicate', 'private-identity', 'unsafe-count', 'future-source', 'oversize'])('refuses %s through original contract validation', async kind => {
    const source = capture();
    if (kind === 'wrong-period') source.measurements[0].range.start = '2026-09-01T00:00:00Z';
    if (kind === 'unknown-metric') source.measurements[0].metric_key = 'invented.profit';
    if (kind === 'inconsistent-truth') source.measurements[0].truth_state = 'UNAVAILABLE';
    if (kind === 'expired-at-capture') source.measurements[0].reference_expires_at = '2026-10-22T11:59:00Z';
    if (kind === 'future-capture') source.captured_at = '2026-10-24T12:00:00Z';
    if (kind === 'duplicate') source.measurements.push(structuredClone(source.measurements[0]));
    if (kind === 'private-identity') Object.assign(source.measurements[0], { account_epoch: context.tenantId });
    if (kind === 'unsafe-count') source.measurements[0].values = { kind: 'count', count: 9007199254740992 };
    if (kind === 'future-source') source.measurements[0].as_of = '2026-10-22T12:00:01Z';
    if (kind === 'oversize') source.measurements[0].caveats = ['x'.repeat(25000)];
    await expect(buildBusinessReviewEvidenceBlocks(source, context)).rejects.toThrow('EVIDENCE_INVALID');
  });
});
