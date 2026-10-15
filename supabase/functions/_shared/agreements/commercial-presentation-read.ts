import { UUID } from '../sales-collections/primitives.ts';
import { prepareCommercialPresentation, type PreparedCommercialPresentation } from './commercial-presentation.ts';

type Row = Record<string, unknown>;
type Result = {data:unknown;error:unknown};
type Query = {select(columns:string):Query;eq(key:string,value:string):Query;maybeSingle():PromiseLike<Result>};
type Caller = {rpc(name:string,args?:Record<string,unknown>):PromiseLike<Result>;from:unknown};
export type PresentationSourceRead =
  | {state:'refused';code:'PRESENTATION_SOURCE_UNAVAILABLE'}
  | {state:'needs_input';fields:string[]}
  | {state:'source';input:Row & {source:Row}};
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const version=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const refuse=():PresentationSourceRead=>({state:'refused',code:'PRESENTATION_SOURCE_UNAVAILABLE'});

/** Preparation only. Caller-JWT reads existing records; no save, approval, send or
 * signature claim. The returned source still requires the presentation validator,
 * original approval binding and atomic canonical freeze before consequential use.
 * Expected tenant is a brake; the session's active workspace and admin role are
 * re-proven before and after reads. No service client or URL account authority.
 */
export async function readCommercialPresentationSource(
  tenant:unknown,args:unknown,caller:Caller,
):Promise<PresentationSourceRead> {
  if(!id(tenant)||!object(args)||Object.keys(args).length!==2
    ||!id(args.invoice_id)||!id(args.agreement_id)||typeof caller.from!=='function')return refuse();
  try {
    const scope=async()=>{
      const active=await caller.rpc('current_user_tenant_id');
      if(active.error||active.data!==tenant)return false;
      const admin=await caller.rpc('is_tenant_admin',{_tenant:tenant});
      return !admin.error&&admin.data===true;
    };
    if(!await scope())return refuse();
    const read=async(table:string,columns:string,recordId:string):Promise<Row|null>=>{
      // Keep Supabase's generic select parser out of this internal query port;
      // runtime rows and exact tenant/resource identities are checked below.
      const query=(caller.from as (table:string)=>Query).call(caller,table);
      const result=await query.select(columns).eq('tenant_id',tenant).eq('id',recordId).maybeSingle();
      return !result.error&&object(result.data)&&result.data.tenant_id===tenant&&result.data.id===recordId?result.data:null;
    };
    const i=await read('paige_invoices',
      'id,tenant_id,contact_id,status,currency,updated_at,billing_lifecycle_version,billing_draft_version,billing_draft',args.invoice_id);
    const a=await read('paige_agreements',
      'id,tenant_id,contact_id,offer_id,commercial_terms_id,version,updated_at,title,body_markdown,body_source,status,content_sha256,content_storage_key',args.agreement_id);
    if(!i||!a||!id(i.contact_id)||i.contact_id!==a.contact_id||i.status!=='draft'||a.status!=='draft'
      ||a.content_sha256!==null||(a.content_storage_key!==undefined&&a.content_storage_key!==null)
      ||!['paige_draft','tenant_template'].includes(String(a.body_source)))return refuse();
    if(!object(i.billing_draft))return {state:'needs_input',fields:['canonical_invoice_draft']};
    const d=i.billing_draft;
    if(!object(d.agreement_snapshot))return {state:'needs_input',fields:['agreement_source_version']};
    if(d.agreement_snapshot.id!==a.id||d.agreement_snapshot.version!==a.version)return refuse();
    if(!object(d.commercial_terms_reference))return {state:'needs_input',fields:['commercial_terms_reference']};
    const ref=d.commercial_terms_reference;
    if(!id(ref.id)||ref.id!==a.commercial_terms_id)return refuse();
    const t=await read('tenant_client_agreements',
      'id,tenant_id,contact_id,offer_id,status,collection_terms_version,collection_terms,updated_at,agreed_amount_minor,agreed_currency',ref.id);
    if(!t||t.contact_id!==i.contact_id||!id(t.offer_id)||t.offer_id!==a.offer_id
      ||!['draft','active','paused'].includes(String(t.status))||ref.version!==t.collection_terms_version)return refuse();
    if(!version(a.version)||!version(i.billing_lifecycle_version)||!version(i.billing_draft_version)
      ||!Number.isSafeInteger(t.collection_terms_version)||Number(t.collection_terms_version)<0
      ||![a.updated_at,i.updated_at,t.updated_at].every(timestamp))return refuse();
    const missing:string[]=[];
    if(!object(t.collection_terms))missing.push('recorded_collection_terms');
    if(!object(d.commercial_conditions))missing.push('tax_and_fee_treatment');
    if(!Array.isArray(d.items)||!d.items.length)missing.push('recorded_invoice_lines');
    if(missing.length)return {state:'needs_input',fields:missing};
    if(i.currency!=='usd'||String(t.agreed_currency).toLowerCase()!=='usd'
      ||!Number.isSafeInteger(d.total_minor)||Number(d.total_minor)<=0||d.total_minor!==t.agreed_amount_minor)return refuse();
    const items=d.items as unknown[];
    if(!items.every(object)||!items.some(item=>object(item.catalog_facts)&&item.catalog_facts.product_id===t.offer_id))return refuse();
    const lines=items.map(item=>({unit_minor:item.unit_minor??(object(item.catalog_facts)?item.catalog_facts.unit_minor:undefined),quantity:item.quantity}));
    if(!await scope())return refuse();
    return {state:'source',input:{
      schema_version:1,
      source:{tenant_id:tenant,client_id:i.contact_id,offer_id:t.offer_id,agreement_id:a.id,
        agreement_version:a.version,agreement_updated_at:a.updated_at,body_source:a.body_source,status:a.status,content_sha256:a.content_sha256,
        terms_id:t.id,terms_version:t.collection_terms_version,terms_updated_at:t.updated_at,
        invoice_id:i.id,invoice_version:i.billing_lifecycle_version,invoice_draft_version:i.billing_draft_version,invoice_updated_at:i.updated_at},
      title:a.title,body_markdown:a.body_markdown,principal_minor:d.total_minor,currency:i.currency,
      collection_terms:t.collection_terms,conditions:d.commercial_conditions,lines,
    }};
  }catch{return refuse();}
}

/** Original proposal material only; it creates no approval and freezes no record. */
export async function prepareCommercialPresentationFromRecords(tenant:unknown,args:unknown,caller:Caller):Promise<
  Exclude<PresentationSourceRead,{state:'source'}>|{state:'proposed';presentation:PreparedCommercialPresentation}
> {
  const source=await readCommercialPresentationSource(tenant,args,caller);
  if(source.state!=='source')return source;
  try{return {state:'proposed',presentation:await prepareCommercialPresentation(source.input)};}
  catch{return {state:'needs_input',fields:['complete_supported_commercial_presentation']};}
}
