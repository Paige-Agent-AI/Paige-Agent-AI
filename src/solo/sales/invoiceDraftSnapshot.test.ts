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
