import { describe, expect, it } from 'vitest';
import { parseCommercialConditions, validateCommercialConditionLines } from '../../supabase/functions/_shared/sales-commercial/conditions';
import { assembleFixedRepaymentSchedule } from '../../supabase/functions/_shared/sales-collections/model';

const none = () => ({ state: 'not_applicable', charges: [], source: 'Explicit recorded invoice terms', policy: 'No additional charge' });
const unknown = () => ({ state: 'unknown', charges: [], source: null, policy: null });
const charge = (line_index = 0, amount_minor = 500) => ({ line_index, amount_minor, currency: 'usd' });
const recorded = () => ({ state: 'recorded', charges: [charge()], source: 'Recorded invoice line', policy: 'Included in the recorded invoice amount' });
const conditions = () => ({ schema_version: 1, tax: none(), fees: none() });

describe('explicit commercial conditions', () => {
  it('keeps omitted or null legacy facts unknown without creating a zero-charge declaration', () => {
    expect(parseCommercialConditions(undefined)).toBeNull();
    expect(parseCommercialConditions(null)).toBeNull();
  });
  it('preserves explicit unknown and no-charge facts independently', () => {
    const input = { ...conditions(), tax: unknown() };
    expect(parseCommercialConditions(input)).toEqual(input);
    expect(parseCommercialConditions(conditions())).toEqual(conditions());
  });
  it.each([
    {}, { ...conditions(), schema_version: 2 }, { ...conditions(), approved: true },
    { ...conditions(), tax: { ...none(), state: 'exempt' } },
    { ...conditions(), tax: { ...none(), source: null } },
    { ...conditions(), tax: { ...none(), policy: ' ' } },
    { ...conditions(), tax: { ...none(), source: 'x'.repeat(201) } },
    { ...conditions(), tax: { ...none(), policy: 'x'.repeat(1001) } },
    { ...conditions(), tax: { ...unknown(), source: 'Invented declaration' } },
    { ...conditions(), tax: { ...none(), charges: [charge()] } },
    { ...conditions(), tax: { ...recorded(), charges: [] } },
    { ...conditions(), tax: { ...recorded(), rate: 0.1 } },
    { ...conditions(), tax: { ...recorded(), charges: [ { ...charge(), currency: 'eur' } ] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(-1)] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(50)] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(0, 0)] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(0, 1.5)] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(0, 2147483648)] } },
    { ...conditions(), tax: { ...recorded(), charges: [ { ...charge(), approved: true } ] } },
    { ...conditions(), tax: { ...recorded(), charges: [charge(), charge()] } },
    { ...conditions(), tax: { ...recorded(), charges: Array.from({ length: 11 }, (_, i) => charge(i)) } },
  ])('rejects malformed, fabricated or unbounded declarations %#', input => {
    expect(() => parseCommercialConditions(input)).toThrow('INVALID_COMMERCIAL_CONDITIONS');
  });
  it('returns an isolated closed projection rather than retaining mutable caller arrays', () => {
    const input = { ...conditions(), tax: recorded() };
    const parsed = parseCommercialConditions(input)!;
    input.tax.charges[0].amount_minor = 900;
    expect(parsed.tax.charges[0].amount_minor).toBe(500);
  });
  it('reconciles included recorded charges without adding them to invoice economics', () => {
    const parsed = parseCommercialConditions({ ...conditions(), tax: recorded(), fees: { ...recorded(), charges: [charge(0, 250)] } });
    const lines = [{ unit_minor: 350000, quantity: 1 }];
    validateCommercialConditionLines(parsed, lines);
    expect(lines).toEqual([{ unit_minor: 350000, quantity: 1 }]);
  });
  it.each([
    [{ unit_minor: 499, quantity: 1 }], [], [{ unit_minor: -1, quantity: 1 }],
    [{ unit_minor: 500, quantity: 1.5 }], [{ unit_minor: 2147483647, quantity: 1001 }],
  ])('rejects charges outside resolved valid invoice lines %#', lines => {
    expect(() => validateCommercialConditionLines(parseCommercialConditions({ ...conditions(), tax: recorded() }), lines)).toThrow('INVALID_COMMERCIAL_CONDITION_LINES');
  });
  it('checks combined tax and fee declarations against each line, including quantity', () => {
    const parsed = parseCommercialConditions({ ...conditions(), tax: recorded(), fees: recorded() });
    expect(() => validateCommercialConditionLines(parsed, [{ unit_minor: 999, quantity: 1 }])).toThrow();
    expect(() => validateCommercialConditionLines(parsed, [{ unit_minor: 500, quantity: 2 }])).not.toThrow();
    expect(() => validateCommercialConditionLines(parsed, [{ unit_minor: 1000, quantity: 1 }], 'eur')).toThrow();
  });
  it('preserves exact principal schedule with explicit dates and explicitly recorded no additional charges', () => {
    const parsed = parseCommercialConditions(conditions());
    validateCommercialConditionLines(parsed, [{ unit_minor: 350000, quantity: 1 }]);
    const schedule = assembleFixedRepaymentSchedule({ total_cents: 350000, currency: 'usd', deposit_cents: 50000, deposit_date: '2026-10-15', installment_cents: 30000, first_installment_date: '2026-11-01', cadence: 'monthly' });
    expect(schedule.state).toBe('ready');
    if (schedule.state !== 'ready') throw Error('fixture');
    expect(schedule.rows.map(row => row.amount_cents)).toEqual([50000, ...Array(10).fill(30000)]);
    expect(schedule.rows.map(row => row.due_date)).toEqual(['2026-10-15', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01']);
    expect(schedule.remaining_after_deposit_cents).toBe(300000);
  });
});
