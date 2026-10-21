import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import type { CrmWorkRecord } from './operations-native-work';
import { OperationsOverview } from './OperationsOverview';
import { OperationsRecordedFindings } from './OperationsRecordedFindings';

vi.mock('../weekly/WeeklyResponsibilityEntry', () => ({ WeeklyResponsibilityEntry: () => null }));
vi.mock('../data/useBusinessTimeZone', async original => ({ ...await original<typeof import('../data/useBusinessTimeZone')>(),
  useBusinessCalendarDay: () => ({ day: { kind: 'configured', zone: 'America/New_York', date: '2026-10-21' }, refresh: vi.fn() }) }));
vi.mock('../data/useBusinessReview', () => ({ useBusinessReview: () => ({ state: 'ready',
  snapshot: TEST_BUSINESS_REVIEW, refresh: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const task = { id: 'test-task', tenant_id: TEST_REVIEW_TENANT, user_id: 'test-owner', title: 'Review the original work',
  description: null, status: 'in_progress', due_date: null, updated_at: '2026-10-21T12:00:00Z', created_at: '2026-10-20T12:00:00Z',
  deal_id: null, biz_id: null, recorded_priority: null, estimated_minutes: null } as CrmWorkRecord;
function Source() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Back</button>; }
async function render(state: 'loading' | 'unavailable' | 'ready', populated = false) {
  await act(async () => root.render(<MemoryRouter initialEntries={['/solo/1234567/operations/overview']}>
    <Routes><Route path="/solo/:account/operations/overview" element={<OperationsOverview tenantId={TEST_REVIEW_TENANT}
      plans={[]} items={[]} members={[]} nativeWorkState={state} crmTasks={populated ? [task] : []}
      onInspectItem={vi.fn()} onInspectPlan={vi.fn()} recordedFindings={<OperationsRecordedFindings
        tenantId={TEST_REVIEW_TENANT} userId="test-owner" canLeave={() => true} />} />} />
      <Route path="/solo/:account/command-center/systems-check" element={<Source />} /></Routes>
  </MemoryRouter>));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(node => node.textContent === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}
it.each(['loading', 'unavailable'] as const)('keeps original Back focus when %s native Work settles and gains records', async state => {
  await render(state); await click('Open Systems Check'); await click('Back');
  const heading = host.querySelector('#recorded-findings-heading');
  expect(document.activeElement === heading).toBe(true);
  await render('ready');
  expect(host.querySelector('#recorded-findings-heading') === heading).toBe(true);
  expect(document.activeElement === heading).toBe(true);
  expect(host.textContent).toContain('Start with one real commitment');
  await render('ready', true);
  expect(host.querySelector('#recorded-findings-heading') === heading).toBe(true);
  expect(document.activeElement === heading).toBe(true);
  expect(host.textContent).toContain(task.title);
});
it('does not remount or refocus the recorded source when native Work becomes unreadable', async () => {
  await render('ready', true);
  const refresh = host.querySelector<HTMLButtonElement>('[aria-label="Refresh recorded Operations findings"]')!;
  refresh.focus();
  await render('loading'); await render('unavailable');
  expect(host.querySelector('[aria-label="Refresh recorded Operations findings"]') === refresh).toBe(true);
  expect(document.activeElement === refresh).toBe(true);
  expect(host.textContent).toContain('Current Work could not be read');
  expect(host.textContent).not.toContain('Start with one real commitment');
});
