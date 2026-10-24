import {prepareCommercialPresentation,commercialPresentationText} from '../../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenant=id(1),client=id(2),offer=id(3),agreement=id(4),terms=id(5),invoice=id(6);
const none={state:'not_applicable',charges:[],source:'Synthetic recorded decision',policy:'No additional charge'};
const conditions={schema_version:1,tax:none,fees:none};
export const fixture={mode:'recorded',calls:[] as string[],pending:null as null|(()=>void),tenant,invoice};
async function retained(){
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Synthetic schedule unavailable');
 const body='Synthetic owner-authored service engagement.\n\nThe retained wording and agreed dated obligations remain together. Signing does not itself record a payment or client acceptance of delivered services.';
 const presentation=await prepareCommercialPresentation({schema_version:fixture.mode==='legacy'?1:2,
  ...(fixture.mode==='legacy'?{}:{engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'}}),
  source:{tenant_id:tenant,client_id:client,offer_id:offer,agreement_id:agreement,agreement_version:4,agreement_updated_at:'2026-10-14T18:00:00Z',body_source:'tenant_template',status:'draft',content_sha256:null,
   terms_id:terms,terms_version:3,terms_updated_at:'2026-10-14T18:00:00Z',invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:'2026-10-14T18:00:00Z'},
  title:'Service engagement agreement',body_markdown:body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions,lines:[{unit_minor:350000,quantity:1}]});
 return {schema_version:1,state:'recorded',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:id(7),completed_at:'2026-10-15T12:00:00Z',
  payload:presentation.payload,payload_digest:presentation.payload_digest,body_markdown:body,presented_body_markdown:commercialPresentationText(body,presentation),document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
}
export const supabase={rpc:async(name:string,args:Record<string,unknown>)=>{
 fixture.calls.push(name);
 if(args._expected_tenant_id!==tenant||args._invoice_id!==invoice)return {data:null,error:{code:'42501'}};
 if(name==='read_sales_accepted_agreement'){
  if(fixture.mode==='pending')await new Promise<void>(resolve=>{fixture.pending=resolve;});
  if(fixture.mode==='refused')return {data:null,error:{code:'42501'}};
  if(fixture.mode==='unverified')return {data:{schema_version:1,state:'unverified',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:id(7)},error:null};
  return {data:await retained(),error:null};
 }
 if(name!=='read_sales_commercial_package')throw Error('Unexpected local fixture call');
 const changed=fixture.mode==='changed';
 return {data:{schema_version:1,tenant_id:tenant,receipt_id:id(8),state:'needs_input',authority:'not_evaluated',execution:'not_started',
  invoice:{id:invoice,client_id:client,status:'issued',version:2,draft_version:changed?99:1,issued_snapshot_version:1,
   obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,currency:'usd',receivable_total_minor:350000,
   allocated_minor:0,manual_recorded_minor:0,provider_verified_minor:0,outstanding_minor:350000,due_date:'2026-10-15',delivery_channels:['email']},
  offers:[],agreement:{id:agreement,version:4,status:'completed',body_source:'tenant_template',commercial_terms_id:terms,document_available:true,treatment:'include_existing_signed_document'},
  commercial_terms:{id:terms,version:changed?99:3,updated_at:'2026-10-14T18:00:00Z',status:'draft',offer_id:offer,amount_minor:changed?999:350000,currency:'usd',record_owner:'commercial_collection_terms',schedule:null},
  commercial_conditions:conditions,compatibility:{basis:'canonical_relationship_and_invoice_source_version',signed_economics:'unverified_no_frozen_commercial_snapshot'},
  missing_fields:['signed_terms_compatibility'],conflicts:[]},error:null};
}};
