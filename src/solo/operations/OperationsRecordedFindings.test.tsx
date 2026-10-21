// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BusinessReviewState } from '../data/useBusinessReview';
import type { DomainSnapshot } from '../../../supabase/functions/_shared/paige-context/snapshot';
import { TEST_BUSINESS_REVIEW, TEST_REVIEW_TENANT } from '@/test/fixtures/business-review';
import { OperationsRecordedFindings } from './OperationsRecordedFindings';

const port = vi.hoisted(() => ({ result: { state: 'loading' } as BusinessReviewState,
  calls: [] as unknown[][], refresh: vi.fn(), handoff: vi.fn(), clearClient: vi.fn(), clearPublic: vi.fn() }));
vi.mock('../data/useBusinessReview', () => ({ useBusinessReview: (...args: unknown[]) => {
  port.calls.push(args); return { ...port.result, refresh: port.refresh };
} }));
vi.mock('@/lib/paigePromptHandoff', () => ({ handOffPaigePrompt: port.handoff }));
vi.mock('../paigeClientScope', () => ({ clearPaigeClientScope: port.clearClient }));
vi.mock('../paigePublicPresenceScope', () => ({ clearPaigePublicPresenceScope: port.clearPublic }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const open = vi.fn(), canLeave = vi.fn(() => true);
beforeEach(() => {
  vi.clearAllMocks(); port.calls = []; port.result = { state: 'ready', snapshot: {
    ...structuredClone(TEST_BUSINESS_REVIEW), requested: ['operations'], domains: { operations: structuredClone(TEST_BUSINESS_REVIEW.domains.operations) },
  } };
  canLeave.mockReturnValue(true); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function LocationEvidence() { const location = useLocation(); return <output data-testid="location">{location.pathname}|{JSON.stringify(location.state)}</output>; }
function OriginalSource() { const navigate = useNavigate(); return <><h1>Systems Check source fixture</h1><button onClick={() => navigate(-1)}>Back to Operations</button></>; }
async function render(state: unknown = { preserved: 'original state' }) {
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: '/solo/1234567/operations/overview', state }]}>
    <LocationEvidence /><Routes><Route path="/solo/:account/operations/overview" element={<OperationsRecordedFindings
      tenantId={TEST_REVIEW_TENANT} userId="test-owner" openPaige={open} canLeave={canLeave} />} />
      <Route path="/solo/:account/command-center/systems-check" element={<OriginalSource />} /></Routes>
  </MemoryRouter>));
}
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name);
async function click(name: string) { const value = button(name); expect(value, name).toBeTruthy(); await act(async () => value!.click()); }
function withOperations(patch: Partial<DomainSnapshot>) {
  if (port.result.state !== 'ready' || port.result.snapshot.domains.operations.status !== 'available') throw new Error('available fixture');
  const snapshot = port.result.snapshot;
  port.result = { state: 'ready', snapshot: { ...snapshot, domains: { operations: {
    status: 'available', data: { ...snapshot.domains.operations.data, ...patch },
  } } } };
}

