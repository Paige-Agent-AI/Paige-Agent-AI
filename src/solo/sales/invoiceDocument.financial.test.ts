import {describe, expect, it} from 'vitest';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document';

const at = '2026-10-01T12:00:00Z';
type Source = {amount: number; environment?: 'test' | 'live'; correction?: boolean};
function projection(sources: Source[], renderer = 'paige-invoice-html-v2', portal = false) {
  let rawReceived = 0, rawReversed = 0, businessReceived = 0, businessReversed = 0, live = 0, test = 0, manual = 0;
  const rows = sources.map((source, index) => {
    const provider = source.environment !== undefined, reversal = source.correction === true;
    const real = source.environment !== 'test';
    if (reversal) {rawReversed += source.amount; if (real) businessReversed += source.amount;}
    else {rawReceived += source.amount; if (real) businessReceived += source.amount;}
    if (source.environment === 'live') live += source.amount;
    else if (source.environment === 'test') test += source.amount;
    else manual += reversal ? -source.amount : source.amount;
    return {
      id: `original-receipt-${index}`, kind: reversal ? 'reversal' : 'receipt', amount_cents: source.amount,
      currency: 'usd', method: provider ? 'stripe' : 'bank_transfer', received_at: at, posted_at: at, ordinal: index + 1,
      provenance: provider ? 'provider_verified' : 'human_recorded', evidence_kind: provider ? 'provider_verified' : 'manual_recorded',
      provider_environment: source.environment ?? null,
      ...(provider ? {provider: 'stripe', provider_verified_at: at} : {}),
      ...(reversal ? {reverses_payment_id: 'original-receipt-0'} : {}),
      running_received_cents: rawReceived - rawReversed, running_remaining_cents: 10000 - rawReceived + rawReversed,
      receivable_running_received_cents: businessReceived - businessReversed,
      receivable_running_remaining_cents: 10000 - businessReceived + businessReversed,
    };
  });
  return {
    invoice_id: 'original-invoice', status: 'issued', current_invoice_number: 'INV-ORIGINAL', payment_evidence_version: 2,
    document_input_digest: 'a'.repeat(64), manual_recorded_cents: manual, provider_verified_cents: live,
    test_provider_verified_cents: test, allocated_cents: manual + live, remaining_cents: 10000 - manual - live,
    ...(portal ? {test_provider_cents: test} : {}),
    document: {renderer_version: renderer, invoice_number: 'INV-ORIGINAL', issuer_name: 'Example Studio', client_name: 'Example Client',
      currency: 'usd', total_cents: 10000, published_at: at, presentation: {template: 'modern', accent: '#26483e'},
      snapshot: {items: [{item: 'Consulting', description: 'Original retained service', quantity: 1, unit_minor: 10000}], due_now_minor: 10000,
        remainder_minor: 0, due_date: '2026-10-20', kind: 'one_time'}},
    payment_ledger: {rows, count: rows.length, complete: true, as_of: at, receipt_total_cents: rawReceived, reversal_total_cents: rawReversed,
      receivable_receipt_total_cents: businessReceived, receivable_reversal_total_cents: businessReversed},
  };
}
const text = (value: unknown) => (renderSalesInvoiceDocument(value) ?? 'REFUSED').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('original document actual-receivable representation', () => {
  const variants = ['paige-invoice-html-v1', 'paige-invoice-html-v2'].flatMap(renderer => [false, true].map(portal => ({renderer, portal})));
  it.each(variants)('$renderer portal=$portal keeps TEST visible without reducing the real debt', ({renderer, portal}) => {
    const body = text(projection([{amount: 5000, environment: 'test'}], renderer, portal));
    expect(body).not.toBe('REFUSED');
    expect(body).toContain('$100.00 USD');
    expect(body).toContain('Test payment No money moved');
    expect(body).toContain('Test payments (no money moved): $50.00 USD');
    expect(body).not.toMatch(/Partially paid|Paid \(|Payment confirmed|Provider-confirmed payments:/i);
    expect(body).not.toContain('Business-recorded payments and corrections');
  });
  it.each(variants)('$renderer portal=$portal uses the same native LIVE/manual/correction balance once', ({renderer, portal}) => {
    const body = text(projection([{amount: 2000, environment: 'test'}, {amount: 3000, environment: 'live'}, {amount: 1000}, {amount: 1000, correction: true}], renderer, portal));
    expect(body).not.toBe('REFUSED');
    expect(body).toContain('outstanding $70.00 USD');
    expect(body).toContain('Provider-confirmed payments: $30.00 USD');
    expect(body).toContain('Test payments (no money moved): $20.00 USD');
    expect(body).toContain('Payment correction / reversal');
    expect(body).not.toContain('outstanding $50.00 USD');
    if (portal) expect(body).not.toMatch(/stripe/i);
  });
  it.each(variants)('$renderer portal=$portal recognizes a real full payment despite historical TEST evidence', ({renderer, portal}) => {
    const body = text(projection([{amount: 2500, environment: 'test'}, {amount: 10000, environment: 'live'}], renderer, portal));
    expect(body).not.toBe('REFUSED');
    expect(body).toContain('Paid (provider-confirmed)');
    expect(body).toContain('outstanding $0.00 USD');
    expect(body).not.toContain('settled by a test');
    expect(body).not.toContain('Unavailable');
  });
  it.each(variants)('$renderer portal=$portal retains zero and fully corrected human history', ({renderer, portal}) => {
    expect(text(projection([], renderer, portal))).toContain('No payments recorded.');
    const body = text(projection([{amount: 1000}, {amount: 1000, correction: true}], renderer, portal));
    expect(body).not.toBe('REFUSED');
    expect(body).toContain('Recorded payments were corrected; nothing counts toward this invoice.');
    expect(body).toContain('outstanding $100.00 USD');
    expect(body).not.toContain('No payments recorded.');
  });
  it('uses the native running amount and refuses contradictory running or gross facts', () => {
    const value = projection([{amount: 2500, environment: 'test'}, {amount: 1000}]);
    expect(text(value)).not.toBe('REFUSED');
    expect(renderSalesInvoiceDocument({...value, payment_ledger: {...value.payment_ledger, receivable_receipt_total_cents: 3500}})).toBeNull();
    expect(renderSalesInvoiceDocument({...value, payment_ledger: {...value.payment_ledger, rows: value.payment_ledger.rows.map((row, i) => i === 0 ? {...row, receivable_running_remaining_cents: 7500} : row)}})).toBeNull();
  });
  it.each([null, 1, 3, '2', [], {}])('refuses undeclared or unsupported evidence version %s', version => {
    const value = projection([{amount: 1000}]);
    expect(renderSalesInvoiceDocument({...value, payment_evidence_version: version})).toBeNull();
  });
  it('refuses omitted/contradictory evidence and never guesses a provider environment', () => {
    const value = projection([{amount: 1000, environment: 'test'}]);
    expect(renderSalesInvoiceDocument({...value, test_provider_verified_cents: undefined})).toBeNull();
    expect(renderSalesInvoiceDocument({...value, test_provider_cents: 500})).toBeNull();
    expect(renderSalesInvoiceDocument({...value, payment_ledger: {...value.payment_ledger, rows: [{...value.payment_ledger.rows[0], provider_environment: null}]}})).toBeNull();
  });
  it.each(variants)('$renderer portal=$portal never presents a voided obligation as money currently owed', ({renderer, portal}) => {
    const value = {...projection([{amount: 1000}], renderer, portal), status: 'void'};
    const body = text(value);
    expect(body).toContain('Nothing owed: this invoice was voided.');
    expect(body).toContain('Payment recorded');
    expect(body).not.toMatch(/Current outstanding|= outstanding/);
  });
});
