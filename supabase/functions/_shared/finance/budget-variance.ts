// Pure calculation only. Server-resolved authority, accounting classification,
// company/source evidence, budget mapping and persistence remain caller duties.
export type BudgetVarianceInput = {
  companyId: string; currency: string; periodStart: string; periodEnd: string; basis: 'cash' | 'accrual';
  budgetVersion: number; mappingBudgetVersion: number; mappingVersion: string;
  sourceRef: string; sourceVersion: string; sourcePeriodStart: string; sourcePeriodEnd: string;
  coverage: 'complete' | 'partial'; mappingCoverage: 'complete' | 'partial';
  lines: { id: string; sourceLabel: string; direction: 'income' | 'expense'; plannedAmount: string }[];
  actuals: { id: string; lineId: string; companyId: string; currency: string; basis: 'cash' | 'accrual'; date: string; amount: string | null; kind: 'recognized_revenue' | 'recognized_expense'; sourceRef: string }[];
};
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 500;
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const decimal = (v: unknown, signed = true): bigint | null => {
  if (typeof v !== 'string' || !(signed ? /^-?\d{1,24}(?:\.\d{1,6})?$/ : /^\d{1,24}(?:\.\d{1,6})?$/).test(v)) return null;
  const negative = v.startsWith('-'), [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) * (negative ? -1n : 1n);
};
const format = (v: bigint) => { const magnitude = v < 0n ? -v : v, fraction = String(magnitude % 1_000_000n).padStart(6, '0').replace(/0+$/, ''); return `${v < 0n ? '-' : ''}${magnitude / 1_000_000n}${fraction ? '.' + fraction : ''}`; };
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, lines: null });

export function calculateBudgetVariance(input: BudgetVarianceInput) {
  if (!input || !text(input.companyId) || !/^[A-Z]{3}$/.test(input.currency) || !day(input.periodStart) || !day(input.periodEnd)
    || input.periodEnd < input.periodStart || (Date.parse(input.periodEnd) - Date.parse(input.periodStart)) / 86_400_000 > 366
    || !['cash', 'accrual'].includes(input.basis) || !Number.isSafeInteger(input.budgetVersion) || input.budgetVersion < 1
    || input.mappingBudgetVersion !== input.budgetVersion || !text(input.mappingVersion) || !text(input.sourceRef) || !text(input.sourceVersion)
    || input.sourcePeriodStart !== input.periodStart || input.sourcePeriodEnd !== input.periodEnd
    || !['complete', 'partial'].includes(input.coverage) || !['complete', 'partial'].includes(input.mappingCoverage)
    || !Array.isArray(input.lines) || input.lines.length > 500 || !Array.isArray(input.actuals) || input.actuals.length > 5000) return unavailable('invalid_variance_scope');
  const lines = new Map<string, { sourceLabel: string; direction: 'income' | 'expense'; planned: bigint; recorded: bigint; refs: string[] }>();
  for (const line of input.lines) {
    const planned = decimal(line?.plannedAmount, false);
    if (!line || !text(line.id) || !text(line.sourceLabel) || !['income', 'expense'].includes(line.direction) || planned === null || lines.has(line.id)) return unavailable('invalid_budget_line');
    lines.set(line.id, { sourceLabel: line.sourceLabel, direction: line.direction, planned, recorded: 0n, refs: [] });
  }
  const ids = new Set<string>();
  for (const actual of input.actuals) {
    const line = actual ? lines.get(actual.lineId) : null, amount = decimal(actual?.amount);
    if (!actual || !text(actual.id) || !text(actual.sourceRef) || !line || actual.companyId !== input.companyId || actual.currency !== input.currency || actual.basis !== input.basis
      || !day(actual.date) || actual.date < input.periodStart || actual.date > input.periodEnd
      || actual.kind !== (line.direction === 'income' ? 'recognized_revenue' : 'recognized_expense')) return unavailable('invalid_actual_scope_or_classification');
    // IDs are canonical accounting record/line identities, not provider names or masks.
    // Conflicting source copies must be reconciled before calculation.
    if (ids.has(actual.id)) return unavailable('unresolved_actual_duplicate');
    ids.add(actual.id);
    if (amount === null) return unavailable('actual_amount_unknown');
    line.recorded += amount; line.refs.push(actual.sourceRef);
  }
  const complete = input.coverage === 'complete' && input.mappingCoverage === 'complete';
  return {
    status: complete ? 'calculated_variance' as const : 'partial_actuals' as const, reason: null,
    companyId: input.companyId, currency: input.currency, basis: input.basis, periodStart: input.periodStart, periodEnd: input.periodEnd,
    budgetVersion: input.budgetVersion, mappingVersion: input.mappingVersion, sourceRef: input.sourceRef, sourceVersion: input.sourceVersion,
    lines: [...lines].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, line]) => ({
      id, sourceLabel: line.sourceLabel, direction: line.direction, plannedAmount: format(line.planned),
      recordedActualAmount: format(line.recorded), actualAmount: complete ? format(line.recorded) : null,
      actualMinusPlanned: complete ? format(line.recorded - line.planned) : null,
      favorableVariance: complete ? format(line.direction === 'income' ? line.recorded - line.planned : line.planned - line.recorded) : null,
      sourceRefs: [...new Set(line.refs)].sort(),
    })),
    financialEffectsExecuted: false, profitabilityCalculated: false,
  };
}
