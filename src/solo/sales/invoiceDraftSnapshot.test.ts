import { describe, expect, it } from 'vitest';
import { aggregateInvoiceItems, normalizeInvoiceSnapshot, snapshotEditInput } from './invoiceDraftSnapshot';
import type { InvoiceSnapshot } from './invoiceDraftSnapshot';

const client = '33333333-3333-4333-8333-333333333333';
const item = { price_id: null, item: 'Setup', unit_minor: 999, quantity: 2, price_snapshot: null };
const snapshot: InvoiceSnapshot = {
  schema_version: 2, client_id: client, items: [item, { ...item, item: 'Review', unit_minor: 1001, quantity: 1 }],
  kind: 'deposit', deposit_basis_points: 2500, currency: 'usd', cadence: null,
  recipient_email: 'billing@example.test', recipient_phone: '+15555550123',
  email_source_method_id: null, phone_source_method_id: null,
  billing_address: { line1: '123 Example St', line2: 'Suite 2', city: 'Sample', region: 'CA', postal_code: '90210', country: null },
  agreement_id: null, agreement_snapshot: null, processor_intent: null, payment_method_intents: [],
  delivery_channel_intents: ['email', 'sms'], due_date: '2026-12-01', memo: null,
  total_minor: 2999, due_now_minor: 750, remainder_minor: 2249,
};
describe('versioned invoice-only snapshots', () => {
  it('sums checked line integers and rounds one deposit on the whole obligation', () => {
    expect(aggregateInvoiceItems(snapshot.items, 2500)).toEqual({ totalMinor: 2999, dueNowMinor: 750, remainderMinor: 2249 });
    expect(() => aggregateInvoiceItems([{ ...item, unit_minor: 2147483647 }])).toThrow();
    expect(() => aggregateInvoiceItems([{ ...item, unit_minor: 1, quantity: 1 }], 1)).toThrow();
  });
  it('keeps all contact/address/item facts on a supported saved snapshot', () => {
    expect(normalizeInvoiceSnapshot(snapshot, 2999)).toEqual(snapshot);
    expect(snapshotEditInput(snapshot)).toMatchObject({ schema_version: 2, recipient_phone: '+15555550123', items: snapshot.items.map(({ price_snapshot: _snapshot, ...line }) => line) });
    expect(snapshotEditInput(snapshot)).not.toHaveProperty('total_minor');
  });
  it('preserves an exact fixed deposit without rounding it into basis points',()=>{
    const exact={...snapshot,schema_version:3,deposit_basis_points:null,deposit_minor:50000,
      items:[{...item,unit_minor:350000,quantity:1}],total_minor:350000,due_now_minor:50000,remainder_minor:300000};
    expect(normalizeInvoiceSnapshot(exact,350000)).toEqual(exact);
    const read=normalizeInvoiceSnapshot(exact,350000)!;
    expect(snapshotEditInput(read)).toMatchObject({schema_version:3,deposit_minor:50000,deposit_basis_points:null});
    expect(aggregateInvoiceItems(exact.items,undefined,50000)).toEqual({totalMinor:350000,dueNowMinor:50000,remainderMinor:300000});
  });
  it.each([0,-1,1.5,350000,350001,NaN,Infinity])('refuses invalid exact deposit %s',deposit_minor=>{
    expect(()=>aggregateInvoiceItems([{...item,unit_minor:350000,quantity:1}],undefined,deposit_minor)).toThrow();
  });
  it('refuses mixed percentage/exact deposits, extra version2 fields and altered saved math',()=>{
    expect(()=>aggregateInvoiceItems(snapshot.items,2500,500)).toThrow();
    expect(normalizeInvoiceSnapshot({...snapshot,deposit_minor:750},2999)).toBeNull();
    expect(normalizeInvoiceSnapshot({...snapshot,schema_version:3,deposit_minor:750},2999)).toBeNull();
    expect(normalizeInvoiceSnapshot({...snapshot,schema_version:3,deposit_basis_points:null,deposit_minor:749},2999)).toBeNull();
  });
  it('normalizes historical one-item facts without changing their input object or inferring contacts', () => {
    const old = { client_id: client, ...item, kind: 'one_time', provider: 'paypal', currency: 'usd', cadence: null, deposit_basis_points: null,
      recipient_email: 'saved@example.test', due_date: null, memo: null, due_now_minor: 1998, remainder_minor: 0 };
    const before = JSON.stringify(old);
    const result = normalizeInvoiceSnapshot(old, 1998);
    expect(result).toMatchObject({ schema_version: 2, items: [item], recipient_email: 'saved@example.test', recipient_phone: null, processor_intent: 'paypal', billing_address: null });
    expect(JSON.stringify(old)).toBe(before);
  });
  it.each([
    { schema_version: 3 }, { items: [] }, { items: Array.from({ length: 51 }, () => item) },
    { total_minor: 3000 }, { due_now_minor: 749, remainder_minor: 2250 },
    { items: [{ ...item, quantity: 1.5 }] }, { billing_address: { ...snapshot.billing_address, secret: 'no' } },
    { payment_method_intents: ['card', 'card'] }, { delivery_channel_intents: ['imessage'] },
    { delivery_channel_intents: ['email', 'email'] }, { recipient_phone: '-------' },
  ])('refuses malformed or unsupported snapshots instead of dropping facts', patch => {
    expect(normalizeInvoiceSnapshot({ ...snapshot, ...patch }, 2999)).toBeNull();
  });
});

it('preserves optional multiline descriptions and absent legacy keys through snapshot edits',()=>{const described={...snapshot,items:snapshot.items.map((line,index)=>index===0?{...line,description:'Scope\nCustomer wording'}:line)};expect(normalizeInvoiceSnapshot(described,2999)).toEqual(described);expect(snapshotEditInput(described).items[0].description).toBe('Scope\nCustomer wording');expect(Object.prototype.hasOwnProperty.call(snapshotEditInput(snapshot).items[0],'description')).toBe(false);expect(normalizeInvoiceSnapshot({...described,items:[{...described.items[0],description:'x'.repeat(10001)},described.items[1]]},2999)).toBeNull();expect(normalizeInvoiceSnapshot({...described,items:[{...described.items[0],description:42},described.items[1]]},2999)).toBeNull();});
