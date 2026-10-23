import {UUID,object} from '../sales-collections/primitives.ts';
import {canonicalPresentationJson} from './preparation-json.ts';
import {prepareAgreementFields,prepareCommercialAgreementFields,readAgreementPdfDocument,type AgreementFieldPreparation,type CommercialAgreementFieldPreparation} from './field-preparation.ts';
import {renderPresentedPdf,planPresentedDocument,isOwnedByTenant} from './document.ts';
import {sha256Hex} from './token.ts';
import {readPreparationArtifact,retainPreparationArtifact,PreparationArtifactUnavailable,type PreparationStorage} from './preparation-artifact.ts';
import {readCommercialPresentationSource} from './commercial-presentation-read.ts';
import {prepareCommercialPresentation,commercialPresentationText} from './commercial-presentation.ts';

type RpcResult={data:unknown;error:{code?:string}|null};
export type OwnerPreparationCaller={
  auth:{getUser():PromiseLike<{data:{user:{id:string;is_anonymous?:boolean}|null};error?:unknown}>};
  rpc(name:string,args?:Record<string,unknown>):PromiseLike<RpcResult>;
  from?:unknown;
};
export type OwnerPreparationService={
  rpc(name:string,args:Record<string,unknown>):PromiseLike<RpcResult>;
  storage:PreparationStorage;
  originalUploadPath(tenantId:string,agreementId:string):Promise<string|null>;
};
export class OwnerPreparationUnavailable extends Error{
  constructor(readonly code:'INVALID_REQUEST'|'ACCESS_UNVERIFIED'|'SOURCE_CHANGED'|'COMMERCIAL_REVIEW_REQUIRED'|'UNCONFIRMED'){
    super('AGREEMENT_PREPARATION_'+code);
  }
}
const fail=(code:OwnerPreparationUnavailable['code']):never=>{throw new OwnerPreparationUnavailable(code);};
const uuid=(v:unknown):string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase()?v:fail('INVALID_REQUEST');
const closed=(v:unknown,keys:string[])=>{if(!object(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(v,k)))return fail('INVALID_REQUEST');return v;};
type ExpectedSource={client_id:string;version:number;updated_at:string};
function expectedSource(v:unknown):ExpectedSource{
  const s=closed(v,['client_id','version','updated_at']);
  if(!Number.isSafeInteger(s.version)||Number(s.version)<1||typeof s.updated_at!=='string'
    ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(s.updated_at)||!Number.isFinite(Date.parse(s.updated_at)))return fail('INVALID_REQUEST');
  return {client_id:uuid(s.client_id),version:Number(s.version),updated_at:s.updated_at};
}
type BaseCommand={tenant_id:string;agreement_id:string;request_id:string;expected_source:ExpectedSource};
export type OwnerPreparationCommand=BaseCommand&(
  {action:'prepare_document';expected_current_id:string|null}
  |{action:'prepare_commercial_document';expected_current_id:string|null;invoice_id:string;commercial_payload_digest:string}
  |{action:'retain_fields';source_preparation_id:string;fields:unknown[]}
);
export function parseOwnerPreparationCommand(value:unknown):OwnerPreparationCommand{
  let captured:unknown;try{captured=structuredClone(value);}catch{return fail('INVALID_REQUEST');}
  if(!object(captured))return fail('INVALID_REQUEST');
  const base=['action','tenant_id','agreement_id','request_id','expected_source'];
  const keys=captured.action==='prepare_document'?[...base,'expected_current_id']
    :captured.action==='prepare_commercial_document'?[...base,'expected_current_id','invoice_id','commercial_payload_digest']
    :captured.action==='retain_fields'?[...base,'source_preparation_id','fields']:[];
  if(!keys.length)return fail('INVALID_REQUEST');const v=closed(captured,keys);
  const common={tenant_id:uuid(v.tenant_id),agreement_id:uuid(v.agreement_id),request_id:uuid(v.request_id),expected_source:expectedSource(v.expected_source)};
  if(v.action==='prepare_document')return {...common,action:v.action,expected_current_id:v.expected_current_id===null?null:uuid(v.expected_current_id)};
  if(v.action==='prepare_commercial_document'){
    if(typeof v.commercial_payload_digest!=='string'||!/^[a-f0-9]{64}$/.test(v.commercial_payload_digest))return fail('INVALID_REQUEST');
    return {...common,action:v.action,expected_current_id:v.expected_current_id===null?null:uuid(v.expected_current_id),
      invoice_id:uuid(v.invoice_id),commercial_payload_digest:v.commercial_payload_digest};
  }
  if(!Array.isArray(v.fields)||v.fields.length>500)return fail('INVALID_REQUEST');
  // Match the ONE constructor's deterministic UUID ordering. Keep the wire
  // command closed/lowercase so an accepted first intent is replayable exactly.
  const fields=v.fields.map(field=>{if(!object(field))return fail('INVALID_REQUEST');uuid(field.id);uuid(field.signer_id);return field;})
    .sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  const parent=uuid(v.source_preparation_id);if(parent===common.request_id)return fail('INVALID_REQUEST');
  return {...common,action:'retain_fields',source_preparation_id:parent,fields};
}
type Scope={actorId:string;agreement:Record<string,unknown>;source:Record<string,unknown>;current?:Record<string,unknown>|null};
async function scope(caller:OwnerPreparationCaller,tenant:string,agreement:string,actorId?:string):Promise<Scope>{
  const user=await caller.auth.getUser();
  if(user.error||!user.data.user||user.data.user.is_anonymous||!UUID.test(user.data.user.id)||actorId&&actorId!==user.data.user.id)return fail('ACCESS_UNVERIFIED');
  const current=await caller.rpc('current_user_tenant_id');
  if(current.error||current.data!==tenant)return fail('ACCESS_UNVERIFIED');
  const role=await caller.rpc('is_tenant_admin',{_tenant:tenant});
  if(role.error||role.data!==true)return fail('ACCESS_UNVERIFIED');
  // Original human reader repeats the caller business/admin boundary. The
  // private native document reader additionally checks ACTUAL active user,
  // business/profile/membership locks before every privileged artifact phase.
  const read=await caller.rpc('read_paige_agreement_preparation',{_expected_tenant_id:tenant,_signing_id:agreement});
  if(read.error||!object(read.data)||!object(read.data.agreement)||!Array.isArray(read.data.signers))return fail('ACCESS_UNVERIFIED');
  const a=read.data.agreement;
  if(a.id!==agreement||!UUID.test(String(a.contact_id))||!Number.isSafeInteger(a.version)||typeof a.updated_at!=='string')return fail('ACCESS_UNVERIFIED');
  const signers=read.data.signers.map(v=>{if(!object(v))return fail('ACCESS_UNVERIFIED');return Object.fromEntries(['id','full_name','email','signer_role','signing_order','status'].map(k=>[k,v[k]]));});
  return {actorId:user.data.user.id,agreement:{...a},source:{tenant_id:tenant,agreement_id:agreement,client_id:a.contact_id,version:a.version,updated_at:a.updated_at,status:a.status,signers}};
}
function matches(s:Scope,expected:ExpectedSource):boolean{
  return s.agreement.contact_id===expected.client_id&&s.agreement.version===expected.version&&s.agreement.updated_at===expected.updated_at;
}
async function retained(service:OwnerPreparationService,s:Scope,tenant:string,agreement:string,id:string|null):Promise<Record<string,unknown>|null>{
  const r=await service.rpc('_read_agreement_document_preparation',{_actor:s.actorId,_tenant:tenant,_agreement:agreement,_preparation:id});
  if(r.error){if(r.error.code==='42501'){if(id)return null;return fail('ACCESS_UNVERIFIED');}return fail('UNCONFIRMED');}
  if(!object(r.data))return fail('UNCONFIRMED');if(r.data.state==='none')return null;
  const p=r.data;
  if(p.state!=='retained'||p.tenant_id!==tenant||p.agreement_id!==agreement||id&&p.id!==id||!UUID.test(String(p.id))||!UUID.test(String(p.event_id))
    ||typeof p.manifest_canonical!=='string'||p.manifest_canonical.length>1048576||typeof p.content_storage_key!=='string')return fail('UNCONFIRMED');
  let m:unknown;try{m=JSON.parse(p.manifest_canonical);}catch{return fail('UNCONFIRMED');}
  if(!object(m)||!object(m.source)||!object(m.document)||!Array.isArray(m.fields)||m.fields.length>500||!Array.isArray(m.signers)||m.signers.length>100
    ||canonicalPresentationJson(m)!==p.manifest_canonical||await sha256Hex(p.manifest_canonical)!==p.preparation_sha256
    ||m.source.tenant_id!==tenant||m.source.agreement_id!==agreement||m.source.client_id!==p.client_id||m.source.version!==p.source_version
    ||m.source.updated_at!==p.source_updated_at||m.document.sha256!==p.document_sha256||m.document.byte_length!==p.document_byte_length)return fail('UNCONFIRMED');
  readAgreementPdfDocument(m.document);
  if(m.schema_version!==1&&m.schema_version!==2)return fail('UNCONFIRMED');
  if(m.schema_version===2){
    const c=m.commercial;
    if(!object(c)||Object.keys(c).length!==4||!object(c.payload)||!object(c.payload.source)||c.payload.schema_version!==2
      ||typeof c.payload_digest!=='string'||c.payload_digest!==p.commercial_payload_digest
      ||await sha256Hex(canonicalPresentationJson(c.payload))!==c.payload_digest
      ||typeof c.presented_body_markdown!=='string'||!c.presented_body_markdown||c.presented_body_markdown.length>300000
      ||await sha256Hex(c.presented_body_markdown)!==c.presented_body_sha256
      ||c.payload.source.tenant_id!==tenant||c.payload.source.agreement_id!==agreement||c.payload.source.client_id!==p.client_id
      ||c.payload.source.agreement_version!==p.source_version||c.payload.source.agreement_updated_at!==p.source_updated_at)return fail('UNCONFIRMED');
  }
  return {...p,manifest:m};
}
function receipt(p:Record<string,unknown>,state:'recorded'|'recovered'){
  return {state,historical_receipt:true,id:p.id,event_id:p.event_id,revision_no:p.revision_no,document_sha256:p.document_sha256,preparation_sha256:p.preparation_sha256,is_selected:p.is_selected};
}

