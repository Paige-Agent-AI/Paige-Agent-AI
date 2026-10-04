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

const preferences={action:'invoice.settings_update',expected_version:0,settings:{prefix:'INV-',next_number:1,padding:4,template:'classic',accent:'#475569',logo_data_uri:null,footer:'Thank you',payment_instructions:'Pay by wire'}};
describe('invoice preferences command',()=>{
 it('accepts initial settings version without invented invoice ID',()=>expect(parseSalesInvoiceCommand(preferences)).toEqual(preferences));
 it.each([{invoice_id:base.invoice_id},{expected_version:-1},{settings:{...preferences.settings,prefix:'bad_'}},{settings:{...preferences.settings,next_number:0}},{settings:{...preferences.settings,padding:10}},{settings:{...preferences.settings,template:'html'}},{settings:{...preferences.settings,accent:'red'}},{settings:{...preferences.settings,footer:'a'.repeat(1001)}},{settings:{...preferences.settings,logo_data_uri:'data:image/svg+xml;base64,PHN2Zz4='}},{settings:{...preferences.settings,logo_data_uri:'data:image/png;base64,aGVsbG8='}},{settings:{...preferences.settings,issuer:'forged'}}])('refuses malformed settings and authority',patch=>expect(()=>parseSalesInvoiceCommand({...preferences,...patch})).toThrow());
});

it('accepts a bounded per-invoice publish template override only',()=>{expect(parseSalesInvoiceCommand({...base,template:'service'})).toMatchObject({template:'service'});expect(()=>parseSalesInvoiceCommand({...base,template:'raw_html'})).toThrow()});

it('validates PNG/JPEG signatures and decoded logo bounds',()=>{
 const png='data:image/png;base64,'+btoa('\x89PNG\r\n\x1a\n');expect(parseSalesInvoiceCommand({...preferences,settings:{...preferences.settings,logo_data_uri:png}})).toMatchObject({settings:{logo_data_uri:png}});
 const huge='data:image/png;base64,'+btoa('\x89PNG\r\n\x1a\n'+'a'.repeat(131072));expect(()=>parseSalesInvoiceCommand({...preferences,settings:{...preferences.settings,logo_data_uri:huge}})).toThrow();
 expect(()=>parseSalesInvoiceCommand({...preferences,settings:{...preferences.settings,payment_instructions:'a'.repeat(2001)}})).toThrow();
});

it('refuses the terminal sequence while accepting the final issuable preference',()=>{
 expect(parseSalesInvoiceCommand({...preferences,settings:{...preferences.settings,next_number:999999998}})).toMatchObject({settings:{next_number:999999998}});
 expect(()=>parseSalesInvoiceCommand({...preferences,settings:{...preferences.settings,next_number:999999999}})).toThrow();
});
