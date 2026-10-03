import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SalesBillingWorkspace } from './SalesBillingWorkspace';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ tenant: '11111111-1111-4111-8111-111111111111', phase: 'ready', save: vi.fn(), rows: [] as unknown[], offers: [] as unknown[], canManage: true, clients: [] as { id: string; name: string; primaryEmail?: string | null }[] }));
vi.mock('../useSalesBillingDrafts', () => ({ useSalesBillingDrafts: () => ({ tenantId: h.tenant, phase: h.phase, rows: h.rows, hasMore: false, nextCursor: null, message: '', save: h.save, retry: vi.fn() }) }));
vi.mock('../useSoloCommercialTerms', () => ({ useSoloCommercialTerms: () => ({ tenantId: h.tenant, phase: 'ready', clientsReadable: true, canManage: h.canManage, clients: h.clients }) }));
vi.mock('../useCatalogOffers', () => ({ useCatalogOffers: () => ({ tenantId: h.tenant, phase: 'ready', offers: h.offers, referencedOffers: [], hasMore: false }) }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { h.clients = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Test client', primaryEmail: 'primary@example.test' }, { id: '77777777-7777-4777-8777-777777777777', name: 'No email client', primaryEmail: null }]; h.phase = 'ready'; h.canManage = true; h.rows = []; h.offers = []; h.tenant = '11111111-1111-4111-8111-111111111111'; h.save.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<SalesBillingWorkspace view="invoices" />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function button(text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent === text)!; }
function click(text: string) { act(() => button(text).click()); }
function field(text: string, value: string) { const el = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith(text))!.querySelector('input,select,textarea')!; act(() => { const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
function fill() { click('Create invoice'); field('Client', '22222222-2222-4222-8222-222222222222'); field('Description', 'Custom service'); field('Unit price', '150.25'); }
it('distinguishes unavailable storage from no records and disables creation', () => { h.phase = 'unavailable'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(host.textContent).toContain('Billing draft storage unavailable'); expect(button('Create invoice').disabled).toBe(true); });
it('refuses editing for a member even with readable records', () => { h.canManage = false; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(button('Create invoice').disabled).toBe(true); });
it('preserves input on refused saves', async () => { h.save.mockResolvedValue({ ok: false, outcome: 'refused', message: 'Access refused' }); fill(); await act(async () => button('Save draft').click()); expect(host.textContent).toContain('Access refused'); expect((host.querySelector('input[value="Custom service"]') as HTMLInputElement)?.value).toBe('Custom service'); });
it('recovers an uncertain save with exactly the original operation and input', async () => { h.save.mockResolvedValueOnce({ ok: false, outcome: 'unknown', message: 'Unknown save' }).mockResolvedValueOnce({ ok: true, value: {} }); fill(); await act(async () => button('Save draft').click()); const original = h.save.mock.calls[0][0]; expect(button('Back to records').disabled).toBe(true); await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original); expect(host.textContent).not.toContain('Unknown save'); });
it('asks before discarding changed input and keeps editing by default', () => { fill(); click('Back to records'); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull(); click('Continue editing'); expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.textContent).toContain('Create invoice'); });
it('clears the editor immediately when the workspace changes', () => { fill(); h.tenant = '33333333-3333-4333-8333-333333333333'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(host.querySelector('input[value="Custom service"]')).toBeNull(); });
it('uses the existing discard guard before internal Campaigns tab navigation', () => { fill(); const nav = document.createElement('div'); nav.className = 'so-subnav'; const tab = document.createElement('button'); tab.textContent = 'Payments'; const navigate = vi.fn(); tab.addEventListener('click', navigate); nav.append(tab); document.body.append(nav); act(() => tab.click()); expect(navigate).not.toHaveBeenCalled(); expect(host.querySelector('[role="alertdialog"]')).not.toBeNull(); click('Discard changes'); expect(navigate).toHaveBeenCalledTimes(1); nav.remove(); });
function reopenCatalog(currentUnit = 15000) {
  h.rows = [{ id: '44444444-4444-4444-8444-444444444444', tenantId: h.tenant, version: 3, number: 'DRAFT-test-catalog', totalMinor: 20000, dueNowMinor: 20000, remainderMinor: 0, facts: { client_id: '22222222-2222-4222-8222-222222222222', price_id: '55555555-5555-4555-8555-555555555555', item: 'Catalog service', unit_minor: 10000, quantity: 2, kind: 'one_time', deposit_basis_points: null, provider: 'stripe', currency: 'usd', due_date: null, recipient_email: null, memo: null, cadence: null } }];
  h.offers = [{ id: '66666666-6666-4666-8666-666666666666', name: 'Catalog service', availability: 'active', prices: [{ id: '55555555-5555-4555-8555-555555555555', active: true, currency: 'usd', unitAmount: currentUnit, kind: 'one_time', billingInterval: 'one_time' }] }];
  act(() => root.render(<SalesBillingWorkspace view="invoices" />)); click('Edit');
}
it('reopens a changed Catalog draft with matching current unit, summary and review, and explicit repricing', async () => {
  reopenCatalog();
  const priceField = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('Unit price'))!.querySelector('input')!;
  expect(priceField.value).toBe('150.00'); expect(priceField.disabled).toBe(true);
  expect(host.textContent).toContain('Catalog price changed from $100.00 to $150.00 per unit');
  click('Review draft');
  const review = host.querySelector('.sb-paper')!;
  expect(review.querySelector('dt')?.nextElementSibling?.textContent).toBe('One-time');
  expect([...review.querySelectorAll('dt')].find(dt => dt.textContent === 'Unit price')?.nextElementSibling?.textContent).toBe('$150.00');
  expect([...review.querySelectorAll('dt')].find(dt => dt.textContent === 'Draft total')?.nextElementSibling?.textContent).toBe('$300.00');
  h.save.mockResolvedValue({ ok: false, outcome: 'refused', message: 'Test refusal' }); await act(async () => button('Save draft').click());
  expect(h.save.mock.calls[0][0]).toMatchObject({ expectedVersion: 3, draft: { price_id: '55555555-5555-4555-8555-555555555555', unit_minor: null, quantity: 2 } });
});
it('keeps unknown Catalog recovery pricing and operation immutable while the Catalog changes', async () => {
  reopenCatalog(); h.save.mockResolvedValue({ ok: false, outcome: 'unknown', message: 'Unknown save' });
  await act(async () => button('Save draft').click()); const original = h.save.mock.calls[0][0];
  h.offers = [{ id: '66666666-6666-4666-8666-666666666666', name: 'Catalog service', availability: 'active', prices: [{ id: '55555555-5555-4555-8555-555555555555', active: true, currency: 'usd', unitAmount: 25000, kind: 'one_time', billingInterval: 'one_time' }] }];
  act(() => root.render(<SalesBillingWorkspace view="invoices" />));
  expect([...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('Unit price'))!.querySelector('input')!.value).toBe('150.00');
  await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original);
});
it('does not review a saved Catalog price when its current active source is missing', () => { reopenCatalog(); h.offers = []; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); click('Review draft'); expect(host.textContent).toContain('The current Catalog price is unavailable'); expect(host.querySelector('.sb-paper')).toBeNull(); expect(h.save).not.toHaveBeenCalled(); });

