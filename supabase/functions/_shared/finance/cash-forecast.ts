// Deterministic scenario math only. Server-resolved company/source authority,
// canonical evidence issuance and versioned persistence are caller requirements.
// Available credit, revenue recognition and accounting profit are not cash inputs.
export type CashEvent = {
  id: string; obligationId: string | null; date: string; currency: string; amountMinor: string | null;
  direction: 'inflow' | 'outflow'; basis: 'scheduled_obligation' | 'collection_estimate' | 'owner_assumption';
  sourceRef: string; sourceVersion: string;
};
export type CashForecastInput = {
  companyId: string; currency: string; minorUnitScale: number; startDate: string; horizonDays: 30 | 60 | 90;
  openingCashMinor: string | null; cashFloorMinor: string | null; openingEvidenceRef: string;
  sourceAsOf: string; scenarioVersion: number; coverage: 'complete' | 'partial'; events: CashEvent[];
};
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const amount = (v: unknown): v is string => typeof v === 'string' && /^\d{1,30}$/.test(v);
const cashAmount = (v: unknown): v is string => typeof v === 'string' && /^-?\d{1,30}$/.test(v);
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const dayAt = (date: string, offset: number) => new Date(Date.parse(date) + offset * 86_400_000).toISOString().slice(0, 10);
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const refused = (reason: string) => ({ status: 'unavailable' as const, reason, daily: null, endingCashMinor: null, minimumCashMinor: null, firstBelowFloor: null });

export function calculateCashForecast(input: CashForecastInput) {
  if (!input || !text(input.companyId) || !/^[A-Z]{3}$/.test(input.currency) || !Number.isInteger(input.minorUnitScale)
    || input.minorUnitScale < 0 || input.minorUnitScale > 6 || !day(input.startDate) || ![30, 60, 90].includes(input.horizonDays)
    || !text(input.openingEvidenceRef) || !day(input.sourceAsOf) || input.sourceAsOf > input.startDate
    || !Number.isSafeInteger(input.scenarioVersion) || input.scenarioVersion < 1 || !['complete', 'partial'].includes(input.coverage)
    || !Array.isArray(input.events) || input.events.length > 5000) return refused('invalid_scenario');
  if (!cashAmount(input.openingCashMinor)) return refused('opening_cash_unknown');
  if (input.cashFloorMinor !== null && !amount(input.cashFloorMinor)) return refused('invalid_cash_floor');
  const endDate = dayAt(input.startDate, input.horizonDays - 1);
  if (!day(endDate)) return refused('invalid_scenario');
  const ids = new Set<string>(), obligations = new Set<string>();
  const byDate = new Map<string, { inflows: bigint; outflows: bigint; events: CashEvent[] }>();
  for (const event of input.events) {
    if (!event || !text(event.id) || !day(event.date) || event.currency !== input.currency
      || !['inflow', 'outflow'].includes(event.direction) || !['scheduled_obligation', 'collection_estimate', 'owner_assumption'].includes(event.basis)
      || !text(event.sourceRef) || !text(event.sourceVersion) || event.obligationId !== null && !text(event.obligationId)) return refused('invalid_event');
    if (ids.has(event.id)) return refused('duplicate_event');
    ids.add(event.id);
    // A canonical obligation appears once, even when accounting and lender sources
    // both supply it. Callers must reconcile conflicts before calculating a scenario.
    if (event.obligationId !== null) {
      if (obligations.has(event.obligationId)) return refused('unresolved_obligation_duplicate');
      obligations.add(event.obligationId);
    }
    if (event.date < input.startDate || event.date > endDate) return refused('event_outside_horizon');
    if (!amount(event.amountMinor)) return refused('event_amount_unknown');
    const bucket = byDate.get(event.date) ?? { inflows: 0n, outflows: 0n, events: [] };
    if (event.direction === 'inflow') bucket.inflows += BigInt(event.amountMinor); else bucket.outflows += BigInt(event.amountMinor);
    bucket.events.push({ ...event }); byDate.set(event.date, bucket);
  }
  let cash = BigInt(input.openingCashMinor), minimum = cash;
  const floor = input.cashFloorMinor === null ? null : BigInt(input.cashFloorMinor);
  let firstBelowFloor: string | null = floor !== null && cash < floor ? input.startDate : null;
  const daily = [];
  for (let offset = 0; offset < input.horizonDays; offset++) {
    const date = dayAt(input.startDate, offset), bucket = byDate.get(date) ?? { inflows: 0n, outflows: 0n, events: [] };
    const opening = cash;
    cash += bucket.inflows - bucket.outflows;
    if (cash < minimum) minimum = cash;
    if (firstBelowFloor === null && floor !== null && cash < floor) firstBelowFloor = date;
    daily.push({ date, openingCashMinor: opening.toString(), inflowMinor: bucket.inflows.toString(), outflowMinor: bucket.outflows.toString(),
      closingCashMinor: cash.toString(), eventIds: bucket.events.map(e => e.id).sort() });
  }
  return {
    status: input.coverage === 'complete' ? 'calculated_scenario' as const : 'partial_scenario' as const, reason: null,
    companyId: input.companyId, currency: input.currency, minorUnitScale: input.minorUnitScale, startDate: input.startDate, endDate,
    horizonDays: input.horizonDays, scenarioVersion: input.scenarioVersion, sourceAsOf: input.sourceAsOf, openingEvidenceRef: input.openingEvidenceRef,
    daily, endingCashMinor: cash.toString(), minimumCashMinor: minimum.toString(), firstBelowFloor,
    assumptions: input.events.filter(e => e.basis !== 'scheduled_obligation').map(e => ({ ...e })).sort(byId),
    sourceReferences: [...input.events].sort(byId).map(e => ({ eventId: e.id, sourceRef: e.sourceRef, sourceVersion: e.sourceVersion })),
    guaranteed: false as const, intradayLiquidityAssessed: false as const, financialEffectsExecuted: false as const,
  };
}
