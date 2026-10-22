import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {documentDescriptorSchema,assignedFieldSchema} from './agreementDocumentModel';
import {readAgreementPdfDocument,type AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {canonicalPresentationJson} from '../../../supabase/functions/_shared/agreements/preparation-json';
import {sha256Hex} from '../../../supabase/functions/_shared/agreements/token';
import {verifyRetainedAgreementPdf} from '../../../supabase/functions/_shared/agreements/retained-document';

const id=z.string().uuid(),date=z.string().datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/);
const role=z.enum(['counterparty','tenant_signatory','witness']);
const status=z.enum(['draft','sent','viewed','partially_signed','completed','declined','voided','expired']);
const party=z.object({id,full_name:z.string().min(1),email:z.string().min(1),signer_role:role,signing_order:z.number().int().positive(),status:z.enum(['pending','viewed','signed','declined'])}).strict();
const sourceRef={tenant_id:id,agreement_id:id,client_id:id,version:z.number().int().positive(),updated_at:date};
const source=z.object({...sourceRef,status,signers:z.array(party).max(100)}).strict();
const manifest=z.object({schema_version:z.literal(1),source:z.object(sourceRef).strict(),document:documentDescriptorSchema,
  signers:z.array(z.object({id,identity_sha256:hash,signer_role:role,signing_order:z.number().int().positive()}).strict()).max(100),fields:z.array(assignedFieldSchema).max(500)}).strict();
const preparation=z.object({id,agreement_id:id,client_id:id,revision_no:z.number().int().positive(),source_version:z.number().int().positive(),source_updated_at:date,actor_user_id:id,
  document_sha256:hash,document_byte_length:z.number().int().min(5).max(26214400),manifest,preparation_sha256:hash,event_id:id,is_selected:z.boolean(),created_at:date,
  source_scope:z.literal('agreement_and_parties'),source_matches:z.boolean(),commercial_verification:z.enum(['not_applicable','not_checked'])}).strict();
const common={title:z.string().min(1),source,can_prepare:z.boolean(),preparation_hold:z.enum(['commercial_review_required','source_not_editable']).nullable(),document_signers:z.array(party).max(100)};
const view=z.discriminatedUnion('state',[z.object({state:z.literal('none'),...common}).strict(),z.object({state:z.literal('retained'),...common,preparation,can_edit:z.boolean()}).strict()]);
const receipt=z.object({state:z.enum(['recorded','recovered']),historical_receipt:z.literal(true),id,event_id:id,revision_no:z.number().int().positive(),document_sha256:hash,preparation_sha256:hash,is_selected:z.boolean()}).strict();
const readReply=z.object({ok:z.literal(true),view}).strict(),writeReply=z.object({ok:z.literal(true),view,receipt}).strict();
const history=z.object({items:z.array(z.object({id,revision_no:z.number().int().positive(),source_version:z.number().int().positive(),created_at:date,is_selected:z.boolean(),
  document_sha256:hash,preparation_sha256:hash,event_id:id,actor_user_id:id}).strict()).max(20),has_more:z.boolean()}).strict();
type RawView=z.infer<typeof view>;
type RetainedView=Extract<RawView,{state:'retained'}>;
// Preserve the native validator's required rotation/page shape after decoding.
// Zod's union inference alone is optional under this project's TS configuration.
export type AgreementDocumentView=Extract<RawView,{state:'none'}>|(Omit<RetainedView,'preparation'>&{
  preparation:Omit<RetainedView['preparation'],'manifest'>&{manifest:Omit<RetainedView['preparation']['manifest'],'document'>&{document:ReturnType<typeof readAgreementPdfDocument>}}
});
export type AgreementDocumentReceipt=z.infer<typeof receipt>;
export type AgreementDocumentHistory=z.infer<typeof history>;
export type AgreementDocumentContext={tenantId:string;actorId:string;agreementId:string;isCurrent:()=>boolean};
type ExpectedSource={client_id:string;version:number;updated_at:string};
export type AgreementDocumentCommand={tenant_id:string;agreement_id:string;request_id:string;expected_source:ExpectedSource}&(
  {action:'prepare_document';expected_current_id:string|null}|{action:'retain_fields';source_preparation_id:string;fields:AgreementFieldPreparation['manifest']['fields']}
);
export type DocumentFailure='access_unverified'|'source_changed'|'commercial_review_required'|'document_unavailable'|'rate_limited'|'invalid_request'|'unconfirmed'|'retired';
export type DocumentResult<T>={ok:true;value:T}|{ok:false;reason:DocumentFailure;message:string};
const messages:Record<DocumentFailure,string>={access_unverified:'Agreement access could not be verified. Reopen the record in the intended business.',source_changed:'The agreement or selected preparation changed. Inspect its current version before continuing.',
  commercial_review_required:'Review the original commercial terms before preparing this signing document.',document_unavailable:'The exact PDF could not be prepared or verified. Check the source document and its supported format.',
  rate_limited:'Too many preparation attempts. Keep this request and check again later.',invalid_request:'Choose the original agreement and preparation before continuing.',unconfirmed:'The result could not be confirmed. Check the same preparation request; it may already be recorded.',retired:'Your business, sign-in or agreement access changed. Reopen the original preparation.'};
