import {e04CommercialFixture,e04Id as id} from '../../../src/test/fixtures/e04-commercial-presentation';
import {preparationReviewDocument} from '../../../supabase/functions/_shared/agreements/preparation-review';
import {parseCommercialPreparationCommand} from '../../../supabase/functions/_shared/sales-commercial/preparation-command';
export {id};
type Result=Record<string,unknown>;
let fixture:Awaited<ReturnType<typeof e04CommercialFixture>>;
const loaded=e04CommercialFixture().then(value=>fixture=value),operations=new Map<string,Result>(),listeners=new Set<(event:string,session:{user:{id:string}}|null)=>void>();
export const scenario={mode:'ready',writes:0,prepared:false,actor:id(9),calls:[] as {name:string;body:unknown}[],navigation:[] as unknown[],last:null as Result|null,
 reset(mode:string){this.mode=mode;this.writes=mode==='prepared'?1:0;this.prepared=mode==='prepared';this.calls=[];this.navigation=[];this.actor=id(9);this.last=null;operations.clear();sessionStorage.clear();},
 state(){return {mode:this.mode,writes:this.writes,prepared:this.prepared,calls:this.calls,navigation:this.navigation};},
 retireActor(){this.actor=id(99);for(const callback of [...listeners])callback('SIGNED_IN',{user:{id:this.actor}});},
};
const receipt=(c:ReturnType<typeof parseCommercialPreparationCommand>,operation:string)=>({ok:true,outcome:'agreement_prepared',historical_receipt:true,receipt_id:id(8),row:{id:c.agreement_id,tenant_id:id(1),version_at_preparation:c.agreement_version,
 invoice_id:c.invoice_id,invoice_version:c.invoice_version,invoice_draft_version:c.invoice_draft_version,terms_id:c.terms_id,terms_version:c.terms_version,client_id:c.client_id,offer_id:c.offer_id,payload_digest:c.payload_digest,
 document_sha256:'a'.repeat(64),prepared_at:'2026-10-15T08:00:00Z',actor_user_id:id(9)},operation:{id:operation,action:c.action}});
export const supabase={
 auth:{getSession:async()=>({data:{session:{user:{id:scenario.actor}}}}),onAuthStateChange(callback:(event:string,session:{user:{id:string}}|null)=>void){listeners.add(callback);callback('INITIAL_SESSION',{user:{id:scenario.actor}});return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}},
 from(table:string){const filters:Array<[string,string]>=[];const q={select(){return q;},eq(key:string,value:string){filters.push([key,value]);return q;},async maybeSingle(){await loaded;
   const row=fixture.rows[table];if(!row||!filters.every(([key,value])=>row[key]===value))return {data:null,error:null};const data=structuredClone(row);
   if(table==='tenant_client_agreements'&&scenario.mode==='missing')data.starts_on=null;return {data,error:null};}};return q;},
 async rpc(name:string){await loaded;
  if(name==='current_user_tenant_id')return {data:id(1),error:null};if(name==='is_tenant_admin')return {data:scenario.mode!=='denied'&&scenario.actor===id(9),error:null};
  if(scenario.mode==='denied'||scenario.actor!==id(9))return {data:null,error:{code:'42501'}};
  if(name==='read_sales_commercial_package'){
   const recorded=fixture.rows.tenant_client_agreements.collection_terms as Record<string,unknown>;
   const schedule=Object.fromEntries(['kind','total_cents','currency','cadence','anchor_date','count','end_date','deposit_cents','dates'].map(key=>[key,recorded[key]]));
   // The real package RPC projects dated amounts only; line labels remain in
   // the independently validated retained presentation, not this read shape.
   schedule.dates=(recorded.dates as {due_date:string;amount_cents:number}[]).map(({due_date,amount_cents})=>({due_date,amount_cents}));
   return {data:{schema_version:1,tenant_id:id(1),receipt_id:id(10),state:'needs_input',authority:'not_evaluated',execution:'not_started',
    invoice:{id:id(6),client_id:id(2),status:'draft',version:1,draft_version:2,issued_snapshot_version:null,currency:'usd',obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,receivable_total_minor:350000,allocated_minor:0,manual_recorded_minor:0,provider_verified_minor:0,outstanding_minor:350000,due_date:'2026-11-05',delivery_channels:null},offers:[],
    agreement:{id:id(4),status:'draft',version:4,body_source:'paige_draft',commercial_terms_id:id(5),document_available:scenario.prepared,treatment:'unsigned_canonical_agreement'},
    commercial_terms:{id:id(5),status:'draft',version:3,updated_at:'2026-10-15T00:00:00Z',offer_id:id(3),amount_minor:350000,currency:'usd',record_owner:'commercial_collection_terms',schedule},
    commercial_conditions:fixture.proposed.presentation.payload.conditions,compatibility:{basis:'canonical_relationship_and_invoice_source_version',signed_economics:'not_signed'},missing_fields:[],conflicts:[]},error:null};
  }
  if(name==='read_sales_prepared_agreement')return {data:{schema_version:1,state:'retained',tenant_id:id(1),invoice_id:id(6),agreement_id:id(4),receipt_id:id(10),current_status:'draft',
   payload:fixture.proposed.presentation.payload,payload_digest:fixture.command.payload_digest,body_markdown:fixture.rows.paige_agreements.body_markdown,presented_body_markdown:fixture.proposed.presented_body_markdown,document_sha256:'a'.repeat(64),preparation:scenario.last??receipt(fixture.command,id(7))},error:null};
  throw Error('Unexpected synthetic read '+name);
 },
 functions:{async invoke(name:string,args:{body:Record<string,unknown>}){await loaded;if(name!=='sales-collection-command')throw Error('Unexpected synthetic function');
  const body=args.body,c=parseCommercialPreparationCommand(body.command);scenario.calls.push({name,body:structuredClone(body)});if(body.expected_tenant_id!==id(1)||typeof body.operation_id!=='string')throw Error('Wrong synthetic scope');
  const prior=operations.get(body.operation_id);if(prior)return {data:{...prior,replayed:true},error:null};
  if(scenario.mode==='off')return {data:{outcome:'refused',message:'Agreement preparation is disabled in the current autonomy settings.'},error:null};
  if(!body.approved_fingerprint){const document=await preparationReviewDocument(fixture.proposed),consequence={...c,kind:'retain_signing_document',principal_minor:350000,currency:'usd',engagement:fixture.proposed.presentation.payload.engagement};
   if(scenario.mode==='malformed_text')document.presented_body_markdown='Incorrect displayed legal text';if(scenario.mode==='malformed_fact')consequence.principal_minor=350001;
   return {data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Retain this exact reviewed document for signing. No signature request or payment is made.',preview:{eligible:true,consequence},review_document:document},error:null};
  }
  if(scenario.mode==='receipt_failed')return {data:{outcome:'refused',message:'The receipt could not be recorded. The preparation transaction was rolled back.'},error:null};
  scenario.prepared=true;scenario.writes++;const result=receipt(c,body.operation_id);scenario.last=result;operations.set(body.operation_id,result);
  if(scenario.mode==='unknown')throw Error('Synthetic interrupted response');if(scenario.mode==='malformed_receipt')return {data:{ok:true,outcome:'agreement_prepared'},error:null};return {data:result,error:null};
 }},
};
