import {describe,it,expect} from 'vitest';
import {parsePaymentRequestIntent,buildPaymentRequestCommand,parseCanonicalPaymentRequestCommand,paymentRequestIntentFromCommand} from './request-command.ts';
const invoice={id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',client_id:'33333333-3333-4333-8333-333333333333',lifecycle_version:3,issued_snapshot_version:1,status:'issued',currency:'usd',outstanding_minor:350000};
const merchant={tenant_id:invoice.tenant_id,provider:'stripe' as const,merchant_id:'acct_testA',environment:'test' as const,version:1};
const now=Date.parse('2026-10-05T12:00:00Z');
const facts={...merchant,binding_version:1,observed_at:new Date(now).toISOString(),charges_enabled:true,payouts_enabled:true,details_submitted:true,payment_permission:true,email_confirmed:false,partner_authorized:false,disabled_reason:null};
const intent={action:'invoice.payment_request',invoice_id:invoice.id,expected_version:3,provider:'stripe',purpose:'full'};
describe('canonical payment request assembly',()=>{
 it('round-trips exact server approval facts but never accepts them as caller intent',()=>{const command=buildPaymentRequestCommand(intent,invoice,merchant,facts,now);expect(parseCanonicalPaymentRequestCommand(command)).toEqual(command);expect(()=>parsePaymentRequestIntent(command)).toThrow();});
 it.each([{approved:true},{currency:'USD'},{client_id:'not-a-client'},{merchant_binding_version:0},{issued_snapshot_version:0},{amount_minor:0},{environment:'sandbox'}])('rejects corrupted stored approval tuple %j',patch=>expect(()=>parseCanonicalPaymentRequestCommand({...buildPaymentRequestCommand(intent,invoice,merchant,facts,now),...patch})).toThrow());
 it('derives full amount, client, currency and merchant exclusively from canonical context',()=>expect(buildPaymentRequestCommand(intent,invoice,merchant,facts,now)).toEqual({...intent,issued_snapshot_version:1,client_id:invoice.client_id,amount_minor:350000,currency:'usd',merchant_account_id:'acct_testA',merchant_binding_version:1,environment:'test'}));
 it('permits reviewed partial collection only within actual canonical balance',()=>expect(buildPaymentRequestCommand({...intent,purpose:'partial',amount_minor:50000},invoice,merchant,facts,now)).toMatchObject({amount_minor:50000,purpose:'partial'}));
 it.each([{client_id:invoice.client_id},{tenant_id:invoice.tenant_id},{merchant_account_id:'acct_other'},{currency:'eur'},{approved:true},{card_number:'forbidden'},{amount_minor:50000}])('refuses caller-authored authority/facts %j',patch=>expect(()=>parsePaymentRequestIntent({...intent,...patch})).toThrow('PAYMENT_REQUEST_INVALID'));
 it.each([0,-1,0.1,NaN,350001])('refuses unsafe partial amount %s',amount_minor=>expect(()=>buildPaymentRequestCommand({...intent,purpose:'partial',amount_minor},invoice,merchant,facts,now)).toThrow());
 it('refuses stale invoice before producing approval inputs',()=>expect(()=>buildPaymentRequestCommand({...intent,expected_version:2},invoice,merchant,facts,now)).toThrow('INVOICE_VERSION_CHANGED'));
 it('refuses merchant tenant mismatch',()=>expect(()=>buildPaymentRequestCommand(intent,invoice,{...merchant,tenant_id:'other'},facts,now)).toThrow('MERCHANT_TENANT_MISMATCH'));
 it('refuses readiness derived from declaration rather than provider readback',()=>expect(()=>buildPaymentRequestCommand(intent,invoice,merchant,null,now)).toThrow('MERCHANT_READBACK_REQUIRED'));
 it('refuses stale merchant readback',()=>expect(()=>buildPaymentRequestCommand(intent,invoice,merchant,{...facts,observed_at:new Date(now-300001).toISOString()},now)).toThrow('MERCHANT_READBACK_STALE'));
 it('refuses currency mismatch even if model omits currency',()=>expect(()=>buildPaymentRequestCommand(intent,{...invoice,currency:'USD'},merchant,facts,now)).toThrow('PAYMENT_REQUEST_INVALID'));
});

const acceptedReference={commercial_terms_id:'44444444-4444-4444-8444-444444444444',
 signing_id:'55555555-5555-4555-8555-555555555555',signing_version:2,terms_version:1,sequence:1};
const scheduledIntent={action:'invoice.payment_request',invoice_id:invoice.id,expected_version:3,
 provider:'stripe',purpose:'installment',obligation_reference:acceptedReference};
const obligation={reference:acceptedReference,source_digest:'a'.repeat(64),due_date:'2026-11-15',
 scheduled_minor:50000,remaining_minor:50000};
const obligationContext={tenant_id:invoice.tenant_id,client_id:invoice.client_id,invoice_id:invoice.id,
 invoice_version:invoice.lifecycle_version,issued_snapshot_version:invoice.issued_snapshot_version,obligation};

describe('payment request against one original accepted dated obligation',()=>{
 it('accepts only an original reference as caller intent, not a caller-authored scheduled amount',()=>{
  expect(parsePaymentRequestIntent(scheduledIntent)).toEqual(scheduledIntent);
  expect(()=>parsePaymentRequestIntent({...scheduledIntent,amount_minor:50000})).toThrow();
  expect(()=>parsePaymentRequestIntent({...scheduledIntent,obligation})).toThrow();
 });
 it('prepares the source-resolved initial 500 against the same 3500 invoice, never another principal',()=>{
  const command=buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,obligationContext);
  expect(command).toMatchObject({invoice_id:invoice.id,client_id:invoice.client_id,amount_minor:50000,obligation});
  expect(parseCanonicalPaymentRequestCommand(command)).toEqual(command);
  expect(()=>parsePaymentRequestIntent(command)).toThrow();
 });
 it('keeps a later 300 request and its exact accepted sequence and date',()=>{
  const nextReference={...acceptedReference,sequence:2};
  const next={...obligationContext,obligation:{...obligation,reference:nextReference,
   due_date:'2026-12-15',scheduled_minor:30000,remaining_minor:30000}};
  expect(buildPaymentRequestCommand({...scheduledIntent,obligation_reference:nextReference},invoice,merchant,facts,now,next))
   .toMatchObject({amount_minor:30000,obligation:next.obligation});
 });
 it('retains an explicitly requested initial deposit as the same accepted first obligation',()=>{
  const depositIntent={...scheduledIntent,purpose:'deposit'};
  const command=buildPaymentRequestCommand(depositIntent,invoice,merchant,facts,now,obligationContext);
  expect(command).toMatchObject({purpose:'deposit',amount_minor:50000,obligation});
  expect(paymentRequestIntentFromCommand(command)).toEqual(depositIntent);
 });
 it('does not mislabel a later accepted installment as the initial deposit',()=>{
  expect(()=>parsePaymentRequestIntent({...scheduledIntent,purpose:'deposit',obligation_reference:{...acceptedReference,sequence:2}})).toThrow();
 });
 it('requires native scoped source context before preparing a scheduled request',()=>{
  expect(()=>buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now)).toThrow('PAYMENT_OBLIGATION_REQUIRED');
 });
 it.each([{tenant_id:'66666666-6666-4666-8666-666666666666'},
  {client_id:'66666666-6666-4666-8666-666666666666'},{invoice_id:'66666666-6666-4666-8666-666666666666'},
  {invoice_version:4},{issued_snapshot_version:2},
  {obligation:{...obligation,reference:{...acceptedReference,sequence:2}}}
 ])('rejects another source scope or changed invoice/signing tuple %j',patch=>{
  expect(()=>buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,{...obligationContext,...patch}))
   .toThrow('PAYMENT_OBLIGATION_CHANGED');
 });
 it('does not request money for an already allocated target',()=>{
  expect(()=>buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,
   {...obligationContext,obligation:{...obligation,remaining_minor:0}})).toThrow('PAYMENT_OBLIGATION_ALREADY_ALLOCATED');
 });
 it('uses only the remaining native amount for a partly allocated obligation',()=>{
  expect(buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,
   {...obligationContext,obligation:{...obligation,remaining_minor:12500}}).amount_minor).toBe(12500);
 });
 it('refuses a corrupt stored target or a different amount on approval replay',()=>{
  const command=buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,obligationContext);
  expect(()=>parseCanonicalPaymentRequestCommand({...command,amount_minor:49999})).toThrow();
  expect(()=>parseCanonicalPaymentRequestCommand({...command,obligation:{...obligation,approved:true}})).toThrow();
 });
});

