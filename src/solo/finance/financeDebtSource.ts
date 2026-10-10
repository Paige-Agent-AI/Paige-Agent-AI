import type { DebtCreditEnvelope } from "./debt-credit/types";

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
