import { UUID } from '../sales-collections/primitives.ts';
import { canonicalPresentationJson, commercialPresentationText, prepareCommercialPresentation, type PreparedCommercialPresentation } from './commercial-presentation.ts';

type Row=Record<string,unknown>;
type Caller={rpc(name:string,args?:Row):PromiseLike<{data:unknown;error:unknown}>};
const object=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const only=(v:Row,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
export type AcceptedCommercialRead=
 | {state:'refused'}
 | {state:'unverified'}
 | {state:'recorded';presentation:PreparedCommercialPresentation;presented_body_markdown:string;completed_at:string;receipt_id:string;sealed_sha256:string};

/** Explicit owner inspection of retained economics. Existing RPC owns caller,
 * tenant, client, invoice/signing linkage, consent and completion authorization.
 * Reuse C1's exact parser/composer rather than infer terms or parse legal prose.
 * Recorded completion does not verify present PDF availability, activate terms,
 * collect payment, notify a customer or establish completed service delivery.
 */
export async function readAcceptedCommercialAgreement(tenant:unknown,args:unknown,caller:Caller):Promise<AcceptedCommercialRead>{
 const refused:AcceptedCommercialRead={state:'refused'};
 if(!id(tenant)||!object(args)||!only(args,['invoice_id','agreement_id'])||!id(args.invoice_id)||!id(args.agreement_id))return refused;
 try{
  const result=await caller.rpc('read_sales_accepted_agreement',{_expected_tenant_id:tenant,_invoice_id:args.invoice_id,_agreement_id:args.agreement_id});
  if(result.error||!object(result.data))return refused;
  const r=result.data;
  if(r.schema_version!==1||r.tenant_id!==tenant||r.invoice_id!==args.invoice_id||r.agreement_id!==args.agreement_id||!id(r.receipt_id))return refused;
  const base=['schema_version','state','tenant_id','invoice_id','agreement_id','receipt_id'];
  if(r.state==='unverified')return only(r,base)?{state:'unverified'}:refused;
  if(r.state!=='recorded'||!only(r,[...base,'completed_at','payload','payload_digest','body_markdown','presented_body_markdown','document_sha256','sealed_sha256'])
   ||!object(r.payload)||!hash(r.payload_digest)||!hash(r.document_sha256)||!hash(r.sealed_sha256)
   ||typeof r.completed_at!=='string'||!Number.isFinite(Date.parse(r.completed_at))
   ||typeof r.body_markdown!=='string'||typeof r.presented_body_markdown!=='string'||r.presented_body_markdown.length>300000)return refused;
  const p=r.payload;
  if(!only(p,['schema_version','source','title','body_sha256','principal_minor','currency','amount_basis','collection_terms','obligations','conditions','lines'])
   ||!object(p.source)||p.source.tenant_id!==tenant||p.source.invoice_id!==args.invoice_id||p.source.agreement_id!==args.agreement_id)return refused;
  const presentation=await prepareCommercialPresentation({schema_version:p.schema_version,source:p.source,title:p.title,
   body_markdown:r.body_markdown,principal_minor:p.principal_minor,currency:p.currency,collection_terms:p.collection_terms,conditions:p.conditions,lines:p.lines});
  if(presentation.payload_digest!==r.payload_digest||canonicalPresentationJson(presentation.payload)!==canonicalPresentationJson(p)
   ||commercialPresentationText(r.body_markdown,presentation)!==r.presented_body_markdown)return refused;
  return {state:'recorded',presentation,presented_body_markdown:r.presented_body_markdown,completed_at:r.completed_at,receipt_id:r.receipt_id,sealed_sha256:r.sealed_sha256 as string};
 }catch{return refused;}
}
