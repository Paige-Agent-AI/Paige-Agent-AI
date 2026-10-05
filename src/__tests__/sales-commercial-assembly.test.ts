import {describe,expect,it} from 'vitest';
import {previewCommercialAssembly,type CommercialAssemblyContext} from '../../supabase/functions/_shared/sales-commercial/assembly.ts';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';
const intent={total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-05',installment_cents:30000,first_installment_date:'2026-11-01',cadence:'monthly'};
function context():CommercialAssemblyContext {
 const schedule=assembleFixedRepaymentSchedule(intent);if(schedule.state!=='ready')throw Error();
 return {tenant_id:'test-tenant-a',client:{id:'test-client-a',tenant_id:'test-tenant-a'},
  agreement:{kind:'signed',id:'test-agreement-a',tenant_id:'test-tenant-a',client_id:'test-client-a',version:2,document_ref:'sealed-document-reference'},
  agreed_obligation:{tenant_id:'test-tenant-a',client_id:'test-client-a',currency:'usd',total_cents:350000,rows:schedule.rows},delivery_channels:['email']};
}
describe('commercial assembly preflight - no authority or writes',()=>{
 it('includes an existing signed document without proposing a new signature',()=>{
  const result=previewCommercialAssembly(intent,context());
  expect(result).toMatchObject({state:'ready_for_review',authority:'not_evaluated',execution:'not_started',dependencies:[],agreement:{treatment:'include_existing_signed_document',version:2}});
 });
 it('preserves signature dependencies for unsigned agreements',()=>{
  const ctx=context();ctx.agreement={kind:'unsigned',id:'draft-agreement',tenant_id:ctx.tenant_id,client_id:ctx.client!.id,version:1,signature_required_before_collection:true};
  expect(previewCommercialAssembly(intent,ctx)).toMatchObject({state:'ready_for_review',dependencies:['signature_before_collection'],agreement:{treatment:'canonical_signature_workflow'}});
 });
 it('treats an uploaded file as an attachment, never executed terms or signature state',()=>{
  const ctx=context();ctx.agreement={kind:'upload',id:'test-upload',tenant_id:ctx.tenant_id,document_ref:'upload-document-reference'};
  expect(previewCommercialAssembly(intent,ctx)).toMatchObject({state:'ready_for_review',agreement:{treatment:'attach_uploaded_document_only',version:null}});
 });
 it('bundles missing dates, client, document, commercial terms and channel into one ask',()=>{
  expect(previewCommercialAssembly({...intent,first_installment_date:undefined},{tenant_id:'test-tenant-a',client:null,agreement:null,agreed_obligation:null,delivery_channels:null})).toEqual({state:'needs_input',fields:['first_installment_date','client','agreement_or_document','agreed_terms_including_taxes_and_fees','delivery_channel']});
 });
 it('does not guess taxes or fees from the invoice principal',()=>{
  expect(previewCommercialAssembly(intent,{...context(),agreed_obligation:null})).toEqual({state:'needs_input',fields:['agreed_terms_including_taxes_and_fees']});
 });
 it('asks for the sealed document when signed state has no document reference',()=>{
  const ctx=context();if(ctx.agreement?.kind==='signed')ctx.agreement.document_ref=null;
  expect(previewCommercialAssembly(intent,ctx)).toEqual({state:'needs_input',fields:['agreement_document']});
 });
 it.each(['client','agreement','agreed_obligation'] as const)('refuses a foreign tenant in %s',key=>{
  const ctx=context();ctx[key]!.tenant_id='test-tenant-b';
  expect(previewCommercialAssembly(intent,ctx)).toEqual({state:'refused',code:'RESOURCE_SCOPE_MISMATCH'});
 });
 it('refuses a different agreement customer even within the tenant',()=>{
  const ctx=context();if(ctx.agreement?.kind==='signed')ctx.agreement.client_id='test-client-b';
  expect(previewCommercialAssembly(intent,ctx)).toEqual({state:'refused',code:'RESOURCE_SCOPE_MISMATCH'});
 });
 it.each(['amount','date','currency','total'])('refuses %s conflicts with canonical agreed terms',kind=>{
  const ctx=context();const agreed=ctx.agreed_obligation!;
  if(kind==='amount')agreed.rows[1].amount_cents=40000;
  if(kind==='date')agreed.rows[1].due_date='2026-11-02';
  if(kind==='currency')agreed.currency='eur';
  if(kind==='total')agreed.total_cents=350001;
  expect(previewCommercialAssembly(intent,ctx)).toEqual({state:'refused',code:'COMMERCIAL_TERMS_CONFLICT'});
 });
 it('refuses guessed unsupported channels and model-provided approval flags',()=>{
  expect(previewCommercialAssembly(intent,{...context(),delivery_channels:['imessage'] as never})).toMatchObject({state:'refused',code:'INVALID_CANONICAL_CONTEXT'});
  expect(previewCommercialAssembly({...intent,approved:true},context())).toMatchObject({state:'refused',code:'INVALID_REPAYMENT_INPUT'});
 });
 it('does not mutate canonical resolved inputs while assembling',()=>{
  const ctx=context();const before=structuredClone(ctx);previewCommercialAssembly(intent,ctx);expect(ctx).toEqual(before);
 });
 it.each(['version','client_id'])('refuses an incomplete signed reference missing %s',key=>{
  const ctx=context();delete (ctx.agreement as unknown as Record<string,unknown>)[key];
  expect(previewCommercialAssembly(intent,ctx).state).toBe('refused');
 });
 it('asks for an omitted signed document instead of claiming it can be included',()=>{
  const ctx=context();delete (ctx.agreement as unknown as Record<string,unknown>).document_ref;
  expect(previewCommercialAssembly(intent,ctx)).toEqual({state:'needs_input',fields:['agreement_document']});
 });
 it.each(['version','client_id'])('refuses an incomplete unsigned reference missing %s',key=>{
  const ctx=context();ctx.agreement={kind:'unsigned',id:'test-agreement',tenant_id:ctx.tenant_id,client_id:ctx.client!.id,version:1,signature_required_before_collection:true};
  delete (ctx.agreement as unknown as Record<string,unknown>)[key];
  expect(previewCommercialAssembly(intent,ctx).state).toBe('refused');
 });
 it('refuses an uploaded reference without document provenance and unsigned reference without policy',()=>{
  const ctx=context();ctx.agreement={kind:'upload',id:'test-upload',tenant_id:ctx.tenant_id} as never;
  expect(previewCommercialAssembly(intent,ctx)).toMatchObject({state:'refused',code:'INVALID_CANONICAL_CONTEXT'});
  ctx.agreement={kind:'unsigned',id:'test-agreement',tenant_id:ctx.tenant_id,client_id:ctx.client!.id,version:1} as never;
  expect(previewCommercialAssembly(intent,ctx)).toMatchObject({state:'refused',code:'INVALID_CANONICAL_CONTEXT'});
 });
});