const failure=(reason:DocumentFailure)=>({ok:false as const,reason,message:messages[reason]});
function valid(ctx:AgreementDocumentContext){return [ctx.tenantId,ctx.actorId,ctx.agreementId].every(v=>id.safeParse(v).success&&v===v.toLowerCase());}
function isCurrent(ctx:AgreementDocumentContext){try{return ctx.isCurrent()===true;}catch{return false;}}
type Reply={data:unknown;error:unknown};
type RpcBuilder=PromiseLike<Reply>&{setHeader(name:string,value:string):RpcBuilder;abortSignal(signal:AbortSignal):PromiseLike<Reply>};
const native=supabase as unknown as {rpc(name:string,args:Record<string,unknown>):RpcBuilder};
async function errorCode(error:unknown):Promise<DocumentFailure>{
  if(typeof error!=='object'||error===null)return 'unconfirmed';
  const e=error as {code?:unknown;context?:unknown};
  if(e.code==='42501')return 'access_unverified';if(e.code==='23514'||e.code==='40001')return 'source_changed';
  if(!(e.context instanceof Response)||!e.context.headers.get('Content-Type')?.startsWith('application/json'))return 'unconfirmed';
  const reader=e.context.clone().body?.getReader();if(!reader)return 'unconfirmed';
  try{let text='',bytes=0;const decoder=new TextDecoder();while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2048){
      // A cloned Response is a tee: cancellation may wait for its other reader.
      // Stop consuming without allowing that transport cleanup to hold the UI.
      void reader.cancel().catch(()=>{});return 'unconfirmed';}text+=decoder.decode(part.value,{stream:true});}
    const value=JSON.parse(text+decoder.decode());const code=value?.code;
    return typeof code==='string'&&Object.prototype.hasOwnProperty.call(messages,code)&&code!=='retired'?code as DocumentFailure:'unconfirmed';
  }catch{return 'unconfirmed';}finally{reader.releaseLock();}
}
/** Same existing SDK/Auth, pinned to the actual user BEFORE dispatch. This is
 * no credential store or authority fallback. Deadline never proves rollback. */