/** Same canonical Finance page; no parallel invoice selector or source store.
 * Only same-client, explicitly agreement-linked drafts leave this owner door. */
export async function listOwnerCommercialPreparationSources(
  tenantId:string,agreementId:string,beforeId:string|null,caller:OwnerPreparationCaller,service:OwnerPreparationService,
){
  const tenant=uuid(tenantId),agreement=uuid(agreementId),cursor=beforeId===null?null:uuid(beforeId);
  const original=await scope(caller,tenant,agreement);await retained(service,original,tenant,agreement,null);
  const result=await caller.rpc('list_sales_invoices',{_expected_tenant_id:tenant,_limit:50,_before_id:cursor});
  const latest=await scope(caller,tenant,agreement,original.actorId);await retained(service,latest,tenant,agreement,null);
  if(canonicalPresentationJson(original.source)!==canonicalPresentationJson(latest.source))return fail('SOURCE_CHANGED');
  if(result.error?.code==='42501')return fail('ACCESS_UNVERIFIED');
  const page=result.data;
  if(result.error||!object(page)||!Array.isArray(page.rows)||page.rows.length>50||typeof page.has_more!=='boolean'
    ||(page.has_more?typeof page.next_cursor!=='string'||!UUID.test(page.next_cursor)||page.next_cursor===cursor||!page.rows.length:page.next_cursor!==null))return fail('UNCONFIRMED');
  const items:{invoice_id:string;invoice_number:string;total_minor:number;currency:'usd'}[]=[];
  for(const row of page.rows){
    if(!object(row)||row.tenant_id!==tenant||typeof row.id!=='string'||!UUID.test(row.id))return fail('UNCONFIRMED');
    if(row.status!=='draft'||!object(row.billing_draft))continue;
    const draft=row.billing_draft;
    if(draft.agreement_id!==agreement||draft.client_id!==original.agreement.contact_id)continue;
    if(typeof row.invoice_number!=='string'||!row.invoice_number.trim()||row.invoice_number.length>100
      ||row.currency!=='usd'||!Number.isSafeInteger(row.amount_total_cents)||Number(row.amount_total_cents)<1
      ||Number(row.amount_total_cents)>2147483647||row.amount_total_cents!==draft.total_minor)return fail('UNCONFIRMED');
    items.push({invoice_id:row.id,invoice_number:row.invoice_number,total_minor:Number(row.amount_total_cents),currency:'usd'});
  }
  return {items,has_more:page.has_more,next_cursor:page.next_cursor as string|null};
}

