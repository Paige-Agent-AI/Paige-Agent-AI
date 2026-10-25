import {z} from 'zod';
import {normalizeCommsEmailAddress,commsEmailBodyHtml} from '../../../supabase/functions/_shared/comms-email/contract';
import {supabase} from '@/integrations/supabase/client';
import {documentDescriptorSchema,assignedFieldSchema} from './agreementDocumentModel';
import {prepareAgreementFields,readAgreementPdfDocument,type AgreementFieldPreparation} from '../../../supabase/functions/_shared/agreements/field-preparation';
import {canonicalPresentationJson} from '../../../supabase/functions/_shared/agreements/preparation-json';
import {sha256Hex} from '../../../supabase/functions/_shared/agreements/token';
import {parsePreparedSignatureReviewIntent,projectPreparedSignatureReview,type PreparedSignatureReview} from '../../../supabase/functions/_shared/agreements/prepared-signature-review-contract';
import {verifyRetainedAgreementPdf} from '../../../supabase/functions/_shared/agreements/retained-document';
import {prepareCommercialPresentation,commercialPresentationText,type PreparedCommercialPresentation} from '../../../supabase/functions/_shared/agreements/commercial-presentation';

const id=z.string().uuid(),date=z.string().datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/);
const role=z.enum(['counterparty','tenant_signatory','witness']);
const status=z.enum(['draft','sent','viewed','partially_signed','completed','declined','voided','expired']);
const party=z.object({id,full_name:z.string().min(1),email:z.string().min(1),signer_role:role,signing_order:z.number().int().positive(),status:z.enum(['pending','viewed','signed','declined'])}).strict();
const sourceRef={tenant_id:id,agreement_id:id,client_id:id,version:z.number().int().positive(),updated_at:date};
const source=z.object({...sourceRef,status,signers:z.array(party).max(100)}).strict();
const manifestFields={source:z.object(sourceRef).strict(),document:documentDescriptorSchema,
  signers:z.array(z.object({id,identity_sha256:hash,signer_role:role,signing_order:z.number().int().positive()}).strict()).max(100),fields:z.array(assignedFieldSchema).max(500)};
// Read immutable native metadata; current economics are re-read through the
// original commercial review door, never inferred from these archived hashes.
const commercialMetadata=z.object({payload:z.object({schema_version:z.literal(2),source:z.object({tenant_id:id,agreement_id:id,client_id:id,
  agreement_version:z.number().int().positive(),agreement_updated_at:date,invoice_id:id}).passthrough()}).passthrough(),
  payload_digest:hash,presented_body_markdown:z.string().min(1).max(300000),presented_body_sha256:hash}).strict();
const manifest=z.discriminatedUnion('schema_version',[z.object({schema_version:z.literal(1),...manifestFields}).strict(),
  z.object({schema_version:z.literal(2),...manifestFields,commercial:commercialMetadata}).strict()]);
const commercialReadback=z.object({state:z.enum(['current','changed','unavailable']),invoice_id:id,payload_digest:hash}).strict();
const preparation=z.object({id,agreement_id:id,client_id:id,revision_no:z.number().int().positive(),source_version:z.number().int().positive(),source_updated_at:date,actor_user_id:id,
  document_sha256:hash,document_byte_length:z.number().int().min(5).max(26214400),manifest,preparation_sha256:hash,event_id:id,is_selected:z.boolean(),created_at:date,
  source_scope:z.literal('agreement_and_parties'),source_matches:z.boolean(),commercial_verification:z.enum(['not_applicable','not_checked'])}).strict();