async function authorized<T>(ctx:AgreementDocumentContext,request:(headers:Record<string,string>,signal:AbortSignal)=>PromiseLike<Reply>,decode:(value:unknown)=>Promise<T>):Promise<DocumentResult<T>>{
  ctx={...ctx};
  if(!valid(ctx))return failure('invalid_request');if(!isCurrent(ctx))return failure('retired');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const active=()=>!controller.signal.aborted&&isCurrent(ctx);
  const work=async():Promise<DocumentResult<T>>=>{
    try{
      const auth=await supabase.auth.getSession();if(!active())return failure('retired');
      const session=auth.data.session;
      if(auth.error||!session||session.user.id!==ctx.actorId||session.user.is_anonymous||!session.access_token)return failure('access_unverified');
      const response=await request({Authorization:`Bearer ${session.access_token}`},controller.signal);
      if(!active())return failure('retired');if(response.error){const reason=await errorCode(response.error);return active()?failure(reason):failure('retired');}
      const decoded=await decode(response.data);return active()?{ok:true,value:decoded}:failure('retired');
    }catch{return active()?failure('unconfirmed'):failure('retired');}
  };
  try{return await Promise.race([work(),new Promise<DocumentResult<T>>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(failure('unconfirmed'));},20000);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
async function verifyView(value:RawView,ctx:AgreementDocumentContext,expectedId:string|null):Promise<AgreementDocumentView>{
  if(value.source.tenant_id!==ctx.tenantId||value.source.agreement_id!==ctx.agreementId)throw Error('Unverified document scope');
  if(value.state==='none'){if(expectedId)throw Error('Missing requested preparation');return value;}
  const p=value.preparation,m=p.manifest;
  if(expectedId&&p.id!==expectedId||p.agreement_id!==ctx.agreementId||m.source.tenant_id!==ctx.tenantId||m.source.agreement_id!==ctx.agreementId
    ||m.source.client_id!==p.client_id||m.source.version!==p.source_version||m.source.updated_at!==p.source_updated_at
    ||m.document.sha256!==p.document_sha256||m.document.byte_length!==p.document_byte_length)throw Error('Unverified original preparation');
  const document=readAgreementPdfDocument(m.document);
  if(await sha256Hex(canonicalPresentationJson(m))!==p.preparation_sha256)throw Error('Unverified preparation digest');
  return {...value,preparation:{...p,manifest:{...m,document}}};
}
export async function readAgreementDocument(ctx:AgreementDocumentContext,preparationId:string|null=null):Promise<DocumentResult<AgreementDocumentView>>{
  ctx={...ctx};
  if(preparationId!==null&&!id.safeParse(preparationId).success)return failure('invalid_request');
  const query=new URLSearchParams({preparation:'metadata',businessId:ctx.tenantId,agreementId:ctx.agreementId});if(preparationId)query.set('preparationId',preparationId);
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>verifyView(readReply.parse(data).view,ctx,preparationId));
}
export function prepareAgreementDocumentCommand(ctx:AgreementDocumentContext,requestId:string,current:AgreementDocumentView,fields?:AgreementFieldPreparation):AgreementDocumentCommand|null{
  if(!valid(ctx)||!id.safeParse(requestId).success||requestId!==requestId.toLowerCase()||!isCurrent(ctx)||!current.can_prepare||current.source.tenant_id!==ctx.tenantId||current.source.agreement_id!==ctx.agreementId)return null;
  const s=current.source,expected_source={client_id:s.client_id,version:s.version,updated_at:s.updated_at};
  let command:AgreementDocumentCommand;
  if(fields){
    if(current.state!=='retained'||!current.can_edit||!current.preparation.is_selected||requestId===current.preparation.id
      ||canonicalPresentationJson(fields.manifest.source)!==canonicalPresentationJson({tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,...expected_source})
      ||fields.manifest.document.sha256!==current.preparation.document_sha256)return null;
    command={tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,request_id:requestId,expected_source,action:'retain_fields',source_preparation_id:current.preparation.id,fields:structuredClone(fields.manifest.fields)};
    for(const field of command.fields)Object.freeze(field);Object.freeze(command.fields);
  }else{
    if(current.state==='retained'&&!current.preparation.is_selected)return null;
    command={tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,request_id:requestId,expected_source,action:'prepare_document',expected_current_id:current.state==='retained'?current.preparation.id:null};
  }
  Object.freeze(expected_source);return Object.freeze(command);
}
export async function saveAgreementDocument(ctx:AgreementDocumentContext,command:AgreementDocumentCommand):Promise<DocumentResult<{view:AgreementDocumentView;receipt:AgreementDocumentReceipt}>>{
  ctx={...ctx};
  if(command.tenant_id!==ctx.tenantId||command.agreement_id!==ctx.agreementId)return failure('invalid_request');
  const captured=structuredClone(command);
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document',{method:'POST',headers,signal,body:captured}),async data=>{
    const response=writeReply.parse(data),p=await verifyView(response.view,ctx,captured.request_id);
    if(p.state!=='retained'||response.receipt.id!==captured.request_id||response.receipt.event_id!==p.preparation.event_id||response.receipt.revision_no!==p.preparation.revision_no||response.receipt.is_selected!==p.preparation.is_selected||response.receipt.document_sha256!==p.preparation.document_sha256
      ||response.receipt.preparation_sha256!==p.preparation.preparation_sha256||p.preparation.client_id!==captured.expected_source.client_id||p.preparation.source_version!==captured.expected_source.version
      ||p.preparation.source_updated_at!==captured.expected_source.updated_at)throw Error('Unverified original receipt');
    return {view:p,receipt:response.receipt};
  });
}
export async function readAgreementDocumentPdf(ctx:AgreementDocumentContext,current:Extract<AgreementDocumentView,{state:'retained'}>):Promise<DocumentResult<Uint8Array>>{
  ctx={...ctx};const p={...current.preparation};
  if(current.source.tenant_id!==ctx.tenantId||current.source.agreement_id!==ctx.agreementId||p.agreement_id!==ctx.agreementId)return failure('invalid_request');
  const query=new URLSearchParams({preparation:'pdf',businessId:ctx.tenantId,agreementId:ctx.agreementId,preparationId:p.id});
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>{
    if(!(data instanceof Blob)||data.type.split(';')[0]!=='application/pdf'||data.size!==p.document_byte_length)throw Error('Unverified PDF bytes');
    const bytes=new Uint8Array(await data.arrayBuffer());if(!await verifyRetainedAgreementPdf(bytes,p.document_sha256))throw Error('Unverified document checksum');return bytes;
  });
}
export function listAgreementDocumentHistory(ctx:AgreementDocumentContext,before:number|null=null):Promise<DocumentResult<AgreementDocumentHistory>>{
  ctx={...ctx};
  if(before!==null&&(!Number.isSafeInteger(before)||before<1))return Promise.resolve(failure('invalid_request'));
  return authorized(ctx,(headers,signal)=>native.rpc('list_agreement_document_preparations',{_expected_tenant_id:ctx.tenantId,_agreement_id:ctx.agreementId,_limit:20,_before_revision:before})
    .setHeader('Authorization',headers.Authorization).abortSignal(signal),async data=>history.parse(data));
}
