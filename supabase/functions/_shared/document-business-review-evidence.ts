/**
 * Existing document blocks for an original native work's historical Metric capture.
 * Structure validation is not authorization: only a future original document
 * writer/worker may supply its immutable, server-captured evidence here. No reads,
 * calculations, model calls, persistence, capability or authority are introduced.
 * A binding must revalidate current Metric authority at claim and completion,
 * including report-specific owner/admin rules beyond generic document roles.
 */
import { BUSINESS_METRIC_KEYS, MARKETING_METRIC_KEYS } from './analytics-metrics/keys.ts';
import { currentMetricVersion, parseMetricResult, type MetricResult } from './analytics-metrics/metric-contract.ts';
import { normalizeDocumentBlock } from './document-production.ts';
import { formatCurrencyMinor } from './paige-context/snapshot.ts';

type Block = Record<string, unknown>;
type RecordValue = Record<string, unknown>;
type DocumentMetricProvenance = Pick<MetricResult,
  'metric_key' | 'metric_version' | 'source_revision_ref' | 'source_refs' | 'as_of' |
  'range' | 'freshness' | 'coverage' | 'exclusions' | 'caveats' | 'business_time_zone'>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const stamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new Error('DOCUMENT_OUTPUT_EVIDENCE_INVALID'); };
const metricKeys: readonly string[] = [...BUSINESS_METRIC_KEYS, ...MARKETING_METRIC_KEYS];
const basis: Record<string, string> = {
  current_snapshot: 'Snapshot observed at the source read.',
  event_timestamp_cohort: 'Recorded events in the source period.',
  current_status_date_cohort: 'Current statuses of records dated in this period.',
  source_readiness: 'Source readiness observed at the source read.',
};
const money = (amount: string, currency: string): string => Number.isSafeInteger(Number(amount))
  ? formatCurrencyMinor(Number(amount), currency.toUpperCase()) : `${currency.toUpperCase()} ${amount} minor units (exact)`;

function valueBlocks(metric: MetricResult): Block[] {
  const value = metric.values;
  if (!value) return [{ type: 'callout', body: 'Value unavailable in this source capture.', variant: 'warning' }];
  if (value.kind === 'count') return [{ type: 'stat', value: String(value.count), label: metric.label }];
  if (value.kind === 'decimal') return [{ type: 'stat', value: value.value, label: `${metric.label} · ${metric.unit}` }];
  if (value.kind === 'currency_totals') {
    const blocks: Block[] = value.by_currency.length
      ? value.by_currency.map(row => ({ type: 'stat', label: `${metric.label} · ${row.record_count} records`, value: money(row.amount_minor, row.currency) }))
      : [{ type: 'prose', markdown: 'No currency totals were returned. No amount is inferred.' }];
    if (value.breakdown.length) blocks.push({ type: 'list', items: value.breakdown.map(row => `${row.source.replace(/_/g, ' ')}: ${money(row.amount_minor, row.currency)} · ${row.record_count} records`) });
    return blocks;
  }
  const items = value.kind === 'distribution' ? value.items.map(row => `${row.label}: ${row.count}`)
    : value.kind === 'series' ? value.points.map(point => `${point.at}: ${point.value === null ? 'Unavailable' : point.value}`)
      : value.items.map(event => [event.source.replace(/_/g, ' '), event.status,
        ...(event.severity ? [event.severity] : []), event.at,
        ...(event.retry_count !== null ? [`${event.retry_count} retries`] : []),
        ...(event.completed_at ? [`completed ${event.completed_at}`] : []),
        ...(event.check_key ? [event.check_key.replace(/_/g, ' ')] : [])].join(' · '));
  if (!items.length) return [{ type: 'prose', markdown: 'No observations were returned for this measurement.' }];
  // Original document lists accept100 items. Keep every original observation.
  const blocks: Block[] = [];
  for (let index = 0; index < items.length; index += 100) blocks.push({ type: 'list', items: items.slice(index, index + 100) });
  return blocks;
}