const common={title:z.string().min(1),source,can_prepare:z.boolean(),preparation_hold:z.enum(['commercial_review_required','source_not_editable']).nullable(),document_signers:z.array(party).max(100)};
const view=z.discriminatedUnion('state',[z.object({state:z.literal('none'),...common}).strict(),z.object({state:z.literal('retained'),...common,preparation,can_edit:z.boolean(),commercial_readback:commercialReadback.optional()}).strict()]);
const receipt=z.object({state:z.enum(['recorded','recovered']),historical_receipt:z.literal(true),id,event_id:id,revision_no:z.number().int().positive(),document_sha256:hash,preparation_sha256:hash,is_selected:z.boolean()}).strict();
const readReply=z.object({ok:z.literal(true),view}).strict(),writeReply=z.object({ok:z.literal(true),view,receipt}).strict();
const history=z.object({items:z.array(z.object({id,revision_no:z.number().int().positive(),source_version:z.number().int().positive(),created_at:date,is_selected:z.boolean(),
  document_sha256:hash,preparation_sha256:hash,event_id:id,actor_user_id:id}).strict()).max(20),has_more:z.boolean()}).strict();
type RawView=z.infer<typeof view>;
type RetainedView=Extract<RawView,{state:'retained'}>;
type VerifiedManifest<T>=T extends unknown?Omit<T,'document'>&{document:ReturnType<typeof readAgreementPdfDocument>}:never;
// Preserve the native validator's required rotation/page shape after decoding.
// Zod's union inference alone is optional under this project's TS configuration.
export type AgreementDocumentView=Extract<RawView,{state:'none'}>|(Omit<RetainedView,'preparation'>&{
  preparation:Omit<RetainedView['preparation'],'manifest'>&{manifest:VerifiedManifest<RetainedView['preparation']['manifest']>;
    /** Local comparison for the original field editor; never a retained/approval digest. */
    derived_fields_sha256?:string}
});
export type AgreementDocumentReceipt=z.infer<typeof receipt>;
export type AgreementDocumentHistory=z.infer<typeof history>;
export type AgreementDocumentContext={tenantId:string;actorId:string;agreementId:string;isCurrent:()=>boolean};
type ExpectedSource={client_id:string;version:number;updated_at:string};
export type AgreementDocumentCommand={tenant_id:string;agreement_id:string;request_id:string;expected_source:ExpectedSource}&(
  {action:'prepare_document';expected_current_id:string|null}
  |{action:'prepare_commercial_document';expected_current_id:string|null;invoice_id:string;commercial_payload_digest:string}
  |{action:'retain_fields';source_preparation_id:string;fields:AgreementFieldPreparation['manifest']['fields']}
);
export type AgreementCommercialReview={state:'needs_input';fields:readonly string[]}|{state:'ready';invoice_id:string;
  presentation:PreparedCommercialPresentation;payload_digest:string;presented_body_markdown:string};
