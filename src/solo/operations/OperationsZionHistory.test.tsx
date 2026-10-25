// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperationsZionHistory } from './OperationsZionHistory';
import type { ZionAssignmentRead } from './zion-assignment-read';
const port = vi.hoisted(() => ({ read: vi.fn(), changed: null as ((event: string) => void) | null, unsubscribe: vi.fn() }));
vi.mock('./zion-assignment-read', () => ({ readZionAssignments: port.read }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { onAuthStateChange: (cb: (event: string) => void) => {
  port.changed = cb; return { data: { subscription: { unsubscribe: port.unsubscribe } } };
} } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const actor = '10000000-0000-4000-8000-000000000001', tenant = '20000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001', receipt = '40000000-0000-4000-8000-000000000001';
const entry = { id, specialist: 'zion', recorded_status: 'succeeded' as const, created_at: '2026-10-25T15:12:00Z' };
const sample: ZionAssignmentRead = { status: 'ready', entries: [entry] };
const result: ZionAssignmentRead = { status: 'ready', invocation: { ...entry, observed_at: '2026-10-25T15:15:00Z',
  receipt_state: 'conflicting', receipt_id: null, receipt_at: null, response_text: '<script>untrusted original text</script>',
  response_truncated: false, completion_scope: 'specialist_response_only', note: 'response only' } };
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); port.changed = null; port.read.mockResolvedValue(sample);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(tenantId = tenant, userId = actor) { await act(async () => root.render(<OperationsZionHistory tenantId={tenantId} userId={userId} />)); }
function button(text: string) { const b = [...host.querySelectorAll('button')].find(x => x.textContent?.trim() === text); expect(b, text).toBeTruthy(); return b!; }
async function click(text: string) { await act(async () => button(text).click()); }
it('does not read on mount and deliberately samples the existing caller-scoped inspector', async () => {
  await render(); expect(port.read).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Response recorded');
  await click('Inspect recent work'); expect(port.read).toHaveBeenCalledTimes(1);
  const args = port.read.mock.calls[0]; expect(args[0]).toMatchObject({ actorId: actor, tenantId: tenant }); expect(args[2]()).toEqual(args[0]);
  expect(host.textContent).toContain('sampled from up to five specialist assignments');
  expect(host.textContent).toContain('Response recorded'); expect(host.textContent).not.toContain('Original receipt verified');
});
it('inspects the selected original ID, escapes response text and distinguishes a conflicting receipt', async () => {
  await render(); await click('Inspect recent work'); port.read.mockResolvedValueOnce(result);
  await click('Inspect original response'); expect(port.read.mock.calls[1][3]).toEqual(entry);
  expect(host.textContent).toContain('Original receipt needs review'); expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('details p')?.textContent).toBe('<script>untrusted original text</script>');
  expect(host.textContent).toContain('Business actions need their own work records and results');
  expect(host.textContent).not.toContain('Original receipt verified'); expect(host.textContent).not.toContain(receipt);
});
it('shows a verified original response receipt without claiming business execution', async () => {
  await render(); await click('Inspect recent work');
  if (result.status !== 'ready' || !('invocation' in result)) throw Error('fixture');
  port.read.mockResolvedValueOnce({ ...result, invocation: { ...result.invocation, receipt_state: 'verified', receipt_id: receipt, receipt_at: entry.created_at } });
  await click('Inspect original response'); expect(host.textContent).toContain('Original receipt verified'); expect(host.textContent).toContain(receipt);
  expect(host.textContent).not.toMatch(/business work completed|task completed|running now/i);
});
it.each(['refused', 'unavailable', 'empty'] as const)('keeps %s distinct from completed work or a complete history', async status => {
  port.read.mockResolvedValueOnce(status === 'empty' ? { status: 'ready', entries: [] } : { status });
  await render(); await click('Inspect recent work');
  expect(host.textContent).toContain(status === 'empty' ? 'No ZION assignment appears in this recent sample'
    : status === 'refused' ? 'Current owner or admin access is required' : 'could not be verified');
  expect(host.textContent).not.toContain('Response recorded'); expect(host.textContent).not.toContain('Original receipt verified');
});
it('withdraws the whole sample when an original inspection loses authority', async () => {
  await render(); await click('Inspect recent work'); port.read.mockResolvedValueOnce({ status: 'refused' });
  await click('Inspect original response'); expect(host.textContent).not.toContain('Response recorded');
  expect(host.textContent).toContain('Current owner or admin access is required');
});
it('closes a held read with stable focus and never reopens on late completion', async () => {
  let resolve!: (x: ZionAssignmentRead) => void; port.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(); await click('Inspect recent work'); expect(host.textContent).toContain('Reading your recent');
  expect(document.activeElement).toBe(button('Close inspection')); expect(port.read.mock.calls[0][2]()).not.toBeNull();
  await click('Close inspection'); expect(port.read.mock.calls[0][2]()).toBeNull();
  await act(async () => resolve(sample)); expect(button('Inspect recent work').getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('Response recorded');
});
it('removes prior private rows before painting another actor or business and discards its held detail', async () => {
  await render(); await click('Inspect recent work'); let resolve!: (x: ZionAssignmentRead) => void;
  port.read.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await click('Inspect original response');
  await render('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');
  expect(host.textContent).not.toContain('Response recorded'); expect(host.textContent).not.toContain('Inspecting original response');
  expect(port.read.mock.calls[1][2]()).toBeNull(); await act(async () => resolve(result));
  expect(host.textContent).not.toContain('untrusted original text'); expect(port.unsubscribe).toHaveBeenCalledTimes(1);
});
it.each(['SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'])('retires private inspection on %s without repeating a request', async event => {
  await render(); await click('Inspect recent work'); await act(async () => port.changed?.(event));
  expect(host.textContent).not.toContain('Response recorded'); expect(port.read).toHaveBeenCalledTimes(1);
  expect(port.read.mock.calls[0][2]()).toBeNull();
});
