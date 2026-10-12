import type { DebtCreditEnvelope, DebtCreditReviewScope } from "./debt-credit/types";

/** No legacy user/client banking rows are a verified company-debt source.
 * Replace this unavailable binding only through a server-authorized Finance
 * read with company/connection/account provenance and canonical evidence.
 * Never fall back to raw tables, demo rows, or a client-supplied company ID.
 */
export function financeDebtSource(epoch: string | null | undefined): DebtCreditEnvelope {
 return {
  phase: epoch ? "unavailable" : "resolving",
  scopeEpoch: epoch ?? null,
  readIdentity: null,
  rows: [],
  coverage: "Company card, credit-line and loan coverage is not yet verified. Review your integrations; balances and financing terms remain unavailable until company source evidence is supported.",
 };
}

/** Bounded references are context hints, never source authority or financial facts. */
export function financeDebtReviewPrompt(scope: DebtCreditReviewScope): string {
 const intents = {
  coverage: "Review the company's financing source coverage for business cards, credit lines and loans.",
  terms: "Prepare a financing terms review checklist: identify missing verified APRs, maturities, principal/interest splits and payment dates.",
  account: "Prepare a review of the selected financing obligation references.",
 };
 const safeRefs = (values: string[]) => (Array.isArray(values) ? values : []).filter(value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)).slice(0,20).join(", ") || "none supplied";
 const currency = typeof scope.currency === "string" && /^[A-Z]{3}$/.test(scope.currency) ? scope.currency : "not supplied";
 return `${intents[scope.kind] ?? intents.coverage} Obligation references: ${safeRefs(scope.obligationIds)}. Evidence references: ${safeRefs(scope.evidenceRefs)}. Company references: ${safeRefs(scope.entityIds)}. Currency: ${currency}. These references are context hints, not authority; re-resolve active-workspace role, company ownership and evidence expiry through canonical sources. Company-debt retrieval is currently unavailable; state that limitation and do not claim to have read balances or terms. Distinguish principal, interest, available credit, cash and ordinary payables. Prepare a governed follow-up for owner review only; do not borrow, pay, transfer money or edit books.`;
}