describe('original payment-operation recovery intent',()=>{
 it.each([
  intent,
  {...intent,purpose:'partial',amount_minor:12500},
  {...intent,purpose:'deposit',amount_minor:50000},
  {...intent,purpose:'installment',amount_minor:30000},
 ])('preserves the original unbound command selector %j',original=>{
  const command=buildPaymentRequestCommand(original,invoice,merchant,facts,now);
  expect(paymentRequestIntentFromCommand(command)).toEqual(parsePaymentRequestIntent(original));
 });
 it('reopens the same accepted target rather than substituting a free-form installment amount',()=>{
  const command=buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,obligationContext);
  const restored=paymentRequestIntentFromCommand(command);
  expect(restored).toEqual(scheduledIntent);
  expect(restored).not.toHaveProperty('amount_minor');
  expect(restored).not.toHaveProperty('merchant_account_id');
  expect(restored).not.toHaveProperty('obligation');
 });
 it('retains the historical target after a partly allocated request without repricing or a current read',()=>{
  const command=buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,
   {...obligationContext,obligation:{...obligation,remaining_minor:12500}});
  expect(paymentRequestIntentFromCommand(command)).toEqual(scheduledIntent);
  expect(command.amount_minor).toBe(12500);
 });
 it('rejects corrupted stored commands before producing any recovery intent',()=>{
  const command=buildPaymentRequestCommand(scheduledIntent,invoice,merchant,facts,now,obligationContext);
  expect(()=>paymentRequestIntentFromCommand({...command,amount_minor:49999})).toThrow();
  expect(()=>paymentRequestIntentFromCommand({...command,obligation:{...obligation,source_digest:'invalid'}})).toThrow();
 });
});
