import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import { SECOND_REVIEW_TENANT, withTargetAndFinanceFixtures } from '../executive-mount/slice-fixtures';

// Synthetic inputs only. All backend calls are refused by the existing shell stub.
function useHarnessParams() { return new URLSearchParams(useLocation().search); }
const noop = () => {};
export function useSalesPerformanceMetrics() { return { phase: useHarnessParams().get('state') === 'member' ? 'denied' : 'ready', metrics: [], unavailableKeys: {}, retry: noop }; }
export function useFinanceInvoices() { return { phase: useHarnessParams().get('state') === 'member' ? 'denied' : 'ready', rows: [], identity: 'synthetic', hasMore: false, readAt: null, retry: noop, loadMore: noop }; }
export function useBusinessReview() {
  const p = useHarnessParams(), state = p.get('state') ?? 'ready';
  const [generation, setGeneration] = useState(0);
  const refresh = () => setGeneration(value => value + 1);
  if (state === 'loading') return { state: 'loading', refresh };
  if (state === 'error') return { state: 'failed', message: 'Synthetic read failure', refresh };
  const input = structuredClone(TEST_BUSINESS_REVIEW);
  input.tenant_id = p.get('workspace') === 'b' ? SECOND_REVIEW_TENANT : TEST_REVIEW_TENANT;
  const snapshot = withTargetAndFinanceFixtures(input, state, true);
  if (state === 'unavailable') snapshot.domains.finance = { status: 'unavailable', data: null, reason: 'Synthetic source unavailable' };
  if (generation && snapshot.domains.finance?.data?.finance_evidence?.sources[0]) snapshot.domains.finance.data.finance_evidence.sources[0].company_label = 'Example refreshed source';
  return { state: 'ready', snapshot, refresh };
}

