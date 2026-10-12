import { calculateCashForecast } from './cash-forecast.ts';

// Pure projection of an authorized planning RPC response. This is not an access
// grant or provider adapter. Six decimal places are internal arithmetic precision,
// never an assertion about the currency's minor-unit denomination.
type Event = { id: string; source_label: string; date: string; direction: 'inflow' | 'outflow'; amount: string; occurrence_ref: string | null };
type Config = { title: string; currency: string; start_date: string; horizon_days: 30 | 60 | 90; opening_cash: string | null; cash_floor: string | null; events: Event[]; assumptions: string };
type AuthorizedPlan = {
  id: string; entity_id: string; version: number; current_version: number; config: Config;
  company_identity_current: boolean; basis: 'owner_entered_assumptions'; amount_unit: 'decimal_major';
  verified_opening_cash: null; contractual_obligations: null; guaranteed_result: false;
  receipt_run_id: string; created_at: string;
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const decimal = (v: unknown, signed = false): v is string => typeof v === 'string' && (signed ? /^-?\d{1,24}(\.\d{1,6})?$/ : /^\d{1,24}(\.\d{1,6})?$/).test(v);
const scaled = (value: string | null) => {
  if (value === null) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (BigInt(whole + fraction.padEnd(6, '0')) * (negative ? -1n : 1n)).toString();
};
const major = (value: string) => {
  const amount = BigInt(value), negative = amount < 0n, magnitude = negative ? -amount : amount;
  return `${negative ? '-' : ''}${magnitude / 1000000n}.${(magnitude % 1000000n).toString().padStart(6, '0')}`;
};
const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, daily: null, verifiedOpeningCash: null,
  guaranteed: false, financialEffectsExecuted: false, providerCoverageVerified: false });

export function projectOwnerCashScenario(value: unknown) {
  if (!object(value) || !closed(value, ['id','entity_id','version','current_version','config','company_identity_current','basis','amount_unit','verified_opening_cash','contractual_obligations','guaranteed_result','receipt_run_id','created_at'])
    || !text(value.id, 100) || !text(value.entity_id, 100) || !text(value.receipt_run_id, 100)
    || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || !Number.isSafeInteger(value.current_version)
    || (value.current_version as number) < (value.version as number)
    || value.basis !== 'owner_entered_assumptions' || value.amount_unit !== 'decimal_major'
    || value.verified_opening_cash !== null || value.contractual_obligations !== null || value.guaranteed_result !== false
    || typeof value.company_identity_current !== 'boolean' || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) return unavailable('invalid_plan_envelope');
  if (!value.company_identity_current) return unavailable('company_identity_changed');
  const c = value.config;
  if (!object(c) || !closed(c, ['title','currency','start_date','horizon_days','opening_cash','cash_floor','events','assumptions'])
    || !text(c.title, 200) || typeof c.currency !== 'string' || !/^[A-Z]{3}$/.test(c.currency)
    || typeof c.start_date !== 'string' || ![30,60,90].includes(c.horizon_days as number)
    || c.opening_cash !== null && !decimal(c.opening_cash, true) || c.cash_floor !== null && !decimal(c.cash_floor)
    || typeof c.assumptions !== 'string' || c.assumptions.length > 10000 || !Array.isArray(c.events) || c.events.length > 5000) return unavailable('invalid_plan_configuration');
  for (const event of c.events) {
    if (!object(event) || !closed(event, ['id','source_label','date','direction','amount','occurrence_ref'])
      || !text(event.id, 100) || !text(event.source_label, 500) || typeof event.date !== 'string'
      || !['inflow','outflow'].includes(event.direction as string) || !decimal(event.amount)
      || event.occurrence_ref !== null && !text(event.occurrence_ref, 500)) return unavailable('invalid_owner_event');
  }
  const plan = value as unknown as AuthorizedPlan, config = plan.config;
  const calculation = calculateCashForecast({ companyId: plan.entity_id, currency: config.currency, minorUnitScale: 6,
    startDate: config.start_date, horizonDays: config.horizon_days, openingCashMinor: scaled(config.opening_cash), cashFloorMinor: scaled(config.cash_floor),
    openingEvidenceRef: `owner-assumption:${plan.id}:${plan.version}`, sourceAsOf: config.start_date, scenarioVersion: plan.version,
    coverage: 'partial', events: config.events.map(e => ({ id: e.id, obligationId: e.occurrence_ref, date: e.date, currency: config.currency,
      amountMinor: scaled(e.amount), direction: e.direction, basis: 'owner_assumption', sourceRef: `owner-assumption:${plan.id}:${e.id}`, sourceVersion: String(plan.version) })) });
  if (calculation.status === 'unavailable') return unavailable(calculation.reason);
  return { status: 'owner_assumption_scenario' as const, basis: plan.basis, amountUnit: 'decimal_major', currency: config.currency,
    scenarioId: plan.id, entityId: plan.entity_id, version: plan.version, currentVersion: plan.current_version,
    recordedAt: plan.created_at, effectiveStartDate: config.start_date, receiptRunId: plan.receipt_run_id,
    assumptions: config.assumptions, events: config.events.map(e => ({ ...e })),
    daily: calculation.daily.map(d => ({ date: d.date, openingCash: major(d.openingCashMinor), inflows: major(d.inflowMinor),
      outflows: major(d.outflowMinor), closingCash: major(d.closingCashMinor), eventIds: d.eventIds })),
    endingCash: major(calculation.endingCashMinor), minimumCash: major(calculation.minimumCashMinor), firstBelowFloor: calculation.firstBelowFloor,
    verifiedOpeningCash: null, contractualObligations: null, providerCoverageVerified: false, guaranteed: false,
    intradayLiquidityAssessed: false, financialEffectsExecuted: false };
}
