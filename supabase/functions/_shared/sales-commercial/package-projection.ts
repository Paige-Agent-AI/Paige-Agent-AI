import {UUID} from '../sales-collections/primitives.ts';
import {parseCollectionTerms} from '../sales-collections/contract.ts';
import {previewCollectionSchedule} from '../sales-collections/model.ts';
import {parseCommercialConditions} from './conditions.ts';
import {parseCommercialTermsReference} from './terms-reference.ts';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const id=(v:unknown)=>typeof v==='string'&&UUID.test(v);
const minor=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=2147483647;
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const codes=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=30&&v.every(x=>typeof x==='string'&&/^[a-z_]{1,100}$/.test(x));
function boundedProjection(r:Record<string,unknown>,invoiceId:string):boolean {
 const i=r.invoice,a=r.agreement,t=r.commercial_terms;
 if(!object(i)||!only(i,['id','client_id','status','version','draft_version','issued_snapshot_version','obligation_total_minor','due_now_minor','remaining_scheduled_minor','currency','receivable_total_minor','allocated_minor','manual_recorded_minor','provider_verified_minor','outstanding_minor','due_date','delivery_channels','commercial_terms_reference'])
  ||i.id!==invoiceId||!id(i.client_id)||!positive(i.version)||!positive(i.draft_version)
  ||!(i.issued_snapshot_version===null||positive(i.issued_snapshot_version))||!['draft','issued','sent','void'].includes(String(i.status))
  ||typeof i.currency!=='string'||!/^[a-z]{3}$/.test(i.currency)
  ||!['receivable_total_minor','allocated_minor','manual_recorded_minor','provider_verified_minor','outstanding_minor'].every(k=>minor(i[k]))
  ||!['obligation_total_minor','due_now_minor','remaining_scheduled_minor'].every(k=>i[k]===null||minor(i[k]))
  ||!(i.due_date===null||date(i.due_date))
  ||!(i.delivery_channels===null||Array.isArray(i.delivery_channels)&&i.delivery_channels.length<=2&&i.delivery_channels.every(c=>c==='email'||c==='sms'))
  ||Number(i.allocated_minor)+Number(i.outstanding_minor)!==i.receivable_total_minor
  ||Number(i.manual_recorded_minor)+Number(i.provider_verified_minor)!==i.allocated_minor)return false;
 if(a!==null&&(!object(a)||!only(a,['id','version','status','body_source','commercial_terms_id','document_available','treatment'])
  ||!id(a.id)||!positive(a.version)||typeof a.document_available!=='boolean'||!(a.commercial_terms_id===null||id(a.commercial_terms_id))
  ||!['draft','sent','viewed','partially_signed','completed','declined','voided','expired'].includes(String(a.status))
  ||!['tenant_upload','paige_draft','tenant_template'].includes(String(a.body_source))
  ||!['include_existing_signed_document','unsigned_canonical_agreement','unavailable'].includes(String(a.treatment))))return false;
 let reference:ReturnType<typeof parseCommercialTermsReference>|null=null;
 if('commercial_terms_reference' in i){try{reference=parseCommercialTermsReference(i.commercial_terms_reference);}catch{return false;}}
 if(reference&&t===null)return false;
 if(t!==null){
  if(!object(t)||!only(t,['id','version','updated_at','status','offer_id','amount_minor','currency','record_owner','schedule'])
   ||!id(t.id)||!Number.isSafeInteger(t.version)||Number(t.version)<0||t.record_owner!=='commercial_collection_terms'
   ||!(t.offer_id===null||id(t.offer_id))||!(t.amount_minor===null||minor(t.amount_minor))
   ||!(t.currency===null||typeof t.currency==='string'&&/^[a-z]{3}$/.test(t.currency))
   ||!['draft','active','paused','completed','cancelled'].includes(String(t.status))
   ||typeof t.updated_at!=='string'||t.updated_at.length>50||!Number.isFinite(Date.parse(t.updated_at)))return false;
  if(reference){
   if(reference.id!==t.id||!codes(r.conflicts))return false;
   if(reference.version!==t.version&&!r.conflicts.includes('commercial_terms_version_changed'))return false;
   if(object(a)&&a.commercial_terms_id!==null&&a.commercial_terms_id!==t.id&&!r.conflicts.includes('agreement_commercial_terms_conflict'))return false;
  }else if(!object(a)||t.id!==a.commercial_terms_id)return false;
  if(t.schedule!==null){const s=t.schedule;
   if(!object(s)||!only(s,['kind','total_cents','currency','cadence','anchor_date','count','end_date','deposit_cents','dates'])
    ||!['full','installment','recurring','deposit','milestone','custom'].includes(String(s.kind))
    ||!minor(s.total_cents)||typeof s.currency!=='string'||!/^[a-z]{3}$/.test(s.currency)
    ||!['monthly','quarterly','annual','custom'].includes(String(s.cadence))||!date(s.anchor_date)
    ||!(s.end_date===null||date(s.end_date))||!(s.count===null||positive(s.count)&&Number(s.count)<=240)
    ||!(s.deposit_cents===null||minor(s.deposit_cents))
    ||!Array.isArray(s.dates)||s.dates.length>240||s.dates.some(d=>!object(d)||!only(d,['due_date','amount_cents'])
      ||typeof d.due_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.due_date)||!minor(d.amount_cents)))return false;
  }
 }
 return Array.isArray(r.offers)&&r.offers.length<=50&&r.offers.every(o=>object(o)&&only(o,['id','price_id','unit_minor','currency','quantity','price_basis'])
  &&id(o.id)&&id(o.price_id)&&minor(o.unit_minor)&&positive(o.quantity)&&o.currency===i.currency&&o.price_basis==='frozen_invoice_catalog_facts')
  &&codes(r.missing_fields)&&codes(r.conflicts);
}

