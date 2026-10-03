import * as React from 'react';
import type { DraftSaveRequest, BillingDraft } from '../../../../src/solo/sales/billingDrafts';
import { useSoloCommercialTerms } from './useSoloCommercialTerms-stub';
import { useCatalogOffers } from './useCatalogOffers-stub';
// Geometry and interaction fixture only. Never authenticated or provider evidence.
function fixtureRows(): BillingDraft[] {
  if (new URLSearchParams(location.search).get('billing-fixture') !== 'populated') return [];
  return [
    { id: '11111111-1111-4111-8111-111111111111', item: 'Custom service', unit: 15000, quantity: 2, kind: 'one_time' as const, price: null, client: 'c1' },
    { id: '22222222-2222-4222-8222-222222222222', item: 'Service deposit', unit: 50000, quantity: 1, kind: 'deposit' as const, price: null, client: 'c2' },
    { id: '33333333-3333-4333-8333-333333333333', item: 'Catalog service', unit: 10000, quantity: 2, kind: 'one_time' as const, price: 'test-billing-price', client: 'c1' },
    { id: '44444444-4444-4444-8444-444444444444', item: 'Monthly advisory', unit: 240000, quantity: 1, kind: 'recurring' as const, price: 'p1', client: 'c2' },
  ].map(fixture => {
    const total = fixture.unit * fixture.quantity; const due = fixture.kind === 'deposit' ? total / 2 : total;
    return { id: fixture.id, tenantId: 'harness-tenant', version: 2, number: `DRAFT-${fixture.id}`, totalMinor: total, dueNowMinor: due, remainderMinor: total - due, facts: { client_id: fixture.client, price_id: fixture.price, item: fixture.item, unit_minor: fixture.unit, quantity: fixture.quantity, kind: fixture.kind, deposit_basis_points: fixture.kind === 'deposit' ? 5000 : null, provider: 'stripe' as const, currency: 'usd' as const, due_date: '2026-10-20', recipient_email: 'billing@example.test', memo: 'Local synthetic draft; not issued or collected.', cadence: fixture.kind === 'recurring' ? 'monthly' as const : null } };
  });
}
export function useSalesBillingDrafts() {
  const [rows, setRows] = React.useState<BillingDraft[]>(fixtureRows);
  const { tenantId } = useSoloCommercialTerms();
  const catalog = useCatalogOffers();
  return { tenantId, phase: 'ready' as const, rows, hasMore: false, nextCursor: null, message: '', pageMessage: '', loadingMore: false, loadMore() {}, retry() {}, async save(request: DraftSaveRequest) {
    const unit = request.draft.unit_minor ?? catalog.offers.flatMap(offer => offer.prices).find(price => price.id === request.draft.price_id)?.unitAmount ?? 0;
    const total = unit * request.draft.quantity;
    const due = request.draft.kind === 'deposit' ? Math.round(total * (request.draft.deposit_basis_points ?? 5000) / 10000) : total;
    const row: BillingDraft = { id: request.invoiceId, tenantId: request.openedTenantId, version: request.expectedVersion + 1, number: `DRAFT-${request.invoiceId}`, facts: { ...request.draft, unit_minor: unit }, totalMinor: total, dueNowMinor: due, remainderMinor: total - due };
    setRows(previous => [...previous.filter(r => r.id !== row.id), row]);
    return { ok: true as const, value: row };
  } };
}