const commercialSources=z.object({tenant_id:id,agreement_id:id,items:z.array(z.object({invoice_id:id,invoice_number:z.string().min(1).max(100),total_minor:z.number().int().positive().max(2147483647),currency:z.literal('usd')}).strict()).max(50),has_more:z.boolean(),next_cursor:id.nullable()}).strict();
export type AgreementCommercialSources=z.infer<typeof commercialSources>;
const commercialReview=z.discriminatedUnion('state',[
  z.object({state:z.literal('needs_input'),tenant_id:id,agreement_id:id,invoice_id:id,fields:z.array(z.string().min(1)).max(30)}).strict(),
  z.object({state:z.literal('ready'),tenant_id:id,agreement_id:id,invoice_id:id,input:z.unknown(),presentation:z.unknown(),payload_digest:hash,presented_body_markdown:z.string().min(1).max(300000)}).strict(),
]);
export type DocumentFailure='message_invalid'|'sender_unverified'|'sender_changed'|'sender_choices_unverified'|'recipient_held'|'fields_incomplete'|'access_unverified'|'source_changed'|'commercial_review_required'|'document_unavailable'|'rate_limited'|'invalid_request'|'unconfirmed'|'retired';
export type DocumentResult<T>={ok:true;value:T}|{ok:false;reason:DocumentFailure;message:string};
const messages:Record<DocumentFailure,string>={message_invalid:'Check every recipient’s subject and message before reviewing again.',sender_unverified:'This email identity is not ready. Check its connection and verification.',sender_changed:'The email identity changed. Refresh the choices and review again.',sender_choices_unverified:'Email identities could not be checked. Keep your message draft and retry.',recipient_held:'A recipient’s communication preferences prevent this request. Check those preferences before reviewing again.',fields_incomplete:'Complete and save the required signature fields before preparing the request.',access_unverified:'Agreement access could not be verified. Reopen the record in the intended business.',source_changed:'The agreement or selected preparation changed. Inspect its current version before continuing.',
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
  let fieldsComparison:string|undefined;
  if(m.schema_version===2){
    const c=m.commercial,s=c.payload.source,r=value.commercial_readback;
    if(!r||r.invoice_id!==s.invoice_id||r.payload_digest!==c.payload_digest||p.commercial_verification!=='not_checked'
      ||s.tenant_id!==m.source.tenant_id||s.agreement_id!==m.source.agreement_id||s.client_id!==m.source.client_id
      ||s.agreement_version!==m.source.version||s.agreement_updated_at!==m.source.updated_at
      ||await sha256Hex(canonicalPresentationJson(c.payload))!==c.payload_digest||await sha256Hex(c.presented_body_markdown)!==c.presented_body_sha256
      ||(value.can_edit||value.can_prepare)&&(r.state!=='current'||!p.source_matches||value.source.status!=='draft'))throw Error('Unverified commercial preparation');
    if(p.source_matches){
      const fields=await prepareAgreementFields(value.source,document,m.fields);
      if(canonicalPresentationJson(fields.manifest)!==canonicalPresentationJson({schema_version:1,source:m.source,document,signers:m.signers,fields:m.fields}))throw Error('Unverified current signer fields');
      fieldsComparison=fields.preparation_sha256;
    }
  }else if(value.commercial_readback)throw Error('Unexpected commercial readback');
  return {...value,preparation:{...p,manifest:{...m,document},...(fieldsComparison?{derived_fields_sha256:fieldsComparison}:{})}};
}
export async function readAgreementCommercialSources(ctx:AgreementDocumentContext,cursor:string|null=null):Promise<DocumentResult<AgreementCommercialSources>>{
  ctx={...ctx};if(cursor!==null&&!id.safeParse(cursor).success)return failure('invalid_request');
  const query=new URLSearchParams({preparation:'commercial_sources',businessId:ctx.tenantId,agreementId:ctx.agreementId});if(cursor)query.set('beforeId',cursor);
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>{
    const result=z.object({ok:z.literal(true),sources:commercialSources}).strict().parse(data).sources;
    if(result.tenant_id!==ctx.tenantId||result.agreement_id!==ctx.agreementId
      ||(result.has_more?!result.next_cursor||result.next_cursor===cursor:result.next_cursor!==null))throw Error('Unverified commercial choices');
    return result;
  });
}
export async function readAgreementCommercialReview(ctx:AgreementDocumentContext,invoiceId:string):Promise<DocumentResult<AgreementCommercialReview>>{
  ctx={...ctx};if(!id.safeParse(invoiceId).success)return failure('invalid_request');
  const query=new URLSearchParams({preparation:'commercial_review',businessId:ctx.tenantId,agreementId:ctx.agreementId,invoiceId});
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>{
    const result=z.object({ok:z.literal(true),review:commercialReview}).strict().parse(data).review;
    if(result.tenant_id!==ctx.tenantId||result.agreement_id!==ctx.agreementId||result.invoice_id!==invoiceId)throw Error('Unverified commercial review');
    if(result.state==='needs_input')return {state:'needs_input' as const,fields:Object.freeze([...result.fields])};
    const prepared=await prepareCommercialPresentation(result.input),s=prepared.payload.source;
    const body=(result.input as {body_markdown:string}).body_markdown,words=commercialPresentationText(body,prepared);
    if(prepared.payload.schema_version!==2||s.tenant_id!==ctx.tenantId||s.agreement_id!==ctx.agreementId||s.invoice_id!==invoiceId
      ||prepared.payload_digest!==result.payload_digest||canonicalPresentationJson(prepared)!==canonicalPresentationJson(result.presentation)
      ||words!==result.presented_body_markdown)throw Error('Unverified canonical commercial presentation');
    return Object.freeze({state:'ready' as const,invoice_id:invoiceId,presentation:prepared,payload_digest:prepared.payload_digest,presented_body_markdown:words});
  });
}
export function prepareAgreementCommercialCommand(ctx:AgreementDocumentContext,requestId:string,current:AgreementDocumentView,review:AgreementCommercialReview):AgreementDocumentCommand|null{
  if(!valid(ctx)||!isCurrent(ctx)||!id.safeParse(requestId).success||requestId!==requestId.toLowerCase()||!review||review.state!=='ready'
    ||review.presentation.payload.schema_version!==2||review.payload_digest!==review.presentation.payload_digest
    ||current.source.tenant_id!==ctx.tenantId||current.source.agreement_id!==ctx.agreementId||current.source.status!=='draft'
    ||!current.can_prepare&&current.preparation_hold!=='commercial_review_required'||current.state==='retained'&&!current.preparation.is_selected)return null;
  const s=review.presentation.payload.source,v=current.source;
  if(s.tenant_id!==ctx.tenantId||s.agreement_id!==ctx.agreementId||s.client_id!==v.client_id||s.agreement_version!==v.version||s.agreement_updated_at!==v.updated_at
    ||review.invoice_id!==s.invoice_id||!hash.safeParse(review.payload_digest).success)return null;
  return Object.freeze({tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,request_id:requestId,
    expected_source:Object.freeze({client_id:v.client_id,version:v.version,updated_at:v.updated_at}),action:'prepare_commercial_document' as const,
    invoice_id:review.invoice_id,commercial_payload_digest:review.payload_digest,expected_current_id:current.state==='retained'?current.preparation.id:null});
}
export async function readAgreementDocument(ctx:AgreementDocumentContext,preparationId:string|null=null):Promise<DocumentResult<AgreementDocumentView>>{
  ctx={...ctx};
  if(preparationId!==null&&!id.safeParse(preparationId).success)return failure('invalid_request');
  const query=new URLSearchParams({preparation:'metadata',businessId:ctx.tenantId,agreementId:ctx.agreementId});if(preparationId)query.set('preparationId',preparationId);
  return authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>verifyView(readReply.parse(data).view,ctx,preparationId));
}
export type {PreparedSignatureReview};
/** Read the exact SAVED source through the original authenticated owner door.
 * The local projection only checks the reply; it grants no access or approval. */