/** Review reads only original commercial records. The digest binds what is
 * proposed for PDF preparation; it never authorizes a signature or payment. */
export async function reviewOwnerCommercialPreparation(
  tenantId:string,agreementId:string,invoiceId:string,caller:OwnerPreparationCaller,service:OwnerPreparationService,
){
  const tenant=uuid(tenantId),agreement=uuid(agreementId),invoice=uuid(invoiceId);
  const original=await scope(caller,tenant,agreement);await retained(service,original,tenant,agreement,null);
  const read=await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},
    caller as Parameters<typeof readCommercialPresentationSource>[2]);
  const check=async()=>{
    const latest=await scope(caller,tenant,agreement,original.actorId);await retained(service,latest,tenant,agreement,null);
    if(canonicalPresentationJson(original.source)!==canonicalPresentationJson(latest.source))return fail('SOURCE_CHANGED');
    return latest;
  };
  await check();
  if(read.state==='refused')return fail('SOURCE_CHANGED');
  if(read.state==='needs_input')return {state:'needs_input' as const,fields:[...read.fields]};
  const input=structuredClone(read.input);
  if(input.source.agreement_version!==original.agreement.version||input.source.agreement_updated_at!==original.agreement.updated_at
    ||input.source.client_id!==original.agreement.contact_id)return fail('SOURCE_CHANGED');
  let presentation;
  try{presentation=await prepareCommercialPresentation(input);}catch{return {state:'needs_input' as const,fields:['complete_supported_commercial_terms']};}
  const words=commercialPresentationText(input.body_markdown as string,presentation);await check();
  return {state:'ready' as const,input,presentation,payload_digest:presentation.payload_digest,presented_body_markdown:words};
}
async function publicView(p:Record<string,unknown>|null,s:Scope,caller:OwnerPreparationCaller,service:OwnerPreparationService){
  const commercial=s.agreement.offer_id!==null||s.agreement.commercial_terms_id!==null;
  const canPrepare=s.agreement.can_edit===true&&s.agreement.status==='draft'&&!commercial;
  const common={title:s.agreement.title,source:s.source,can_prepare:canPrepare,preparation_hold:commercial?'commercial_review_required':canPrepare?null:'source_not_editable'};
  if(!p)return {state:'none' as const,...common,document_signers:[]};
  let selected=p.is_selected===true&&s.current?.id===p.id;
  let sourceMatches=false;
  let commercialReadback:{state:'current'|'changed'|'unavailable';invoice_id:string;payload_digest:string}|undefined;
  // Use the final native source/selection read, never an earlier target-row
  // flag. The ONE existing constructor also verifies that fresh source/party
  // names agree with the immutable original manifest before they label fields.
  if(p.source_matches===true&&s.current?.source_matches===true&&s.agreement.status==='draft'){
    try{const manifest=p.manifest as AgreementFieldPreparation['manifest'];
      const checked=await prepareAgreementFields(s.source,manifest.document,manifest.fields);
      if(manifest.schema_version===1)sourceMatches=checked.preparation_sha256===p.preparation_sha256;
      else{
        const {commercial:_commercial,...base}=p.manifest as CommercialAgreementFieldPreparation['manifest'];
        sourceMatches=canonicalPresentationJson({...base,schema_version:1})===canonicalPresentationJson(checked.manifest);
      }
    }catch{/* Retained history is readable; changed source is never editable. */}
  }
  const manifest=p.manifest as CommercialAgreementFieldPreparation['manifest'];
  if(manifest.schema_version===2){
    const invoice=manifest.commercial.payload.source.invoice_id;
    commercialReadback={state:'unavailable',invoice_id:invoice,payload_digest:manifest.commercial.payload_digest};
    if(sourceMatches){
      try{
        const review=await reviewOwnerCommercialPreparation(String(s.source.tenant_id),String(s.source.agreement_id),invoice,caller,service);
        const current=review.state==='ready'&&review.payload_digest===manifest.commercial.payload_digest
          &&review.presented_body_markdown===manifest.commercial.presented_body_markdown;
        commercialReadback.state=current?'current':review.state==='needs_input'?'unavailable':'changed';sourceMatches=current;
      }catch(error){
        if(error instanceof OwnerPreparationUnavailable&&error.code==='ACCESS_UNVERIFIED')throw error;
        commercialReadback.state=error instanceof OwnerPreparationUnavailable&&error.code==='SOURCE_CHANGED'?'changed':'unavailable';sourceMatches=false;
      }
    }
    // Commercial review adds async source reads. Re-prove the original final
    // selection/source boundary afterwards rather than republishing its earlier
    // selected flag. CAS still owns any subsequent mutation.
    const latest=await scope(caller,String(s.source.tenant_id),String(s.source.agreement_id),s.actorId);
    latest.current=await retained(service,latest,String(s.source.tenant_id),String(s.source.agreement_id),null);
    if(canonicalPresentationJson(latest.source)!==canonicalPresentationJson(s.source)){
      sourceMatches=false;commercialReadback.state=latest.agreement.status==='draft'?'changed':'unavailable';
    }
    sourceMatches=sourceMatches&&latest.current?.source_matches===true;
    s=latest;selected=p.is_selected===true&&latest.current?.id===p.id;
    common.title=s.agreement.title;common.source=s.source;
    common.can_prepare=s.agreement.can_edit===true&&s.agreement.status==='draft'&&sourceMatches;
    common.preparation_hold=common.can_prepare?null:'commercial_review_required';
  }
  return {state:'retained' as const,...common,preparation:Object.fromEntries([
    'id','agreement_id','client_id','revision_no','source_version','source_updated_at','actor_user_id','document_sha256','document_byte_length',
    'manifest','preparation_sha256','event_id','is_selected','created_at','source_scope','source_matches','commercial_verification',
  ].map(k=>[k,k==='is_selected'?selected:k==='source_matches'?sourceMatches:p[k]])),
    document_signers:sourceMatches?s.source.signers:[],can_edit:common.can_prepare&&selected&&sourceMatches,
    ...(commercialReadback?{commercial_readback:commercialReadback}:{})};
}

