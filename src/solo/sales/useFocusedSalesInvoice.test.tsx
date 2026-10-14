import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFocusedSalesInvoice } from './useFocusedSalesInvoice';

const h = vi.hoisted(() => ({
  actor: '66666666-6666-4666-8666-666666666666' as string | null,
  rpc: vi.fn(),
  authChanged: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: h.rpc,
  auth: {
    getSession: async () => ({ data: { session: h.actor ? { user: { id: h.actor } } : null } }),
    onAuthStateChange: (callback: typeof h.authChanged) => {
      h.authChanged = callback;
      return { data: { subscription: { unsubscribe() { if (h.authChanged === callback) h.authChanged = null; } } } };
    },
  },
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tenant = '11111111-1111-4111-8111-111111111111';
const invoice = '22222222-2222-4222-8222-222222222222';
const another = '44444444-4444-4444-8444-444444444444';
const actorB = '77777777-7777-4777-8777-777777777777';
const snapshot = { schema_version: 2, client_id: '33333333-3333-4333-8333-333333333333', items: [{ price_id: null, item: 'Older saved service', unit_minor: 1000, quantity: 1, price_snapshot: null }], kind: 'one_time', deposit_basis_points: null, currency: 'usd', cadence: null, recipient_email: null, recipient_phone: null, email_source_method_id: null, phone_source_method_id: null, billing_address: null, agreement_id: null, agreement_snapshot: null, processor_intent: null, payment_method_intents: [], delivery_channel_intents: [], due_date: null, memo: null, total_minor: 1000, due_now_minor: 1000, remainder_minor: 0 };
function record(patch: Record<string, unknown> = {}) {
  return { id: invoice, tenant_id: tenant, status: 'draft', invoice_number: 'DRAFT-old', billing_draft_version: 1, version: 1, amount_total_cents: 1000, billing_draft: snapshot, manual_recorded_cents: 0, remaining_cents: 1000, payments: [], payments_count: 0, payments_has_more: false, ...patch };
}
let root: Root;
let latest: ReturnType<typeof useFocusedSalesInvoice>;
let options: Parameters<typeof useFocusedSalesInvoice>[0];
function Probe() { latest = useFocusedSalesInvoice(options); return null; }
async function render() { await act(async () => root.render(<Probe />)); }
beforeEach(() => {
  h.actor = '66666666-6666-4666-8666-666666666666'; h.rpc.mockReset(); h.authChanged = null;
  h.rpc.mockResolvedValue({ data: record(), error: null });
  options = { tenantId: tenant, resolving: false, invoiceIds: [invoice] };
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

it('reads the exact canonical invoice independently of a list page or search', async () => {
  await render();
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('read_sales_invoice', { _expected_tenant_id: tenant, _invoice_id: invoice });
  expect(latest).toMatchObject({ phase: 'ready', row: { id: invoice, tenantId: tenant, snapshot: { items: [{ item: 'Older saved service' }] } } });
});
it('normalizes a valid uppercase UUID before exact read and returned-id validation', async () => {
  options.invoiceIds = ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'];
  h.rpc.mockResolvedValue({ data: record({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), error: null });
  await render();
  expect(latest.phase).toBe('ready');
  expect(h.rpc.mock.calls[0][1]._invoice_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
it('ignores same-actor token refresh without refetching or hiding the current invoice', async () => {
  await render(); const row = latest.row;
  await act(async () => h.authChanged?.('TOKEN_REFRESHED', { user: { id: h.actor! } }));
  expect(latest.phase).toBe('ready'); expect(latest.row).toBe(row); expect(h.rpc).toHaveBeenCalledTimes(1);
});
it.each([['not-a-uuid'], [''], [invoice, invoice], [invoice, another]].map(invoiceIds => ({ invoiceIds })))('refuses malformed or duplicate focused input %j without reading', async ({ invoiceIds }) => {
  options.invoiceIds = invoiceIds; await render();
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull(); expect(h.rpc).not.toHaveBeenCalled();
});
it('keeps the no-query register path idle without auth or record reads', async () => {
  options.invoiceIds = []; await render();
  expect(latest.phase).toBe('idle'); expect(h.rpc).not.toHaveBeenCalled(); expect(h.authChanged).toBeNull();
});
it.each([{ data: null, error: null }, { data: null, error: { code: 'P0002' } }, { data: null, error: { code: 'PGRST202' } }])('reports unavailable exact record without substituting a record %j', async response => {
  h.rpc.mockResolvedValue(response); await render(); expect(latest.phase).toBe('unavailable'); expect(latest.row).toBeNull();
});
it.each([{ tenant_id: another }, { id: another }, { version: -1 }])('refuses a foreign, wrong-id or malformed returned record %j', async patch => {
  h.rpc.mockResolvedValue({ data: record(patch), error: null }); await render();
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull();
});
it('refuses permission failure and a signed-out session', async () => {
  h.rpc.mockResolvedValue({ data: null, error: { code: '42501' } }); await render();
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull();
  h.actor = null; await act(async () => h.authChanged?.('SIGNED_OUT', null));
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull();
});
it('does not read while canonical workspace context is resolving', async () => {
  options.resolving = true; await render(); expect(latest.phase).toBe('loading'); expect(h.rpc).not.toHaveBeenCalled();
  options.resolving = false; await render(); expect(latest.phase).toBe('ready');
});
it('retries the same exact read and never requests a list fallback', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } }); await render();
  await act(async () => latest.retry()); expect(latest.phase).toBe('ready');
  expect(h.rpc.mock.calls.map(([name, args]) => [name, args._invoice_id])).toEqual([['read_sales_invoice', invoice], ['read_sales_invoice', invoice]]);
});
it.each(['tenant', 'invoice', 'resolving', 'closed', 'account'] as const)('discards an old response after %s changes', async change => {
  let resolve!: (value: unknown) => void;
  h.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await render();
  if (change === 'tenant') options.tenantId = another;
  if (change === 'invoice') options.invoiceIds = [another];
  if (change === 'resolving') options.resolving = true;
  if (change === 'closed') options.invoiceIds = [];
  if (change === 'account') options.accountEpoch = 'test-tenant-b';
  h.rpc.mockResolvedValue({ data: null, error: null }); await render();
  await act(async () => resolve({ data: record(), error: null }));
  expect(latest.row).toBeNull(); expect(latest.phase).not.toBe('ready');
});
it('does not restore a prior account response across route A-B-A', async () => {
  options.accountEpoch='test-tenant-a';
  let resolve!:(value:unknown)=>void;
  h.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await render();
  h.rpc.mockResolvedValue({data:null,error:null});options.accountEpoch='test-tenant-b';await render();
  options.accountEpoch='test-tenant-a';await render();
  await act(async()=>resolve({data:record(),error:null}));expect(latest.row).toBeNull();expect(latest.phase).toBe('unavailable');
});
it('does not restore actor A facts after same-tenant A-B-A reauthentication',async()=>{
 let resolve!:(value:unknown)=>void;h.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await render();
 const actorA=h.actor!;h.rpc.mockResolvedValue({data:null,error:null});h.actor=actorB;await act(async()=>h.authChanged?.('SIGNED_IN',{user:{id:actorB}}));
 h.actor=actorA;await act(async()=>h.authChanged?.('SIGNED_IN',{user:{id:actorA}}));
 await act(async()=>resolve({data:record(),error:null}));expect(latest.row).toBeNull();expect(latest.phase).toBe('unavailable');
});
it('discards same-tenant actor A response after actor B signs in', async () => {
  let resolve!: (value: unknown) => void;
  h.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await render();
  h.rpc.mockResolvedValue({ data: null, error: { code: '42501' } }); h.actor = actorB;
  await act(async () => h.authChanged?.('SIGNED_IN', { user: { id: actorB } }));
  await act(async () => resolve({ data: record(), error: null }));
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull();
});
it('checks the current session again before publishing an exact response', async () => {
  let resolve!: (value: unknown) => void;
  h.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; })); await render();
  h.actor = actorB;
  await act(async () => resolve({ data: record(), error: null }));
  expect(latest.phase).toBe('refused'); expect(latest.row).toBeNull();
});
