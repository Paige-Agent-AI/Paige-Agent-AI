// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { FinancePlayTargets } from './FinancePlayTargets';
import type { BusinessReviewState } from '../data/useBusinessReview';
import { TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import { financialPlayReview, financialPlayTarget } from '@/test/fixtures/financial-play-review';

const ports = { value: { state: 'loading' } as BusinessReviewState, refresh: vi.fn() };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const keys = ['sales.cash.recorded_received'];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T02:00:00Z'));
  ports.value = { state: 'ready', snapshot: financialPlayReview() }; ports.refresh.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(tenantId: string | null = TEST_REVIEW_TENANT, account: string | null = '123', actorId: string | null | undefined = 'test-owner') {
  await act(async () => root.render(<MemoryRouter><FinancePlayTargets review={{ ...ports.value, refresh: ports.refresh }} tenantId={tenantId} actorId={actorId} account={account} metricKeys={keys}/></MemoryRouter>));
}
it('uses the original focused review and existing exact currency/actual/variance/Play presentation', async () => {
  await render();
  expect(host.textContent).toContain('USD 100.00'); expect(host.textContent).toContain('USD 80.00');
  expect(host.textContent).toContain('USD -20.00'); expect(host.textContent).toContain('Below target');
  expect(host.querySelector('a[href*="?play="]')?.getAttribute('href')).toBe('/solo/123/command-center/business-game-plan?play=33333333-3333-4333-8333-333333333333');
  expect(host.querySelector('h3')?.textContent).toBe('Synthetic recorded-receipts target');
  expect(host.textContent).toContain('separate from a company budget or cash forecast');
});
it.each(['tenant', 'actor'] as const)('never projects retained source data from another %s', async kind => {
  const s = financialPlayReview();
  ports.value = { state: 'ready', snapshot: { ...s, ...(kind === 'tenant' ? { tenant_id: 'other-tenant' } : { actor_id: 'other-actor' }) } }; await render();
  expect(host.textContent).not.toContain('Synthetic recorded-receipts target');
  expect(host.querySelector('a[href*="?play="]')).toBeNull(); expect(host.textContent).not.toContain('USD 80.00');
});
it('does not read or render retained data before the current canonical workspace resolves', async () => {
  await render(null);
  expect(host.textContent).not.toContain('USD 80.00'); expect(host.querySelector('a[href*="?play="]')).toBeNull();
});
it.each([null, ''])('withholds retained figures for unresolved actor %#', async actorId => {
  await render(TEST_REVIEW_TENANT, '123', actorId);
  expect(host.textContent).not.toContain('Synthetic recorded-receipts target');
});
it('withholds a foreign target even inside a retained matching snapshot envelope', async () => {
  const row = financialPlayTarget(); row.target.tenant_id = 'other-tenant';
  ports.value = { state: 'ready', snapshot: financialPlayReview([row]) }; await render();
  expect(host.textContent).not.toContain(row.target.title); expect(host.querySelector('a[href*="?play="]')).toBeNull();
});
it('never treats a sampled nonfinancial target or empty sample as no saved financial targets', async () => {
  const row = financialPlayTarget(); row.target.title = 'Other saved target'; row.target.metric.key = 'business.active_clients_current';
  ports.value = { state: 'ready', snapshot: financialPlayReview([row]) }; await render();
  expect(host.textContent).not.toContain('Other saved target');
  expect(host.textContent).toContain('review sample'); expect(host.textContent).not.toContain('No numeric targets are saved');
  ports.value = { state: 'ready', snapshot: financialPlayReview([]) }; await render();
  expect(host.textContent).toContain('Other targets may exist');
});
it('keeps partial actuals separate from unverified variance and attainment', async () => {
  const row = financialPlayTarget(); row.observation = { ...row.observation, state: 'partial', actual: '8000', variance: null, attainment: 'unknown' } as typeof row.observation;
  ports.value = { state: 'ready', snapshot: financialPlayReview([row]) }; await render();
  expect(host.textContent).toContain('USD 80.00'); expect(host.textContent).toContain('Attainment unverified');
  expect(host.textContent).toContain('Unverified'); expect(host.textContent).not.toContain('USD -20.00');
});
it('retires issued actual/variance at the original expiry without dropping saved direction', async () => {
  await render(); await act(async () => { vi.advanceTimersByTime(60_002); });
  expect(host.textContent).toContain('USD 100.00'); expect(host.textContent).not.toContain('USD 80.00');
  expect(host.textContent).not.toContain('USD -20.00'); expect(host.textContent).not.toContain('Below target');
  expect(host.querySelector('a[href*="?play="]')).not.toBeNull();
});
it('removes facts on failure and retries only the original scoped reader', async () => {
  await render(); ports.value = { state: 'failed', message: 'Synthetic read refused' }; await render();
  expect(host.textContent).not.toContain('USD 80.00'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Retry target read')!.click());
  expect(ports.refresh).toHaveBeenCalledOnce();
});
it('keeps loading and unavailable source separate from zero goals or false completion', async () => {
  ports.value = { state: 'loading' }; await render(); expect(host.querySelector('[role="status"]')).not.toBeNull();
  const s = financialPlayReview(); s.domains.game_plan = { status: 'unavailable', data: null, reason: 'mission_owner_required' };
  ports.value = { state: 'ready', snapshot: s }; await render();
  expect(host.textContent).toContain('unavailable'); expect(host.textContent).not.toContain('USD 0');
  expect(host.textContent).not.toContain('No numeric targets are saved');
});
it('keeps an unresolved account from generating an original-record URL', async () => {
  await render(TEST_REVIEW_TENANT, null); expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Resolve this workspace');
});