/** Existing owner door only. Inputs can REFUSE but never select actor authority.
 * Caller revalidates original Auth/business/source around every asynchronous
 * artifact operation; the original private native writer owns atomic CAS/locks. */
export async function executeOwnerPreparation(value:unknown,caller:OwnerPreparationCaller,service:OwnerPreparationService){
  const c=parseOwnerPreparationCommand(value);
  let original=await scope(caller,c.tenant_id,c.agreement_id);
  const actor=original.actorId;
  const fresh=async()=>{const next=await scope(caller,c.tenant_id,c.agreement_id,actor);return {...next,current:await retained(service,next,c.tenant_id,c.agreement_id,null)};};
  // Missing and revoked are deliberately indistinguishable in the native read.
  // A null here NEVER proves rollback; fresh original authority must pass again
  // before this SAME UUID may continue through the atomic canonical writer.
  const existing=await retained(service,original,c.tenant_id,c.agreement_id,c.request_id);
  original=await fresh();
  if(existing){
    const m=existing.manifest as Record<string,unknown>;
    if(existing.actor_user_id!==actor||existing.client_id!==c.expected_source.client_id||existing.source_version!==c.expected_source.version||existing.source_updated_at!==c.expected_source.updated_at
      ||canonicalPresentationJson(m.fields)!==canonicalPresentationJson(c.action==='retain_fields'?c.fields:[]))return fail('SOURCE_CHANGED');
    if(c.action!=='retain_fields'&&existing.content_storage_key!==`${c.tenant_id}/${c.agreement_id}/draft-preparation-${c.request_id}.pdf`)return fail('SOURCE_CHANGED');
    if(c.action==='prepare_commercial_document'){
      if(m.schema_version!==2||!object(m.commercial)||m.commercial.payload_digest!==c.commercial_payload_digest
        ||!object(m.commercial.payload)||!object(m.commercial.payload.source)||m.commercial.payload.source.invoice_id!==c.invoice_id)return fail('SOURCE_CHANGED');
    }else if(c.action==='prepare_document'&&m.schema_version!==1)return fail('SOURCE_CHANGED');
    if(c.action==='retain_fields'){
      const parent=await retained(service,original,c.tenant_id,c.agreement_id,c.source_preparation_id);
      if(!parent||parent.content_storage_key!==existing.content_storage_key||parent.document_sha256!==existing.document_sha256
        ||parent.source_version!==existing.source_version||parent.source_updated_at!==existing.source_updated_at)return fail('SOURCE_CHANGED');
      const parentManifest=parent.manifest as Record<string,unknown>;
      if(parentManifest.schema_version!==m.schema_version
        ||canonicalPresentationJson(parentManifest.commercial??null)!==canonicalPresentationJson(m.commercial??null))return fail('SOURCE_CHANGED');
    }
    return {receipt:receipt(existing,'recovered'),view:await publicView(existing,await fresh(),caller,service)};
  }
  if(!matches(original,c.expected_source)||original.agreement.status!=='draft'||original.agreement.can_edit!==true)return fail('SOURCE_CHANGED');
  // Never render a linked offer/deal without its exact original economics. The
  // separately reviewed canonical commercial-presentation integration is owed.
  const linked=original.agreement.offer_id!==null||original.agreement.commercial_terms_id!==null;
  if(c.action==='prepare_document'&&linked)return fail('COMMERCIAL_REVIEW_REQUIRED');
  let commercialReview:Extract<Awaited<ReturnType<typeof reviewOwnerCommercialPreparation>>,{state:'ready'}>|null=null;
  const checkCommercial=async(invoice:string,digest:string)=>{
    const reviewed=await reviewOwnerCommercialPreparation(c.tenant_id,c.agreement_id,invoice,caller,service);
    if(reviewed.state!=='ready')return fail('COMMERCIAL_REVIEW_REQUIRED');
    if(reviewed.payload_digest!==digest)return fail('SOURCE_CHANGED');return reviewed;
  };
  if(c.action==='prepare_commercial_document')commercialReview=await checkCommercial(c.invoice_id,c.commercial_payload_digest);
  let preparation:AgreementFieldPreparation|CommercialAgreementFieldPreparation,key:string,expectedCurrent:string|null;
  if(c.action!=='retain_fields'){
    const selected=await retained(service,original,c.tenant_id,c.agreement_id,null);
    if((selected?.id??null)!==c.expected_current_id)return fail('SOURCE_CHANGED');
    const sourceDigest=await sha256Hex(canonicalPresentationJson({agreement:original.agreement,source:original.source,
      ...(commercialReview?{commercial_payload_digest:commercialReview.payload_digest,presented_body_sha256:await sha256Hex(commercialReview.presented_body_markdown)}:{})}));
    const artifact=await retainPreparationArtifact({tenantId:c.tenant_id,agreementId:c.agreement_id,requestId:c.request_id,actorUserId:actor,sourceSha256:sourceDigest},service.storage,async()=>{
      const latest=await fresh();if(!matches(latest,c.expected_source)||canonicalPresentationJson(latest.source)!==canonicalPresentationJson(original.source))return fail('SOURCE_CHANGED');
      if(commercialReview){
        try{return await renderPresentedPdf({title:String(commercialReview.input.title),bodyMarkdown:commercialReview.presented_body_markdown});}
        catch{throw new PreparationArtifactUnavailable('DOCUMENT_UNAVAILABLE');}
      }
      const path=latest.agreement.body_source==='tenant_upload'?await service.originalUploadPath(c.tenant_id,c.agreement_id):null;
      const plan=planPresentedDocument(String(latest.agreement.body_source),path);
      if(plan.kind==='refuse')return fail('SOURCE_CHANGED');
      if(plan.kind==='render'){
        if(typeof latest.agreement.title!=='string'||typeof latest.agreement.body_markdown!=='string')return fail('SOURCE_CHANGED');
        try{return await renderPresentedPdf({title:latest.agreement.title,bodyMarkdown:latest.agreement.body_markdown});}
        catch{throw new PreparationArtifactUnavailable('DOCUMENT_UNAVAILABLE');}
      }
      if(!isOwnedByTenant(plan.path,c.tenant_id))return fail('SOURCE_CHANGED');
      const file=await service.storage.from('tenant-agreements').download(plan.path);
      if(file.error||!file.data||file.data.size>26214400)return fail('UNCONFIRMED');
      return new Uint8Array(await file.data.arrayBuffer());
    },async()=>{const latest=await fresh();return matches(latest,c.expected_source)&&latest.agreement.can_edit===true&&canonicalPresentationJson({agreement:latest.agreement,source:latest.source})===canonicalPresentationJson({agreement:original.agreement,source:original.source});});
    preparation=commercialReview?await prepareCommercialAgreementFields(original.source,artifact.document,[],commercialReview.input)
      :await prepareAgreementFields(original.source,artifact.document,[]);key=artifact.storageKey;expectedCurrent=c.expected_current_id;
  }else{
    const parent=await retained(service,original,c.tenant_id,c.agreement_id,c.source_preparation_id);
    if(!parent||parent.is_selected!==true||parent.source_matches!==true)return fail('SOURCE_CHANGED');
    const parentManifest=parent.manifest as CommercialAgreementFieldPreparation['manifest'];
    if(parentManifest.schema_version===2)commercialReview=await checkCommercial(parentManifest.commercial.payload.source.invoice_id,parentManifest.commercial.payload_digest);
    else if(linked)return fail('COMMERCIAL_REVIEW_REQUIRED');
    const artifact=await readPreparationArtifact(c.tenant_id,c.agreement_id,String(parent.content_storage_key),String(parent.document_sha256),Number(parent.document_byte_length),service.storage,async()=>{const latest=await fresh();return matches(latest,c.expected_source)&&latest.agreement.can_edit===true&&canonicalPresentationJson(latest.source)===canonicalPresentationJson(original.source);});
    preparation=commercialReview?await prepareCommercialAgreementFields(original.source,artifact.document,c.fields,commercialReview.input)
      :await prepareAgreementFields(original.source,artifact.document,c.fields);key=artifact.storageKey;expectedCurrent=c.source_preparation_id;
  }
  if(commercialReview)await checkCommercial(commercialReview.presentation.payload.source.invoice_id,commercialReview.payload_digest);
  const latest=await fresh();if(!matches(latest,c.expected_source)||canonicalPresentationJson(latest.source)!==canonicalPresentationJson(original.source))return fail('SOURCE_CHANGED');
  const result=await service.rpc('_retain_agreement_document_preparation',{_actor:actor,_tenant:c.tenant_id,_agreement:c.agreement_id,_client:c.expected_source.client_id,
    _version:c.expected_source.version,_updated_at:c.expected_source.updated_at,_request:c.request_id,_expected_current:expectedCurrent,_storage_key:key,
    _manifest_canonical:canonicalPresentationJson(preparation.manifest),_manifest_digest:preparation.preparation_sha256,
    _commercial_payload_digest:preparation.manifest.schema_version===2?preparation.manifest.commercial.payload_digest:null});
  if(result.error?.code==='42501')return fail('ACCESS_UNVERIFIED');
  if(result.error?.code==='23514'||result.error?.code==='40001')return fail('SOURCE_CHANGED');
  if(result.error||!object(result.data)||result.data.id!==c.request_id)return fail('UNCONFIRMED');
  const p=await retained(service,await fresh(),c.tenant_id,c.agreement_id,c.request_id);
  if(!p||p.event_id!==result.data.event_id||p.preparation_sha256!==preparation.preparation_sha256)return fail('UNCONFIRMED');
  return {receipt:receipt(p,'recorded'),view:await publicView(p,await fresh(),caller,service)};
}

