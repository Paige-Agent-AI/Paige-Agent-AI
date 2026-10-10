/** Original terminology is provider-owned. Canonical meaning never replaces the display label. */
export interface SourceAccountLabel {
 source: string;
 sourceId: string;
 sourceLabel: string;
 sourceAccountType: string;
 currency: string;
 observedAt: string;
}
export function readSourceAccount(value: unknown): SourceAccountLabel | null {
 if (!value || typeof value !== "object" || Array.isArray(value)) return null;
 const row = value as Record<string, unknown>;
 if (!["source", "sourceId", "sourceLabel", "sourceAccountType"].every(key => typeof row[key] === "string" && (row[key] as string).trim().length > 0 && (row[key] as string).length <= 500)
  || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
  || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) return null;
 return { source: row.source as string, sourceId: row.sourceId as string, sourceLabel: row.sourceLabel as string, sourceAccountType: row.sourceAccountType as string, currency: row.currency, observedAt: row.observedAt };
}
/** Only explicit adapter type metadata establishes a mapping. Unknown types need review. */
export function mappedAccountMeaning(row: SourceAccountLabel): "asset" | "liability" | "equity" | "income" | "expense" | null {
 if (row.source !== "quickbooks") return null;
 const map: Record<string, "asset" | "liability" | "equity" | "income" | "expense"> = {
  Bank: "asset", "Accounts Receivable": "asset", "Other Current Asset": "asset", "Fixed Asset": "asset", "Other Asset": "asset",
  "Accounts Payable": "liability", "Credit Card": "liability", "Other Current Liability": "liability", "Long Term Liability": "liability",
  Equity: "equity", Income: "income", "Other Income": "income", Expense: "expense", "Other Expense": "expense", "Cost of Goods Sold": "expense",
 };
 return Object.prototype.hasOwnProperty.call(map, row.sourceAccountType) ? map[row.sourceAccountType] : null;
}