it('uses only the canonical focused read and preserves original partial coverage and unknown source identity', async () => {
  await render();
  expect(port.calls.every(args => JSON.stringify(args) === JSON.stringify([TEST_REVIEW_TENANT, 'last_7_days', { focus: ['operations'], actorId: 'test-owner' }]))).toBe(true);
  expect(host.textContent).toContain('Partial source coverage');
  expect(host.textContent).toContain('Two figures could not be read');
  expect(host.textContent).toContain('Recorded Operations');
  expect(host.textContent).not.toContain('Source coverage reported complete');
  expect(port.handoff).not.toHaveBeenCalled();
});
it('keeps recorded-run aggregates distinct from Systems Check and preserves producer order/window notes', async () => {
  withOperations({ risks: [
    { kind: 'automation_runs_failed', summary: 'One recorded run failed', severity: 'act' },
    { kind: 'systems_check_high', summary: 'Source-authored setup finding', severity: 'act' },
  ], headline: [
    { key: 'run-count', label: 'Failed runs', value: 1, unit: 'count', basis: 'in_period', window_note: 'Original selected run window' },
    { key: 'check-count', label: 'Findings', value: 1, unit: 'count', basis: 'point_in_time', window_note: 'Latest saved check as of its original date' },
  ] });
  await render();
  const rows = [...host.querySelectorAll('li')];
  const windows = host.querySelector('[aria-label="Original source windows"]')?.textContent;
  expect(rows[0].textContent).toContain('Recorded automation runs'); expect(windows).toContain('Original selected run window');
  expect(rows[0].textContent).toContain('Individual runs aren’t available here');
  expect(rows[1].textContent).toContain('Systems Check'); expect(windows).toContain('Latest saved check as of its original date');
});
it('does not call an empty source a healthy business or successful automation', async () => {
  withOperations({ risks: [] });
  await render(); expect(host.textContent).toContain('does not confirm that every business area was checked');
  expect(host.textContent).not.toMatch(/all clear|business is healthy|automation succeeded/i);
});
it('keeps full reported coverage source-qualified and preserves distinct original windows once', async () => {
  withOperations({ coverage: 'full', coverage_note: undefined, headline: [
    { key: 'operations.first', label: 'First', value: 1, unit: 'count', basis: 'in_period', window_note: 'Original reporting window' },
    { key: 'operations.second', label: 'Second', value: 2, unit: 'count', basis: 'in_period', window_note: 'Original reporting window' },
  ] });
  await render(); expect(host.textContent).toContain('Source coverage reported complete');
  expect(host.textContent).not.toContain('Partial source coverage');
  expect(host.querySelectorAll('[aria-label="Original source windows"] p')).toHaveLength(1);
  expect(host.textContent).not.toMatch(/all clear|business is healthy|automation succeeded/i);
});
it.each(['loading', 'failed', 'unavailable'] as const)('keeps %s truthful and cannot prepare a review from missing evidence', async state => {
  if (state === 'loading') port.result = { state: 'loading' };
  else if (state === 'failed') port.result = { state: 'failed', message: 'This source could not be verified.' };
  else if (port.result.state === 'ready') port.result = { state: 'ready', snapshot: { ...port.result.snapshot,
    domains: { operations: { status: 'unavailable', data: null, reason: 'forbidden' } } } };
  await render(); expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(button('Prepare a read-only PAIGE review')).toBeUndefined();
  expect(host.textContent).not.toContain('No findings were returned');
  expect(host.textContent).not.toContain('Your work is still available');
  expect(port.handoff).not.toHaveBeenCalled();
});
it('retries through the original reader and prepares only an unsent context-safe review', async () => {
  await render();
  await act(async () => (host.querySelector('[aria-label="Refresh recorded Operations findings"]') as HTMLButtonElement).click());
  expect(port.refresh).toHaveBeenCalledTimes(1);
  await click('Prepare a read-only PAIGE review');
  expect(port.clearClient).toHaveBeenCalledTimes(1); expect(port.clearPublic).toHaveBeenCalledTimes(1);
  expect(port.handoff).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Do not run checks, create work, change settings or execute an action.'));
  expect(open).toHaveBeenCalledTimes(1); expect(button('Send')).toBeUndefined();
});
it('honors the existing departure guard without replacing original history', async () => {
  canLeave.mockReturnValue(false); await render(); await click('Open Systems Check');
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/solo/1234567/operations/overview|{"preserved":"original state"}');
});
it('opens only the current-account canonical source and restores heading focus on Back', async () => {
  await render(); await click('Open Systems Check');
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/solo/1234567/command-center/systems-check|null');
  await click('Back to Operations');
  expect(document.activeElement).toBe(host.querySelector('#recorded-findings-heading'));
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/solo/1234567/operations/overview|{"preserved":"original state"}');
});
it('does not consume another actor’s return marker or rewrite unknown legacy state', async () => {
  await render({ exp05RecordedFindingsReturn: 'foreign:scope', preserved: true });
  expect(document.activeElement).not.toBe(host.querySelector('#recorded-findings-heading'));
  await act(async () => root.unmount()); root = createRoot(host);
  await render('legacy-state'); await click('Open Systems Check'); await click('Back to Operations');
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/solo/1234567/operations/overview|"legacy-state"');
});
