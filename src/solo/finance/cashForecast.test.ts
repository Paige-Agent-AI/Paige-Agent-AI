import { describe, expect, it } from 'vitest';
import { calculateCashForecast, type CashEvent, type CashForecastInput } from '../../../supabase/functions/_shared/finance/cash-forecast';
const event = (id: string, overrides: Partial<CashEvent> = {}): CashEvent => ({ id, obligationId: null, date: '2026-10-11', currency: 'USD', amountMinor: '100', direction: 'outflow', basis: 'scheduled_obligation', sourceRef: 'controlled-source', sourceVersion: 'v1', ...overrides });
const input = (overrides: Partial<CashForecastInput> = {}): CashForecastInput => ({ companyId: 'controlled-company', currency: 'USD', minorUnitScale: 2, startDate: '2026-10-10', horizonDays: 30, openingCashMinor: '1000', cashFloorMinor: '500', openingEvidenceRef: 'controlled-cash-evidence', sourceAsOf: '2026-10-10', scenarioVersion: 1, coverage: 'complete', events: [], ...overrides });
describe('reproducible cash scenarios, no provider calls or financial effects', () => {
  it.each([30, 60, 90] as const)('produces exactly %i dated daily projections with explicit scenario provenance', horizonDays => {
    const result = calculateCashForecast(input({ horizonDays }));
    expect(result.daily).toHaveLength(horizonDays);
    expect(result).toMatchObject({ status: 'calculated_scenario', endingCashMinor: '1000', minimumCashMinor: '1000', guaranteed: false, intradayLiquidityAssessed: false, financialEffectsExecuted: false, scenarioVersion: 1 });
  });
  it('keeps scheduled obligations, owner assumptions and collection estimates attributable', () => {
    const events = [event('bill', { obligationId: 'scheduled-bill-payment', amountMinor: '900' }), event('collection', { direction: 'inflow', basis: 'collection_estimate', date: '2026-10-12', amountMinor: '200' }), event('owner', { basis: 'owner_assumption', date: '2026-10-13', amountMinor: '500' })];
    const result = calculateCashForecast(input({ events }));
    expect(result).toMatchObject({ endingCashMinor: '-200', minimumCashMinor: '-200', firstBelowFloor: '2026-10-11', assumptions: [{ id: 'collection' }, { id: 'owner' }] });
    expect(result.daily?.[1]).toMatchObject({ openingCashMinor: '1000', outflowMinor: '900', closingCashMinor: '100' });
  });
  it('is order independent and does not mutate source events', () => {
    const events = [event('b'), event('a', { direction: 'inflow' })];
    const before = JSON.stringify(events);
    expect(calculateCashForecast(input({ events }))).toEqual(calculateCashForecast(input({ events: [...events].reverse() })));
    expect(JSON.stringify(events)).toBe(before);
  });
  it('does exact arithmetic beyond floating-point safety without currency conversion', () => {
    expect(calculateCashForecast(input({ openingCashMinor: '9007199254740993000', events: [event('huge', { amountMinor: '9007199254740993001' })] }))).toMatchObject({ endingCashMinor: '-1', minimumCashMinor: '-1' });
  });
  it('never turns unknown opening cash or scheduled amounts into zero', () => {
    expect(calculateCashForecast(input({ openingCashMinor: null }))).toMatchObject({ status: 'unavailable', reason: 'opening_cash_unknown', daily: null });
    expect(calculateCashForecast(input({ events: [event('unknown', { amountMinor: null })] }))).toMatchObject({ status: 'unavailable', reason: 'event_amount_unknown', daily: null });
  });
  it('marks incomplete source coverage as partial even when all selected amounts are known', () => {
    expect(calculateCashForecast(input({ coverage: 'partial' }))).toMatchObject({ status: 'partial_scenario', guaranteed: false });
  });
  it('preserves evidenced negative opening cash instead of replacing it with zero or available credit', () => {
    expect(calculateCashForecast(input({ openingCashMinor: '-100', cashFloorMinor: '0', events: [event('expected', { direction: 'inflow', amountMinor: '200', basis: 'collection_estimate' })] }))).toMatchObject({ endingCashMinor: '100', minimumCashMinor: '-100', firstBelowFloor: '2026-10-10' });
  });
  it('rejects duplicate cash obligations across AP and debt sources', () => {
    expect(calculateCashForecast(input({ events: [event('accounting', { obligationId: 'debt-payment-1' }), event('lender', { obligationId: 'debt-payment-1' })] }))).toMatchObject({ reason: 'unresolved_obligation_duplicate', daily: null });
  });
  it('retains distinct dated repayment obligations for the same loan', () => {
    expect(calculateCashForecast(input({ events: [event('first', { obligationId: 'loan-payment-oct' }), event('second', { obligationId: 'loan-payment-nov', date: '2026-11-01' })] }))).toMatchObject({ endingCashMinor: '800' });
  });
  it('rejects duplicate event identities instead of double counting', () => {
    expect(calculateCashForecast(input({ events: [event('same'), event('same')] }))).toMatchObject({ reason: 'duplicate_event' });
  });
  it('does not mix currency or treat invalid financial strings as amounts', () => {
    expect(calculateCashForecast(input({ events: [event('eur', { currency: 'EUR' })] }))).toMatchObject({ reason: 'invalid_event' });
    for (const amountMinor of ['1.2', '-1', '1e3', '', '9'.repeat(31)]) expect(calculateCashForecast(input({ events: [event('invalid', { amountMinor })] }))).toMatchObject({ reason: 'event_amount_unknown' });
  });
  it('refuses out-of-range or invalid dates, future source references and oversized scenarios', () => {
    expect(calculateCashForecast(input({ events: [event('old', { date: '2026-10-09' })] }))).toMatchObject({ reason: 'event_outside_horizon' });
    expect(calculateCashForecast(input({ events: [event('late', { date: '2026-11-09' })] }))).toMatchObject({ reason: 'event_outside_horizon' });
    expect(calculateCashForecast(input({ events: [event('bad', { date: '2026-02-30' })] }))).toMatchObject({ reason: 'invalid_event' });
    expect(calculateCashForecast(input({ sourceAsOf: '2026-10-11' }))).toMatchObject({ reason: 'invalid_scenario' });
    expect(calculateCashForecast(input({ startDate: '9999-12-31' }))).toMatchObject({ reason: 'invalid_scenario' });
    expect(calculateCashForecast(input({ events: Array.from({ length: 5001 }, (_, i) => event(String(i))) }))).toMatchObject({ reason: 'invalid_scenario' });
  });
  it('does not silently substitute zero for an unspecified cash floor', () => {
    expect(calculateCashForecast(input({ cashFloorMinor: null, events: [event('large', { amountMinor: '2000' })] }))).toMatchObject({ endingCashMinor: '-1000', firstBelowFloor: null });
  });
});
