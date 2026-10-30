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

const acceptedObligation=(sequence:number,remaining=sequence===1?50000:30000)=>({
 reference:{commercial_terms_id:'a0000000-0000-4000-8000-000000000001',signing_id:'b0000000-0000-4000-8000-000000000001',signing_version:2,terms_version:1,sequence},
 source_digest:'a'.repeat(64),due_date:sequence===1?'2026-11-01':'2026-12-01',scheduled_minor:sequence===1?50000:30000,remaining_minor:remaining,
});
const split=(sequence:number,amount_cents:number)=>({obligation:acceptedObligation(sequence),amount_cents});
describe('explicit original manual receipt allocation transport',()=>{
 it('retains a partial allocation to one exact accepted obligation',()=>{
  const allocations=[split(1,1000)];
  expect(parseSalesInvoiceCommand({...payment,allocations})).toEqual({...payment,reference:null,notes:null,allocations});
 });
 it('retains explicit splits and order without creating another receipt or guessing FIFO',()=>{
  const allocations=[split(2,25000),split(1,50000)];
  const parsed=parseSalesInvoiceCommand({...payment,amount_cents:75000,allocations});
  expect(parsed.allocations).toEqual(allocations);
  expect(Object.keys(parsed).sort()).toEqual([...Object.keys(payment),'reference','notes','allocations'].sort());
 });
 it('normalizes original UUID references using the canonical obligation parser',()=>{
  const item=split(1,1000);item.obligation.reference.signing_id=item.obligation.reference.signing_id.toUpperCase();
  const parsed=parseSalesInvoiceCommand({...payment,allocations:[item]});
  expect(parsed.allocations).toEqual([split(1,1000)]);
 });
 it('does not retrofit an allocation onto the original reversal command',()=>{
  expect(()=>parseSalesInvoiceCommand({...base,action:'invoice.reverse_manual_payment',payment_id:base.invoice_id,reason:'Correction',allocations:[split(1,1000)]})).toThrow();
 });
 it('refuses a sparse allocation array rather than preserving an unchecked empty slot',()=>{
  const allocations=Array.from({length:2},()=>split(1,1000));delete allocations[1];
  expect(()=>parseSalesInvoiceCommand({...payment,allocations})).toThrow();
 });
 it.each([[],null,{},[split(1,999)],[split(1,1001)],[split(1,0)],[split(1,-1)],[split(1,0.5)],
  [{...split(1,1000),amount_cents:'1000'}],[{...split(1,1000),provider_verified:true}],
  [{...split(1,1000),obligation:{...acceptedObligation(1),remaining_minor:999}}],
  [{...split(1,1000),obligation:{...acceptedObligation(1),remaining_minor:0}}],
  [{...split(1,1000),obligation:{...acceptedObligation(1),due_date:'2026-02-30'}}],
  [{...split(1,1000),obligation:{...acceptedObligation(1),source_digest:'guessed'}}],
  [split(1,500),split(1,500)],Array.from({length:241},()=>split(1,1)),
 ])('refuses malformed, duplicate, unbalanced or over-allocated splits %#',allocations=>{
  expect(()=>parseSalesInvoiceCommand({...payment,allocations})).toThrow();
 });
 it.each(['commercial_terms_id','signing_id','signing_version','terms_version','source_digest'] as const)('refuses mixed accepted source %s',key=>{
  const one=split(1,500),two=split(2,500);
  if(key==='source_digest')two.obligation.source_digest='b'.repeat(64);
  else if(key==='signing_version'||key==='terms_version')two.obligation.reference[key]++;
  else two.obligation.reference[key]='c0000000-0000-4000-8000-000000000001';
  expect(()=>parseSalesInvoiceCommand({...payment,allocations:[one,two]})).toThrow();
 });
 it('retains the incumbent unassigned manual command without invented allocations',()=>{
  expect(parseSalesInvoiceCommand(payment)).toEqual({...payment,reference:null,notes:null});
 });
});
