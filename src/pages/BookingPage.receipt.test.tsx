import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import BookingPage from './BookingPage';

const port = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: port.invoke } } }));
vi.mock('@/hooks/useEmbedHeight', () => ({ isEmbedded: () => false, useEmbedHeight: () => undefined }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => true }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const start = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(15, 0, 0, 0); return d.toISOString(); })();
const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
const receipt = () => ({ ok: true, booking: { id: '10000000-0000-4000-8000-000000000001', start_at: start, end_at: end, title: 'Client check-in' } });
type Reply = { data: unknown; error: unknown };
let host: HTMLDivElement, root: Root;
function transport(create: () => Reply | Promise<Reply>, branding: Record<string, unknown> = {}) {
  port.invoke.mockImplementation(async (_name: string, request: { body: { action: string } }) => request.body.action === 'availability'
    ? { data: { slots: [start], durationMin: 30, timezone: 'UTC', branding: { name: 'Harbor Lane Advisors', title: 'Client check-in', showCompanyName: true, locationOptions: [{ type: 'custom', value: 'Online' }], locationType: 'custom', locationValue: 'Online', appointmentTypes: [], ...branding } }, error: null }
    : create());
}
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent?.trim() === label)!;
const heading = (pattern: RegExp) => Array.from(host.querySelectorAll('h1,h2')).find(node => pattern.test(node.textContent ?? ''));
async function mount() { await act(async () => root.render(<MemoryRouter initialEntries={['/book/test-service']}><Link to="/book/other-service">Other business</Link><Link to="/book/test-service">Original business</Link><Routes><Route path="/book/:slug" element={<BookingPage />} /></Routes></MemoryRouter>)); }
async function details() {
  expect(heading(/^Select Date & Time$/)).toBeTruthy();
  const label = new Intl.DateTimeFormat('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(start));
  expect(button(label)).toBeTruthy(); await act(async () => button(label).click());
  expect(heading(/^Enter Details$/)).toBeTruthy();
  const fields = host.querySelectorAll<HTMLInputElement>('input');
  await act(async () => {
    for (const [input, value] of [[fields[0], 'Avery Example'], [fields[1], 'client@example.test']] as const) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
async function confirm() { await act(async () => { const target = button('Confirm booking'); target.focus(); target.click(); }); }
const createCalls = () => port.invoke.mock.calls.filter(([, request]) => request.body.action === 'create');
beforeEach(() => { port.invoke.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('original booking screen consumes a real receipt', () => {
  it('confirms an actual matching receipt without promising email delivery', async () => {
    transport(() => ({ data: receipt(), error: null })); await mount(); await details(); await confirm();
    expect(heading(/you.re booked/i)).toBeTruthy(); expect(host.textContent).not.toMatch(/confirmation is on its way/i);
    expect(host.textContent).toMatch(/your booking is saved/i); expect(createCalls()).toHaveLength(1);
  });
  it('does not claim an absent meeting link was emailed', async () => {
    transport(() => ({ data: receipt(), error: null }), { locationOptions: [{ type: 'google_meet', value: '' }] }); await mount(); await details();
    expect(host.textContent).not.toMatch(/link sent after you book/i); await confirm();
    expect(host.textContent).not.toMatch(/link is in your email/i); expect(host.textContent).toMatch(/contact the business if you need a meeting link/i);
  });
  it.each([true, false])('respects company-name visibility (%s) in the fallback business mark', async showCompanyName => {
    transport(() => ({ data: receipt(), error: null }), { showCompanyName }); await mount();
    expect(host.querySelector('img[alt="Paige"]')).toBeNull();
    expect(host.textContent?.includes('Harbor Lane Advisors')).toBe(showCompanyName);
    const hiddenMarks = Array.from(host.querySelectorAll('span[aria-hidden="true"]'));
    expect(hiddenMarks.some(node => node.textContent === 'H')).toBe(showCompanyName);
  });
  it.each([
    ['missing acknowledgement', null],
    ['blocked HTTP200 acknowledgement', { ok: false, status: 'blocked', code: 'COMMS_PROVIDER_EXECUTION_DISABLED' }],
    ['missing booking identity', { ok: true, booking: { start_at: start, end_at: end, title: 'Client check-in' } }],
    ['different booking time', { ...receipt(), booking: { ...receipt().booking, start_at: new Date(Date.parse(start) + 60_000).toISOString() } }],
  ])('holds an uncertain %s with the entered details and no second request', async (_label, data) => {
    transport(() => ({ data, error: null })); await mount(); await details(); await confirm();
    expect(host.textContent).toMatch(/couldn.t confirm whether your booking was saved/i); expect(heading(/you.re booked/i)).toBeUndefined();
    const target = button('Awaiting confirmation'); expect(target?.disabled).toBe(true);
    await act(async () => target.click()); expect(createCalls()).toHaveLength(1);
    const fields = host.querySelectorAll<HTMLInputElement>('input'); expect(fields[0].value).toBe('Avery Example'); expect(fields[1].value).toBe('client@example.test');
    expect(document.activeElement?.textContent).toMatch(/couldn.t confirm whether your booking was saved/i);
  });
  it('returns to original availability on a real pre-booking conflict', async () => {
    transport(() => ({ data: null, error: new FunctionsHttpError(new Response('Conflict', { status: 409 })) })); await mount(); await details(); await confirm();
    expect(heading(/^Select Date & Time$/)).toBeTruthy(); expect(heading(/you.re booked/i)).toBeUndefined(); expect(createCalls()).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/time is no longer available/i);
  });
  it('associates the existing name, email and phone labels with their inputs', async () => {
    transport(() => ({ data: receipt(), error: null })); await mount(); await details();
    for (const text of ['Name *', 'Email *', 'Phone']) {
      const label = Array.from(host.querySelectorAll<HTMLLabelElement>('label')).find(node => node.textContent === text)!;
      expect(label.htmlFor).not.toBe(''); expect(document.getElementById(label.htmlFor)?.tagName).toBe('INPUT');
    }
  });
  it('does not confirm a late booking result after a business A→B→A route return', async () => {
    let finish!: (value: Reply) => void;
    transport(() => new Promise<Reply>(resolve => { finish = resolve; })); await mount(); await details(); await confirm();
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href="/book/other-service"]')!.click());
    expect(heading(/^Select Date & Time$/)).toBeTruthy();
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href="/book/test-service"]')!.click());
    expect(heading(/^Select Date & Time$/)).toBeTruthy();
    await act(async () => { finish({ data: receipt(), error: null }); });
    expect(heading(/you.re booked/i)).toBeUndefined(); expect(createCalls()).toHaveLength(1);
  });
  it('holds a thrown transport failure without an unhandled rejection or duplicate', async () => {
    transport(() => Promise.reject(new Error('connection interrupted'))); await mount(); await details(); await confirm();
    expect(host.textContent).toMatch(/couldn.t confirm whether your booking was saved/i); expect(button('Awaiting confirmation').disabled).toBe(true); expect(createCalls()).toHaveLength(1);
  });
  it('holds a slow acknowledgement and settles its original late receipt without dispatching again', async () => {
    let finish!: (value: Reply) => void;
    transport(() => new Promise<Reply>(resolve => { finish = resolve; })); await mount(); await details(); vi.useFakeTimers(); await confirm();
    expect(button('Confirm booking').disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(host.textContent).toMatch(/couldn.t confirm whether your booking was saved/i); expect(button('Awaiting confirmation').disabled).toBe(true); expect(createCalls()).toHaveLength(1);
    await act(async () => { finish({ data: receipt(), error: null }); });
    expect(heading(/you.re booked/i)).toBeTruthy(); expect(createCalls()).toHaveLength(1); expect(document.activeElement).toBe(heading(/you.re booked/i));
  });
  it('announces uncertainty without stealing focus from another control', async () => {
    let finish!: (value: Reply) => void;
    transport(() => new Promise<Reply>(resolve => { finish = resolve; })); await mount(); await details(); await confirm();
    const other = host.querySelector<HTMLAnchorElement>('a[href="/book/other-service"]')!; other.focus();
    await act(async () => { finish({ data: null, error: null }); });
    expect(host.textContent).toMatch(/couldn.t confirm whether your booking was saved/i); expect(document.activeElement).toBe(other); expect(createCalls()).toHaveLength(1);
  });
});
