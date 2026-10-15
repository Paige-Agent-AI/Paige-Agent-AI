import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
import {prepareCommercialPresentationFromRecords} from '../../../supabase/functions/_shared/agreements/commercial-presentation-read';
import {commercialPreparationCommand} from '../../../supabase/functions/_shared/sales-commercial/preparation-command';

export const e04Id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
/** Recording synthetic ports only; no Auth session, database or provider. */
export async function e04CommercialFixture(){
 const tenant=e04Id(1),client=e04Id(2),offer=e04Id(3),agreement=e04Id(4),terms=e04Id(5),invoice=e04Id(6),operation=e04Id(7);
 const stamp='2026-10-15T00:00:00.000001+00:00';
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-11-05',installment_cents:30000,first_installment_date:'2026-12-05',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Synthetic schedule unavailable');
 const treatment={state:'not_applicable',charges:[],source:'Synthetic recorded decision',policy:'No applicable charge'};
 const conditions={schema_version:1,tax:treatment,fees:treatment};
 const rows:Record<string,Record<string,unknown>>={
  paige_agreements:{id:agreement,tenant_id:tenant,contact_id:client,offer_id:offer,commercial_terms_id:terms,version:4,updated_at:stamp,
   title:'Synthetic service agreement',body_markdown:'Owner-recorded service responsibilities.',body_source:'paige_draft',status:'draft',content_sha256:null,content_storage_key:null},
  tenant_client_agreements:{id:terms,tenant_id:tenant,contact_id:client,offer_id:offer,status:'draft',collection_terms_version:3,updated_at:stamp,
   agreed_amount_minor:350000,agreed_currency:'USD',starts_on:'2026-11-01',ends_on:null,price_basis:'negotiated',collection_terms:schedule.terms},
  paige_invoices:{id:invoice,tenant_id:tenant,contact_id:client,status:'draft',currency:'usd',updated_at:stamp,billing_lifecycle_version:1,billing_draft_version:2,
   billing_draft:{schema_version:3,total_minor:350000,agreement_id:agreement,agreement_snapshot:{id:agreement,version:4},commercial_terms_reference:{id:terms,version:3},
    commercial_conditions:conditions,items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:offer}}]}},
 };
 const authority={tenant,admin:true};const filters:Array<{table:string;key:string;value:string}>=[];
 const caller={rpc:async(name:string)=>{
  if(name==='current_user_tenant_id')return {data:authority.tenant,error:null};
  if(name==='is_tenant_admin')return {data:authority.admin,error:null};
  throw Error('Unexpected synthetic RPC '+name);
 },from(table:string){const selected:Array<[string,string]>=[];const query={select(){return query;},eq(key:string,value:string){selected.push([key,value]);filters.push({table,key,value});return query;},
   maybeSingle:async()=>({data:selected.every(([key,value])=>rows[table]?.[key]===value)?structuredClone(rows[table]):null,error:null})};return query;}};
 const proposed=await prepareCommercialPresentationFromRecords(tenant,{invoice_id:invoice,agreement_id:agreement},caller);
 if(proposed.state!=='proposed')throw Error('Synthetic presentation unavailable');
 return {tenant,client,offer,agreement,terms,invoice,operation,rows,authority,caller,filters,proposed,command:commercialPreparationCommand(proposed.presentation)};
}