export async function readAgreementSigningReview(ctx:AgreementDocumentContext,current:Extract<AgreementDocumentView,{state:'retained'}>):Promise<DocumentResult<PreparedSignatureReview>>{
  ctx={...ctx};
  let captured:Extract<AgreementDocumentView,{state:'retained'}>;
  try{captured=structuredClone(current);}catch{return failure('invalid_request');}
  if(!valid(ctx)||!captured||captured.state!=='retained'||captured.source.tenant_id!==ctx.tenantId||captured.source.agreement_id!==ctx.agreementId)return failure('invalid_request');
  const p=captured.preparation;
  let expected:PreparedSignatureReview;
  try{
    // This browser-only comparison value is never part of the native DTO.
    delete captured.preparation.derived_fields_sha256;
    const verified=await verifyView(view.parse(captured),ctx,p.id);
    const intent=parsePreparedSignatureReviewIntent({tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,preparation_id:p.id,preparation_sha256:p.preparation_sha256,
      expected_source:{client_id:captured.source.client_id,version:captured.source.version,updated_at:captured.source.updated_at}});
    expected=await projectPreparedSignatureReview(intent,verified);
  }catch{return failure('source_changed');}
  const intent=expected.request,query=new URLSearchParams({preparation:'signing_review',businessId:intent.tenant_id,agreementId:intent.agreement_id,
    preparationId:intent.preparation_id,preparationSha256:intent.preparation_sha256,sourceClientId:intent.expected_source.client_id,
    sourceVersion:String(intent.expected_source.version),sourceUpdatedAt:intent.expected_source.updated_at});
  const result=await authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-document?'+query,{method:'GET',headers,signal}),async data=>{
    const reply=z.object({ok:z.literal(true),review:z.unknown()}).strict().parse(data);
    if(canonicalPresentationJson(reply.review)!==canonicalPresentationJson(expected))throw Error('Unverified saved signing review');
    return expected;
  });
  return result.ok===false&&result.reason==='unconfirmed'?{...result,message:'The saved signing review could not be confirmed. Retry the review or return to the document.'}:result;
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
    const commercial=current.state==='retained'&&current.preparation.manifest.schema_version===2?current.preparation.manifest.commercial:null;
    if(commercial){
      if(current.state!=='retained'||current.commercial_readback?.state!=='current')return null;
      command={tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,request_id:requestId,expected_source,action:'prepare_commercial_document',expected_current_id:current.preparation.id,
        invoice_id:commercial.payload.source.invoice_id,commercial_payload_digest:commercial.payload_digest};
    }else command={tenant_id:ctx.tenantId,agreement_id:ctx.agreementId,request_id:requestId,expected_source,action:'prepare_document',expected_current_id:current.state==='retained'?current.preparation.id:null};
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
    if(captured.action==='prepare_commercial_document'){
      const m=p.preparation.manifest;
      if(m.schema_version!==2||m.commercial.payload_digest!==captured.commercial_payload_digest
        ||m.commercial.payload.source.invoice_id!==captured.invoice_id||m.fields.length!==0)throw Error('Unverified reviewed commercial intent');
    }
    if(captured.action==='retain_fields'&&canonicalPresentationJson(p.preparation.manifest.fields)!==canonicalPresentationJson(captured.fields))throw Error('Unverified retained field intent');
    if(captured.action==='prepare_document'&&(p.preparation.manifest.schema_version!==1||p.preparation.manifest.fields.length!==0))throw Error('Unverified plain document intent');
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


