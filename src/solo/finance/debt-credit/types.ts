export type DebtCreditPhase = "resolving" | "loading" | "ready" | "partial" | "unavailable" | "error" | "denied";
export type DebtCreditProduct = "business_card" | "revolving_line" | "term_loan" | "other_financing";
export interface DebtCreditObligation {
 obligationId: string; accountId: string;
 entity: { id: string; label: string }; currency: string;
 institution: { id: string; label: string }; product: DebtCreditProduct; originalLabel: string;
 /** Nullable, strict nonnegative decimal-integer minor units. No inferred balances. */
 balanceMinor: string | null; principalMinor: string | null; limitMinor: string | null; availableMinor: string | null;
 aprText: string | null; maturityDate: string | null;
 nextPayment: { amountMinor: string | null; principalMinor: string | null; interestMinor: string | null; dueDate: string | null } | null;
 source: { temporalBasis: "historical_statement" | "current_operational"; evidenceRef: string | null; asOf: string | null; expiresAt: string | null; label: string; coverage?: string | null };
 match: { status: "verified" | "single_source" | "unresolved" | "duplicate"; canonicalObligationId?: string | null; duplicateOf?: string | null };
}
export interface DebtCreditEnvelope {
 phase: DebtCreditPhase; scopeEpoch: string | null; readIdentity: string | null; rows: DebtCreditObligation[];
 defaultEntityId?: string | null; defaultCurrency?: string | null;
 asOf?: string | null; coverage?: string | null; error?: string | null;
}
export interface DebtCreditReviewScope {
 kind: "account" | "coverage" | "terms"; obligationIds: string[]; evidenceRefs: string[]; entityIds: string[]; currency: string | null;
}
export interface DebtCreditWorkspaceProps {
 source: DebtCreditEnvelope; epoch: string | null | undefined; retry: () => void; onIntegrations: () => void;
 onReview: (scope: DebtCreditReviewScope) => void;
}
export const DEBT_PRODUCT_LABELS: Record<DebtCreditProduct, string> = { business_card: "Business cards", revolving_line: "Revolving credit lines", term_loan: "Term loans", other_financing: "Other financing" };
export function validMinor(value: string | null | undefined): value is string { return typeof value === "string" && /^\d+$/.test(value); }
export function currentDebtSource(row: DebtCreditObligation, now: number): boolean { return ["historical_statement", "current_operational"].includes(row.source.temporalBasis) && !!row.source.evidenceRef && !!row.source.asOf && Number.isFinite(Date.parse(row.source.asOf)) && Date.parse(row.source.asOf) <= now && !!row.source.expiresAt && Date.parse(row.source.expiresAt) > now; }
/** Selection totals are presentation of eligible source balances, never a company-wide debt KPI. */
export function uniqueDebtRows(rows: DebtCreditObligation[], now: number): DebtCreditObligation[] {
 const groups = new Map<string, DebtCreditObligation[]>();
 for (const row of rows) {
  if (!currentDebtSource(row, now) || row.match.status === "unresolved" || row.match.status === "duplicate") continue;
  const id = row.match.status === "verified" ? row.match.canonicalObligationId : row.obligationId;
  if (!id) continue;
  const key = `${row.entity.id}|${row.currency}|${id}`;
  groups.set(key, [...(groups.get(key) ?? []), row]);
 }
 return [...groups.values()].flatMap(group => {
  const first = group[0];
  // A match cannot silently collapse distinct accounts or conflicting source amounts.
  return group.every(row => row.accountId === first.accountId && row.product === first.product && row.institution.id === first.institution.id && row.balanceMinor === first.balanceMinor && row.principalMinor === first.principalMinor && row.limitMinor === first.limitMinor && row.availableMinor === first.availableMinor && row.aprText === first.aprText && row.maturityDate === first.maturityDate && row.nextPayment?.amountMinor === first.nextPayment?.amountMinor && row.nextPayment?.principalMinor === first.nextPayment?.principalMinor && row.nextPayment?.interestMinor === first.nextPayment?.interestMinor && row.nextPayment?.dueDate === first.nextPayment?.dueDate && row.source.temporalBasis === first.source.temporalBasis && row.source.asOf === first.source.asOf) ? [first] : [];
 });
}
export function debtSum(rows: DebtCreditObligation[], field: "balanceMinor" | "availableMinor"): string | null {
 const values = rows.map(row => row[field]).filter(validMinor);
 return values.length ? values.reduce((sum, value) => sum + BigInt(value), 0n).toString() : null;
}

export function validDebtDate(value: string | null | undefined): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const stamp = Date.parse(value); return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value; }

/** Uncapped financial meaning; chart geometry alone may cap at 100%. */
export function debtUtilization(balance: string | null, limit: string | null): string | null { if (!validMinor(balance) || !validMinor(limit) || BigInt(limit) <= 0n) return null; const basisPoints = BigInt(balance) * 10000n / BigInt(limit); return `${basisPoints / 100n}${basisPoints % 100n ? `.${(basisPoints % 100n).toString().padStart(2, "0")}` : ""}`; }
