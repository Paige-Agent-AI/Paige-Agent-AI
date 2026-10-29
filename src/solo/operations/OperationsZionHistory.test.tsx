// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError, createClient } from '@supabase/supabase-js';
import { OperationsZionHistory } from './OperationsZionHistory';
import type { ZionAssignmentRead } from './zion-assignment-read';
type AuthSnapshot = { user: { id: string; last_sign_in_at?: string } };
const port = vi.hoisted(() => ({ read: vi.fn(), changed: null as ((event: string, session?: AuthSnapshot | null) => void) | null,
  initial: null as AuthSnapshot | null, unsubscribe: vi.fn(), getSession: vi.fn(), invoke: vi.fn() }));
vi.mock('./zion-assignment-read', () => ({ readZionAssignments: port.read }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { onAuthStateChange: (cb: (event: string, session?: AuthSnapshot | null) => void) => {
  port.changed = cb; cb('INITIAL_SESSION', port.initial); return { data: { subscription: { unsubscribe: port.unsubscribe } } };
}, getSession: port.getSession }, functions: { invoke: port.invoke } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const actor = '10000000-0000-4000-8000-000000000001', tenant = '20000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001', receipt = '40000000-0000-4000-8000-000000000001';
const entry = { id, specialist: 'zion', recorded_status: 'succeeded' as const, created_at: '2026-10-25T15:12:00Z' };
const sameSession = () => ({ user: { id: actor, last_sign_in_at: '2026-10-25T14:00:00Z' } });
const sample: ZionAssignmentRead = { status: 'ready', entries: [entry] };
const result: ZionAssignmentRead = { status: 'ready', invocation: { ...entry, observed_at: '2026-10-25T15:15:00Z',
  receipt_state: 'conflicting', receipt_id: null, receipt_at: null, response_text: '<script>untrusted original text</script>',
  response_truncated: false, completion_scope: 'specialist_response_only', note: 'response only' } };
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks(); port.changed = null; port.initial = sameSession(); port.read.mockResolvedValue(sample);
  port.getSession.mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
  port.invoke.mockRejectedValue(Error('unbound inspector fixture'));
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
it('preserves a populated original inspection on same-session sign-in notifications without another read', async () => {
  await render(); await click('Inspect recent work'); port.read.mockResolvedValueOnce(result); await click('Inspect original response');
  const original = host.textContent, epoch = port.read.mock.calls[1][2]();
  await act(async () => port.changed?.('SIGNED_IN', sameSession()));
  expect(host.textContent).toBe(original); expect(port.read).toHaveBeenCalledTimes(2);
  expect(port.read.mock.calls[1][2]()).toEqual(epoch);
});
it('keeps an untouched collapsed section quiet on same-session sign-in notifications', async () => {
  await render(); await act(async () => port.changed?.('SIGNED_IN', sameSession()));
  expect(button('Inspect recent work').getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('could not be verified'); expect(port.read).not.toHaveBeenCalled();
});
it('preserves a held read on same-session sign-in recovery', async () => {
  let resolve!: (x: ZionAssignmentRead) => void; port.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(); await click('Inspect recent work'); await act(async () => port.changed?.('SIGNED_IN', sameSession()));
  expect(port.read.mock.calls[0][2]()).not.toBeNull(); await act(async () => resolve(sample));
  expect(host.textContent).toContain('Response recorded'); expect(port.read).toHaveBeenCalledTimes(1);
});
it.each(['new-login', 'foreign-person', 'missing-metadata'] as const)('retires private results for %s rather than treating it as the same session', async kind => {
  await render(); await click('Inspect recent work');
  const session = kind === 'new-login' ? { user: { id: actor, last_sign_in_at: '2026-10-25T16:00:00Z' } }
    : kind === 'foreign-person' ? { user: { id: tenant, last_sign_in_at: sameSession().user.last_sign_in_at } } : { user: { id: actor } };
  await act(async () => port.changed?.('SIGNED_IN', session));
  expect(host.textContent).not.toContain('Response recorded'); expect(port.read.mock.calls[0][2]()).toBeNull();
  expect(port.read).toHaveBeenCalledTimes(1);
});
it('never revives an inspection from a late initial notification after sign-out and reentry', async () => {
  await render(); await click('Inspect recent work');
  await act(async () => port.changed?.('SIGNED_OUT', null));
  await act(async () => { port.changed?.('INITIAL_SESSION', sameSession()); port.changed?.('SIGNED_IN', sameSession()); });
  expect(host.textContent).not.toContain('Response recorded'); expect(port.read.mock.calls[0][2]()).toBeNull();
  expect(port.read).toHaveBeenCalledTimes(1);
});

it.each([401, 403])('withdraws prior original text and the whole sample after an actual SDK HTTP%d refusal', async status => {
  const actual = await vi.importActual<typeof import('./zion-assignment-read')>('./zion-assignment-read');
  port.read.mockImplementation(actual.readZionAssignments);
  let calls = 0, refusal: Response | undefined;
  if (result.status !== 'ready' || !('invocation' in result)) throw Error('fixture');
  const replies = [{ ok: true, matches: [], recent_invocations: [entry], sample_only: true, limit: 5, note: 'sample only' },
    { ok: true, matches: [], invocation: { ...result.invocation, note: 'response only' } }];
  const sdk = createClient('https://unit-test.invalid', 'synthetic-nonsecret-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => {
      const reply = replies[calls++];
      if (reply) return new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } });
      refusal = new Response('ignored private refusal body', { status }); return refusal;
    } },
  });
  port.invoke.mockImplementation((name, options) => sdk.functions.invoke(name, options));
  await render(); await click('Inspect recent work'); await click('Inspect original response');
  expect(host.textContent).toContain('untrusted original text');
  button('Refresh original response').focus();
  await click('Refresh original response');
  expect(host.textContent).toContain('Current owner or admin access is required');
  expect(host.textContent).not.toContain('Response recorded');
  expect(host.textContent).not.toContain('untrusted original text');
  expect(host.textContent).not.toContain('ignored private refusal body');
  expect(host.textContent).not.toContain('Original receipt needs review');
  expect(refusal?.bodyUsed).toBe(false); expect(calls).toBe(3);
  expect(port.invoke).toHaveBeenCalledTimes(3);
  expect(host.querySelector('script')).toBeNull();
  expect(document.activeElement).toBe(button('Close inspection'));
});