export type AgreementSignatureDraft={operation_id:string;connector_id:string;messages:{signer_id:string;subject:string;body_text:string}[]};
const senderChoice=z.object({connector_id:id,from_address:z.string().refine(v=>normalizeCommsEmailAddress(v)===v),
  state:z.enum(['ready','needs_setup']),reason:z.enum(['TENANT_EMAIL_SENDER_MISSING','SENDER_VERIFICATION_MISSING','EMAIL_PROVIDER_NOT_CONFIGURED','EMAIL_RECONNECT_REQUIRED']).nullable()}).strict()
  .refine(v=>v.state==='ready'?v.reason===null:v.reason!==null);
const senderChoices=z.object({kind:z.literal('prepared_signature_sender_choices'),review_sha256:hash,senders:z.array(senderChoice).max(1000),
  provider_execution_verified:z.literal(false),approval:z.literal('not_requested'),execution:z.literal('unavailable')}).strict()
  .refine(v=>new Set(v.senders.map(s=>s.connector_id)).size===v.senders.length);
export type AgreementSignatureSender=z.infer<typeof senderChoice>;
export type AgreementSignatureSenders=z.infer<typeof senderChoices>;
const requestEnvelope=z.object({kind:z.literal('prepared_signature_request_review'),tool:z.literal('agreement_send'),args:z.record(z.string(),z.unknown()),
  request_sha256:hash,approval:z.literal('not_requested'),execution:z.literal('unavailable')}).strict();
const boundSender=z.object({connector_id:id,provider:z.literal('sendgrid'),from_address:z.string().refine(v=>normalizeCommsEmailAddress(v)===v),
  from_name:z.string().nullable(),reply_to:z.string().nullable()}).strict();
export type AgreementSignatureRequest={kind:'prepared_signature_request_review';tool:'agreement_send';args:{
  agreementId:string;expectedTenantId:string;operationId:string;preparationId:string;preparationSha256:string;reviewSha256:string;
  source:PreparedSignatureReview['request']['expected_source'];title:string;document:PreparedSignatureReview['document'];
  recipients:PreparedSignatureReview['signers'];requestSchemaVersion:1;sender:z.infer<typeof boundSender>;
  messages:{signer_id:string;to:string;subject:string;body_text:string;body_html:string}[]};
  request_sha256:string;approval:'not_requested';execution:'unavailable'};