function billingEmail() { return [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('Billing email'))!.querySelector('input')!.value; }
it('prefills canonical email on selection and clears old contact on missing or empty client', () => { fill(); expect(billingEmail()).toBe('primary@example.test'); field('Billing email', 'manual@example.test'); field('Client', '77777777-7777-4777-8777-777777777777'); expect(billingEmail()).toBe(''); field('Client', '22222222-2222-4222-8222-222222222222'); expect(billingEmail()).toBe('primary@example.test'); field('Client', ''); expect(billingEmail()).toBe(''); });
it('retains manual email through refreshed CRM data and saves the billing snapshot', async () => { fill(); field('Billing email', 'billing@example.test'); h.clients[0].primaryEmail = 'changed@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(billingEmail()).toBe('billing@example.test'); h.save.mockResolvedValue({ok:false,outcome:'refused',message:'Test refusal'}); await act(async () => button('Save draft').click()); expect(h.save.mock.calls[0][0].draft.recipient_email).toBe('billing@example.test'); });
it('reopens the saved billing email instead of current CRM email', () => { reopenCatalog(); click('Back to records'); (h.rows[0] as {facts:{recipient_email:string}}).facts.recipient_email = 'snapshot@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); click('Edit'); expect(billingEmail()).toBe('snapshot@example.test'); });
it('freezes selected billing email and original request during unknown recovery', async () => { fill(); h.save.mockResolvedValue({ok:false,outcome:'unknown',message:'Unknown'}); await act(async () => button('Save draft').click()); const original=h.save.mock.calls[0][0]; h.clients[0].primaryEmail='later@example.test'; act(() => root.render(<SalesBillingWorkspace view="invoices" />)); expect(billingEmail()).toBe('primary@example.test'); await act(async () => button('Recover original save').click()); expect(h.save.mock.calls[1][0]).toBe(original); expect(original.draft.recipient_email).toBe('primary@example.test'); });
