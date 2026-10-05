import {describe,it,expect} from 'vitest';
import {parseCommercialDraftCommand} from '../../supabase/functions/_shared/sales-commercial/draft-command.ts';
const client='33333333-3333-4333-8333-333333333333',invoice='44444444-4444-4444-8444-444444444444';
const draft=()=>({schema_version:3,client_id:client,items:[{price_id:null,item:'Commercial service',unit_minor:350000,quantity:1}],kind:'deposit',deposit_basis_points:null,deposit_minor:50000,currency:'usd',cadence:null,recipient_email:'client@example.test',recipient_phone:null,email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,processor_intent:null,payment_method_intents:[],delivery_channel_intents:['email'],due_date:'2026-11-01',memo:null});
describe('bounded conversational draft command boundary',()=>{
 it('preserves exact intent without calculating a second balance or issuing/sending',()=>{const input={action:'invoice.draft_create',draft:draft()};const result=parseCommercialDraftCommand(input);expect(result).toEqual(input);expect(result.draft).not.toBe(input.draft);expect(result.draft).not.toHaveProperty('due_now_minor');expect(result).not.toHaveProperty('invoice_id')});
 it('requires current identity/version for draft revision',()=>expect(parseCommercialDraftCommand({action:'invoice.draft_revise',invoice_id:invoice,expected_version:1,draft:draft()})).toMatchObject({invoice_id:invoice,expected_version:1}));
 it.each([{approved:true},{confirm:true},{tenant_id:client},{actor_id:client},{operation_id:invoice},{invoice_id:invoice},{send:true},{card_number:'unsafe'},{cvv:'unsafe'}])('rejects model authority/provider/identity fields %j',patch=>expect(()=>parseCommercialDraftCommand({action:'invoice.draft_create',draft:draft(),...patch})).toThrow());
 it.each([{schema_version:4},{due_date:null},{due_date:'2026-02-30'},{currency:null},{currency:'eur'},{deposit_minor:1.5},{deposit_basis_points:1429},{kind:'recurring'},{items:[]},{items:[{price_id:null,item:'x',unit_minor:1.5,quantity:1}]},{remaining_cents:300000},{tax_cents:0},{recipient_email:undefined}])('never defaults or accepts computed/provider facts %j',patch=>expect(()=>parseCommercialDraftCommand({action:'invoice.draft_create',draft:{...draft(),...patch}})).toThrow());
 it('leaves financial sum/catalog resolution to canonical SQL',()=>{const d=draft();d.deposit_minor=350000;expect(parseCommercialDraftCommand({action:'invoice.draft_create',draft:d}).draft.deposit_minor).toBe(350000)});
 it('retains existing schema2 percentage inputs without exact-only metadata',()=>{const {deposit_minor:_exact,...d}=draft();expect(parseCommercialDraftCommand({action:'invoice.draft_create',draft:{...d,schema_version:2,deposit_basis_points:2500}}).draft.schema_version).toBe(2)});
 it('refuses malformed revise identity and stale zero version',()=>{for(const patch of [{invoice_id:'invented',expected_version:1},{invoice_id:invoice,expected_version:0}])expect(()=>parseCommercialDraftCommand({action:'invoice.draft_revise',draft:draft(),...patch})).toThrow()});
});


describe('server generated canonical draft identity',()=>{
 const scope={tenantId:'20000000-0000-0000-0000-000000000001',actorId:'10000000-0000-0000-0000-000000000001',operationId:'70000000-0000-0000-0000-000000000001'};
 it('reuses one identity for stable scope and changes with tenant, actor or operation',async()=>{
  const {commercialDraftWorkOrder}=await import('../../supabase/functions/_shared/sales-commercial/draft-work-order');
  const intent={action:'invoice.draft_create' as const,draft:draft()};const first=await commercialDraftWorkOrder(intent,scope);
  expect(await commercialDraftWorkOrder(intent,scope)).toEqual(first);expect(first.expected_version).toBe(0);
  for(const key of ['tenantId','actorId','operationId'] as const)expect((await commercialDraftWorkOrder(intent,{...scope,[key]:'90000000-0000-0000-0000-000000000001'})).invoice_id).not.toBe(first.invoice_id);
 });
 it('validates stored exact identity and refuses substituted identity, version and unknown keys',async()=>{
  const {commercialDraftWorkOrder,validateStoredDraftWorkOrder}=await import('../../supabase/functions/_shared/sales-commercial/draft-work-order');
  const work=await commercialDraftWorkOrder({action:'invoice.draft_create',draft:draft()},scope);expect(await validateStoredDraftWorkOrder(work,scope)).toEqual(work);
  for(const patch of [{invoice_id:invoice},{expected_version:1},{approved:true}])await expect(validateStoredDraftWorkOrder({...work,...patch},scope)).rejects.toThrow();
 });
 it('cold start classifies both declarations without lowering publication risk',async()=>{
  const {SALES_DRAFT_CREATE,SALES_DRAFT_REVISE}=await import('../../supabase/functions/_shared/sales-commercial/draft-capabilities');
  expect(SALES_DRAFT_CREATE.governance).toMatchObject({risk:'ordinary',approval:'confirm',actionRiskKey:'billing_create_invoice'});
  expect(SALES_DRAFT_REVISE.governance).toMatchObject({risk:'ordinary',approval:'confirm',actionRiskKey:'sales_revise_invoice_draft'});
 });
});