function requestSource(ctx:AgreementDocumentContext,operationId:string,review:PreparedSignatureReview){
  if(!valid(ctx)||!id.safeParse(operationId).success||operationId!==operationId.toLowerCase()||!review.ready_for_review||review.issues.length
    ||review.request.tenant_id!==ctx.tenantId||review.request.agreement_id!==ctx.agreementId||!hash.safeParse(review.review_sha256).success)throw Error('Invalid saved request');
  return {operation_id:operationId,review:parsePreparedSignatureReviewIntent(review.request),expected_review_sha256:review.review_sha256};
}
function readOnlyResult<T>(result:DocumentResult<T>):DocumentResult<T>{
  return result.ok===false&&result.reason==='unconfirmed'?{...result,message:'This request could not be checked. Keep your message draft and retry the review.'}:result;
}
export async function readAgreementSigningSenders(ctx:AgreementDocumentContext,operationId:string,review:PreparedSignatureReview):Promise<DocumentResult<AgreementSignatureSenders>>{
  ctx={...ctx};let input:ReturnType<typeof requestSource>;
  try{input=requestSource(ctx,operationId,structuredClone(review));}catch{return failure('invalid_request');}
  return readOnlyResult(await authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-send?review=senders',{method:'POST',headers,signal,body:input}),async data=>{
    const reply=z.object({ok:z.literal(true),review:senderChoices}).strict().parse(data);
    if(reply.review.review_sha256!==input.expected_review_sha256)throw Error('Changed saved request');
    return reply.review;
  }));
}

/** Exact response projection only: all actual authorization/readiness stays on
 * the original server. A matching digest is never a confirmation or approval. */
export async function readAgreementSignatureRequest(ctx:AgreementDocumentContext,review:PreparedSignatureReview,sender:AgreementSignatureSender,draft:AgreementSignatureDraft):Promise<DocumentResult<AgreementSignatureRequest>>{
  ctx={...ctx};let input:ReturnType<typeof requestSource>&AgreementSignatureDraft,captured:PreparedSignatureReview,selected:AgreementSignatureSender;
  try{
    captured=structuredClone(review);selected=senderChoice.parse(structuredClone(sender));
    const copy=structuredClone(draft);
    if(selected.state!=='ready'||copy.connector_id!==selected.connector_id||!Array.isArray(copy.messages)
      ||copy.messages.length!==captured.signers.length||new Set(copy.messages.map(m=>m.signer_id)).size!==copy.messages.length
      ||captured.signers.some(s=>!copy.messages.some(m=>m.signer_id===s.id)))throw Error('Invalid request');
    input={...requestSource(ctx,copy.operation_id,captured),connector_id:copy.connector_id,messages:copy.messages.map(m=>({signer_id:m.signer_id,subject:m.subject,body_text:m.body_text}))};
  }catch{return failure('invalid_request');}
  return readOnlyResult(await authorized(ctx,(headers,signal)=>supabase.functions.invoke('agreement-send?review=prepared-request',{method:'POST',headers,signal,body:input}),async data=>{
    const reply=z.object({ok:z.literal(true),review:requestEnvelope}).strict().parse(data).review;
    const identity=boundSender.parse(reply.args.sender);
    if(identity.connector_id!==selected.connector_id||identity.from_address!==selected.from_address)throw Error('Changed sender');
    const expected={agreementId:captured.request.agreement_id,expectedTenantId:captured.request.tenant_id,operationId:input.operation_id,
      preparationId:captured.request.preparation_id,preparationSha256:captured.request.preparation_sha256,reviewSha256:captured.review_sha256,
      source:captured.request.expected_source,title:captured.title,document:captured.document,recipients:captured.signers,
      requestSchemaVersion:1 as const,sender:identity,messages:captured.signers.map(s=>{
        const m=input.messages.find(m=>m.signer_id===s.id)!;
        return {signer_id:s.id,to:s.email,subject:m.subject,body_text:m.body_text,body_html:commsEmailBodyHtml(m.body_text)};
      })};
    if(canonicalPresentationJson(reply.args)!==canonicalPresentationJson(expected)||reply.request_sha256!==await sha256Hex(canonicalPresentationJson(expected)))throw Error('Changed complete request');
    return {...reply,args:expected};
  }));
}
