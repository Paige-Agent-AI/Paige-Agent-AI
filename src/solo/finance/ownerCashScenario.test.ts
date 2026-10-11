import { describe, expect, it } from 'vitest';
import { projectOwnerCashScenario } from '../../../supabase/functions/_shared/finance/owner-cash-scenario';

const plan = () => ({ id: 'scenario-a', entity_id: 'company-a', version: 1, current_version: 1,
  company_identity_current: true, basis: 'owner_entered_assumptions', amount_unit: 'decimal_major', verified_opening_cash: null,
  contractual_obligations: null, guaranteed_result: false, receipt_run_id: 'receipt-a', created_at: '2026-10-10T21:00:00Z',
  config: { title: 'Owner scenario', currency: 'EUR', start_date: '2026-11-01', horizon_days: 30, opening_cash: '100.000001', cash_floor: '50',
    events: [{ id: 'expense', source_label: 'Original vendor wording', date: '2026-11-02', direction: 'outflow', amount: '60', occurrence_ref: null }],
    assumptions: 'Owner estimate; not verified company cash' } });
describe('owner cash scenario projection', () => {
  it('reuses exact cash arithmetic and preserves assumption provenance', () => {
    const result = projectOwnerCashScenario(plan());
    expect(result).toMatchObject({ status: 'owner_assumption_scenario', amountUnit: 'decimal_major', endingCash: '40.000001',
      minimumCash: '40.000001', firstBelowFloor: '2026-11-02', verifiedOpeningCash: null, providerCoverageVerified: false,
      contractualObligations: null, guaranteed: false, financialEffectsExecuted: false });
    expect(result.daily).toHaveLength(30);
    expect(result).not.toHaveProperty('minorUnitScale');
  });
  it('does not turn unknown opening cash into zero', () => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, opening_cash: null } })).toMatchObject({ status: 'unavailable', daily: null });
  });
  it('preserves negative opening assumptions and six-place precision', () => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, opening_cash: '-0.000001', events: [] } })).toMatchObject({ endingCash: '-0.000001' });
  });
  it.each([30,60,90])('supports %s days', horizon_days => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, horizon_days } }).daily).toHaveLength(horizon_days);
  });
  it('rejects changed company identity', () => {
    expect(projectOwnerCashScenario({ ...plan(), company_identity_current: false })).toMatchObject({ status: 'unavailable', reason: 'company_identity_changed' });
  });
  it.each([100, '1e6', '1.0000001', '9007199254740993123456789.01'])('rejects invalid opening amount %s', opening_cash => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, opening_cash } }).status).toBe('unavailable');
  });
  it('handles large amounts without floating-point loss', () => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, opening_cash: '9007199254740993.000001', events: [] } })).toMatchObject({ endingCash: '9007199254740993.000001' });
  });
  it('refuses duplicate occurrences instead of double counting debt service', () => {
    const event = { ...plan().config.events[0], occurrence_ref: 'obligation-a' };
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, events: [event, { ...event, id: 'other-source' }] } }).status).toBe('unavailable');
  });
  it.each(['2026-02-30','2026-12-01'])('refuses invalid or out-of-horizon event %s', date => {
    expect(projectOwnerCashScenario({ ...plan(), config: { ...plan().config, events: [{ ...plan().config.events[0], date }] } }).status).toBe('unavailable');
  });
  it('refuses source claims and unknown envelope fields', () => {
    expect(projectOwnerCashScenario({ ...plan(), verified_opening_cash: '100' }).status).toBe('unavailable');
    expect(projectOwnerCashScenario({ ...plan(), access_token: 'unexpected' }).status).toBe('unavailable');
  });
  it('does not mutate the persisted assumptions', () => {
    const input = plan(), before = JSON.stringify(input);
    projectOwnerCashScenario(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
