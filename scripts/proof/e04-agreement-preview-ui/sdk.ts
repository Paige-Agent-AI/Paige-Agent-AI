import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
export const id=(n:number)=>`ec040103-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const scenario={mode:'ready',release:()=>{},calls:[] as string[],reads:0};
const date='2026-10-14T18:00:00.000Z';
const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
if(schedule.state!=='ready')throw Error('Invalid canonical fixture schedule');
const terms=schedule.terms;
const known={state:'not_applicable',charges:[],source:'Synthetic owner record',policy:'No applicable charge recorded'};
const conditions={schema_version:1,tax:known,fees:known};
const {schema_version:_,late_fee:__,interest:___,...boundedSchedule}=terms;
// Match the canonical SQL projection's allowlist; labels remain in the real
// source terms for the C1 presentation, not this bounded package schedule.
boundedSchedule.dates=terms.dates.map(({due_date,amount_cents})=>({due_date,amount_cents}));
const packageProjection=()=>({schema_version:1,tenant_id:id(1),receipt_id:id(9),state:'needs_input',authority:'not_evaluated',execution:'not_started',missing_fields:[],conflicts:[],
 invoice:{id:id(4),client_id:id(2),status:'draft',version:2,draft_version:3,issued_snapshot_version:null,obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,currency:'usd',receivable_total_minor:0,allocated_minor:0,manual_recorded_minor:0,provider_verified_minor:0,outstanding_minor:0,due_date:'2026-10-15',delivery_channels:[],commercial_terms_reference:{id:id(5),version:5}},
 agreement:{id:id(3),version:4,status:'draft',body_source:'paige_draft',commercial_terms_id:id(5),document_available:true,treatment:'unsigned_canonical_agreement'},
 commercial_terms:{id:id(5),version:5,updated_at:date,status:'draft',offer_id:id(6),amount_minor:350000,currency:'usd',record_owner:'commercial_collection_terms',schedule:boundedSchedule},offers:[],commercial_conditions:conditions,compatibility:{basis:'canonical_relationship_and_invoice_source_version',signed_economics:'not_signed'}});
const rows=()=>({
 paige_invoices:{id:id(4),tenant_id:id(1),contact_id:id(2),status:'draft',currency:'usd',updated_at:date,billing_lifecycle_version:2,billing_draft_version:3,billing_draft:{schema_version:3,total_minor:350000,agreement_snapshot:{id:id(3),version:4},commercial_terms_reference:{id:id(5),version:5},commercial_conditions:scenario.mode==='missing'?undefined:conditions,items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:id(6)}}]}},
 paige_agreements:{id:id(3),tenant_id:id(1),contact_id:id(2),offer_id:id(6),commercial_terms_id:id(5),version:4,updated_at:date,title:'Synthetic service agreement',body_markdown:'Original saved service responsibilities.'+(scenario.mode==='long'?'\n\n'+('Very long recorded service description '+ 'x'.repeat(300)+'\n').repeat(80):''),body_source:'paige_draft',status:'draft',content_sha256:null,content_storage_key:null},
 tenant_client_agreements:{id:id(5),tenant_id:id(1),contact_id:id(2),offer_id:id(6),status:'draft',collection_terms_version:5,updated_at:date,agreed_amount_minor:350000,agreed_currency:'usd',collection_terms:terms},
});
export const supabase={
 rpc:async(name:string)=>{scenario.calls.push(name);if(name==='read_sales_commercial_package')return {data:packageProjection(),error:null};if(name==='current_user_tenant_id')return {data:id(1),error:null};if(name==='is_tenant_admin')return {data:scenario.mode!=='denied',error:null};throw Error('No synthetic write or provider act is permitted: '+name);},
 from(table:string){const query={select(){return query;},eq(){return query;},async maybeSingle(){scenario.reads++;if(scenario.mode==='pending')await new Promise<void>(resolve=>{scenario.release=resolve;});if(scenario.mode==='error')return {data:null,error:{message:'Synthetic private detail'}};return {data:rows()[table as keyof ReturnType<typeof rows>]??null,error:null};}};return query;},
};
