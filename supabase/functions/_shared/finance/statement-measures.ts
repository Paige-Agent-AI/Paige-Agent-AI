// Deterministic financial math over explicitly mapped historical statement facts.
// Provider normalization/verified semantic classification and company/evidence
// authority are server responsibilities; this function grants none of them.
export type StatementFigures = {
  income: string | null; costOfGoods: string | null; operatingExpenses: string | null;
  otherIncome: string | null; otherExpenses: string | null;
  reportedGrossProfit: string | null; reportedOperatingProfit: string | null; reportedNetProfit: string | null;
};
export type StatementInput = {
  companyId: string; currency: string; basis: 'cash' | 'accrual'; periodStart: string; periodEnd: string;
  sourceRef: string; sourceVersion: string; classificationVersion: string; sourceCoverage: 'complete' | 'partial';
  factKind: 'historical_statement'; figures: StatementFigures;
};
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 500;
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const amount = (v: string) => { const negative = v.startsWith('-'), [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.'); return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) * (negative ? -1n : 1n); };
const format = (v: bigint, scale = 6) => { const magnitude = v < 0n ? -v : v, factor = 10n ** BigInt(scale), fraction = String(magnitude % factor).padStart(scale, '0').replace(/0+$/, ''); return `${v < 0n ? '-' : ''}${magnitude / factor}${fraction ? '.' + fraction : ''}`; };
function margin(profit: bigint | null, income: bigint | null) {
  if (profit === null || income === null || income <= 0n) return null;
  const numerator = (profit < 0n ? -profit : profit) * 1_000_000n;
  let quotient = numerator / income;
  if (numerator % income * 2n >= income) quotient++;
  return format(profit < 0n ? -quotient : quotient, 4);
}
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, measures: null, bankCashCalculated: false, financialEffectsExecuted: false });

export function calculateStatementMeasures(input: StatementInput) {
  if (!input || !text(input.companyId) || !/^[A-Z]{3}$/.test(input.currency) || !['cash', 'accrual'].includes(input.basis)
    || !day(input.periodStart) || !day(input.periodEnd) || input.periodEnd < input.periodStart
    || !text(input.sourceRef) || !text(input.sourceVersion) || !text(input.classificationVersion)
    || !['complete', 'partial'].includes(input.sourceCoverage) || input.factKind !== 'historical_statement'
    || !input.figures || typeof input.figures !== 'object' || Array.isArray(input.figures)) return unavailable('invalid_statement_scope');
  const keys = ['income', 'costOfGoods', 'operatingExpenses', 'otherIncome', 'otherExpenses', 'reportedGrossProfit', 'reportedOperatingProfit', 'reportedNetProfit'] as const;
  if (Object.keys(input.figures).length !== keys.length || Object.keys(input.figures).some(key => !keys.includes(key as typeof keys[number]))) return unavailable('invalid_statement_figures');
  const figures = {} as Record<typeof keys[number], bigint | null>;
  for (const key of keys) {
    const value = input.figures[key];
    if (value !== null && (typeof value !== 'string' || !/^-?\d{1,24}(?:\.\d{1,6})?$/.test(value))) return unavailable('invalid_statement_amount');
    figures[key] = value === null ? null : amount(value);
  }
  const gross = figures.income !== null && figures.costOfGoods !== null ? figures.income - figures.costOfGoods : null;
  // Reported native subtotals are source facts, not inferred missing components.
  // Use them to check downstream totals when the report omits detailed sections.
  const grossBasis = gross ?? figures.reportedGrossProfit;
  const operating = grossBasis !== null && figures.operatingExpenses !== null ? grossBasis - figures.operatingExpenses : null;
  const operatingBasis = operating ?? figures.reportedOperatingProfit;
  const net = operatingBasis !== null && figures.otherIncome !== null && figures.otherExpenses !== null ? operatingBasis + figures.otherIncome - figures.otherExpenses : null;
  if (gross !== null && figures.reportedGrossProfit !== null && gross !== figures.reportedGrossProfit
    || operating !== null && figures.reportedOperatingProfit !== null && operating !== figures.reportedOperatingProfit
    || net !== null && figures.reportedNetProfit !== null && net !== figures.reportedNetProfit) return unavailable('statement_component_conflict');
  const complete = input.sourceCoverage === 'complete';
  const grossSupported = complete ? figures.reportedGrossProfit ?? gross : null;
  const operatingSupported = complete ? figures.reportedOperatingProfit ?? operating : null;
  const netSupported = complete ? figures.reportedNetProfit ?? net : null;
  const incomeSupported = complete ? figures.income : null;
  return {
    status: complete && netSupported !== null ? 'supported_statement' as const : 'partial_statement' as const,
    reason: null, companyId: input.companyId, currency: input.currency, basis: input.basis,
    periodStart: input.periodStart, periodEnd: input.periodEnd, sourceRef: input.sourceRef, sourceVersion: input.sourceVersion,
    classificationVersion: input.classificationVersion, sourceFigures: { ...input.figures },
    measures: {
      statementIncome: incomeSupported === null ? null : format(incomeSupported),
      incomeBasis: input.basis === 'accrual' ? 'accrual_statement_income' : 'cash_basis_statement_income',
      grossProfit: grossSupported === null ? null : format(grossSupported),
      operatingProfit: operatingSupported === null ? null : format(operatingSupported),
      netProfit: netSupported === null ? null : format(netSupported),
      grossMarginPercent: margin(grossSupported, incomeSupported), operatingMarginPercent: margin(operatingSupported, incomeSupported), netMarginPercent: margin(netSupported, incomeSupported),
      marginRounding: 'nearest_0.0001_percentage_point_half_away_from_zero',
    },
    bankCashCalculated: false, financialEffectsExecuted: false,
  };
}
