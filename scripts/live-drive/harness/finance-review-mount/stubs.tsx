import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import { SECOND_REVIEW_TENANT, withTargetAndFinanceFixtures } from '../executive-mount/slice-fixtures';
import type { SalesMetricBundle, SalesPerformancePhase } from '@/solo/sales/performance/types';

// Synthetic inputs only. All backend calls are refused by the existing shell stub.
function useHarnessParams() {
  const current = useLocation();
  // A fixture input, not application authority. Canonical tab navigation omits
  // query parameters; keep this synthetic context stable until a full reload.
  const [params] = useState(() => new URLSearchParams(current.search));
  return params;
}
const noop = () => {};
// Render inputs only: these references cannot resolve against any real reader.
function syntheticMetric(metric_key: string, amount_minor: string): SalesMetricBundle {
  return {
    metric_key, metric_version: 'synthetic-only', owner_department: 'sales',
    label: 'Synthetic recorded amount', definition: 'Illustrative layout input; no business source.',
    formula: 'Synthetic fixture, not a calculation', unit: 'currency_minor',
    range: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z', bounds: '[start,end)', timezone: 'UTC', semantics: 'synthetic_fixture' },
    dimensions: {}, values: { kind: 'currency_totals', by_currency: [{ currency: 'USD', amount_minor, record_count: 3 }],
      breakdown: metric_key === 'sales.cash.recorded_received' ? [
        { source: 'human_recorded', currency: 'USD', amount_minor: '1800000', record_count: 2 },
        { source: 'owner_imported_unverified', currency: 'USD', amount_minor: '720000', record_count: 1 },
      ] : [] },
    source_refs: ['synthetic:layout-only'], as_of: '2026-10-01T00:00:00Z',
    freshness: { queried_at: '2026-10-01T00:00:00Z', source_updated_through: null },
    coverage: { state: 'partial', candidate_count: 4, contributing_count: 3, excluded_count: 1 },
    exclusions: [{ reason: 'Synthetic excluded input', count: 1 }], truth_state: 'PARTIAL',
    caveats: ['SYNTHETIC: these figures are not customer evidence or provider readiness.'],
    source_revision_ref: 'synthetic-layout-revision', evidence_ref: 'synthetic-not-resolvable', reference_expires_at: '2099-01-01T00:00:00Z',
  };
}
export function useSalesPerformanceMetrics() {
  const state = useHarnessParams().get('state');
  const phase: SalesPerformancePhase = state === 'member' ? 'denied' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready';
  const metrics = phase !== 'ready' || state === 'unavailable' ? [] : [
    syntheticMetric('sales.receivables.outstanding_current', '1865000'),
    syntheticMetric('sales.receivables.overdue_current', '320000'),
    syntheticMetric('sales.cash.recorded_received', '2520000'),
  ];
  return { phase, metrics, unavailableKeys: {}, retry: noop };
}
export function useFinanceInvoices() { return { phase: useHarnessParams().get('state') === 'member' ? 'denied' : 'ready', rows: [], identity: 'synthetic', hasMore: false, readAt: null, retry: noop, loadMore: noop }; }
export function useBusinessReview(_epoch?: string | null, _period?: string, focused?: { actorId: string }) {
  const p = useHarnessParams(), state = p.get('state') ?? 'ready';
  const [generation, setGeneration] = useState(0);
  const refresh = () => setGeneration(value => value + 1);
  if (state === 'loading') return { state: 'loading', refresh };
  if (state === 'error') return { state: 'failed', message: 'Synthetic read failure', refresh };
  const input = structuredClone(TEST_BUSINESS_REVIEW);
  input.tenant_id = p.get('workspace') === 'b' ? SECOND_REVIEW_TENANT : TEST_REVIEW_TENANT;
  const snapshot = withTargetAndFinanceFixtures(input, state, true);
  if (focused) {
    const original = snapshot.domains.game_plan;
    if (original?.status === 'available') {
      const targets = original.data.mission_targets?.map(row => ({ ...row,
        target: { ...row.target, title: 'Recorded receipts target', desired_value: '1500000',
          metric: { ...row.target.metric, key: 'sales.cash.recorded_received', unit: 'currency_minor', value_kind: 'currency_totals' as const, currency: 'usd', semantics: 'event_timestamp_cohort' as const } },
        observation: state === 'expired' ? { state: 'unavailable' as const, reason: 'evidence_unverified' as const }
          : { state: state === 'partial' ? 'partial' as const : 'available' as const, actual: '1200000',
            variance: state === 'partial' ? null : '-300000', attainment: state === 'partial' ? 'unknown' as const : 'not_met' as const,
            period_complete: false, as_of: new Date().toISOString(), source_revision_ref: 'sr_v1_' + 'a'.repeat(64),
            reference_expires_at: new Date(Date.now() + 3600000).toISOString(), caveats: ['Synthetic layout input. Recorded receipts are not bank deposits.'] },
      }));
      return { state: 'ready', snapshot: { ...snapshot, actor_id: 'synthetic-owner', requested: ['game_plan'],
        domains: { game_plan: state === 'unavailable' ? { status: 'unavailable', data: null, reason: 'synthetic_unavailable' }
          : { status: 'available', data: { ...original.data, mission_targets: targets } } } }, refresh };
    }
  }
  if (state === 'unavailable') snapshot.domains.finance = { status: 'unavailable', data: null, reason: 'Synthetic source unavailable' };
  if (generation && snapshot.domains.finance?.data?.finance_evidence?.sources[0]) snapshot.domains.finance.data.finance_evidence.sources[0].company_label = 'Example refreshed source';
  return { state: 'ready', snapshot, refresh };
}
