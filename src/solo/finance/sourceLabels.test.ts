import { describe, expect, it } from "vitest";
import { readSourceAccount, mappedAccountMeaning } from "./sourceLabels";
const account = { source: "quickbooks", sourceId: "a-1", sourceLabel: "Reconciliation / Debt – propriétaire", sourceAccountType: "Long Term Liability", currency: "EUR", observedAt: "2026-10-09T12:00:00Z" };
describe("Finance source terminology", () => {
 it("retains the exact provider name and identity, including localized/custom terminology", () => { expect(readSourceAccount(account)).toEqual(account); });
 it("never classifies from a familiar-looking account label", () => { expect(mappedAccountMeaning({ ...account, sourceLabel: "Cash", sourceAccountType: "Unknown" })).toBe(null); });
 it("maps provider type independently without replacing the visible name", () => { const row = readSourceAccount(account)!; expect(mappedAccountMeaning(row)).toBe("liability"); expect(row.sourceLabel).toBe(account.sourceLabel); });
 it("requires explicit scope/time/currency metadata and never creates zero balances", () => { expect(readSourceAccount({ ...account, currency: null })).toBe(null); expect(readSourceAccount({ ...account, observedAt: "bad" })).toBe(null); expect(readSourceAccount(account)).not.toHaveProperty("balance"); });
 it("refuses prototype-like names as unrecognized provider types", () => { for (const sourceAccountType of ["constructor", "toString", "__proto__"]) expect(mappedAccountMeaning({ ...account, sourceAccountType })).toBe(null); });
 it("allows identically named accounts to retain different source identities", () => { expect(readSourceAccount(account)?.sourceId).not.toBe(readSourceAccount({ ...account, sourceId: "a-2" })?.sourceId); });
});