it('does not steal another connected focus when a delayed original inspection is refused', async () => {
  await render(); await click('Inspect recent work');
  let resolve!: (x: ZionAssignmentRead) => void;
  port.read.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await click('Inspect original response');
  const other = document.createElement('button'); other.textContent = 'Other current control'; document.body.append(other); other.focus();
  try {
    await act(async () => resolve({ status: 'refused' }));
    expect(document.activeElement).toBe(other);
    expect(host.textContent).toContain('Current owner or admin access is required');
  } finally { other.remove(); }
});

it.each(['before', 'after'])('keeps the original sample and permits deliberate reinspection after Auth unavailability %s the read', async stage => {
  const actual = await vi.importActual<typeof import('./zion-assignment-read')>('./zion-assignment-read');
  port.read.mockImplementation(actual.readZionAssignments);
  if (result.status !== 'ready' || !('invocation' in result)) throw Error('fixture');
  port.invoke.mockResolvedValueOnce({ data: { ok: true, matches: [], recent_invocations: [entry], sample_only: true, limit: 5, note: 'sample only' }, error: null });
  await render(); await click('Inspect recent work');
  const failure = { data: { session: null }, error: new AuthRetryableFetchError('Temporary Auth outage', 503) };
  if (stage === 'before') port.getSession.mockResolvedValueOnce(failure);
  else {
    port.getSession.mockResolvedValueOnce({ data: { session: { user: { id: actor } } }, error: null }).mockResolvedValueOnce(failure);
    port.invoke.mockResolvedValueOnce({ data: { ok: true, matches: [], invocation: result.invocation }, error: null });
  }
  await click('Inspect original response');
  expect(host.textContent).toContain('Response recorded');
  expect(host.textContent).toContain('The original response could not be verified. No assignment was repeated.');
  expect(host.textContent).not.toContain('Current owner or admin access is required');
  expect(host.textContent).not.toContain('untrusted original text');
  expect(port.invoke).toHaveBeenCalledTimes(stage === 'before' ? 1 : 2);
  port.invoke.mockResolvedValueOnce({ data: { ok: true, matches: [], invocation: result.invocation }, error: null });
  await click('Inspect original response');
  expect(host.textContent).toContain('untrusted original text');
  expect(host.textContent).toContain('Original receipt needs review');
  expect(host.textContent).not.toContain('Original receipt verified');
  expect(port.invoke).toHaveBeenCalledTimes(stage === 'before' ? 2 : 3);
  expect(port.invoke.mock.calls.every(([name, options]) => name === 'paige-orchestrator' && options.body.action === 'tool_search')).toBe(true);
});