export async function buildBusinessReviewEvidenceBlocks(capture: unknown, context: {
  tenantId: string;
  period: { key: 'month' | 'quarter'; start: string; end: string };
  now?: number;
}): Promise<{ blocks: Block[]; provenance: DocumentMetricProvenance[] }> {
  const now = context.now ?? Date.now();
  if (!record(capture) || Object.keys(capture).some(key => !['version', 'captured_at', 'measurements'].includes(key))
    || capture.version !== 1 || !stamp(capture.captured_at) || !Number.isFinite(now) || Date.parse(capture.captured_at) > now + 30_000
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.tenantId)
    || !['month', 'quarter'].includes(context.period.key) || !stamp(context.period.start) || !stamp(context.period.end)
    || !Array.isArray(capture.measurements) || !capture.measurements.length || capture.measurements.length > 12) return invalid();
  try { if (new TextEncoder().encode(JSON.stringify(capture)).byteLength > 24576) return invalid(); } catch { return invalid(); }
  // Rehydrate only the private identity fields omitted by the native capture,
  // using the ORIGINAL work tenant. This digest is not an authorization token.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context.tenantId));
  const epochRef = `ae_v1_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const capturedAt = Date.parse(capture.captured_at);
  const seen = new Set<string>();
  const metrics: MetricResult[] = [];
  for (const item of capture.measurements) {
    if (!record(item) || typeof item.metric_key !== 'string' || !metricKeys.includes(item.metric_key)
      || 'account_epoch' in item || 'account_epoch_ref' in item || typeof item.evidence_ref !== 'string'
      || seen.has(item.evidence_ref)) return invalid();
    seen.add(item.evidence_ref);
    try {
      const metric = parseMetricResult({ ...item, account_epoch: context.tenantId, account_epoch_ref: epochRef }, {
        metricKey: item.metric_key, metricVersion: currentMetricVersion(item.metric_key), accountEpoch: context.tenantId,
        rangeKey: context.period.key, rangeStart: context.period.start, rangeEnd: context.period.end, dimensions: {},
      }, capturedAt);
      if (Date.parse(metric.as_of) > capturedAt) return invalid();
      metrics.push(metric);
    } catch { return invalid(); }
  }
  const blocks: Block[] = [{ type: 'callout', body: `Historical business evidence captured ${capture.captured_at}. Read current business information again before a new decision.`, variant: 'definition' }];
  const provenance = metrics.map(metric => {
    blocks.push({ type: 'section-header', title: metric.label });
    blocks.push(...valueBlocks(metric));
    blocks.push({ type: 'prose', markdown: [metric.definition, `Calculation: ${metric.formula}`,
      `Source period: ${metric.range.start} to ${metric.range.end} (exclusive), UTC.`, basis[metric.range.semantics],
      ...(metric.business_time_zone ? [metric.business_time_zone.state === 'configured' ? `Business date: ${metric.business_time_zone.as_of_date} (${metric.business_time_zone.zone}).` : 'Business calendar unavailable.'] : []),
      `As of ${metric.as_of}. ${metric.freshness.source_updated_through ? `Latest recorded source update: ${metric.freshness.source_updated_through}.` : 'Source update time unavailable.'} Coverage: ${metric.coverage.state}; ${metric.coverage.contributing_count} contributing of ${metric.coverage.candidate_count} candidates; ${metric.coverage.excluded_count} excluded.`].join('\n\n') });
    const notes = [...metric.caveats, ...metric.exclusions.map(row => `${row.reason}: ${row.count}`)];
    if (notes.length) blocks.push({ type: 'list', items: notes });
    const { metric_key, metric_version, source_revision_ref, source_refs, as_of, range, freshness, coverage, exclusions, caveats } = metric;
    return { metric_key, metric_version, source_revision_ref, source_refs: [...source_refs], as_of,
      range: { key: range.key, start: range.start, end: range.end, bounds: range.bounds, timezone: range.timezone, semantics: range.semantics },
      freshness: { queried_at: freshness.queried_at, source_updated_through: freshness.source_updated_through },
      coverage: { state: coverage.state, candidate_count: coverage.candidate_count, contributing_count: coverage.contributing_count, excluded_count: coverage.excluded_count, ...(coverage.reason ? { reason: coverage.reason } : {}) },
      exclusions: exclusions.map(({ reason, count }) => ({ reason, count })), caveats: [...caveats],
      ...(metric.business_time_zone ? { business_time_zone: { state: metric.business_time_zone.state, zone: metric.business_time_zone.zone, set_at: metric.business_time_zone.set_at, as_of_date: metric.business_time_zone.as_of_date } } : {}) };
  });
  // Reserve room for the existing document cover/intro and reject lossy output.
  if (blocks.length > 77) return invalid();
  for (const block of blocks) {
    const normalized = normalizeDocumentBlock(block);
    if (!normalized || Object.keys(block).some(key => JSON.stringify(normalized[key]) !== JSON.stringify(block[key]))) return invalid();
  }
  return { blocks, provenance };
}
