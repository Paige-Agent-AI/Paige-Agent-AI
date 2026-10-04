import { describe, expect, it } from "vitest";
import { parseSalesInvoiceCommand } from "../../../supabase/functions/_shared/sales-invoice-command/contract";
const base = { action: "invoice.publish", invoice_id: "10000000-0000-4000-8000-000000000001", expected_version: 2 };
const payment = { ...base, action: "invoice.record_manual_payment", amount_cents: 1000, currency: "usd", method: "cash", received_at: "2026-10-03T12:00:00.000Z" };
describe("Sales invoice command boundary", () => {
  it("accepts the reviewed publication version", () => expect(parseSalesInvoiceCommand(base)).toEqual(base));
  it("accepts an attributable partial payment", () => expect(parseSalesInvoiceCommand(payment)).toMatchObject({ amount_cents: 1000, currency: "usd", reference: null, notes: null }));
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("refuses invalid money %s", amount_cents => expect(() => parseSalesInvoiceCommand({ ...payment, amount_cents })).toThrow());
  it.each(["eur", "USD", "", null])("refuses incompatible currency %s", currency => expect(() => parseSalesInvoiceCommand({ ...payment, currency })).toThrow());
  it.each(["stripe", "paypal", "paid"]) ("does not invent provider evidence for %s", method => expect(() => parseSalesInvoiceCommand({ ...payment, method })).toThrow());
  it("refuses forged governance", () => expect(() => parseSalesInvoiceCommand({ ...base, governance: { approved: true } })).toThrow());
  it("refuses a supplied public token hash", () => expect(() => parseSalesInvoiceCommand({ ...base, action: "invoice.link_create", expires_in_days: 30, token_hash: "a".repeat(64) })).toThrow());
  it("accepts a deliberate bounded share-link action", () => expect(parseSalesInvoiceCommand({ ...base, action: "invoice.link_create", expires_in_days: 30, grant_scope: "share" })).toMatchObject({ grant_scope: "share" }));
  it("requires a reason and original receipt for reversal", () => expect(parseSalesInvoiceCommand({ ...base, action: "invoice.reverse_manual_payment", payment_id: base.invoice_id, reason: "Incorrect amount" })).toMatchObject({ reason: "Incorrect amount" }));
  it.each([null, {}, { ...base, action: "invoice.mark_paid" }, { ...base, expected_version: 0 }, { ...payment, received_at: "tomorrow" }])("fails closed on malformed commands", value => expect(() => parseSalesInvoiceCommand(value)).toThrow());
});