/** Expand only the authenticated RPC's recorded principal schedule through the same
 * parser/calculator used by manual Collections. Its projection omits tax/fee policy;
 * parser defaults are never exposed as agreed zero fees. This is not an obligation
 * ledger, mandate, signing compatibility finding or per-installment payment state.
 */
function recordedSchedulePreview(r:Record<string,unknown>) {
 const t=r.commercial_terms;
 if(!object(t)||t.schedule===null)return null;
 if(!object(t.schedule)||!object(r.invoice))throw Error('INVALID_CANONICAL_SCHEDULE');
 const terms=parseCollectionTerms({schema_version:1,...t.schedule});
 const staleTerms=(t.amount_minor!==null&&t.amount_minor!==terms.total_cents)
  ||(t.currency!==null&&t.currency!==terms.currency);
 const conflicts=r.conflicts as string[];
 if(staleTerms&&!conflicts.includes('recorded_terms_stale'))throw Error('INVALID_CANONICAL_SCHEDULE');
 if(r.invoice.currency!==terms.currency&&!conflicts.includes('invoice_terms_conflict'))throw Error('INVALID_CANONICAL_SCHEDULE');
 // Preserve the canonical reader's explanation of stale/conflicting records.
 // Never present their schedule as a resolved commercial package.
 if(conflicts.length>0)return null;
 const preview=previewCollectionSchedule(terms,24);
 return {schema_version:1,basis:'recorded_principal_schedule',
  commercial_terms_status:t.status,source:{commercial_terms_id:t.id,commercial_terms_version:t.version,
   commercial_terms_updated_at:t.updated_at,invoice_id:r.invoice.id,invoice_version:r.invoice.version},
  ...preview};
}

/** Caller-JWT RPC only. This seam grants no approval and never uses a service-role reader.
 * The existing Sales domain dispatcher consumes this read; C4 remains the shared resume owner.
 */
export async function readCommercialPackage(tenant:string|null,args:Record<string,unknown>,caller:{rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}):Promise<{content:Record<string,unknown>}> {
 const refused=()=>({content:{success:false,error:'Commercial package unavailable in this workspace.'}});
 if(typeof tenant!=='string'||!UUID.test(tenant)||Object.keys(args).length!==1
   ||typeof args.invoice_id!=='string'||!UUID.test(args.invoice_id))return refused();
 try {
  const result=await caller.rpc('read_sales_commercial_package',{_expected_tenant_id:tenant,_invoice_id:args.invoice_id});
  if(result.error)return refused();
  const data=result.data;
  if(!data||typeof data!=='object'||Array.isArray(data))return refused();
  const r=data as Record<string,unknown>;
  if(r.schema_version!==1||r.tenant_id!==tenant||typeof r.receipt_id!=='string'||!UUID.test(r.receipt_id)
    ||r.authority!=='not_evaluated'||r.execution!=='not_started'||!['needs_input','conflict'].includes(String(r.state)))return refused();
  // The database is the canonical allowlisted projector. Refuse extensions rather than
  // sending a future raw row/document/authority field into a model consumer.
  const keys=['schema_version','tenant_id','invoice','offers','agreement','commercial_terms','commercial_conditions','compatibility','missing_fields','conflicts','authority','execution','state','receipt_id'];
  if(Object.keys(r).some(k=>!keys.includes(k))||!boundedProjection(r,args.invoice_id))return refused();
  const conditions=parseCommercialConditions(r.commercial_conditions);
  const unresolved=conditions===null||conditions.tax.state==='unknown'||conditions.fees.state==='unknown';
  if(unresolved&&!(r.missing_fields as string[]).includes('tax_and_fee_treatment'))return refused();
  if('compatibility' in r){const c=r.compatibility;
   if(!object(c)||!only(c,['basis','signed_economics'])||c.basis!=='canonical_relationship_and_invoice_source_version'
    ||!['unverified_no_frozen_commercial_snapshot','not_signed'].includes(String(c.signed_economics)))return refused();
   if(object(r.agreement)&&r.agreement.status==='completed'
    &&(c.signed_economics!=='unverified_no_frozen_commercial_snapshot'||!(r.missing_fields as string[]).includes('signed_terms_compatibility')))return refused();
  }
  return {content:{success:true,...r,schedule_preview:recordedSchedulePreview(r)}};
 }catch{return refused();}
}