export async function readOwnerPreparation(tenantId:string,agreementId:string,preparationId:string|null,caller:OwnerPreparationCaller,service:OwnerPreparationService){
  const tenant=uuid(tenantId),agreement=uuid(agreementId),id=preparationId===null?null:uuid(preparationId);
  const s=await scope(caller,tenant,agreement);
  // Current read (id=null) MUST pass the actual active native floor even when a
  // requested historical UUID is missing. A missing nonce is never rollback.
  await retained(service,s,tenant,agreement,null);
  const p=await retained(service,s,tenant,agreement,id);
  if(id&&!p)return fail('UNCONFIRMED');
  const after=await scope(caller,tenant,agreement,s.actorId),current=await retained(service,after,tenant,agreement,null);
  return publicView(p,{...after,current},caller,service);
}

export async function readOwnerPreparationPdf(tenantId:string,agreementId:string,preparationId:string,caller:OwnerPreparationCaller,service:OwnerPreparationService){
  const tenant=uuid(tenantId),agreement=uuid(agreementId),id=uuid(preparationId);
  const s=await scope(caller,tenant,agreement);await retained(service,s,tenant,agreement,null);
  const p=await retained(service,s,tenant,agreement,id);if(!p)return fail('UNCONFIRMED');
  const artifact=await readPreparationArtifact(tenant,agreement,String(p.content_storage_key),String(p.document_sha256),Number(p.document_byte_length),service.storage,async()=>{
    const after=await scope(caller,tenant,agreement,s.actorId);await retained(service,after,tenant,agreement,null);return true;
  });
  return {bytes:artifact.bytes,sha256:artifact.document.sha256};
}
