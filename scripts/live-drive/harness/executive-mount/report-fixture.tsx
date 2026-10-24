// Existing native reader/viewer with explicit synthetic read ports only.
// No backend, model, provider, save, approval, send or business execution.
import { PaigeArtifactCard } from '@/components/paige/chat/PaigeArtifactCard';
import { useLocation } from 'react-router-dom';
import { buildBusinessReviewEvidenceBlocks } from '../../../../supabase/functions/_shared/document-business-review-evidence';

const tenantId = 'e2000000-0000-4000-8000-000000000011';
const reportId = 'e2000000-0000-4000-8000-000000000081';
const title = 'Recorded business review';
const end = '2026-10-22T12:00:00Z', start = '2026-09-22T12:00:00Z';
async function originalBlocks() {
  const { blocks } = await buildBusinessReviewEvidenceBlocks({ version: 1, captured_at: end, measurements: [{
    metric_key: 'sales.cash.recorded_received', metric_version: '1.0.0', owner_department: 'sales',
    label: 'Recorded receipts', definition: 'Recorded receipts in the source period.', formula: 'SUM(recorded receipts)',
    unit: 'currency_minor', dimensions: {}, range: { key: 'month', start, end, bounds: '[start,end)', timezone: 'UTC', semantics: 'event_timestamp_cohort' },
    values: { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '20000', record_count: 1 },
      { currency: 'eur', amount_minor: '30000', record_count: 1 }], breakdown: [] },
    source_refs: ['public.paige_invoice_payments'], as_of: end, freshness: { queried_at: end, source_updated_through: null },
    coverage: { state: 'complete', candidate_count: 2, contributing_count: 2, excluded_count: 0 }, exclusions: [],
    truth_state: 'LIVE', caveats: ['Recorded receipts do not establish bank settlement. These values are synthetic rendering inputs.'],
    source_revision_ref: `sr_v1_${'a'.repeat(64)}`, evidence_ref: `aneb_v1_${'b'.repeat(64)}`, reference_expires_at: '2026-10-22T12:15:00Z',
  }] }, { tenantId, period: { key: 'month', start, end }, now: Date.parse('2026-10-22T12:01:00Z') });
  return [{ type: 'cover', title }, ...blocks];
}
export function reportFixtureFrom(table: string) {
  if (table !== 'marketing_content') throw Error('HARNESS_NO_BACKEND');
  const filters = new Map<string, unknown>();
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
    maybeSingle: async () => {
      if (filters.get('tenant_id') !== tenantId || filters.get('id') !== reportId) return { data: null, error: null };
      const state = new URLSearchParams(location.search).get('state');
      if (state === 'loading') return new Promise<never>(() => {}); // explicit held fixture, not a provider
      if (state === 'error') return { data: null, error: { code: '42501' } };
      if (state === 'empty' || state === 'member' || state === 'unavailable') return { data: null, error: null };
      return { data: { id: reportId, title, kind: 'document', body: JSON.stringify({ docType: 'business_review', title, blocks: await originalBlocks() }) }, error: null };
    },
  };
  return query;
}
export function ReportReadFixture() {
  const { search } = useLocation();
  const currentTenant = new URLSearchParams(search).get('workspace') === 'b' ? 'e2000000-0000-4000-8000-000000000012' : tenantId;
  return <section aria-label="Synthetic original report reader" style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <h1>Business review</h1><p>Synthetic render of the original artifact card and read-only document. No customer data or business action.</p>
    <PaigeArtifactCard artifact={{ id: reportId, title, artifactType: 'document' }} tenantId={currentTenant} />
  </section>;
}
