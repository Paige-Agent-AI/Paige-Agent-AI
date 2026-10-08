/** Explicit invoice facts only. Charges identify INCLUDED line amounts, never additional debt.
 * Missing legacy facts remain unknown; this contract grants no tax, signing or payment authority.
 */
export type CommercialCharge = { line_index: number; amount_minor: number; currency: 'usd' };
export type CommercialTreatment = {
  state: 'unknown' | 'not_applicable' | 'recorded';
  charges: CommercialCharge[];
  source: string | null;
  policy: string | null;
};
export type CommercialConditions = { schema_version: 1; tax: CommercialTreatment; fees: CommercialTreatment };
export type ResolvedCommercialLine = { unit_minor: number; quantity: number };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const invalid = (): never => { throw Error('INVALID_COMMERCIAL_CONDITIONS'); };

function treatment(value: unknown): CommercialTreatment {
  if (!object(value) || !exact(value, ['state', 'charges', 'source', 'policy']) || !Array.isArray(value.charges)) return invalid();
  if (!['unknown', 'not_applicable', 'recorded'].includes(String(value.state))) return invalid();
  const state = value.state as CommercialTreatment['state'];
  if (state === 'unknown') {
    if (value.source !== null || value.policy !== null || value.charges.length !== 0) return invalid();
    return { state, charges: [], source: null, policy: null };
  }
  if (!bounded(value.source, 200) || !bounded(value.policy, 1000)) return invalid();
  if (state === 'not_applicable' && value.charges.length !== 0) return invalid();
  if (state === 'recorded' && (value.charges.length < 1 || value.charges.length > 10)) return invalid();
  const seen = new Set<number>();
  const charges = value.charges.map(raw => {
    if (!object(raw) || !exact(raw, ['line_index', 'amount_minor', 'currency'])
      || !integer(raw.line_index, 0, 49) || !integer(raw.amount_minor, 1, 2147483647)
      || raw.currency !== 'usd' || seen.has(raw.line_index)) return invalid();
    seen.add(raw.line_index);
    return { line_index: raw.line_index, amount_minor: raw.amount_minor, currency: 'usd' as const };
  });
  return { state, charges, source: value.source, policy: value.policy };
}

/** null is absence, not a declaration that tax or fees are zero. */
export function parseCommercialConditions(value: unknown): CommercialConditions | null {
  if (value === undefined || value === null) return null;
  if (!object(value) || !exact(value, ['schema_version', 'tax', 'fees']) || value.schema_version !== 1) return invalid();
  return { schema_version: 1, tax: treatment(value.tax), fees: treatment(value.fees) };
}

/** Validate after the existing invoice engine resolves catalog/custom line prices.
 * Combined tax and fee amounts cannot exceed the line they annotate. No total is produced.
 */
export function validateCommercialConditionLines(
  conditions: CommercialConditions | null,
  lines: readonly ResolvedCommercialLine[],
  currency = 'usd',
): void {
  const fail = (): never => { throw Error('INVALID_COMMERCIAL_CONDITION_LINES'); };
  if (!Array.isArray(lines) || lines.length > 50 || currency !== 'usd'
    || lines.some(line => !object(line) || !integer(line.unit_minor, 1, 2147483647) || !integer(line.quantity, 1, 1000))) return fail();
  if (conditions === null) return;
  // Re-parse so callers cannot skip the structural boundary with a type assertion.
  const parsed = parseCommercialConditions(conditions)!;
  const included = new Map<number, bigint>();
  for (const charge of [...parsed.tax.charges, ...parsed.fees.charges]) {
    const line = lines[charge.line_index];
    if (!line || charge.currency !== currency) return fail();
    const sum = (included.get(charge.line_index) ?? 0n) + BigInt(charge.amount_minor);
    if (sum > BigInt(line.unit_minor) * BigInt(line.quantity)) return fail();
    included.set(charge.line_index, sum);
  }
}
