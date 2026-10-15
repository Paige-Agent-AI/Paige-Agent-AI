import {UUID,object} from '../sales-collections/primitives.ts';
import {decodeRetainedCommercialPresentation} from './retained-presentation.ts';
import {commercialPreparationCommand,hasCommercialPreparationReceipt} from '../sales-commercial/preparation-command.ts';
import type {PreparedCommercialPresentation} from './commercial-presentation.ts';
type Row=Record<string,unknown>;
type Caller={rpc(name:string,args?:Row):PromiseLike<{data:unknown;error:unknown}>};
const only=(value:Row,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const statuses=['draft','sent','viewed','partially_signed','completed','declined','voided','expired'] as const;
export type RetainedCommercialRead={state:'refused'}|{state:'unverified'}|{
 state:'retained';presentation:PreparedCommercialPresentation;presented_body_markdown:string;
 current_status:typeof statuses[number]|'unrecognised';receipt_id:string;preparation:Row|null;
};
/** Explicit owner-only RPC. Current state is independent of immutable wording;
 * absent historical preparation receipts are not invented or called approval. */
export async function readRetainedCommercialAgreement(tenant:unknown,args:unknown,caller:Caller):Promise<RetainedCommercialRead>{
 const refused:RetainedCommercialRead={state:'refused'};
 if(!id(tenant)||!object(args)||!only(args,['invoice_id','agreement_id'])||!id(args.invoice_id)||!id(args.agreement_id))return refused;
 try{
  const {data:r,error}=await caller.rpc('read_sales_prepared_agreement',{_expected_tenant_id:tenant,_invoice_id:args.invoice_id,_agreement_id:args.agreement_id});
  if(error||!object(r)||r.schema_version!==1||r.tenant_id!==tenant||r.invoice_id!==args.invoice_id||r.agreement_id!==args.agreement_id||!id(r.receipt_id))return refused;
  const base=['schema_version','state','tenant_id','invoice_id','agreement_id','receipt_id'];
  if(r.state==='unverified')return only(r,base)?{state:'unverified'}:refused;
  if(r.state!=='retained'||!only(r,[...base,'current_status','payload','payload_digest','body_markdown','presented_body_markdown','document_sha256','preparation'])
   ||typeof r.document_sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.document_sha256)||typeof r.current_status!=='string'||!object(r.payload)||!object(r.payload.source)
   ||r.payload.source.tenant_id!==tenant||r.payload.source.invoice_id!==args.invoice_id||r.payload.source.agreement_id!==args.agreement_id)return refused;
  const presentation=await decodeRetainedCommercialPresentation(r.payload,r.payload_digest,r.body_markdown,r.presented_body_markdown);
  if(!presentation)return refused;
  let preparation:Row|null=null;
  if(r.preparation!==null){
   if(presentation.payload.schema_version!==2||!hasCommercialPreparationReceipt(r.preparation,tenant,commercialPreparationCommand(presentation))
    ||!object(r.preparation)||!object(r.preparation.row)||r.preparation.row.document_sha256!==r.document_sha256)return refused;
   preparation=r.preparation;
  }
  return {state:'retained',presentation,presented_body_markdown:r.presented_body_markdown as string,receipt_id:r.receipt_id,preparation,
   current_status:statuses.includes(r.current_status as typeof statuses[number])?r.current_status as typeof statuses[number]:'unrecognised'};
 }catch{return refused;}
}
